#!/usr/bin/env python3
"""Build static data bundle for the Bifrost Wiki & Score Explorer.

Reads harmonized metadata from paper/data/tables/ and deposit archives from
paper/deposit/ and writes compact, gzipped JSON + columnar binary files to
paper/wiki/data/. Uses Python 3 standard library only.
"""

from __future__ import annotations

import array
import csv
import glob
import gzip
import json
import math
import os
import struct
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # .../Bifrost
DEPOSIT_DIR = ROOT / "paper" / "deposit"
TABLES_DIR = ROOT / "paper" / "data" / "tables"
WIKI_DIR = ROOT / "paper" / "wiki"
OUT_DATA_DIR = WIKI_DIR / "data"
OUT_SCORES_DIR = OUT_DATA_DIR / "scores"

SCORE_SCALE = 10000
TOP_HIT_THRESHOLD = 0.25  # ipSAE_min >= 0.25 preloaded for instant explorer view

PANEL_INFO = {
    "ID1": {
        "name": "ID1 — RefSeq Plant NLRs",
        "short": "RefSeq",
        "chain": "A",
        "description": "NLR integrated domains from 180 NCBI RefSeq reference plant proteomes (134 species with retained IDs across 29 orders).",
        "source": "Toghani & Kamoun (2024)",
        "doi": "https://doi.org/10.5281/zenodo.13627395",
        "color": "#4cc9f0",
    },
    "ID2": {
        "name": "ID2 — Superasterid NLRs",
        "short": "Superasterids",
        "chain": "A",
        "description": "NLR integrated domains from 230 Helixer-annotated superasterid genome assemblies (190 species with retained IDs across 12 orders).",
        "source": "Toghani et al. (2025)",
        "doi": "https://doi.org/10.5061/dryad.sxksn03d6",
        "color": "#7209b7",
    },
    "ID3": {
        "name": "ID3 — Solanaceae NLRs",
        "short": "Solanaceae",
        "chain": "A",
        "description": "NLR integrated domains from 346 Helixer-annotated Solanaceae genome assemblies and haplotypes (54 species with retained IDs).",
        "source": "Toghani et al. (2026)",
        "doi": "https://doi.org/10.5281/zenodo.19855162",
        "color": "#f72585",
    },
    "E1": {
        "name": "E1 — Oomycete & Cyst Nematode Effectors",
        "short": "P. infestans & Globodera",
        "chain": "B",
        "description": "48 Phytophthora infestans RXLR effectors, 22 Globodera rostochiensis and 3 G. pallida SPRYSEC effectors.",
        "source": "Derevnina et al. (2021)",
        "doi": "https://doi.org/10.1371/journal.pbio.3001136",
        "color": "#f72585",
    },
    "E2": {
        "name": "E2 — Myzus persicae Effectors & Saliva",
        "short": "Myzus persicae",
        "chain": "B",
        "description": "154 Myzus persicae (green peach aphid) candidate effectors and salivary proteome proteins. Screened against ID1 only.",
        "source": "Bos et al. (2010); Liu et al. (2024)",
        "doi": "https://doi.org/10.1371/journal.pgen.1001216",
        "secondary_doi": "https://doi.org/10.5281/zenodo.13269257",
        "color": "#4361ee",
    },
    "E3": {
        "name": "E3 — Heterodera schachtii Effectors",
        "short": "H. schachtii",
        "chain": "B",
        "description": "15 Heterodera schachtii (beet cyst nematode) SPRYSEC effectors.",
        "source": "Molloy et al. (2024)",
        "doi": "https://doi.org/10.1371/journal.ppat.1012395",
        "color": "#4cc9f0",
    },
    "E4": {
        "name": "E4 — Bremia lactucae Effectors",
        "short": "B. lactucae",
        "chain": "B",
        "description": "38 Bremia lactucae (lettuce downy mildew) RXLR-WY and WY effectors.",
        "source": "Wood et al. (2020)",
        "doi": "https://doi.org/10.1371/journal.ppat.1009012",
        "color": "#b5179e",
    },
    "V1": {
        "name": "V1 — Plant Virus Proteins",
        "short": "14 Plant Viruses",
        "chain": "B",
        "description": "93 proteins from 14 major plant viruses (ACMV, BBTV, BNYVV, BYDV, CaMV, CMV, MSV, PVX, PVY, SCMV, SMV, ToBRFV, TSWV, TYLCV).",
        "source": "NCBI Datasets (14 genome assemblies)",
        "doi": "https://www.ncbi.nlm.nih.gov/datasets/genome/",
        "color": "#7209b7",
    },
}

