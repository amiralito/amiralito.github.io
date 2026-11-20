/**
 * Bifrost · Data & Score Wiki — Sidebar Navigation, Router & Views
 *
 * Calm sidebar + editorial article architecture modeled on BIFROST_TIER_WIKI
 * and amiralito.github.io/thesis.
 */

import { store, STATUS } from './data.js';
import {
  ORG_COLORS,
  ID_COLORS,
  renderOrgHistogramSvg,
  renderSimpleHistogramSvg,
  renderNlrSchematicSvg,
  renderHorizontalBarsHtml,
  wireInteractiveCharts,
} from './charts.js';
import {
  esc,
  fmtInt,
  panelBadge,
  orgBadge,
  scoreCellHtml,
  accessionLinkHtml,
  interproLinksHtml,
  doiLinksHtml,
  renderFormattedSequence,
  navigateToPair,
  consumeCachedPair,
  renderPairPage,
  syncFacetedSelects,
  renderFigureHtml,
  wireFigureLightboxes,
} from './ui.js';
import {
  formatFasta,
  triggerDownload,
  copyToClipboard,
  exportDelimited,
  exportPairsTable,
} from './export.js';
import { renderExplorerView } from './explorer.js';
import { renderHeatmapView } from './heatmap.js';
import { runHomologySearch, runMotifSearch, findNearestSequences } from './seqsearch.js';

const pageEl = document.getElementById('page');
const mainEl = document.getElementById('main');
const crumbsEl = document.getElementById('crumbs');
const navEl = document.getElementById('nav');
const sideEl = document.getElementById('side');
const backdropEl = document.getElementById('side-backdrop');

let routeGen = 0;
let sidebarBuilt = false;
window.__bifrostNavCount = 0;

function bestScoreCell(r, isId, showBar = true) {
  if (isId && !r.scr) return '<span class="muted">—</span>';
  if (r.n_ok === 0) {
    return `<span class="badge badge-bad" title="All ${fmtInt(r.n_fail)} AF3 predictions failed ipSAE scoring">All failed</span>`;
  }
  return scoreCellHtml(r.max_ipsae, STATUS.SCORED, showBar);
}

/* --------------------------------------------------------------------------
   Chrome: Theme, Mobile Drawer, Sidebar Quick Search (`/` shortcut)
   -------------------------------------------------------------------------- */
function setupChrome() {
  // Intercept Skip to content link so it moves focus to #page without triggering hash routing
  document.querySelector('.skip-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    pageEl?.focus();
    mainEl?.scrollTo({ top: 0 });
  });

  const btnTheme = document.getElementById('btn-theme');
  const icoMoon = document.getElementById('ico-moon');
  const icoSun = document.getElementById('ico-sun');

  const syncTheme = () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (icoMoon) icoMoon.style.display = dark ? 'none' : 'block';
    if (icoSun) icoSun.style.display = dark ? 'block' : 'none';
  };
  syncTheme();

  btnTheme?.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('bifrost-wiki-theme', next); } catch {}
    syncTheme();
  });

  // Mobile drawer
  const closeDrawer = () => {
    sideEl?.classList.remove('open');
    if (backdropEl) backdropEl.hidden = true;
  };
  document.getElementById('btn-menu')?.addEventListener('click', () => {
    const open = sideEl.classList.toggle('open');
    backdropEl.hidden = !open;
  });
  backdropEl?.addEventListener('click', closeDrawer);
  window.addEventListener('hashchange', closeDrawer);

  // Keyboard shortcut `/` focuses sidebar search
  const qInput = document.getElementById('side-q');
  const qRes = document.getElementById('side-results');
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      qInput?.focus();
    } else if (e.key === 'Escape' && qRes && !qRes.hidden) {
      qRes.hidden = true;
      qInput?.blur();
    }
  });

  const runSideSearch = () => {
    if (!store.meta) return;
    const q = qInput.value.trim().toLowerCase();
    if (q.length < 2) {
      qRes.hidden = true;
      return;
    }
    const items = [];
    for (const p of store.meta.pathogens) {
      if (p._q.includes(q)) {
        items.push({
          href: `#/pathogen/${encodeURIComponent(p.id)}`,
          name: p.id,
          sub: `${p.org} · ${p.sp}`,
          dot: ORG_COLORS[p.org],
        });
        if (items.length >= 6) break;
      }
    }
    let iprN = 0;
    const iprDict = store.meta.interpro || {};
    for (const [ipr, list] of store.idsByInterpro.entries()) {
      const info = iprDict[ipr];
      const f = list[0];
      const shortN = info?.s || f.ipr_s || '';
      const fullN = info?.n || f.ipr_n || '';
      if (`${ipr} ${shortN} ${fullN}`.toLowerCase().includes(q)) {
        const nScr = list.filter((x) => x.scr).length;
        items.push({
          href: `#/domain/${encodeURIComponent(ipr)}`,
          name: `${ipr} · ${shortN || fullN}`,
          sub: `InterPro · ${nScr || list.length} IDs`,
          dot: '#83899a',
        });
        if (++iprN >= 4) break;
      }
    }
    let idN = 0;
    for (const r of store.meta.ids) {
      if (r._q.includes(q)) {
        items.push({
          href: `#/id/${encodeURIComponent(r.id)}`,
          name: r.id,
          sub: `${r.sp} · ${r.ipr_s || r.ipr}`,
          dot: ID_COLORS[r.s],
        });
        if (++idN >= 7) break;
      }
    }

    qRes.innerHTML =
      (items.length
        ? items
            .map(
              (it) => `
              <a class="sr-item" href="${it.href}">
                <div class="sr-main">
                  <div class="sr-name"><span class="dot" style="background:${it.dot};margin-right:7px"></span>${esc(it.name)}</div>
                  <div class="sr-sub">${esc(it.sub)}</div>
                </div>
              </a>`
            )
            .join('')
        : `<div class="sr-item"><span class="muted">No direct protein match</span></div>`) +
      `<a class="sr-item" href="#/explorer?q=${encodeURIComponent(qInput.value.trim())}" style="background:var(--bg2)">
        <span style="font-weight:500">Search all 757k scores for "${esc(qInput.value.trim())}" &rarr;</span>
      </a>`;
    qRes.hidden = false;
  };

  qInput?.addEventListener('input', runSideSearch);
  qInput?.addEventListener('focus', runSideSearch);
  qRes?.addEventListener('click', () => { qRes.hidden = true; qInput.value = ''; });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.side-search') && qRes) qRes.hidden = true;
  });
}

function buildSidebar(meta) {
  if (sidebarBuilt) return;
  sidebarBuilt = true;

  const s = meta.summary;
  const idCounts = {
    ID1: meta.ids.filter((r) => r.s === 'ID1' && r.scr).length,
    ID2: meta.ids.filter((r) => r.s === 'ID2' && r.scr).length,
    ID3: meta.ids.filter((r) => r.s === 'ID3' && r.scr).length,
  };
  const orgCounts = {
    Oomycete: meta.pathogens.filter((r) => r.org === 'Oomycete').length,
    Nematode: meta.pathogens.filter((r) => r.org === 'Nematode').length,
    Insect: meta.pathogens.filter((r) => r.org === 'Insect').length,
    Virus: meta.pathogens.filter((r) => r.org === 'Virus').length,
  };

  // Top 10 primary InterPro entries by ID count
  const iprCounts = new Map();
  for (const r of meta.ids) {
    if (!r.scr || !r.ipr) continue;
    const prev = iprCounts.get(r.ipr);
    if (prev) prev.n++;
    else iprCounts.set(r.ipr, { ipr: r.ipr, short: r.ipr_s || r.ipr, n: 1 });
  }
  const topIprs = [...iprCounts.values()].sort((a, b) => b.n - a.n).slice(0, 10);

  const caret = '<svg class="caret" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4.5 2.5 8 6l-3.5 3.5"/></svg>';

  navEl.innerHTML = `
    <div class="nav-sec">Guide</div>
    <a class="nav-a" href="#/" data-nav="home">Overview</a>
    <a class="nav-a" href="#/panels" data-nav="panels">Input Panels <span class="cnt">8</span></a>
    <a class="nav-a" href="#/domains" data-nav="domains-all">InterPro Domains <span class="cnt">${fmtInt(s.n_interpro_all || s.n_interpro_entries)}</span></a>
    <a class="nav-a" href="#/explorer" data-nav="explorer">Score Explorer <span class="cnt">757k</span></a>
    <a class="nav-a" href="#/datasets" data-nav="datasets">Dataverse DOIs <span class="cnt">14</span></a>
    <a class="nav-a" href="#/glossary" data-nav="glossary">Score Glossary</a>
    <a class="nav-a" href="#/methods" data-nav="methods">Methods &amp; Terms</a>
    <a class="nav-a" href="#/acknowledgements" data-nav="acknowledgements">Acknowledgements</a>

    <div class="nav-sec">Tools</div>
    <a class="nav-a" href="#/heatmap" data-nav="heatmap">Custom Heatmap</a>
    <a class="nav-a" href="#/search" data-nav="search">Sequence Search</a>

    <div class="nav-sec">Panels</div>
    <div class="nav-a open" data-toggle="nl-ids" role="button" tabindex="0" aria-expanded="true" aria-controls="nl-ids">${caret}<span>NLR IDs</span><span class="cnt">${fmtInt(s.n_ids_screened)}</span></div>
    <div class="nav-list open" id="nl-ids">
      <a class="nav-c" href="#/ids" data-nav="ids-all"><span class="ne">All NLR IDs</span><span class="nd">${fmtInt(s.n_ids_screened)}</span></a>
      <a class="nav-c" href="#/ids?panel=ID1" data-nav="ids-ID1"><span class="dot" style="background:var(--cyan)"></span><span class="ne">ID1 · RefSeq</span><span class="nd">${fmtInt(idCounts.ID1)}</span></a>
      <a class="nav-c" href="#/ids?panel=ID2" data-nav="ids-ID2"><span class="dot" style="background:var(--purple)"></span><span class="ne">ID2 · Superasterids</span><span class="nd">${fmtInt(idCounts.ID2)}</span></a>
      <a class="nav-c" href="#/ids?panel=ID3" data-nav="ids-ID3"><span class="dot" style="background:var(--pink)"></span><span class="ne">ID3 · Solanaceae</span><span class="nd">${fmtInt(idCounts.ID3)}</span></a>
    </div>

    <div class="nav-a open" data-toggle="nl-path" role="button" tabindex="0" aria-expanded="true" aria-controls="nl-path">${caret}<span>Pathogens</span><span class="cnt">${fmtInt(s.n_pathogens)}</span></div>
    <div class="nav-list open" id="nl-path">
      <a class="nav-c" href="#/pathogens" data-nav="path-all"><span class="ne">All Pathogens</span><span class="nd">${fmtInt(s.n_pathogens)}</span></a>
      <a class="nav-c" href="#/pathogens?org=Oomycete" data-nav="path-Oomycete"><span class="dot" style="background:${ORG_COLORS.Oomycete}"></span><span class="ne">Oomycete</span><span class="nd">${orgCounts.Oomycete}</span></a>
      <a class="nav-c" href="#/pathogens?org=Nematode" data-nav="path-Nematode"><span class="dot" style="background:${ORG_COLORS.Nematode}"></span><span class="ne">Nematode</span><span class="nd">${orgCounts.Nematode}</span></a>
      <a class="nav-c" href="#/pathogens?org=Insect" data-nav="path-Insect"><span class="dot" style="background:${ORG_COLORS.Insect}"></span><span class="ne">Insect</span><span class="nd">${orgCounts.Insect}</span></a>
      <a class="nav-c" href="#/pathogens?org=Virus" data-nav="path-Virus"><span class="dot" style="background:${ORG_COLORS.Virus}"></span><span class="ne">Virus</span><span class="nd">${orgCounts.Virus}</span></a>
    </div>

    <div class="nav-a" data-toggle="nl-dom" role="button" tabindex="0" aria-expanded="false" aria-controls="nl-dom">${caret}<span>Top Domains</span><span class="cnt">${fmtInt(s.n_interpro_all || s.n_interpro_entries)}</span></div>
    <div class="nav-list" id="nl-dom">
      <a class="nav-c" href="#/domains" data-nav="domains-all"><span class="ne">All InterPro (${fmtInt(s.n_interpro_all || s.n_interpro_entries)})</span></a>
      ${topIprs
        .map(
          (d) =>
            `<a class="nav-c" href="#/domain/${encodeURIComponent(d.ipr)}" data-nav="dom-${esc(d.ipr)}"><span class="ne" title="${esc(d.ipr)} · ${esc(d.short)}">${esc(d.short)}</span><span class="nd">${d.n}</span></a>`
        )
        .join('')}
    </div>
  `;

  navEl.querySelectorAll('[data-toggle]').forEach((btn) => {
    const toggle = () => {
      const target = document.getElementById(btn.dataset.toggle);
      if (!target) return;
      const open = !target.classList.contains('open');
      target.classList.toggle('open', open);
      btn.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    };
    btn.addEventListener('click', toggle);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  });
}

function setNavAndCrumbs(navKey, crumbs, isWide = false) {
  pageEl.classList.toggle('wide', isWide);
  const lastLabel = crumbs.length ? crumbs[crumbs.length - 1].label : '';
  document.title = navKey === 'home' || !lastLabel ? 'Bifrost · Data & Score Wiki' : `${lastLabel} · Bifrost`;
  navEl.querySelectorAll('[data-nav]').forEach((el) => {
    el.classList.toggle('active', el.dataset.nav === navKey);
  });
  crumbsEl.innerHTML = crumbs
    .map((c, idx) => {
      const last = idx === crumbs.length - 1;
      const sep = idx > 0 ? '<span class="sep">/</span>' : '';
      return last || !c.href
        ? `${sep}<span class="cur">${esc(c.label)}</span>`
        : `${sep}<a href="${c.href}">${esc(c.label)}</a>`;
    })
    .join('');
}

/* --------------------------------------------------------------------------
   VIEW 1: Overview — Calm Landing Page with Manuscript Abstract & Figure 1
   -------------------------------------------------------------------------- */
function renderHome() {
  setNavAndCrumbs('home', [{ label: 'Bifrost', href: '#/' }, { label: 'Overview' }], false);
  const meta = store.meta;
  const s = meta.summary;

  pageEl.innerHTML = `
    <div class="landing-hero">
      <div>
        <div class="eyebrow">Open-science resource · Early dataset release</div>
        <h1>The Bifrost dataset of AlphaFold 3 predictions for plant immune receptor discovery</h1>
        <p class="lede" style="margin-bottom:18px">
          Identifying candidate plant disease resistance genes from genome sequences by modelling pairwise complexes between NLR integrated domains and pathogen or pest proteins.
        </p>
        <div class="meta-line" style="margin-bottom:0">
          <span><b>${fmtInt(s.total_predictions)}</b> predictions</span>
          <span class="sep">·</span>
          <span><b>${fmtInt(s.total_scored)}</b> scored (98.4%)</span>
          <span class="sep">·</span>
          <span><b>${fmtInt(s.n_ids_screened)}</b> NLR IDs</span>
          <span class="sep">·</span>
          <span><b>${fmtInt(s.n_pathogens)}</b> pathogen proteins</span>
          <span class="sep">·</span>
          <span><b>14</b> Dataverse deposits</span>
        </div>
      </div>
      <img class="landing-logo" src="./assets/bifrost_logo.png" alt="Bifrost logo" />
    </div>

    <div class="tier-cards">
      <a class="tcard" href="#/explorer" style="--tc:var(--blue)">
        <div class="tn">Explorer</div>
        <div class="tt">All pairwise scores</div>
        <div class="big">${fmtInt(s.total_predictions)}<small>pairs</small></div>
        <div class="desc">Filter all 13 screening sets by <code>ipSAE_min</code>, subscores, ipTM, pDockQ, LIS, contacts, or taxonomy.</div>
        <div class="cta"><span>Open Score Explorer</span><span>&rarr;</span></div>
      </a>

      <a class="tcard" href="#/panels" style="--tc:var(--purple)">
        <div class="tn">Datasets</div>
        <div class="tt">Input panels &amp; diversity</div>
        <div class="big">8<small>curated panels</small></div>
        <div class="desc">Explore the 2,811 plant NLR integrated domains (ID1–ID3) and 373 pathogen/pest proteins (E1–E4, V1) with exploratory figures.</div>
        <div class="cta"><span>Explore Input Panels</span><span>&rarr;</span></div>
      </a>

      <a class="tcard" href="#/search" style="--tc:var(--pink)">
        <div class="tn">Sequence</div>
        <div class="tt">In-browser sequence search</div>
        <div class="big">BLOSUM62<small>local</small></div>
        <div class="desc">Paste any protein sequence or motif to search NLR IDs, pathogens, and full-length parent NLRs directly in your browser.</div>
        <div class="cta"><span>Search sequences</span><span>&rarr;</span></div>
      </a>
    </div>

    <h2>About the project</h2>
    <p class="abstract-text">
      Bifrost aims to identify candidate plant disease resistance genes from plant and pathogen genome sequences.
      Matching nucleotide-binding leucine-rich repeat immune receptors (NLRs) to the pathogen virulence proteins
      (effectors) they recognize currently depends on labour-intensive genetic and functional screens. A subset of
      NLRs carry integrated domains (IDs) that can act as baits for effectors, making these interactions tractable
      to structural modelling of defined protein pairs. Here we describe the Bifrost concept and computational
      pipeline, and release <b>757,597 AlphaFold 3 predictions</b> of pairwise complexes between NLR integrated domains
      and pathogen or pest proteins. The screens comprise 13 defined sets covering <b>2,811 integrated domains</b>
      and <b>373 effector, salivary and viral proteins</b> from 20 pathogen and pest species. The integrated domains
      derive from 343 plant species across 34 orders. We obtained interface scores for 745,832 predictions (98.4%).
      The top-ranked models, available interface scores, curated panels and cached per-chain alignments and templates
      are available from Harvard Dataverse. In keeping with our open-science commitment, we release this resource
      before experimental validation and comprehensive biological analysis. The predictions provide hypotheses for
      community analysis and testing; they do not establish effector recognition or disease resistance.
    </p>

    <h2>Concept &amp; workflow</h2>
    ${renderFigureHtml({
      src: './assets/figures/F1_concept.png',
      title: 'Figure 1. The Bifrost project concept and workflow from genome sequences to disease resistance',
      caption: '(A) Conceptual model for the evolution of NLRs with integrated domains (NLR-IDs). Domains derived from effector targets can become integrated into NLRs and mediate recognition. (B) Diverse NLR-IDs and pathogen and pest proteins are curated for pairwise AlphaFold 3 modelling within defined screening sets. Predicted complexes nominate receptor–effector pairs for experimental testing; physical binding, immune recognition and disease resistance require experimental validation.',
    })}

    <h2>Open science &amp; continuing work</h2>
    <p class="abstract-text" style="margin-bottom:14px">
      This early dataset release reflects our commitment to make Bifrost data available as soon as possible, while making
      their scope and limitations explicit. We release the data before comprehensive biological analysis and experimental
      validation because generating them requires substantial computational resources and sharing them now allows other
      laboratories to investigate candidates relevant to their own systems.
    </p>
    <p class="abstract-text">
      The predictions themselves are hypotheses: a predicted interface does not establish physical binding, activation of
      the parent NLR, or disease resistance. Calibration of confidence scores, biological interpretation, and experimental
      validation remain continuing work, and we will share our own analyses as they are completed. We welcome independent
      analyses, experimental testing, and feedback from the community via the
      <a class="ext-link" href="https://zenodo.org/communities/openplantnlr/" target="_blank" rel="noopener">OpenPlantNLR community on Zenodo &#8599;</a>
      or by contacting Sophien Kamoun (<a class="ext-link" href="mailto:sophien.kamoun@tsl.ac.uk">sophien.kamoun@tsl.ac.uk</a>).
    </p>

    <div class="callout">
      <b>AlphaFold 3 v3.0.1 · Reproducibility &amp; Terms.</b>
      Predictions were generated with AlphaFold 3 v3.0.1 (1 seed × 5 diffusion samples; top-ranked model scored with ipSAE at 10 Å PAE / 10 Å distance).
      Check reproducibility with independent seeds before relying on individual predictions. Tables and metadata are released under CC0 1.0; structure models on Harvard Dataverse are governed by the
      <a class="ext-link" href="https://github.com/google-deepmind/alphafold3/blob/main/OUTPUT_TERMS_OF_USE.md" target="_blank" rel="noopener">AF3 Output Terms of Use</a>.
      See <a class="prot-link" href="#/datasets">Dataverse DOIs</a>, <a class="prot-link" href="#/methods">Methods &amp; Terms</a>, and <a class="prot-link" href="#/acknowledgements">Acknowledgements</a>.
    </div>
  `;

  wireFigureLightboxes(pageEl);
}

