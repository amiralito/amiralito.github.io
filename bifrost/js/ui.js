/**
 * Shared UI helpers, badges, faceted select sync, figure lightbox, and Pair Detail page
 */

import { store, STATUS, STATUS_LABELS } from './data.js';
import { scoreTier, scoreColor, ORG_COLORS } from './charts.js';
import {
  copyToClipboard,
  buildExtractCommand,
  buildReproduceCommand,
  formatFasta,
  triggerDownload,
} from './export.js';

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtInt(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Number(v).toLocaleString();
}

export function panelBadge(panel) {
  const cls = panel.startsWith('ID') ? `badge-${panel}` : '';
  return `<span class="badge ${cls}">${esc(panel)}</span>`;
}

export function orgBadge(org) {
  const color = ORG_COLORS[org] || '#83899a';
  return `<span class="badge"><span class="dot" style="background:${color}"></span>${esc(org)}</span>`;
}

export function statusBadge(status) {
  if (status === STATUS.SCORED) return '<span class="badge">Scored</span>';
  if (status === STATUS.FAILED) return '<span class="badge badge-bad">ipSAE failed</span>';
  return '<span class="badge badge-warn">Missing scores</span>';
}

export function scoreCellHtml(v, status = STATUS.SCORED, showBar = true) {
  if (status !== STATUS.SCORED) return statusBadge(status);
  const tier = scoreTier(v);
  const color = scoreColor(v);
  const pct = Math.min(100, Math.max(0, v * 100));
  return `<span class="score-cell">
    <span class="score-pill ${tier}">${v.toFixed(3)}</span>
    ${showBar ? `<span class="score-bar-track" aria-hidden="true"><span class="score-bar-fill" style="width:${pct.toFixed(1)}%;background:${color}"></span></span>` : ''}
  </span>`;
}

export function accessionLinkHtml(acc, panel) {
  if (!acc) return '<span class="muted">—</span>';
  if (panel === 'ID1' || panel === 'V1' || /^[XN]P_\d+/.test(acc)) {
    const url = `https://www.ncbi.nlm.nih.gov/protein/${encodeURIComponent(acc)}`;
    return `<a class="ext-link mono" href="${url}" target="_blank" rel="noopener">${esc(acc)} &#8599;</a>`;
  }
  return `<span class="mono">${esc(acc)}</span>`;
}

export function interproLinksHtml(iprsStr, primaryOnly = false) {
  const items = (iprsStr || '')
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean);
  if (!items.length) return '<span class="muted">—</span>';
  const list = primaryOnly ? [items[0]] : items;
  return list
    .map((ipr) => {
      const wiki = `#/domain/${encodeURIComponent(ipr)}`;
      const ebi = `https://www.ebi.ac.uk/interpro/entry/InterPro/${encodeURIComponent(ipr)}/`;
      return `<span class="mono"><a class="prot-link" href="${wiki}" title="View all Bifrost IDs with ${esc(ipr)}">${esc(ipr)}</a> <a class="muted" href="${ebi}" target="_blank" rel="noopener" title="Open ${esc(ipr)} on InterPro">&#8599;</a></span>`;
    })
    .join(', ');
}

export function doiLinksHtml(doiStr, label = null) {
  if (!doiStr) return '<span class="muted">—</span>';
  const parts = doiStr
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean);
  return parts
    .map((raw) => {
      const href = raw.startsWith('http') ? raw : `https://doi.org/${raw}`;
      const text = label && parts.length === 1 ? label : raw.replace(/^https?:\/\/doi\.org\//, 'doi:');
      return `<a class="ext-link" href="${esc(href)}" target="_blank" rel="noopener">${esc(text)} &#8599;</a>`;
    })
    .join(' · ');
}

