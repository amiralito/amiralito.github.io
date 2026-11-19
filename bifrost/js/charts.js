/**
 * Bifrost Wiki — Minimal, Non-Overlapping Inline SVG Charts & NLR Schematics
 * Palette derived directly from paper/data/scripts/bifrost_style.py
 */

export const LOGO_PALETTE = {
  cyan: '#4cc9f0',
  sky: '#4895ef',
  blue: '#4361ee',
  indigo: '#3f37c9',
  navy: '#3a0ca3',
  pink: '#f72585',
  magenta: '#b5179e',
  purple: '#7209b7',
  violet: '#560bad',
  deep: '#480ca8',
};

export const ID_COLORS = {
  ID1: '#4cc9f0',
  ID2: '#7209b7',
  ID3: '#f72585',
};

export const ORG_COLORS = {
  Oomycete: '#f72585',
  Nematode: '#4cc9f0',
  Insect: '#4361ee',
  Virus: '#7209b7',
};

export const NLR_COLORS = {
  CNL: '#F8333C',
  'CNL G10': '#FCAB10',
  RNL: '#00CC66',
  TNL: '#2B9EB3',
  TN: '#282953',
  NL: '#64748b',
  Other: '#64748b',
};

export function scoreTier(v) {
  if (v >= 0.6) return 'tier-high';
  if (v >= 0.5) return 'tier-strong';
  if (v >= 0.3) return 'tier-mod';
  if (v >= 0.1) return 'tier-low';
  return 'tier-zero';
}

