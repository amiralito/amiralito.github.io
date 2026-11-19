/**
 * Bifrost Wiki — Full 757,597-Pair Score Explorer
 *
 * Calm 1-row primary toolbar (search + organism & threshold chips) with a
 * collapsible advanced-filters drawer so the score table sits immediately
 * above the fold.
 */

import { store, SCORE_SCALE, STATUS } from './data.js';
import { renderSimpleHistogramSvg, ORG_COLORS } from './charts.js';
import {
  esc,
  fmtInt,
  panelBadge,
  scoreCellHtml,
  navigateToPair,
  syncFacetedSelects,
} from './ui.js';
import { exportPairsTable } from './export.js';

const PAGE_SIZE = 50;
const MAX_EXPORT_ROWS = 50000;

const state = {
  set: '',
  idPanel: '',
  pathPanel: '',
  org: '',
  category: '',
  interpro: '',
  plantOrder: '',
  nlrClass: '',
  pathSpecies: '',
  protClass: '',
  status: 'scored',
  text: '',
  minIpsae: 0.3,
  maxIpsae: 1.0,
  minIptm: 0.0,
  minPdockq: 0.0,
  minLis: 0.0,
  minContacts: 0,
  sortBy: 'ipsae_min',
  sortDir: 'desc',
  showSubscores: false,
  showAdvanced: false,
  showChart: false,
  page: 1,
};

let activeGeneration = 0;

function applyQueryParams(params) {
  if (!params || ![...params.keys()].length) return;
  state.set = params.get('set') || '';
  state.idPanel = params.get('idPanel') || '';
  state.pathPanel = params.get('pathPanel') || '';
  state.org = params.get('org') || '';
  state.category = params.get('category') || '';
  state.interpro = params.get('ipr') || '';
  state.plantOrder = params.get('order') || '';
  state.nlrClass = params.get('nlrClass') || '';
  state.pathSpecies = params.get('pathSpecies') || '';
  state.protClass = params.get('protClass') || '';
  state.status = params.get('status') || 'scored';
  state.text = params.get('q') || '';
  state.minIpsae = params.has('ipsae')
    ? Number(params.get('ipsae'))
    : (state.set || state.interpro || state.category ? 0 : 0.3);
  state.maxIpsae = params.has('maxIpsae') ? Number(params.get('maxIpsae')) : 1.0;
  state.minIptm = params.has('iptm') ? Number(params.get('iptm')) : 0;
  state.minPdockq = params.has('pdockq') ? Number(params.get('pdockq')) : 0;
  state.minLis = params.has('lis') ? Number(params.get('lis')) : 0;
  state.minContacts = params.has('contacts') ? Number(params.get('contacts')) : 0;
  // Auto-open advanced drawer only if an advanced filter was explicitly passed
  state.showAdvanced = Boolean(
    state.set || state.idPanel || state.pathPanel || state.category || state.interpro ||
    state.plantOrder || state.nlrClass || state.pathSpecies || state.protClass ||
    state.minIptm > 0 || state.minPdockq > 0 || state.minLis > 0 || state.minContacts > 0 ||
    state.status !== 'scored'
  );
  state.page = 1;
}

function countAdvancedFilters() {
  let c = 0;
  if (state.set) c++;
  if (state.idPanel) c++;
  if (state.pathPanel) c++;
  if (state.category) c++;
  if (state.interpro.trim()) c++;
  if (state.plantOrder) c++;
  if (state.nlrClass) c++;
  if (state.pathSpecies) c++;
  if (state.protClass) c++;
  if (state.status !== 'scored') c++;
  if (state.minIptm > 0) c++;
  if (state.minPdockq > 0) c++;
  if (state.minLis > 0) c++;
  if (state.minContacts > 0) c++;
  if (state.maxIpsae < 1) c++;
  return c;
}

function getNeededSetIndices(meta) {
  const out = [];
  for (const ds of meta.datasets) {
    if (state.set && ds.id !== state.set) continue;
    if (state.idPanel && ds.id_panel !== state.idPanel) continue;
    if (state.pathPanel && ds.path_panel !== state.pathPanel) continue;
    out.push(ds.idx);
  }
  return out;
}

function buildMetadataMasks(meta) {
  const { ids, pathogens } = meta;
  const q = state.text.trim().toLowerCase();
  const iprFilter = state.interpro.trim().toUpperCase();

  const idMask = new Uint8Array(ids.length);
  const idTextHit = new Uint8Array(ids.length);
  for (let i = 0; i < ids.length; i++) {
    const r = ids[i];
    if (!r.scr) continue;
    if (state.idPanel && r.s !== state.idPanel) continue;
    if (state.category && r.cat !== state.category) continue;
    if (state.plantOrder && r.ord !== state.plantOrder) continue;
    if (state.nlrClass && r.cls !== state.nlrClass) continue;
    if (iprFilter && !(r.iprs || r.ipr || '').toUpperCase().includes(iprFilter)) continue;
    idMask[i] = 1;
    if (!q || r._q.includes(q)) idTextHit[i] = 1;
  }

  const pathMask = new Uint8Array(pathogens.length);
  const pathTextHit = new Uint8Array(pathogens.length);
  for (let i = 0; i < pathogens.length; i++) {
    const r = pathogens[i];
    if (state.pathPanel && r.s !== state.pathPanel) continue;
    if (state.org && r.org !== state.org) continue;
    if (state.pathSpecies && r.sp !== state.pathSpecies) continue;
    if (state.protClass && r.cls !== state.protClass) continue;
    pathMask[i] = 1;
    if (!q || r._q.includes(q)) pathTextHit[i] = 1;
  }

  return { idMask, idTextHit, pathMask, pathTextHit, hasQuery: Boolean(q) };
}

