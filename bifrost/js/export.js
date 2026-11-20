/**
 * Export & CLI Command Helpers (CSV/TSV, FASTA, Clipboard, Dataverse extraction)
 */

export function formatFasta(header, seq, width = 80) {
  const clean = (seq || '').replace(/\s+/g, '');
  const lines = [`>${header}`];
  for (let i = 0; i < clean.length; i += width) {
    lines.push(clean.slice(i, i + width));
  }
  return lines.join('\n') + '\n';
}

export function triggerDownload(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyToClipboard(text, btnEl) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  if (btnEl) {
    const prev = btnEl.dataset.prevLabel || btnEl.textContent;
    btnEl.dataset.prevLabel = prev;
    btnEl.textContent = 'Copied';
    btnEl.classList.add('copied');
    clearTimeout(btnEl._copyTimer);
    btnEl._copyTimer = setTimeout(() => {
      btnEl.textContent = prev;
      btnEl.classList.remove('copied');
    }, 1500);
  }
}

function escapeCsvCell(val, sep) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (sep === ',' && (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r'))) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  if (sep === '\t') {
    return str.replace(/[\t\r\n]+/g, ' ');
  }
  return str;
}

export function exportDelimited(filename, headers, rows, sep = '\t') {
  const lines = [headers.map((h) => escapeCsvCell(h, sep)).join(sep)];
  for (const row of rows) {
    lines.push(row.map((v) => escapeCsvCell(v, sep)).join(sep));
  }
  const mime = sep === ',' ? 'text/csv;charset=utf-8' : 'text/tab-separated-values;charset=utf-8';
  triggerDownload(filename, lines.join('\n') + '\n', mime);
}

export function exportPairsTable(filename, pairs, meta, sep = '\t') {
  const headers = [
    'dataset',
    'job_num',
    'status',
    'id_panel',
    'id_name',
    'plant_species',
    'plant_order',
    'interpro_id',
    'interpro_category',
    'nlr_class',
    'pathogen_panel',
    'pathogen_protein',
    'organism_type',
    'pathogen_species',
    'protein_class',
    'ipSAE_min',
    'ipSAE_max',
    'ipSAE_mean',
    'ipSAE_asym_A',
    'ipSAE_asym_B',
    'ipSAE_d0dom_min',
    'ipSAE_d0dom_max',
    'ipSAE_d0chn_min',
    'ipSAE_d0chn_max',
    'ipTM_af',
    'ipTM_d0chn_min',
    'pDockQ',
    'pDockQ2_min',
    'pDockQ2_max',
    'LIS_min',
    'LIS_mean',
    'contacts_total',
    'dist1_ID',
    'dist2_Pathogen',
    'nres1_ID',
    'nres2_Pathogen',
    'dataverse_doi',
  ];
  const statusMap = { 0: 'scored', 1: 'ipsae_failed', 2: 'missing_scores' };
  const rows = pairs.map((p) => {
    const ds = meta.datasets[p.setIdx];
    const idR = meta.ids[p.id_idx];
    const paR = meta.pathogens[p.path_idx];
    const ok = p.status === 0;
    const f = (v) => (ok ? v.toFixed(4) : '');
    const n = (v) => (ok ? String(v) : '');
    return [
      ds.id,
      p.job_num,
      statusMap[p.status] || 'unknown',
      idR.s,
      idR.id,
      idR.sp,
      idR.ord,
      idR.ipr,
      idR.cat,
      idR.cls,
      paR.s,
      paR.id,
      paR.org,
      paR.sp,
      paR.cls,
      f(p.ipsae_min),
      f(p.ipsae_max),
      f(p.ipsae_mean),
      f(p.ipsae_a),
      f(p.ipsae_b),
      f(p.d0dom_min),
      f(p.d0dom_max),
      f(p.d0chn_min),
      f(p.d0chn_max),
      f(p.iptm),
      f(p.iptm_d0chn),
      f(p.pdockq),
      f(p.pdockq2_min),
      f(p.pdockq2_max),
      f(p.lis_min),
      f(p.lis_mean),
      n(p.contacts),
      n(p.dist1),
      n(p.dist2),
      n(p.nres1),
      n(p.nres2),
      ds.doi,
    ];
  });
  exportDelimited(filename, headers, rows, sep);
}

export function buildExtractCommand(info) {
  return `# 1. Download ${info.dataset} archive parts from ${info.doi}
# 2. Extract only this top-ranked AF3 model (requires zstd + GNU tar; macOS: gtar):
cat ${info.dataset}.tar.zst.* | zstd -dc --long=31 | tar -xvf - --occurrence \\
  '${info.memberTar}'
tar -xzf '${info.memberTar}' -C '${info.dataset}/'
# Top-ranked structure: ${info.dataset}/${info.modelCif}`;
}

export function buildReproduceCommand(info) {
  return `# Rebuild exact AF3 input with multiple independent seeds (requires ${info.inferenceDoi}):
python3 make_af3_inputs.py \\
  --chain-a ${info.idPanel}_inference_input \\
  --chain-b ${info.pathPanel}_inference_input \\
  --a '${info.chainA}' \\
  --b '${info.chainB}' \\
  --seeds 1 2 3 4 5 --out inputs/`;
}
