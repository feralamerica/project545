#!/usr/bin/env python3
"""
Project 545 FARA sync.

Pulls the DOJ FARA bulk CSVs (efile.fara.gov/bulk/zip/*.csv.zip), filters to
every registrant that has represented an Israel-connected foreign principal,
and writes data/fara/israel.json for the site to render.

Run locally:   python3 scripts/sync_fara.py
In CI:         .github/workflows/sync-fara.yml runs this daily and commits
               the JSON when it changes.

No API key. No scraping of HTML. Four public-domain CSV files.
"""
import csv, datetime as dt, io, json, os, re, sys, time, urllib.request, zipfile
from collections import defaultdict, Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "fara", "israel.json")
CURATED = os.path.join(ROOT, "data", "curated.json")
BULK = "https://efile.fara.gov/bulk/zip/{}.csv.zip"
FILES = ["FARA_All_Registrants", "FARA_All_ForeignPrincipals",
         "FARA_All_RegistrantDocs", "FARA_All_ShortForms"]
UA = "project545.org sync (public FARA bulk data; contact localtip@proton.me)"

# Israel-connected principals are matched on the Country/Location field.
# A registrant is included when at least one principal matches and that
# relationship was active on or after this date (or is still active).
SINCE = dt.date(2023, 1, 1)


def mdy(s):
    s = (s or "").strip()
    if not s:
        return None
    try:
        return dt.datetime.strptime(s, "%m/%d/%Y").date()
    except ValueError:
        return None


def iso(d):
    return d.isoformat() if d else None


def fetch(name, cache_dir=None):
    """Download one bulk zip and return its CSV rows as dicts."""
    if cache_dir:
        p = os.path.join(cache_dir, name + ".csv")
        if os.path.exists(p):
            with open(p, encoding="cp1252", newline="") as f:
                return list(csv.DictReader(f))
    url = BULK.format(name)
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=300) as r:
                blob = r.read()
            break
        except Exception as e:  # noqa
            if attempt == 3:
                raise
            time.sleep(10 * (attempt + 1))
    z = zipfile.ZipFile(io.BytesIO(blob))
    member = [m for m in z.namelist() if m.lower().endswith(".csv")][0]
    raw = z.read(member)
    # DOJ ships Windows-1252; a few rows carry smart quotes.
    text = raw.decode("cp1252", errors="replace")
    if cache_dir:
        os.makedirs(cache_dir, exist_ok=True)
        with open(os.path.join(cache_dir, name + ".csv"), "w", encoding="cp1252",
                  errors="replace", newline="") as f:
            f.write(text)
    return list(csv.DictReader(io.StringIO(text, newline="")))


def is_israel(country):
    return "ISRAEL" in (country or "").upper()