function canServeFromTopHits(meta) {
  return state.status === 'scored' && state.minIpsae >= meta.top_hit_threshold && store.topHits !== null;
}

function executeQuery(meta) {
  const neededSets = getNeededSetIndices(meta);
  const loadedSets = neededSets.filter((idx) => store.sets.has(idx));
  const allNeededLoaded = loadedSets.length === neededSets.length;

  const { idMask, idTextHit, pathMask, pathTextHit, hasQuery } = buildMetadataMasks(meta);
  const minIpsaeU = Math.round(state.minIpsae * SCORE_SCALE);
  const maxIpsaeU = Math.round(state.maxIpsae * SCORE_SCALE);
  const minIptmU = Math.round(state.minIptm * SCORE_SCALE);
  const minPdqU = Math.round(state.minPdockq * SCORE_SCALE);
  const minLisU = Math.round(state.minLis * SCORE_SCALE);
  const minCont = Math.max(0, Math.round(state.minContacts));
  const statusMode = state.status;

  if (!allNeededLoaded && canServeFromTopHits(meta)) {
    const allowedSet = new Set(neededSets);
    const rows = store.topHits.rows;
    const matched = [];
    const histVals = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!allowedSet.has(r[0])) continue;
      if (!idMask[r[2]] || !pathMask[r[3]]) continue;
      if (hasQuery && !idTextHit[r[2]] && !pathTextHit[r[3]]) continue;
      if (r[4] < minIpsaeU || r[4] > maxIpsaeU) continue;
      if (r[12] < minIptmU) continue;
      if (r[14] < minPdqU) continue;
      if (r[17] < minLisU) continue;
      if (r[19] + r[20] < minCont) continue;
      matched.push(r);
      histVals.push(r[4] / SCORE_SCALE);
    }

    const colMap = {
      ipsae_min: (r) => r[4],
      ipsae_max: (r) => r[5],
      ipsae_mean: (r) => (r[6] + r[7]) / 2,
      ipsae_a: (r) => r[6],
      ipsae_b: (r) => r[7],
      d0dom_min: (r) => r[8],
      d0chn_min: (r) => r[10],
      iptm: (r) => r[12],
      pdockq: (r) => r[14],
      pdockq2_min: (r) => r[15],
      lis_min: (r) => r[17],
      contacts: (r) => r[19] + r[20],
      job_num: (r) => r[1],
    };
    const getter = colMap[state.sortBy] || colMap.ipsae_min;
    const dir = state.sortDir === 'asc' ? 1 : -1;
    if (state.sortBy !== 'ipsae_min' || state.sortDir !== 'desc') {
      matched.sort((a, b) => (getter(a) - getter(b)) * dir);
    }

    return {
      source: 'top_hits',
      total: matched.length,
      scoredCount: matched.length,
      failedCount: 0,
      missingCount: 0,
      histVals,
      getPage: (page, size) => matched.slice((page - 1) * size, page * size).map((r) => store.topHitRowToObject(r)),
      getSlice: (limit) => matched.slice(0, limit).map((r) => store.topHitRowToObject(r)),
    };
  }

  const perSetMatches = [];
  let total = 0;
  let scoredCount = 0;
  let failedCount = 0;
  let missingCount = 0;
  const histVals = [];

  for (const sIdx of loadedSets) {
    const sBin = store.sets.get(sIdx);
    const n = sBin.n;
    const idArr = sBin.id_idx;
    const paArr = sBin.path_idx;
    const stArr = sBin.status;
    const ipsaeArr = sBin.ipsae_min;
    const iptmArr = sBin.iptm;
    const pdqArr = sBin.pdockq;
    const lisArr = sBin.lis_min;
    const d1Arr = sBin.dist1;
    const d2Arr = sBin.dist2;

    const list = [];
    for (let r = 0; r < n; r++) {
      const st = stArr[r];
      if (statusMode === 'scored' && st !== STATUS.SCORED) continue;
      if (statusMode === 'failed' && st !== STATUS.FAILED) continue;
      if (statusMode === 'missing' && st !== STATUS.MISSING) continue;

      const idI = idArr[r];
      if (!idMask[idI]) continue;
      const paI = paArr[r];
      if (!pathMask[paI]) continue;
      if (hasQuery && !idTextHit[idI] && !pathTextHit[paI]) continue;

      if (st === STATUS.SCORED) {
        const vIpsae = ipsaeArr[r];
        if (vIpsae < minIpsaeU || vIpsae > maxIpsaeU) continue;
        if (minIptmU > 0 && iptmArr[r] < minIptmU) continue;
        if (minPdqU > 0 && pdqArr[r] < minPdqU) continue;
        if (minLisU > 0 && lisArr[r] < minLisU) continue;
        if (minCont > 0 && d1Arr[r] + d2Arr[r] < minCont) continue;
        scoredCount++;
        histVals.push(vIpsae / SCORE_SCALE);
      } else if (st === STATUS.FAILED) failedCount++;
      else missingCount++;

      list.push(r);
    }

    if (list.length > 0) {
      perSetMatches.push({ sIdx, sBin, list });
      total += list.length;
    }
  }

  const encoded = new Int32Array(total);
  if (state.sortBy === 'ipsae_min' && state.sortDir === 'desc') {
    const k = perSetMatches.length;
    if (k === 1) {
      const { sIdx, list } = perSetMatches[0];
      const prefix = sIdx << 24;
      for (let i = 0; i < list.length; i++) encoded[i] = prefix | list[i];
    } else if (k > 1) {
      const ptr = new Int32Array(k);
      for (let outI = 0; outI < total; outI++) {
        let bestK = -1;
        let bestSt = 99;
        let bestIpsae = -1;
        let bestIptm = -1;
        for (let m = 0; m < k; m++) {
          const p = ptr[m];
          const group = perSetMatches[m];
          if (p >= group.list.length) continue;
          const r = group.list[p];
          const st = group.sBin.status[r];
          const vI = st === 0 ? group.sBin.ipsae_min[r] : -1;
          const vT = st === 0 ? group.sBin.iptm[r] : -1;
          if (bestK === -1 || st < bestSt || (st === bestSt && (vI > bestIpsae || (vI === bestIpsae && vT > bestIptm)))) {
            bestK = m;
            bestSt = st;
            bestIpsae = vI;
            bestIptm = vT;
          }
        }
        const g = perSetMatches[bestK];
        encoded[outI] = (g.sIdx << 24) | g.list[ptr[bestK]++];
      }
    }
  } else {
    const keys = new Float32Array(total);
    let pos = 0;
    const sb = state.sortBy;
    for (const { sIdx, sBin, list } of perSetMatches) {
      const prefix = sIdx << 24;
      const stArr = sBin.status;
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        encoded[pos] = prefix | r;
        const ok = stArr[r] === STATUS.SCORED;
        let val = -1;
        if (sb === 'job_num') val = sBin.job_num[r];
        else if (ok) {
          if (sb === 'contacts') val = sBin.dist1[r] + sBin.dist2[r];
          else if (sb === 'ipsae_mean') val = (sBin.ipsae_a[r] + sBin.ipsae_b[r]) * 0.5;
          else if (sBin[sb]) val = sBin[sb][r];
          else val = sBin.ipsae_min[r];
        }
        keys[pos] = val;
        pos++;
      }
    }
    const order = new Int32Array(total);
    for (let i = 0; i < total; i++) order[i] = i;
    const dir = state.sortDir === 'asc' ? 1 : -1;
    order.sort((a, b) => (keys[a] - keys[b]) * dir);
    const sorted = new Int32Array(total);
    for (let i = 0; i < total; i++) sorted[i] = encoded[order[i]];
    encoded.set(sorted);
  }

  const materializeRange = (start, count) => {
    const end = Math.min(total, start + count);
    const out = [];
    for (let i = start; i < end; i++) {
      const code = encoded[i];
      out.push(store.rowToObject(store.sets.get(code >>> 24), code & 0xffffff));
    }
    return out;
  };

  return {
    source: allNeededLoaded ? 'full' : 'partial',
    total,
    scoredCount,
    failedCount,
    missingCount,
    histVals,
    getPage: (page, size) => materializeRange((page - 1) * size, size),
    getSlice: (limit) => materializeRange(0, limit),
  };
}

