/**
 * Bifrost Wiki — Client-side Protein Sequence Search Engine
 *
 * Supports:
 *   1. Homology search: 3-mer index prefilter + Gotoh affine-gap local alignment
 *      (Smith-Waterman with BLOSUM62, gap open -10, gap extend -1) + traceback.
 *   2. Exact / Motif / Regex search: instant exact peptide or wildcard (X / regex) scan.
 */

const AA_ORDER = 'ARNDCQEGHILKMFPSTWYVBZX*';
const AA_MAP = new Int8Array(128).fill(22); // default to X (index 22)
for (let i = 0; i < AA_ORDER.length; i++) {
  const c = AA_ORDER.charCodeAt(i);
  AA_MAP[c] = i;
  const lc = AA_ORDER[i].toLowerCase().charCodeAt(0);
  if (lc < 128) AA_MAP[lc] = i;
}

// Standard NCBI BLOSUM62 matrix (24x24 ordered by AA_ORDER)
const BLOSUM62_ROWS = [
  [ 4,-1,-2,-2, 0,-1,-1, 0,-2,-1,-1,-1,-1,-2,-1, 1, 0,-3,-2, 0,-2,-1, 0,-4], // A
  [-1, 5, 0,-2,-3, 1, 0,-2, 0,-3,-2, 2,-1,-3,-2,-1,-1,-3,-2,-3,-1, 0,-1,-4], // R
  [-2, 0, 6, 1,-3, 0, 0, 0, 1,-3,-3, 0,-2,-3,-2, 1, 0,-4,-2,-3, 3, 0,-1,-4], // N
  [-2,-2, 1, 6,-3, 0, 2,-1,-1,-3,-4,-1,-3,-3,-1, 0,-1,-4,-3,-3, 4, 1,-1,-4], // D
  [ 0,-3,-3,-3, 9,-3,-4,-3,-3,-1,-1,-3,-1,-2,-3,-1,-1,-2,-2,-1,-3,-3,-2,-4], // C
  [-1, 1, 0, 0,-3, 5, 2,-2, 0,-3,-2, 1, 0,-3,-1, 0,-1,-2,-1,-2, 0, 3,-1,-4], // Q
  [-1, 0, 0, 2,-4, 2, 5,-2, 0,-3,-3, 1,-2,-3,-1, 0,-1,-3,-2,-2, 1, 4,-1,-4], // E
  [ 0,-2, 0,-1,-3,-2,-2, 6,-2,-4,-4,-2,-3,-3,-2, 0,-2,-2,-3,-3,-1,-2,-1,-4], // G
  [-2, 0, 1,-1,-3, 0, 0,-2, 8,-3,-3,-1,-2,-1,-2,-1,-2,-2, 2,-3, 0, 0,-1,-4], // H
  [-1,-3,-3,-3,-1,-3,-3,-4,-3, 4, 2,-3, 1, 0,-3,-2,-1,-3,-1, 3,-3,-3,-1,-4], // I
  [-1,-2,-3,-4,-1,-2,-3,-4,-3, 2, 4,-2, 2, 0,-3,-2,-1,-2,-1, 1,-4,-3,-1,-4], // L
  [-1, 2, 0,-1,-3, 1, 1,-2,-1,-3,-2, 5,-1,-3,-1, 0,-1,-3,-2,-2, 0, 1,-1,-4], // K
  [-1,-1,-2,-3,-1, 0,-2,-3,-2, 1, 2,-1, 5, 0,-2,-1,-1,-1,-1, 1,-3,-1,-1,-4], // M
  [-2,-3,-3,-3,-2,-3,-3,-3,-1, 0, 0,-3, 0, 6,-4,-2,-2, 1, 3,-1,-3,-3,-1,-4], // F
  [-1,-2,-2,-1,-3,-1,-1,-2,-2,-3,-3,-1,-2,-4, 7,-1,-1,-4,-3,-2,-2,-1,-2,-4], // P
  [ 1,-1, 1, 0,-1, 0, 0, 0,-1,-2,-2, 0,-1,-2,-1, 4, 1,-3,-2,-2, 0, 0, 0,-4], // S
  [ 0,-1, 0,-1,-1,-1,-1,-2,-2,-1,-1,-1,-1,-2,-1, 1, 5,-2,-2, 0,-1,-1, 0,-4], // T
  [-3,-3,-4,-4,-2,-2,-3,-2,-2,-3,-2,-3,-1, 1,-4,-3,-2,11, 2,-3,-4,-3,-2,-4], // W
  [-2,-2,-2,-3,-2,-1,-2,-3, 2,-1,-1,-2,-1, 3,-3,-2,-2, 2, 7,-1,-3,-2,-1,-4], // Y
  [ 0,-3,-3,-3,-1,-2,-2,-3,-3, 3, 1,-2, 1,-1,-2,-2, 0,-3,-1, 4,-3,-2,-1,-4], // V
  [-2,-1, 3, 4,-3, 0, 1,-1, 0,-3,-4, 0,-3,-3,-2, 0,-1,-4,-3,-3, 4, 1,-1,-4], // B
  [-1, 0, 0, 1,-3, 3, 4,-2, 0,-3,-3, 1,-1,-3,-1, 0,-1,-3,-2,-2, 1, 4,-1,-4], // Z
  [ 0,-1,-1,-1,-2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-2, 0, 0,-2,-1,-1,-1,-1,-1,-4], // X
  [-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4, 1], // *
];