/* --------------------------------------------------------------------------
   VIEW 1B: Input Panels — Introducing the IDs & Pathogens Datasets (#/panels)
   -------------------------------------------------------------------------- */
function renderInputPanels() {
  setNavAndCrumbs('panels', [{ label: 'Bifrost', href: '#/' }, { label: 'Input Panels' }], false);
  const meta = store.meta;

  const idRows = [
    { key: 'ID1', chain: 'A', prots: '922 IDs (784 NLRs)', orgs: '134 plant species, 29 orders', src: 'NCBI RefSeq proteomes', doi: meta.panels.ID1.doi, doiLbl: 'Toghani & Kamoun (2024)', href: '#/ids?panel=ID1' },
    { key: 'ID2', chain: 'A', prots: '1,194 IDs (1,041 NLRs)', orgs: '190 superasterid species, 12 orders', src: 'Helixer gene models', doi: meta.panels.ID2.doi, doiLbl: 'Toghani et al. (2025)', href: '#/ids?panel=ID2' },
    { key: 'ID3', chain: 'A', prots: '695 IDs (584 NLRs)', orgs: '54 Solanaceae species', src: 'Helixer gene models', doi: meta.panels.ID3.doi, doiLbl: 'Toghani et al. (2026)', href: '#/ids?panel=ID3' },
  ];

  const pathRows = [
    { key: 'E1', chain: 'B', prots: '73 effectors', orgs: 'P. infestans (48), G. rostochiensis (22), G. pallida (3)', src: 'RXLR & SPRYSEC effectors', doi: meta.panels.E1.doi, doiLbl: 'Derevnina et al. (2021)', href: '#/pathogens?panel=E1' },
    { key: 'E2', chain: 'B', prots: '154 proteins', orgs: 'Myzus persicae (screened vs ID1 only)', src: 'Candidate effectors & saliva', doi: `${meta.panels.E2.doi}; ${meta.panels.E2.secondary_doi}`, doiLbl: null, href: '#/pathogens?panel=E2' },
    { key: 'E3', chain: 'B', prots: '15 effectors', orgs: 'Heterodera schachtii', src: 'SPRYSEC effectors', doi: meta.panels.E3.doi, doiLbl: 'Molloy et al. (2024)', href: '#/pathogens?panel=E3' },
    { key: 'E4', chain: 'B', prots: '38 effectors', orgs: 'Bremia lactucae', src: 'RXLR-WY & WY effectors', doi: meta.panels.E4.doi, doiLbl: 'Wood et al. (2020)', href: '#/pathogens?panel=E4' },
    { key: 'V1', chain: 'B', prots: '93 proteins', orgs: '14 plant viruses across 10 families', src: 'Full viral proteomes (NCBI Datasets)', doi: meta.panels.V1.doi, doiLbl: 'NCBI Datasets', href: '#/pathogens?panel=V1' },
  ];

  pageEl.innerHTML = `
    <div class="eyebrow">Input datasets · Chain A (NLR IDs) &amp; Chain B (Pathogens)</div>
    <h1>Curated input panels</h1>
    <p class="lede">
      Bifrost pairs three plant NLR integrated domain panels (<b>2,811 non-redundant IDs</b> from 2,409 parent NLRs across 343 plant species)
      against five pathogen and pest protein panels (<b>373 effector, salivary and viral proteins</b> across 20 pathogen and pest species, including 14 plant viruses).
    </p>

    <h2>Panel summary <small>Table 1 · click any panel to browse its proteins</small></h2>
    <div class="tblwrap">
      <table class="dt">
        <thead>
          <tr><th>Panel</th><th>Chain</th><th>Proteins</th><th>Organisms</th><th>Source</th><th></th></tr>
        </thead>
        <tbody>
          ${[...idRows, ...pathRows]
            .map(
              (r) => `
              <tr>
                <td>${panelBadge(r.key)}</td>
                <td class="mono">${r.chain}</td>
                <td><b>${esc(r.prots)}</b></td>
                <td>${esc(r.orgs)}</td>
                <td>${esc(r.src)}<div style="font-size:12px;margin-top:2px">${doiLinksHtml(r.doi, r.doiLbl)}</div></td>
                <td><a class="btn btn-sm" href="${r.href}">Browse &rarr;</a></td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>

    <h2>Plant NLR integrated domains (ID1–ID3)</h2>
    <p>
      Integrated domains were mined from three complementary proteome collections at nested taxonomic resolutions:
      <b>ID1</b> from 180 NCBI RefSeq reference plant proteomes spanning green algae to eudicots,
      <b>ID2</b> from 230 Helixer-annotated superasterid genome assemblies, and
      <b>ID3</b> from 346 Helixer-annotated Solanaceae assemblies and haplotypes.
      Across all 2,811 screened IDs, <b>2,761 (98.2%)</b> sit C-terminal to the LRR domain and <b>50 (1.8%)</b> sit
      between the N-terminal domain and NB-ARC, spanning <b>437 distinct InterPro entries</b> across 87 functional categories.
    </p>

    ${renderFigureHtml({
      src: './assets/figures/F2_diversity.png',
      title: 'Figure 2. Taxonomic, architectural and functional diversity of the Bifrost input datasets',
      caption: '(A) Distribution of the 2,811 screened IDs across plant orders (top nine shown; remaining 25 grouped as Other). (B) Distribution of the 373 pathogen and pest proteins by species, and by family for viruses, coloured by organism type. (C) Domain architectures of parent NLRs carrying IDs with counts of IDs and parent NLRs. (D) Word cloud of primary InterPro entries represented among the IDs (word size proportional to ID count).',
    })}

    <h2>Pathogen &amp; pest proteins (E1–E4, V1)</h2>
    <p>
      The Chain B collection spans four major pathogen and pest groups: oomycete RXLR and WY effectors (<b>E1</b> <em>Phytophthora infestans</em>;
      <b>E4</b> <em>Bremia lactucae</em>), cyst nematode SPRYSEC effectors (<b>E1</b> <em>Globodera rostochiensis</em> and <em>G. pallida</em>;
      <b>E3</b> <em>Heterodera schachtii</em>), green peach aphid candidate effectors and salivary proteins (<b>E2</b> <em>Myzus persicae</em>, screened against ID1 only),
      and complete proteomes of 14 plant viruses across 10 families and four genome types (<b>V1</b>: 58 (+)ssRNA, 25 ssDNA, 7 dsDNA-RT, and 3 (−)ssRNA proteins).
    </p>

    ${renderFigureHtml({
      src: './assets/figures/FS1_taxonomy.png',
      title: 'Figure S1. Distribution of IDs and pathogen proteins across plant and pathogen taxonomy',
      caption: '(A) Angiosperm phylogenetic tree (adapted from Zuntini et al., 2024, with non-flowering lineages illustrated) showing ID counts per plant order coloured by source panel (ID1–ID3). (B) Number of proteins per pathogen or pest species with panel labels. (C) Viral protein counts across the ten virus families in panel V1.',
    })}

    <h2>Score landscape across the 745,832 scored pairs</h2>
    <p>
      Across all 745,832 scored predictions, <code>ipSAE (min)</code>, <code>ipTM</code>, and <code>pDockQ</code> show markedly different distributions
      (Spearman ρ = 0.64 between <code>ipTM</code> and <code>ipSAE (min)</code>): 96.4% of pairs fall in the lowest <code>ipSAE (min)</code> bin (0–0.1)
      and 79.2% score exactly zero, illustrating why score scales are not directly interchangeable across metrics and any cutoff is context-dependent.
    </p>

    ${renderFigureHtml({
      src: './assets/figures/FS3_scores.png',
      title: 'Figure S3. Interface confidence metrics differ in score distributions and rankings',
      caption: '(A) Log-scale score distributions for all 745,832 scored predictions across minimum ipSAE, AlphaFold 3 ipTM, and pDockQ, coloured by pathogen organism type. (B) Correlation between ipTM and minimum ipSAE overall and per organism type.',
    })}

    <h2>
      <span>Interactive score distributions</span>
      <div class="btn-group">
        <div class="seg" id="pan-metric-seg">
          <button type="button" data-m="ipsae" class="on">ipSAE (min)</button>
          <button type="button" data-m="iptm">ipTM</button>
          <button type="button" data-m="pdockq">pDockQ</button>
        </div>
        <button type="button" class="chip on-soft" id="pan-log-btn" style="height:29px">Log₁₀</button>
      </div>
    </h2>
    <div class="chart-box">
      <div class="chart-legend">
        ${['Oomycete', 'Nematode', 'Insect', 'Virus']
          .map((o) => `<span class="chart-legend-item"><span class="chart-legend-swatch" style="background:${ORG_COLORS[o]}"></span>${o}</span>`)
          .join('')}
      </div>
      <div id="pan-hist-mount"></div>
    </div>
  `;

  wireFigureLightboxes(pageEl);

  let metric = 'ipsae';
  let logScale = true;
  const labels = { ipsae: 'ipSAE (min)', iptm: 'ipTM (AF3)', pdockq: 'pDockQ' };
  const mount = pageEl.querySelector('#pan-hist-mount');
  const drawHist = () => {
    mount.innerHTML = renderOrgHistogramSvg(meta.histograms[metric], { metricLabel: labels[metric], logScale });
    wireInteractiveCharts(mount.closest('.chart-box') || mount);
  };
  pageEl.querySelectorAll('#pan-metric-seg button').forEach((btn) => {
    btn.addEventListener('click', () => {
      metric = btn.dataset.m;
      pageEl.querySelectorAll('#pan-metric-seg button').forEach((b) => b.classList.toggle('on', b === btn));
      drawHist();
    });
  });
  pageEl.querySelector('#pan-log-btn')?.addEventListener('click', (e) => {
    logScale = !logScale;
    e.currentTarget.classList.toggle('on-soft', logScale);
    drawHist();
  });
  drawHist();
}

/* --------------------------------------------------------------------------
   VIEW 2: NLR Integrated Domains Directory (#/ids) — with inline drop-in selects
   -------------------------------------------------------------------------- */
function renderIdsDirectory(params) {
  const meta = store.meta;
  const st = {
    q: params.get('q') || '',
    panel: params.get('panel') || '',
    sp: params.get('species') || '',
    ord: params.get('order') || '',
    cat: params.get('category') || '',
    ipr: params.get('ipr') || '',
    cls: params.get('cls') || '',
    pos: params.get('pos') || '',
    scr: params.get('scr') || 'screened',
    sortBy: 'max_ipsae',
    sortDir: 'desc',
    page: 1,
  };
  const PAGE = 50;

  setNavAndCrumbs(
    st.panel ? `ids-${st.panel}` : 'ids-all',
    [{ label: 'Bifrost', href: '#/' }, { label: 'NLR IDs', href: '#/ids' }, ...(st.panel ? [{ label: st.panel }] : [])],
    true
  );

  // Build option lists with counts
  const countBy = (arr, fn) => {
    const m = new Map();
    for (const r of arr) {
      const k = fn(r);
      if (k) m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };
  const activePool = meta.ids.filter((r) => r.scr);
  const speciesOpts = countBy(activePool, (r) => r.sp);
  const orderOpts = countBy(activePool, (r) => r.ord);
  const catOpts = countBy(activePool, (r) => r.cat);
  const classOpts = countBy(activePool, (r) => r.cls);
  const posOpts = countBy(activePool, (r) => r.pos);
  const iprMap = new Map();
  for (const r of activePool) {
    if (!r.ipr) continue;
    const prev = iprMap.get(r.ipr);
    if (prev) prev.n++;
    else iprMap.set(r.ipr, { ipr: r.ipr, short: r.ipr_s || '', n: 1 });
  }
  const iprOpts = [...iprMap.values()].sort((a, b) => b.n - a.n);

  const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;

  pageEl.innerHTML = `
    <div class="eyebrow">Chain A · Plant NLR integrated domains</div>
    <div class="page-head-row">
      <div>
        <h1>NLR integrated domains</h1>
        <p class="lede" style="margin-bottom:14px">${fmtInt(meta.summary.n_ids_screened)} screened constructs from ${meta.summary.n_plant_species} plant species (${meta.summary.n_interpro_entries} InterPro entries), with full-length parent NLR sequences.</p>
      </div>
      <div class="btn-group">
        <button type="button" class="btn btn-sm" id="ids-reset">Reset</button>
        <button type="button" class="btn btn-sm" id="ids-dl-tsv">Export TSV</button>
        <button type="button" class="btn btn-sm" id="ids-dl-fasta">ID FASTA</button>
        <button type="button" class="btn btn-sm btn-primary" id="ids-dl-parent-fasta">Parent NLR FASTA</button>
      </div>
    </div>

    <div class="tools">
      <input type="search" id="id-q" value="${esc(st.q)}" placeholder="Search ID name, species, accession, InterPro…" />
      <button type="button" class="chip${st.panel === '' ? ' on' : ''}" data-ipanel="">All</button>
      <button type="button" class="chip${st.panel === 'ID1' ? ' on' : ''}" data-ipanel="ID1"><span class="dot" style="background:var(--cyan)"></span>ID1 · RefSeq</button>
      <button type="button" class="chip${st.panel === 'ID2' ? ' on' : ''}" data-ipanel="ID2"><span class="dot" style="background:var(--purple)"></span>ID2 · Superasterids</button>
      <button type="button" class="chip${st.panel === 'ID3' ? ' on' : ''}" data-ipanel="ID3"><span class="dot" style="background:var(--pink)"></span>ID3 · Solanaceae</button>
    </div>

    <div class="select-bar" aria-label="Filter NLR integrated domains">
      <div class="field">
        <label for="id-sp">Plant species</label>
        <select id="id-sp">
          ${opt('', `All species (${speciesOpts.length})`, st.sp)}
          ${speciesOpts.map(([k, n]) => opt(k, `${k} (${n})`, st.sp)).join('')}
        </select>
      </div>
      <div class="field">
        <label for="id-ord">Plant order</label>
        <select id="id-ord">
          ${opt('', `All orders (${orderOpts.length})`, st.ord)}
          ${orderOpts.map(([k, n]) => opt(k, `${k} (${n})`, st.ord)).join('')}
        </select>
      </div>
      <div class="field">
        <label for="id-cat">InterPro category</label>
        <select id="id-cat">
          ${opt('', `All categories (${catOpts.length})`, st.cat)}
          ${catOpts.map(([k, n]) => opt(k, `${k} (${n})`, st.cat)).join('')}
        </select>
      </div>
      <div class="field">
        <label for="id-ipr">Primary InterPro</label>
        <select id="id-ipr">
          ${opt('', `All InterPro (${iprOpts.length})`, st.ipr)}
          ${iprOpts.map((x) => opt(x.ipr, `${x.ipr}${x.short ? ` · ${x.short}` : ''} (${x.n})`, st.ipr)).join('')}
        </select>
      </div>
      <div class="field">
        <label for="id-cls">Parent NLR class</label>
        <select id="id-cls">
          ${opt('', 'All NLR classes', st.cls)}
          ${classOpts.map(([k, n]) => opt(k, `${k} (${n})`, st.cls)).join('')}
        </select>
      </div>
      <div class="field">
        <label for="id-pos">ID position</label>
        <select id="id-pos">
          ${opt('', 'All positions', st.pos)}
          ${posOpts.map(([k, n]) => opt(k, `${k} (${n})`, st.pos)).join('')}
        </select>
      </div>
      <div class="field">
        <label for="id-scr">Status</label>
        <select id="id-scr">
          ${opt('screened', 'Screened (2,811)', st.scr)}
          ${opt('all', 'All records (2,815)', st.scr)}
          ${opt('unscreened', 'Excluded (4)', st.scr)}
        </select>
      </div>
    </div>

    <div class="table-meta" id="ids-meta"></div>
    <div class="tblwrap" id="ids-tbl"></div>
    <div class="pagination" id="ids-pag"></div>
  `;

  let currentRows = [];

  const idFacetSpecs = [
    { sel: '#id-sp', key: 'sp', getter: (r) => r.sp, allLabel: (n) => `All species (${n})` },
    { sel: '#id-ord', key: 'ord', getter: (r) => r.ord, allLabel: (n) => `All orders (${n})` },
    { sel: '#id-cat', key: 'cat', getter: (r) => r.cat, allLabel: (n) => `All categories (${n})` },
    {
      sel: '#id-ipr',
      key: 'ipr',
      getter: (r) => r.ipr,
      metaGetter: (r) => r.ipr_s || '',
      sort: 'count',
      allLabel: (n) => `All InterPro (${n})`,
      formatOpt: (v, n, short) => `${v}${short ? ` · ${short}` : ''} (${n})`,
    },
    { sel: '#id-cls', key: 'cls', getter: (r) => r.cls, allLabel: (n) => `All NLR classes (${n})` },
    { sel: '#id-pos', key: 'pos', getter: (r) => r.pos, allLabel: (n) => `All positions (${n})` },
  ];

  function syncIdDropins(changedKey = null) {
    const q = st.q.trim().toLowerCase();
    const basePool = meta.ids.filter((r) => {
      if (st.scr === 'screened' && !r.scr) return false;
      if (st.scr === 'unscreened' && r.scr) return false;
      if (st.panel && r.s !== st.panel) return false;
      if (q && !r._q.includes(q)) return false;
      return true;
    });
    syncFacetedSelects(basePool, idFacetSpecs, st, pageEl, changedKey);
  }

  function draw(changedKey = null) {
    syncIdDropins(changedKey);
    const q = st.q.trim().toLowerCase();
    currentRows = meta.ids.filter((r) => {
      if (st.scr === 'screened' && !r.scr) return false;
      if (st.scr === 'unscreened' && r.scr) return false;
      if (st.panel && r.s !== st.panel) return false;
      if (st.sp && r.sp !== st.sp) return false;
      if (st.ord && r.ord !== st.ord) return false;
      if (st.cat && r.cat !== st.cat) return false;
      if (st.ipr && r.ipr !== st.ipr) return false;
      if (st.cls && r.cls !== st.cls) return false;
      if (st.pos && r.pos !== st.pos) return false;
      if (q && !r._q.includes(q)) return false;
      return true;
    });

    const dir = st.sortDir === 'asc' ? 1 : -1;
    currentRows.sort((a, b) => {
      const av = a[st.sortBy];
      const bv = b[st.sortBy];
      return typeof av === 'string' ? av.localeCompare(bv) * dir : ((av || 0) - (bv || 0)) * dir;
    });

    const totalPages = Math.max(1, Math.ceil(currentRows.length / PAGE));
    if (st.page > totalPages) st.page = totalPages;
    const slice = currentRows.slice((st.page - 1) * PAGE, st.page * PAGE);
    const start = currentRows.length ? (st.page - 1) * PAGE + 1 : 0;
    const end = Math.min(currentRows.length, st.page * PAGE);

    pageEl.querySelectorAll('[data-ipanel]').forEach((b) => b.classList.toggle('on', b.dataset.ipanel === st.panel));
    pageEl.querySelector('#ids-meta').innerHTML = `
      <div>Showing <b>${fmtInt(start)}–${fmtInt(end)}</b> of <b>${fmtInt(currentRows.length)}</b> domains</div>
      <div>Click any ID for parent NLR architecture, sequences, and partner scores</div>
    `;

    const th = (k, lbl, num = false) => {
      const act = st.sortBy === k;
      const ariaSort = act ? (st.sortDir === 'desc' ? 'descending' : 'ascending') : 'none';
      return `<th class="sortable${act ? ' sorted' : ''}${num ? ' num' : ''}" data-sort="${k}" tabindex="0" role="columnheader" aria-sort="${ariaSort}">${esc(lbl)}${act ? (st.sortDir === 'desc' ? ' ↓' : ' ↑') : ''}</th>`;
    };

    pageEl.querySelector('#ids-tbl').innerHTML = `
      <table class="dt">
        <thead>
          <tr>
            ${th('s', 'Panel')}
            ${th('id', 'Integrated Domain')}
            ${th('sp', 'Species')}
            ${th('ipr', 'InterPro')}
            ${th('arch', 'NLR')}
            ${th('len', 'Length', true)}
            ${th('max_ipsae', 'Best ipSAE', true)}
            <th>Top Partner</th>
          </tr>
        </thead>
        <tbody>
          ${
            slice.length
              ? slice
                  .map((r) => {
                    const topP = r.top_p >= 0 ? meta.pathogens[r.top_p] : null;
                    return `
                      <tr>
                        <td>${panelBadge(r.s)}${!r.scr ? ' <span class="badge badge-warn">Excl.</span>' : ''}</td>
                        <td><a class="prot-link cell-trunc" style="max-width:190px" href="#/id/${encodeURIComponent(r.id)}" title="${esc(r.id)}">${esc(r.id)}</a></td>
                        <td><span class="italic">${esc(r.sp)}</span><div class="muted" style="font-size:11.5px">${esc(r.ord || r.fam)}</div></td>
                        <td>${interproLinksHtml(r.ipr, true)}<div class="muted" style="font-size:11.5px">${esc(r.ipr_s || '')}</div></td>
                        <td style="white-space:nowrap"><span class="mono" style="font-size:12px">${esc(r.arch)}</span></td>
                        <td class="num">${r.len} <span class="muted">/ ${r.plen}</span></td>
                        <td class="num">${bestScoreCell(r, true)}</td>
                        <td>${topP ? `<a class="prot-link" style="white-space:nowrap" href="#/pathogen/${encodeURIComponent(topP.id)}">${esc(topP.id)}</a>` : '<span class="muted">—</span>'}</td>
                      </tr>
                    `;
                  })
                  .join('')
              : '<tr><td colspan="8" style="text-align:center;padding:36px" class="muted">No NLR IDs match these filters.</td></tr>'
          }
        </tbody>
      </table>
    `;

    pageEl.querySelectorAll('#ids-tbl th.sortable').forEach((el) => {
      const triggerSort = () => {
        const k = el.dataset.sort;
        if (st.sortBy === k) st.sortDir = st.sortDir === 'desc' ? 'asc' : 'desc';
        else { st.sortBy = k; st.sortDir = (k === 'max_ipsae' || k === 'len') ? 'desc' : 'asc'; }
        st.page = 1;
        draw();
      };
      el.addEventListener('click', triggerSort);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); triggerSort(); }
      });
    });

    pageEl.querySelector('#ids-pag').innerHTML = `
      <div>Page <b>${st.page}</b> of <b>${totalPages}</b></div>
      <div class="btn-group">
        <button type="button" class="btn btn-sm" id="ip-prev" ${st.page <= 1 ? 'disabled' : ''}>Prev</button>
        <button type="button" class="btn btn-sm" id="ip-next" ${st.page >= totalPages ? 'disabled' : ''}>Next</button>
      </div>
    `;
    pageEl.querySelector('#ip-prev')?.addEventListener('click', () => { st.page = Math.max(1, st.page - 1); draw(); });
    pageEl.querySelector('#ip-next')?.addEventListener('click', () => { st.page = Math.min(totalPages, st.page + 1); draw(); });
  }

  pageEl.querySelectorAll('[data-ipanel]').forEach((b) => {
    b.addEventListener('click', () => { st.panel = b.dataset.ipanel; st.page = 1; draw('panel'); });
  });
  const bind = (sel, k, ev = 'change') => {
    pageEl.querySelector(sel)?.addEventListener(ev, (e) => { st[k] = e.target.value; st.page = 1; draw(k); });
  };
  bind('#id-q', 'q', 'input');
  bind('#id-sp', 'sp');
  bind('#id-ord', 'ord');
  bind('#id-cat', 'cat');
  bind('#id-ipr', 'ipr');
  bind('#id-cls', 'cls');
  bind('#id-pos', 'pos');
  bind('#id-scr', 'scr');

  pageEl.querySelector('#ids-reset')?.addEventListener('click', () => {
    renderIdsDirectory(new URLSearchParams());
  });

  pageEl.querySelector('#ids-dl-tsv')?.addEventListener('click', () => {
    const hdr = ['panel', 'id_name', 'screened', 'species', 'family', 'order', 'source', 'accession', 'architecture', 'nlr_class', 'id_start', 'id_end', 'id_length', 'parent_length', 'first_interpro', 'interpro_category', 'max_ipsae_min', 'max_iptm', 'id_sequence'];
    exportDelimited('bifrost_nlr_ids.tsv', hdr, currentRows.map((r) => [r.s, r.id, r.scr, r.sp, r.fam, r.ord, r.src, r.acc, r.arch, r.cls, r.st, r.en, r.len, r.plen, r.ipr, r.cat, r.max_ipsae, r.max_iptm, r.seq]), '\t');
  });
  pageEl.querySelector('#ids-dl-fasta')?.addEventListener('click', () => {
    triggerDownload('bifrost_nlr_ids.fasta', currentRows.map((r) => formatFasta(`${r.id} | ${r.s} | ${r.sp} | ${r.ipr} | ${r.st}-${r.en}/${r.plen}`, r.seq)).join(''));
  });
  pageEl.querySelector('#ids-dl-parent-fasta')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const orig = btn.textContent;
    btn.textContent = 'Loading…';
    btn.disabled = true;
    try {
      const parents = await store.loadParentNlrs();
      const seen = new Set();
      const parts = [];
      for (const r of currentRows) {
        if (seen.has(r.pnlr)) continue;
        seen.add(r.pnlr);
        parts.push(formatFasta(`${r.pnlr} | ${r.s} | ${r.sp} | ${r.arch} | ${r.plen}aa`, parents[r.i] || ''));
      }
      triggerDownload('bifrost_parent_nlrs.fasta', parts.join(''));
    } finally { btn.textContent = orig; btn.disabled = false; }
  });

  draw();
}

/* --------------------------------------------------------------------------
   VIEW 3: NLR ID Wiki Detail Page (#/id/<id_name>)
   -------------------------------------------------------------------------- */
async function renderIdDetail(idName, gen) {
  const meta = store.meta;
  const r = store.idByName.get(idName);
  if (!r) {
    setNavAndCrumbs('ids-all', [{ label: 'Bifrost', href: '#/' }, { label: 'NLR IDs', href: '#/ids' }, { label: 'Not found' }]);
    pageEl.innerHTML = `<div class="callout warn">NLR Integrated Domain <code>${esc(idName)}</code> was not found. <a class="prot-link" href="#/ids">Browse all NLR IDs &rarr;</a></div>`;
    return;
  }

  setNavAndCrumbs(
    `ids-${r.s}`,
    [{ label: 'Bifrost', href: '#/' }, { label: 'NLR IDs', href: '#/ids' }, { label: r.s, href: `#/ids?panel=${r.s}` }, { label: r.id }],
    false
  );
  const panelMeta = meta.panels[r.s];
  const siblings = meta.ids.filter((x) => x.s === r.s && x.pnlr === r.pnlr && x.id !== r.id);

  pageEl.innerHTML = `
    <div class="eyebrow">
      ${panelBadge(r.s)}
      <span>${esc(r.cls)} · ${esc(r.arch)}</span>
      ${r.cat ? `<span>· ${esc(r.cat)}</span>` : ''}
      ${!r.scr ? '<span class="badge badge-warn">Not screened</span>' : ''}
    </div>
    <div class="page-head-row">
      <div style="min-width:0;flex:1">
        <h1 class="mono-title">${esc(r.id)}</h1>
        <p class="lede" style="margin-bottom:16px">
          <span class="italic">${esc(r.sp)}</span> (${esc([r.fam, r.ord].filter(Boolean).join(', '))}) — ${esc(r.ipr_n || r.ipr_s)}.
        </p>
      </div>
      <div class="btn-group">
        <a class="btn btn-sm" href="#/search?prefill=id&name=${encodeURIComponent(r.id)}">Search similar</a>
        <button type="button" class="btn btn-sm btn-primary" id="id-dl-both">Download FASTA</button>
      </div>
    </div>

    ${!r.scr ? `<div class="callout warn"><b>Excluded from AF3 runs.</b> Present in <code>Bifrost_IDs_metadata.tsv</code>, but not included in the 695 screened ID3 constructs.</div>` : ''}

    <div class="facts">
      <div class="fact"><div class="k">Best ipSAE (min)</div><div class="v big-num">${!r.scr || r.n_ok === 0 ? '—' : r.max_ipsae.toFixed(3)}<small>${!r.scr ? 'Unscreened' : r.n_ok === 0 ? `All ${fmtInt(r.n_fail)} failed` : `${fmtInt(r.n_ok)} scored${r.n_fail ? ` · ${fmtInt(r.n_fail)} failed` : ''}${r.n_miss ? ` · ${fmtInt(r.n_miss)} missing` : ''} · ipTM ${r.max_iptm.toFixed(3)}`}</small></div></div>
      <div class="fact"><div class="k">ID coordinates</div><div class="v mono">${r.st}–${r.en}<small>${r.len} aa of ${r.plen} aa parent</small></div></div>
      <div class="fact"><div class="k">InterPro</div><div class="v">${interproLinksHtml(r.iprs || r.ipr)}<small>${esc(r.ipr_s || '')}</small></div></div>
      <div class="fact"><div class="k">Accession</div><div class="v">${accessionLinkHtml(r.acc, r.s)}<small>${r.asm ? esc(r.asm) : esc(r.src)}</small></div></div>
      <div class="fact"><div class="k">Source dataset</div><div class="v">${doiLinksHtml(panelMeta.doi, panelMeta.source)}<small>${esc(r.src)}</small></div></div>
      <div class="fact"><div class="k">NLR architecture</div><div class="v mono" style="font-size:12px">${esc(r.dom || r.arch)}<small>${esc(r.pos || r.sub || '')}</small></div></div>
      <div class="fact"><div class="k">Parent NLR</div><div class="v mono" style="font-size:11.5px">${esc(r.pnlr)}</div></div>
      <div class="fact"><div class="k">AF3 Chain A</div><div class="v mono" style="font-size:11.5px">${esc(r.af3 || '—')}</div></div>
    </div>

    <h2>Parent NLR architecture <small>NLRtracker domain boundaries · excised ID (${r.st}–${r.en} aa) highlighted within ${r.plen} aa parent${siblings.length ? ` · +${siblings.length} sibling ID${siblings.length > 1 ? 's' : ''}` : ''}</small></h2>
    <div class="chart-box" style="padding:16px 18px">
      ${renderNlrSchematicSvg(r, { siblings })}
    </div>

    <div id="id-nearest-mount"></div>

    <h2>
      <span>Sequences</span>
      <div class="seg" id="seq-tabs">
        <button type="button" data-tab="id" class="on">Excised ID (${r.len} aa)</button>
        <button type="button" data-tab="parent">Full-length parent NLR (${r.plen} aa)</button>
      </div>
    </h2>
    <div class="seq-box">
      <div class="seq-head">
        <div id="seq-caption"><b>Excised ID (AF3 Chain A)</b> <span class="muted mono" style="font-size:12px">· ${r.len} aa</span></div>
        <div class="btn-group">
          <button type="button" class="btn btn-sm" id="seq-copy">Copy sequence</button>
          <button type="button" class="btn btn-sm" id="seq-dl">Download FASTA</button>
        </div>
      </div>
      <div class="seq-body" id="seq-body">${renderFormattedSequence(r.seq)}</div>
    </div>

    ${
      r.scr
        ? `
      <h2>
        <span>Screened pathogen &amp; pest partners</span>
        <div class="btn-group">
          <button type="button" class="btn btn-sm btn-primary" id="id-exp-tsv" disabled>Export TSV</button>
          <button type="button" class="btn btn-sm" id="id-exp-csv" disabled>CSV</button>
        </div>
      </h2>
      ${r.s !== 'ID1' ? `<div class="callout" style="margin-top:8px"><b>Coverage note:</b> Panel E2 (<em>Myzus persicae</em>, 154 proteins) was screened against ID1 only. This ${esc(r.s)} construct was screened against 219 pathogen/pest proteins (E1, E3, E4, V1).</div>` : ''}
      <div id="id-pairs-mount"><div class="center-loading" style="padding:36px 0"><div class="spinner"></div><div>Loading ${esc(r.s)} scores…</div></div></div>
    `
        : ''
    }
  `;

  wireInteractiveCharts(pageEl);
  renderNearestSeqCard(pageEl.querySelector('#id-nearest-mount'), r, 'id', meta);

  // Tabbed sequence viewer (ID vs full-length Parent NLR)
  let currentTab = 'id';
  let parentSeq = store.parentNlrs ? (store.parentNlrs[r.i] || '') : null;
  let parentErr = null;
  const idFasta = formatFasta(`${r.id} | ${r.s} | ${r.sp} | ${r.ipr} | ${r.st}-${r.en}/${r.plen}`, r.seq);

  const renderSeqTab = () => {
    const cap = pageEl.querySelector('#seq-caption');
    const body = pageEl.querySelector('#seq-body');
    if (currentTab === 'id') {
      cap.innerHTML = `<b>Excised ID (AF3 Chain A)</b> <span class="muted mono" style="font-size:12px">· ${r.len} aa</span>`;
      body.innerHTML = renderFormattedSequence(r.seq);
    } else {
      cap.innerHTML = `<b>Full-length parent NLR</b> <span class="muted mono" style="font-size:12px">· ${r.plen} aa · </span><span class="seq-hl-id" style="padding:1px 6px;font-size:11.5px">ID ${r.st}–${r.en}</span>`;
      if (parentSeq !== null) {
        body.innerHTML = renderFormattedSequence(parentSeq, [{ start: r.st, end: r.en, cls: 'seq-hl-id' }]);
      } else if (parentErr) {
        body.innerHTML = `<span class="muted">Failed to load parent NLR sequence (${esc(parentErr)}).</span>`;
      } else {
        body.innerHTML = '<span class="muted">Loading full-length parent NLR sequence…</span>';
      }
    }
  };

  pageEl.querySelectorAll('#seq-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      pageEl.querySelectorAll('#seq-tabs button').forEach((b) => b.classList.toggle('on', b === btn));
      renderSeqTab();
    });
  });

  pageEl.querySelector('#seq-copy')?.addEventListener('click', (e) => {
    const seq = currentTab === 'id' ? r.seq : (parentSeq || '');
    if (seq) copyToClipboard(seq, e.currentTarget);
  });
  pageEl.querySelector('#seq-dl')?.addEventListener('click', () => {
    if (currentTab === 'id') triggerDownload(`${r.id}_ID.fasta`, idFasta);
    else if (parentSeq) triggerDownload(`${r.pnlr}_parent.fasta`, formatFasta(`${r.pnlr} | parent_NLR | ${r.s} | ${r.sp} | ID=${r.st}-${r.en}`, parentSeq));
  });

  pageEl.querySelector('#id-dl-both')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (parentSeq === null) {
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Loading…';
      try {
        const parents = await store.loadParentNlrs();
        parentSeq = parents[r.i] || '';
        parentErr = null;
      } catch (err) {
        parentErr = err?.message || 'network error';
        btn.textContent = 'Load failed';
        setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1800);
        return;
      }
      btn.textContent = orig;
      btn.disabled = false;
    }
    const pFasta = parentSeq ? formatFasta(`${r.pnlr} | parent_NLR | ${r.s} | ${r.sp} | ID=${r.st}-${r.en}`, parentSeq) : '';
    triggerDownload(`${r.id}_ID_and_parent.fasta`, idFasta + pFasta);
  });

  if (parentSeq === null) {
    store
      .loadParentNlrs()
      .then((parents) => {
        if (gen !== routeGen) return;
        parentSeq = parents[r.i] || '';
        parentErr = null;
        if (currentTab === 'parent') renderSeqTab();
      })
      .catch((err) => {
        if (gen !== routeGen) return;
        parentErr = err?.message || 'network error';
        if (currentTab === 'parent') renderSeqTab();
      });
  }

  if (!r.scr) return;
  store
    .getPairsForId(r)
    .then((pairs) => {
      if (gen !== routeGen) return;
      renderPartnerTable({
        mount: pageEl.querySelector('#id-pairs-mount'),
        pairs,
        mode: 'id',
        entityName: r.id,
        meta,
        exportTsvBtn: pageEl.querySelector('#id-exp-tsv'),
        exportCsvBtn: pageEl.querySelector('#id-exp-csv'),
      });
    })
    .catch((err) => {
      if (gen !== routeGen) return;
      const mount = pageEl.querySelector('#id-pairs-mount');
      if (mount) mount.innerHTML = `<div class="callout warn"><b>Failed to load ${esc(r.s)} scores:</b> ${esc(err?.message || 'network error')}</div>`;
    });
}

