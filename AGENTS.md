# Repository Guidelines

> This guide covers the full workspace under `/home/synthase`, including the root static app and the React stack in `soft/`.

## Project Structure & Module Organization
- `backend/`: FastAPI backend (CSV parsing, fitting logic) with static frontend in `backend/app/static/`.
- `backend/app/`: Python source (`main.py`, `fit.py`, `csv_parser.py`).
- `backend/tests/`: Test assets (currently `sample_sck.csv`).
- `soft/`: React + FastAPI dev stack.
  - `soft/backend/`: API backend.
  - `soft/frontend/`: Vite React UI (`src/App.tsx`, `src/styles.css`).

## Build, Test, and Development Commands
- Docker (static frontend + backend):  
  `docker compose up --build` — builds and runs the app at `http://localhost:8000`.
- Backend (local Python, root backend):  
  `cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000`
- React stack (in `soft/`):  
  `cd soft/backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000`  
  `cd soft/frontend && npm install && npm run dev` — UI at `http://localhost:5173` (proxies `/api`).

## Coding Style & Naming Conventions
- Python: 4-space indentation, follow existing naming in `backend/app/`.
- JS/TS/TSX: 2-space indentation; prefer `camelCase` for variables/functions and `PascalCase` for React components.
- Keep API parameter names aligned with form fields (`time_col`, `ru_col`, `steps_json`, etc.).

## Testing Guidelines
- No automated tests configured yet. Use `backend/tests/sample_sck.csv` as a manual smoke test via the UI.
- If adding tests, document how to run them here and keep fixtures in `backend/tests/`.

## Commit & Pull Request Guidelines
- No established commit convention found. Use clear, imperative messages (e.g., “Add drift option to fit API”).
- PRs should describe behavior changes, include repro steps, and add screenshots for UI changes.

## Configuration & Security Notes
- Local CORS is permissive for development; tighten for production.
- Do not commit real assay data. Use synthetic or anonymized CSVs.