const B62 = new Int8Array(24 * 24);
for (let i = 0; i < 24; i++) {
  for (let j = 0; j < 24; j++) {
    B62[i * 24 + j] = BLOSUM62_ROWS[i][j];
  }
}

export function cleanProteinQuery(raw) {
  const lines = (raw || '').trim().split(/\r?\n/);
  let name = 'Query';
  const seqParts = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('>')) {
      if (seqParts.length > 0) break; // take first FASTA record
      name = trimmed.slice(1).trim() || 'Query';
    } else {
      seqParts.push(trimmed.replace(/[^A-Za-z*]/g, '').toUpperCase());
    }
  }
  return { name, seq: seqParts.join('') };
}

function encodeSeq(seq) {
  const n = seq.length;
  const arr = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const code = seq.charCodeAt(i);
    arr[i] = code < 128 ? AA_MAP[code] : 22;
  }
  return arr;
}

/**
 * Build a 3-mer inverted index for fast homology prefiltering.
 */
function buildKmerIndex(entries, k = 3) {
  const idx = new Map();
  for (let eIdx = 0; eIdx < entries.length; eIdx++) {
    const seq = entries[eIdx].seq;
    if (!seq || seq.length < k) continue;
    const seen = new Set();
    for (let i = 0; i <= seq.length - k; i++) {
      const kmer = seq.slice(i, i + k);
      if (seen.has(kmer)) continue;
      seen.add(kmer);
      let list = idx.get(kmer);
      if (!list) {
        list = [];
        idx.set(kmer, list);
      }
      list.push(eIdx);
    }
  }
  return idx;
}

const kmerIndexCache = new WeakMap();

/**
 * Local Smith-Waterman alignment with affine gap penalties (Gotoh algorithm).
 * Gap open = -10, gap extend = -1 (BLOSUM62 standard-like).
 */