export function renderFormattedSequence(seq, highlights = []) {
  if (!seq) return '<span class="muted">Sequence unavailable.</span>';
  const n = seq.length;
  let posCls = null;
  if (highlights.length) {
    posCls = new Array(n).fill(null);
    for (const hl of highlights) {
      const s = Math.max(1, hl.start) - 1;
      const e = Math.min(n, hl.end) - 1;
      for (let i = s; i <= e; i++) posCls[i] = hl.cls || 'seq-hl-id';
    }
  }
  const lines = [];
  for (let start = 0; start < n; start += 60) {
    const end = Math.min(n, start + 60);
    let lineHtml = `<span class="seq-pos">${start + 1}</span>`;
    let openCls = null;
    for (let i = start; i < end; i++) {
      if (i > start && (i - start) % 10 === 0) {
        if (openCls) { lineHtml += '</span>'; openCls = null; }
        lineHtml += ' ';
      }
      const cls = posCls ? posCls[i] : null;
      if (cls !== openCls) {
        if (openCls) lineHtml += '</span>';
        if (cls) lineHtml += `<span class="${cls}">`;
        openCls = cls;
      }
      lineHtml += esc(seq[i]);
    }
    if (openCls) lineHtml += '</span>';
    lines.push(lineHtml);
  }
  return lines.join('\n');
}

/**
 * Cross-filter (facet-sync) a group of <select> dropdowns against `records`.
 *
 * When `changedKey` changes, any OTHER facet whose currently selected value has
 * zero matching rows is automatically reset to '' (so users never get stuck in
 * impossible filter combinations). Each dropdown's options & counts reflect all
 * active filters EXCEPT its own, allowing smooth peer switching.
 */
export function syncFacetedSelects(records, specs, stateObj, rootEl, changedKey = null) {
  const matchesExcept = (rec, skipKey) => {
    for (const sp of specs) {
      if (sp.key === skipKey) continue;
      const val = stateObj[sp.key];
      if (!val) continue;
      if (sp.getter(rec) !== val) return false;
    }
    return true;
  };

  // Pass 1: if a facet changed, clear any OTHER facet incompatible with the new selection
  if (changedKey) {
    const changedSpec = specs.find((s) => s.key === changedKey);
    const changedVal = changedSpec ? stateObj[changedKey] : '';
    const constrained = changedSpec && changedVal
      ? records.filter((r) => changedSpec.getter(r) === changedVal)
      : records;

    // 1a. Drop any individual facet value that has zero matches under the changed facet/base pool
    for (const sp of specs) {
      if (sp.key === changedKey) continue;
      const cur = stateObj[sp.key];
      if (!cur) continue;
      if (!constrained.some((r) => sp.getter(r) === cur)) {
        stateObj[sp.key] = '';
      }
    }

    // 1b. If remaining active facets jointly yield 0 rows, drop conflicting other facets until valid
    const hasJointMatch = () => records.some((r) => matchesExcept(r, null));
    if (!hasJointMatch()) {
      for (const sp of specs) {
        if (sp.key === changedKey || !stateObj[sp.key]) continue;
        stateObj[sp.key] = '';
        if (hasJointMatch()) break;
      }
    }
  }

  // Pass 2: rebuild each <select>'s options with live counts
  for (const sp of specs) {
    const sel = rootEl.querySelector(sp.sel);
    if (!sel) continue;

    const counts = new Map();
    const extraMeta = new Map();
    for (const r of records) {
      if (!matchesExcept(r, sp.key)) continue;
      const v = sp.getter(r);
      if (!v) continue;
      counts.set(v, (counts.get(v) || 0) + 1);
      if (sp.metaGetter && !extraMeta.has(v)) extraMeta.set(v, sp.metaGetter(r));
    }

    const entries = [...counts.entries()];
    if (sp.sort === 'count') {
      entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    } else if (sp.order) {
      const idxMap = new Map(sp.order.map((v, i) => [v, i]));
      entries.sort((a, b) => (idxMap.get(a[0]) ?? 999) - (idxMap.get(b[0]) ?? 999));
    } else {
      entries.sort((a, b) => a[0].localeCompare(b[0]));
    }

    const cur = stateObj[sp.key] || '';
    const allTxt = typeof sp.allLabel === 'function' ? sp.allLabel(entries.length) : sp.allLabel;
    let html = `<option value="">${esc(allTxt)}</option>`;
    for (const [val, n] of entries) {
      const lbl = sp.formatOpt ? sp.formatOpt(val, n, extraMeta.get(val)) : `${val} (${n})`;
      html += `<option value="${esc(val)}"${val === cur ? ' selected' : ''}>${esc(lbl)}</option>`;
    }
    sel.innerHTML = html;
    sel.value = cur;
  }
}