# Verified NCBI Datasets genome assemblies for every V1 plant virus
# (extracted from data/viruses/V1/genomes/ and RefSeq polyprotein DBSOURCE records)
V1_VIRUS_ASSEMBLIES = {
    "ACMV": "GCA_031773165.1",
    "BBTV": "GCF_000847305.1",
    "BNYVV": "GCF_000854885.1",
    "BYDV": "GCA_031102425.1",
    "CMV": "GCF_000864745.1",
    "CaMV": "GCF_000848745.2",
    "MSV": "GCF_003048235.1",
    "PVX": "GCF_000866465.1",
    "PVY": "GCF_000862905.1",
    "SCMV": "GCF_000854025.1",
    "SMV": "GCF_000862465.1",
    "ToBRFV": "GCF_001461485.1",
    "ToSWV": "GCF_000854725.1",
    "YP": "GCF_000854725.1",  # TSWV YP_009225.1
    "TYLCV": "GCF_000858205.1",
}

REFERENCES = [
    {
        "key": "Abramson2024",
        "citation": "Abramson J et al. (2024) Accurate structure prediction of biomolecular interactions with AlphaFold 3. Nature 630, 493–500.",
        "doi": "https://doi.org/10.1038/s41586-024-07487-w",
        "topic": "AlphaFold 3",
    },
    {
        "key": "Dunbrack2025",
        "citation": "Dunbrack RL Jr (2025) Rēs ipSAE loquunt: What's wrong with AlphaFold's ipTM score and how to fix it. bioRxiv.",
        "doi": "https://doi.org/10.1101/2025.02.10.637595",
        "topic": "ipSAE",
    },
    {
        "key": "Bryant2022",
        "citation": "Bryant P et al. (2022) Improved prediction of protein–protein interactions using AlphaFold2. Nat Commun 13, 1265.",
        "doi": "https://doi.org/10.1038/s41467-022-28865-w",
        "topic": "pDockQ",
    },
    {
        "key": "Zhu2023",
        "citation": "Zhu W et al. (2023) Evaluation of AlphaFold-Multimer prediction on multi-chain protein complexes. Bioinformatics 39, btad424.",
        "doi": "https://doi.org/10.1093/bioinformatics/btad424",
        "topic": "pDockQ2",
    },
    {
        "key": "Kim2024",
        "citation": "Kim A-R et al. (2024) Enhanced protein–protein interaction discovery via AlphaFold-Multimer. bioRxiv.",
        "doi": "https://doi.org/10.1101/2024.02.19.580970",
        "topic": "LIS",
    },
    {
        "key": "Toghani2024",
        "citation": "Toghani A, Kamoun S (2024) Functional annotation of 180 RefSeq reference plant proteomes reveals a dataset of 113,684 NLR proteins. Zenodo.",
        "doi": "https://doi.org/10.5281/zenodo.13627395",
        "topic": "ID1 panel",
    },
    {
        "key": "Toghani2025",
        "citation": "Toghani A, Sugihara Y, Kamoun S (2025) Deep-learning-based annotation of 230 superasterid genomes reveals a harmonized dataset of 91,366 NLRs. Dryad.",
        "doi": "https://doi.org/10.5061/dryad.sxksn03d6",
        "topic": "ID2 panel",
    },
    {
        "key": "Toghani2026",
        "citation": "Toghani A, Sugihara Y, Kamoun S (2026) Harmonized genome annotation of 346 Solanaceae species reveals 197,834 NLR immune receptors. Zenodo.",
        "doi": "https://doi.org/10.5281/zenodo.19855162",
        "topic": "ID3 panel",
    },
    {
        "key": "Derevnina2021",
        "citation": "Derevnina L et al. (2021) Plant pathogens convergently evolved to counteract redundant nodes of an NLR immune receptor network. PLOS Biol 19, e3001136.",
        "doi": "https://doi.org/10.1371/journal.pbio.3001136",
        "topic": "E1 panel",
    },
    {
        "key": "Bos2010",
        "citation": "Bos JIB et al. (2010) A functional genomics approach identifies candidate effectors from the aphid species Myzus persicae (green peach aphid). PLOS Genet 6, e1001216.",
        "doi": "https://doi.org/10.1371/journal.pgen.1001216",
        "topic": "E2 panel",
    },
    {
        "key": "Liu2024",
        "citation": "Liu Q et al. (2024) The salivary proteome of the green peach aphid/peach-potato aphid (Myzus persicae). Zenodo.",
        "doi": "https://doi.org/10.5281/zenodo.13269257",
        "topic": "E2 panel",
    },
    {
        "key": "Molloy2024",
        "citation": "Molloy B et al. (2024) The origin, deployment, and evolution of a plant-parasitic nematode effectorome. PLOS Pathog 20, e1012395.",
        "doi": "https://doi.org/10.1371/journal.ppat.1012395",
        "topic": "E3 panel",
    },
    {
        "key": "Wood2020",
        "citation": "Wood KJ et al. (2020) Effector prediction and characterization in the oomycete pathogen Bremia lactucae reveal host-recognized WY domain proteins that lack the canonical RXLR motif. PLOS Pathog 16, e1009012.",
        "doi": "https://doi.org/10.1371/journal.ppat.1009012",
        "topic": "E4 panel",
    },
]


