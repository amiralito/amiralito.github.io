/**
 * Bifrost Wiki — Custom Interaction Heatmap Tool (#/heatmap)
 *
 * Allows researchers to select any subset of NLR integrated domains (Chain A)
 * and pathogen/pest proteins (Chain B) — via search, group/InterPro/species
 * batch-add, pasted lists, a neutral example matrix, or paralog/ortholog links —
 * and render an interactive, publication-ready heatmap with SVG, 2x PNG, and
 * TSV matrix export.
 */

import { store, SCORE_SCALE, STATUS } from './data.js';
import { ID_COLORS, ORG_COLORS } from './charts.js';
import { esc, fmtInt, panelBadge, navigateToPair } from './ui.js';
import { copyToClipboard, triggerDownload } from './export.js';
import { findNearestSequences } from './seqsearch.js';

const MAX_SOFT_AXIS = 80;

const METRICS = [
  { key: 'ipsae_min', label: 'ipSAE (min) ★', short: 'ipSAE (min)', maxDefault: 1, decimals: 3 },
  { key: 'ipsae_max', label: 'ipSAE (max)', short: 'ipSAE (max)', maxDefault: 1, decimals: 3 },
  { key: 'ipsae_mean', label: 'ipSAE (mean)', short: 'ipSAE (mean)', maxDefault: 1, decimals: 3 },
  { key: 'ipsae_a', label: 'ipSAE A→B (ID)', short: 'ipSAE A→B', maxDefault: 1, decimals: 3 },
  { key: 'ipsae_b', label: 'ipSAE B→A (Pathogen)', short: 'ipSAE B→A', maxDefault: 1, decimals: 3 },
  { key: 'd0dom_min', label: 'ipSAE d0dom (min)', short: 'd0dom (min)', maxDefault: 1, decimals: 3 },
  { key: 'd0chn_min', label: 'ipSAE d0chn (min)', short: 'd0chn (min)', maxDefault: 1, decimals: 3 },
  { key: 'iptm', label: 'ipTM (AF3)', short: 'ipTM', maxDefault: 1, decimals: 3 },
  { key: 'pdockq', label: 'pDockQ', short: 'pDockQ', maxDefault: 1, decimals: 3 },
  { key: 'pdockq2_min', label: 'pDockQ2 (min)', short: 'pDockQ2', maxDefault: 1, decimals: 3 },
  { key: 'lis_min', label: 'LIS (min)', short: 'LIS (min)', maxDefault: 1, decimals: 3 },
  { key: 'contacts', label: 'Contacts (<10 Å)', short: 'Contacts', maxDefault: null, decimals: 0 },
];

const PALETTES = {
  bifrost: {
    label: 'Bifrost',
    light: ['#f6f8fd', '#a8e4f9', '#4895ef', '#4361ee', '#7209b7', '#f72585'],
    dark: ['#1b202e', '#1e4b73', '#2d68c4', '#5639c6', '#9a1cb8', '#f72585'],
  },
  viridis: {
    label: 'Viridis',
    light: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
    dark: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  },
  magma: {
    label: 'Warm (Magma)',
    light: ['#fcf9f4', '#fed194', '#f7785c', '#c33b75', '#5a167e', '#170f38'],
    dark: ['#1e1b29', '#5a167e', '#b63679', '#ef635d', '#febd82', '#fcfdbf'],
  },
  blues: {
    label: 'Blues',
    light: ['#f6f8fc', '#c6dbef', '#6baed6', '#2171b5', '#08306b'],
    dark: ['#1a202e', '#1c406b', '#2669a8', '#529cd6', '#b7dcf7'],
  },
};

const state = {
  idIndices: [], // array of meta.ids indices (unique, ordered)
  pathIndices: [], // array of meta.pathogens indices (unique, ordered)
  metric: 'ipsae_min',
  order: 'group', // 'cluster' | 'peak' | 'group' | 'custom'
  palette: 'bifrost',
  cellSize: 28, // 20 | 28 | 38
  showValues: false,
  transpose: false,
  fullLabels: false,
  hideBuilder: false,
  isExample: false,
  focusBanner: '',
};

let activeGen = 0;

/* --------------------------------------------------------------------------
   Color Interpolation & Luminance Helpers
   -------------------------------------------------------------------------- */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r, g, b) {
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function samplePalette(paletteKey, t, darkMode = false) {
  const pal = PALETTES[paletteKey] || PALETTES.bifrost;
  const stops = darkMode ? pal.dark : pal.light;
  const x = Math.max(0, Math.min(1, Number(t) || 0));
  const scaled = x * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const [r0, g0, b0] = hexToRgb(stops[idx]);
  const [r1, g1, b1] = hexToRgb(stops[idx + 1]);
  return rgbToHex(
    Math.round(r0 + (r1 - r0) * frac),
    Math.round(g0 + (g1 - g0) * frac),
    Math.round(b0 + (b1 - b0) * frac)
  );
}

function textColorForFill(hex) {
  const [r, g, b] = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.56 ? '#ffffff' : '#14171f';
}

/* --------------------------------------------------------------------------
   Hierarchical Clustering (Average-Linkage UPGMA with Leaf-Flip Seriation)
   -------------------------------------------------------------------------- */
function pairDist(vA, vB) {
  let sumSq = 0;
  let shared = 0;
  for (let i = 0; i < vA.length; i++) {
    const a = vA[i];
    const b = vB[i];
    if (!Number.isNaN(a) && !Number.isNaN(b)) {
      const d = a - b;
      sumSq += d * d;
      shared++;
    }
  }
  if (shared === 0) return 0.5;
  return Math.sqrt(sumSq / shared);
}

function hierarchicalOrder(vectors) {
  const n = vectors.length;
  if (n <= 2) return vectors.map((_, i) => i);
  if (n > 150) {
    // Fallback to peak score sort for very large matrices
    return vectors
      .map((v, i) => ({ i, peak: v.reduce((m, x) => (!Number.isNaN(x) && x > m ? x : m), -1) }))
      .sort((a, b) => b.peak - a.peak)
      .map((x) => x.i);
  }

  // Pairwise distance matrix
  const dist = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = pairDist(vectors[i], vectors[j]);
      dist[i * n + j] = d;
      dist[j * n + i] = d;
    }
  }

  const clusters = [];
  for (let i = 0; i < n; i++) {
    const peak = vectors[i].reduce((m, x) => (!Number.isNaN(x) && x > m ? x : m), -1);
    clusters.push({ items: [i], peak });
  }

  const avgDist = (cA, cB) => {
    let total = 0;
    const a = cA.items;
    const b = cB.items;
    for (let i = 0; i < a.length; i++) {
      const off = a[i] * n;
      for (let j = 0; j < b.length; j++) total += dist[off + b[j]];
    }
    return total / (a.length * b.length);
  };

  while (clusters.length > 1) {
    let bestI = 0;
    let bestJ = 1;
    let bestD = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = avgDist(clusters[i], clusters[j]);
        if (d < bestD) {
          bestD = d;
          bestI = i;
          bestJ = j;
        }
      }
    }

    const cA = clusters[bestI];
    const cB = clusters[bestJ];
    // Orient leaf order so higher-peak cluster trends top/left and adjacent boundary leaves minimize distance
    const aItems = cA.peak >= cB.peak ? cA.items.slice() : cB.items.slice();
    const bItems = cA.peak >= cB.peak ? cB.items.slice() : cA.items.slice();

    const aHead = aItems[0];
    const aTail = aItems[aItems.length - 1];
    const bHead = bItems[0];
    const bTail = bItems[bItems.length - 1];

    const opts = [
      { d: dist[aTail * n + bHead], flipA: false, flipB: false },
      { d: dist[aTail * n + bTail], flipA: false, flipB: true },
      { d: dist[aHead * n + bHead], flipA: true, flipB: false },
      { d: dist[aHead * n + bTail], flipA: true, flipB: true },
    ];
    opts.sort((x, y) => x.d - y.d);
    if (opts[0].flipA) aItems.reverse();
    if (opts[0].flipB) bItems.reverse();

    clusters[bestI] = {
      items: aItems.concat(bItems),
      peak: Math.max(cA.peak, cB.peak),
    };
    clusters.splice(bestJ, 1);
  }

  return clusters[0].items;
}

/* --------------------------------------------------------------------------
   Concise Labels & Metric Extraction
   -------------------------------------------------------------------------- */
function abbrevSpecies(sp) {
  const s = (sp || '').trim();
  if (/virus/i.test(s)) {
    const m = s.match(/\(([^)]+)\)/);
    return m ? m[1] : s;
  }
  const parts = s.split(/\s+/);
  if (parts.length >= 3 && (parts[1].toLowerCase() === 'x' || parts[1] === '×')) {
    return `${parts[0][0]}. × ${parts[2]}`;
  }
  if (parts.length >= 2) return `${parts[0][0]}. ${parts[1]}`;
  return s;
}

function fitWithSuffix(base, suffix, maxLen = 48) {
  if (base.length + suffix.length <= maxLen) return base + suffix;
  const keep = Math.max(8, maxLen - suffix.length - 1);
  return base.slice(0, keep).trimEnd() + '…' + suffix;
}