/* --------------------------------------------------------------------------
   Pair Navigation & Dedicated Pair Detail Page (replaces overlay modal)
   -------------------------------------------------------------------------- */
let pendingPairCache = null;

export function navigateToPair(pair) {
  const ds = store.meta.datasets[pair.setIdx];
  pendingPairCache = { key: `${ds.id}:${pair.job_num}`, pair };
  window.location.hash = `#/pair/${encodeURIComponent(ds.id)}/${pair.job_num}`;
}

export function consumeCachedPair(dsName, jobNum) {
  const key = `${dsName}:${jobNum}`;
  if (pendingPairCache && pendingPairCache.key === key) {
    return pendingPairCache.pair;
  }
  return null;
}

/**
 * Render a clean, uncluttered, accessible Pair Detail Wiki Page.
 */
export function renderPairPage(container, pair) {
  const meta = store.meta;
  const ds = meta.datasets[pair.setIdx];
  const idR = meta.ids[pair.id_idx];
  const paR = meta.pathogens[pair.path_idx];
  const info = store.getJobArchiveInfo(pair);
  const ok = pair.status === STATUS.SCORED;

  const extractCmd = buildExtractCommand(info);
  const reproCmd = buildReproduceCommand(info);
  const pairPermalink = `${window.location.origin}${window.location.pathname}#/pair/${encodeURIComponent(ds.id)}/${pair.job_num}`;

  const primaryScoresHtml = ok
    ? `
      <div class="facts cols-5">
        <div class="fact primary-fact">
          <div class="k">ipSAE (min) ★</div>
          <div class="v big-num" style="color:${scoreColor(pair.ipsae_min)}">${pair.ipsae_min.toFixed(4)}<small>Primary score</small></div>
        </div>
        <div class="fact">
          <div class="k">ipTM (AF3)</div>
          <div class="v big-num">${pair.iptm.toFixed(4)}<small>d0chn: ${pair.iptm_d0chn.toFixed(3)}</small></div>
        </div>
        <div class="fact">
          <div class="k">pDockQ</div>
          <div class="v big-num">${pair.pdockq.toFixed(4)}<small>pDockQ2: ${pair.pdockq2_min.toFixed(3)}</small></div>
        </div>
        <div class="fact">
          <div class="k">LIS (min)</div>
          <div class="v big-num">${pair.lis_min.toFixed(4)}<small>Mean: ${pair.lis_mean.toFixed(3)}</small></div>
        </div>
        <div class="fact">
          <div class="k">Contacts (&lt;10 Å)</div>
          <div class="v big-num">${pair.contacts}<small>ID ${pair.dist1} · Pathogen ${pair.dist2}</small></div>
        </div>
      </div>

      <h2>Subscores &amp; interface details <small>ipsae.py · 10 Å PAE / 10 Å distance</small></h2>
      <table class="ev">
        <tr>
          <td>ipSAE directional</td>
          <td>
            <div class="subscore-list">
              <span class="subscore-item"><span class="sk">min</span><span class="sv">${pair.ipsae_min.toFixed(4)}</span></span>
              <span class="subscore-item"><span class="sk">max</span><span class="sv">${pair.ipsae_max.toFixed(4)}</span></span>
              <span class="subscore-item"><span class="sk">mean</span><span class="sv">${pair.ipsae_mean.toFixed(4)}</span></span>
              <span class="subscore-item"><span class="sk">A→B (ID)</span><span class="sv">${pair.ipsae_a.toFixed(4)}</span></span>
              <span class="subscore-item"><span class="sk">B→A (Pathogen)</span><span class="sv">${pair.ipsae_b.toFixed(4)}</span></span>
            </div>
          </td>
        </tr>
        <tr>
          <td>Length-scaled variants</td>
          <td>
            <div class="subscore-list">
              <span class="subscore-item"><span class="sk">ipSAE d0dom</span><span class="sv">${pair.d0dom_min.toFixed(4)}</span><span class="sk">(max ${pair.d0dom_max.toFixed(4)})</span></span>
              <span class="subscore-item"><span class="sk">ipSAE d0chn</span><span class="sv">${pair.d0chn_min.toFixed(4)}</span><span class="sk">(max ${pair.d0chn_max.toFixed(4)})</span></span>
              <span class="subscore-item"><span class="sk">ipTM d0chn</span><span class="sv">${pair.iptm_d0chn.toFixed(4)}</span></span>
            </div>
          </td>
        </tr>
        <tr>
          <td>Interface quality &amp; residues</td>
          <td>
            <div class="subscore-list">
              <span class="subscore-item"><span class="sk">pDockQ2</span><span class="sv">${pair.pdockq2_min.toFixed(4)}</span><span class="sk">(max ${pair.pdockq2_max.toFixed(4)})</span></span>
              <span class="subscore-item"><span class="sk">LIS mean</span><span class="sv">${pair.lis_mean.toFixed(4)}</span></span>
              <span class="subscore-item"><span class="sk">PAE &lt; 10 Å residues</span><span class="sv">${pair.nres1 + pair.nres2}</span><span class="sk">(ID ${pair.nres1} · Pathogen ${pair.nres2})</span></span>
            </div>
          </td>
        </tr>
      </table>
    `
    : `
      <div class="callout warn" style="margin-top:18px">
        <b>${esc(STATUS_LABELS[pair.status])}.</b>
        ${
          pair.status === STATUS.FAILED
            ? 'AlphaFold 3 inference completed, but ipSAE scoring exited with an error (logged in <code>ipsae_failed.tsv</code>). The top-ranked model is still deposited on Harvard Dataverse below.'
            : 'This job falls in <code>ID2_V1</code> jobs 70070–71070, which carry no scores and are absent from <code>ipsae_failed.tsv</code>.'
        }
      </div>
    `;

  container.innerHTML = `
    <div style="margin-bottom:14px">
      <button type="button" class="btn btn-sm" id="pair-back-btn">&larr; Back</button>
    </div>

    <div class="eyebrow">
      <span class="badge mono">${esc(ds.id)} · job #${pair.job_num}</span>
      ${panelBadge(idR.s)}
      ${orgBadge(paR.org)}
      ${statusBadge(pair.status)}
    </div>

    <div class="page-head-row">
      <div style="min-width:0;flex:1">
        <h1 style="font-size:clamp(22px,2.6vw,30px)">${esc(idR.ipr_s || idR.ipr)} <span class="muted">×</span> ${esc(paR.id)}</h1>
        <p class="lede" style="margin-bottom:14px">
          <span class="italic">${esc(idR.sp)}</span> (${esc(idR.cls)} · ${esc(idR.arch)}) paired with
          <span class="italic">${esc(paR.sp)}</span> (${esc(paR.cls || paR.org)}).
        </p>
      </div>
      <div class="btn-group">
        <button type="button" class="btn btn-sm" id="pair-copy-link">Copy link</button>
        <button type="button" class="btn btn-sm" id="pair-dl-fasta">Pair FASTA</button>
        <a class="btn btn-sm btn-primary" href="${esc(info.doi)}" target="_blank" rel="noopener">Open on Dataverse &#8599;</a>
      </div>
    </div>

    ${primaryScoresHtml}

    <h2>Interacting proteins</h2>
    <div class="pair-partner-grid">
      <div class="pair-partner-card">
        <div class="eyebrow" style="margin-bottom:2px">Chain A · NLR Integrated Domain</div>
        <div class="p-title"><a class="prot-link" href="#/id/${encodeURIComponent(idR.id)}">${esc(idR.id)}</a></div>
        <div class="p-meta">
          <span class="italic">${esc(idR.sp)}</span> · ${esc(idR.ord || idR.fam)}<br/>
          ${interproLinksHtml(idR.ipr, true)} — ${esc(idR.ipr_n || idR.ipr_s)}<br/>
          ${esc(idR.cls)} (${esc(idR.arch)}) · ID ${idR.len} aa (${idR.st}–${idR.en} of ${idR.plen} aa parent)
        </div>
        <div class="btn-group" style="margin-top:auto;padding-top:10px">
          <button type="button" class="btn btn-sm" id="pair-copy-seq-a" title="Copy Chain A excised ID sequence (${idR.len} aa)">Copy ID seq</button>
          <button type="button" class="btn btn-sm" id="pair-copy-parent-a" title="Copy full-length parent NLR sequence (${idR.plen} aa)">Copy parent NLR</button>
          <a class="btn btn-sm" href="#/id/${encodeURIComponent(idR.id)}">NLR ID page &rarr;</a>
        </div>
      </div>

      <div class="pair-partner-card">
        <div class="eyebrow" style="margin-bottom:2px">Chain B · Pathogen / Pest Protein</div>
        <div class="p-title"><a class="prot-link" href="#/pathogen/${encodeURIComponent(paR.id)}">${esc(paR.id)}</a></div>
        <div class="p-meta">
          <span class="italic">${esc(paR.sp)}</span> · ${esc(paR.org)}<br/>
          Class: ${esc(paR.cls || '—')} · Length: ${paR.len} aa<br/>
          Source: ${esc(paR.src)}
        </div>
        <div class="btn-group" style="margin-top:auto;padding-top:10px">
          <button type="button" class="btn btn-sm" id="pair-copy-seq-b" title="Copy Chain B pathogen sequence (${paR.len} aa)">Copy sequence</button>
          <a class="btn btn-sm" href="#/pathogen/${encodeURIComponent(paR.id)}">Pathogen page &rarr;</a>
        </div>
      </div>
    </div>

    <h2>
      <span>3D structure on Harvard Dataverse</span>
      <div class="btn-group">
        <div class="seg" id="pair-cmd-tabs">
          <button type="button" data-cmd="extract" class="on">Extract 3D model</button>
          <button type="button" data-cmd="repro">Re-run with multiple seeds</button>
        </div>
        <button type="button" class="btn btn-sm" id="pair-copy-cmd">Copy</button>
      </div>
    </h2>
    <p style="font-size:13.5px;margin-bottom:10px">
      Dataset: ${doiLinksHtml(info.doi, `${info.dataset} on Harvard Dataverse`)} ·
      Inference inputs: ${doiLinksHtml(info.inferenceDoi, 'doi:10.7910/DVN/2FUARO')}<br/>
      <span class="muted">Archive member:</span> <code class="mono" style="word-break:break-all">${esc(info.memberTar)}</code>
    </p>
    <pre class="code-block" id="pair-cmd-pre">${esc(extractCmd)}</pre>

    <div class="callout" style="margin-top:28px">
      <b>AlphaFold 3 v3.0.1 · Reproducibility &amp; Terms.</b>
      Predicted with 1 seed × 5 diffusion samples (top-ranked model scored). Predictions are hypotheses and do not establish biological interaction or disease resistance — verify reproducibility with independent seeds before experimental follow-up.
      Deposited structure files are subject to the <a class="ext-link" href="https://github.com/google-deepmind/alphafold3/blob/main/OUTPUT_TERMS_OF_USE.md" target="_blank" rel="noopener">AlphaFold 3 Output Terms of Use</a>.
    </div>
  `;

  let activeCmd = extractCmd;
  let parentSeqA = store.parentNlrs ? (store.parentNlrs[idR.i] || '') : null;
  if (parentSeqA === null) {
    store.loadParentNlrs().then((parents) => { parentSeqA = parents[idR.i] || ''; }).catch(() => {});
  }

  container.querySelector('#pair-back-btn')?.addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
    else window.location.hash = '#/explorer';
  });
  container.querySelector('#pair-copy-link')?.addEventListener('click', (e) => copyToClipboard(pairPermalink, e.currentTarget));
  container.querySelector('#pair-copy-seq-a')?.addEventListener('click', (e) => copyToClipboard(idR.seq, e.currentTarget));
  container.querySelector('#pair-copy-seq-b')?.addEventListener('click', (e) => copyToClipboard(paR.seq, e.currentTarget));
  container.querySelector('#pair-copy-parent-a')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (parentSeqA) {
      copyToClipboard(parentSeqA, btn);
      return;
    }
    const parents = await store.loadParentNlrs();
    parentSeqA = parents[idR.i] || '';
    if (parentSeqA) copyToClipboard(parentSeqA, btn);
  });
  container.querySelector('#pair-dl-fasta')?.addEventListener('click', () => {
    triggerDownload(`${ds.id}_job${pair.job_num}_pair.fasta`, formatFasta(idR.id, idR.seq) + formatFasta(paR.id, paR.seq));
  });
  container.querySelectorAll('#pair-cmd-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeCmd = btn.dataset.cmd === 'extract' ? extractCmd : reproCmd;
      container.querySelector('#pair-cmd-pre').textContent = activeCmd;
      container.querySelectorAll('#pair-cmd-tabs button').forEach((b) => b.classList.toggle('on', b === btn));
    });
  });
  container.querySelector('#pair-copy-cmd')?.addEventListener('click', (e) => copyToClipboard(activeCmd, e.currentTarget));
}