export function scoreColor(v) {
  if (v >= 0.6) return '#f72585';
  if (v >= 0.5) return '#b5179e';
  if (v >= 0.3) return '#7209b7';
  if (v >= 0.1) return '#4895ef';
  return '#94a3b8';
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Multi-series step histogram (log10 or linear) with guaranteed non-overlapping labels.
 */
export function renderOrgHistogramSvg(seriesMap, { metricLabel = 'ipSAE (min)', logScale = true, width = 680, height = 248 } = {}) {
  const pad = { top: 26, right: 20, bottom: 42, left: 62 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const orgs = ['Oomycete', 'Nematode', 'Insect', 'Virus'];
  const nBins = 20;

  let maxVal = 1;
  for (const org of orgs) {
    const arr = seriesMap[org] || [];
    for (const v of arr) if (v > maxVal) maxVal = v;
  }

  const yMap = (val) => {
    if (logScale) {
      const lv = val > 0 ? Math.log10(val + 1) : 0;
      const lmax = Math.log10(maxVal + 1);
      return pad.top + plotH * (1 - lv / lmax);
    }
    return pad.top + plotH * (1 - val / maxVal);
  };

  const xMap = (i) => pad.left + (i / nBins) * plotW;

  const yTicks = logScale
    ? [1, 10, 100, 1000, 10000, 100000].filter((t) => t <= maxVal * 1.4)
    : [0, Math.round(maxVal * 0.25), Math.round(maxVal * 0.5), Math.round(maxVal * 0.75), maxVal];

  let gridSvg = '';
  for (const t of yTicks) {
    const y = yMap(t);
    const label = t >= 1000 ? `${t / 1000}k` : String(t);
    gridSvg += `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${pad.left + plotW}" y2="${y.toFixed(1)}" class="chart-grid"/>`;
    gridSvg += `<text x="${pad.left - 9}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" class="chart-tick">${label}</text>`;
  }

  let xTicksSvg = '';
  for (let i = 0; i <= 10; i += 2) {
    const x = xMap(i * 2);
    xTicksSvg += `<line x1="${x.toFixed(1)}" y1="${pad.top + plotH}" x2="${x.toFixed(1)}" y2="${pad.top + plotH + 4}" class="chart-axis"/>`;
    xTicksSvg += `<text x="${x.toFixed(1)}" y="${pad.top + plotH + 18}" text-anchor="middle" class="chart-tick">${(i / 10).toFixed(1)}</text>`;
  }

  // Reference threshold lines — labels sit strictly above plot area (no overlap with data)
  let refSvg = '';
  for (const thr of [0.3, 0.5]) {
    const x = pad.left + thr * plotW;
    refSvg += `<line x1="${x.toFixed(1)}" y1="${pad.top}" x2="${x.toFixed(1)}" y2="${pad.top + plotH}" class="chart-ref-line"/>`;
    refSvg += `<text x="${x.toFixed(1)}" y="${pad.top - 8}" text-anchor="middle" class="chart-ref-label">${thr.toFixed(1)}</text>`;
  }

  let linesSvg = '';
  for (const org of orgs) {
    const arr = seriesMap[org] || [];
    if (!arr.length) continue;
    const pts = [];
    for (let i = 0; i < nBins; i++) {
      const x0 = xMap(i);
      const x1 = xMap(i + 1);
      const y = yMap(arr[i] || 0);
      pts.push(`${x0.toFixed(1)},${y.toFixed(1)}`);
      pts.push(`${x1.toFixed(1)},${y.toFixed(1)}`);
    }
    linesSvg += `<polyline fill="none" stroke="${ORG_COLORS[org]}" stroke-width="2" stroke-linejoin="round" points="${pts.join(' ')}"/>`;
  }

  let hoverSvg = '';
  const binW = plotW / nBins;
  for (let i = 0; i < nBins; i++) {
    const lo = (i * 0.05).toFixed(2);
    const hi = ((i + 1) * 0.05).toFixed(2);
    const parts = orgs.map((o) => `${o}: ${(seriesMap[o]?.[i] || 0).toLocaleString()}`).join(' | ');
    hoverSvg += `<rect x="${xMap(i).toFixed(1)}" y="${pad.top}" width="${binW.toFixed(1)}" height="${plotH}" fill="transparent"><title>${metricLabel} [${lo}, ${hi}): ${parts}</title></rect>`;
  }

  return `
    <svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="${esc(metricLabel)} distribution by organism type">
      ${gridSvg}
      ${refSvg}
      <line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}" y2="${pad.top + plotH}" class="chart-axis"/>
      <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}" class="chart-axis"/>
      ${xTicksSvg}
      ${linesSvg}
      ${hoverSvg}
      <text x="${pad.left + plotW / 2}" y="${height - 5}" text-anchor="middle" class="chart-axis-title">${esc(metricLabel)}</text>
      <text x="15" y="${pad.top + plotH / 2}" text-anchor="middle" transform="rotate(-90 15 ${pad.top + plotH / 2})" class="chart-axis-title">${logScale ? 'Pairs (log₁₀)' : 'Pairs'}</text>
    </svg>
  `;
}

/**
 * Single-series histogram bar chart with clean non-overlapping axis & threshold labels.
 */
export function renderSimpleHistogramSvg(values, {
  metricLabel = 'ipSAE (min)',
  nBins = 20,
  logScale = true,
  width = 560,
  height = 180,
  accentColor = '#4361ee',
} = {}) {
  const counts = new Uint32Array(nBins);
  let maxC = 1;
  for (let i = 0; i < values.length; i++) {
    const b = Math.min(nBins - 1, Math.max(0, Math.floor(values[i] * nBins)));
    counts[b]++;
    if (counts[b] > maxC) maxC = counts[b];
  }

  const pad = { top: 24, right: 16, bottom: 38, left: 54 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const useLog = logScale && maxC > 25;
  const yMap = (c) => {
    if (c === 0) return pad.top + plotH;
    if (useLog) return pad.top + plotH * (1 - Math.log10(c + 1) / Math.log10(maxC + 1));
    return pad.top + plotH * (1 - c / maxC);
  };

  const yTicks = useLog
    ? [1, 10, 100, 1000, 10000, 100000].filter((t) => t <= maxC * 1.4)
    : [0, Math.round(maxC / 2), maxC].filter((v, idx, a) => a.indexOf(v) === idx);

  let gridSvg = '';
  for (const t of yTicks) {
    const y = yMap(t);
    const label = t >= 1000 ? `${(t / 1000).toFixed(t >= 10000 ? 0 : 1)}k` : String(t);
    gridSvg += `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${pad.left + plotW}" y2="${y.toFixed(1)}" class="chart-grid"/>`;
    gridSvg += `<text x="${pad.left - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" class="chart-tick">${label}</text>`;
  }

  const binW = plotW / nBins;
  let barsSvg = '';
  for (let i = 0; i < nBins; i++) {
    const c = counts[i];
    if (c === 0) continue;
    const x = pad.left + i * binW + 1.2;
    const y = yMap(c);
    const h = Math.max(2, pad.top + plotH - y);
    const lo = (i / nBins).toFixed(2);
    const hi = ((i + 1) / nBins).toFixed(2);
    const mid = (i + 0.5) / nBins;
    const fill = mid >= 0.5 ? '#f72585' : mid >= 0.3 ? '#7209b7' : accentColor;
    barsSvg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1.5, binW - 2.4).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${fill}" fill-opacity="0.86"><title>${metricLabel} [${lo}, ${hi}): ${c.toLocaleString()} pairs</title></rect>`;
  }

  let xTicksSvg = '';
  for (let i = 0; i <= 10; i += 2) {
    const x = pad.left + (i / 10) * plotW;
    xTicksSvg += `<text x="${x.toFixed(1)}" y="${pad.top + plotH + 16}" text-anchor="middle" class="chart-tick">${(i / 10).toFixed(1)}</text>`;
  }

  let refSvg = '';
  for (const thr of [0.3, 0.5]) {
    const x = pad.left + thr * plotW;
    refSvg += `<line x1="${x.toFixed(1)}" y1="${pad.top}" x2="${x.toFixed(1)}" y2="${pad.top + plotH}" class="chart-ref-line"/>`;
    refSvg += `<text x="${x.toFixed(1)}" y="${pad.top - 7}" text-anchor="middle" class="chart-ref-label">${thr.toFixed(1)}</text>`;
  }

  return `
    <svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="${esc(metricLabel)} distribution">
      ${gridSvg}
      ${barsSvg}
      ${refSvg}
      <line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}" y2="${pad.top + plotH}" class="chart-axis"/>
      <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}" class="chart-axis"/>
      ${xTicksSvg}
      <text x="${pad.left + plotW / 2}" y="${height - 4}" text-anchor="middle" class="chart-axis-title">${esc(metricLabel)}${useLog ? ' (log₁₀ count)' : ''}</text>
    </svg>
  `;
}

/**
 * Minimal, Solid-Filled Parent NLR Domain Architecture Schematic
 *
 * Uses exact NLRtracker domain residue boundaries (`idRec.nd`) plotted to scale
 * along 1..parent_length, with solid-filled rounded pills along the Bifrost
 * spectrum and strictly separated lanes so callouts, domain boxes, inner text,
 * and endpoint coordinates NEVER overlap.
 */
export function renderNlrSchematicSvg(idRec, { width = 760 } = {}) {
  const plen = Math.max(1, idRec.plen || idRec.len || 100);
  const st = Math.max(1, idRec.st || 1);
  const en = Math.min(plen, idRec.en || idRec.len || plen);

  const padL = 18;
  const padR = 18;
  const trackW = width - padL - padR;
  const pillH = 26;
  const xPos = (aa) => padL + ((aa - 1) / Math.max(1, plen - 1)) * trackW;

  // Solid Bifrost-palette fills (with crisp white-text contrast)
  const fillFor = (tok, isOther = false) => {
    if (isOther) return '#8b93a7';
    const u = tok.toUpperCase();
    if (u === 'TIR' || u === 'SD' || u === 'R1') return '#0e93bd';
    if (u === 'CC') return '#4361ee';
    if (u === 'RPW8') return '#2a9d8f';
    if (u === 'NB-ARC' || u === 'NBARC') return '#3f37c9';
    if (u === 'LRR') return '#7209b7';
    return '#64748b';
  };
  const titleFor = (tok, s, e, isOther = false) => {
    const len = e - s + 1;
    const base = tok === 'SD' ? 'Solanaceae domain (SD / R1)' : `${tok}${isOther ? ' (other NLRtracker domain)' : ' domain'}`;
    return `${base} · ${s}–${e} (${len} aa)`;
  };

  // True residue positions for the excised ID pill
  const rawIdX1 = xPos(st);
  const rawIdX2 = xPos(en);
  // Guarantee visual click/readability width >= 22px for tiny IDs, centered on true midpoint
  const minIdW = 22;
  let idX1 = rawIdX1;
  let idX2 = rawIdX2;
  if (idX2 - idX1 < minIdW) {
    const mid = (rawIdX1 + rawIdX2) / 2;
    idX1 = Math.max(padL, Math.min(padL + trackW - minIdW, mid - minIdW / 2));
    idX2 = idX1 + minIdW;
  }
  const idW = idX2 - idX1;
  const idMid = (idX1 + idX2) / 2;

  const nlrt = Array.isArray(idRec.nd) && idRec.nd.length ? idRec.nd : [];

  // Determine whether the excised ID deeply overlaps (>15 aa) any NLRtracker domain.
  // If so, draw the excised ID on a dedicated lower track (still aligned to exact aa scale)
  // so neither the canonical NLRtracker domain nor the excised ID obscures the other.
  let hasDeepOverlap = false;
  for (const [, ds, de] of nlrt) {
    const ov = Math.min(de, en) - Math.max(ds, st) + 1;
    if (ov > 15) {
      hasDeepOverlap = true;
      break;
    }
  }

  const cyMain = 48; // Primary NLRtracker track (pills y = 35..61)
  const pillYMain = cyMain - pillH / 2;
  const cyId = hasDeepOverlap ? 84 : cyMain;
  const pillYId = cyId - pillH / 2;
  const scaleY = hasDeepOverlap ? 116 : 84;
  const height = hasDeepOverlap ? 128 : 98;

  // Compute exact-coordinate visual spans for NLRtracker domains, resolving tiny junction
  // overlaps cleanly at midpoints with a 2.5px gap while preserving exact coordinates in tooltips.
  const domItems = nlrt.map(([lbl, ds, de, kind]) => ({
    lbl,
    ds,
    de,
    isOther: kind === 1,
    x1: xPos(Math.max(1, ds)),
    x2: xPos(Math.min(plen, de)),
  }));

  // Resolve pairwise junction overlaps between adjacent NLRtracker domains cleanly
  const minGap = 2.5;
  for (let i = 0; i < domItems.length - 1; i++) {
    const a = domItems[i];
    const b = domItems[i + 1];
    if (a.x2 + minGap > b.x1) {
      const mid = (Math.min(a.x2, b.x2) + Math.max(a.x1, b.x1)) / 2;
      a.x2 = Math.max(a.x1 + 4, mid - minGap / 2);
      b.x1 = Math.min(b.x2 - 4, mid + minGap / 2);
    }
  }

  // On single-track layout, trim any minor (<=15 aa) junction touch with the excised ID pill
  if (!hasDeepOverlap) {
    const idGap = 3.5;
    for (const d of domItems) {
      if (d.x1 < idX1 && d.x2 + idGap > idX1) {
        d.x2 = Math.max(d.x1 + 4, idX1 - idGap);
      } else if (d.x2 > idX2 && d.x1 - idGap < idX2) {
        d.x1 = Math.min(d.x2 - 4, idX2 + idGap);
      }
    }
  }

  // Render NLRtracker domain pills
  let domsSvg = '';
  for (const d of domItems) {
    const w = Math.max(4, d.x2 - d.x1);
    const fill = fillFor(d.lbl, d.isOther);
    const fits = w >= d.lbl.length * 6.8 + 12;
    domsSvg += `<rect x="${d.x1.toFixed(1)}" y="${pillYMain}" width="${w.toFixed(1)}" height="${pillH}" rx="7" fill="${fill}"${d.isOther ? ' fill-opacity="0.72"' : ''}><title>${esc(titleFor(d.lbl, d.ds, d.de, d.isOther))}</title></rect>`;
    if (fits) {
      domsSvg += `<text x="${(d.x1 + w / 2).toFixed(1)}" y="${cyMain + 3.8}" text-anchor="middle" class="schematic-pill-text">${esc(d.lbl)}</text>`;
    }
  }

  // Inner label for the solid-pink excised ID pill (never overflows!)
  const shortName = idRec.ipr_s || 'ID';
  const maxChars = Math.floor((idW - 12) / 6.8);
  let idInner = '';
  if (maxChars >= shortName.length) idInner = shortName;
  else if (maxChars >= 5) idInner = shortName.slice(0, maxChars - 1) + '…';
  else if (idW >= 26) idInner = 'ID';

  // Top lane callout (y = 19): strictly clamped within [padL, width - padR]
  const callout = `ID · ${st}–${en} (${idRec.len} aa)`;
  const calloutHalfW = (callout.length * 6.4) / 2;
  const calloutX = Math.max(padL + calloutHalfW, Math.min(width - padR - calloutHalfW, idMid));

  // Build crisp exact-coordinate legend below SVG (sorted by true residue start)
  const legendItems = [
    ...domItems.map((d) => ({
      label: d.lbl,
      start: d.ds,
      end: d.de,
      color: fillFor(d.lbl, d.isOther),
      isId: false,
      isOther: d.isOther,
    })),
    {
      label: `ID (${shortName})`,
      start: st,
      end: en,
      color: '#f72585',
      isId: true,
      isOther: false,
    },
  ].sort((a, b) => a.start - b.start || (a.isId ? 1 : -1));

  const legendHtml = `
    <div class="schematic-legend" aria-label="NLRtracker domain residue coordinates">
      ${legendItems
        .map(
          (item) =>
            `<span class="sch-item${item.isId ? ' sch-id' : ''}"><span class="dot" style="background:${item.color}"></span><b>${esc(item.label)}</b> <span class="mono">${item.start}–${item.end}</span></span>`
        )
        .join('')}
    </div>
  `;

  return `
    <svg viewBox="0 0 ${width} ${height}" class="chart-svg schematic-svg" role="img" aria-label="Parent NLR architecture from NLRtracker highlighting excised integrated domain at residues ${st} to ${en} of ${plen}">
      <!-- Primary NLR backbone connector -->
      <line x1="${padL}" y1="${cyMain}" x2="${padL + trackW}" y2="${cyMain}" class="schematic-backbone"/>
      ${
        hasDeepOverlap
          ? `<line x1="${padL}" y1="${cyId}" x2="${padL + trackW}" y2="${cyId}" class="schematic-backbone" stroke-dasharray="3 4" stroke-opacity="0.55"/>`
          : ''
      }

      <!-- Callout connector (tucked behind primary track on dual-lane layouts) -->
      ${
        hasDeepOverlap
          ? `<line x1="${idMid.toFixed(1)}" y1="24" x2="${idMid.toFixed(1)}" y2="${pillYId - 3}" stroke="#f72585" stroke-width="1.2" stroke-dasharray="2.5 2.5" stroke-opacity="0.7"/>`
          : `<line x1="${idMid.toFixed(1)}" y1="24" x2="${idMid.toFixed(1)}" y2="${pillYId - 3}" stroke="#f72585" stroke-width="1.2" stroke-opacity="0.65"/>`
      }

      <!-- Exact NLRtracker domains -->
      ${domsSvg}

      <!-- Excised ID (Bifrost pink) at exact coordinates -->
      <rect x="${idX1.toFixed(1)}" y="${pillYId - 1}" width="${idW.toFixed(1)}" height="${pillH + 2}" rx="7" fill="#f72585">
        <title>${esc(idRec.ipr_n || shortName)} (${esc(idRec.ipr)}) · excised ID ${st}–${en} (${idRec.len} aa)</title>
      </rect>
      ${idInner ? `<text x="${idMid.toFixed(1)}" y="${cyId + 3.8}" text-anchor="middle" class="schematic-pill-text">${esc(idInner)}</text>` : ''}

      <!-- Non-overlapping top callout -->
      <text x="${calloutX.toFixed(1)}" y="19" text-anchor="middle" class="schematic-callout" fill="#f72585">${esc(callout)}</text>

      <!-- Minimal bottom scale endpoints -->
      <text x="${padL}" y="${scaleY}" text-anchor="start" class="chart-tick">1</text>
      <text x="${padL + trackW}" y="${scaleY}" text-anchor="end" class="chart-tick">${plen.toLocaleString()} aa</text>
    </svg>
    ${legendHtml}
  `;
}

/**
 * Clean horizontal bar chart.
 */
export function renderHorizontalBarsHtml(items, { valueFormatter = (v) => v.toLocaleString() } = {}) {
  const maxVal = Math.max(1, ...items.map((x) => x.value));
  return `<div class="hbar-list">${items
    .map((item) => {
      const pct = Math.max(2, (item.value / maxVal) * 100);
      const tag = item.href ? 'a' : 'div';
      const hrefAttr = item.href ? ` href="${esc(item.href)}"` : '';
      return `
        <${tag} class="hbar-row${item.href ? ' hbar-link' : ''}"${hrefAttr}>
          <div class="hbar-meta">
            <span class="hbar-label" title="${esc(item.label)}">${esc(item.label)}</span>
            <span class="hbar-val">${esc(valueFormatter(item.value))}${item.sub ? ` <span class="muted">${esc(item.sub)}</span>` : ''}</span>
          </div>
          <div class="hbar-track">
            <div class="hbar-fill" style="width:${pct.toFixed(1)}%;background:${item.color || '#4361ee'}"></div>
          </div>
        </${tag}>
      `;
    })
    .join('')}</div>`;
}