function smithWatermanAffine(qStr, tStr, gapOpen = -10, gapExt = -1) {
  // Cap very long inputs gracefully to avoid huge O(m*n) memory spikes
  const q = encodeSeq(qStr);
  const t = encodeSeq(tStr);
  const m = q.length;
  const n = t.length;
  const cols = n + 1;

  const NEG_INF = -30000;
  // Use Int16Arrays for compact memory; packed trace byte stores all 3 Gotoh state origins:
  //   bits 0..1 (trace & 3): H origin (0=stop, 1=diag, 2=from F, 3=from E)
  //   bit 2     (trace & 4): F extended from F[i-1, j] (else opened from H[i-1, j])
  //   bit 3     (trace & 8): E extended from E[i, j-1] (else opened from H[i, j-1])
  const H = new Int16Array((m + 1) * cols);
  const F = new Int16Array(cols).fill(NEG_INF);
  const trace = new Uint8Array((m + 1) * cols);

  let bestScore = 0;
  let bestI = 0;
  let bestJ = 0;

  for (let i = 1; i <= m; i++) {
    const qi24 = q[i - 1] * 24;
    const rowOff = i * cols;
    const prevOff = (i - 1) * cols;
    let eLeft = NEG_INF;

    for (let j = 1; j <= n; j++) {
      // F[j] = gap in target (coming from top row i-1, j)
      const fOpen = H[prevOff + j] + gapOpen;
      const fExt = F[j] + gapExt;
      const fIsExt = fExt > fOpen;
      const fVal = fIsExt ? fExt : fOpen;
      F[j] = fVal;

      // eLeft = gap in query (coming from left col i, j-1)
      const eOpen = H[rowOff + j - 1] + gapOpen;
      const eExt = eLeft + gapExt;
      const eIsExt = eExt > eOpen;
      eLeft = eIsExt ? eExt : eOpen;

      // Diagonal match/mismatch
      const diag = H[prevOff + j - 1] + B62[qi24 + t[j - 1]];

      let best = 0;
      let dir = 0;
      if (diag > best) {
        best = diag;
        dir = 1;
      }
      if (fVal > best) {
        best = fVal;
        dir = 2;
      }
      if (eLeft > best) {
        best = eLeft;
        dir = 3;
      }

      H[rowOff + j] = best;
      trace[rowOff + j] = dir | (fIsExt ? 4 : 0) | (eIsExt ? 8 : 0);

      if (best > bestScore) {
        bestScore = best;
        bestI = i;
        bestJ = j;
      }
    }
  }

  if (bestScore <= 0) {
    return null;
  }

  // Exact 3-state Gotoh traceback (state: 0 = H, 1 = F / gap in target, 2 = E / gap in query)
  let i = bestI;
  let j = bestJ;
  let state = 0;
  const qAln = [];
  const mid = [];
  const tAln = [];
  let matches = 0;
  let positives = 0;

  while (i > 0 && j > 0) {
    const idx = i * cols + j;
    const tb = trace[idx];
    if (state === 0) {
      const dir = tb & 3;
      if (dir === 0 || H[idx] === 0) break;
      if (dir === 1) {
        const qa = qStr[i - 1];
        const ta = tStr[j - 1];
        qAln.push(qa);
        tAln.push(ta);
        if (qa === ta) {
          mid.push('|');
          matches++;
          positives++;
        } else if (B62[q[i - 1] * 24 + t[j - 1]] > 0) {
          mid.push('+');
          positives++;
        } else {
          mid.push(' ');
        }
        i--;
        j--;
      } else if (dir === 2) {
        state = 1;
      } else {
        state = 2;
      }
    } else if (state === 1) {
      const fIsExt = (tb & 4) !== 0;
      qAln.push(qStr[i - 1]);
      mid.push(' ');
      tAln.push('-');
      i--;
      if (!fIsExt) state = 0;
    } else {
      const eIsExt = (tb & 8) !== 0;
      qAln.push('-');
      mid.push(' ');
      tAln.push(tStr[j - 1]);
      j--;
      if (!eIsExt) state = 0;
    }
  }

  qAln.reverse();
  mid.reverse();
  tAln.reverse();
  const alignLen = qAln.length;
  const qSpan = bestI - i;
  const tSpan = bestJ - j;

  return {
    score: bestScore,
    alignLen,
    matches,
    positives,
    identityPct: (matches / alignLen) * 100,
    positivesPct: (positives / alignLen) * 100,
    queryCovPct: (qSpan / m) * 100,
    targetCovPct: (tSpan / n) * 100,
    qStart: i + 1,
    qEnd: bestI,
    tStart: j + 1,
    tEnd: bestJ,
    qAln: qAln.join(''),
    mid: mid.join(''),
    tAln: tAln.join(''),
  };
}