/* --------------------------------------------------------------------------
   Manuscript Figure Plates & Zoom Lightbox
   -------------------------------------------------------------------------- */
export function renderFigureHtml({ src, title, caption, alt = '' }) {
  return `
    <figure class="fig-plate">
      <div class="fig-frame" data-fig-src="${esc(src)}" data-fig-title="${esc(title)}" data-fig-cap="${esc(caption)}" role="button" tabindex="0" aria-label="Enlarge ${esc(title)}">
        <img src="${esc(src)}" alt="${esc(alt || title)}" loading="lazy" />
        <span class="fig-zoom-pill" aria-hidden="true">Click to enlarge</span>
      </div>
      <figcaption><b>${esc(title)}.</b> ${esc(caption)}</figcaption>
    </figure>
  `;
}

let figLightboxWired = false;
export function openFigureLightbox(src, title, caption) {
  const dlg = document.getElementById('fig-lightbox');
  const box = document.getElementById('fig-lightbox-content');
  if (!dlg || !box) return;

  if (!figLightboxWired) {
    figLightboxWired = true;
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
  }

  box.innerHTML = `
    <div class="fig-dialog-bar">
      <div style="font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(title)}</div>
      <div class="btn-group" style="flex-shrink:0">
        <a class="btn btn-sm" href="${esc(src)}" target="_blank" rel="noopener">Open PNG &#8599;</a>
        <button type="button" class="btn btn-sm" id="fig-lb-close">Close</button>
      </div>
    </div>
    <div class="fig-dialog-stage">
      <img src="${esc(src)}" alt="${esc(title)}" />
    </div>
    <div class="fig-dialog-cap"><b>${esc(title)}.</b> ${esc(caption)}</div>
  `;
  box.querySelector('#fig-lb-close')?.addEventListener('click', () => dlg.close());
  if (!dlg.open) dlg.showModal();
}

export function wireFigureLightboxes(rootEl) {
  rootEl.querySelectorAll('.fig-frame[data-fig-src]').forEach((el) => {
    const open = () => openFigureLightbox(el.dataset.figSrc, el.dataset.figTitle, el.dataset.figCap);
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });
}
