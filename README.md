<p align="center">
  <img src="arna.png" alt="ARNA laboratory" height="80">
</p>

# SCKAnalyzer

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

**A web application for global kinetic analysis of Single-Cycle Kinetics (SCK) biosensor experiments (SPR / BLI).**

SCKAnalyzer fits multi-injection, single-cycle sensorgrams to a 1:1 Langmuir binding model — with optional mass-transport limitation, instrument drift, and bulk refractive-index offset correction — and reports association/dissociation rate constants, equilibrium affinity, fit-quality diagnostics, and bootstrap confidence intervals. It is released as open-source software to accompany the associated publication (see [Citation](#citation)).

## Overview

Single-cycle kinetics is an experimental design (used in Surface Plasmon Resonance and Bio-Layer Interferometry instruments, e.g. Biacore/BLItz/Octet) in which a single analyte is injected onto a sensor surface at a series of increasing concentrations without a regeneration step between injections, producing one continuous, multi-step sensorgram per replicate.

SCKAnalyzer fits this trace directly using a **global, non-linear least-squares** approach:

- **Binding model**: 1:1 Langmuir (`ka`, `kd`, `R_max`), solved analytically per injection segment.
- **Mass-transport-limited model** (optional): a simplified two-compartment extension (`dCs/dt = kt(C − Cs)`, `dR/dt = ka·Cs·(R_max − R) − kd·R`), integrated numerically, for surfaces where analyte transport to the sensor is rate-limiting.
- **Global fitting across replicates**: shared `ka`, `kd`, `R_max` (and `kt`) across multiple injected replicates, with per-replicate nuisance parameters (drift, bulk offsets) fitted independently.
- **Nuisance parameters**: optional per-injection bulk (refractive-index) offsets and a linear instrument-drift term.
- **Robust loss functions**: linear, soft-L1, Huber, Cauchy, or arctan loss (via `scipy.optimize.least_squares`) to reduce sensitivity to outliers/artifacts.
- **Uncertainty quantification**: asymptotic standard errors from the Jacobian-based covariance estimate, and optional residual-resampling bootstrap (95% CI).
- **Fit diagnostics**: RMSE, MAE, R², AIC, BIC, and the Durbin–Watson statistic (residual autocorrelation).

## Features

- Upload generic CSV sensorgrams or Octet **.frd** files directly.
- Auto-detect injection steps from a concentration column, or supply explicit step windows.
- Reference-channel subtraction and pre-injection baseline correction.
- Interactive step editor, exclusion windows (bubbles/spikes), and per-parameter bounds/fixed values.
- Overlaid association/dissociation QA plots with per-injection RMSE and ΔRU normalization.
- CSV/PNG export of fits, residuals, and overlap plots for figures and reports.
- Single-replicate and global (multi-replicate) fitting modes.

## Repository structure

```
SCKAnalyzer/
├── backend/            FastAPI service: parsing (CSV/FRD) and kinetic fitting (NumPy/SciPy)
│   ├── app/
│   │   ├── main.py         API endpoints
│   │   ├── fit.py          1:1 Langmuir / mass-transport models, global fitting, bootstrap
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
- Production (Option B below) additionally requires an Ubuntu host with sudo access

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

`deploy/setup_server.sh` provisions an Ubuntu host end-to-end: builds both the frontend and backend, installs a systemd unit for the backend, and configures nginx to serve the frontend and reverse-proxy `/api/` to it. As shipped, this serves plain HTTP on port 80 with no TLS and assumes IP-only access on a trusted network (see the script's header comments for the exact security assumptions — add TLS/a domain yourself if the host will be reachable more broadly).

Deployment-specific values (app user, install path, virtualenv path, service/site names, backend port) are kept out of the script and out of version control:

```bash
cp deploy/config.example.sh deploy/config.sh
$EDITOR deploy/config.sh   # adjust for your server
sudo ./deploy/setup_server.sh
```

`deploy/config.sh` is gitignored, so your server's paths and usernames are never committed.

## Usage

1. Upload a sensorgram file (generic CSV, or an Octet `.frd` file) via the web UI.
2. Select the time and response columns (and, optionally, a reference column and/or a concentration column).
3. Define injection steps manually, or auto-build them from the concentration column.
4. Choose the binding model (1:1, or 1:1 with mass-transport limitation), robust loss, and any nuisance parameters (drift, bulk offsets), then run the fit.
5. Inspect fitted parameters, quality metrics, and residual/overlap plots; export results as CSV/PNG.

### Input data format

Generic CSV input requires at minimum a time column and a response column (e.g. `time`, `ru`), with optional reference and concentration columns. Example datasets are provided in `backend/tests/`. Octet BLI `.frd` files are parsed directly (baseline/association/dissociation segments are stitched automatically; regeneration/neutralization steps are excluded).

### Testing

There is no automated test suite (no CI, no `pytest`). `backend/tests/` holds example sensorgrams for manual smoke-testing: start the app (see Installation) and upload one of them via the UI to verify parsing, step auto-detection, and fitting end to end.

### API

The backend exposes a small JSON/multipart API (see `backend/app/main.py`):

| Endpoint          | Description                                      |
|-------------------|---------------------------------------------------|
| `GET /api/health`   | Liveness check                                   |
| `POST /api/parse`   | Parse an uploaded CSV/FRD file, return columns   |
| `POST /api/fit`     | Fit a single sensorgram                          |
| `POST /api/fit_global` | Global fit across multiple replicates in one file |

## Citation

If you use SCKAnalyzer in your research, please cite:

> [Authors]. SCKAnalyzer: a web application for global kinetic analysis of single-cycle kinetics biosensor experiments. *[Journal]*, [year]. DOI: [to be added upon publication].

A `CITATION.cff` / archived software DOI (e.g. via Zenodo) will be added at the time of publication.

## License

SCKAnalyzer is released under the [GNU General Public License v3.0](LICENSE) (GPL-3.0-or-later).

## Contact

- Florian Malard — florian.malard@gmail.com
- Carmelo Di Primo — carmelo.di-primo@inserm.fr