/**
 * Run homology search against an array of `{ type, rec, seq }` entries.
 */
export function runHomologySearch(rawQuery, entries, { maxResults = 50, maxCandidates = 140 } = {}) {
  const { name, seq } = cleanProteinQuery(rawQuery);
  if (seq.length < 5) {
    return { queryName: name, querySeq: seq, error: 'Please enter at least 5 amino acids for homology search.', hits: [] };
  }
  const qTrim = seq.length > 2000 ? seq.slice(0, 2000) : seq;

  // Step 1: fast k-mer prefiltering
  const k = qTrim.length < 15 ? 2 : 3;
  let candidateIndices;

  if (entries.length <= maxCandidates) {
    candidateIndices = entries.map((_, idx) => idx);
  } else {
    // Build/cache k-mer index on this entries array (or build fresh if ephemeral)
    let kIdx = kmerIndexCache.get(entries);
    if (!kIdx || kIdx.k !== k) {
      kIdx = { k, map: buildKmerIndex(entries, k) };
      kmerIndexCache.set(entries, kIdx);
    }
    const counts = new Uint16Array(entries.length);
    const seenQ = new Set();
    for (let i = 0; i <= qTrim.length - k; i++) {
      const kmer = qTrim.slice(i, i + k);
      if (seenQ.has(kmer)) continue;
      seenQ.add(kmer);
      const list = kIdx.map.get(kmer);
      if (list) {
        for (let p = 0; p < list.length; p++) {
          counts[list[p]]++;
        }
      }
    }

    const scored = [];
    for (let i = 0; i < entries.length; i++) {
      if (counts[i] > 0) scored.push([counts[i], i]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    candidateIndices = scored.slice(0, maxCandidates).map((x) => x[1]);

    // Fallback: if very divergent sequence had zero exact 3-mer hits, scan top 2-mer matches
    if (candidateIndices.length === 0 && k === 3) {
      const k2Map = buildKmerIndex(entries, 2);
      const c2 = new Uint16Array(entries.length);
      const seen2 = new Set();
      for (let i = 0; i <= qTrim.length - 2; i++) {
        const km = qTrim.slice(i, i + 2);
        if (seen2.has(km)) continue;
        seen2.add(km);
        const list = k2Map.get(km);
        if (list) for (let p = 0; p < list.length; p++) c2[list[p]]++;
      }
      const s2 = [];
      for (let i = 0; i < entries.length; i++) if (c2[i] > 0) s2.push([c2[i], i]);
      s2.sort((a, b) => b[0] - a[0]);
      candidateIndices = s2.slice(0, Math.min(80, maxCandidates)).map((x) => x[1]);
    }
  }

  // Step 2: Gotoh local Smith-Waterman alignment on candidates
  const hits = [];
  for (const eIdx of candidateIndices) {
    const entry = entries[eIdx];
    const tSeq = entry.seq;
    if (!tSeq) continue;
    // For very long parent NLRs (>1800 aa) with long queries, still fast (~3ms)
    const aln = smithWatermanAffine(qTrim, tSeq);
    if (!aln) continue;
    if (aln.score < 22) continue;
    hits.push({
      entry,
      ...aln,
    });
  }

  hits.sort((a, b) => b.score - a.score || b.identityPct - a.identityPct);
  return {
    queryName: name,
    querySeq: qTrim,
    truncated: seq.length > 2000,
    candidatesAligned: candidateIndices.length,
    totalScanned: entries.length,
    hits: hits.slice(0, maxResults),
  };
}

/**
 * Convert a protein motif/regex pattern into valid uppercase regex source:
 *  - Preserves regex escape sequences verbatim (\w, \d, \s, \X, etc.)
 *  - Uppercases non-escaped residues so lowercase queries match uppercase sequences
 *  - Expands wildcard 'X' to [A-Z] outside character classes and A-Z inside [...]
 */
function buildMotifRegexSource(pattern) {
  let out = '';
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) {
      out += ch + pattern[i + 1];
      i++;
      continue;
    }
    if (ch === '[' && !inClass) {
      inClass = true;
      out += ch;
      continue;
    }
    if (ch === ']' && inClass) {
      inClass = false;
      out += ch;
      continue;
    }
    const up = ch.toUpperCase();
    if (up === 'X') {
      const inRange =
        inClass &&
        ((i > 0 && pattern[i - 1] === '-' && pattern[i - 2] !== '[') ||
          (i + 1 < pattern.length && pattern[i + 1] === '-' && pattern[i + 2] !== ']'));
      out += inClass ? (inRange ? 'X' : 'A-Z') : '[A-Z]';
    } else {
      out += up;
    }
  }
  return out;
}