function buildRowLabels(idRecs, useFull) {
  if (useFull) return idRecs.map((r) => r.id);
  const raw = idRecs.map((r) => `${abbrevSpecies(r.sp)} · ${r.ipr_s || r.ipr}`);
  const counts = new Map();
  for (const s of raw) counts.set(s, (counts.get(s) || 0) + 1);
  const firstPass = idRecs.map((r, i) => {
    const base = raw[i];
    if (counts.get(base) <= 1) return base;
    const shortAcc = r.acc ? r.acc.replace(/^.*_/, '').slice(0, 10) : `#${i + 1}`;
    return fitWithSuffix(base, ` (${shortAcc})`);
  });
  // Disambiguate sibling IDs on the same parent NLR (same species, InterPro short name & accession)
  const candCounts = new Map();
  for (const s of firstPass) candCounts.set(s, (candCounts.get(s) || 0) + 1);
  const finalSeen = new Map();
  return idRecs.map((r, i) => {
    const cand = firstPass[i];
    if (candCounts.get(cand) <= 1) return cand;
    const base = raw[i];
    const shortAcc = r.acc ? r.acc.replace(/^.*_/, '').slice(0, 6) : `#${i + 1}`;
    const suffix = ` (${shortAcc}:${r.st}–${r.en})`;
    const withCoords = fitWithSuffix(base, suffix);
    const n = (finalSeen.get(withCoords) || 0) + 1;
    finalSeen.set(withCoords, n);
    return n > 1 ? fitWithSuffix(base, ` (${shortAcc}:${r.st}–${r.en} #${n})`) : withCoords;
  });
}

function buildColLabels(pathRecs, useFull) {
  if (useFull) return pathRecs.map((r) => `${r.id} (${abbrevSpecies(r.sp)})`);
  return pathRecs.map((r) => r.id);
}

function extractMetricFromBin(sBin, r, metricKey) {
  if (metricKey === 'contacts') return sBin.dist1[r] + sBin.dist2[r];
  if (metricKey === 'ipsae_mean') return (sBin.ipsae_a[r] + sBin.ipsae_b[r]) / (2 * SCORE_SCALE);
  if (sBin[metricKey]) return sBin[metricKey][r] / SCORE_SCALE;
  return sBin.ipsae_min[r] / SCORE_SCALE;
}

/* --------------------------------------------------------------------------
   Neutral Example Matrix & Sequence-Similarity Comparison Links
   -------------------------------------------------------------------------- */
function sampleEvenly(arr, count) {
  if (arr.length <= count) return arr.slice();
  const out = [];
  const step = (arr.length - 1) / Math.max(1, count - 1);
  for (let i = 0; i < count; i++) {
    out.push(arr[Math.round(i * step)]);
  }
  return out;
}

/**
 * Load a neutral 15 × 15 catalog sample across all panels/organism groups
 * (unranked, not filtered by score) solely to illustrate the heatmap layout.
 */
function applyExampleMatrix(meta) {
  state.focusBanner = '';
  state.isExample = true;
  state.idIndices = sampleEvenly(store.screenedIds, 15).map((r) => r.i);
  state.pathIndices = sampleEvenly(meta.pathogens, 15).map((r) => r.i);
}

async function applyFocusMode(params, meta) {
  const focusId = params.get('focusId');
  const focusPath = params.get('focusPath');

  if (focusId && store.idByName.has(focusId)) {
    const target = store.idByName.get(focusId);
    const nn = findNearestSequences(target, store.screenedIds, 'id', { topK: 9 });
    const family = [];
    if (target.scr) family.push(target);
    for (const h of nn.all) {
      if (!family.some((x) => x.i === h.rec.i)) family.push(h.rec);
    }
    state.idIndices = family.map((r) => r.i);

    // Load screening sets for these IDs and select their top 18 scoring pathogen partners
    const neededSets = new Set();
    for (const r of family) {
      for (const sIdx of store.setsByIdPanel.get(r.s) || []) neededSets.add(sIdx);
    }
    await store.loadSets([...neededSets]);

    const idSet = new Set(state.idIndices);
    const pathBest = new Map();
    for (const sIdx of neededSets) {
      const sBin = store.sets.get(sIdx);
      if (!sBin) continue;
      for (let r = 0; r < sBin.n; r++) {
        if (sBin.status[r] !== STATUS.SCORED) continue;
        if (!idSet.has(sBin.id_idx[r])) continue;
        const pI = sBin.path_idx[r];
        const v = sBin.ipsae_min[r];
        if (v > (pathBest.get(pI) || -1)) pathBest.set(pI, v);
      }
    }
    state.pathIndices = [...pathBest.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 18)
      .map((x) => x[0]);
    state.isExample = false;
    state.order = 'custom';
    const nOthers = target.scr ? Math.max(0, family.length - 1) : family.length;
    state.focusBanner = target.scr
      ? `Comparing <b>${esc(target.id)}</b> with its ${nOthers} most similar NLR IDs in Bifrost (ordered by sequence similarity) against ${state.pathIndices.length} screened pathogen/pest partners.`
      : `<b>${esc(target.id)}</b> was excluded from AlphaFold 3 screening; showing its ${nOthers} most similar screened NLR IDs in Bifrost against ${state.pathIndices.length} screened pathogen/pest partners.`;
    return true;
  }

  if (focusPath && store.pathByName.has(focusPath)) {
    const target = store.pathByName.get(focusPath);
    const nn = findNearestSequences(target, meta.pathogens, 'pathogen', { topK: 9 });
    const family = [target];
    for (const h of nn.all) {
      if (!family.some((x) => x.i === h.rec.i)) family.push(h.rec);
    }
    state.pathIndices = family.map((r) => r.i);

    const neededSets = new Set();
    for (const r of family) {
      for (const sIdx of store.setsByPathPanel.get(r.s) || []) neededSets.add(sIdx);
    }
    await store.loadSets([...neededSets]);

    const paSet = new Set(state.pathIndices);
    const idBest = new Map();
    for (const sIdx of neededSets) {
      const sBin = store.sets.get(sIdx);
      if (!sBin) continue;
      for (let r = 0; r < sBin.n; r++) {
        if (sBin.status[r] !== STATUS.SCORED) continue;
        if (!paSet.has(sBin.path_idx[r])) continue;
        const idI = sBin.id_idx[r];
        const v = sBin.ipsae_min[r];
        if (v > (idBest.get(idI) || -1)) idBest.set(idI, v);
      }
    }
    state.idIndices = [...idBest.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 18)
      .map((x) => x[0]);
    state.isExample = false;
    state.order = 'custom';
    state.focusBanner = `Comparing <b>${esc(target.id)}</b> with its ${Math.max(0, family.length - 1)} most similar pathogen/pest proteins in Bifrost (ordered by sequence similarity) against ${state.idIndices.length} screened NLR ID partners.`;
    return true;
  }

  return false;
}

/* --------------------------------------------------------------------------
   Build Interaction Matrix from Needed Binary Sets
   -------------------------------------------------------------------------- */
function getNeededSetsForSelection(meta) {
  const idPanels = new Set(state.idIndices.map((i) => meta.ids[i].s));
  const pathPanels = new Set(state.pathIndices.map((i) => meta.pathogens[i].s));
  const out = [];
  for (const ds of meta.datasets) {
    if (idPanels.has(ds.id_panel) && pathPanels.has(ds.path_panel)) out.push(ds.idx);
  }
  return out;
}

function buildMatrix(meta, neededSets) {
  const nRows = state.idIndices.length;
  const nCols = state.pathIndices.length;
  const rowPos = new Int16Array(meta.ids.length).fill(-1);
  const colPos = new Int16Array(meta.pathogens.length).fill(-1);
  for (let i = 0; i < nRows; i++) rowPos[state.idIndices[i]] = i;
  for (let j = 0; j < nCols; j++) colPos[state.pathIndices[j]] = j;

  // Flat nRows x nCols grid of cell objects (null = not screened)
  const grid = new Array(nRows * nCols).fill(null);
  let maxObserved = 0;
  let nScored = 0;
  let nFailed = 0;
  let nMissing = 0;

  for (const sIdx of neededSets) {
    const sBin = store.sets.get(sIdx);
    if (!sBin) continue;
    const idArr = sBin.id_idx;
    const paArr = sBin.path_idx;
    const stArr = sBin.status;
    for (let r = 0; r < sBin.n; r++) {
      const ri = rowPos[idArr[r]];
      if (ri < 0) continue;
      const cj = colPos[paArr[r]];
      if (cj < 0) continue;
      const st = stArr[r];
      const pair = store.rowToObject(sBin, r);
      if (st === STATUS.SCORED) {
        const val = extractMetricFromBin(sBin, r, state.metric);
        if (val > maxObserved) maxObserved = val;
        nScored++;
        grid[ri * nCols + cj] = { status: STATUS.SCORED, value: val, pair };
      } else if (st === STATUS.FAILED) {
        nFailed++;
        grid[ri * nCols + cj] = { status: STATUS.FAILED, value: NaN, pair };
      } else {
        nMissing++;
        grid[ri * nCols + cj] = { status: STATUS.MISSING, value: NaN, pair };
      }
    }
  }

  const nNotScreened = nRows * nCols - nScored - nFailed - nMissing;
  return { grid, nRows, nCols, maxObserved, nScored, nFailed, nMissing, nNotScreened };
}