/* --------------------------------------------------------------------------
   VIEW 4: Pathogens Directory (#/pathogens) — with inline drop-in selects
   -------------------------------------------------------------------------- */
function renderPathogensDirectory(params) {
  const meta = store.meta;
  const st = {
    q: params.get('q') || '',
    panel: params.get('panel') || '',
    org: params.get('org') || '',
    sp: params.get('species') || '',
    cls: params.get('cls') || '',
    fam: params.get('family') || '',
    sortBy: 'max_ipsae',
    sortDir: 'desc',
    page: 1,
  };
  const PAGE = 50;

  setNavAndCrumbs(
    st.org ? `path-${st.org}` : 'path-all',
    [{ label: 'Bifrost', href: '#/' }, { label: 'Pathogens', href: '#/pathogens' }, ...(st.org ? [{ label: st.org }] : [])],
    true
  );

  const countBy = (arr, fn) => {
    const m = new Map();
    for (const r of arr) {
      const k = fn(r);
      if (k) m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };
  const speciesOpts = countBy(meta.pathogens, (r) => r.sp);
  const classOpts = countBy(meta.pathogens, (r) => r.cls);
  const famOpts = countBy(meta.pathogens, (r) => r.fam);
  const orgOpts = ['Oomycete', 'Nematode', 'Insect', 'Virus'].map((o) => [o, meta.pathogens.filter((r) => r.org === o).length]);
  const panelOpts = ['E1', 'E2', 'E3', 'E4', 'V1'].map((p) => [p, `${p} · ${meta.panels[p].short} (${meta.pathogens.filter((r) => r.s === p).length})`]);
  const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;

  pageEl.innerHTML = `
    <div class="eyebrow">Chain B · Pathogen &amp; pest proteins</div>
    <div class="page-head-row">
      <div>
        <h1>Pathogen &amp; pest proteins</h1>
        <p class="lede" style="margin-bottom:14px">${fmtInt(meta.summary.n_pathogens)} effectors, salivary proteins, and viral proteins across 5 panels (E1–E4, V1) and ${meta.summary.n_pathogen_species} species.</p>
      </div>
      <div class="btn-group">
        <button type="button" class="btn btn-sm" id="pa-reset">Reset</button>
        <button type="button" class="btn btn-sm" id="pa-dl-tsv">Export TSV</button>
        <button type="button" class="btn btn-sm btn-primary" id="pa-dl-fasta">Download FASTA</button>
      </div>
    </div>

    <div class="tools">
      <input type="search" id="pa-q" value="${esc(st.q)}" placeholder="Search protein name, species, accession, source…" />
      <button type="button" class="chip${st.org === '' ? ' on' : ''}" data-porg="">All</button>
      ${['Oomycete', 'Nematode', 'Insect', 'Virus']
        .map((o) => `<button type="button" class="chip${st.org === o ? ' on' : ''}" data-porg="${o}"><span class="dot" style="background:${ORG_COLORS[o]}"></span>${o}</button>`)
        .join('')}
    </div>

    <div class="select-bar" aria-label="Filter pathogen and pest proteins">
      <div class="field">
        <label for="pa-sp">Species / virus</label>
        <select id="pa-sp">
          ${opt('', `All species (${speciesOpts.length})`, st.sp)}
          ${speciesOpts.map(([k, n]) => opt(k, `${k} (${n})`, st.sp)).join('')}
        </select>
      </div>
      <div class="field">
        <label for="pa-org-sel">Organism type</label>
        <select id="pa-org-sel">
          ${opt('', 'All organism types', st.org)}
          ${orgOpts.map(([k, n]) => opt(k, `${k} (${n})`, st.org)).join('')}
        </select>
      </div>
      <div class="field">
        <label for="pa-panel-sel">Panel</label>
        <select id="pa-panel-sel">
          ${opt('', 'All panels (E1–E4, V1)', st.panel)}
          ${panelOpts.map(([k, lbl]) => opt(k, lbl, st.panel)).join('')}
        </select>
      </div>
      <div class="field">
        <label for="pa-cls">Protein class / genome</label>
        <select id="pa-cls">
          ${opt('', `All classes (${classOpts.length})`, st.cls)}
          ${classOpts.map(([k, n]) => opt(k, `${k} (${n})`, st.cls)).join('')}
        </select>
      </div>
      <div class="field">
        <label for="pa-fam">Taxonomic family</label>
        <select id="pa-fam">
          ${opt('', `All families (${famOpts.length})`, st.fam)}
          ${famOpts.map(([k, n]) => opt(k, `${k} (${n})`, st.fam)).join('')}
        </select>
      </div>
    </div>

    <div class="table-meta" id="pa-meta"></div>
    <div class="tblwrap" id="pa-tbl"></div>
    <div class="pagination" id="pa-pag"></div>
  `;

  let currentRows = [];

  const pathFacetSpecs = [
    { sel: '#pa-sp', key: 'sp', getter: (r) => r.sp, allLabel: (n) => `All species (${n})` },
    { sel: '#pa-org-sel', key: 'org', getter: (r) => r.org, order: ['Oomycete', 'Nematode', 'Insect', 'Virus'], allLabel: (n) => `All organism types (${n})` },
    {
      sel: '#pa-panel-sel',
      key: 'panel',
      getter: (r) => r.s,
      order: ['E1', 'E2', 'E3', 'E4', 'V1'],
      allLabel: (n) => `All panels (${n})`,
      formatOpt: (v, n) => `${v} · ${meta.panels[v].short} (${n})`,
    },
    { sel: '#pa-cls', key: 'cls', getter: (r) => r.cls, allLabel: (n) => `All classes (${n})` },
    { sel: '#pa-fam', key: 'fam', getter: (r) => r.fam, allLabel: (n) => `All families (${n})` },
  ];

  function syncPathDropins(changedKey = null) {
    const q = st.q.trim().toLowerCase();
    const basePool = q ? meta.pathogens.filter((r) => r._q.includes(q)) : meta.pathogens;
    syncFacetedSelects(basePool, pathFacetSpecs, st, pageEl, changedKey);
  }

  function draw(changedKey = null) {
    syncPathDropins(changedKey);
    const q = st.q.trim().toLowerCase();
    currentRows = meta.pathogens.filter((r) => {
      if (st.panel && r.s !== st.panel) return false;
      if (st.org && r.org !== st.org) return false;
      if (st.sp && r.sp !== st.sp) return false;
      if (st.cls && r.cls !== st.cls) return false;
      if (st.fam && r.fam !== st.fam) return false;
      if (q && !r._q.includes(q)) return false;
      return true;
    });
    const dir = st.sortDir === 'asc' ? 1 : -1;
    currentRows.sort((a, b) => {
      const av = a[st.sortBy];
      const bv = b[st.sortBy];
      return typeof av === 'string' ? av.localeCompare(bv) * dir : ((av || 0) - (bv || 0)) * dir;
    });

    const totalPages = Math.max(1, Math.ceil(currentRows.length / PAGE));
    if (st.page > totalPages) st.page = totalPages;
    const slice = currentRows.slice((st.page - 1) * PAGE, st.page * PAGE);
    const start = currentRows.length ? (st.page - 1) * PAGE + 1 : 0;
    const end = Math.min(currentRows.length, st.page * PAGE);

    pageEl.querySelectorAll('[data-porg]').forEach((b) => b.classList.toggle('on', b.dataset.porg === st.org));
    const orgSel = pageEl.querySelector('#pa-org-sel');
    if (orgSel && orgSel.value !== st.org) orgSel.value = st.org;

    pageEl.querySelector('#pa-meta').innerHTML = `
      <div>Showing <b>${fmtInt(start)}–${fmtInt(end)}</b> of <b>${fmtInt(currentRows.length)}</b> proteins</div>
      <div>Click any protein for provenance, sequence, and all screened NLR IDs</div>
    `;

    const th = (k, lbl, num = false) => {
      const act = st.sortBy === k;
      const ariaSort = act ? (st.sortDir === 'desc' ? 'descending' : 'ascending') : 'none';
      return `<th class="sortable${act ? ' sorted' : ''}${num ? ' num' : ''}" data-sort="${k}" tabindex="0" role="columnheader" aria-sort="${ariaSort}">${esc(lbl)}${act ? (st.sortDir === 'desc' ? ' ↓' : ' ↑') : ''}</th>`;
    };

    pageEl.querySelector('#pa-tbl').innerHTML = `
      <table class="dt">
        <thead>
          <tr>
            ${th('s', 'Panel')}
            ${th('id', 'Protein')}
            ${th('org', 'Organism')}
            ${th('sp', 'Species / Virus')}
            ${th('cls', 'Class')}
            ${th('len', 'Length', true)}
            ${th('max_ipsae', 'Best ipSAE', true)}
            <th>Top NLR ID</th>
          </tr>
        </thead>
        <tbody>
          ${
            slice.length
              ? slice
                  .map((r) => {
                    const topId = r.top_id >= 0 ? meta.ids[r.top_id] : null;
                    return `
                      <tr>
                        <td><span class="badge">${esc(r.s)}</span></td>
                        <td><a class="prot-link" href="#/pathogen/${encodeURIComponent(r.id)}">${esc(r.id)}</a></td>
                        <td>${orgBadge(r.org)}</td>
                        <td class="italic">${esc(r.sp)}</td>
                        <td>${esc(r.cls || '—')}${r.nwy ? ` <span class="muted">(${r.nwy} WY)</span>` : ''}</td>
                        <td class="num">${r.len} aa</td>
                        <td class="num">${bestScoreCell(r, false)}</td>
                        <td>${topId ? `<a class="prot-link cell-trunc" style="max-width:205px" href="#/id/${encodeURIComponent(topId.id)}">${esc(topId.ipr_s || topId.ipr)} · ${esc(topId.sp)}</a>` : '—'}</td>
                      </tr>
                    `;
                  })
                  .join('')
              : '<tr><td colspan="8" style="text-align:center;padding:36px" class="muted">No pathogen proteins match these filters.</td></tr>'
          }
        </tbody>
      </table>
    `;

    pageEl.querySelectorAll('#pa-tbl th.sortable').forEach((el) => {
      const triggerSort = () => {
        const k = el.dataset.sort;
        if (st.sortBy === k) st.sortDir = st.sortDir === 'desc' ? 'asc' : 'desc';
        else { st.sortBy = k; st.sortDir = (k === 'max_ipsae' || k === 'len') ? 'desc' : 'asc'; }
        st.page = 1;
        draw();
      };
      el.addEventListener('click', triggerSort);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); triggerSort(); }
      });
    });

    pageEl.querySelector('#pa-pag').innerHTML = `
      <div>Page <b>${st.page}</b> of <b>${totalPages}</b></div>
      <div class="btn-group">
        <button type="button" class="btn btn-sm" id="pp-prev" ${st.page <= 1 ? 'disabled' : ''}>Prev</button>
        <button type="button" class="btn btn-sm" id="pp-next" ${st.page >= totalPages ? 'disabled' : ''}>Next</button>
      </div>
    `;
    pageEl.querySelector('#pp-prev')?.addEventListener('click', () => { st.page = Math.max(1, st.page - 1); draw(); });
    pageEl.querySelector('#pp-next')?.addEventListener('click', () => { st.page = Math.min(totalPages, st.page + 1); draw(); });
  }

  pageEl.querySelector('#pa-q')?.addEventListener('input', (e) => { st.q = e.target.value; st.page = 1; draw('q'); });
  pageEl.querySelectorAll('[data-porg]').forEach((b) => {
    b.addEventListener('click', () => { st.org = b.dataset.porg; st.page = 1; draw('org'); });
  });
  const bind = (sel, k) => {
    pageEl.querySelector(sel)?.addEventListener('change', (e) => { st[k] = e.target.value; st.page = 1; draw(k); });
  };
  bind('#pa-sp', 'sp');
  bind('#pa-org-sel', 'org');
  bind('#pa-panel-sel', 'panel');
  bind('#pa-cls', 'cls');
  bind('#pa-fam', 'fam');
  pageEl.querySelector('#pa-reset')?.addEventListener('click', () => renderPathogensDirectory(new URLSearchParams()));

  pageEl.querySelector('#pa-dl-tsv')?.addEventListener('click', () => {
    const hdr = ['panel', 'protein', 'organism_type', 'species', 'kingdom', 'order', 'family', 'protein_class', 'n_WY', 'ncbi_accession', 'genome_assembly', 'source', 'source_url', 'length', 'n_screened', 'max_ipsae_min', 'max_iptm', 'sequence'];
    exportDelimited('bifrost_pathogens.tsv', hdr, currentRows.map((r) => [r.s, r.id, r.org, r.sp, r.kng, r.ord, r.fam, r.cls, r.nwy ?? '', r.acc, r.asm || '', r.src, r.doi, r.len, r.n_scr, r.max_ipsae, r.max_iptm, r.seq]), '\t');
  });
  pageEl.querySelector('#pa-dl-fasta')?.addEventListener('click', () => {
    triggerDownload('bifrost_pathogens.fasta', currentRows.map((r) => formatFasta(`${r.id} | ${r.s} | ${r.org} | ${r.sp} | ${r.cls}`, r.seq)).join(''));
  });

  draw();
}