/**
 * Exact substring or motif/regex search (treats `X` as wildcard if regex mode or motif syntax).
 */
export function runMotifSearch(rawPattern, entries, { useRegex = true, maxResults = 200 } = {}) {
  const cleaned = (rawPattern || '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('>'))
    .join('')
    .replace(/\s+/g, '');

  if (cleaned.length < 3) {
    return { pattern: cleaned, error: 'Please enter at least 3 characters for motif/exact search.', hits: [] };
  }

  const exactNeedle = cleaned.toUpperCase();
  let re = null;
  if (useRegex) {
    try {
      const regexSrc = buildMotifRegexSource(cleaned);
      re = new RegExp(regexSrc, 'g');
    } catch (err) {
      return { pattern: cleaned, error: `Invalid regex pattern: ${err.message}`, hits: [] };
    }
  }

  const hits = [];
  for (const entry of entries) {
    const seq = entry.seq;
    if (!seq) continue;
    const matches = [];
    if (re) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(seq)) !== null) {
        if (m[0].length === 0) break;
        matches.push({ start: m.index + 1, end: m.index + m[0].length, match: m[0] });
        if (matches.length >= 10) break;
      }
    } else {
      let pos = 0;
      while ((pos = seq.indexOf(exactNeedle, pos)) !== -1) {
        matches.push({ start: pos + 1, end: pos + exactNeedle.length, match: exactNeedle });
        pos += 1;
        if (matches.length >= 10) break;
      }
    }
    if (matches.length > 0) {
      hits.push({ entry, matches });
    }
  }

  return {
    pattern: useRegex ? cleaned : exactNeedle,
    totalMatches: hits.length,
    totalScanned: entries.length,
    hits: hits.slice(0, maxResults),
  };
}

const nearestPoolCache = new WeakMap();
const nearestResultCache = new Map();

function getNearestPool(recs, kind) {
  let cached = nearestPoolCache.get(recs);
  if (cached) return cached;
  const entries = recs.map((rec) => ({ type: kind, rec, seq: rec.seq || '' }));
  const k3 = buildKmerIndex(entries, 3);
  const k2 = buildKmerIndex(entries, 2);
  cached = { entries, k3, k2 };
  nearestPoolCache.set(recs, cached);
  return cached;
}

/**
 * Find the most similar sequence(s) to `targetRec` inside `recs` (excluding self).
 * Uses cached 3-mer + 2-mer prefiltering plus Gotoh affine-gap BLOSUM62 Smith-Waterman.
 */