/* --------------------------------------------------------------------------
   SVG Heatmap Renderer (Interactive On-Screen + Standalone Publication Export)
   -------------------------------------------------------------------------- */
function renderHeatmapSvg(meta, mat, { forExport = false } = {}) {
  const darkMode = !forExport && document.documentElement.getAttribute('data-theme') === 'dark';
  const metricDef = METRICS.find((m) => m.key === state.metric) || METRICS[0];
  const scaleMax = metricDef.maxDefault !== null ? metricDef.maxDefault : Math.max(10, mat.maxObserved);

  const idRecs = state.idIndices.map((i) => meta.ids[i]);
  const pathRecs = state.pathIndices.map((i) => meta.pathogens[i]);

  // Compute ordering over IDs (0..nRows-1) and Pathogens (0..nCols-1)
  const rawRowVecs = [];
  for (let i = 0; i < mat.nRows; i++) {
    const vec = new Float64Array(mat.nCols);
    for (let j = 0; j < mat.nCols; j++) {
      const c = mat.grid[i * mat.nCols + j];
      vec[j] = c && c.status === STATUS.SCORED ? c.value / scaleMax : NaN;
    }
    rawRowVecs.push(vec);
  }
  const rawColVecs = [];
  for (let j = 0; j < mat.nCols; j++) {
    const vec = new Float64Array(mat.nRows);
    for (let i = 0; i < mat.nRows; i++) {
      const c = mat.grid[i * mat.nCols + j];
      vec[i] = c && c.status === STATUS.SCORED ? c.value / scaleMax : NaN;
    }
    rawColVecs.push(vec);
  }

  let idOrder;
  let pathOrder;
  if (state.order === 'cluster') {
    idOrder = hierarchicalOrder(rawRowVecs);
    pathOrder = hierarchicalOrder(rawColVecs);
  } else if (state.order === 'peak') {
    idOrder = rawRowVecs
      .map((v, i) => ({ i, p: v.reduce((m, x) => (!Number.isNaN(x) && x > m ? x : m), -1) }))
      .sort((a, b) => b.p - a.p)
      .map((x) => x.i);
    pathOrder = rawColVecs
      .map((v, j) => ({ j, p: v.reduce((m, x) => (!Number.isNaN(x) && x > m ? x : m), -1) }))
      .sort((a, b) => b.p - a.p)
      .map((x) => x.j);
  } else if (state.order === 'group') {
    idOrder = idRecs
      .map((r, i) => ({ i, k: `${r.s}|${r.ipr_s || r.ipr}|${r.sp}|${r.id}` }))
      .sort((a, b) => a.k.localeCompare(b.k))
      .map((x) => x.i);
    pathOrder = pathRecs
      .map((r, j) => ({ j, k: `${r.org}|${r.sp}|${r.id}` }))
      .sort((a, b) => a.k.localeCompare(b.k))
      .map((x) => x.j);
  } else {
    idOrder = idRecs.map((_, i) => i);
    pathOrder = pathRecs.map((_, j) => j);
  }

  const ordIds = idOrder.map((i) => idRecs[i]);
  const ordPaths = pathOrder.map((j) => pathRecs[j]);
  const idLabels = buildRowLabels(ordIds, state.fullLabels);
  const pathLabels = buildColLabels(ordPaths, state.fullLabels);

  // Build displayed rows & cols (respecting transpose)
  const rows = state.transpose
    ? ordPaths.map((rec, idx) => ({
        kind: 'pathogen',
        rec,
        label: pathLabels[idx],
        href: `#/pathogen/${encodeURIComponent(rec.id)}`,
        annotColor: ORG_COLORS[rec.org] || '#64748b',
        origIdx: pathOrder[idx],
      }))
    : ordIds.map((rec, idx) => ({
        kind: 'id',
        rec,
        label: idLabels[idx],
        href: `#/id/${encodeURIComponent(rec.id)}`,
        annotColor: ID_COLORS[rec.s] || '#4361ee',
        origIdx: idOrder[idx],
      }));

  const cols = state.transpose
    ? ordIds.map((rec, idx) => ({
        kind: 'id',
        rec,
        label: idLabels[idx],
        href: `#/id/${encodeURIComponent(rec.id)}`,
        annotColor: ID_COLORS[rec.s] || '#4361ee',
        origIdx: idOrder[idx],
      }))
    : ordPaths.map((rec, idx) => ({
        kind: 'pathogen',
        rec,
        label: pathLabels[idx],
        href: `#/pathogen/${encodeURIComponent(rec.id)}`,
        annotColor: ORG_COLORS[rec.org] || '#64748b',
        origIdx: pathOrder[idx],
      }));

  const cell = state.cellSize;
  const gap = cell >= 26 ? 2 : 1.5;
  const step = cell + gap;
  const fontSize = cell >= 34 ? 11.5 : cell >= 26 ? 10.5 : 9.5;
  const charW = fontSize * 0.59;

  const maxRowChars = Math.min(48, Math.max(12, ...rows.map((r) => r.label.length)));
  const maxColChars = Math.min(40, Math.max(10, ...cols.map((c) => c.label.length)));

  const leftPad = Math.round(maxRowChars * charW) + 28;
  const headerTop = forExport ? 46 : 12;
  const colLabelH = Math.round(maxColChars * charW * 0.72) + 26;
  const annotSize = 6;
  const annotGap = 5;

  const gridX = leftPad + annotSize + annotGap;
  const gridY = headerTop + colLabelH + annotSize + annotGap;
  const gridW = cols.length * step - gap;
  const gridH = rows.length * step - gap;

  const usedIdPanels = [...new Set(ordIds.map((r) => r.s))].sort();
  const usedOrgs = [...new Set(ordPaths.map((r) => r.org))];
  const swatchItems = [
    ...usedIdPanels.map((p) => ({ label: p, color: ID_COLORS[p] })),
    ...usedOrgs.map((o) => ({ label: o, color: ORG_COLORS[o] })),
  ];
  const barW = 160;
  const swatchesW = swatchItems.reduce((acc, sw) => acc + sw.label.length * 6.4 + 24, 0);
  const statusW =
    (mat.nNotScreened > 0 ? 164 : 0) +
    (mat.nFailed > 0 ? 132 : 0) +
    (mat.nMissing > 0 ? 146 : 0);
  const rightPad = Math.max(48, Math.round(maxColChars * charW * 0.52));
  const legendH = 66;
  const totalW = Math.max(520, gridX + gridW + rightPad, gridX + barW + 26 + Math.max(swatchesW, statusW) + 16);
  const totalH = gridY + gridH + legendH + (forExport ? 22 : 10);

  // Concrete theme colors (always light-publication on export)
  const bgFill = darkMode ? '#171a22' : '#ffffff';
  const ink = darkMode ? '#eef0f6' : '#14171f';
  const ink2 = darkMode ? '#b0b6c6' : '#454a57';
  const ink3 = darkMode ? '#7f8699' : '#6c7282';
  const borderCol = darkMode ? '#272c3a' : '#e6e8ef';
  const unscrBg = darkMode ? '#1d212d' : '#f3f4f8';
  const hatchCol = darkMode ? '#313749' : '#d5d9e4';
  const fontFam = 'Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const monoFam = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

  // Colorbar gradient stops
  const palStops = (PALETTES[state.palette] || PALETTES.bifrost)[darkMode ? 'dark' : 'light'];
  const gradId = `hm-grad-${state.palette}-${darkMode ? 'd' : 'l'}`;
  const hatchId = `hm-hatch-${darkMode ? 'd' : 'l'}`;
  const gradStopsSvg = palStops
    .map((c, idx) => `<stop offset="${((idx / (palStops.length - 1)) * 100).toFixed(1)}%" stop-color="${c}"/>`)
    .join('');

  // Column annotation strip + rotated labels
  let colSvg = '';
  for (let cIdx = 0; cIdx < cols.length; cIdx++) {
    const col = cols[cIdx];
    const x = gridX + cIdx * step;
    const cx = x + cell / 2;
    const lblText = col.label.length > 40 ? col.label.slice(0, 39) + '…' : col.label;
    colSvg += `<rect x="${x.toFixed(1)}" y="${(gridY - annotGap - annotSize).toFixed(1)}" width="${cell}" height="${annotSize}" rx="1.5" fill="${col.annotColor}"/>`;
    const tx = cx + 2;
    const ty = gridY - annotGap - annotSize - 6;
    const labelEl = `<text x="0" y="0" transform="translate(${tx.toFixed(1)},${ty.toFixed(1)}) rotate(-45)" text-anchor="start" font-size="${fontSize}" font-family='${fontFam}' fill="${ink2}" class="hm-axis-lbl">${esc(lblText)}</text>`;
    colSvg += forExport ? labelEl : `<a href="${col.href}" class="hm-lbl-link">${labelEl}</a>`;
  }

  // Row annotation strip + right-aligned labels + cells
  let rowSvg = '';
  let cellSvg = '';
  const showVals = state.showValues && cell >= 22;
  const valFont = cell >= 34 ? 10 : cell >= 26 ? 8.8 : 7.5;

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const row = rows[rIdx];
    const y = gridY + rIdx * step;
    const cy = y + cell / 2;
    const lblText = row.label.length > 48 ? row.label.slice(0, 47) + '…' : row.label;
    rowSvg += `<rect x="${(gridX - annotGap - annotSize).toFixed(1)}" y="${y.toFixed(1)}" width="${annotSize}" height="${cell}" rx="1.5" fill="${row.annotColor}"/>`;
    const labelEl = `<text x="${(gridX - annotGap - annotSize - 7).toFixed(1)}" y="${(cy + fontSize * 0.35).toFixed(1)}" text-anchor="end" font-size="${fontSize}" font-family='${fontFam}' fill="${ink2}" class="hm-axis-lbl">${esc(lblText)}</text>`;
    rowSvg += forExport ? labelEl : `<a href="${row.href}" class="hm-lbl-link">${labelEl}</a>`;

    for (let cIdx = 0; cIdx < cols.length; cIdx++) {
      const col = cols[cIdx];
      const x = gridX + cIdx * step;
      const idIdx = state.transpose ? col.origIdx : row.origIdx;
      const paIdx = state.transpose ? row.origIdx : col.origIdx;
      const cellObj = mat.grid[idIdx * mat.nCols + paIdx];

      if (!cellObj) {
        // Not screened (e.g. ID2/ID3 x E2)
        cellSvg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cell}" height="${cell}" rx="2" fill="url(#${hatchId})" stroke="${borderCol}" stroke-width="0.5"${forExport ? '' : ` class="hm-cell hm-unscr" data-r="${rIdx}" data-c="${cIdx}" data-id="${idIdx}" data-pa="${paIdx}"`}/>`;
      } else if (cellObj.status === STATUS.FAILED || cellObj.status === STATUS.MISSING) {
        const sym = cellObj.status === STATUS.FAILED ? '×' : '?';
        cellSvg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cell}" height="${cell}" rx="2" fill="${unscrBg}" stroke="${borderCol}" stroke-width="0.6"${forExport ? '' : ` class="hm-cell hm-clickable" data-r="${rIdx}" data-c="${cIdx}" data-id="${idIdx}" data-pa="${paIdx}"`}/>`;
        cellSvg += `<text x="${(x + cell / 2).toFixed(1)}" y="${(cy + 3.5).toFixed(1)}" text-anchor="middle" font-size="${Math.max(9, valFont)}" font-family='${monoFam}' fill="${ink3}" pointer-events="none">${sym}</text>`;
      } else {
        const norm = scaleMax > 0 ? cellObj.value / scaleMax : 0;
        const fill = samplePalette(state.palette, norm, darkMode);
        cellSvg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cell}" height="${cell}" rx="2" fill="${fill}"${forExport ? '' : ` class="hm-cell hm-clickable" data-r="${rIdx}" data-c="${cIdx}" data-id="${idIdx}" data-pa="${paIdx}"`}/>`;
        if (showVals) {
          const txt = metricDef.decimals === 0 ? String(Math.round(cellObj.value)) : cellObj.value.toFixed(2).replace(/^0\./, '.');
          const txtCol = textColorForFill(fill);
          cellSvg += `<text x="${(x + cell / 2).toFixed(1)}" y="${(cy + valFont * 0.36).toFixed(1)}" text-anchor="middle" font-size="${valFont}" font-family='${monoFam}' font-weight="500" fill="${txtCol}" pointer-events="none">${txt}</text>`;
        }
      }
    }
  }

  // Bottom Legend Bar (colorbar + panel/organism keys + status keys if present)
  const legY = gridY + gridH + 22;
  const barH = 10;
  let legSvg = `
    <text x="${gridX}" y="${legY}" font-size="11" font-weight="600" font-family='${fontFam}' fill="${ink}">${esc(metricDef.short)}</text>
    <rect x="${gridX}" y="${legY + 6}" width="${barW}" height="${barH}" rx="3" fill="url(#${gradId})" stroke="${borderCol}" stroke-width="0.6"/>
    <text x="${gridX}" y="${legY + 29}" font-size="10" font-family='${monoFam}' fill="${ink3}">0</text>
    <text x="${gridX + barW / 2}" y="${legY + 29}" text-anchor="middle" font-size="10" font-family='${monoFam}' fill="${ink3}">${metricDef.decimals === 0 ? Math.round(scaleMax / 2) : (scaleMax / 2).toFixed(2)}</text>
    <text x="${gridX + barW}" y="${legY + 29}" text-anchor="end" font-size="10" font-family='${monoFam}' fill="${ink3}">${metricDef.decimals === 0 ? Math.round(scaleMax) : scaleMax.toFixed(2)}</text>
  `;

  // Panel / Organism & Status legends to the right of colorbar
  let lx = gridX + barW + 26;
  const ly1 = legY + 12;
  for (const sw of swatchItems) {
    legSvg += `<rect x="${lx}" y="${ly1 - 8}" width="9" height="9" rx="2" fill="${sw.color}"/>`;
    legSvg += `<text x="${lx + 13}" y="${ly1}" font-size="10.5" font-family='${fontFam}' fill="${ink2}">${esc(sw.label)}</text>`;
    lx += sw.label.length * 6.4 + 24;
  }

  let sx = gridX + barW + 26;
  const ly2 = legY + 29;
  if (mat.nNotScreened > 0) {
    legSvg += `<rect x="${sx}" y="${ly2 - 8}" width="10" height="10" rx="2" fill="url(#${hatchId})" stroke="${borderCol}" stroke-width="0.7"/>`;
    legSvg += `<text x="${sx + 14}" y="${ly2}" font-size="10" font-family='${fontFam}' fill="${ink3}">Not screened (E2 = ID1 only)</text>`;
    sx += 164;
  }
  if (mat.nFailed > 0) {
    legSvg += `<text x="${sx}" y="${ly2}" font-size="10" font-family='${monoFam}' fill="${ink3}">× ipSAE failed (${mat.nFailed})</text>`;
    sx += 132;
  }
  if (mat.nMissing > 0) {
    legSvg += `<text x="${sx}" y="${ly2}" font-size="10" font-family='${monoFam}' fill="${ink3}">? Missing scores (${mat.nMissing})</text>`;
  }

  const exportHeaderSvg = forExport
    ? `
      <rect x="0" y="0" width="${totalW}" height="${totalH}" fill="#ffffff"/>
      <text x="18" y="25" font-size="14" font-weight="600" font-family='${fontFam}' fill="#14171f">Bifrost Interaction Heatmap · ${esc(metricDef.short)}</text>
      <text x="18" y="40" font-size="10.5" font-family='${fontFam}' fill="#6c7282">${ordIds.length} NLR IDs × ${ordPaths.length} pathogen/pest proteins · AlphaFold 3 v3.0.1 (${esc(state.order)} order)</text>
    `
    : '';

  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}" class="hm-svg" role="img" aria-label="Bifrost interaction heatmap (${rows.length} by ${cols.length})">
    <defs>
      <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="0%">${gradStopsSvg}</linearGradient>
      <pattern id="${hatchId}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="${unscrBg}"/>
        <line x1="0" y1="0" x2="0" y2="6" stroke="${hatchCol}" stroke-width="1.4"/>
      </pattern>
    </defs>
    ${exportHeaderSvg}
    ${colSvg}
    ${rowSvg}
    ${cellSvg}
    ${legSvg}
  </svg>`;

  return { svgStr, width: totalW, height: totalH, rows, cols, ordIds, ordPaths, idOrder, pathOrder, metricDef, scaleMax };
}

/* --------------------------------------------------------------------------
   SVG / PNG / TSV Exports
   -------------------------------------------------------------------------- */
function exportHeatmapPng(svgStr, width, height, filename) {
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob((pngBlob) => {
      if (!pngBlob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(pngBlob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
    }, 'image/png');
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

function exportHeatmapTsv(meta, mat, rendered) {
  const { idOrder, pathOrder, metricDef } = rendered;
  const cols = pathOrder.map((j) => meta.pathogens[state.pathIndices[j]]);
  const rows = idOrder.map((i) => meta.ids[state.idIndices[i]]);
  const lines = [['nlr_id', 'panel', 'species', 'interpro', ...cols.map((c) => c.id)].join('\t')];
  for (let ri = 0; ri < rows.length; ri++) {
    const origI = idOrder[ri];
    const idR = rows[ri];
    const vals = pathOrder.map((origJ) => {
      const c = mat.grid[origI * mat.nCols + origJ];
      if (!c || c.status !== STATUS.SCORED) return 'NA';
      return metricDef.decimals === 0 ? String(Math.round(c.value)) : c.value.toFixed(4);
    });
    lines.push([idR.id, idR.s, idR.sp, idR.ipr, ...vals].join('\t'));
  }
  triggerDownload(`bifrost_heatmap_${state.metric}.tsv`, lines.join('\n') + '\n', 'text/tab-separated-values');
}

/* --------------------------------------------------------------------------
   Main View Renderer (#/heatmap)
   -------------------------------------------------------------------------- */
const VALID_ORDERS = new Set(['cluster', 'peak', 'group', 'custom']);

export async function renderHeatmapView(container, params) {
  const gen = ++activeGen;
  const meta = store.meta;

  // Apply URL parameters if present (validate order & reset transpose cleanly)
  if (params && [...params.keys()].length > 0) {
    if (params.get('metric') && METRICS.some((m) => m.key === params.get('metric'))) state.metric = params.get('metric');
    if (params.get('order') && VALID_ORDERS.has(params.get('order'))) state.order = params.get('order');
    if (params.get('palette') && PALETTES[params.get('palette')]) state.palette = params.get('palette');
    state.transpose = params.get('transpose') === '1';

    const focused = await applyFocusMode(params, meta);
    if (gen !== activeGen) return;

    if (!focused) {
      state.focusBanner = '';
      if (params.get('ids')) {
        const wanted = params.get('ids').split(',').map((x) => x.trim()).filter(Boolean);
        state.idIndices = wanted
          .map((name) => store.idByName.get(name))
          .filter((r) => r && r.scr)
          .map((r) => r.i);
        state.isExample = false;
      }
      if (params.get('paths')) {
        const wanted = params.get('paths').split(',').map((x) => x.trim()).filter(Boolean);
        state.pathIndices = wanted
          .map((name) => store.pathByName.get(name))
          .filter(Boolean)
          .map((r) => r.i);
        state.isExample = false;
      }
    }
  }

  // Show a neutral 15 × 15 catalog sample on clean open so the heatmap layout is visible immediately
  if (!state.idIndices.length && !state.pathIndices.length) {
    applyExampleMatrix(meta);
  }

  const screenedIds = store.screenedIds;

  // Build group options for batch selectors
  const iprGroups = [];
  for (const [ipr, list] of store.idsByInterpro.entries()) {
    const scrList = list.filter((r) => r.scr);
    if (!scrList.length) continue;
    const shortN = meta.interpro?.[ipr]?.s || scrList[0].ipr_s || ipr;
    iprGroups.push({ val: ipr, label: `${ipr} · ${shortN} (${scrList.length})`, n: scrList.length });
  }
  iprGroups.sort((a, b) => b.n - a.n || a.val.localeCompare(b.val));

  const idCats = [...new Set(screenedIds.map((r) => r.cat).filter(Boolean))].sort();
  const idOrders = [...new Set(screenedIds.map((r) => r.ord).filter(Boolean))].sort();
  const idSpecies = [...new Set(screenedIds.map((r) => r.sp).filter(Boolean))].sort();

  const pathSpecies = [...new Set(meta.pathogens.map((r) => r.sp))].sort();
  const pathClasses = [...new Set(meta.pathogens.map((r) => r.cls).filter(Boolean))].sort();

  container.innerHTML = `
    <div class="eyebrow">Tools · Custom interaction matrix</div>
    <div class="page-head-row">
      <div style="min-width:0;flex:1">
        <h1>Custom heatmap</h1>
        <p class="lede" style="margin-bottom:12px">
          Select any subset of NLR integrated domains and pathogen or pest proteins to visualize pairwise AlphaFold 3 interface scores across all 13 screening sets.
        </p>
      </div>
      <div class="btn-group">
        <button type="button" class="btn btn-sm" id="hm-copy-link">Copy link</button>
        <button type="button" class="btn btn-sm" id="hm-dl-tsv">TSV</button>
        <button type="button" class="btn btn-sm" id="hm-dl-svg">SVG</button>
        <button type="button" class="btn btn-sm btn-primary" id="hm-dl-png">PNG</button>
      </div>
    </div>

    ${state.focusBanner ? `<div class="callout" id="hm-focus-banner" style="margin:0 0 14px">${state.focusBanner}</div>` : ''}

    <!-- Neutral Example Action Bar -->
    <div class="hm-presets">
      <button type="button" class="chip${state.isExample ? ' on-soft' : ''}" id="hm-load-example">Load example (15 × 15)</button>
      <button type="button" class="chip" id="hm-clear-all">Clear all</button>
      <button type="button" class="chip" id="hm-toggle-builder" style="margin-left:auto">${state.hideBuilder ? 'Show selectors' : 'Hide selectors'}</button>
    </div>

    <!-- Two-Column Selection Builder -->
    <div class="hm-builder" id="hm-builder" ${state.hideBuilder ? 'hidden' : ''}>
      <!-- Chain A: NLR IDs -->
      <section class="hm-picker">
        <div class="hm-picker-head">
          <div>
            <b>NLR Integrated Domains</b> <span class="muted">(Chain A)</span>
            <span class="badge" id="hm-id-cnt" style="margin-left:6px">0</span>
          </div>
          <div class="btn-group">
            <button type="button" class="btn btn-sm" id="hm-id-paste-toggle">Paste list</button>
            <button type="button" class="btn btn-sm" id="hm-id-clear">Clear</button>
          </div>
        </div>

        <div class="hm-ac-wrap">
          <input type="search" id="hm-id-search" placeholder="Search ID name, species, InterPro to add…" autocomplete="off" />
          <div class="hm-ac-list" id="hm-id-ac" hidden></div>
        </div>

        <div class="hm-batch-row">
          <select id="hm-id-grp-type" aria-label="Group type">
            <option value="ipr">InterPro domain</option>
            <option value="cat">Category</option>
            <option value="ord">Plant order</option>
            <option value="sp">Plant species</option>
            <option value="panel">ID panel</option>
          </select>
          <select id="hm-id-grp-val" aria-label="Group value"></select>
          <button type="button" class="btn btn-sm" id="hm-id-add-grp" title="Add matching IDs from this group in catalog order (up to 25)">Add group</button>
        </div>

        <div class="hm-paste-box" id="hm-id-paste-box" hidden>
          <textarea id="hm-id-paste-ta" placeholder="Paste NLR ID names, parent NLR IDs, or accessions (one per line or comma-separated)…"></textarea>
          <div class="hm-paste-foot">
            <span class="muted" id="hm-id-paste-msg" style="font-size:12px"></span>
            <button type="button" class="btn btn-sm btn-primary" id="hm-id-paste-apply">Add matches</button>
          </div>
        </div>

        <div class="hm-chip-tray" id="hm-id-chips"></div>
      </section>

      <!-- Chain B: Pathogen / Pest Proteins -->
      <section class="hm-picker">
        <div class="hm-picker-head">
          <div>
            <b>Pathogen &amp; Pest Proteins</b> <span class="muted">(Chain B)</span>
            <span class="badge" id="hm-pa-cnt" style="margin-left:6px">0</span>
          </div>
          <div class="btn-group">
            <button type="button" class="btn btn-sm" id="hm-pa-paste-toggle">Paste list</button>
            <button type="button" class="btn btn-sm" id="hm-pa-clear">Clear</button>
          </div>
        </div>

        <div class="hm-ac-wrap">
          <input type="search" id="hm-pa-search" placeholder="Search effector, virus protein, species to add…" autocomplete="off" />
          <div class="hm-ac-list" id="hm-pa-ac" hidden></div>
        </div>

        <div class="hm-batch-row">
          <select id="hm-pa-grp-type" aria-label="Pathogen group type">
            <option value="sp">Species / Virus</option>
            <option value="org">Organism type</option>
            <option value="panel">Pathogen panel</option>
            <option value="cls">Protein class</option>
          </select>
          <select id="hm-pa-grp-val" aria-label="Pathogen group value"></select>
          <button type="button" class="btn btn-sm" id="hm-pa-add-grp" title="Add matching proteins (up to 40)">Add group</button>
        </div>

        <div class="hm-paste-box" id="hm-pa-paste-box" hidden>
          <textarea id="hm-pa-paste-ta" placeholder="Paste effector or viral protein names (one per line or comma-separated)…"></textarea>
          <div class="hm-paste-foot">
            <span class="muted" id="hm-pa-paste-msg" style="font-size:12px"></span>
            <button type="button" class="btn btn-sm btn-primary" id="hm-pa-paste-apply">Add matches</button>
          </div>
        </div>

        <div class="hm-chip-tray" id="hm-pa-chips"></div>
      </section>
    </div>

    <!-- Visualization Controls -->
    <div class="hm-controls">
      <div class="hm-ctrl-field">
        <label for="hm-metric">Metric</label>
        <select id="hm-metric">
          ${METRICS.map((m) => `<option value="${m.key}"${m.key === state.metric ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}
        </select>
      </div>
      <div class="hm-ctrl-field">
        <label for="hm-order">Order</label>
        <select id="hm-order">
          <option value="cluster"${state.order === 'cluster' ? ' selected' : ''}>Clustered (hierarchical)</option>
          <option value="peak"${state.order === 'peak' ? ' selected' : ''}>Peak score</option>
          <option value="group"${state.order === 'group' ? ' selected' : ''}>Species / panel</option>
          <option value="custom"${state.order === 'custom' ? ' selected' : ''}>Selection order</option>
        </select>
      </div>
      <div class="hm-ctrl-field">
        <label for="hm-palette">Palette</label>
        <select id="hm-palette">
          ${Object.entries(PALETTES).map(([k, v]) => `<option value="${k}"${k === state.palette ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}
        </select>
      </div>
      <div class="hm-ctrl-field">
        <label>Cell size</label>
        <div class="seg" id="hm-size-seg">
          <button type="button" data-sz="20"${state.cellSize === 20 ? ' class="on"' : ''}>S</button>
          <button type="button" data-sz="28"${state.cellSize === 28 ? ' class="on"' : ''}>M</button>
          <button type="button" data-sz="38"${state.cellSize === 38 ? ' class="on"' : ''}>L</button>
        </div>
      </div>
      <div class="hm-ctrl-toggles">
        <button type="button" class="chip${state.showValues ? ' on-soft' : ''}" id="hm-btn-vals">Values</button>
        <button type="button" class="chip${state.transpose ? ' on-soft' : ''}" id="hm-btn-trans">Transpose</button>
        <button type="button" class="chip${state.fullLabels ? ' on-soft' : ''}" id="hm-btn-full">Full IDs</button>
      </div>
    </div>

    <div id="hm-load-bar" class="load-bar" style="display:none"></div>
    <div class="table-meta" id="hm-meta"></div>

    <!-- Heatmap Canvas Stage -->
    <div class="hm-stage-wrap" id="hm-stage-wrap">
      <div class="hm-stage" id="hm-stage"></div>
      <div class="chart-tooltip" id="hm-tip" hidden></div>
    </div>
  `;

  let lastMat = null;
  let lastRendered = null;
  let renderSeq = 0;

  /* ---- Populate Batch Group Dropdowns ---- */
  function populateIdGroupValues() {
    const t = container.querySelector('#hm-id-grp-type').value;
    const sel = container.querySelector('#hm-id-grp-val');
    if (t === 'ipr') {
      sel.innerHTML = iprGroups.map((g) => `<option value="${esc(g.val)}">${esc(g.label)}</option>`).join('');
    } else if (t === 'cat') {
      sel.innerHTML = idCats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    } else if (t === 'ord') {
      sel.innerHTML = idOrders.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
    } else if (t === 'sp') {
      sel.innerHTML = idSpecies.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    } else {
      sel.innerHTML = ['ID1', 'ID2', 'ID3'].map((p) => `<option value="${p}">${p} · ${meta.panels[p].short}</option>`).join('');
    }
  }

  function populatePathGroupValues() {
    const t = container.querySelector('#hm-pa-grp-type').value;
    const sel = container.querySelector('#hm-pa-grp-val');
    if (t === 'sp') {
      sel.innerHTML = pathSpecies
        .map((s) => {
          const n = meta.pathogens.filter((r) => r.sp === s).length;
          return `<option value="${esc(s)}">${esc(s)} (${n})</option>`;
        })
        .join('');
    } else if (t === 'org') {
      sel.innerHTML = ['Oomycete', 'Nematode', 'Insect', 'Virus']
        .map((o) => `<option value="${o}">${o} (${meta.pathogens.filter((r) => r.org === o).length})</option>`)
        .join('');
    } else if (t === 'panel') {
      sel.innerHTML = ['E1', 'E2', 'E3', 'E4', 'V1']
        .map((p) => `<option value="${p}">${p} · ${meta.panels[p].short} (${meta.pathogens.filter((r) => r.s === p).length})</option>`)
        .join('');
    } else {
      sel.innerHTML = pathClasses
        .map((c) => `<option value="${esc(c)}">${esc(c)} (${meta.pathogens.filter((r) => r.cls === c).length})</option>`)
        .join('');
    }
  }

  /* ---- Render Selected Chip Trays ---- */
  function renderChipTrays() {
    container.querySelector('#hm-id-cnt').textContent = state.idIndices.length;
    container.querySelector('#hm-pa-cnt').textContent = state.pathIndices.length;

    const idTray = container.querySelector('#hm-id-chips');
    idTray.innerHTML = state.idIndices.length
      ? state.idIndices
          .map((idx) => {
            const r = meta.ids[idx];
            return `<span class="hm-pill" title="${esc(r.id)} · ${esc(r.sp)} · ${esc(r.ipr_n || r.ipr)}">
              <span class="dot" style="background:${ID_COLORS[r.s]}"></span>
              <span class="hm-pill-txt">${esc(abbrevSpecies(r.sp))} · ${esc(r.ipr_s || r.ipr)}</span>
              <button type="button" class="hm-pill-x" data-rm-id="${idx}" aria-label="Remove ${esc(r.id)}">&times;</button>
            </span>`;
          })
          .join('')
      : '<span class="muted" style="font-size:12px">No NLR IDs selected — search, pick a domain/species group, paste a list, or load the example above.</span>';

    const paTray = container.querySelector('#hm-pa-chips');
    paTray.innerHTML = state.pathIndices.length
      ? state.pathIndices
          .map((idx) => {
            const r = meta.pathogens[idx];
            return `<span class="hm-pill" title="${esc(r.id)} · ${esc(r.sp)} (${esc(r.org)})">
              <span class="dot" style="background:${ORG_COLORS[r.org]}"></span>
              <span class="hm-pill-txt">${esc(r.id)}</span>
              <button type="button" class="hm-pill-x" data-rm-pa="${idx}" aria-label="Remove ${esc(r.id)}">&times;</button>
            </span>`;
          })
          .join('')
      : '<span class="muted" style="font-size:12px">No pathogen/pest proteins selected — search, pick a species/group, paste a list, or load the example above.</span>';

    idTray.querySelectorAll('[data-rm-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rm = Number(btn.dataset.rmId);
        state.idIndices = state.idIndices.filter((x) => x !== rm);
        state.isExample = false;
        refreshHeatmap();
      });
    });
    paTray.querySelectorAll('[data-rm-pa]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rm = Number(btn.dataset.rmPa);
        state.pathIndices = state.pathIndices.filter((x) => x !== rm);
        state.isExample = false;
        refreshHeatmap();
      });
    });
  }

  const setExportDisabled = (disabled) => {
    for (const sel of ['#hm-dl-tsv', '#hm-dl-svg', '#hm-dl-png']) {
      const btn = container.querySelector(sel);
      if (btn) btn.disabled = disabled;
    }
  };

  /* ---- Render Heatmap + Interactive Tooltip ---- */
  async function refreshHeatmap() {
    const seq = ++renderSeq;
    renderChipTrays();

    container.querySelector('#hm-load-example')?.classList.toggle('on-soft', state.isExample);
    container.querySelector('#hm-btn-vals')?.classList.toggle('on-soft', state.showValues);
    container.querySelector('#hm-btn-trans')?.classList.toggle('on-soft', state.transpose);
    container.querySelector('#hm-btn-full')?.classList.toggle('on-soft', state.fullLabels);
    container.querySelectorAll('#hm-size-seg button').forEach((b) =>
      b.classList.toggle('on', Number(b.dataset.sz) === state.cellSize)
    );

    const stage = container.querySelector('#hm-stage');
    const metaEl = container.querySelector('#hm-meta');
    const loadBar = container.querySelector('#hm-load-bar');
    const tipEl = container.querySelector('#hm-tip');
    if (tipEl) tipEl.hidden = true;

    if (!state.idIndices.length || !state.pathIndices.length) {
      loadBar.style.display = 'none';
      metaEl.innerHTML = '';
      lastMat = null;
      lastRendered = null;
      setExportDisabled(true);
      stage.innerHTML = '<div class="hm-empty">Select at least one NLR ID and one pathogen/pest protein above to render the heatmap.</div>';
      return;
    }

    const needed = getNeededSetsForSelection(meta);
    const missing = needed.filter((idx) => !store.sets.has(idx));
    if (missing.length > 0) {
      // Invalidate previous matrix & disable export buttons until fresh sets finish loading
      lastMat = null;
      lastRendered = null;
      setExportDisabled(true);
      loadBar.style.display = 'flex';
      loadBar.innerHTML = `<span>Loading ${missing.length} screening score table${missing.length > 1 ? 's' : ''}…</span><div class="prog-track"><div class="prog-fill" style="width:12%"></div></div>`;
      try {
        await store.loadSets(missing, (d, t, ds) => {
          if (gen !== activeGen || seq !== renderSeq) return;
          const pct = Math.round((d / t) * 100);
          loadBar.innerHTML = `<span>Loading score tables (${d}/${t}) · ${esc(ds.id)}…</span><div class="prog-track"><div class="prog-fill" style="width:${pct}%"></div></div>`;
        });
      } catch (err) {
        if (gen !== activeGen || seq !== renderSeq) return;
        loadBar.style.display = 'none';
        stage.innerHTML = `<div class="callout warn"><b>Failed to load score tables:</b> ${esc(err?.message || 'network error')}</div>`;
        return;
      }
    }
    if (gen !== activeGen || seq !== renderSeq) return;
    loadBar.style.display = 'none';

    const mat = buildMatrix(meta, needed);
    const rendered = renderHeatmapSvg(meta, mat, { forExport: false });
    lastMat = mat;
    lastRendered = rendered;
    setExportDisabled(false);

    const totalCells = mat.nRows * mat.nCols;
    const sizeWarn = mat.nRows > MAX_SOFT_AXIS || mat.nCols > MAX_SOFT_AXIS
      ? ' · <span style="color:var(--warn)">Large matrix — switch Cell size to S for overview</span>'
      : '';
    metaEl.innerHTML = `
      <div><b>${mat.nRows}</b> NLR IDs × <b>${mat.nCols}</b> pathogen/pest proteins (${fmtInt(totalCells)} cells · <b>${fmtInt(mat.nScored)}</b> scored${mat.nNotScreened ? ` · ${fmtInt(mat.nNotScreened)} not screened` : ''}${mat.nFailed ? ` · ${fmtInt(mat.nFailed)} failed` : ''})${sizeWarn}</div>
      <div>Hover any cell for full scores · click a cell to open Pair Detail</div>
    `;

    stage.innerHTML = rendered.svgStr;
    wireHeatmapHover(mat, rendered);
  }

  function wireHeatmapHover(mat, rendered) {
    const wrap = container.querySelector('#hm-stage-wrap');
    const svg = container.querySelector('#hm-stage svg.hm-svg');
    const tip = container.querySelector('#hm-tip');
    if (!svg || !tip || !wrap) return;

    const showCellTip = (el, clientX, clientY) => {
      const idIdx = Number(el.dataset.id);
      const paIdx = Number(el.dataset.pa);
      const idR = meta.ids[state.idIndices[idIdx]];
      const paR = meta.pathogens[state.pathIndices[paIdx]];
      const c = mat.grid[idIdx * mat.nCols + paIdx];

      let rowsHtml = '';
      if (!c) {
        rowsHtml = `
          <div class="ct-row"><span class="ct-k">Status</span><span class="ct-v">Not screened</span></div>
          <div class="ct-row"><span class="ct-k">Note</span><span class="ct-v">${paR.s === 'E2' ? 'E2 screened vs ID1 only' : `${idR.s} × ${paR.s} absent`}</span></div>
        `;
      } else if (c.status !== STATUS.SCORED) {
        const ds = meta.datasets[c.pair.setIdx];
        rowsHtml = `
          <div class="ct-row"><span class="ct-k">Status</span><span class="ct-v">${c.status === STATUS.FAILED ? 'ipSAE failed' : 'Missing scores'}</span></div>
          <div class="ct-row"><span class="ct-k">Dataset</span><span class="ct-v">${esc(ds.id)} #${c.pair.job_num}</span></div>
          <div class="ct-row ct-bold"><span class="ct-k">Action</span><span class="ct-v">Click to open pair &rarr;</span></div>
        `;
      } else {
        const p = c.pair;
        const ds = meta.datasets[p.setIdx];
        const mDef = rendered.metricDef;
        const activeValStr = mDef.decimals === 0 ? String(Math.round(c.value)) : c.value.toFixed(4);
        rowsHtml = `
          <div class="ct-row ct-bold"><span class="ct-k">${esc(mDef.short)}</span><span class="ct-v">${activeValStr}</span></div>
          ${mDef.key !== 'ipsae_min' ? `<div class="ct-row"><span class="ct-k">ipSAE (min)</span><span class="ct-v">${p.ipsae_min.toFixed(3)}</span></div>` : ''}
          ${mDef.key !== 'iptm' ? `<div class="ct-row"><span class="ct-k">ipTM</span><span class="ct-v">${p.iptm.toFixed(3)}</span></div>` : ''}
          ${mDef.key !== 'pdockq' ? `<div class="ct-row"><span class="ct-k">pDockQ</span><span class="ct-v">${p.pdockq.toFixed(3)}</span></div>` : ''}
          ${mDef.key !== 'lis_min' ? `<div class="ct-row"><span class="ct-k">LIS (min)</span><span class="ct-v">${p.lis_min.toFixed(3)}</span></div>` : ''}
          ${mDef.key !== 'contacts' ? `<div class="ct-row"><span class="ct-k">Contacts</span><span class="ct-v">${p.contacts}</span></div>` : ''}
          <div class="ct-row"><span class="ct-k">Set</span><span class="ct-v">${esc(ds.id)} · #${p.job_num}</span></div>
        `;
      }

      tip.innerHTML = `
        <div class="ct-title">
          <span class="dot" style="background:${ID_COLORS[idR.s]};margin-right:5px"></span>${esc(idR.ipr_s || idR.ipr)} <span class="muted">(${esc(abbrevSpecies(idR.sp))})</span><br/>
          <span class="dot" style="background:${ORG_COLORS[paR.org]};margin-right:5px"></span>${esc(paR.id)} <span class="muted">(${esc(abbrevSpecies(paR.sp))})</span>
        </div>
        ${rowsHtml}
      `;
      tip.hidden = false;

      const wrapRect = wrap.getBoundingClientRect();
      const tipW = tip.offsetWidth || 220;
      const tipH = tip.offsetHeight || 130;
      let left = clientX - wrapRect.left + 14;
      if (left + tipW > wrapRect.width - 8) left = clientX - wrapRect.left - tipW - 14;
      left = Math.max(8, Math.min(wrapRect.width - tipW - 8, left));
      let top = clientY - wrapRect.top - tipH - 12;
      if (top < 8) top = clientY - wrapRect.top + 16;
      top = Math.max(8, Math.min(wrapRect.height - tipH - 8, top));
      tip.style.left = `${left.toFixed(0)}px`;
      tip.style.top = `${top.toFixed(0)}px`;
    };

    svg.addEventListener('pointermove', (e) => {
      const cell = e.target.closest('.hm-cell');
      if (!cell) { tip.hidden = true; return; }
      showCellTip(cell, e.clientX, e.clientY);
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; });
    svg.addEventListener('click', (e) => {
      const cell = e.target.closest('.hm-cell.hm-clickable');
      if (!cell) return;
      const idIdx = Number(cell.dataset.id);
      const paIdx = Number(cell.dataset.pa);
      const c = mat.grid[idIdx * mat.nCols + paIdx];
      if (c && c.pair) navigateToPair(c.pair);
    });
  }

  /* ---- Wire Autocomplete Search Inputs ---- */
  function wireAutocomplete(inputSel, listSel, pool, selectedArrGetter, onAdd, renderOption) {
    const inp = container.querySelector(inputSel);
    const listEl = container.querySelector(listSel);
    if (!inp || !listEl) return;

    let currentMatches = [];
    const show = () => {
      const q = inp.value.trim().toLowerCase();
      if (q.length < 2) { listEl.hidden = true; return; }
      const chosen = new Set(selectedArrGetter());
      currentMatches = [];
      for (const r of pool) {
        if (chosen.has(r.i)) continue;
        if (r._q.includes(q)) {
          currentMatches.push(r);
          if (currentMatches.length >= 12) break;
        }
      }
      if (!currentMatches.length) {
        listEl.innerHTML = '<div class="hm-ac-item muted">No additional matches found</div>';
      } else {
        listEl.innerHTML = currentMatches
          .map((r, idx) => `<button type="button" class="hm-ac-item" data-ac-idx="${idx}">${renderOption(r)}</button>`)
          .join('');
        listEl.querySelectorAll('[data-ac-idx]').forEach((btn) => {
          btn.addEventListener('click', () => {
            onAdd(currentMatches[Number(btn.dataset.acIdx)].i);
            inp.value = '';
            listEl.hidden = true;
          });
        });
      }
      listEl.hidden = false;
    };

    inp.addEventListener('input', show);
    inp.addEventListener('focus', show);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && currentMatches.length) {
        e.preventDefault();
        onAdd(currentMatches[0].i);
        inp.value = '';
        listEl.hidden = true;
      } else if (e.key === 'Escape') {
        listEl.hidden = true;
      }
    });
    const onDocClick = (e) => {
      if (!listEl.isConnected) {
        document.removeEventListener('click', onDocClick);
        return;
      }
      if (!e.target.closest('.hm-ac-wrap')) listEl.hidden = true;
    };
    document.addEventListener('click', onDocClick);
  }

  wireAutocomplete(
    '#hm-id-search',
    '#hm-id-ac',
    screenedIds,
    () => state.idIndices,
    (idx) => {
      if (!state.idIndices.includes(idx)) state.idIndices.push(idx);
      state.isExample = false;
      refreshHeatmap();
    },
    (r) => `<span class="dot" style="background:${ID_COLORS[r.s]}"></span>
      <span class="hm-ac-main"><b>${esc(r.ipr_s || r.ipr)}</b> · <em>${esc(r.sp)}</em><small class="mono">${esc(r.id)}</small></span>
      <span class="mono muted">${esc(r.s)}</span>`
  );

  wireAutocomplete(
    '#hm-pa-search',
    '#hm-pa-ac',
    meta.pathogens,
    () => state.pathIndices,
    (idx) => {
      if (!state.pathIndices.includes(idx)) state.pathIndices.push(idx);
      state.isExample = false;
      refreshHeatmap();
    },
    (r) => `<span class="dot" style="background:${ORG_COLORS[r.org]}"></span>
      <span class="hm-ac-main"><b>${esc(r.id)}</b> · <em>${esc(r.sp)}</em><small>${esc(r.s)} · ${esc(r.cls || r.org)}</small></span>
      <span class="mono muted">${esc(r.s)}</span>`
  );

  /* ---- Wire Group Batch Add ---- */
  populateIdGroupValues();
  populatePathGroupValues();
  container.querySelector('#hm-id-grp-type')?.addEventListener('change', populateIdGroupValues);
  container.querySelector('#hm-pa-grp-type')?.addEventListener('change', populatePathGroupValues);

  container.querySelector('#hm-id-add-grp')?.addEventListener('click', () => {
    const t = container.querySelector('#hm-id-grp-type').value;
    const v = container.querySelector('#hm-id-grp-val').value;
    let matches = [];
    if (t === 'ipr') matches = (store.idsByInterpro.get(v) || []).filter((r) => r.scr);
    else if (t === 'cat') matches = screenedIds.filter((r) => r.cat === v);
    else if (t === 'ord') matches = screenedIds.filter((r) => r.ord === v);
    else if (t === 'sp') matches = screenedIds.filter((r) => r.sp === v);
    else matches = screenedIds.filter((r) => r.s === v);

    const existing = new Set(state.idIndices);
    const toAdd = matches
      .filter((r) => !existing.has(r.i))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, 25);
    for (const r of toAdd) state.idIndices.push(r.i);
    state.isExample = false;
    refreshHeatmap();
  });

  container.querySelector('#hm-pa-add-grp')?.addEventListener('click', () => {
    const t = container.querySelector('#hm-pa-grp-type').value;
    const v = container.querySelector('#hm-pa-grp-val').value;
    let matches = [];
    if (t === 'sp') matches = meta.pathogens.filter((r) => r.sp === v);
    else if (t === 'org') matches = meta.pathogens.filter((r) => r.org === v);
    else if (t === 'panel') matches = meta.pathogens.filter((r) => r.s === v);
    else matches = meta.pathogens.filter((r) => r.cls === v);

    const existing = new Set(state.pathIndices);
    const toAdd = matches
      .filter((r) => !existing.has(r.i))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, 40);
    for (const r of toAdd) state.pathIndices.push(r.i);
    state.isExample = false;
    refreshHeatmap();
  });

  /* ---- Wire Paste Lists ---- */
  container.querySelector('#hm-id-paste-toggle')?.addEventListener('click', () => {
    const box = container.querySelector('#hm-id-paste-box');
    box.hidden = !box.hidden;
    if (!box.hidden) container.querySelector('#hm-id-paste-ta')?.focus();
  });
  container.querySelector('#hm-id-paste-apply')?.addEventListener('click', () => {
    const raw = container.querySelector('#hm-id-paste-ta').value;
    const tokens = raw.split(/[\n,;\t]+/).map((s) => s.trim()).filter(Boolean);
    const existing = new Set(state.idIndices);
    let added = 0;
    let missed = 0;
    for (const tok of tokens) {
      const exact = store.idByName.get(tok);
      if (exact && exact.scr) {
        if (!existing.has(exact.i)) { state.idIndices.push(exact.i); existing.add(exact.i); added++; }
      } else {
        const low = tok.toLowerCase();
        const partials = screenedIds.filter((r) => r.id.toLowerCase() === low || r.pnlr.toLowerCase() === low || (r.acc && r.acc.toLowerCase() === low) || r.af3.toLowerCase() === low);
        if (partials.length) {
          for (const p of partials) {
            if (!existing.has(p.i)) { state.idIndices.push(p.i); existing.add(p.i); added++; }
          }
        } else missed++;
      }
    }
    container.querySelector('#hm-id-paste-msg').textContent = `Added ${added}${missed ? ` · ${missed} unmatched` : ''}`;
    state.isExample = false;
    refreshHeatmap();
  });

  container.querySelector('#hm-pa-paste-toggle')?.addEventListener('click', () => {
    const box = container.querySelector('#hm-pa-paste-box');
    box.hidden = !box.hidden;
    if (!box.hidden) container.querySelector('#hm-pa-paste-ta')?.focus();
  });
  container.querySelector('#hm-pa-paste-apply')?.addEventListener('click', () => {
    const raw = container.querySelector('#hm-pa-paste-ta').value;
    const tokens = raw.split(/[\n,;\t]+/).map((s) => s.trim()).filter(Boolean);
    const existing = new Set(state.pathIndices);
    let added = 0;
    let missed = 0;
    for (const tok of tokens) {
      const exact = store.pathByName.get(tok);
      if (exact) {
        if (!existing.has(exact.i)) { state.pathIndices.push(exact.i); existing.add(exact.i); added++; }
      } else {
        const low = tok.toLowerCase();
        const partials = meta.pathogens.filter((r) => r.id.toLowerCase() === low || (r.acc && r.acc.toLowerCase() === low) || r.af3.toLowerCase() === low);
        if (partials.length) {
          for (const p of partials) {
            if (!existing.has(p.i)) { state.pathIndices.push(p.i); existing.add(p.i); added++; }
          }
        } else missed++;
      }
    }
    container.querySelector('#hm-pa-paste-msg').textContent = `Added ${added}${missed ? ` · ${missed} unmatched` : ''}`;
    state.isExample = false;
    refreshHeatmap();
  });

  /* ---- Clear & Example ---- */
  container.querySelector('#hm-id-clear')?.addEventListener('click', () => {
    state.idIndices = [];
    state.isExample = false;
    state.focusBanner = '';
    container.querySelector('#hm-focus-banner')?.remove();
    refreshHeatmap();
  });
  container.querySelector('#hm-pa-clear')?.addEventListener('click', () => {
    state.pathIndices = [];
    state.isExample = false;
    state.focusBanner = '';
    container.querySelector('#hm-focus-banner')?.remove();
    refreshHeatmap();
  });
  container.querySelector('#hm-clear-all')?.addEventListener('click', () => {
    state.idIndices = [];
    state.pathIndices = [];
    state.isExample = false;
    state.focusBanner = '';
    container.querySelector('#hm-focus-banner')?.remove();
    refreshHeatmap();
  });
  container.querySelector('#hm-load-example')?.addEventListener('click', () => {
    applyExampleMatrix(meta);
    state.order = 'group';
    const ordSel = container.querySelector('#hm-order');
    if (ordSel) ordSel.value = 'group';
    container.querySelector('#hm-focus-banner')?.remove();
    refreshHeatmap();
  });
  container.querySelector('#hm-toggle-builder')?.addEventListener('click', (e) => {
    state.hideBuilder = !state.hideBuilder;
    container.querySelector('#hm-builder').hidden = state.hideBuilder;
    e.currentTarget.textContent = state.hideBuilder ? 'Show selectors' : 'Hide selectors';
  });

  /* ---- Visualization Controls ---- */
  container.querySelector('#hm-metric')?.addEventListener('change', (e) => { state.metric = e.target.value; refreshHeatmap(); });
  container.querySelector('#hm-order')?.addEventListener('change', (e) => { state.order = e.target.value; refreshHeatmap(); });
  container.querySelector('#hm-palette')?.addEventListener('change', (e) => { state.palette = e.target.value; refreshHeatmap(); });
  container.querySelectorAll('#hm-size-seg button').forEach((btn) => {
    btn.addEventListener('click', () => { state.cellSize = Number(btn.dataset.sz); refreshHeatmap(); });
  });
  container.querySelector('#hm-btn-vals')?.addEventListener('click', () => { state.showValues = !state.showValues; refreshHeatmap(); });
  container.querySelector('#hm-btn-trans')?.addEventListener('click', () => { state.transpose = !state.transpose; refreshHeatmap(); });
  container.querySelector('#hm-btn-full')?.addEventListener('click', () => { state.fullLabels = !state.fullLabels; refreshHeatmap(); });

  /* ---- Share Link & Exports ---- */
  container.querySelector('#hm-copy-link')?.addEventListener('click', (e) => {
    const sp = new URLSearchParams();
    sp.set('ids', state.idIndices.map((i) => meta.ids[i].id).join(','));
    sp.set('paths', state.pathIndices.map((i) => meta.pathogens[i].id).join(','));
    sp.set('metric', state.metric);
    sp.set('order', state.order);
    sp.set('palette', state.palette);
    if (state.transpose) sp.set('transpose', '1');
    const url = `${window.location.origin}${window.location.pathname}#/heatmap?${sp.toString()}`;
    copyToClipboard(url, e.currentTarget);
  });

  container.querySelector('#hm-dl-tsv')?.addEventListener('click', () => {
    if (lastMat && lastRendered) exportHeatmapTsv(meta, lastMat, lastRendered);
  });
  container.querySelector('#hm-dl-svg')?.addEventListener('click', () => {
    if (!lastMat) return;
    const exp = renderHeatmapSvg(meta, lastMat, { forExport: true });
    triggerDownload(`bifrost_heatmap_${state.metric}.svg`, exp.svgStr, 'image/svg+xml');
  });
  container.querySelector('#hm-dl-png')?.addEventListener('click', () => {
    if (!lastMat) return;
    const exp = renderHeatmapSvg(meta, lastMat, { forExport: true });
    exportHeatmapPng(exp.svgStr, exp.width, exp.height, `bifrost_heatmap_${state.metric}.png`);
  });

  // Re-render cleanly when dark/light theme toggles
  const themeBtn = document.getElementById('btn-theme');
  const onThemeToggle = () => {
    if (gen !== activeGen) {
      themeBtn?.removeEventListener('click', onThemeToggle);
      return;
    }
    setTimeout(() => { if (gen === activeGen && lastMat) refreshHeatmap(); }, 30);
  };
  themeBtn?.addEventListener('click', onThemeToggle);

  await refreshHeatmap();
}