/* --------------------------------------------------------------------------
   VIEW 5: Pathogen Detail Page (#/pathogen/<protein>)
   -------------------------------------------------------------------------- */
async function renderPathogenDetail(protName, gen) {
  const meta = store.meta;
  const r = store.pathByName.get(protName);
  if (!r) {
    setNavAndCrumbs('path-all', [{ label: 'Bifrost', href: '#/' }, { label: 'Pathogens', href: '#/pathogens' }, { label: 'Not found' }]);
    pageEl.innerHTML = `<div class="callout warn">Protein <code>${esc(protName)}</code> was not found. <a class="prot-link" href="#/pathogens">Browse all pathogens &rarr;</a></div>`;
    return;
  }

  setNavAndCrumbs(
    `path-${r.org}`,
    [{ label: 'Bifrost', href: '#/' }, { label: 'Pathogens', href: '#/pathogens' }, { label: r.org, href: `#/pathogens?org=${encodeURIComponent(r.org)}` }, { label: r.id }],
    false
  );

  pageEl.innerHTML = `
    <div class="eyebrow">
      <span class="badge">${esc(r.s)}</span>
      ${orgBadge(r.org)}
      ${r.cls ? `<span>${esc(r.cls)}</span>` : ''}
    </div>
    <div class="page-head-row">
      <div>
        <h1>${esc(r.id)}</h1>
        <p class="lede" style="margin-bottom:16px">
          <span class="italic">${esc(r.sp)}</span> — ${esc([r.kng, r.ord, r.fam].filter(Boolean).join(' · '))}.
        </p>
      </div>
      <div class="btn-group">
        <a class="btn btn-sm" href="#/search?prefill=pathogen&name=${encodeURIComponent(r.id)}">Search similar</a>
        <button type="button" class="btn btn-sm btn-primary" id="pa-dl-fasta">Download FASTA</button>
      </div>
    </div>

    <div class="facts">
      <div class="fact"><div class="k">Best ipSAE (min)</div><div class="v big-num">${r.n_ok === 0 ? '—' : r.max_ipsae.toFixed(3)}<small>${r.n_ok === 0 ? `All ${fmtInt(r.n_fail)} failed` : `Best ipTM ${r.max_iptm.toFixed(3)}`}</small></div></div>
      <div class="fact"><div class="k">Screened IDs</div><div class="v big-num">${fmtInt(r.n_scr)}<small>${fmtInt(r.n_ok)} scored · ${fmtInt(r.n_fail)} failed${r.n_miss ? ` · ${fmtInt(r.n_miss)} missing` : ''}</small></div></div>
      <div class="fact"><div class="k">Length</div><div class="v mono">${r.len} aa<small>${r.nwy ? `${r.nwy} WY domains` : esc(r.cls || '—')}</small></div></div>
      <div class="fact"><div class="k">NCBI accession</div><div class="v">${accessionLinkHtml(r.acc, r.s)}<small>${esc(r.af3)}</small></div></div>
    </div>

    <div style="font-size:13px;color:var(--ink3);margin:8px 0 6px">
      ${
        r.asm
          ? `Genome assembly: ${doiLinksHtml(r.doi, `NCBI Datasets · ${r.asm}`)}`
          : `Source: <b style="color:var(--ink)">${esc(r.src)}</b> ${r.doi ? `· ${doiLinksHtml(r.doi)}` : ''}`
      }
    </div>

    <div id="pa-nearest-mount"></div>

    <h2>Sequence <small>AF3 Chain B · ${r.len} aa</small></h2>
    <div class="seq-box">
      <div class="seq-head">
        <div><b>${esc(r.id)}</b></div>
        <button type="button" class="btn btn-sm" id="pa-copy-seq">Copy sequence</button>
      </div>
      <div class="seq-body">${renderFormattedSequence(r.seq)}</div>
    </div>

    <h2>
      <span>Screened NLR integrated domains</span>
      <div class="btn-group">
        <button type="button" class="btn btn-sm btn-primary" id="pa-exp-tsv" disabled>Export TSV</button>
        <button type="button" class="btn btn-sm" id="pa-exp-csv" disabled>CSV</button>
      </div>
    </h2>
    ${r.s === 'E2' ? `<div class="callout" style="margin-top:8px"><b>Coverage note:</b> Panel E2 (<em>Myzus persicae</em>) was screened against <b>ID1</b> (922 RefSeq NLR IDs) only.</div>` : ''}
    <div id="pa-pairs-mount"><div class="center-loading" style="padding:36px 0"><div class="spinner"></div><div>Loading ${esc(r.s)} scores…</div></div></div>
  `;

  const fasta = formatFasta(`${r.id} | ${r.s} | ${r.org} | ${r.sp} | ${r.cls}`, r.seq);
  pageEl.querySelector('#pa-copy-seq')?.addEventListener('click', (e) => copyToClipboard(r.seq, e.currentTarget));
  pageEl.querySelector('#pa-dl-fasta')?.addEventListener('click', () => triggerDownload(`${r.id}.fasta`, fasta));
  renderNearestSeqCard(pageEl.querySelector('#pa-nearest-mount'), r, 'pathogen', meta);

  store
    .getPairsForPathogen(r)
    .then((pairs) => {
      if (gen !== routeGen) return;
      renderPartnerTable({
        mount: pageEl.querySelector('#pa-pairs-mount'),
        pairs,
        mode: 'pathogen',
        entityName: r.id,
        meta,
        exportTsvBtn: pageEl.querySelector('#pa-exp-tsv'),
        exportCsvBtn: pageEl.querySelector('#pa-exp-csv'),
      });
    })
    .catch((err) => {
      if (gen !== routeGen) return;
      const mount = pageEl.querySelector('#pa-pairs-mount');
      if (mount) mount.innerHTML = `<div class="callout warn"><b>Failed to load ${esc(r.s)} scores:</b> ${esc(err?.message || 'network error')}</div>`;
    });
}

/* Shared "Most similar sequence in Bifrost" box for NLR IDs & Pathogens (paralogs/orthologs) */
function formatPairwiseAlignment(hit) {
  const width = 60;
  const lines = [];
  let qPos = hit.qStart;
  let tPos = hit.tStart;
  for (let i = 0; i < hit.alignLen; i += width) {
    const qs = hit.qAln.slice(i, i + width);
    const ms = hit.mid.slice(i, i + width);
    const ts = hit.tAln.slice(i, i + width);
    const qAdv = qs.replace(/-/g, '').length;
    const tAdv = ts.replace(/-/g, '').length;
    const qEnd = qAdv ? qPos + qAdv - 1 : qPos;
    const tEnd = tAdv ? tPos + tAdv - 1 : tPos;
    lines.push(
      `Query  ${String(qPos).padStart(4)}  ${qs}  ${qEnd}\n` +
      `             ${ms}\n` +
      `Match  ${String(tPos).padStart(4)}  ${ts}  ${tEnd}`
    );
    qPos += qAdv;
    tPos += tAdv;
  }
  return lines.join('\n\n');
}