export function findNearestSequences(targetRec, recs, kind, { topK = 5, maxCandidates = 64 } = {}) {
  if (!targetRec || !targetRec.seq || !recs || recs.length < 2) {
    return { top: null, others: [], all: [] };
  }
  const cacheKey = `${kind}:${targetRec.id}:${topK}`;
  if (nearestResultCache.has(cacheKey)) {
    return nearestResultCache.get(cacheKey);
  }

  const { entries, k3, k2 } = getNearestPool(recs, kind);
  const qSeq = targetRec.seq.length > 1500 ? targetRec.seq.slice(0, 1500) : targetRec.seq;
  const n = entries.length;

  const counts = new Uint16Array(n);
  const seen3 = new Set();
  for (let i = 0; i <= qSeq.length - 3; i++) {
    const km = qSeq.slice(i, i + 3);
    if (seen3.has(km)) continue;
    seen3.add(km);
    const list = k3.get(km);
    if (list) {
      for (let p = 0; p < list.length; p++) counts[list[p]]++;
    }
  }

  const candSet = new Set();
  const scored3 = [];
  for (let i = 0; i < n; i++) {
    if (entries[i].rec.id === targetRec.id) continue;
    if (counts[i] > 0) scored3.push([counts[i], i]);
  }
  scored3.sort((a, b) => b[0] - a[0]);
  for (let i = 0; i < Math.min(maxCandidates, scored3.length); i++) {
    candSet.add(scored3[i][1]);
  }

  // For NLR IDs, also ensure peers sharing the same primary InterPro domain are considered
  if (kind === 'id' && targetRec.ipr) {
    let addedIpr = 0;
    for (let i = 0; i < n && addedIpr < 30; i++) {
      const r = entries[i].rec;
      if (r.id !== targetRec.id && r.ipr === targetRec.ipr && !candSet.has(i)) {
        candSet.add(i);
        addedIpr++;
      }
    }
  }

  // Fallback to 2-mer prefilter if 3-mers returned few candidates (handles divergent/orphan proteins)
  if (candSet.size < 16) {
    const c2 = new Uint16Array(n);
    const seen2 = new Set();
    for (let i = 0; i <= qSeq.length - 2; i++) {
      const km = qSeq.slice(i, i + 2);
      if (seen2.has(km)) continue;
      seen2.add(km);
      const list = k2.get(km);
      if (list) {
        for (let p = 0; p < list.length; p++) c2[list[p]]++;
      }
    }
    const scored2 = [];
    for (let i = 0; i < n; i++) {
      if (entries[i].rec.id === targetRec.id || candSet.has(i)) continue;
      if (c2[i] > 0) scored2.push([c2[i], i]);
    }
    scored2.sort((a, b) => b[0] - a[0]);
    for (let i = 0; i < Math.min(36, scored2.length); i++) {
      candSet.add(scored2[i][1]);
    }
  }

  const hits = [];
  for (const idx of candSet) {
    const rec = entries[idx].rec;
    if (!rec.seq) continue;
    const aln = smithWatermanAffine(qSeq, rec.seq);
    if (!aln) continue;
    let relation = '';
    if (kind === 'id') {
      if (rec.pnlr && rec.pnlr === targetRec.pnlr) relation = 'Same parent NLR';
      else if (rec.sp === targetRec.sp) relation = 'Same species · putative paralog';
      else relation = 'Different species · putative ortholog';
    } else {
      if (rec.sp === targetRec.sp) relation = 'Same species · putative paralog';
      else if (rec.org === targetRec.org) relation = `Same group (${rec.org}) · putative ortholog`;
      else relation = 'Cross-group local match';
    }
    const isWeak =
      aln.score < 55 ||
      aln.queryCovPct < 20 ||
      (kind === 'pathogen' && rec.org !== targetRec.org && aln.identityPct < 35);
    hits.push({ rec, relation, isWeak, ...aln });
  }

  hits.sort((a, b) => b.score - a.score || b.identityPct - a.identityPct || b.queryCovPct - a.queryCovPct);
  const sliced = hits.slice(0, topK);
  const out = { top: sliced[0] || null, others: sliced.slice(1), all: sliced };
  nearestResultCache.set(cacheKey, out);
  return out;
}
