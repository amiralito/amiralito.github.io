/**
 * Bifrost Wiki Data Layer
 *
 * Handles gzip-compressed JSON and columnar binary TypedArray score bundles
 * with magic-byte detection so files work seamlessly on both GitHub Pages
 * (serves raw .gz bytes) and servers that transparently decompress gzip.
 */

export const SCORE_SCALE = 10000;

export const STATUS = {
  SCORED: 0,
  FAILED: 1,
  MISSING: 2,
};

export const STATUS_LABELS = {
  0: 'Scored',
  1: 'ipSAE failed',
  2: 'Missing scores',
};

export const SCORE_COLUMNS = [
  'ipsae_min',
  'ipsae_max',
  'ipsae_a',
  'ipsae_b',
  'd0dom_min',
  'd0dom_max',
  'd0chn_min',
  'd0chn_max',
  'iptm',
  'iptm_d0chn',
  'pdockq',
  'pdockq2_min',
  'pdockq2_max',
  'lis_min',
  'lis_mean',
  'dist1',
  'dist2',
  'nres1',
  'nres2',
];

const BFR1_MAGIC = 0x31524642; // "BFR1" little-endian

/**
 * Fetch a possibly gzipped binary asset and return raw decompressed ArrayBuffer.
 */
async function fetchDecompressedBuffer(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url} (HTTP ${resp.status})`);
  }
  const rawBuf = await resp.arrayBuffer();
  const head = new Uint8Array(rawBuf, 0, Math.min(2, rawBuf.byteLength));
  // Detect gzip magic bytes (0x1f 0x8b). If already decompressed by host/proxy, return as-is.
  if (head.length === 2 && head[0] === 0x1f && head[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error(
        'This browser does not support DecompressionStream("gzip"). Please use a modern Chrome, Firefox, Safari, or Edge browser.'
      );
    }
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([rawBuf]).stream().pipeThrough(ds);
    return await new Response(stream).arrayBuffer();
  }
  return rawBuf;
}

async function fetchGzJson(url) {
  const buf = await fetchDecompressedBuffer(url);
  const text = new TextDecoder('utf-8').decode(buf);
  return JSON.parse(text);
}

/**
 * Decode a BFR1 columnar binary buffer into zero-copy TypedArray views.
 */
function parseSetBinary(buf) {
  const header = new Uint32Array(buf, 0, 4);
  if (header[0] !== BFR1_MAGIC) {
    throw new Error(`Invalid Bifrost binary header: 0x${header[0].toString(16)}`);
  }
  const setIdx = header[1];
  const n = header[2];
  const schemaVer = header[3];
  if (schemaVer !== 1) {
    throw new Error(`Unsupported binary schema version: ${schemaVer}`);
  }

  let offset = 16;
  const job_num = new Uint32Array(buf, offset, n);
  offset += n * 4;

  const id_idx = new Uint16Array(buf, offset, n);
  offset += n * 2;

  const path_idx = new Uint16Array(buf, offset, n);
  offset += n * 2;

  const cols = {};
  for (const name of SCORE_COLUMNS) {
    cols[name] = new Uint16Array(buf, offset, n);
    offset += n * 2;
  }

  const status = new Uint8Array(buf, offset, n);

  return {
    setIdx,
    n,
    job_num,
    id_idx,
    path_idx,
    status,
    ...cols,
    // Lazy lookup maps built on first per-protein query
    _byId: null,
    _byPath: null,
    _byJob: null,
  };
}

class BifrostStore {
  constructor() {
    this.meta = null;
    this.metaPromise = null;

    this.topHits = null;
    this.topHitsPromise = null;

    this.parentNlrs = null;
    this.parentNlrsPromise = null;

    this.sets = new Map(); // setIdx -> parsed binary object
    this.setPromises = new Map(); // setIdx -> Promise

    // Lookups derived from meta
    this.idByName = new Map();
    this.pathByName = new Map();
    this.datasetByName = new Map();
    this.setsByIdPanel = new Map(); // 'ID1' -> [0,1,2,3,4]
    this.setsByPathPanel = new Map(); // 'E1' -> [0,5,9]
    this.idsByInterpro = new Map(); // 'IPR006121' -> [idRec, ...]
    this.idsByCategory = new Map(); // category -> [idRec, ...]
  }

  async loadMeta() {
    if (this.meta) return this.meta;
    if (!this.metaPromise) {
      this.metaPromise = fetchGzJson('./data/meta.json.gz').then((meta) => {
        this.meta = meta;
        this._buildMetaIndexes();
        return meta;
      });
    }
    return this.metaPromise;
  }

  _buildMetaIndexes() {
    const { ids, pathogens, datasets } = this.meta;
    this.idByName.clear();
    this.pathByName.clear();
    this.datasetByName.clear();
    this.setsByIdPanel.clear();
    this.setsByPathPanel.clear();
    this.idsByInterpro.clear();
    this.idsByCategory.clear();

    for (const rec of ids) {
      this.idByName.set(rec.id, rec);
      // Precompute lowercase search string
      rec._q = `${rec.id} ${rec.sp} ${rec.fam} ${rec.ord} ${rec.ipr} ${rec.iprs} ${rec.ipr_s} ${rec.ipr_n} ${rec.cat} ${rec.arch} ${rec.cls} ${rec.acc} ${rec.s}`.toLowerCase();

      if (rec.cat) {
        if (!this.idsByCategory.has(rec.cat)) this.idsByCategory.set(rec.cat, []);
        this.idsByCategory.get(rec.cat).push(rec);
      }
      const iprList = (rec.iprs || rec.ipr || '')
        .split(';')
        .map((x) => x.trim())
        .filter(Boolean);
      for (const ipr of new Set(iprList)) {
        if (!this.idsByInterpro.has(ipr)) this.idsByInterpro.set(ipr, []);
        this.idsByInterpro.get(ipr).push(rec);
      }
    }

    for (const rec of pathogens) {
      this.pathByName.set(rec.id, rec);
      rec._q = `${rec.id} ${rec.sp} ${rec.org} ${rec.fam} ${rec.ord} ${rec.cls} ${rec.acc} ${rec.src} ${rec.s}`.toLowerCase();
    }

    for (const ds of datasets) {
      this.datasetByName.set(ds.id, ds);
      if (!this.setsByIdPanel.has(ds.id_panel)) this.setsByIdPanel.set(ds.id_panel, []);
      this.setsByIdPanel.get(ds.id_panel).push(ds.idx);

      if (!this.setsByPathPanel.has(ds.path_panel)) this.setsByPathPanel.set(ds.path_panel, []);
      this.setsByPathPanel.get(ds.path_panel).push(ds.idx);
    }
  }

  async loadTopHits() {
    if (this.topHits) return this.topHits;
    if (!this.topHitsPromise) {
      this.topHitsPromise = fetchGzJson('./data/top_hits.json.gz').then((data) => {
        this.topHits = data;
        return data;
      });
    }
    return this.topHitsPromise;
  }

  async loadParentNlrs() {
    if (this.parentNlrs) return this.parentNlrs;
    if (!this.parentNlrsPromise) {
      this.parentNlrsPromise = fetchGzJson('./data/parent_nlrs.json.gz').then((arr) => {
        this.parentNlrs = arr;
        return arr;
      });
    }
    return this.parentNlrsPromise;
  }

  async loadSet(setIdx) {
    if (this.sets.has(setIdx)) return this.sets.get(setIdx);
    if (!this.setPromises.has(setIdx)) {
      const ds = this.meta.datasets[setIdx];
      const p = fetchDecompressedBuffer(`./data/scores/${ds.id}.bin.gz`)
        .then((buf) => {
          const parsed = parseSetBinary(buf);
          this.sets.set(setIdx, parsed);
          return parsed;
        })
        .catch((err) => {
          this.setPromises.delete(setIdx);
          throw err;
        });
      this.setPromises.set(setIdx, p);
    }
    return this.setPromises.get(setIdx);
  }

  async loadSets(setIndices, onProgress) {
    const unique = [...new Set(setIndices)];
    let done = 0;
    const total = unique.length;
    const results = new Array(total);
    // Load in batches of 4 for smooth parallel HTTP/2 streaming
    const concurrency = 4;
    let cursor = 0;

    async function worker(self) {
      while (cursor < total) {
        const idx = cursor++;
        const sIdx = unique[idx];
        results[idx] = await self.loadSet(sIdx);
        done++;
        if (onProgress) onProgress(done, total, self.meta.datasets[sIdx]);
      }
    }

    const workers = [];
    for (let w = 0; w < Math.min(concurrency, total); w++) {
      workers.push(worker(this));
    }
    await Promise.all(workers);
    return results;
  }

  async loadAllSets(onProgress) {
    const allIndices = this.meta.datasets.map((d) => d.idx);
    return this.loadSets(allIndices, onProgress);
  }

  areAllSetsLoaded() {
    return this.meta && this.sets.size === this.meta.datasets.length;
  }

  /**
   * Extract a single pair object from a loaded set at row index `r`.
   */
  rowToObject(setBin, r) {
    const a = setBin.ipsae_a[r];
    const b = setBin.ipsae_b[r];
    const d1 = setBin.dist1[r];
    const d2 = setBin.dist2[r];
    return {
      setIdx: setBin.setIdx,
      job_num: setBin.job_num[r],
      id_idx: setBin.id_idx[r],
      path_idx: setBin.path_idx[r],
      status: setBin.status[r],
      ipsae_min: setBin.ipsae_min[r] / SCORE_SCALE,
      ipsae_max: setBin.ipsae_max[r] / SCORE_SCALE,
      ipsae_mean: (a + b) / (2 * SCORE_SCALE),
      ipsae_a: a / SCORE_SCALE,
      ipsae_b: b / SCORE_SCALE,
      d0dom_min: setBin.d0dom_min[r] / SCORE_SCALE,
      d0dom_max: setBin.d0dom_max[r] / SCORE_SCALE,
      d0chn_min: setBin.d0chn_min[r] / SCORE_SCALE,
      d0chn_max: setBin.d0chn_max[r] / SCORE_SCALE,
      iptm: setBin.iptm[r] / SCORE_SCALE,
      iptm_d0chn: setBin.iptm_d0chn[r] / SCORE_SCALE,
      pdockq: setBin.pdockq[r] / SCORE_SCALE,
      pdockq2_min: setBin.pdockq2_min[r] / SCORE_SCALE,
      pdockq2_max: setBin.pdockq2_max[r] / SCORE_SCALE,
      lis_min: setBin.lis_min[r] / SCORE_SCALE,
      lis_mean: setBin.lis_mean[r] / SCORE_SCALE,
      dist1: d1,
      dist2: d2,
      contacts: d1 + d2,
      nres1: setBin.nres1[r],
      nres2: setBin.nres2[r],
    };
  }

  /**
   * Convert a compact row from top_hits.json.gz to the same pair object shape.
   */
  topHitRowToObject(arr) {
    const a = arr[6];
    const b = arr[7];
    const d1 = arr[19];
    const d2 = arr[20];
    return {
      setIdx: arr[0],
      job_num: arr[1],
      id_idx: arr[2],
      path_idx: arr[3],
      status: 0,
      ipsae_min: arr[4] / SCORE_SCALE,
      ipsae_max: arr[5] / SCORE_SCALE,
      ipsae_mean: (a + b) / (2 * SCORE_SCALE),
      ipsae_a: a / SCORE_SCALE,
      ipsae_b: b / SCORE_SCALE,
      d0dom_min: arr[8] / SCORE_SCALE,
      d0dom_max: arr[9] / SCORE_SCALE,
      d0chn_min: arr[10] / SCORE_SCALE,
      d0chn_max: arr[11] / SCORE_SCALE,
      iptm: arr[12] / SCORE_SCALE,
      iptm_d0chn: arr[13] / SCORE_SCALE,
      pdockq: arr[14] / SCORE_SCALE,
      pdockq2_min: arr[15] / SCORE_SCALE,
      pdockq2_max: arr[16] / SCORE_SCALE,
      lis_min: arr[17] / SCORE_SCALE,
      lis_mean: arr[18] / SCORE_SCALE,
      dist1: d1,
      dist2: d2,
      contacts: d1 + d2,
      nres1: arr[21],
      nres2: arr[22],
    };
  }

  /**
   * Get all pairs involving a given NLR ID (loads only its panel's screening sets).
   */
  async getPairsForId(idRec, onProgress) {
    if (!idRec.scr) return [];
    const setIndices = this.setsByIdPanel.get(idRec.s) || [];
    const loaded = await this.loadSets(setIndices, onProgress);
    const out = [];
    const target = idRec.i;
    for (const sBin of loaded) {
      if (!sBin._byId) {
        const m = new Map();
        const arr = sBin.id_idx;
        for (let r = 0; r < sBin.n; r++) {
          const key = arr[r];
          let list = m.get(key);
          if (!list) {
            list = [];
            m.set(key, list);
          }
          list.push(r);
        }
        sBin._byId = m;
      }
      const rows = sBin._byId.get(target);
      if (rows) {
        for (const r of rows) {
          out.push(this.rowToObject(sBin, r));
        }
      }
    }
    return out;
  }

  /**
   * Get all pairs involving a given Pathogen protein (loads only its panel's screening sets).
   */
  async getPairsForPathogen(pathRec, onProgress) {
    const setIndices = this.setsByPathPanel.get(pathRec.s) || [];
    const loaded = await this.loadSets(setIndices, onProgress);
    const out = [];
    const target = pathRec.i;
    for (const sBin of loaded) {
      if (!sBin._byPath) {
        const m = new Map();
        const arr = sBin.path_idx;
        for (let r = 0; r < sBin.n; r++) {
          const key = arr[r];
          let list = m.get(key);
          if (!list) {
            list = [];
            m.set(key, list);
          }
          list.push(r);
        }
        sBin._byPath = m;
      }
      const rows = sBin._byPath.get(target);
      if (rows) {
        for (const r of rows) {
          out.push(this.rowToObject(sBin, r));
        }
      }
    }
    return out;
  }

  /**
   * Find a specific pair by dataset name and job number.
   */
  async getPairByJob(datasetName, jobNum) {
    const ds = this.datasetByName.get(datasetName);
    if (!ds) return null;
    const sBin = await this.loadSet(ds.idx);
    if (!sBin._byJob) {
      const m = new Map();
      const jobs = sBin.job_num;
      for (let r = 0; r < sBin.n; r++) {
        m.set(jobs[r], r);
      }
      sBin._byJob = m;
    }
    const r = sBin._byJob.get(Number(jobNum));
    if (r === undefined) return null;
    return this.rowToObject(sBin, r);
  }

  /**
   * Reconstruct exact Dataverse archive job name & path for any pair.
   */
  getJobArchiveInfo(pair) {
    const ds = this.meta.datasets[pair.setIdx];
    const idRec = this.meta.ids[pair.id_idx];
    const pathRec = this.meta.pathogens[pair.path_idx];
    const outputName = `job_${pair.job_num}_${idRec.af3}_${pathRec.af3}`;
    const jobSeed = `${outputName}_seed1`;
    return {
      dataset: ds.id,
      doi: ds.doi,
      inferenceDoi: this.meta.inference_input.doi,
      outputName,
      jobSeed,
      memberTar: `${ds.id}/${jobSeed}.tar.gz`,
      modelCif: `${jobSeed}/${jobSeed}_model.cif`,
      ipsaeTxt: `${ds.id}/ipsae_scores/${jobSeed}_model_10_10.txt`,
      chainA: idRec.af3,
      chainB: pathRec.af3,
      idPanel: ds.id_panel,
      pathPanel: ds.path_panel,
    };
  }
}

export const store = new BifrostStore();