def main():
    cache = os.environ.get("FARA_CACHE_DIR")  # optional local cache for dev
    t0 = time.time()
    regs = fetch("FARA_All_Registrants", cache)
    fps = fetch("FARA_All_ForeignPrincipals", cache)
    docs = fetch("FARA_All_RegistrantDocs", cache)
    sfs = fetch("FARA_All_ShortForms", cache)
    print(f"fetched: {len(regs)} registrants, {len(fps)} principals, "
          f"{len(docs)} docs, {len(sfs)} short forms in {time.time()-t0:.0f}s")

    legs, tracked = set(), set()
    if os.path.exists(CURATED):
        with open(CURATED, encoding="utf-8") as f:
            cur = json.load(f)
        legs = {str(l["fara"]) for l in cur.get("legs", [])}
        tracked = legs | {str(b["fara"]) for b in cur.get("beyond", [])}

    # 1. Which registrants qualify?
    keep = set()
    principals = defaultdict(list)
    for r in fps:
        rn = r["Registration Number"].strip()
        c = r["Country/Location Represented"]
        reg_d = mdy(r["Foreign Principal Registration Date"])
        term_d = mdy(r["Foreign Principal Termination Date"])
        principals[rn].append({
            "name": r["Foreign Principal"].strip(),
            "country": c.strip(),
            "israel": is_israel(c),
            "registered": iso(reg_d),
            "terminated": iso(term_d),
            "active": term_d is None,
        })
        if is_israel(c) and (term_d is None or term_d >= SINCE):
            keep.add(rn)
    keep |= tracked

    reg_by = {}
    for r in regs:
        rn = r["Registration Number"].strip()
        if rn in keep:
            reg_by[rn] = r

    # 2. Documents per registrant.
    docs_by = defaultdict(list)
    for d in docs:
        rn = d["Registration Number"].strip()
        if rn not in keep:
            continue
        c = d["Foreign Principal Country"].strip()
        # For the Project 545 legs, keep the whole docket. For everyone else
        # keep the Israel-tagged documents plus the registrant-level filings
        # that carry no country (supplementals, amendments, registration);
        # short forms for multi-client firms are in the short_forms list.
        if rn not in legs:
            if c and not is_israel(c):
                continue
            if not c and d["Document Type"].strip() == "Short-Form":
                continue
        docs_by[rn].append({
            "date": iso(mdy(d["Date Stamped"])),
            "type": d["Document Type"].strip(),
            "short_form": d["Short Form Name"].strip() or None,
            "principal": d["Foreign Principal Name"].strip() or None,
            "country": c or None,
            "url": d["URL"].strip(),
        })

    sf_by = defaultdict(list)
    for s in sfs:
        rn = s["Registration Number"].strip()
        if rn in keep:
            sf_by[rn].append({
                "last": s["Short Form Last Name"].strip(),
                "first": s["Short Form First Name"].strip(),
                "date": iso(mdy(s["Short Form Date"])),
                "terminated": iso(mdy(s["Short Form Termination Date"])),
            })

    out_regs = []
    for rn in sorted(keep, key=lambda x: -int(x) if x.isdigit() else 0):
        r = reg_by.get(rn)
        if not r:
            continue
        dl = sorted(docs_by[rn], key=lambda x: (x["date"] or "", x["url"]), reverse=True)
        pl = sorted(principals[rn], key=lambda x: (not x["israel"], x["registered"] or ""))
        israel_active = any(p["israel"] and p["active"] for p in pl)
        out_regs.append({
            "reg": rn,
            "name": r["Name"].strip(),
            "business_name": r["Business Name"].strip() or None,
            "registered": iso(mdy(r["Registration Date"])),
            "terminated": iso(mdy(r["Termination Date"])),
            "address": ", ".join(x for x in [r["Address 1"].strip(), r["Address 2"].strip()] if x) or None,
            "city": r["City"].strip() or None, "state": r["State"].strip() or None,
            "zip": r["Zip"].strip() or None,
            "israel_active": israel_active,
            "tracked": rn in tracked,
            "leg": rn in legs,
            "principals": pl,
            "short_forms": sorted(sf_by[rn], key=lambda x: x["date"] or "", reverse=True),
            "docs": dl,
            "doc_counts": dict(Counter(d["type"] for d in dl)),
            "latest_doc": dl[0]["date"] if dl else None,
            "efile_url": f"https://efile.fara.gov/ords/fara/f?p=1235:11:::NO::P11_REG_NUMBER:{rn}",
        })

    all_docs = [d for r in out_regs for d in r["docs"]]
    stats = {
        "registrants": len(out_regs),
        "israel_active_registrants": sum(1 for r in out_regs if r["israel_active"]),
        "documents": len(all_docs),
        "informational_materials": sum(1 for d in all_docs if d["type"] == "Informational Materials"),
        "short_form_people": sum(len(r["short_forms"]) for r in out_regs),
        "latest_filing": max((d["date"] for d in all_docs if d["date"]), default=None),
    }
    payload = {
        "synced_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "source": {
            "bulk": "https://efile.fara.gov/ords/fara/f?p=API:BULKDATA",
            "files": [BULK.format(f) for f in FILES],
            "note": "U.S. DOJ FARA eFile bulk data (public domain). Filtered to registrants with an Israel-connected foreign principal active on or after " + SINCE.isoformat() + ", plus every leg tracked by Project 545.",
        },
        "scope_since": SINCE.isoformat(),
        "stats": stats,
        "registrants": out_regs,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    # Stable key order + compact separators => small diffs day to day.
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"), sort_keys=False)
        f.write("\n")
    print(f"wrote {OUT}: {stats}")


if __name__ == "__main__":
    sys.exit(main())
