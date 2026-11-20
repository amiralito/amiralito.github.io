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

function lerpHex(a, b, t) {
  const u = Math.max(0, Math.min(1, t));
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * u);
  const g = Math.round(((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * u);
  const bl = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * u);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

/**
 * Smooth continuous Bifrost gradient across [0, 1] without discrete cutoff steps.
 */
export function scoreColor(v) {
  const x = Math.max(0, Math.min(1, Number(v) || 0));
  const stops = [
    [0.0, '#94a3b8'],
    [0.25, '#4895ef'],
    [0.5, '#7209b7'],
    [0.75, '#b5179e'],
    [1.0, '#f72585'],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [x0, c0] = stops[i];
    const [x1, c1] = stops[i + 1];
    if (x <= x1) return lerpHex(c0, c1, (x - x0) / (x1 - x0));
  }
  return '#f72585';
}

function barGradientColor(v) {
  const x = Math.max(0, Math.min(1, Number(v) || 0));
  const stops = [
    [0.0, '#4895ef'],
    [0.33, '#4361ee'],
    [0.66, '#7209b7'],
    [1.0, '#f72585'],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [x0, c0] = stops[i];
    const [x1, c1] = stops[i + 1];
    if (x <= x1) return lerpHex(c0, c1, (x - x0) / (x1 - x0));
  }
  return '#f72585';
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
    ? [1, 10, 100, 1000, 10000, 100000].filter((t) => t <= maxVal)
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

  const totalsByOrg = {};
  for (const org of orgs) {
    totalsByOrg[org] = (seriesMap[org] || []).reduce((a, b) => a + b, 0);
  }

  let hoverSvg = `<rect class="chart-hover-band" x="0" y="${pad.top}" width="0" height="${plotH}" rx="2" opacity="0" pointer-events="none"/>`;
  const binW = plotW / nBins;
  for (let i = 0; i < nBins; i++) {
    const lo = (i * 0.05).toFixed(2);
    const hi = ((i + 1) * 0.05).toFixed(2);
    const totalBin = orgs.reduce((acc, o) => acc + (seriesMap[o]?.[i] || 0), 0);
    const tipObj = {
      title: `${metricLabel} ${lo}–${hi}`,
      rows: [
        ...orgs.map((o) => {
          const c = seriesMap[o]?.[i] || 0;
          const pct = totalsByOrg[o] ? ((c / totalsByOrg[o]) * 100).toFixed(2) : '0.00';
          return { label: o, value: `${c.toLocaleString()} (${pct}%)`, color: ORG_COLORS[o] };
        }),
        { label: 'Total in bin', value: totalBin.toLocaleString(), bold: true },
      ],
    };
    const bx = xMap(i).toFixed(1);
    const bw = binW.toFixed(1);
    hoverSvg += `<rect class="chart-hit" x="${bx}" y="${pad.top}" width="${bw}" height="${plotH}" fill="transparent" data-bx="${bx}" data-bw="${bw}" data-tip="${esc(JSON.stringify(tipObj))}"></rect>`;
  }

  return `
    <svg viewBox="0 0 ${width} ${height}" class="chart-svg interactive-svg" role="img" aria-label="${esc(metricLabel)} distribution by organism type">
      ${gridSvg}
      <line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}" y2="${pad.top + plotH}" class="chart-axis"/>
      <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}" class="chart-axis"/>
      ${linesSvg}
      ${xTicksSvg}
      ${hoverSvg}
      <text x="${pad.left + plotW / 2}" y="${height - 5}" text-anchor="middle" class="chart-axis-title">${esc(metricLabel)}</text>
      <text x="15" y="${pad.top + plotH / 2}" text-anchor="middle" transform="rotate(-90 15 ${pad.top + plotH / 2})" class="chart-axis-title">${logScale ? 'Pairs (log₁₀)' : 'Pairs'}</text>
    </svg>
  `;
}

/**
 * Single-series histogram bar chart with smooth continuous Bifrost coloring.
 */
export function renderSimpleHistogramSvg(values, {
  metricLabel = 'ipSAE (min)',
  nBins = 20,
  logScale = true,
  width = 560,
  height = 180,
} = {}) {
  const counts = new Uint32Array(nBins);
  let maxC = 1;
  for (let i = 0; i < values.length; i++) {
    const b = Math.min(nBins - 1, Math.max(0, Math.floor(values[i] * nBins)));
    counts[b]++;
    if (counts[b] > maxC) maxC = counts[b];
  }

  const pad = { top: 14, right: 16, bottom: 38, left: 54 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const useLog = logScale && maxC > 25;
  const yMap = (c) => {
    if (c === 0) return pad.top + plotH;
    if (useLog) return pad.top + plotH * (1 - Math.log10(c + 1) / Math.log10(maxC + 1));
    return pad.top + plotH * (1 - c / maxC);
  };

  const yTicks = useLog
    ? [1, 10, 100, 1000, 10000, 100000].filter((t) => t <= maxC)
    : [0, Math.round(maxC / 2), maxC].filter((v, idx, a) => a.indexOf(v) === idx);

  let gridSvg = '';
  for (const t of yTicks) {
    const y = yMap(t);
    const label = t >= 1000 ? `${(t / 1000).toFixed(t >= 10000 ? 0 : 1)}k` : String(t);
    gridSvg += `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${pad.left + plotW}" y2="${y.toFixed(1)}" class="chart-grid"/>`;
    gridSvg += `<text x="${pad.left - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" class="chart-tick">${label}</text>`;
  }

  const totalVals = values.length;
  const binW = plotW / nBins;
  let barsSvg = '';
  let hitSvg = `<rect class="chart-hover-band" x="0" y="${pad.top}" width="0" height="${plotH}" rx="2" opacity="0" pointer-events="none"/>`;
  for (let i = 0; i < nBins; i++) {
    const c = counts[i];
    const lo = (i / nBins).toFixed(2);
    const hi = ((i + 1) / nBins).toFixed(2);
    const mid = (i + 0.5) / nBins;
    const fill = barGradientColor(mid);
    const bx = (pad.left + i * binW).toFixed(1);
    const bw = binW.toFixed(1);
    const pct = totalVals ? ((c / totalVals) * 100).toFixed(2) : '0.00';
    const tipObj = {
      title: `${metricLabel} ${lo}–${hi}`,
      rows: [
        { label: 'Pairs in bin', value: c.toLocaleString(), color: fill, bold: true },
        { label: 'Share of slice', value: `${pct}%` },
      ],
    };
    hitSvg += `<rect class="chart-hit" x="${bx}" y="${pad.top}" width="${bw}" height="${plotH}" fill="transparent" data-bx="${bx}" data-bw="${bw}" data-tip="${esc(JSON.stringify(tipObj))}"></rect>`;
    if (c === 0) continue;
    const x = pad.left + i * binW + 1.2;
    const y = yMap(c);
    const h = Math.max(2, pad.top + plotH - y);
    barsSvg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1.5, binW - 2.4).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${fill}" fill-opacity="0.88" pointer-events="none"/>`;
  }

  let xTicksSvg = '';
  for (let i = 0; i <= 10; i += 2) {
    const x = pad.left + (i / 10) * plotW;
    xTicksSvg += `<text x="${x.toFixed(1)}" y="${pad.top + plotH + 16}" text-anchor="middle" class="chart-tick">${(i / 10).toFixed(1)}</text>`;
  }

  return `
    <svg viewBox="0 0 ${width} ${height}" class="chart-svg interactive-svg" role="img" aria-label="${esc(metricLabel)} distribution">
      ${gridSvg}
      ${barsSvg}
      <line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}" y2="${pad.top + plotH}" class="chart-axis"/>
      <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}" class="chart-axis"/>
      ${xTicksSvg}
      ${hitSvg}
      <text x="${pad.left + plotW / 2}" y="${height - 4}" text-anchor="middle" class="chart-axis-title">${esc(metricLabel)}${useLog ? ' (log₁₀ count)' : ''}</text>
    </svg>
  `;
}

/**
 * Minimal, Solid-Filled Parent NLR Domain Architecture Schematic
 *
 * Uses exact NLRtracker domain residue boundaries (`idRec.nd`) plotted to scale
 * along 1..parent_length, highlights the current excised ID in solid Bifrost
 * pink, and displays any sibling Bifrost IDs on the same parent NLR as
 * clickable lower-opacity hyperlinks.
 */
export function renderNlrSchematicSvg(idRec, { width = 760, siblings = [] } = {}) {
  const plen = Math.max(1, idRec.plen || idRec.len || 100);
  const st = Math.max(1, idRec.st || 1);
  const en = Math.min(plen, idRec.en || idRec.len || plen);

  const padL = 18;
  const padR = 18;
  const trackW = width - padL - padR;
  const pillH = 26;
  const xPos = (aa) => padL + ((aa - 1) / Math.max(1, plen - 1)) * trackW;

  const fillFor = (tok, isOther = false) => {
    if (isOther) return '#949eb3';
    const u = tok.toUpperCase();
    if (u === 'TIR' || u === 'SD' || u === 'R1') return '#0e93bd';
    if (u === 'CC') return '#4361ee';
    if (u === 'RPW8') return '#2a9d8f';
    if (u === 'NB-ARC' || u === 'NBARC') return '#3f37c9';
    if (u === 'LRR') return '#7209b7';
    return '#64748b';
  };

  // True residue positions for the current excised ID pill
  const rawIdX1 = xPos(st);
  const rawIdX2 = xPos(en);
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

  // Prepare sibling Bifrost IDs (other excised IDs on the same parent NLR)
  const sibItems = (siblings || [])
    .slice()
    .sort((a, b) => a.st - b.st)
    .map((sib) => {
      const s = Math.max(1, sib.st || 1);
      const e = Math.min(plen, sib.en || plen);
      let x1 = xPos(s);
      let x2 = xPos(e);
      if (x2 - x1 < 18) {
        const mid = (x1 + x2) / 2;
        x1 = Math.max(padL, Math.min(padL + trackW - 18, mid - 9));
        x2 = x1 + 18;
      }
      return { sib, s, e, x1, x2, label: sib.ipr_s || sib.ipr || 'ID' };
    });

  // Filter out generic NLRtracker other-DOMAIN blocks (kind===1) that correspond to a sibling Bifrost ID
  const nlrtRaw = Array.isArray(idRec.nd) && idRec.nd.length ? idRec.nd : [];
  const nlrt = nlrtRaw.filter(([, ds, de, kind]) => {
    if (kind !== 1) return true;
    const dLen = Math.max(1, de - ds + 1);
    return !sibItems.some((sb) => {
      const ov = Math.max(0, Math.min(de, sb.e) - Math.max(ds, sb.s) + 1);
      return ov / Math.min(dLen, Math.max(1, sb.e - sb.s + 1)) >= 0.30;
    });
  });

  // Determine whether the current excised ID or any sibling ID deeply overlaps (>15 aa) a canonical NLRtracker region
  let hasDeepOverlap = false;
  for (const [, ds, de] of nlrt) {
    if (Math.min(de, en) - Math.max(ds, st) + 1 > 15) {
      hasDeepOverlap = true;
      break;
    }
  }
  const sibDeepOverlap = new Set();
  for (let i = 0; i < sibItems.length; i++) {
    const sb = sibItems[i];
    for (const [, ds, de] of nlrt) {
      if (Math.min(de, sb.e) - Math.max(ds, sb.s) + 1 > 15) {
        sibDeepOverlap.add(i);
        break;
      }
    }
  }
  const useDualLane = hasDeepOverlap || sibDeepOverlap.size > 0;

  const cyMain = 48;
  const pillYMain = cyMain - pillH / 2;
  const cyId = useDualLane ? 84 : cyMain;
  const pillYId = cyId - pillH / 2;
  const scaleY = useDualLane ? 116 : 84;
  const height = useDualLane ? 128 : 98;

  // Build unified primary-track visual items (canonical NLRtracker domains + single-track sibling IDs)
  const domItems = nlrt.map(([lbl, ds, de, kind]) => ({
    kind: 'dom',
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

  // Resolve minor junction touches on the primary track with current ID (when not deeply overlapping) and sibling IDs
  const idGap = 3.0;
  if (!hasDeepOverlap) {
    for (const d of domItems) {
      if (d.x1 < idX1 && d.x2 + idGap > idX1) d.x2 = Math.max(d.x1 + 4, idX1 - idGap);
      else if (d.x2 > idX2 && d.x1 - idGap < idX2) d.x1 = Math.min(d.x2 - 4, idX2 + idGap);
    }
  }
  sibItems.forEach((sb, idx) => {
    if (!sibDeepOverlap.has(idx)) {
      for (const d of domItems) {
        if (d.x1 < sb.x1 && d.x2 + idGap > sb.x1) d.x2 = Math.max(d.x1 + 4, sb.x1 - idGap);
        else if (d.x2 > sb.x2 && d.x1 - idGap < sb.x2) d.x1 = Math.min(d.x2 - 4, sb.x2 + idGap);
      }
    }
    // Keep sibling pill cleanly separated from current ID pill if on same lane
    const sibOnLower = sibDeepOverlap.has(idx);
    if (sibOnLower === hasDeepOverlap) {
      if (sb.x1 < idX1 && sb.x2 + idGap > idX1) sb.x2 = Math.max(sb.x1 + 6, idX1 - idGap);
      else if (sb.x2 > idX2 && sb.x1 - idGap < idX2) sb.x1 = Math.min(sb.x2 - 6, idX2 + idGap);
    }
  });
  // Keep adjacent sibling pills on the same lane cleanly separated
  for (let i = 0; i < sibItems.length - 1; i++) {
    const a = sibItems[i];
    const b = sibItems[i + 1];
    if (sibDeepOverlap.has(i) === sibDeepOverlap.has(i + 1) && a.x2 + minGap > b.x1) {
      const mid = (a.x2 + b.x1) / 2;
      a.x2 = Math.max(a.x1 + 6, mid - minGap / 2);
      b.x1 = Math.min(b.x2 - 6, mid + minGap / 2);
    }
  }

  // Render NLRtracker domain pills as 100% solid opaque objects with hover metadata
  let domsSvg = '';
  for (const d of domItems) {
    const w = Math.max(4, d.x2 - d.x1);
    const fill = fillFor(d.lbl, d.isOther);
    const fits = w >= d.lbl.length * 6.8 + 12;
    const tip = {
      title: d.lbl === 'SD' ? 'Solanaceae domain (SD / R1)' : `${d.lbl}${d.isOther ? ' (NLRtracker domain)' : ' domain'}`,
      rows: [
        { label: 'Coordinates', value: `${d.ds}–${d.de} aa`, color: fill },
        { label: 'Length', value: `${d.de - d.ds + 1} aa` },
      ],
    };
    const clsAttr = d.isOther ? 'chart-hit sch-other-rect' : 'chart-hit';
    const fillAttr = d.isOther ? '' : ` fill="${fill}"`;
    domsSvg += `<rect class="${clsAttr}" x="${d.x1.toFixed(1)}" y="${pillYMain}" width="${w.toFixed(1)}" height="${pillH}" rx="7"${fillAttr} data-tip="${esc(JSON.stringify(tip))}"></rect>`;
    if (fits) {
      domsSvg += `<text x="${(d.x1 + w / 2).toFixed(1)}" y="${cyMain + 3.8}" text-anchor="middle" class="schematic-pill-text" pointer-events="none">${esc(d.lbl)}</text>`;
    }
  }

  // Render sibling Bifrost IDs as solid opaque pastel-pink clickable hyperlinks (no hover info box)
  let sibsSvg = '';
  sibItems.forEach((sb, idx) => {
    const onLower = sibDeepOverlap.has(idx);
    const cyS = onLower ? cyId : cyMain;
    const pillYS = cyS - pillH / 2;
    const w = Math.max(6, sb.x2 - sb.x1);
    const maxC = Math.floor((w - 10) / 6.6);
    let inner = '';
    if (maxC >= sb.label.length) inner = sb.label;
    else if (maxC >= 5) inner = sb.label.slice(0, maxC - 1) + '…';
    else if (w >= 26) inner = 'ID';

    const href = `#/id/${encodeURIComponent(sb.sib.id)}`;
    sibsSvg += `
      <a href="${href}" class="sch-sib-link" aria-label="Open sibling integrated domain ${esc(sb.sib.id)}">
        <rect class="sch-sib-rect" x="${sb.x1.toFixed(1)}" y="${pillYS}" width="${w.toFixed(1)}" height="${pillH}" rx="7"></rect>
        ${inner ? `<text x="${(sb.x1 + w / 2).toFixed(1)}" y="${cyS + 3.8}" text-anchor="middle" class="schematic-sib-text" pointer-events="none">${esc(inner)}</text>` : ''}
      </a>`;
  });

  // Inner label for the current solid-pink excised ID pill (never overflows!)
  const shortName = idRec.ipr_s || 'ID';
  const maxChars = Math.floor((idW - 12) / 6.8);
  let idInner = '';
  if (maxChars >= shortName.length) idInner = shortName;
  else if (maxChars >= 5) idInner = shortName.slice(0, maxChars - 1) + '…';
  else if (idW >= 26) idInner = 'ID';

  const idTip = {
    title: `Excised ID: ${shortName} (${idRec.ipr})`,
    rows: [
      { label: 'Coordinates', value: `${st}–${en} aa (${idRec.len} aa)`, color: '#f72585', bold: true },
      { label: 'Description', value: idRec.ipr_n || shortName },
    ],
  };

  // Top lane callout (y = 19): strictly clamped within [padL, width - padR]
  const callout = `ID · ${st}–${en} (${idRec.len} aa)`;
  const calloutHalfW = (callout.length * 6.4) / 2;
  const calloutX = Math.max(padL + calloutHalfW, Math.min(width - padR - calloutHalfW, idMid));
  const curCy = hasDeepOverlap ? cyId : cyMain;
  const curPillY = hasDeepOverlap ? pillYId : pillYMain;

  // Build crisp exact-coordinate legend below SVG (sorted by true residue start)
  const legendItems = [
    ...domItems.map((d) => ({
      kind: 'dom',
      label: d.lbl,
      start: d.ds,
      end: d.de,
      color: fillFor(d.lbl, d.isOther),
    })),
    ...sibItems.map((sb) => ({
      kind: 'sib',
      label: `${sb.label} (${sb.sib.ipr})`,
      start: sb.s,
      end: sb.e,
      href: `#/id/${encodeURIComponent(sb.sib.id)}`,
      fullId: sb.sib.id,
    })),
    {
      kind: 'id',
      label: `ID (${shortName})`,
      start: st,
      end: en,
      color: '#f72585',
    },
  ].sort((a, b) => a.start - b.start || (a.kind === 'id' ? 1 : -1));

  const legendHtml = `
    <div class="schematic-legend" aria-label="NLRtracker domain residue coordinates">
      ${legendItems
        .map((item) => {
          if (item.kind === 'sib') {
            return `<a class="sch-item sch-sib" href="${item.href}" aria-label="Open sibling ID ${esc(item.fullId)}"><span class="dot dot-sib"></span><b>${esc(item.label)}</b> <span class="mono">${item.start}–${item.end}</span> <span aria-hidden="true">&#8599;</span></a>`;
          }
          return `<span class="sch-item${item.kind === 'id' ? ' sch-id' : ''}"><span class="dot" style="background:${item.color}"></span><b>${esc(item.label)}</b> <span class="mono">${item.start}–${item.end}</span></span>`;
        })
        .join('')}
    </div>
  `;

  const siblingBarHtml = sibItems.length
    ? `
      <div class="schematic-sib-bar">
        <span class="sib-bar-label">Other IDs on this parent NLR:</span>
        ${sibItems
          .map(
            (sb) =>
              `<a class="sib-chip" href="#/id/${encodeURIComponent(sb.sib.id)}" aria-label="Open sibling ID ${esc(sb.sib.id)}">
                <span class="dot dot-sib"></span>
                <span class="mono">${esc(sb.sib.id)}</span>
                <span class="sib-sub">${esc(sb.label)} · ${sb.s}–${sb.e}</span>
              </a>`
          )
          .join('')}
      </div>
    `
    : '';

  return `
    <svg viewBox="0 0 ${width} ${height}" class="chart-svg schematic-svg interactive-svg" role="img" aria-label="Parent NLR architecture from NLRtracker highlighting excised integrated domain at residues ${st} to ${en} of ${plen}">
      <!-- Primary NLR backbone connector -->
      <line x1="${padL}" y1="${cyMain}" x2="${padL + trackW}" y2="${cyMain}" class="schematic-backbone"/>
      ${
        useDualLane
          ? `<line x1="${padL}" y1="${cyId}" x2="${padL + trackW}" y2="${cyId}" class="schematic-backbone" stroke-dasharray="3 4" stroke-opacity="0.55"/>`
          : ''
      }

      <!-- Callout connector (tucked behind primary track on dual-lane layouts) -->
      ${
        hasDeepOverlap
          ? `<line x1="${idMid.toFixed(1)}" y1="24" x2="${idMid.toFixed(1)}" y2="${curPillY - 3}" stroke="#f72585" stroke-width="1.2" stroke-dasharray="2.5 2.5" stroke-opacity="0.7"/>`
          : `<line x1="${idMid.toFixed(1)}" y1="24" x2="${idMid.toFixed(1)}" y2="${curPillY - 3}" stroke="#f72585" stroke-width="1.2" stroke-opacity="0.65"/>`
      }

      <!-- Exact NLRtracker domains -->
      ${domsSvg}

      <!-- Sibling Bifrost IDs on the same parent NLR (lower transparency, clickable) -->
      ${sibsSvg}

      <!-- Current excised ID (solid Bifrost pink) at exact coordinates -->
      <rect class="chart-hit" x="${idX1.toFixed(1)}" y="${curPillY - 1}" width="${idW.toFixed(1)}" height="${pillH + 2}" rx="7" fill="#f72585" data-tip="${esc(JSON.stringify(idTip))}"></rect>
      ${idInner ? `<text x="${idMid.toFixed(1)}" y="${curCy + 3.8}" text-anchor="middle" class="schematic-pill-text" pointer-events="none">${esc(idInner)}</text>` : ''}

      <!-- Non-overlapping top callout -->
      <text x="${calloutX.toFixed(1)}" y="19" text-anchor="middle" class="schematic-callout" fill="#f72585">${esc(callout)}</text>

      <!-- Minimal bottom scale endpoints -->
      <text x="${padL}" y="${scaleY}" text-anchor="start" class="chart-tick">1</text>
      <text x="${padL + trackW}" y="${scaleY}" text-anchor="end" class="chart-tick">${plen.toLocaleString()} aa</text>
    </svg>
    ${legendHtml}
    ${siblingBarHtml}
  `;
}

/**
 * Attach crisp floating hover / tap tooltips and bin highlight bands to all
 * `.interactive-svg` charts & schematics inside `rootEl`.
 */
export function wireInteractiveCharts(rootEl) {
  if (!rootEl) return;
  rootEl.querySelectorAll('svg.interactive-svg').forEach((svg) => {
    if (svg.dataset.tipWired) return;
    svg.dataset.tipWired = '1';

    const host = svg.closest('.chart-box') || svg.parentElement;
    if (!host) return;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    let tip = host.querySelector(':scope > .chart-tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tooltip';
      tip.hidden = true;
      host.appendChild(tip);
    }

    const band = svg.querySelector('.chart-hover-band');

    const showTip = (el, clientX, clientY) => {
      const raw = el.getAttribute('data-tip');
      if (!raw) return;
      let data;
      try { data = JSON.parse(raw); } catch { return; }

      if (band && el.dataset.bx !== undefined) {
        band.setAttribute('x', el.dataset.bx);
        band.setAttribute('width', el.dataset.bw);
        band.setAttribute('opacity', '1');
      }

      const rowsHtml = (data.rows || [])
        .map(
          (r) =>
            `<div class="ct-row${r.bold ? ' ct-bold' : ''}">
              <span class="ct-k">${r.color ? `<span class="dot" style="background:${r.color}"></span>` : ''}${esc(r.label)}</span>
              <span class="ct-v">${esc(r.value)}</span>
            </div>`
        )
        .join('');
      tip.innerHTML = `<div class="ct-title">${esc(data.title || '')}</div>${rowsHtml}`;
      tip.hidden = false;

      const hostRect = host.getBoundingClientRect();
      const tipW = tip.offsetWidth || 190;
      const tipH = tip.offsetHeight || 80;
      let left = clientX - hostRect.left + 14;
      if (left + tipW > hostRect.width - 8) left = clientX - hostRect.left - tipW - 14;
      left = Math.max(8, Math.min(hostRect.width - tipW - 8, left));
      let top = clientY - hostRect.top - tipH - 12;
      if (top < 8) top = clientY - hostRect.top + 16;
      top = Math.max(8, Math.min(hostRect.height - tipH - 8, top));
      tip.style.left = `${left.toFixed(0)}px`;
      tip.style.top = `${top.toFixed(0)}px`;
    };

    const hideTip = () => {
      tip.hidden = true;
      if (band) band.setAttribute('opacity', '0');
    };

    svg.addEventListener('pointermove', (e) => {
      const hit = e.target.closest('.chart-hit[data-tip]');
      if (!hit) { hideTip(); return; }
      showTip(hit, e.clientX, e.clientY);
    });
    svg.addEventListener('pointerleave', hideTip);
    svg.addEventListener('click', (e) => {
      const hit = e.target.closest('.chart-hit[data-tip]');
      if (hit && !hit.closest('a')) showTip(hit, e.clientX, e.clientY);
    });
  });
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