export async function renderExplorerView(container, queryParams) {
  const gen = ++activeGeneration;
  const meta = store.meta;
  applyQueryParams(queryParams);
  await store.loadTopHits();
  if (gen !== activeGeneration) return;

  const categories = [...new Set(meta.ids.filter((r) => r.scr && r.cat).map((r) => r.cat))].sort();
  const plantOrders = [...new Set(meta.ids.filter((r) => r.scr && r.ord).map((r) => r.ord))].sort();
  const nlrClasses = [...new Set(meta.ids.filter((r) => r.scr && r.cls).map((r) => r.cls))].sort();
  const pathSpecies = [...new Set(meta.pathogens.map((r) => r.sp))].sort();
  const protClasses = [...new Set(meta.pathogens.map((r) => r.cls).filter(Boolean))].sort();
  const opt = (val, label, cur) => `<option value="${esc(val)}"${cur === val ? ' selected' : ''}>${esc(label)}</option>`;

  container.innerHTML = `
    <div class="eyebrow">Score Explorer · All 13 screening sets</div>
    <div class="page-head-row">
      <div>
        <h1>All ${fmtInt(meta.summary.total_predictions)} predictions</h1>
        <p class="lede" style="margin-bottom:14px">Filter by pathogen group, InterPro domain, taxonomy, or interface score. Click any row for full subscores and Dataverse model retrieval.</p>
      </div>
      <div class="btn-group">
        <button type="button" class="btn btn-sm" id="exp-reset">Reset</button>
        <button type="button" class="btn btn-sm btn-primary" id="exp-export-tsv">Export TSV</button>
        <button type="button" class="btn btn-sm" id="exp-export-csv">CSV</button>
      </div>
    </div>

    <div id="exp-load-bar" class="load-bar" style="display:none"></div>

    <!-- Clean 1-row primary filter bar -->
    <div class="tools">
      <input type="search" id="f-text" placeholder="Filter by protein, species, InterPro…" value="${esc(state.text)}" />

      <button type="button" class="chip${state.org === '' ? ' on' : ''}" data-org="">All</button>
      ${['Oomycete', 'Nematode', 'Insect', 'Virus']
        .map(
          (o) =>
            `<button type="button" class="chip${state.org === o ? ' on' : ''}" data-org="${o}"><span class="dot" style="background:${ORG_COLORS[o]}"></span>${o}</button>`
        )
        .join('')}

      <button type="button" class="chip${state.minIpsae === 0.6 ? ' on-soft' : ''}" data-preset="0.6">≥ 0.6</button>
      <button type="button" class="chip${state.minIpsae === 0.5 ? ' on-soft' : ''}" data-preset="0.5">≥ 0.5</button>
      <button type="button" class="chip${state.minIpsae === 0.3 ? ' on-soft' : ''}" data-preset="0.3">≥ 0.3</button>
      <button type="button" class="chip${state.minIpsae === 0 ? ' on-soft' : ''}" data-preset="0">All scores</button>

      <button type="button" class="chip${state.showAdvanced ? ' on-soft' : ''}" id="btn-adv">Filters <span id="adv-badge"></span></button>
      <button type="button" class="chip${state.showSubscores ? ' on-soft' : ''}" id="btn-sub">Subscores</button>
      <button type="button" class="chip${state.showChart ? ' on-soft' : ''}" id="btn-chart">Histogram</button>
    </div>

    <!-- Collapsible Advanced Filters Drawer -->
    <div class="adv-drawer" id="adv-drawer" ${state.showAdvanced ? '' : 'hidden'}>
      <div class="adv-grid">
        <div class="field">
          <label for="f-set">Screening Set</label>
          <select id="f-set">${opt('', 'All 13 sets', state.set)}${meta.datasets.map((d) => opt(d.id, `${d.id} (${fmtInt(d.n_total)})`, state.set)).join('')}</select>
        </div>
        <div class="field">
          <label for="f-idpanel">ID Panel</label>
          <select id="f-idpanel">${opt('', 'All ID1–ID3', state.idPanel)}${['ID1', 'ID2', 'ID3'].map((p) => opt(p, `${p} · ${meta.panels[p].short}`, state.idPanel)).join('')}</select>
        </div>
        <div class="field">
          <label for="f-pathpanel">Pathogen Panel</label>
          <select id="f-pathpanel">${opt('', 'All E1–E4, V1', state.pathPanel)}${['E1', 'E2', 'E3', 'E4', 'V1'].map((p) => opt(p, `${p} · ${meta.panels[p].short}`, state.pathPanel)).join('')}</select>
        </div>
        <div class="field">
          <label for="f-cat">InterPro Category</label>
          <select id="f-cat">${opt('', 'All 87 categories', state.category)}${categories.map((c) => opt(c, c, state.category)).join('')}</select>
        </div>
        <div class="field">
          <label for="f-ipr">InterPro Accession</label>
          <input type="text" id="f-ipr" placeholder="e.g. IPR006121" value="${esc(state.interpro)}" />
        </div>
        <div class="field">
          <label for="f-order">Plant Order</label>
          <select id="f-order">${opt('', 'All orders', state.plantOrder)}${plantOrders.map((o) => opt(o, o, state.plantOrder)).join('')}</select>
        </div>
        <div class="field">
          <label for="f-nlrcls">Parent NLR Class</label>
          <select id="f-nlrcls">${opt('', 'All classes', state.nlrClass)}${nlrClasses.map((c) => opt(c, c, state.nlrClass)).join('')}</select>
        </div>
        <div class="field">
          <label for="f-pathsp">Pathogen / Virus</label>
          <select id="f-pathsp">${opt('', 'All 20 species', state.pathSpecies)}${pathSpecies.map((s) => opt(s, s, state.pathSpecies)).join('')}</select>
        </div>
        <div class="field">
          <label for="f-protcls">Protein Class</label>
          <select id="f-protcls">${opt('', 'All classes', state.protClass)}${protClasses.map((c) => opt(c, c, state.protClass)).join('')}</select>
        </div>
        <div class="field">
          <label for="f-ipsae">Min ipSAE (min)</label>
          <input type="number" id="f-ipsae" min="0" max="1" step="0.05" value="${state.minIpsae}" />
        </div>
        <div class="field">
          <label for="f-maxipsae">Max ipSAE (min)</label>
          <input type="number" id="f-maxipsae" min="0" max="1" step="0.05" value="${state.maxIpsae}" />
        </div>
        <div class="field">
          <label for="f-iptm">Min ipTM</label>
          <input type="number" id="f-iptm" min="0" max="1" step="0.05" value="${state.minIptm}" />
        </div>
        <div class="field">
          <label for="f-pdockq">Min pDockQ</label>
          <input type="number" id="f-pdockq" min="0" max="1" step="0.05" value="${state.minPdockq}" />
        </div>
        <div class="field">
          <label for="f-lis">Min LIS</label>
          <input type="number" id="f-lis" min="0" max="1" step="0.05" value="${state.minLis}" />
        </div>
        <div class="field">
          <label for="f-contacts">Min Contacts</label>
          <input type="number" id="f-contacts" min="0" max="500" step="5" value="${state.minContacts}" />
        </div>
        <div class="field">
          <label for="f-status">Status</label>
          <select id="f-status">
            ${opt('scored', 'Scored only', state.status)}
            ${opt('all', 'All (incl. failed/missing)', state.status)}
            ${opt('failed', 'ipSAE failed only', state.status)}
            ${opt('missing', 'Missing scores only', state.status)}
          </select>
        </div>
      </div>
    </div>

    <div class="chart-box" id="exp-chart-box" ${state.showChart ? '' : 'hidden'}></div>

    <div class="table-meta" id="exp-meta"></div>
    <div class="tblwrap" id="exp-table"></div>
    <div class="pagination" id="exp-pag"></div>
  `;

  let lastResult = null;

  // Cross-sync all Explorer dropdowns (Chain A facets, Chain B facets, and Screening Set)
  function syncExplorerFacets(changedKey = null) {
    const dsRec = state.set ? meta.datasets.find((d) => d.id === state.set) : null;
    if (changedKey === 'set' && dsRec) {
      if (state.idPanel && state.idPanel !== dsRec.id_panel) state.idPanel = '';
      if (state.pathPanel && state.pathPanel !== dsRec.path_panel) state.pathPanel = '';
      const orgsInSet = new Set(meta.pathogens.filter((r) => r.s === dsRec.path_panel).map((r) => r.org));
      if (state.org && !orgsInSet.has(state.org)) state.org = '';
    }

    // Determine whether Chain B filters require E2 only (which was screened against ID1 only)
    const activePathRecsPre = meta.pathogens.filter(
      (r) =>
        (!dsRec || r.s === dsRec.path_panel) &&
        (!state.org || r.org === state.org) &&
        (!state.pathPanel || r.s === state.pathPanel) &&
        (!state.pathSpecies || r.sp === state.pathSpecies) &&
        (!state.protClass || r.cls === state.protClass)
    );
    const activePathPanelsPre = new Set(activePathRecsPre.map((r) => r.s));
    const requireId1Only = activePathPanelsPre.size === 1 && activePathPanelsPre.has('E2');

    // Chain A pool (screened IDs matching set's id_panel, or ID1-only if E2/Insect is selected)
    const idPool = meta.ids.filter(
      (r) => r.scr && (!dsRec || r.s === dsRec.id_panel) && (!requireId1Only || r.s === 'ID1')
    );
    const idSpecs = [
      { sel: '#f-idpanel', key: 'idPanel', getter: (r) => r.s, order: ['ID1', 'ID2', 'ID3'], allLabel: 'All ID1–ID3', formatOpt: (v, n) => `${v} · ${meta.panels[v].short} (${n})` },
      { sel: '#f-cat', key: 'category', getter: (r) => r.cat, allLabel: (k) => `All categories (${k})` },
      { sel: '#f-order', key: 'plantOrder', getter: (r) => r.ord, allLabel: (k) => `All orders (${k})` },
      { sel: '#f-nlrcls', key: 'nlrClass', getter: (r) => r.cls, allLabel: (k) => `All classes (${k})` },
    ];
    syncFacetedSelects(idPool, idSpecs, state, container, changedKey);

    // Check which ID panels remain valid after Chain A filters
    const activeIdPanels = new Set(
      idPool
        .filter(
          (r) =>
            (!state.idPanel || r.s === state.idPanel) &&
            (!state.category || r.cat === state.category) &&
            (!state.plantOrder || r.ord === state.plantOrder) &&
            (!state.nlrClass || r.cls === state.nlrClass)
        )
        .map((r) => r.s)
    );
    const disallowE2 = activeIdPanels.size > 0 && !activeIdPanels.has('ID1');
    if (disallowE2 && state.org === 'Insect') state.org = '';

    // Chain B pool (respecting set's path_panel, org chip, and E2=ID1-only constraint)
    const pathPool = meta.pathogens.filter(
      (r) => (!dsRec || r.s === dsRec.path_panel) && !(disallowE2 && r.s === 'E2')
    );
    const pathPoolWithOrg = state.org ? pathPool.filter((r) => r.org === state.org) : pathPool;
    const pathSpecs = [
      { sel: '#f-pathpanel', key: 'pathPanel', getter: (r) => r.s, order: ['E1', 'E2', 'E3', 'E4', 'V1'], allLabel: 'All E1–E4, V1', formatOpt: (v, n) => `${v} · ${meta.panels[v].short} (${n})` },
      { sel: '#f-pathsp', key: 'pathSpecies', getter: (r) => r.sp, allLabel: (k) => `All species (${k})` },
      { sel: '#f-protcls', key: 'protClass', getter: (r) => r.cls, allLabel: (k) => `All classes (${k})` },
    ];
    syncFacetedSelects(pathPoolWithOrg, pathSpecs, state, container, changedKey);

    // Sync Screening Set dropdown using all filters EXCEPT state.set itself (so users can switch sets smoothly)
    const validIdPanelsForSet = new Set(
      meta.ids
        .filter(
          (r) =>
            r.scr &&
            (!state.idPanel || r.s === state.idPanel) &&
            (!state.category || r.cat === state.category) &&
            (!state.plantOrder || r.ord === state.plantOrder) &&
            (!state.nlrClass || r.cls === state.nlrClass)
        )
        .map((r) => r.s)
    );
    const validPathPanelsForSet = new Set(
      meta.pathogens
        .filter(
          (r) =>
            (!state.org || r.org === state.org) &&
            (!state.pathPanel || r.s === state.pathPanel) &&
            (!state.pathSpecies || r.sp === state.pathSpecies) &&
            (!state.protClass || r.cls === state.protClass)
        )
        .map((r) => r.s)
    );
    const validSets = meta.datasets.filter(
      (d) => validIdPanelsForSet.has(d.id_panel) && validPathPanelsForSet.has(d.path_panel)
    );
    if (state.set && !validSets.some((d) => d.id === state.set)) state.set = '';
    const setSel = container.querySelector('#f-set');
    if (setSel) {
      setSel.innerHTML =
        `<option value="">All sets (${validSets.length})</option>` +
        validSets.map((d) => `<option value="${esc(d.id)}"${d.id === state.set ? ' selected' : ''}>${esc(d.id)} (${fmtInt(d.n_total)})</option>`).join('');
      setSel.value = state.set;
    }
  }

  function syncChipStates() {
    container.querySelectorAll('[data-org]').forEach((b) => b.classList.toggle('on', b.dataset.org === state.org));
    container.querySelectorAll('[data-preset]').forEach((b) => b.classList.toggle('on-soft', Number(b.dataset.preset) === state.minIpsae && state.maxIpsae === 1));
    const nAdv = countAdvancedFilters();
    const badge = container.querySelector('#adv-badge');
    if (badge) badge.textContent = nAdv ? `(${nAdv})` : '';
    container.querySelector('#btn-adv')?.classList.toggle('on-soft', state.showAdvanced || nAdv > 0);
    container.querySelector('#btn-sub')?.classList.toggle('on-soft', state.showSubscores);
    container.querySelector('#btn-chart')?.classList.toggle('on-soft', state.showChart);
  }

  function renderTable() {
    if (gen !== activeGeneration) return;
    syncChipStates();

    const res = executeQuery(meta);
    lastResult = res;

    const totalPages = Math.max(1, Math.ceil(res.total / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    const pageRows = res.getPage(state.page, PAGE_SIZE);

    if (state.showChart) {
      const cb = container.querySelector('#exp-chart-box');
      cb.hidden = false;
      cb.innerHTML = res.histVals.length
        ? renderSimpleHistogramSvg(res.histVals, { metricLabel: 'Filtered ipSAE (min)', height: 150 })
        : '<div class="muted" style="text-align:center;padding:18px 0">No scored pairs in this filter slice.</div>';
    } else {
      container.querySelector('#exp-chart-box').hidden = true;
    }

    const sIdx = res.total === 0 ? 0 : (state.page - 1) * PAGE_SIZE + 1;
    const eIdx = Math.min(res.total, state.page * PAGE_SIZE);
    const ge05 = res.histVals.reduce((a, v) => a + (v >= 0.5 ? 1 : 0), 0);

    container.querySelector('#exp-meta').innerHTML = `
      <div>Showing <b>${fmtInt(sIdx)}–${fmtInt(eIdx)}</b> of <b>${fmtInt(res.total)}</b> pairs${ge05 ? ` · <b>${fmtInt(ge05)}</b> ≥ 0.50` : ''}</div>
      <div>Click any row for subscores &amp; Dataverse model command</div>
    `;

    const th = (key, label, title, isNum = true) => {
      const act = state.sortBy === key;
      const arr = act ? (state.sortDir === 'desc' ? ' ↓' : ' ↑') : '';
      return `<th class="sortable${act ? ' sorted' : ''}${isNum ? ' num' : ''}" data-sort="${key}" title="${esc(title)}">${esc(label)}${arr}</th>`;
    };

    const subHead = state.showSubscores
      ? `${th('ipsae_max', 'ipSAE max', 'Max directional ipSAE')}
         ${th('ipsae_mean', 'Mean', 'Mean directional ipSAE')}
         ${th('ipsae_a', 'A→B', 'Asymmetric ipSAE aligned on Chain A (ID)')}
         ${th('ipsae_b', 'B→A', 'Asymmetric ipSAE aligned on Chain B (Pathogen)')}
         ${th('d0dom_min', 'd0dom', 'ipSAE d0dom (min)')}
         ${th('d0chn_min', 'd0chn', 'ipSAE d0chn (min)')}
         ${th('pdockq2_min', 'pDockQ2', 'pDockQ2 (min)')}
         <th class="num" title="Interface contacts <10 Å & PAE <10 Å (ID / Pathogen)">dist1/2</th>
         <th class="num" title="PAE <10 Å residues (ID / Pathogen)">nres1/2</th>`
      : '';

    const rowsHtml = pageRows.length
      ? pageRows
          .map((p, idx) => {
            const ds = meta.datasets[p.setIdx];
            const idR = meta.ids[p.id_idx];
            const paR = meta.pathogens[p.path_idx];
            const ok = p.status === STATUS.SCORED;
            const subCells = state.showSubscores
              ? `<td class="num">${ok ? p.ipsae_max.toFixed(3) : '—'}</td>
                 <td class="num">${ok ? p.ipsae_mean.toFixed(3) : '—'}</td>
                 <td class="num">${ok ? p.ipsae_a.toFixed(3) : '—'}</td>
                 <td class="num">${ok ? p.ipsae_b.toFixed(3) : '—'}</td>
                 <td class="num">${ok ? p.d0dom_min.toFixed(3) : '—'}</td>
                 <td class="num">${ok ? p.d0chn_min.toFixed(3) : '—'}</td>
                 <td class="num">${ok ? p.pdockq2_min.toFixed(3) : '—'}</td>
                 <td class="num">${ok ? `${p.dist1}/${p.dist2}` : '—'}</td>
                 <td class="num">${ok ? `${p.nres1}/${p.nres2}` : '—'}</td>`
              : '';
            return `
              <tr class="clickable" data-row-idx="${idx}">
                <td class="mono" style="font-size:12px">${esc(ds.id)}</td>
                <td>
                  <div style="display:flex;align-items:center;gap:6px">
                    ${panelBadge(idR.s)}
                    <a class="prot-link cell-trunc" href="#/id/${encodeURIComponent(idR.id)}" title="${esc(idR.id)}" data-stop-row>${esc(idR.id)}</a>
                  </div>
                  <div class="muted" style="font-size:12px;margin-top:2px"><span class="italic">${esc(idR.sp)}</span> · ${esc(idR.ipr_s || idR.ipr)}</div>
                </td>
                <td>
                  <a class="prot-link" href="#/pathogen/${encodeURIComponent(paR.id)}" data-stop-row>${esc(paR.id)}</a>
                  <div class="muted" style="font-size:12px;margin-top:2px"><span class="dot" style="background:${ORG_COLORS[paR.org]};margin-right:5px"></span><span class="italic">${esc(paR.sp)}</span></div>
                </td>
                <td class="num">${scoreCellHtml(p.ipsae_min, p.status)}</td>
                <td class="num">${ok ? p.iptm.toFixed(3) : '—'}</td>
                <td class="num">${ok ? p.pdockq.toFixed(3) : '—'}</td>
                <td class="num">${ok ? p.lis_min.toFixed(3) : '—'}</td>
                <td class="num">${ok ? p.contacts : '—'}</td>
                ${subCells}
              </tr>
            `;
          })
          .join('')
      : `<tr><td colspan="${state.showSubscores ? 17 : 8}" style="text-align:center;padding:42px" class="muted">No matching predictions for the active filters.</td></tr>`;

    container.querySelector('#exp-table').innerHTML = `
      <table class="dt">
        <thead>
          <tr>
            ${th('job_num', 'Set', 'Screening set (click to sort by job number)', false)}
            <th>NLR Integrated Domain (Chain A)</th>
            <th>Pathogen / Pest (Chain B)</th>
            ${th('ipsae_min', 'ipSAE (min) ★', 'Primary conservative ipSAE (min of A→B and B→A)')}
            ${th('iptm', 'ipTM', 'AlphaFold 3 ipTM')}
            ${th('pdockq', 'pDockQ', 'pDockQ')}
            ${th('lis_min', 'LIS', 'Local Interaction Score (min)')}
            ${th('contacts', 'Contacts', 'Unique interface contact residues <10 Å & PAE <10 Å (dist1 + dist2)')}
            ${subHead}
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;

    container.querySelectorAll('#exp-table th.sortable').forEach((el) => {
      el.addEventListener('click', () => {
        const key = el.dataset.sort;
        if (state.sortBy === key) state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
        else { state.sortBy = key; state.sortDir = key === 'job_num' ? 'asc' : 'desc'; }
        state.page = 1;
        renderTable();
      });
    });

    container.querySelectorAll('#exp-table tbody tr[data-row-idx]').forEach((tr) => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('[data-stop-row]')) return;
        const p = pageRows[Number(tr.dataset.rowIdx)];
        if (p) navigateToPair(p);
      });
    });

    container.querySelector('#exp-pag').innerHTML = `
      <div>Page <b>${state.page}</b> of <b>${fmtInt(totalPages)}</b></div>
      <div class="btn-group">
        <button type="button" class="btn btn-sm" id="pg-first" ${state.page <= 1 ? 'disabled' : ''}>First</button>
        <button type="button" class="btn btn-sm" id="pg-prev" ${state.page <= 1 ? 'disabled' : ''}>Prev</button>
        <button type="button" class="btn btn-sm" id="pg-next" ${state.page >= totalPages ? 'disabled' : ''}>Next</button>
        <button type="button" class="btn btn-sm" id="pg-last" ${state.page >= totalPages ? 'disabled' : ''}>Last</button>
      </div>
    `;
    container.querySelector('#pg-first')?.addEventListener('click', () => { state.page = 1; renderTable(); });
    container.querySelector('#pg-prev')?.addEventListener('click', () => { state.page = Math.max(1, state.page - 1); renderTable(); });
    container.querySelector('#pg-next')?.addEventListener('click', () => { state.page = Math.min(totalPages, state.page + 1); renderTable(); });
    container.querySelector('#pg-last')?.addEventListener('click', () => { state.page = totalPages; renderTable(); });
  }

  function updateLoadBar(done, total, ds) {
    if (gen !== activeGeneration) return;
    const bar = container.querySelector('#exp-load-bar');
    if (!bar) return;
    if (done >= total) { bar.style.display = 'none'; return; }
    const pct = total ? Math.round((done / total) * 100) : 0;
    bar.style.display = 'flex';
    bar.innerHTML = `
      <span>Loading full score tables (${done}/${total})${ds ? ` · ${ds.id}` : ''}…</span>
      <div class="prog-track"><div class="prog-fill" style="width:${pct}%"></div></div>
    `;
  }

  async function ensureNeededSetsLoaded() {
    const needed = getNeededSetIndices(meta);
    const missing = needed.filter((idx) => !store.sets.has(idx));
    if (!missing.length) { updateLoadBar(needed.length, needed.length); return; }
    updateLoadBar(needed.length - missing.length, needed.length);
    await store.loadSets(missing, (d, t, ds) => {
      updateLoadBar(needed.length - missing.length + d, needed.length, ds);
      if (!canServeFromTopHits(meta) || d === t) renderTable();
    });
    if (gen === activeGeneration) {
      updateLoadBar(needed.length, needed.length);
      renderTable();
    }
  }

  // Wire primary toolbar chips
  container.querySelectorAll('[data-org]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.org = btn.dataset.org;
      state.page = 1;
      syncExplorerFacets('org');
      renderTable();
      ensureNeededSetsLoaded();
    });
  });

  container.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.minIpsae = Number(btn.dataset.preset);
      state.maxIpsae = 1.0;
      state.page = 1;
      const inp = container.querySelector('#f-ipsae');
      if (inp) inp.value = state.minIpsae;
      renderTable();
      ensureNeededSetsLoaded();
    });
  });

  container.querySelector('#btn-adv')?.addEventListener('click', () => {
    state.showAdvanced = !state.showAdvanced;
    container.querySelector('#adv-drawer').hidden = !state.showAdvanced;
    syncChipStates();
  });

  container.querySelector('#btn-sub')?.addEventListener('click', () => {
    state.showSubscores = !state.showSubscores;
    renderTable();
  });

  container.querySelector('#btn-chart')?.addEventListener('click', () => {
    state.showChart = !state.showChart;
    renderTable();
  });

  // Wire text & advanced inputs
  const bindVal = (sel, key, xf = (v) => v, debounce = false, syncFacet = false) => {
    const el = container.querySelector(sel);
    if (!el) return;
    let t = null;
    const go = () => {
      state[key] = xf(el.value);
      state.page = 1;
      if (syncFacet) syncExplorerFacets(key);
      renderTable();
      ensureNeededSetsLoaded();
    };
    el.addEventListener(debounce ? 'input' : 'change', () => {
      if (debounce) { clearTimeout(t); t = setTimeout(go, 140); }
      else go();
    });
  };
  bindVal('#f-text', 'text', (v) => v, true);
  bindVal('#f-set', 'set', (v) => v, false, true);
  bindVal('#f-idpanel', 'idPanel', (v) => v, false, true);
  bindVal('#f-pathpanel', 'pathPanel', (v) => v, false, true);
  bindVal('#f-cat', 'category', (v) => v, false, true);
  bindVal('#f-ipr', 'interpro', (v) => v, true);
  bindVal('#f-order', 'plantOrder', (v) => v, false, true);
  bindVal('#f-nlrcls', 'nlrClass', (v) => v, false, true);
  bindVal('#f-pathsp', 'pathSpecies', (v) => v, false, true);
  bindVal('#f-protcls', 'protClass', (v) => v, false, true);
  bindVal('#f-status', 'status');
  bindVal('#f-ipsae', 'minIpsae', (v) => (v === '' ? 0 : Math.max(0, Math.min(1, Number(v)))), true);
  bindVal('#f-maxipsae', 'maxIpsae', (v) => (v === '' ? 1 : Math.max(0, Math.min(1, Number(v)))), true);
  bindVal('#f-iptm', 'minIptm', (v) => (v === '' ? 0 : Math.max(0, Math.min(1, Number(v)))), true);
  bindVal('#f-pdockq', 'minPdockq', (v) => (v === '' ? 0 : Math.max(0, Math.min(1, Number(v)))), true);
  bindVal('#f-lis', 'minLis', (v) => (v === '' ? 0 : Math.max(0, Math.min(1, Number(v)))), true);
  bindVal('#f-contacts', 'minContacts', (v) => (v === '' ? 0 : Math.max(0, Number(v))), true);

  container.querySelector('#exp-reset')?.addEventListener('click', () => {
    Object.assign(state, {
      set: '', idPanel: '', pathPanel: '', org: '', category: '', interpro: '',
      plantOrder: '', nlrClass: '', pathSpecies: '', protClass: '', status: 'scored',
      text: '', minIpsae: 0.3, maxIpsae: 1.0, minIptm: 0, minPdockq: 0, minLis: 0,
      minContacts: 0, sortBy: 'ipsae_min', sortDir: 'desc', page: 1,
    });
    renderExplorerView(container, null);
  });

  const doExport = (sep) => {
    if (!lastResult || !lastResult.total) return;
    if (lastResult.total > MAX_EXPORT_ROWS) {
      if (!window.confirm(`Export top ${MAX_EXPORT_ROWS.toLocaleString()} of ${lastResult.total.toLocaleString()} matching pairs?`)) return;
    }
    const rows = lastResult.getSlice(Math.min(lastResult.total, MAX_EXPORT_ROWS));
    exportPairsTable(`bifrost_scores.${sep === ',' ? 'csv' : 'tsv'}`, rows, meta, sep);
  };
  container.querySelector('#exp-export-tsv')?.addEventListener('click', () => doExport('\t'));
  container.querySelector('#exp-export-csv')?.addEventListener('click', () => doExport(','));

  syncExplorerFacets();
  renderTable();
  ensureNeededSetsLoaded();
}