def clamp_u16_score(val: float) -> int:
    # Conservative 1e-4 floor (with 1e-9 IEEE guard) so scores strictly below any
    # 4-decimal threshold (e.g. 0.499983 < 0.5000) never round up across the cutoff.
    q = int(math.floor(val * SCORE_SCALE + 1e-9))
    if q < 0:
        return 0
    if q > 65535:
        return 65535
    return q


def clamp_u16_int(val: float) -> int:
    q = int(round(val))
    if q < 0:
        return 0
    if q > 65535:
        return 65535
    return q


def write_gz_json(path: Path, obj: object) -> tuple[int, int]:
    raw = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    with gzip.open(path, "wb", compresslevel=9) as f:
        f.write(raw)
    return len(raw), path.stat().st_size


def load_datasets_index() -> tuple[list[dict], dict]:
    sets_list = []
    inference_input = {}
    with open(DEPOSIT_DIR / "index" / "bifrost_datasets.tsv", encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            if row["dataset"] == "inference_input":
                inference_input = {
                    "dataset": "inference_input",
                    "doi": row["doi"],
                    "title": "Bifrost AlphaFold 3 inference input",
                }
            else:
                sets_list.append({
                    "id": row["dataset"],
                    "id_panel": row["chain_A_panel"],
                    "path_panel": row["chain_B_panel"],
                    "predictions": int(row["predictions"]),
                    "doi": row["doi"],
                })
    return sets_list, inference_input


def load_deposit_chain_metadata():
    """Load af3_chain_name and extra deposit fields for IDs and pathogens."""
    id_extra = {}
    for panel in ("ID1", "ID2", "ID3"):
        matches = sorted(DEPOSIT_DIR.glob(f"{panel}_*/{panel}_metadata.tsv"))
        assert matches, f"Missing deposit metadata for {panel}"
        with open(matches[0], encoding="utf-8") as f:
            for r in csv.DictReader(f, delimiter="\t"):
                id_extra[(panel, r["id"])] = r

    path_extra = {}
    for panel in ("E1", "E2", "E3", "E4", "V1"):
        matches = sorted(DEPOSIT_DIR.glob(f"ID*_{panel}/{panel}_metadata.tsv"))
        assert matches, f"Missing deposit metadata for {panel}"
        with open(matches[0], encoding="utf-8") as f:
            for r in csv.DictReader(f, delimiter="\t"):
                path_extra[(panel, r["id"])] = r

    return id_extra, path_extra


def load_nlrtracker_domains() -> dict[tuple[str, str], list[tuple[str, str, int, int]]]:
    """Load exact NLRtracker REGION and DOMAIN coordinates per (set, parent_nlr)."""
    path = Path(__file__).resolve().parent / "nlrtracker_domain_coords.tsv"
    by_parent: dict[tuple[str, str], list[tuple[str, str, int, int]]] = defaultdict(list)
    if not path.exists():
        print(f"WARNING: {path} not found; NLR schematics will fall back to domain_string.")
        return by_parent
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter="\t"):
            ftype = r["type"]
            if ftype not in ("REGION", "DOMAIN"):
                continue
            by_parent[(r["set"], r["parent_nlr"])].append(
                (ftype, r["description"], int(r["start"]), int(r["end"]))
            )
    for k in by_parent:
        by_parent[k].sort(key=lambda x: (0 if x[0] == "REGION" else 1, x[2], x[3]))
    return by_parent


def build_id_nlrtracker_list(
    feats: list[tuple[str, str, int, int]], id_start: int, id_end: int
) -> list[list]:
    """Return compact [[label, start, end, kind], ...] for one ID.
    kind=0: canonical NLRtracker REGION (SD, CC, TIR, RPW8, NB-ARC, LRR)
    kind=1: other NLRtracker integrated DOMAIN on the same parent NLR (not overlapping excised ID)
    """
    norm_region = {"R1": "SD", "NBARC": "NB-ARC", "NB-ARC": "NB-ARC", "CC": "CC", "TIR": "TIR", "LRR": "LRR", "RPW8": "RPW8"}
    regions = []
    domains = []
    for ftype, desc, s, e in feats:
        if ftype == "REGION":
            lbl = norm_region.get(desc.upper(), desc)
            regions.append([lbl, s, e, 0])
        elif ftype == "DOMAIN":
            domains.append([desc, s, e, 1])

    regions.sort(key=lambda x: (x[1], x[2]))

    # Keep other DOMAINs that do not correspond to the excised ID or duplicate a canonical REGION
    id_len = max(1, id_end - id_start + 1)
    kept_other = []
    for lbl, s, e, kind in domains:
        d_len = max(1, e - s + 1)
        ov_id = max(0, min(e, id_end) - max(s, id_start) + 1)
        if ov_id / min(d_len, id_len) >= 0.30:
            continue
        ov_reg = max(
            (max(0, min(e, re_) - max(s, rs) + 1) for _, rs, re_, _ in regions),
            default=0,
        )
        if ov_reg / d_len >= 0.50:
            continue
        kept_other.append([lbl, s, e, 1])

    out = regions + kept_other
    out.sort(key=lambda x: (x[1], x[2], x[3]))
    return out