function renderNearestSeqCard(mount, targetRec, kind, meta) {
  if (!mount || !targetRec || !targetRec.seq) return;
  const pool = kind === 'id' ? store.screenedIds : meta.pathogens;
  const { top, others } = findNearestSequences(targetRec, pool, kind, { topK: 5 });

  if (!top) {
    mount.innerHTML = '';
    return;
  }

  const m = top.rec;
  const isId = kind === 'id';
  const href = isId ? `#/id/${encodeURIComponent(m.id)}` : `#/pathogen/${encodeURIComponent(m.id)}`;
  const heatmapHref = isId
    ? `#/heatmap?focusId=${encodeURIComponent(targetRec.id)}`
    : `#/heatmap?focusPath=${encodeURIComponent(targetRec.id)}`;
  const badgeHtml = isId ? panelBadge(m.s) : `<span class="badge">${esc(m.s)}</span> ${orgBadge(m.org)}`;
  const subInfo = isId
    ? `<span class="italic">${esc(m.sp)}</span> · ${esc(m.ipr_s || m.ipr)} (${esc(m.arch)})`
    : `<span class="italic">${esc(m.sp)}</span>${m.cls ? ` · ${esc(m.cls)}` : ''}`;

  const relBadge = top.isWeak
    ? `<span class="badge badge-warn">Low local similarity · no close homolog in set</span>`
    : `<span class="badge">${esc(top.relation)}</span>`;

  mount.innerHTML = `
    <section class="nn-card" aria-label="Most similar sequence in Bifrost">
      <div class="nn-head">
        <div class="nn-head-left">
          <span class="nn-eyebrow">Most similar sequence in Bifrost</span>
          ${relBadge}
        </div>
        <div class="btn-group">
          <button type="button" class="btn btn-sm" id="nn-aln-btn">Show alignment</button>
          ${others.length ? `<button type="button" class="btn btn-sm" id="nn-more-btn">Next closest (${others.length})</button>` : ''}
          <a class="btn btn-sm" href="${heatmapHref}" title="Compare this sequence and its closest homologs in a custom heatmap">Compare in Heatmap &rarr;</a>
        </div>
      </div>

      <div class="nn-main">
        <div class="nn-target">
          <div class="nn-title-row">
            ${badgeHtml}
            <a class="prot-link nn-name" href="${href}">${esc(m.id)}</a>
          </div>
          <div class="nn-sub">${subInfo}</div>
        </div>

        <div class="nn-stats">
          <div class="nn-stat"><span class="k">Identity</span><span class="v">${top.identityPct.toFixed(1)}%</span></div>
          <div class="nn-stat"><span class="k">Positives</span><span class="v">${top.positivesPct.toFixed(1)}%</span></div>
          <div class="nn-stat"><span class="k">Query cov</span><span class="v">${top.queryCovPct.toFixed(0)}%</span></div>
          <div class="nn-stat"><span class="k">Aligned</span><span class="v">${top.alignLen} aa</span></div>
          <div class="nn-stat"><span class="k">BLOSUM62</span><span class="v">${top.score}</span></div>
          <div class="nn-stat"><span class="k">Best ipSAE</span><span class="v">${m.n_ok === 0 ? 'All failed' : m.max_ipsae.toFixed(3)}</span></div>
        </div>
      </div>

      <div class="nn-drawer" id="nn-aln-box" hidden>
        <div class="muted" style="font-size:12px;margin-bottom:6px">
          Local BLOSUM62 alignment · Query ${top.qStart}–${top.qEnd} (${targetRec.len} aa) vs. Match ${top.tStart}–${top.tEnd} (${m.len} aa)
        </div>
        <pre class="aln-pre" style="margin:0">${esc(formatPairwiseAlignment(top))}</pre>
      </div>

      ${
        others.length
          ? `
        <div class="nn-drawer" id="nn-more-box" hidden>
          <div class="muted" style="font-size:12px;margin-bottom:8px">Additional similar sequences in this Bifrost set (putative paralogs / orthologs)</div>
          <div class="tblwrap">
            <table class="dt">
              <thead>
                <tr>
                  <th>#</th>
                  <th>${isId ? 'NLR Integrated Domain' : 'Pathogen / Pest Protein'}</th>
                  <th>Species</th>
                  <th>Relation</th>
                  <th class="num">Identity</th>
                  <th class="num">Query cov</th>
                  <th class="num">Best ipSAE</th>
                </tr>
              </thead>
              <tbody>
                ${others
                  .map((h, idx) => {
                    const hr = h.rec;
                    const hHref = isId ? `#/id/${encodeURIComponent(hr.id)}` : `#/pathogen/${encodeURIComponent(hr.id)}`;
                    return `<tr>
                      <td class="mono muted">${idx + 2}</td>
                      <td>
                        <div style="display:flex;align-items:center;gap:6px">
                          ${isId ? panelBadge(hr.s) : `<span class="badge">${esc(hr.s)}</span>`}
                          <a class="prot-link cell-trunc" style="max-width:220px" href="${hHref}" title="${esc(hr.id)}">${esc(hr.id)}</a>
                        </div>
                      </td>
                      <td class="italic">${esc(hr.sp)}</td>
                      <td style="font-size:12px">${h.isWeak ? '<span class="muted">Low local match</span>' : esc(h.relation)}</td>
                      <td class="num mono">${h.identityPct.toFixed(1)}%</td>
                      <td class="num mono">${h.queryCovPct.toFixed(0)}%</td>
                      <td class="num">${bestScoreCell(hr, isId, false)}</td>
                    </tr>`;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      `
          : ''
      }
    </section>
  `;

  mount.querySelector('#nn-aln-btn')?.addEventListener('click', (e) => {
    const box = mount.querySelector('#nn-aln-box');
    box.hidden = !box.hidden;
    e.currentTarget.textContent = box.hidden ? 'Show alignment' : 'Hide alignment';
  });
  mount.querySelector('#nn-more-btn')?.addEventListener('click', (e) => {
    const box = mount.querySelector('#nn-more-box');
    box.hidden = !box.hidden;
    e.currentTarget.textContent = box.hidden ? `Next closest (${others.length})` : 'Hide list';
  });
}

/* Shared clean partner table inside ID and Pathogen detail pages */
function renderPartnerTable({ mount, pairs, mode, entityName, meta, exportTsvBtn, exportCsvBtn }) {
  const pst = { q: '', f1: '', showSub: false, showChart: false, sortBy: 'ipsae_min', sortDir: 'desc', page: 1 };
  const PAGE = 50;

  const groupChips = mode === 'id' ? ['Oomycete', 'Nematode', 'Insect', 'Virus'] : ['ID1', 'ID2', 'ID3'];

  mount.innerHTML = `
    <div class="tools">
      <input type="search" id="ps-q" placeholder="${mode === 'id' ? 'Filter pathogen partners…' : 'Filter NLR IDs, species, InterPro…'}" />
      <button type="button" class="chip on" data-pf1="">All</button>
      ${groupChips
        .map((v) => {
          const c = mode === 'id' ? ORG_COLORS[v] : ID_COLORS[v];
          return `<button type="button" class="chip" data-pf1="${v}"><span class="dot" style="background:${c}"></span>${v}</button>`;
        })
        .join('')}
      <button type="button" class="chip" id="ps-sub-btn">Subscores</button>
      <button type="button" class="chip" id="ps-chart-btn">Histogram</button>
    </div>
    <div class="chart-box" id="ps-chart" hidden></div>
    <div class="table-meta" id="ps-meta"></div>
    <div class="tblwrap" id="ps-tbl"></div>
    <div class="pagination" id="ps-pag"></div>
  `;

  let filtered = [];

  function draw() {
    const q = pst.q.trim().toLowerCase();
    filtered = pairs.filter((p) => {
      if (mode === 'id') {
        const pa = meta.pathogens[p.path_idx];
        if (pst.f1 && pa.org !== pst.f1) return false;
        if (q && !pa._q.includes(q)) return false;
      } else {
        const idR = meta.ids[p.id_idx];
        if (pst.f1 && idR.s !== pst.f1) return false;
        if (q && !idR._q.includes(q)) return false;
      }
      return true;
    });

    const dir = pst.sortDir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      if (a.status !== b.status) return a.status - b.status;
      return ((a[pst.sortBy] || 0) - (b[pst.sortBy] || 0)) * dir || (b.iptm - a.iptm);
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));
    if (pst.page > totalPages) pst.page = totalPages;
    const slice = filtered.slice((pst.page - 1) * PAGE, pst.page * PAGE);
    const sIdx = filtered.length ? (pst.page - 1) * PAGE + 1 : 0;
    const eIdx = Math.min(filtered.length, pst.page * PAGE);

    mount.querySelectorAll('[data-pf1]').forEach((b) => b.classList.toggle('on', b.dataset.pf1 === pst.f1));
    mount.querySelector('#ps-sub-btn')?.classList.toggle('on-soft', pst.showSub);
    mount.querySelector('#ps-chart-btn')?.classList.toggle('on-soft', pst.showChart);

    const chartEl = mount.querySelector('#ps-chart');
    if (pst.showChart) {
      chartEl.hidden = false;
      const filteredScored = filtered.filter((p) => p.status === STATUS.SCORED).map((p) => p.ipsae_min);
      chartEl.innerHTML = filteredScored.length
        ? renderSimpleHistogramSvg(filteredScored, { metricLabel: 'Partner ipSAE (min)', height: 145 })
        : '<div class="muted" style="text-align:center;padding:18px 0">No scored pairs in this filter slice.</div>';
      wireInteractiveCharts(chartEl);
    } else chartEl.hidden = true;

    mount.querySelector('#ps-meta').innerHTML = `
      <div>Showing <b>${fmtInt(sIdx)}–${fmtInt(eIdx)}</b> of <b>${fmtInt(filtered.length)}</b> pairs</div>
      <div>Click any row for full subscores &amp; Dataverse model extraction</div>
    `;

    const th = (k, lbl) => {
      const act = pst.sortBy === k;
      const ariaSort = act ? (pst.sortDir === 'desc' ? 'descending' : 'ascending') : 'none';
      return `<th class="sortable num${act ? ' sorted' : ''}" data-sort="${k}" tabindex="0" role="columnheader" aria-sort="${ariaSort}">${esc(lbl)}${act ? (pst.sortDir === 'desc' ? ' ↓' : ' ↑') : ''}</th>`;
    };
    const subHead = pst.showSub
      ? `${th('ipsae_max', 'ipSAE max')}${th('ipsae_a', 'A→B')}${th('ipsae_b', 'B→A')}${th('d0dom_min', 'd0dom')}${th('pdockq2_min', 'pDockQ2')}<th class="num">dist1/2</th>`
      : '';

    mount.querySelector('#ps-tbl').innerHTML = `
      <table class="dt">
        <thead>
          <tr>
            <th>Set</th>
            <th>${mode === 'id' ? 'Pathogen / Pest (Chain B)' : 'NLR Integrated Domain (Chain A)'}</th>
            ${th('ipsae_min', 'ipSAE (min) ★')}
            ${th('iptm', 'ipTM')}
            ${th('pdockq', 'pDockQ')}
            ${th('lis_min', 'LIS')}
            ${th('contacts', 'Contacts')}
            ${subHead}
          </tr>
        </thead>
        <tbody>
          ${
            slice.length
              ? slice
                  .map((p, idx) => {
                    const ds = meta.datasets[p.setIdx];
                    const ok = p.status === STATUS.SCORED;
                    let cell = '';
                    if (mode === 'id') {
                      const pa = meta.pathogens[p.path_idx];
                      cell = `<a class="prot-link" href="#/pathogen/${encodeURIComponent(pa.id)}" data-stop-row>${esc(pa.id)}</a>
                        <div class="muted" style="font-size:12px;margin-top:2px"><span class="dot" style="background:${ORG_COLORS[pa.org]};margin-right:5px"></span><span class="italic">${esc(pa.sp)}</span></div>`;
                    } else {
                      const idR = meta.ids[p.id_idx];
                      cell = `<div style="display:flex;align-items:center;gap:6px">${panelBadge(idR.s)}<a class="prot-link cell-trunc" href="#/id/${encodeURIComponent(idR.id)}" data-stop-row title="${esc(idR.id)}">${esc(idR.id)}</a></div>
                        <div class="muted" style="font-size:12px;margin-top:2px"><span class="italic">${esc(idR.sp)}</span> · ${esc(idR.ipr_s || idR.ipr)}</div>`;
                    }
                    const subCells = pst.showSub
                      ? `<td class="num">${ok ? p.ipsae_max.toFixed(3) : '—'}</td><td class="num">${ok ? p.ipsae_a.toFixed(3) : '—'}</td><td class="num">${ok ? p.ipsae_b.toFixed(3) : '—'}</td><td class="num">${ok ? p.d0dom_min.toFixed(3) : '—'}</td><td class="num">${ok ? p.pdockq2_min.toFixed(3) : '—'}</td><td class="num">${ok ? `${p.dist1}/${p.dist2}` : '—'}</td>`
                      : '';
                    return `
                      <tr class="clickable" data-p-idx="${idx}" tabindex="0">
                        <td class="mono" style="font-size:12px">${esc(ds.id)}</td>
                        <td>${cell}</td>
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
              : `<tr><td colspan="${pst.showSub ? 13 : 7}" style="text-align:center;padding:32px" class="muted">No matching partners.</td></tr>`
          }
        </tbody>
      </table>
    `;

    mount.querySelectorAll('#ps-tbl th.sortable').forEach((el) => {
      const triggerSort = () => {
        const k = el.dataset.sort;
        if (pst.sortBy === k) pst.sortDir = pst.sortDir === 'desc' ? 'asc' : 'desc';
        else { pst.sortBy = k; pst.sortDir = 'desc'; }
        pst.page = 1;
        draw();
      };
      el.addEventListener('click', triggerSort);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); triggerSort(); }
      });
    });
    mount.querySelectorAll('#ps-tbl tbody tr[data-p-idx]').forEach((tr) => {
      const openRow = () => navigateToPair(slice[Number(tr.dataset.pIdx)]);
      tr.addEventListener('click', (e) => {
        if (e.target.closest('[data-stop-row]')) return;
        openRow();
      });
      tr.addEventListener('keydown', (e) => {
        if (e.target !== tr) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRow(); }
      });
    });

    mount.querySelector('#ps-pag').innerHTML = `
      <div>Page <b>${pst.page}</b> of <b>${totalPages}</b></div>
      <div class="btn-group">
        <button type="button" class="btn btn-sm" id="psp-prev" ${pst.page <= 1 ? 'disabled' : ''}>Prev</button>
        <button type="button" class="btn btn-sm" id="psp-next" ${pst.page >= totalPages ? 'disabled' : ''}>Next</button>
      </div>
    `;
    mount.querySelector('#psp-prev')?.addEventListener('click', () => { pst.page = Math.max(1, pst.page - 1); draw(); });
    mount.querySelector('#psp-next')?.addEventListener('click', () => { pst.page = Math.min(totalPages, pst.page + 1); draw(); });
  }

  mount.querySelector('#ps-q')?.addEventListener('input', (e) => { pst.q = e.target.value; pst.page = 1; draw(); });
  mount.querySelectorAll('[data-pf1]').forEach((b) => b.addEventListener('click', () => { pst.f1 = b.dataset.pf1; pst.page = 1; draw(); }));
  mount.querySelector('#ps-sub-btn')?.addEventListener('click', () => { pst.showSub = !pst.showSub; draw(); });
  mount.querySelector('#ps-chart-btn')?.addEventListener('click', () => { pst.showChart = !pst.showChart; draw(); });

  if (exportTsvBtn) { exportTsvBtn.disabled = false; exportTsvBtn.onclick = () => exportPairsTable(`${entityName}_scores.tsv`, filtered, meta, '\t'); }
  if (exportCsvBtn) { exportCsvBtn.disabled = false; exportCsvBtn.onclick = () => exportPairsTable(`${entityName}_scores.csv`, filtered, meta, ','); }

  draw();
}

/* --------------------------------------------------------------------------
   VIEW 6A: All InterPro Domains & Annotations Directory (#/domains)
   -------------------------------------------------------------------------- */
let interproCatalogCache = null;

function fmtInterproType(t) {
  if (!t) return 'Other';
  return t.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function getInterproCatalog(meta) {
  if (interproCatalogCache) return interproCatalogCache;
  const iprDict = meta.interpro || {};
  const rows = [];

  for (const [ipr, allList] of store.idsByInterpro.entries()) {
    const screened = allList.filter((r) => r.scr);
    const useList = screened.length ? screened : allList;
    const info = iprDict[ipr];
    const primList = useList.filter((r) => r.ipr === ipr);
    const rep = primList[0] || useList[0];

    // Most common functional category among IDs carrying this InterPro
    const catCounts = new Map();
    for (const r of useList) {
      if (r.cat) catCounts.set(r.cat, (catCounts.get(r.cat) || 0) + 1);
    }
    const topCat = [...catCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Uncategorized';

    let nID1 = 0, nID2 = 0, nID3 = 0, nScoredIds = 0, maxIpsae = 0;
    const spSet = new Set();
    const ordSet = new Set();
    for (const r of screened) {
      if (r.s === 'ID1') nID1++;
      else if (r.s === 'ID2') nID2++;
      else if (r.s === 'ID3') nID3++;
      spSet.add(r.sp);
      if (r.ord) ordSet.add(r.ord);
      if (r.n_ok > 0) {
        nScoredIds++;
        if (r.max_ipsae > maxIpsae) maxIpsae = r.max_ipsae;
      }
    }

    const shortName = info?.s || rep.ipr_s || '';
    const fullName = info?.n || rep.ipr_n || '';
    const typeRaw = info?.t || rep.ipr_t || '';
    const typeLabel = fmtInterproType(typeRaw);

    rows.push({
      ipr,
      short: shortName,
      name: fullName,
      type: typeLabel,
      typeRaw,
      cat: topCat,
      isPrimary: primList.length > 0,
      nPrimary: primList.length,
      nAll: screened.length,
      nScoredIds,
      nCatalog: allList.length,
      nID1,
      nID2,
      nID3,
      nSpecies: spSet.size,
      nOrders: ordSet.size,
      maxIpsae,
      _q: `${ipr} ${shortName} ${fullName} ${topCat} ${typeLabel}`.toLowerCase(),
    });
  }

  rows.sort((a, b) => b.nAll - a.nAll || b.maxIpsae - a.maxIpsae || a.ipr.localeCompare(b.ipr));
  interproCatalogCache = rows;
  return rows;
}

function renderDomainsDirectory(params) {
  const meta = store.meta;
  const catalog = getInterproCatalog(meta);
  const nPrimTotal = catalog.filter((r) => r.isPrimary).length;
  const nOverlapOnly = catalog.length - nPrimTotal;
  const nCatsShown = new Set(catalog.map((r) => r.cat)).size;

  const st = {
    q: params.get('q') || '',
    scope: params.get('scope') || 'all', // 'all' | 'primary' | 'overlap'
    panel: params.get('panel') || '',
    cat: params.get('category') || '',
    type: params.get('type') || '',
    showCats: false,
    sortBy: 'nAll',
    sortDir: 'desc',
    page: 1,
  };
  const PAGE = 50;

  setNavAndCrumbs('domains-all', [{ label: 'Bifrost', href: '#/' }, { label: 'InterPro Domains' }], true);

  pageEl.innerHTML = `
    <div class="eyebrow">InterPro annotations · Chain A integrated domains</div>
    <div class="page-head-row">
      <div>
        <h1>All InterPro domains &amp; annotations</h1>
        <p class="lede" style="margin-bottom:14px">
          ${fmtInt(catalog.length)} unique InterPro entries across ${nCatsShown} functional categories
          (${fmtInt(nPrimTotal)} primary ID-defining entries and ${fmtInt(nOverlapOnly)} additional overlapping annotations).
        </p>
      </div>
      <div class="btn-group">
        <button type="button" class="btn btn-sm" id="dom-reset">Reset</button>
        <button type="button" class="btn btn-sm btn-primary" id="dom-dl-tsv">Export TSV</button>
      </div>
    </div>

    <div class="tools">
      <input type="search" id="dom-q" value="${esc(st.q)}" placeholder="Search IPR accession, short name, description, or category…" />
      <button type="button" class="chip${st.scope === 'all' ? ' on' : ''}" data-dscope="all">All (${fmtInt(catalog.length)})</button>
      <button type="button" class="chip${st.scope === 'primary' ? ' on' : ''}" data-dscope="primary">Primary (${fmtInt(nPrimTotal)})</button>
      <button type="button" class="chip${st.scope === 'overlap' ? ' on' : ''}" data-dscope="overlap">Overlapping only (${fmtInt(nOverlapOnly)})</button>
      <button type="button" class="chip${st.panel === 'ID1' ? ' on-soft' : ''}" data-dpanel="ID1"><span class="dot" style="background:var(--cyan)"></span>ID1</button>
      <button type="button" class="chip${st.panel === 'ID2' ? ' on-soft' : ''}" data-dpanel="ID2"><span class="dot" style="background:var(--purple)"></span>ID2</button>
      <button type="button" class="chip${st.panel === 'ID3' ? ' on-soft' : ''}" data-dpanel="ID3"><span class="dot" style="background:var(--pink)"></span>ID3</button>
      <button type="button" class="chip" id="dom-cats-btn">Category chart</button>
    </div>

    <div class="select-bar" aria-label="Filter InterPro domains">
      <div class="field">
        <label for="dom-cat">Functional category</label>
        <select id="dom-cat"></select>
      </div>
      <div class="field">
        <label for="dom-type">InterPro type</label>
        <select id="dom-type"></select>
      </div>
    </div>

    <div class="chart-box" id="dom-cat-chart" hidden></div>

    <div class="table-meta" id="dom-meta"></div>
    <div class="tblwrap" id="dom-tbl"></div>
    <div class="pagination" id="dom-pag"></div>
  `;

  const domFacetSpecs = [
    { sel: '#dom-cat', key: 'cat', getter: (r) => r.cat, sort: 'count', allLabel: (n) => `All categories (${n})` },
    { sel: '#dom-type', key: 'type', getter: (r) => r.type, sort: 'count', allLabel: (n) => `All InterPro types (${n})` },
  ];

  let currentRows = [];

  function draw(changedKey = null) {
    const q = st.q.trim().toLowerCase();

    const basePool = catalog.filter((r) => {
      if (st.scope === 'primary' && !r.isPrimary) return false;
      if (st.scope === 'overlap' && r.isPrimary) return false;
      if (st.panel === 'ID1' && !r.nID1) return false;
      if (st.panel === 'ID2' && !r.nID2) return false;
      if (st.panel === 'ID3' && !r.nID3) return false;
      if (q && !r._q.includes(q)) return false;
      return true;
    });

    syncFacetedSelects(basePool, domFacetSpecs, st, pageEl, changedKey);

    currentRows = basePool.filter((r) => {
      if (st.cat && r.cat !== st.cat) return false;
      if (st.type && r.type !== st.type) return false;
      return true;
    });

    const dir = st.sortDir === 'asc' ? 1 : -1;
    currentRows.sort((a, b) => {
      const av = a[st.sortBy];
      const bv = b[st.sortBy];
      if (typeof av === 'string') return av.localeCompare(bv) * dir || (b.nAll - a.nAll);
      return ((av || 0) - (bv || 0)) * dir || (b.nAll - a.nAll) || a.ipr.localeCompare(b.ipr);
    });

    pageEl.querySelectorAll('[data-dscope]').forEach((b) => b.classList.toggle('on', b.dataset.dscope === st.scope));
    pageEl.querySelectorAll('[data-dpanel]').forEach((b) => b.classList.toggle('on-soft', b.dataset.dpanel === st.panel));
    pageEl.querySelector('#dom-cats-btn')?.classList.toggle('on-soft', st.showCats);

    // Optional top categories chart
    const chartEl = pageEl.querySelector('#dom-cat-chart');
    if (st.showCats) {
      chartEl.hidden = false;
      const cMap = new Map();
      for (const r of currentRows) cMap.set(r.cat, (cMap.get(r.cat) || 0) + 1);
      const topCats = [...cMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([cat, cnt]) => ({
          label: cat,
          value: cnt,
          sub: 'InterPro entries',
          color: '#7209b7',
        }));
      chartEl.innerHTML = topCats.length
        ? `<div class="muted" style="font-size:12px;margin-bottom:10px">Top functional categories in active slice (by distinct InterPro entries)</div>${renderHorizontalBarsHtml(topCats)}`
        : '<div class="muted" style="text-align:center;padding:16px 0">No categories in this filter slice.</div>';
    } else {
      chartEl.hidden = true;
    }

    const totalPages = Math.max(1, Math.ceil(currentRows.length / PAGE));
    if (st.page > totalPages) st.page = totalPages;
    const slice = currentRows.slice((st.page - 1) * PAGE, st.page * PAGE);
    const start = currentRows.length ? (st.page - 1) * PAGE + 1 : 0;
    const end = Math.min(currentRows.length, st.page * PAGE);

    pageEl.querySelector('#dom-meta').innerHTML = `
      <div>Showing <b>${fmtInt(start)}–${fmtInt(end)}</b> of <b>${fmtInt(currentRows.length)}</b> InterPro entries</div>
      <div>Click any InterPro entry to view all carrying NLR IDs &amp; taxonomy</div>
    `;

    const th = (k, lbl, num = false) => {
      const act = st.sortBy === k;
      const ariaSort = act ? (st.sortDir === 'desc' ? 'descending' : 'ascending') : 'none';
      return `<th class="sortable${act ? ' sorted' : ''}${num ? ' num' : ''}" data-sort="${k}" tabindex="0" role="columnheader" aria-sort="${ariaSort}">${esc(lbl)}${act ? (st.sortDir === 'desc' ? ' ↓' : ' ↑') : ''}</th>`;
    };

    pageEl.querySelector('#dom-tbl').innerHTML = `
      <table class="dt">
        <thead>
          <tr>
            ${th('ipr', 'InterPro')}
            ${th('short', 'Name & Description')}
            ${th('cat', 'Category & Type')}
            ${th('nAll', 'IDs', true)}
            ${th('nPrimary', 'Primary', true)}
            ${th('nSpecies', 'Species', true)}
            ${th('maxIpsae', 'Best ipSAE', true)}
            <th class="num">Scores</th>
          </tr>
        </thead>
        <tbody>
          ${
            slice.length
              ? slice
                  .map((r) => {
                    const ebi = `https://www.ebi.ac.uk/interpro/entry/InterPro/${encodeURIComponent(r.ipr)}/`;
                    const panelBits = [
                      r.nID1 ? `<span style="color:var(--cyan)">●</span> ${r.nID1}` : '',
                      r.nID2 ? `<span style="color:var(--purple)">●</span> ${r.nID2}` : '',
                      r.nID3 ? `<span style="color:var(--pink)">●</span> ${r.nID3}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    return `
                      <tr>
                        <td class="mono">
                          <a class="prot-link" href="#/domain/${encodeURIComponent(r.ipr)}">${esc(r.ipr)}</a>
                          <a class="muted" href="${ebi}" target="_blank" rel="noopener" title="Open ${esc(r.ipr)} on InterPro">&#8599;</a>
                        </td>
                        <td>
                          <a class="prot-link" href="#/domain/${encodeURIComponent(r.ipr)}">${esc(r.short || r.ipr)}</a>
                          <div class="muted" style="font-size:12px;margin-top:2px;max-width:340px">${esc(r.name)}</div>
                        </td>
                        <td>
                          <div style="font-size:12.5px;color:var(--ink)">${esc(r.cat)}</div>
                          <div class="muted" style="font-size:11.5px;margin-top:2px">${esc(r.type)}</div>
                        </td>
                        <td class="num">
                          <div style="font-weight:500;color:var(--ink)">${fmtInt(r.nAll)}</div>
                          <div class="muted" style="font-size:11px;margin-top:2px">${panelBits || '—'}</div>
                        </td>
                        <td class="num">${r.nPrimary ? fmtInt(r.nPrimary) : '<span class="badge" style="font-size:10.5px">Overlap</span>'}</td>
                        <td class="num">${fmtInt(r.nSpecies)}</td>
                        <td class="num">${!r.nAll ? '<span class="muted">—</span>' : r.nScoredIds === 0 ? '<span class="badge badge-bad">All failed</span>' : scoreCellHtml(r.maxIpsae)}</td>
                        <td class="num"><a class="prot-link" style="font-size:12px;white-space:nowrap" href="#/explorer?ipr=${encodeURIComponent(r.ipr)}">Explore &rarr;</a></td>
                      </tr>
                    `;
                  })
                  .join('')
              : '<tr><td colspan="8" style="text-align:center;padding:36px" class="muted">No InterPro domains match these filters.</td></tr>'
          }
        </tbody>
      </table>
    `;

    pageEl.querySelectorAll('#dom-tbl th.sortable').forEach((el) => {
      const triggerSort = () => {
        const k = el.dataset.sort;
        if (st.sortBy === k) st.sortDir = st.sortDir === 'desc' ? 'asc' : 'desc';
        else { st.sortBy = k; st.sortDir = (k === 'ipr' || k === 'short' || k === 'cat') ? 'asc' : 'desc'; }
        st.page = 1;
        draw();
      };
      el.addEventListener('click', triggerSort);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); triggerSort(); }
      });
    });

    pageEl.querySelector('#dom-pag').innerHTML = `
      <div>Page <b>${st.page}</b> of <b>${totalPages}</b></div>
      <div class="btn-group">
        <button type="button" class="btn btn-sm" id="dp-prev" ${st.page <= 1 ? 'disabled' : ''}>Prev</button>
        <button type="button" class="btn btn-sm" id="dp-next" ${st.page >= totalPages ? 'disabled' : ''}>Next</button>
      </div>
    `;
    pageEl.querySelector('#dp-prev')?.addEventListener('click', () => { st.page = Math.max(1, st.page - 1); draw(); });
    pageEl.querySelector('#dp-next')?.addEventListener('click', () => { st.page = Math.min(totalPages, st.page + 1); draw(); });
  }

  pageEl.querySelector('#dom-q')?.addEventListener('input', (e) => { st.q = e.target.value; st.page = 1; draw('q'); });
  pageEl.querySelectorAll('[data-dscope]').forEach((b) => {
    b.addEventListener('click', () => { st.scope = b.dataset.dscope; st.page = 1; draw('scope'); });
  });
  pageEl.querySelectorAll('[data-dpanel]').forEach((b) => {
    b.addEventListener('click', () => {
      st.panel = st.panel === b.dataset.dpanel ? '' : b.dataset.dpanel;
      st.page = 1;
      draw('panel');
    });
  });
  pageEl.querySelector('#dom-cat')?.addEventListener('change', (e) => { st.cat = e.target.value; st.page = 1; draw('cat'); });
  pageEl.querySelector('#dom-type')?.addEventListener('change', (e) => { st.type = e.target.value; st.page = 1; draw('type'); });
  pageEl.querySelector('#dom-cats-btn')?.addEventListener('click', () => { st.showCats = !st.showCats; draw(); });
  pageEl.querySelector('#dom-reset')?.addEventListener('click', () => renderDomainsDirectory(new URLSearchParams()));

  pageEl.querySelector('#dom-dl-tsv')?.addEventListener('click', () => {
    const hdr = ['interpro', 'short_name', 'full_name', 'interpro_type', 'category', 'primary_entry', 'screened_ids', 'primary_ids', 'ID1', 'ID2', 'ID3', 'plant_species', 'plant_orders', 'max_ipsae_min'];
    exportDelimited(
      'bifrost_interpro_domains.tsv',
      hdr,
      currentRows.map((r) => [r.ipr, r.short, r.name, r.typeRaw, r.cat, r.isPrimary, r.nAll, r.nPrimary, r.nID1, r.nID2, r.nID3, r.nSpecies, r.nOrders, r.maxIpsae]),
      '\t'
    );
  });

  draw();
}

