# Project 545 Tracker

Static site for [project545.org](https://project545.org), published from this repo by GitHub Pages.

## How it works

- `index.html`, `assets/app.js`, `assets/style.css`: the site. No build step.
- `data/curated.json`: the hand-written record. Legs, hubs, annotated documents, timeline, money table, cast, update log, Beyond 545, articles. **This is the file to edit.**
- `data/fara/israel.json`: generated. DOJ FARA bulk data filtered to every registrant with an Israel-connected foreign principal active since 2023 (full docket for the Project 545 legs, Israel-tagged filings for everyone else). Do not hand-edit; it is overwritten daily.
- `scripts/sync_fara.py`: builds `israel.json` from the four public CSVs at `https://efile.fara.gov/ords/fara/f?p=API:BULKDATA`.
- `.github/workflows/sync-fara.yml`: runs the sync every day at 11:17 UTC, commits `israel.json` if it changed, and triggers the Pages deploy. Run it by hand from the Actions tab ("Sync FARA data" → Run workflow).
- `.github/workflows/static.yml`: deploys to Pages on every push to `main`.
- `legacy/index-2026-08.html`: the single-file site as it stood on August 7, 2026.

## Editing the record

Add a document to `docs`, reference its `id` from a leg, timeline event, money row or cast entry. Legs are matched to the live docket by their `fara` number. Anything with `"draft": true` shows a DRAFT tag on the site; remove the flag once you have verified the entry against the PDF.

Adding a new leg: append to `legs` (the `fara` number is what pulls in its docket), add its money row, timeline events and documents, then run the sync so the live data includes the full docket.

## Running the sync locally

```
python3 scripts/sync_fara.py
```

Set `FARA_CACHE_DIR=/some/dir` to reuse downloaded CSVs between runs. Preview the site with `python3 -m http.server` in the repo root.
