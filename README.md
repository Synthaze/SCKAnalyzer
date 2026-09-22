<p align="center">
  <img src="arna.png" alt="ARNA laboratory" height="80">
</p>

# SCKAnalyzer

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

**A web application for global kinetic analysis of Single-Cycle Kinetics (SCK) biosensor experiments (SPR / BLI).**

SCKAnalyzer fits multi-injection, single-cycle sensorgrams to a 1:1 Langmuir binding model — with optional per-injection bulk (refractive-index) offset correction — and reports association/dissociation rate constants, equilibrium affinity, fit-quality diagnostics, and bootstrap confidence intervals. It is released as open-source software to accompany the associated publication (see [Citation](#citation)).

**Live instance:** https://sck.iecb.u-bordeaux.fr

## Overview

Single-cycle kinetics is an experimental design (used in Surface Plasmon Resonance and Bio-Layer Interferometry instruments, e.g. Biacore/BLItz/Octet) in which a single analyte is injected onto a sensor surface at a series of increasing concentrations without a regeneration step between injections, producing one continuous, multi-step sensorgram per replicate.

SCKAnalyzer fits this trace directly using a **global, non-linear least-squares** approach:

- **Binding model**: 1:1 Langmuir (`ka`, `kd`, `R_max`), solved analytically per injection segment.
- **Global fitting across replicates**: `ka`/`kd` are always shared across replicates in global mode; sharing `R_max` and sharing per-injection bulk offsets are each an independent, optional toggle.
- **Nuisance parameters**: optional per-injection bulk (refractive-index) offsets, shareable across replicates in global mode.
- **Robust loss functions**: soft-L1 (default), linear, or Huber loss (via `scipy.optimize.least_squares`) to reduce sensitivity to outliers/artifacts.
- **Uncertainty quantification**: asymptotic standard errors from the Jacobian-based covariance estimate, and optional residual-resampling bootstrap (95% CI).
- **Fit diagnostics**: RMSE, MAE, R², AIC, BIC, and reduced chi-square are computed by the backend; the web UI's results table currently displays RMSE, R², reduced chi-square, and N points.

## Features

- Upload generic CSV sensorgrams or Octet **.frd** files directly, with support for multiple files/replicates and merging datasets together.
- Define injection steps either by clicking start/end markers directly on the sensorgram, or by specifying a serial dilution scheme (start time, injection/gap durations, number of injections, final concentration, dilution factor) that auto-builds the full step table.
- Two independently-configurable, chainable trace corrections per replicate: reference-channel subtraction and double-reference (blank-run) subtraction, each selecting another uploaded replicate.
- A visual "Baseline → 0" normalization for the Prepare-dataset/Define-steps previews (display-only — it does not affect the fitted values), plus a separate baseline correction applied by the fit itself.
- Interactive step editor, exclusion windows (bubbles/spikes), and per-parameter bounds/fixed values.
- Overlaid association/dissociation QA plots with per-injection RMSE and ΔRU normalization.
- Per-plot and per-table CSV/PNG export, plus a single "download all" ZIP bundle (plots, tables, and a manifest).
- Per-replicate and global (multi-replicate, shared-parameter) fitting modes.

## Repository structure

```
SCKAnalyzer/
├── backend/            FastAPI service: parsing (CSV/FRD) and kinetic fitting (NumPy/SciPy)
│   ├── app/
│   │   ├── main.py         API endpoints
│   │   ├── fit.py          1:1 Langmuir model, global fitting, bootstrap
│   │   ├── csv_parser.py    Generic CSV / BLI DAT parsing
│   │   └── frd_parser.py    Octet BLI .frd (XML) parsing
│   └── tests/           Example sensorgram datasets
├── frontend/           React + Vite + Plotly single-page application
├── deploy/             Reference nginx/systemd provisioning script + config template
└── Dockerfile          Backend container image
```

## Installation

### Requirements

- Python ≥ 3.11
- Node.js ≥ 18
- Production (Option B below) additionally requires an apt-based Linux distribution (e.g. Ubuntu/Debian) with sudo access

### Development install

Runs the backend with auto-reload and the frontend with Vite's dev server. Intended for local development, not for serving real users.

**1) Backend (FastAPI)**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Health check: `http://localhost:8000/api/health`

**2) Frontend (React)**

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` — the Vite dev server proxies `/api/*` to `http://localhost:8000`.

> The backend's CORS policy (`backend/app/main.py`) is intentionally permissive (`allow_origins=["*"]`) for local development. Tighten it before exposing the API beyond a trusted network (see Production, below).

### Production install

Two supported paths, depending on whether you want just the API in a container or a full turnkey host.

**Option A — Backend API only, via Docker**

Builds a container image for the FastAPI backend only (no pre-built image is published on a registry, and the frontend is not included):

```bash
docker build -t sckanalyzer-backend .
docker run -p 8000:8000 sckanalyzer-backend
```

You are responsible for building the frontend (`npm run build` in `frontend/`, producing `frontend/dist/`) and serving those static files yourself (nginx, any static host, etc.), configured to send `/api/*` to this backend container. You should also restrict the backend's CORS `allow_origins` (`backend/app/main.py`) to your actual frontend origin(s).

**Option B — Full host (frontend + backend + nginx + systemd)**

`deploy/setup_server.sh` provisions an apt-based Linux host (e.g. Ubuntu/Debian; it relies on `apt-get` and is not portable to non-apt distributions) end-to-end: builds both the frontend and backend, installs a systemd unit for the backend, and configures nginx to serve the frontend and reverse-proxy `/api/` to it. As shipped, this serves plain HTTP on port 80 with no TLS and assumes IP-only access on a trusted network (see the script's header comments for the exact security assumptions — add TLS/a domain yourself if the host will be reachable more broadly).

Deployment-specific values (app user, install path, virtualenv path, service/site names, backend port) are kept out of the script and out of version control:

```bash
cp deploy/config.example.sh deploy/config.sh
$EDITOR deploy/config.sh   # adjust for your server
sudo ./deploy/setup_server.sh
```

`deploy/config.sh` is gitignored, so your server's paths and usernames are never committed.

## Usage

1. Upload a sensorgram file (generic CSV, or an Octet `.frd` file) via the web UI.
2. Select the time and response columns for each replicate, and optionally configure reference-channel subtraction and/or double-reference (blank-run) subtraction by choosing another uploaded replicate.
3. Define injection steps by clicking start/end markers on the sensorgram, or by specifying a serial dilution scheme that auto-builds the step table; optionally mark exclusion windows to remove from the fit.
4. Choose per-replicate or global fitting mode, configure bulk-offset fitting and its sharing, robust loss, baseline handling, and per-parameter bounds/fixed values, then run the fit.
5. Inspect fitted parameters, quality metrics, and residual/overlap plots; export results as CSV/PNG per plot or as a single ZIP bundle.

### Input data format

Generic CSV input requires at minimum a time column and a response column (e.g. `time`, `ru`) per replicate; injection concentrations are entered in the step table rather than read from a column, and a reference/blank trace is selected from among the other uploaded replicates rather than from a column in the same file. Example datasets are provided in `backend/tests/`. Octet BLI `.frd` files are parsed directly (baseline/association/dissociation segments are stitched automatically; regeneration/neutralization steps are excluded).

### Testing

There is no automated test suite (no CI, no `pytest`). `backend/tests/` holds example sensorgrams for manual smoke-testing: start the app (see Installation) and upload one of them via the UI to verify parsing, step definition, and fitting end to end.

### API

The backend exposes a small JSON/multipart API (see `backend/app/main.py`):

| Endpoint          | Description                                      |
|-------------------|---------------------------------------------------|
| `GET /api/health`   | Liveness check                                   |
| `POST /api/parse`   | Parse an uploaded CSV/FRD file, return columns   |
| `POST /api/fit`     | Fit a single sensorgram — either `file`+`time_col`+`ru_col`, or pre-processed `t_json`+`y_json` arrays |
| `POST /api/fit_global` | Global fit across multiple replicates — either `file`+`replicates_json`, or pre-processed `series_json` (array of `{t, y}`) |

## Citation

If you use SCKAnalyzer in your research, please cite:

> Malard, F., Blanc, J.-M., Roubin, E., Schäfer, T. & Di Primo, C. *SCKAnalyzer: An Online Tool for Single Cycle Kinetics Data Processing*. In preparation, 2026.

A `CITATION.cff` / archived software DOI (e.g. via Zenodo) will be added at the time of publication.

## License

SCKAnalyzer is released under the [GNU General Public License v3.0](LICENSE) (GPL-3.0-or-later).

## Contact

- Florian Malard — florian.malard@gmail.com
- Carmelo Di Primo — carmelo.di-primo@inserm.fr
