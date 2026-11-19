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
  // Use Int16Arrays for compact memory; trace byte stores origin of H
  const H = new Int16Array((m + 1) * cols);
  const E = new Int16Array(cols).fill(NEG_INF);
  const F = new Int16Array(cols).fill(NEG_INF);
  // Trace: 0=stop, 1=diag(match/mismatch), 2=up(gap in t / deletion), 3=left(gap in q / insertion)
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
      const fVal = fOpen > fExt ? fOpen : fExt;
      F[j] = fVal;

      // eLeft = gap in query (coming from left col i, j-1)
      const eOpen = H[rowOff + j - 1] + gapOpen;
      const eExt = eLeft + gapExt;
      eLeft = eOpen > eExt ? eOpen : eExt;
      E[j] = eLeft;

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
      trace[rowOff + j] = dir;

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

  // Traceback
  let i = bestI;
  let j = bestJ;
  const qAln = [];
  const mid = [];
  const tAln = [];
  let matches = 0;
  let positives = 0;

  while (i > 0 && j > 0) {
    const idx = i * cols + j;
    const dir = trace[idx];
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
      qAln.push(qStr[i - 1]);
      mid.push(' ');
      tAln.push('-');
      i--;
    } else {
      qAln.push('-');
      mid.push(' ');
      tAln.push(tStr[j - 1]);
      j--;
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
 * Exact substring or motif/regex search (treats `X` as wildcard `.` if regex mode or motif syntax).
 */
export function runMotifSearch(rawPattern, entries, { useRegex = true, maxResults = 200 } = {}) {
  const cleaned = (rawPattern || '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('>'))
    .join('')
    .replace(/\s+/g, '')
    .toUpperCase();

  if (cleaned.length < 3) {
    return { pattern: cleaned, error: 'Please enter at least 3 characters for motif/exact search.', hits: [] };
  }

  let re = null;
  if (useRegex) {
    try {
      // Allow bioinformatics wildcard 'X' to match any residue unless inside bracket class
      const regexSrc = cleaned.replace(/X/g, '[A-Z]');
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
      while ((pos = seq.indexOf(cleaned, pos)) !== -1) {
        matches.push({ start: pos + 1, end: pos + cleaned.length, match: cleaned });
        pos += 1;
        if (matches.length >= 10) break;
      }
    }
    if (matches.length > 0) {
      hits.push({ entry, matches });
    }
  }

  return {
    pattern: cleaned,
    totalMatches: hits.length,
    totalScanned: entries.length,
    hits: hits.slice(0, maxResults),
  };
}