def load_proteins():
    id_extra, path_extra = load_deposit_chain_metadata()
    nlrt_domains = load_nlrtracker_domains()

    ids = []
    parent_nlrs = []
    id_lookup_by_af3 = {}  # (panel, af3_chain_name) -> idx
    n_with_nlrt = 0

    with open(TABLES_DIR / "Bifrost_IDs_metadata.tsv", encoding="utf-8") as f:
        for idx, r in enumerate(csv.DictReader(f, delimiter="\t")):
            panel = r["set"]
            name = r["id_name"]
            dep = id_extra.get((panel, name), {})
            af3 = dep.get("af3_chain_name", "")
            screened = r["screened"] == "True"
            if af3:
                id_lookup_by_af3[(panel, af3)] = idx

            accession = (
                dep.get("refseq_accession")
                or dep.get("helixer_gene_model")
                or r.get("seqname", "")
            )
            st_i = int(r["id_start"]) if r["id_start"] else 0
            en_i = int(r["id_end"]) if r["id_end"] else 0
            nd = build_id_nlrtracker_list(
                nlrt_domains.get((panel, r["parent_nlr"]), []), st_i, en_i
            )
            if nd:
                n_with_nlrt += 1

            nlr_cls = "NL" if r["nlr_class"].startswith("NL ") else r["nlr_class"]
            rec = {
                "i": idx,
                "s": panel,
                "id": name,
                "af3": af3,
                "src": r["source"],
                "asm": r["assembly"],
                "acc": accession,
                "sp": r["species"],
                "fam": r["family"],
                "ord": r["order"],
                "hap": r["haplotype"],
                "pnlr": r["parent_nlr"],
                "arch": r["architecture"],
                "cls": nlr_cls,
                "sub": r["subclass"],
                "dom": r["domain_string"],
                "nd": nd,
                "pos": r["id_position_from_architecture"],
                "st": st_i,
                "en": en_i,
                "len": int(r["id_length"]) if r["id_length"] else len(r["id_sequence"]),
                "plen": int(r["parent_length"]) if r["parent_length"] else len(r["parent_sequence"]),
                "iprs": r["interpros"],
                "ipr": r["first_interpro"],
                "ipr_s": r["interpro_short_name"],
                "ipr_n": r["first_interpro_name"],
                "ipr_t": r["interpro_type"],
                "cat": r["interpro_category"],
                "copy": dep.get("domain_copy", ""),
                "scr": screened,
                "seq": r["id_sequence"],
                # Summary stats filled after reading scores
                "n_scr": 0,
                "n_ok": 0,
                "n_fail": 0,
                "n_miss": 0,
                "max_ipsae": 0.0,
                "max_iptm": 0.0,
                "n05": 0,
                "n03": 0,
                "top_p": -1,
                "top_set": -1,
                "top_job": -1,
            }
            ids.append(rec)
            parent_nlrs.append(r["parent_sequence"])

    print(f"Attached exact NLRtracker domain coordinates to {n_with_nlrt:,} / {len(ids):,} IDs.")

    pathogens = []
    path_lookup_by_af3 = {}  # (panel, af3_chain_name) -> idx

    with open(TABLES_DIR / "Bifrost_pathogen_metadata.tsv", encoding="utf-8") as f:
        for idx, r in enumerate(csv.DictReader(f, delimiter="\t")):
            panel = r["set"]
            name = r["protein"]
            dep = path_extra.get((panel, name), {})
            af3 = dep.get("af3_chain_name", "")
            assert af3, f"Missing af3_chain_name for {panel}/{name}"
            path_lookup_by_af3[(panel, af3)] = idx

            # Prefer deposit published source/DOI (fixes internal E2 source label)
            src = dep.get("source") or r["source"]
            doi = (dep.get("source_doi") or r["doi"] or "").strip()
            if doi in ("-", "NA", "N/A", "none"):
                doi = ""
            if doi and not doi.startswith("http") and ";" not in doi and doi.startswith("10."):
                doi = "https://doi.org/" + doi

            acc = dep.get("ncbi_accession", "")
            asm = ""
            if panel == "V1":
                if acc == "009225.1" and name == "YP_009225.1":
                    acc = "YP_009225.1"
                prefix = name.split("_")[0]
                asm = V1_VIRUS_ASSEMBLIES.get(prefix, "")
                assert asm, f"Missing NCBI Datasets genome assembly for V1 protein {name}"
                src = "NCBI Datasets"
                doi = f"https://www.ncbi.nlm.nih.gov/datasets/genome/{asm}/"

            species_clean = r["species"].replace("\xa0", " ").strip()

            rec = {
                "i": idx,
                "s": panel,
                "id": name,
                "af3": af3,
                "org": r["organism_type"],
                "sp": species_clean,
                "kng": r["kingdom"],
                "ord": r["order"],
                "fam": r["family"],
                "cls": r["protein_class"] or dep.get("protein_class", ""),
                "nwy": int(r["n_WY"]) if r.get("n_WY") else None,
                "acc": acc,
                "asm": asm,
                "src": src,
                "doi": doi,
                "len": int(r["length"]) if r["length"] else len(r["sequence"]),
                "seq": r["sequence"],
                # Summary stats filled after reading scores
                "n_scr": 0,
                "n_ok": 0,
                "n_fail": 0,
                "n_miss": 0,
                "max_ipsae": 0.0,
                "max_iptm": 0.0,
                "n05": 0,
                "n03": 0,
                "top_id": -1,
                "top_set": -1,
                "top_job": -1,
            }
            pathogens.append(rec)

    return ids, parent_nlrs, id_lookup_by_af3, pathogens, path_lookup_by_af3