/* --------------------------------------------------------------------------
   VIEW 6B: InterPro Domain Detail (#/domain/<IPR>)
   -------------------------------------------------------------------------- */
function renderDomainDetail(ipr) {
  const meta = store.meta;
  const list = (store.idsByInterpro.get(ipr) || [])
    .slice()
    .sort((a, b) => (b.scr ? 1 : 0) - (a.scr ? 1 : 0) || b.max_ipsae - a.max_ipsae || a.id.localeCompare(b.id));
  setNavAndCrumbs(`dom-${ipr}`, [{ label: 'Bifrost', href: '#/' }, { label: 'InterPro Domains', href: '#/domains' }, { label: ipr }], false);

  if (!list.length) {
    pageEl.innerHTML = `<div class="callout warn">InterPro entry <code>${esc(ipr)}</code> was not found in Bifrost. <a class="prot-link" href="#/domains">Browse all InterPro domains &rarr;</a></div>`;
    return;
  }
  const screened = list.filter((x) => x.scr);
  const nExcluded = list.length - screened.length;
  const statList = screened.length ? screened : list;
  const iprInfo = meta.interpro?.[ipr];
  const rep = statList.find((x) => x.ipr === ipr) || statList[0];
  const shortName = iprInfo?.s || rep.ipr_s || ipr;
  const fullName = iprInfo?.n || rep.ipr_n || '';
  const typeLabel = fmtInterproType(iprInfo?.t || rep.ipr_t || '');
  const nPrim = statList.filter((x) => x.ipr === ipr).length;
  const scoredIds = screened.filter((x) => x.n_ok > 0);
  const peakIpsae = scoredIds.reduce((m, x) => (x.max_ipsae > m ? x.max_ipsae : m), 0);
  const ebiUrl = `https://www.ebi.ac.uk/interpro/entry/InterPro/${encodeURIComponent(ipr)}/`;

  const ordMap = new Map();
  for (const r of statList) ordMap.set(r.ord || 'Other', (ordMap.get(r.ord || 'Other') || 0) + 1);
  const topOrds = [...ordMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([o, c]) => ({ label: o, value: c, sub: 'IDs', color: '#4361ee' }));

  pageEl.innerHTML = `
    <div class="eyebrow">InterPro ${esc(typeLabel)} · ${esc(rep.cat || 'Integrated domain')}${nPrim === 0 ? ' · Overlapping annotation' : ''}</div>
    <div class="page-head-row">
      <div>
        <h1>${esc(shortName)} <span class="muted mono" style="font-size:20px;font-weight:400">${esc(ipr)}</span></h1>
        <p class="lede">${esc(fullName)}</p>
      </div>
      <div class="btn-group">
        <a class="btn btn-sm" href="${ebiUrl}" target="_blank" rel="noopener">InterPro &#8599;</a>
        <a class="btn btn-sm btn-primary" href="#/explorer?ipr=${encodeURIComponent(ipr)}">Explore scores &rarr;</a>
      </div>
    </div>

    <div class="facts">
      <div class="fact"><div class="k">Bifrost IDs</div><div class="v big-num">${fmtInt(screened.length)}<small>${nPrim ? `${fmtInt(nPrim)} primary` : 'Overlapping only'}${nExcluded ? ` · +${nExcluded} excluded` : ''}</small></div></div>
      <div class="fact"><div class="k">Plant species</div><div class="v big-num">${new Set(statList.map((x) => x.sp)).size}<small>${new Set(statList.map((x) => x.ord).filter(Boolean)).size} plant orders</small></div></div>
      <div class="fact"><div class="k">Peak ipSAE (min)</div><div class="v big-num">${scoredIds.length ? peakIpsae.toFixed(3) : '—'}<small>${scoredIds.length ? `across ${fmtInt(screened.length)} screened IDs` : screened.length ? 'All screened IDs failed ipSAE' : 'Not screened'}</small></div></div>
      <div class="fact"><div class="k">Panels</div><div class="v" style="display:flex;gap:5px;flex-wrap:wrap">${[...new Set(statList.map((x) => x.s))].sort().map(panelBadge).join('')}</div></div>
    </div>

    <h2>Taxonomic distribution${nExcluded ? ' <small>Screened IDs</small>' : ''}</h2>
    <div class="chart-box">${renderHorizontalBarsHtml(topOrds)}</div>

    <h2>Integrated domains carrying ${esc(ipr)}</h2>
    <div class="tblwrap">
      <table class="dt">
        <thead>
          <tr><th>Panel</th><th>NLR Integrated Domain</th><th>Species</th><th>NLR</th><th class="num">Length</th><th class="num">Best ipSAE</th><th>Top Partner</th></tr>
        </thead>
        <tbody>
          ${list
            .map((r) => {
              const topP = r.top_p >= 0 ? meta.pathogens[r.top_p] : null;
              return `<tr>
                <td>${panelBadge(r.s)}${!r.scr ? ' <span class="badge badge-warn">Excl.</span>' : ''}</td>
                <td><a class="prot-link cell-trunc" href="#/id/${encodeURIComponent(r.id)}">${esc(r.id)}</a></td>
                <td><span class="italic">${esc(r.sp)}</span></td>
                <td class="mono" style="font-size:12px;white-space:nowrap">${esc(r.arch)}</td>
                <td class="num">${r.len} aa</td>
                <td class="num">${bestScoreCell(r, true)}</td>
                <td>${topP ? `<a class="prot-link" href="#/pathogen/${encodeURIComponent(topP.id)}">${esc(topP.id)}</a>` : '—'}</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

/* --------------------------------------------------------------------------
   VIEW 7: Sequence Search (#/search)
   -------------------------------------------------------------------------- */
function renderSequenceSearch(params) {
  setNavAndCrumbs('search', [{ label: 'Bifrost', href: '#/' }, { label: 'Tools' }, { label: 'Sequence Search' }], true);
  const meta = store.meta;
  const exHma = meta.ids.find((r) => r.scr && r.ipr === 'IPR006121') || meta.ids[0];
  const exEff = meta.pathogens.find((r) => r.org === 'Oomycete') || meta.pathogens[0];
  const exVir = meta.pathogens.find((r) => r.org === 'Virus') || meta.pathogens[meta.pathogens.length - 1];

  let initialQuery = '';
  const pType = params.get('prefill');
  const pName = params.get('name');
  if (pType === 'id' && pName && store.idByName.has(pName)) initialQuery = `>${pName}\n${store.idByName.get(pName).seq}`;
  else if (pType === 'pathogen' && pName && store.pathByName.has(pName)) initialQuery = `>${pName}\n${store.pathByName.get(pName).seq}`;

  pageEl.innerHTML = `
    <div class="eyebrow">Tools · Client-side BLOSUM62 &amp; motif search</div>
    <h1>Sequence search</h1>
    <p class="lede">Paste an amino acid sequence (FASTA or raw) or motif pattern to search all Bifrost NLR integrated domains, pathogen/pest proteins, and full-length parent NLRs locally in your browser.</p>

    <div class="adv-drawer" style="margin-top:8px">
      <div class="field" style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
          <label for="seq-input">Query sequence or motif</label>
          <div class="btn-group">
            <button type="button" class="btn btn-sm" id="ex-hma">Example: HMA ID</button>
            <button type="button" class="btn btn-sm" id="ex-eff">Oomycete effector</button>
            <button type="button" class="btn btn-sm" id="ex-vir">Virus protein</button>
            <button type="button" class="btn btn-sm" id="ex-motif">Motif: RXL[RK]</button>
          </div>
        </div>
        <textarea id="seq-input" placeholder=">query&#10;VHVVQNVNFPSEAKKRQVIKMVYKLIGIESVAVDSGGRALVVVGRVDADKVLSCVKQIAK…">${esc(initialQuery)}</textarea>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:14px 24px;align-items:center;justify-content:space-between">
        <div class="seg" id="seq-mode-seg">
          <button type="button" data-mode="homology" class="on">Homology (Smith-Waterman)</button>
          <button type="button" data-mode="motif">Exact / Motif (X = wildcard)</button>
        </div>

        <div class="btn-group">
          <label class="chip on-soft" style="cursor:pointer"><input type="checkbox" id="db-ids" checked style="margin:0" /> NLR IDs</label>
          <label class="chip on-soft" style="cursor:pointer"><input type="checkbox" id="db-path" checked style="margin:0" /> Pathogens</label>
          <label class="chip" style="cursor:pointer"><input type="checkbox" id="db-parents" style="margin:0" /> Parent NLRs</label>
        </div>

        <div class="btn-group">
          <button type="button" class="btn btn-sm" id="seq-clear">Clear</button>
          <button type="button" class="btn btn-primary" id="seq-run">Search</button>
        </div>
      </div>
    </div>

    <div id="seq-out"></div>
  `;

  let mode = 'homology';
  const inputEl = pageEl.querySelector('#seq-input');
  const outEl = pageEl.querySelector('#seq-out');

  pageEl.querySelectorAll('#seq-mode-seg button').forEach((b) => {
    b.addEventListener('click', () => {
      mode = b.dataset.mode;
      pageEl.querySelectorAll('#seq-mode-seg button').forEach((x) => x.classList.toggle('on', x === b));
    });
  });

  ['#db-ids', '#db-path', '#db-parents'].forEach((sel) => {
    const cb = pageEl.querySelector(sel);
    cb?.addEventListener('change', () => cb.closest('label').classList.toggle('on-soft', cb.checked));
  });

  const formatAln = (hit) => {
    const W = 68;
    const out = [];
    let qP = hit.qStart;
    let tP = hit.tStart;
    for (let i = 0; i < hit.qAln.length; i += W) {
      const qs = hit.qAln.slice(i, i + W);
      const ms = hit.mid.slice(i, i + W);
      const ts = hit.tAln.slice(i, i + W);
      const qc = qs.replace(/-/g, '').length;
      const tc = ts.replace(/-/g, '').length;
      out.push(`Query  ${String(qP).padStart(4)}  ${esc(qs)}  ${qP + Math.max(0, qc - 1)}\n             ${esc(ms)}\nTarget ${String(tP).padStart(4)}  ${esc(ts)}  ${tP + Math.max(0, tc - 1)}`);
      qP += qc;
      tP += tc;
    }
    return out.join('\n\n');
  };

  async function run() {
    const raw = inputEl.value.trim();
    if (!raw) return;
    const useIds = pageEl.querySelector('#db-ids').checked;
    const usePath = pageEl.querySelector('#db-path').checked;
    const useParents = pageEl.querySelector('#db-parents').checked;
    if (!useIds && !usePath && !useParents) {
      outEl.innerHTML = '<div class="callout warn">Select at least one target database.</div>';
      return;
    }

    outEl.innerHTML = '<div class="center-loading" style="padding:36px 0"><div class="spinner"></div><div>Searching sequences…</div></div>';
    await new Promise((r) => setTimeout(r, 20));

    let parents = null;
    if (useParents) {
      try {
        parents = await store.loadParentNlrs();
      } catch (err) {
        outEl.innerHTML = `<div class="callout warn"><b>Failed to load parent NLR sequences:</b> ${esc(err?.message || 'network error')}</div>`;
        return;
      }
    }

    const entries = [];
    if (useIds) for (const r of meta.ids) entries.push({ kind: 'ID', rec: r, seq: r.seq });
    if (usePath) for (const r of meta.pathogens) entries.push({ kind: 'Pathogen', rec: r, seq: r.seq });
    if (useParents && parents) {
      // Deduplicate multi-ID parent NLRs by (panel, parent_nlr), keeping highest-scoring screened child as representative
      const byParent = new Map();
      for (const r of meta.ids) {
        const key = `${r.s}\0${r.pnlr}`;
        const prev = byParent.get(key);
        if (!prev) {
          byParent.set(key, { kind: 'Parent NLR', rec: r, seq: parents[r.i] || '', nIds: 1 });
        } else {
          prev.nIds++;
          const prevRank = (prev.rec.scr ? 2 : 0) + (prev.rec.n_ok > 0 ? 1 : 0);
          const curRank = (r.scr ? 2 : 0) + (r.n_ok > 0 ? 1 : 0);
          if (curRank > prevRank || (curRank === prevRank && r.max_ipsae > prev.rec.max_ipsae)) {
            prev.rec = r;
          }
        }
      }
      for (const e of byParent.values()) entries.push(e);
    }

    const t0 = performance.now();
    if (mode === 'homology') {
      const res = runHomologySearch(raw, entries, { maxResults: 50, maxCandidates: 150 });
      const sec = ((performance.now() - t0) / 1000).toFixed(2);
      if (res.error) { outEl.innerHTML = `<div class="callout warn">${esc(res.error)}</div>`; return; }
      if (!res.hits.length) { outEl.innerHTML = `<div class="callout">No significant local alignments found across ${fmtInt(res.totalScanned)} sequences (${sec}s).</div>`; return; }

      outEl.innerHTML = `
        <div class="table-meta"><div><b>${res.hits.length}</b> alignment hits across <b>${fmtInt(res.totalScanned)}</b> sequences (${sec}s)</div></div>
        <div class="tblwrap">
          <table class="dt">
            <thead><tr><th>Database</th><th>Protein</th><th>Species / Domain</th><th class="num">SW</th><th class="num">Identity</th><th class="num">Aln</th><th class="num">Cov</th><th class="num">Best ipSAE</th></tr></thead>
            <tbody>
              ${res.hits
                .map((h) => {
                  const isP = h.entry.kind === 'Pathogen';
                  const rec = h.entry.rec;
                  const href = isP ? `#/pathogen/${encodeURIComponent(rec.id)}` : `#/id/${encodeURIComponent(rec.id)}`;
                  return `<tr>
                    <td>${isP ? orgBadge(rec.org) : `${panelBadge(rec.s)}${h.entry.kind === 'Parent NLR' ? ' <span class="badge">Parent</span>' : ''}`}</td>
                    <td>
                      <a class="prot-link cell-trunc" href="${href}">${esc(h.entry.kind === 'Parent NLR' ? rec.pnlr : rec.id)}</a>
                      <details style="margin-top:4px"><summary class="muted" style="cursor:pointer;font-size:12px">Alignment (Q ${h.qStart}–${h.qEnd} / T ${h.tStart}–${h.tEnd})</summary><pre class="aln-pre">${formatAln(h)}</pre></details>
                    </td>
                    <td style="font-size:12.5px"><span class="italic">${esc(rec.sp)}</span> · ${esc(isP ? rec.cls || rec.s : rec.ipr_s || rec.ipr)}${h.entry.nIds > 1 ? ` <span class="muted">(${h.entry.nIds} IDs)</span>` : ''}</td>
                    <td class="num"><b>${h.score}</b></td>
                    <td class="num">${h.identityPct.toFixed(1)}%</td>
                    <td class="num">${h.alignLen}</td>
                    <td class="num">${h.queryCovPct.toFixed(0)}%</td>
                    <td class="num">${bestScoreCell(rec, !isP, false)}</td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      `;
    } else {
      const res = runMotifSearch(raw, entries, { useRegex: true, maxResults: 200 });
      const sec = ((performance.now() - t0) / 1000).toFixed(2);
      if (res.error) { outEl.innerHTML = `<div class="callout warn">${esc(res.error)}</div>`; return; }
      if (!res.hits.length) { outEl.innerHTML = `<div class="callout">No matches for <code>${esc(res.pattern)}</code> (${sec}s).</div>`; return; }

      outEl.innerHTML = `
        <div class="table-meta"><div><b>${fmtInt(res.totalMatches)}</b> matched sequences (showing ${res.hits.length}, ${sec}s)</div></div>
        <div class="tblwrap">
          <table class="dt">
            <thead><tr><th>Database</th><th>Protein</th><th>Species / Domain</th><th>Context</th><th class="num">Best ipSAE</th></tr></thead>
            <tbody>
              ${res.hits
                .map((h) => {
                  const isP = h.entry.kind === 'Pathogen';
                  const rec = h.entry.rec;
                  const href = isP ? `#/pathogen/${encodeURIComponent(rec.id)}` : `#/id/${encodeURIComponent(rec.id)}`;
                  const m0 = h.matches[0];
                  const cs = Math.max(0, m0.start - 10);
                  const ce = Math.min(h.entry.seq.length, m0.end + 9);
                  return `<tr>
                    <td>${isP ? orgBadge(rec.org) : `${panelBadge(rec.s)}${h.entry.kind === 'Parent NLR' ? ' <span class="badge">Parent</span>' : ''}`}</td>
                    <td><a class="prot-link cell-trunc" href="${href}">${esc(h.entry.kind === 'Parent NLR' ? rec.pnlr : rec.id)}</a></td>
                    <td style="font-size:12.5px"><span class="italic">${esc(rec.sp)}</span>${h.entry.nIds > 1 ? ` <span class="muted">(${h.entry.nIds} IDs)</span>` : ''}</td>
                    <td class="mono" style="font-size:12px"><span class="muted">${cs > 0 ? '…' : ''}${esc(h.entry.seq.slice(cs, m0.start - 1))}</span><span class="seq-hl-match">${esc(h.entry.seq.slice(m0.start - 1, m0.end))}</span><span class="muted">${esc(h.entry.seq.slice(m0.end, ce))}${ce < h.entry.seq.length ? '…' : ''}</span></td>
                    <td class="num">${bestScoreCell(rec, !isP, false)}</td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  }

  pageEl.querySelector('#seq-run')?.addEventListener('click', run);
  pageEl.querySelector('#seq-clear')?.addEventListener('click', () => { inputEl.value = ''; outEl.innerHTML = ''; });
  const setMode = (m) => {
    mode = m;
    pageEl.querySelectorAll('#seq-mode-seg button').forEach((x) => x.classList.toggle('on', x.dataset.mode === m));
  };
  pageEl.querySelector('#ex-hma')?.addEventListener('click', () => { inputEl.value = `>${exHma.id}\n${exHma.seq}`; setMode('homology'); run(); });
  pageEl.querySelector('#ex-eff')?.addEventListener('click', () => { inputEl.value = `>${exEff.id}\n${exEff.seq}`; setMode('homology'); run(); });
  pageEl.querySelector('#ex-vir')?.addEventListener('click', () => { inputEl.value = `>${exVir.id}\n${exVir.seq}`; setMode('homology'); run(); });
  pageEl.querySelector('#ex-motif')?.addEventListener('click', () => { inputEl.value = 'RXL[RK]'; setMode('motif'); run(); });

  if (initialQuery) run();
}

/* --------------------------------------------------------------------------
   VIEW 8: Datasets & Harvard Dataverse DOIs (#/datasets)
   -------------------------------------------------------------------------- */
function renderDatasets() {
  setNavAndCrumbs('datasets', [{ label: 'Bifrost', href: '#/' }, { label: 'Datasets & DOIs' }], true);
  const meta = store.meta;

  const extractSnippet = `# Stream a single job archive from split zstd parts (requires zstd + GNU tar; macOS: gtar)
cat ID1_E1.tar.zst.* | zstd -dc --long=31 | tar -xvf - --occurrence 'ID1_E1/job_1912_..._seed1.tar.gz'
tar -xzf ID1_E1/job_1912_..._seed1.tar.gz -C ID1_E1/`;

  const reproSnippet = `# Rebuild exact AF3 inputs for multiple seeds using inference_input (doi:10.7910/DVN/2FUARO)
python3 make_af3_inputs.py \\
  --chain-a ID1_inference_input --chain-b E1_inference_input \\
  --a <chain_A> --b <chain_B> --seeds 1 2 3 4 5 --out inputs/`;

  pageEl.innerHTML = `
    <div class="eyebrow">Harvard Dataverse · 14 deposits</div>
    <h1>Datasets &amp; DOIs</h1>
    <p class="lede">The complete Bifrost release is split into 13 screening-set datasets (top-ranked <code>model.cif</code>, confidences, ranking scores, and interface score tables) plus one dataset holding per-chain AF3 MSAs and templates.</p>

    <div class="tblwrap">
      <table class="dt">
        <thead>
          <tr>
            <th>Dataset</th>
            <th>Chain A</th>
            <th>Chain B</th>
            <th class="num">Predictions</th>
            <th class="num">Scored</th>
            <th class="num">Failed</th>
            <th class="num">Missing</th>
            <th class="num">Max ipSAE</th>
            <th>Dataverse DOI</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${meta.datasets
            .map(
              (d) => `
              <tr>
                <td class="mono" style="font-weight:600;color:var(--ink)">${esc(d.id)}</td>
                <td>${panelBadge(d.id_panel)}</td>
                <td><span class="badge">${esc(d.path_panel)}</span> <span class="muted" style="font-size:12px">${esc(meta.panels[d.path_panel].short)}</span></td>
                <td class="num">${fmtInt(d.n_total)}</td>
                <td class="num">${fmtInt(d.n_scored)}</td>
                <td class="num">${fmtInt(d.n_failed)}</td>
                <td class="num">${d.n_missing ? `<span class="badge badge-warn">${fmtInt(d.n_missing)}</span>` : '0'}</td>
                <td class="num">${scoreCellHtml(d.max_ipsae, STATUS.SCORED, false)}</td>
                <td>${doiLinksHtml(d.doi)}</td>
                <td><a class="btn btn-sm" href="#/explorer?set=${encodeURIComponent(d.id)}">Explore</a></td>
              </tr>`
            )
            .join('')}
          <tr style="background:var(--bg2)">
            <td class="mono" style="font-weight:600;color:var(--ink)">inference_input</td>
            <td colspan="7">Per-chain AF3 data-pipeline outputs (MSAs &amp; templates for ID1–ID3, E1–E4, V1) + <code>make_af3_inputs.py</code></td>
            <td>${doiLinksHtml(meta.inference_input.doi)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2>Working with the archives</h2>
    <p>Every pair clicked in the Score Explorer or protein pages generates an exact, ready-to-run extraction command for that specific job. General usage:</p>
    <pre class="code-block">${esc(extractSnippet)}</pre>
    <pre class="code-block">${esc(reproSnippet)}</pre>
  `;
}

/* --------------------------------------------------------------------------
   VIEW 9: Score Glossary (#/glossary)
   -------------------------------------------------------------------------- */
function renderGlossary() {
  setNavAndCrumbs('glossary', [{ label: 'Bifrost', href: '#/' }, { label: 'Score Glossary' }], false);

  pageEl.innerHTML = `
    <div class="eyebrow">Interface scoring · ipsae.py (10 Å PAE / 10 Å dist)</div>
    <h1>Score glossary</h1>
    <p class="lede">All scores were computed on the top-ranked AlphaFold 3 diffusion sample of each pair. Bifrost ranks pairs using conservative <code>ipSAE (min)</code> while retaining every directional subscore and complementary interface metric for exploration.</p>

    <h2>Primary &amp; ipSAE subscores</h2>
    <table class="ev">
      <tr>
        <td><code>ipSAE (min)</code> <span class="badge badge-ID3" style="margin-left:4px">Primary</span></td>
        <td>Minimum of the two directional ipSAE values (<code>min(asym_A, asym_B)</code>) using per-residue <code>d0res</code> scaling (Dunbrack 2025). Requires mutual inter-chain PAE confidence from both chains; ranges 0–1.</td>
      </tr>
      <tr>
        <td><code>ipSAE (max)</code> &amp; <code>mean</code></td>
        <td>Maximum and arithmetic mean of the two directional ipSAE scores. Useful alongside <code>min</code> when a short integrated domain binds a much larger effector.</td>
      </tr>
      <tr>
        <td><code>ipSAE asym A→B / B→A</code></td>
        <td>Directional ipSAE aligned on Chain A (NLR integrated domain) vs. aligned on Chain B (pathogen/pest protein).</td>
      </tr>
      <tr>
        <td><code>ipSAE d0dom</code></td>
        <td>ipSAE with TM-score <code>d0</code> scaled by the total number of residues in both chains with good inter-chain PAE (<code>n0dom</code>). Both <code>min</code> and <code>max</code> are stored.</td>
      </tr>
      <tr>
        <td><code>ipSAE d0chn</code></td>
        <td>ipSAE with <code>d0</code> scaled by the combined full length of both chains (<code>n0chn</code>). Both <code>min</code> and <code>max</code> are stored.</td>
      </tr>
    </table>

    <h2>Complementary interface &amp; contact metrics</h2>
    <table class="ev">
      <tr>
        <td><code>ipTM (AF3)</code> &amp; <code>ipTM d0chn (min)</code></td>
        <td>AlphaFold 3's native interface predicted TM-score (<code>ipTM_af</code>) and the conservative directional minimum of the chain-length recomputed score (<code>ipTM_d0chn</code>).</td>
      </tr>
      <tr>
        <td><code>pDockQ</code> &amp; <code>pDockQ2</code></td>
        <td>Interface quality predictors combining interface pLDDT, PAE, and contact area (Bryant et al. 2022; Zhu et al. 2023).</td>
      </tr>
      <tr>
        <td><code>LIS (min / mean)</code></td>
        <td>Local Interaction Score computed over confident local inter-chain PAE regions (Kim et al. 2024).</td>
      </tr>
      <tr>
        <td><code>Contacts (dist1, dist2)</code></td>
        <td>Chain-aligned conservative minimum unique residues in Chain A (<code>dist1</code>, ID) and Chain B (<code>dist2</code>, pathogen) within <b>10 Å</b> spatial distance <em>and</em> <b>PAE &lt; 10 Å</b> across both directional alignments (<code>asym_A</code>, <code>asym_B</code>). Shown as total <code>dist1 + dist2</code> in tables and split per chain on Pair Detail pages.</td>
      </tr>
      <tr>
        <td><code>nres1, nres2</code></td>
        <td>Chain-aligned conservative minimum unique residues in Chain A (<code>nres1</code>) and Chain B (<code>nres2</code>) participating in any inter-chain pair with <b>PAE &lt; 10 Å</b> (without the 10 Å distance cutoff).</td>
      </tr>
    </table>

    <h2>Score distributions &amp; metric comparison</h2>
    ${renderFigureHtml({
      src: './assets/figures/FS3_scores.png',
      title: 'Figure S3. Interface confidence metrics differ in score distributions and rankings',
      caption: '(A) Confidence score distributions for all 745,832 scored predictions across minimum ipSAE, AlphaFold 3 ipTM, and pDockQ, coloured by organism type (log scale). (B) Correlation of ipTM with minimum ipSAE (Spearman ρ = 0.64 overall); many high-ipTM models have low minimum ipSAE.',
    })}
  `;
  wireFigureLightboxes(pageEl);
}

/* --------------------------------------------------------------------------
   VIEW 10: Methods, Disclaimers & Terms (#/methods)
   -------------------------------------------------------------------------- */
function renderMethods() {
  setNavAndCrumbs('methods', [{ label: 'Bifrost', href: '#/' }, { label: 'Methods & Terms' }], false);
  const meta = store.meta;
  const s = meta.summary;

  // Build structured step-by-step NLR ID curation pipeline from pipeline_counts.tsv
  const pcByStage = new Map(meta.pipeline_counts.map((r) => [r.stage, r]));
  const numOrNull = (val) => (val === '' || val === null || val === undefined ? null : Number(val));
  const rowVals = (stage) => {
    const r = pcByStage.get(stage) || {};
    const v1 = numOrNull(r.ID1_RefSeq);
    const v2 = numOrNull(r.ID2_superasterids);
    const v3 = numOrNull(r.ID3_Solanaceae);
    const tot = v1 !== null && v2 !== null && v3 !== null ? v1 + v2 + v3 : null;
    return [v1, v2, v3, tot];
  };
  const pipelineSteps = [
    {
      label: 'Plant genomes & proteomes',
      sub: 'RefSeq proteomes (ID1) and Helixer v0.3.2 genome annotations (ID2, ID3)',
      vals: rowVals('Genomes / proteomes screened'),
      unit: 'genomes',
      opAfter: 'Extract predicted proteomes',
    },
    {
      label: 'Total plant proteins screened',
      sub: 'Input sequences searched with NLRtracker',
      vals: rowVals('Proteins screened'),
      opAfter: 'NLRtracker annotation (InterProScan + canonical NLR rules)',
    },
    {
      label: 'Full-length NLRs (NLRtracker)',
      sub: 'NLRtracker CHAIN entries with status NLR',
      vals: rowVals('NLRs (NLRtracker)'),
      opAfter: 'Retain canonical & integrated-domain architectures',
    },
    {
      label: 'NLRs with retained architecture',
      sub: 'CNL, TNL, RNL, SD-CNL, NL, and ID-bearing variants',
      vals: rowVals('NLRs with retained architecture'),
      opAfter: 'CD-HIT (100% sequence identity within each dataset)',
    },
    {
      label: 'Deduplicated NLRs',
      sub: 'Identical full-length NLR sequences collapsed',
      vals: rowVals('After CD-HIT (100% identity)'),
      opAfter: 'NB-ARC length filter (retain 250–400 aa)',
    },
    {
      label: 'NB-ARC length-filtered NLRs',
      sub: 'ID2 intermediate count not recorded separately in summary table',
      vals: rowVals('After NB-ARC length filter (250-400 aa)'),
      opAfter: 'Select NLRs carrying ≥1 NLRtracker non-canonical DOMAIN feature',
    },
    {
      label: 'NLRs with non-canonical domain',
      sub: 'Candidate integrated-domain NLRs',
      vals: rowVals('NLRs with NLRtracker OTHER domain'),
      opAfter: 'InterProScan filtering (remove 34 canonical/repeat entries & N-terminal-only OCNL/ONL)',
    },
    {
      label: 'NLRs with ≥1 non-NLR InterPro domain',
      sub: 'High-confidence non-canonical integrated domains',
      vals: rowVals('NLRs with >=1 non-NLR InterPro entry (OCNL/ONL excluded)'),
      opAfter: 'Sort & merge overlapping InterPro intervals; excise ID blocks',
    },
    {
      label: 'Excised integrated domain blocks',
      sub: 'Multi-ID parent NLRs contribute more than one block',
      vals: rowVals('ID blocks extracted'),
      opAfter: 'CD-HIT (100% identity within each panel)',
    },
    {
      label: 'Non-redundant IDs within panel',
      sub: 'Removes identical and substring-contained IDs',
      vals: rowVals('IDs after CD-HIT (100% identity, within panel)'),
      opAfter: 'CD-HIT-2D across panels (−65 from ID2 vs ID1; −134 from ID3 vs ID1+ID2)',
    },
    {
      label: 'Cataloged non-redundant ID panels',
      sub: '2,411 parent NLRs (784 ID1 · 1,041 ID2 · 586 ID3)',
      vals: rowVals('IDs after CD-HIT-2D vs earlier panels (final)'),
      opAfter: 'Exclude 4 kinase-like ID3 domains prior to AlphaFold 3 inference',
    },
    {
      label: 'Final screened Bifrost ID panels',
      sub: '2,409 parent NLRs across 343 plant species and 34 orders',
      vals: [
        meta.ids.filter((r) => r.s === 'ID1' && r.scr).length,
        meta.ids.filter((r) => r.s === 'ID2' && r.scr).length,
        meta.ids.filter((r) => r.s === 'ID3' && r.scr).length,
        s.n_ids_screened,
      ],
      isFinal: true,
    },
  ];
  const fmtPipe = (v) => (v === null ? '<span class="muted">—</span>' : fmtInt(v));

  pageEl.innerHTML = `
    <div class="eyebrow">AlphaFold 3 v3.0.1 · Kamoun Lab, TSL</div>
    <h1>Methods, disclaimers &amp; terms</h1>
    <p class="lede">Version provenance, reproducibility guidance, AlphaFold 3 licensing terms, data completeness notes, and NLR integrated domain curation counts.</p>

    <div class="callout pink">
      <b>Open science and continuing work.</b>
      This early dataset release reflects our commitment to make Bifrost data available as soon as possible, while making their scope and limitations explicit. We release the data before comprehensive biological analysis and experimental validation because generating them requires substantial computational resources and sharing them now allows other laboratories to investigate candidates relevant to their own systems. Calibration of confidence scores and experimental validation remain continuing work; we will share our own analyses as they are completed. We welcome independent analyses, experimental testing, and feedback via the
      <a class="ext-link" href="https://zenodo.org/communities/openplantnlr/" target="_blank" rel="noopener">OpenPlantNLR community on Zenodo &#8599;</a>
      or <a class="ext-link" href="mailto:sophien.kamoun@tsl.ac.uk">sophien.kamoun@tsl.ac.uk</a>.
    </div>

    <div class="callout warn">
      <b>Reproducibility disclaimer.</b>
      Models were generated with <b>AlphaFold 3 v3.0.1</b> (1 seed × 5 diffusion samples) and may differ from models produced by other AlphaFold 3 versions or sequence databases.
      Always verify reproducibility with multiple independent seeds before relying on individual predictions — exact multi-seed inputs can be rebuilt from
      <a class="ext-link" href="${esc(meta.inference_input.doi)}" target="_blank" rel="noopener">doi:10.7910/DVN/2FUARO &#8599;</a> using <code>make_af3_inputs.py</code>.
    </div>

    <div class="callout">
      <b>License &amp; AlphaFold 3 Terms of Use.</b>
      Structure files deposited on Harvard Dataverse are subject to the
      <a class="ext-link" href="https://github.com/google-deepmind/alphafold3/blob/main/OUTPUT_TERMS_OF_USE.md" target="_blank" rel="noopener">AlphaFold 3 Output Terms of Use &#8599;</a>
      (a copy, <code>TERMS_OF_USE.md</code>, is included in every job archive).
      Contact: <b>Kamoun Lab</b>, The Sainsbury Laboratory, Norwich, UK.
    </div>

    <h2>Prediction &amp; scoring protocol</h2>
    <p>
      To scale AlphaFold 3 to hundreds of thousands of pairwise complexes, Bifrost decouples the CPU-intensive data pipeline from GPU inference:
      MSAs and structural templates are computed once for each of the 3,184 unique protein chains and recombined pairwise into multimer inputs.
    </p>
    ${renderFigureHtml({
      src: './assets/figures/F3_pipeline.png',
      title: 'Figure 3. The Bifrost AlphaFold 3 structure prediction pipeline overview',
      caption: 'Step 1: Compute per-chain MSAs and templates once per unique chain. Step 2: Combine cached single-chain inputs pairwise and run AlphaFold 3 v3.0.1 inference (1 seed × 5 diffusion samples). Step 3: Score top-ranked models with ipSAE and archive outputs.',
    })}
    ${renderFigureHtml({
      src: './assets/figures/FS2_pipeline_detail.png',
      title: 'Figure S2. Detailed Bifrost AlphaFold 3 structure prediction pipeline',
      caption: '(1–2) Single-chain input JSON conversion and per-chain MSA/template generation. (3) Pairwise multimer assembly, AF3 v3.0.1 inference, model compression, and ipSAE.py scoring (10 Å PAE / 10 Å distance). (4) Downstream analysis and visualization on the released scores.',
    })}
    <ul>
      <li><b>Data pipeline:</b> AlphaFold 3 v3.0.1 MSAs and structural templates were computed once per unique chain (2,811 IDs and 373 pathogen/pest proteins) and reused across all pairwise jobs.</li>
      <li><b>Inference:</b> AlphaFold 3 v3.0.1, dialect <code>alphafold3</code> (v1 input / v4 output), 1 model seed × 5 diffusion samples, default settings, no ligands.</li>
      <li><b>Scoring:</b> The top-ranked model of each pair was scored with <code>ipsae.py</code> using 10 Å PAE and 10 Å distance cutoffs.</li>
      <li><b>Deposited files:</b> Top-ranked <code>model.cif</code>, full confidences (pLDDT, PAE, contacts), summary confidences, ranking scores of all 5 samples, and compiled score tables.</li>
    </ul>

    <h2>Data completeness &amp; known exclusions</h2>
    <ul>
      <li><b>Panel E2 scope:</b> <em>Myzus persicae</em> (154 proteins) was screened against <b>ID1</b> only; <code>ID2_E2</code> and <code>ID3_E2</code> were not run.</li>
      <li><b>Unscreened ID3 records:</b> 4 constructs in <code>Bifrost_IDs_metadata.tsv</code> were excluded prior to AF3 inference (695 screened out of 699 cataloged).</li>
      <li><b>Failed ipSAE scoring:</b> ${fmtInt(s.total_failed)} pairs across the 13 sets completed AF3 inference but failed ipSAE scoring (logged in each dataset's <code>ipsae_failed.tsv</code>).</li>
      <li><b>Missing ID2_V1 scores:</b> Jobs <code>70070–71070</code> (${fmtInt(s.total_missing)} pairs) in <code>ID2_V1</code> are absent from both the score table and <code>ipsae_failed.tsv</code>.</li>
    </ul>

    <h2>NLR integrated domain curation pipeline <small>Step-by-step filtering from 756 genomes to 2,811 screened IDs</small></h2>
    <div class="pipe" role="list" aria-label="NLR integrated domain curation pipeline steps">
      <div class="pipe-head" aria-hidden="true">
        <div></div>
        <div>Pipeline stage</div>
        <div class="ph-num"><span class="dot" style="background:var(--cyan)"></span>ID1</div>
        <div class="ph-num"><span class="dot" style="background:var(--purple)"></span>ID2</div>
        <div class="ph-num"><span class="dot" style="background:var(--pink)"></span>ID3</div>
        <div class="ph-num">Total</div>
      </div>
      ${pipelineSteps
        .map(
          (st, idx) => `
          <div class="pipe-step${st.isFinal ? ' pipe-final' : ''}" role="listitem">
            <span class="pipe-idx">${String(idx + 1).padStart(2, '0')}</span>
            <div class="pipe-label">${esc(st.label)}<small>${esc(st.sub)}</small></div>
            <div class="pipe-val" data-lbl="ID1">${fmtPipe(st.vals[0])}</div>
            <div class="pipe-val" data-lbl="ID2">${fmtPipe(st.vals[1])}</div>
            <div class="pipe-val" data-lbl="ID3">${fmtPipe(st.vals[2])}</div>
            <div class="pipe-val pipe-tot" data-lbl="Total">${fmtPipe(st.vals[3])}</div>
          </div>
          ${
            st.opAfter
              ? `<div class="pipe-conn" aria-hidden="true">
                   <div class="pipe-arrow">
                     <svg width="12" height="18" viewBox="0 0 12 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                       <line x1="6" y1="1" x2="6" y2="14"/>
                       <polyline points="2.5,11 6,15 9.5,11"/>
                     </svg>
                   </div>
                   <div class="pipe-op">${esc(st.opAfter)}</div>
                 </div>`
              : ''
          }`
        )
        .join('')}
    </div>

    <h2>References</h2>
    <ol style="font-size:13.5px;line-height:1.65">
      ${meta.references
        .map((ref) => `<li><span class="badge" style="margin-right:6px">${esc(ref.topic)}</span>${esc(ref.citation)} ${doiLinksHtml(ref.doi)}</li>`)
        .join('')}
    </ol>
  `;
  wireFigureLightboxes(pageEl);
}

/* --------------------------------------------------------------------------
   VIEW 11: Acknowledgements, Authors & Funders (#/acknowledgements)
   -------------------------------------------------------------------------- */
function renderAcknowledgements() {
  setNavAndCrumbs('acknowledgements', [{ label: 'Bifrost', href: '#/' }, { label: 'Acknowledgements' }], false);

  const aicProjectUrl = 'https://www.aicfoodsecurity.org/projects/accelerating-the-breeding-of-disease-resistant-crops-';

  const funders = [
    {
      name: 'Google.org',
      role: 'AI for Science Fund',
      logo: './assets/logos/google_org.svg',
      url: 'https://www.google.org/',
    },
    {
      name: 'AI Collaborative for Food Security',
      role: 'Accelerating the Breeding of Disease-Resistant Crops',
      logo: './assets/logos/aicfs.png',
      url: aicProjectUrl,
    },
    {
      name: 'Gatsby Charitable Foundation',
      role: 'Kamoun & Hogenhout labs',
      logo: './assets/logos/gatsby.png',
      url: 'https://www.gatsby.org.uk/',
    },
    {
      name: 'UKRI — BBSRC',
      role: 'Plant Health ISP (BB/P012574, BBS/E/J/000PR9795–9798)',
      logo: './assets/logos/bbsrc.png',
      url: 'https://www.ukri.org/councils/bbsrc/',
    },
    {
      name: 'UKRI — EPSRC',
      role: 'Grant EP/Y032187/1',
      logo: './assets/logos/epsrc.png',
      url: 'https://www.ukri.org/councils/epsrc/',
    },
    {
      name: 'European Research Council',
      role: 'Grant 743165',
      logo: './assets/logos/erc.png',
      url: 'https://erc.europa.eu/',
    },
  ];

  const contributions = [
    ['Conceptualization', 'A.T., A.P., Y.S., S.K.'],
    ['Methodology', 'A.T., M.G., Y.X., A.B., S.G., D.M.'],
    ['Data curation', 'A.T., M.G., A.B., D.L., S.M.'],
    ['Formal analysis', 'A.T., M.G., Y.X., A.P., S.M., S.H., S.K.'],
    ['Investigation', 'A.T., M.G., M.S., Y.X., A.P., A.H., S.M.'],
    ['Resources', 'A.T., S.G., D.M., S.H.'],
    ['Writing — original draft', 'A.T., A.P., S.K.'],
    ['Writing — review and editing', 'A.T., S.K.'],
    ['Visualization', 'A.T., A.P.'],
    ['Supervision', 'A.T., S.K., S.H.'],
    ['Project administration', 'A.T., S.K.'],
    ['Funding acquisition', 'S.K.'],
  ];

  pageEl.innerHTML = `
    <div class="eyebrow">Team, host institution &amp; funders</div>
    <h1>Acknowledgements</h1>
    <p class="lede">
      Host institution, funding bodies, authors, and acknowledgements for <em>The Bifrost dataset of AlphaFold 3 predictions for plant immune receptor discovery</em>.
    </p>

    <h2>Host institution</h2>
    <a class="host-card" href="https://www.tsl.ac.uk/" target="_blank" rel="noopener" title="The Sainsbury Laboratory">
      <div class="host-logo-stage">
        <img src="./assets/logos/tsl.svg" alt="The Sainsbury Laboratory logo" />
      </div>
      <div class="host-meta">
        <div class="funder-name">The Sainsbury Laboratory (TSL)</div>
        <div class="funder-role">Kamoun Lab · University of East Anglia, Norwich Research Park, Norwich, UK</div>
      </div>
      <span class="host-ext" aria-hidden="true">tsl.ac.uk &#8599;</span>
    </a>

    <h2>Funders &amp; supporting initiatives</h2>
    <div class="funder-grid">
      ${funders
        .map(
          (f) => `
        <a class="funder-card" href="${esc(f.url)}" target="_blank" rel="noopener" title="${esc(f.name)}">
          <div class="funder-logo-stage">
            <img src="${esc(f.logo)}" alt="${esc(f.name)} logo" loading="lazy" />
          </div>
          <div class="funder-meta">
            <div class="funder-name">${esc(f.name)}</div>
            <div class="funder-role">${esc(f.role)}</div>
          </div>
        </a>`
        )
        .join('')}
    </div>

    <h2>Funding</h2>
    <p class="abstract-text">
      Bifrost is supported by Google.org through the AI for Science Fund and participates in the
      <a class="ext-link" href="${esc(aicProjectUrl)}" target="_blank" rel="noopener">AI Collaborative for Food Security</a>.
      Work in the Kamoun and Hogenhout labs are also supported by the Gatsby Charitable Foundation, the UK Research and Innovation (UKRI)
      Biotechnology and Biological Sciences Research Council (BBSRC) BB/P012574 (Plant Health ISP), BBSRC BBS/E/J/000PR9795
      (Plant Health ISP - Recognition), BBSRC BBS/E/J/000PR9796 (Plant Health ISP - Response), BBSRC BBS/E/J/000PR9797
      (Plant Health ISP – Susceptibility) and BBSRC BBS/E/J/000PR9798 (Plant Health ISP – Evolution). The Kamoun Lab received
      additional support from the European Research Council (ERC) 743165 and Engineering and Physical Sciences Research Council
      EP/Y032187/1. The John Innes Centre (JIC) is grant aided by the John Innes Foundation.
    </p>

    <h2>Acknowledgements</h2>
    <p class="abstract-text">
      We thank Rainier Aliment, Jack Mason, and Abi Ramanan (Google) for their help and input.
    </p>

    <h2>Authors &amp; affiliations</h2>
    <p class="author-list">
      AmirAli Toghani<sup>1</sup>, Matteo Gravino<sup>1</sup>, Maryam Sargolzaei<sup>1</sup>, Yuxuan Xi<sup>1</sup>,
      Amal Boukteb<sup>1</sup>, Sam Gallop<sup>2</sup>, Andrés Posbeyikian<sup>1</sup>, Yu Sugihara<sup>1</sup>,
      Daniel Lüdke<sup>1</sup>, Adeline Harant<sup>1</sup>, Sam T. Mugford<sup>3</sup>, Dan MacLean<sup>1</sup>,
      Saskia A. Hogenhout<sup>3</sup>, Sophien Kamoun<sup>1*</sup>
    </p>
    <ul class="affil-list">
      <li><sup>1</sup>The Sainsbury Laboratory, University of East Anglia, Norwich, UK.</li>
      <li><sup>2</sup>Norwich BioScience Institutes, Norwich Research Park, Norwich, UK.</li>
      <li><sup>3</sup>Department of Crop Genetics, John Innes Centre, Norwich Research Park, Norwich, United Kingdom.</li>
      <li style="margin-top:8px"><sup>*</sup>To whom correspondence should be addressed: <a class="ext-link" href="mailto:sophien.kamoun@tsl.ac.uk">sophien.kamoun@tsl.ac.uk</a></li>
    </ul>

    <h2>Author contributions</h2>
    <table class="ev">
      ${contributions.map(([role, who]) => `<tr><td>${esc(role)}</td><td>${esc(who)}</td></tr>`).join('')}
    </table>

    <h2>Competing interests</h2>
    <p style="font-size:14px;color:var(--ink2);max-width:68ch">
      S.K. receives funding from industry for NLR biology and has co-founded a start-up company (Resurrect Bio Ltd.) related to NLR biology.
    </p>
  `;
}

function animatePageTransition() {
  pageEl.classList.remove('page-enter');
  void pageEl.offsetWidth; // restart gentle fade+glide animation
  pageEl.classList.add('page-enter');
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/* --------------------------------------------------------------------------
   Hash Router
   -------------------------------------------------------------------------- */
async function handleRoute() {
  const rawHash = window.location.hash || '#/';
  const cleaned = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  if (cleaned === 'page') {
    pageEl?.focus();
    return;
  }

  const gen = ++routeGen;
  const qIdx = cleaned.indexOf('?');
  const pathPart = qIdx === -1 ? cleaned : cleaned.slice(0, qIdx);
  const queryPart = qIdx === -1 ? '' : cleaned.slice(qIdx + 1);
  const segs = (pathPart || '/').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const params = new URLSearchParams(queryPart);

  try {
    await store.loadMeta();
    if (gen !== routeGen) return;
    buildSidebar(store.meta);

    if (segs.length === 0) {
      renderHome();
    } else if (segs[0] === 'panels') {
      renderInputPanels();
    } else if (segs[0] === 'explorer') {
      setNavAndCrumbs('explorer', [{ label: 'Bifrost', href: '#/' }, { label: 'Score Explorer' }], true);
      await renderExplorerView(pageEl, params);
    } else if (segs[0] === 'ids') {
      renderIdsDirectory(params);
    } else if (segs[0] === 'id' && segs[1]) {
      await renderIdDetail(safeDecode(segs.slice(1).join('/')), gen);
    } else if (segs[0] === 'pathogens') {
      renderPathogensDirectory(params);
    } else if (segs[0] === 'pathogen' && segs[1]) {
      await renderPathogenDetail(safeDecode(segs.slice(1).join('/')), gen);
    } else if (segs[0] === 'domains') {
      renderDomainsDirectory(params);
    } else if (segs[0] === 'domain' && segs[1]) {
      renderDomainDetail(safeDecode(segs[1]));
    } else if (segs[0] === 'heatmap') {
      setNavAndCrumbs('heatmap', [{ label: 'Bifrost', href: '#/' }, { label: 'Tools' }, { label: 'Custom Heatmap' }], true);
      await renderHeatmapView(pageEl, params);
    } else if (segs[0] === 'search') {
      renderSequenceSearch(params);
    } else if (segs[0] === 'datasets') {
      renderDatasets();
    } else if (segs[0] === 'glossary') {
      renderGlossary();
    } else if (segs[0] === 'methods') {
      renderMethods();
    } else if (segs[0] === 'acknowledgements') {
      renderAcknowledgements();
    } else if (segs[0] === 'pair' && segs[1] && segs[2]) {
      const dsName = safeDecode(segs[1]);
      const validJob = /^\d+$/.test(segs[2]);
      const jobNum = validJob ? Number(segs[2]) : NaN;
      setNavAndCrumbs(
        'explorer',
        [
          { label: 'Bifrost', href: '#/' },
          { label: 'Score Explorer', href: '#/explorer' },
          { label: `${dsName} · #${validJob ? jobNum : segs[2]}` },
        ],
        false
      );
      let pair = validJob ? consumeCachedPair(dsName, jobNum) : null;
      if (validJob && !pair) {
        pageEl.innerHTML = `<div class="center-loading"><div class="spinner"></div><div>Loading ${esc(dsName)} job #${jobNum}…</div></div>`;
        pair = await store.getPairByJob(dsName, jobNum);
      }
      if (gen !== routeGen) return;
      if (pair) {
        renderPairPage(pageEl, pair);
      } else {
        pageEl.innerHTML = `<div class="callout warn">Pair <code>${esc(dsName)} #${esc(segs[2])}</code> was not found. <a class="prot-link" href="#/explorer">Return to Score Explorer &rarr;</a></div>`;
      }
    } else {
      renderHome();
    }

    if (gen === routeGen) {
      mainEl?.scrollTo({ top: 0, behavior: 'instant' });
      animatePageTransition();
    }
  } catch (err) {
    console.error(err);
    pageEl.innerHTML = `<div class="callout warn"><b>Error loading Bifrost data:</b> ${esc(err.message)}<br/><span class="muted">Preview locally with <code>python3 -m http.server</code> inside <code>paper/wiki</code>.</span></div>`;
  }
}

setupChrome();
window.addEventListener('hashchange', () => {
  if (window.location.hash !== '#page') window.__bifrostNavCount++;
  handleRoute();
});
handleRoute();
