# SCKAnalyzer (React + FastAPI) — Internal Dev

A working development stack for **SPR Single Cycle Kinetics (SCK)** using a **1:1 Langmuir** global fit.

- **Backend**: FastAPI + SciPy (API on `:8000`)
- **Frontend**: React (Vite) + Plotly (UI on `:5173`)
- Input: generic CSV with at least `time` and `ru` columns
- Steps: provide JSON injections or auto-build from a `conc` column

## 1) Run backend (Python)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Health check: http://localhost:8000/api/health

## 2) Run frontend (React)

```bash
cd frontend
npm install
npm run dev
```

Open: http://localhost:5173

The Vite dev server proxies `/api/*` to `http://localhost:8000`.

## Test file

A synthetic SCK sample file is included:

`backend/tests/sample_sck.csv`

Upload it from the UI and try “Auto-build steps (from conc)”.

## Notes

- Model: 1:1 Langmuir with optional mass transport limitation (kt)
- Baseline option: subtract median before first injection
- Reference subtraction: pick a reference RU column (optional)
- Optional per-injection bulk offsets and linear drift
- Exclude time windows and set parameter bounds/fixed values from the UI

Typical next additions:
- save/load analysis sessions (JSON)
- report export (PDF)

## Frontend structure (maintainability)

- `frontend/src/App.tsx`: state orchestration + section composition
- `frontend/src/components/StepsSection.tsx`: steps editor + preview sensorgram
- `frontend/src/components/FitSection.tsx`: fit controls + parameters/quality tables
- `frontend/src/components/PlotsSection.tsx`: fit/residual/overlap plots + exports
- `frontend/src/lib/*`: formatting, steps logic, export helpers
- `frontend/src/api.ts`: typed API wrappers

## Dilution-series SCK

The React UI includes a **dilution series builder** to generate consecutive injection steps from:
- C0 (first concentration)
- dilution factor d
- number of injections
- injection duration (and optional gap)

This generates steps like C0, C0*d, C0*d²… (or decreasing if you choose Down).


## Preview plot on upload

After you upload and parse a CSV, the UI immediately shows a preview sensorgram (optionally reference-subtracted if you select a reference RU column).

## Overlap plots (QA)

The UI includes **overlapped association and dissociation plots** (data + fit), with:
- optional ΔRU normalization,
- per-injection RMSE table,
- CSV + PNG export for quick reporting.


## Biacore-grade options (implemented)

The API/UI now supports:
- **Per-injection bulk offsets** (RI step shifts)
- **Linear drift** parameter (RU/s)
- **Optional mass transport limitation** (kt) via a simplified 2-compartment model
- **Exclude time windows** for bubbles/spikes

These are toggles in the UI fit section.