def process_screening_set(
    set_idx: int,
    ds: dict,
    ids: list[dict],
    pathogens: list[dict],
    id_lookup: dict,
    path_lookup: dict,
    top_hits: list[dict],
    global_hist: dict,
):
    set_name = ds["id"]
    id_panel = ds["id_panel"]
    path_panel = ds["path_panel"]
    d = DEPOSIT_DIR / set_name

    # 1. Read manifest: job_num -> (id_idx, path_idx)
    manifest = {}
    with gzip.open(d / "batch_manifest.tsv.gz", "rt", encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            jn = int(row["job_number"])
            id_i = id_lookup[(id_panel, row["chain_A"])]
            pa_i = path_lookup[(path_panel, row["chain_B"])]
            manifest[jn] = (id_i, pa_i)

    # 2. Read failed jobs
    failed_jobs = set()
    fail_path = d / "ipsae_failed.tsv"
    if fail_path.exists():
        with open(fail_path, encoding="utf-8") as f:
            for row in csv.DictReader(f, delimiter="\t"):
                failed_jobs.add(int(row["job_num"]))

    # 3. Read compiled_ipsae_data.csv.gz (5 rows per job: max, min, mean, asym_A, asym_B)
    # Compact dict per job: job_num -> [list of 19 u16 ints, raw_ipsae_min, raw_iptm, raw_pdockq]
    # [0:ipsae_min, 1:ipsae_max, 2:ipsae_a, 3:ipsae_b,
    #  4:d0dom_min, 5:d0dom_max, 6:d0chn_min, 7:d0chn_max,
    #  8:iptm, 9:iptm_d0chn, 10:pdockq, 11:pdockq2_min, 12:pdockq2_max,
    #  13:lis_min, 14:lis_mean, 15:dist1(ID), 16:dist2(Pathogen), 17:nres1(ID), 18:nres2(Pathogen)]
    #
    # Note: dist1/dist2/nres1/nres2 are computed directly from asym_A (Chn1=A, Chn2=B)
    # and chain-swapped asym_B (Chn1=B, Chn2=A) as chain-aligned conservative minimums
    # (min(A.1, B.2) for Chain A / ID; min(A.2, B.1) for Chain B / Pathogen), avoiding
    # the unswapped column-wise min bug in compiled_ipsae_data.csv.gz Type=="min".
    scored = {}
    asym_counts = {}  # jn -> [a_d1, a_d2, a_n1, a_n2, b_d1_swapped_A, b_d2_swapped_B, b_n1_swapped_A, b_n2_swapped_B, mask]
    with gzip.open(d / "compiled_ipsae_data.csv.gz", "rt", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            jn = int(row["job_num"])
            entry = scored.get(jn)
            if entry is None:
                entry = [[0] * 19, 0.0, 0.0, 0.0]
                scored[jn] = entry
            rec = entry[0]
            t = row["Type"]
            if t == "min":
                raw_ipsae = float(row["ipSAE"])
                raw_iptm = float(row["ipTM_af"])
                raw_pdq = float(row["pDockQ"])
                entry[1] = raw_ipsae
                entry[2] = raw_iptm
                entry[3] = raw_pdq
                rec[0] = clamp_u16_score(raw_ipsae)
                rec[4] = clamp_u16_score(float(row["ipSAE_d0dom"]))
                rec[6] = clamp_u16_score(float(row["ipSAE_d0chn"]))
                rec[8] = clamp_u16_score(raw_iptm)
                rec[9] = clamp_u16_score(float(row["ipTM_d0chn"]))
                rec[10] = clamp_u16_score(raw_pdq)
                rec[11] = clamp_u16_score(float(row["pDockQ2"]))
                rec[13] = clamp_u16_score(float(row["LIS"]))
            elif t == "max":
                rec[1] = clamp_u16_score(float(row["ipSAE"]))
                rec[5] = clamp_u16_score(float(row["ipSAE_d0dom"]))
                rec[7] = clamp_u16_score(float(row["ipSAE_d0chn"]))
                rec[12] = clamp_u16_score(float(row["pDockQ2"]))
            elif t == "mean":
                rec[14] = clamp_u16_score(float(row["LIS"]))
            elif t == "asym_A":
                rec[2] = clamp_u16_score(float(row["ipSAE"]))
                ac = asym_counts.get(jn)
                if ac is None:
                    ac = [0, 0, 0, 0, 0, 0, 0, 0, 0]
                    asym_counts[jn] = ac
                ac[0] = clamp_u16_int(float(row["dist1"]))
                ac[1] = clamp_u16_int(float(row["dist2"]))
                ac[2] = clamp_u16_int(float(row["nres1"]))
                ac[3] = clamp_u16_int(float(row["nres2"]))
                ac[8] |= 1
            elif t == "asym_B":
                rec[3] = clamp_u16_score(float(row["ipSAE"]))
                ac = asym_counts.get(jn)
                if ac is None:
                    ac = [0, 0, 0, 0, 0, 0, 0, 0, 0]
                    asym_counts[jn] = ac
                # asym_B has Chn1=B (Pathogen), Chn2=A (ID) -> swap 1<->2 to align to (Chain A, Chain B)
                ac[4] = clamp_u16_int(float(row["dist2"]))  # Chain A (ID)
                ac[5] = clamp_u16_int(float(row["dist1"]))  # Chain B (Pathogen)
                ac[6] = clamp_u16_int(float(row["nres2"]))  # Chain A (ID)
                ac[7] = clamp_u16_int(float(row["nres1"]))  # Chain B (Pathogen)
                ac[8] |= 2

    # Populate chain-aligned conservative min (dist1_ID, dist2_Pathogen, nres1_ID, nres2_Pathogen)
    for jn, entry in scored.items():
        ac = asym_counts.get(jn)
        assert ac is not None and ac[8] == 3, f"Missing asym_A/asym_B rows for {set_name} job {jn}"
        rec = entry[0]
        rec[15] = min(ac[0], ac[4])
        rec[16] = min(ac[1], ac[5])
        rec[17] = min(ac[2], ac[6])
        rec[18] = min(ac[3], ac[7])

    # 4. Assemble all manifest jobs, update protein stats & histograms
    rows = []
    n_scored = 0
    n_failed = 0
    n_missing = 0
    n_ge_05 = 0
    n_ge_03 = 0
    max_ipsae_set = 0

    for jn, (id_i, pa_i) in manifest.items():
        id_rec = ids[id_i]
        pa_rec = pathogens[pa_i]
        id_rec["n_scr"] += 1
        pa_rec["n_scr"] += 1

        entry = scored.get(jn)
        if entry is not None:
            sc, raw_ipsae, raw_iptm, raw_pdq = entry
            status = 0
            n_scored += 1
            id_rec["n_ok"] += 1
            pa_rec["n_ok"] += 1

            ipsae_min = sc[0]
            iptm = sc[8]
            ipsae_f = ipsae_min / SCORE_SCALE
            iptm_f = iptm / SCORE_SCALE

            if ipsae_min > max_ipsae_set:
                max_ipsae_set = ipsae_min
            if raw_ipsae >= 0.5:
                n_ge_05 += 1
                id_rec["n05"] += 1
                pa_rec["n05"] += 1
            if raw_ipsae >= 0.3:
                n_ge_03 += 1
                id_rec["n03"] += 1
                pa_rec["n03"] += 1

            # Tie-break top partner by (quantized ipsae_min DESC, quantized iptm DESC) matching detail tables
            id_key = (ipsae_min, iptm)
            if id_rec["top_p"] == -1 or id_key > id_rec.get("_top_key", (-1, -1)):
                id_rec["_top_key"] = id_key
                id_rec["max_ipsae"] = ipsae_f
                id_rec["top_p"] = pa_i
                id_rec["top_set"] = set_idx
                id_rec["top_job"] = jn
            if iptm_f > id_rec["max_iptm"]:
                id_rec["max_iptm"] = iptm_f

            pa_key = (ipsae_min, iptm)
            if pa_rec["top_id"] == -1 or pa_key > pa_rec.get("_top_key", (-1, -1)):
                pa_rec["_top_key"] = pa_key
                pa_rec["max_ipsae"] = ipsae_f
                pa_rec["top_id"] = id_i
                pa_rec["top_set"] = set_idx
                pa_rec["top_job"] = jn
            if iptm_f > pa_rec["max_iptm"]:
                pa_rec["max_iptm"] = iptm_f

            # Update global histogram (20 bins of width 0.05 across [0, 1]) using exact raw floats
            b_ipsae = min(19, max(0, int(raw_ipsae * 20.0)))
            b_iptm = min(19, max(0, int(raw_iptm * 20.0)))
            b_pdq = min(19, max(0, int(raw_pdq * 20.0)))
            org = pa_rec["org"]
            global_hist["ipsae"]["all"][b_ipsae] += 1
            global_hist["ipsae"][org][b_ipsae] += 1
            global_hist["iptm"]["all"][b_iptm] += 1
            global_hist["iptm"][org][b_iptm] += 1
            global_hist["pdockq"]["all"][b_pdq] += 1
            global_hist["pdockq"][org][b_pdq] += 1

            if raw_ipsae >= TOP_HIT_THRESHOLD:
                top_hits.append([
                    set_idx,
                    jn,
                    id_i,
                    pa_i,
                    sc[0],   # ipsae_min
                    sc[1],   # ipsae_max
                    sc[2],   # ipsae_a
                    sc[3],   # ipsae_b
                    sc[4],   # d0dom_min
                    sc[5],   # d0dom_max
                    sc[6],   # d0chn_min
                    sc[7],   # d0chn_max
                    sc[8],   # iptm
                    sc[9],   # iptm_d0chn
                    sc[10],  # pdockq
                    sc[11],  # pdockq2_min
                    sc[12],  # pdockq2_max
                    sc[13],  # lis_min
                    sc[14],  # lis_mean
                    sc[15],  # dist1
                    sc[16],  # dist2
                    sc[17],  # nres1
                    sc[18],  # nres2
                ])

            rows.append((0, -ipsae_min, -iptm, jn, id_i, pa_i, sc))
        elif jn in failed_jobs:
            status = 1
            n_failed += 1
            id_rec["n_fail"] += 1
            pa_rec["n_fail"] += 1
            rows.append((1, 0, 0, jn, id_i, pa_i, [0] * 19))
        else:
            status = 2
            n_missing += 1
            id_rec["n_miss"] += 1
            pa_rec["n_miss"] += 1
            rows.append((2, 0, 0, jn, id_i, pa_i, [0] * 19))

    # Sort by status ASC, ipsae_min DESC, iptm DESC, job_num ASC
    rows.sort(key=lambda x: (x[0], x[1], x[2], x[3]))
    n_rows = len(rows)

    # 5. Pack columnar binary:
    # Header: 4x uint32: magic ("BFR1" little-endian), set_idx, n_rows, schema_ver (1)
    # Columns:
    #   job_num: Uint32[n]
    #   id_idx: Uint16[n]
    #   path_idx: Uint16[n]
    #   19 score arrays: Uint16[n] each
    #   status: Uint8[n]
    magic_u32 = struct.unpack("<I", b"BFR1")[0]
    header = struct.pack("<IIII", magic_u32, set_idx, n_rows, 1)

    col_job = array.array("I", (r[3] for r in rows))
    col_id = array.array("H", (r[4] for r in rows))
    col_pa = array.array("H", (r[5] for r in rows))
    col_scores = [array.array("H", (r[6][k] for r in rows)) for k in range(19)]
    col_status = array.array("B", (r[0] for r in rows))

    if sys.byteorder != "little":
        col_job.byteswap()
        col_id.byteswap()
        col_pa.byteswap()
        for cs in col_scores:
            cs.byteswap()

    out_path = OUT_SCORES_DIR / f"{set_name}.bin.gz"
    with gzip.open(out_path, "wb", compresslevel=9) as f:
        f.write(header)
        f.write(col_job.tobytes())
        f.write(col_id.tobytes())
        f.write(col_pa.tobytes())
        for cs in col_scores:
            f.write(cs.tobytes())
        f.write(col_status.tobytes())

    gz_size = out_path.stat().st_size
    ds.update({
        "idx": set_idx,
        "n_total": n_rows,
        "n_scored": n_scored,
        "n_failed": n_failed,
        "n_missing": n_missing,
        "n_ge_05": n_ge_05,
        "n_ge_03": n_ge_03,
        "max_ipsae": round(max_ipsae_set / SCORE_SCALE, 4),
        "bin_bytes": gz_size,
    })
    print(
        f"  [{set_idx:2d}] {set_name:7s}: total={n_rows:7d} scored={n_scored:7d} "
        f"failed={n_failed:5d} missing={n_missing:4d} >=0.5={n_ge_05:4d} "
        f"-> {gz_size / 1e6:.2f} MB"
    )


def main():
    t0 = time.time()
    OUT_DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUT_SCORES_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading datasets index and protein catalogs...")
    datasets, inference_input = load_datasets_index()
    ids, parent_nlrs, id_lookup, pathogens, path_lookup = load_proteins()

    orgs = ["all", "Oomycete", "Nematode", "Insect", "Virus"]
    global_hist = {
        m: {o: [0] * 20 for o in orgs}
        for m in ("ipsae", "iptm", "pdockq")
    }
    top_hits = []

    print(f"Processing {len(datasets)} screening sets...")
    for set_idx, ds in enumerate(datasets):
        process_screening_set(
            set_idx, ds, ids, pathogens, id_lookup, path_lookup, top_hits, global_hist
        )

    # Sort top_hits by ipsae_min DESC, iptm DESC
    top_hits.sort(key=lambda r: (-r[4], -r[12], r[0], r[1]))

    # Build summary stats
    total_preds = sum(d["n_total"] for d in datasets)
    total_scored = sum(d["n_scored"] for d in datasets)
    total_failed = sum(d["n_failed"] for d in datasets)
    total_missing = sum(d["n_missing"] for d in datasets)
    total_ge_05 = sum(d["n_ge_05"] for d in datasets)
    total_ge_03 = sum(d["n_ge_03"] for d in datasets)
    total_bin_bytes = sum(d["bin_bytes"] for d in datasets)

    # Round floats in protein summary stats and strip temporary tie-break keys
    for rec in ids:
        rec.pop("_top_key", None)
        rec["max_ipsae"] = round(rec["max_ipsae"], 4)
        rec["max_iptm"] = round(rec["max_iptm"], 4)
    for rec in pathogens:
        rec.pop("_top_key", None)
        rec["max_ipsae"] = round(rec["max_ipsae"], 4)
        rec["max_iptm"] = round(rec["max_iptm"], 4)

    # Load pipeline_counts for Methods page
    pipeline_counts = []
    with open(TABLES_DIR / "pipeline_counts.tsv", encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            pipeline_counts.append(row)

    # Load full 665-entry InterPro annotation dictionary (primary + overlapping)
    interpro_dict = {}
    with open(TABLES_DIR / "ID_interpro_all_accessions.tsv", encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            interpro_dict[row["interpro"]] = {
                "s": row["interpro_short_name"],
                "n": row["interpro_name"],
                "t": row["interpro_type"],
            }

    meta = {
        "schema_version": 1,
        "generated_at": time.strftime("%Y-%m-%d"),
        "af3_version": "AlphaFold 3 v3.0.1",
        "ipsae_cutoffs": {"pae": 10, "dist": 10},
        "top_hit_threshold": TOP_HIT_THRESHOLD,
        "summary": {
            "total_predictions": total_preds,
            "total_scored": total_scored,
            "total_failed": total_failed,
            "total_missing": total_missing,
            "total_ge_05": total_ge_05,
            "total_ge_03": total_ge_03,
            "total_top_hits": len(top_hits),
            "n_ids_total": len(ids),
            "n_ids_screened": sum(1 for r in ids if r["scr"]),
            "n_ids_unscreened": sum(1 for r in ids if not r["scr"]),
            "n_pathogens": len(pathogens),
            "n_plant_species": len({r["sp"] for r in ids if r["scr"]}),
            "n_plant_orders": len({r["ord"] for r in ids if r["scr"] and r["ord"]}),
            "n_interpro_entries": len({r["ipr"] for r in ids if r["scr"] and r["ipr"]}),
            "n_interpro_all": len(interpro_dict),
            "n_interpro_categories": len({r["cat"] for r in ids if r["scr"] and r["cat"]}),
            "n_pathogen_species": len({r["sp"] for r in pathogens}),
            "total_bin_bytes": total_bin_bytes,
        },
        "panels": PANEL_INFO,
        "datasets": datasets,
        "inference_input": inference_input,
        "histograms": global_hist,
        "pipeline_counts": pipeline_counts,
        "interpro": interpro_dict,
        "references": REFERENCES,
        "ids": ids,
        "pathogens": pathogens,
    }

    raw_m, gz_m = write_gz_json(OUT_DATA_DIR / "meta.json.gz", meta)
    raw_p, gz_p = write_gz_json(OUT_DATA_DIR / "parent_nlrs.json.gz", parent_nlrs)
    raw_t, gz_t = write_gz_json(
        OUT_DATA_DIR / "top_hits.json.gz",
        {"threshold": TOP_HIT_THRESHOLD, "rows": top_hits},
    )

    grand_total = gz_m + gz_p + gz_t + total_bin_bytes
    print("\n=== Bundle Summary ===")
    print(f"  meta.json.gz       : {gz_m / 1e6:6.2f} MB (raw {raw_m / 1e6:.2f} MB)")
    print(f"  parent_nlrs.json.gz: {gz_p / 1e6:6.2f} MB (raw {raw_p / 1e6:.2f} MB)")
    print(f"  top_hits.json.gz   : {gz_t / 1e6:6.2f} MB ({len(top_hits):,} hits >= {TOP_HIT_THRESHOLD})")
    print(f"  scores/*.bin.gz    : {total_bin_bytes / 1e6:6.2f} MB (13 sets, {total_preds:,} pairs)")
    print(f"  TOTAL data/ size   : {grand_total / 1e6:6.2f} MB")
    print(f"  Elapsed            : {time.time() - t0:.1f} s")


if __name__ == "__main__":
    main()
