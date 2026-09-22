
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, Any, Tuple
import numpy as np
import json
import pandas as pd

from .csv_parser import parse_csv
from .frd_parser import parse_frd
# build_steps_from_conc is commented out in fit.py (dead code — only
# reachable via the legacy conc_col path below, itself now commented out).
from .fit import fit_sck_11_biacore, fit_global_sck_11_biacore, validate_steps
from .jsonsafe import json_safe

app = FastAPI(title="SCKAnalyzer API", version="0.9.0")

# Dev-friendly CORS (internal app). Tighten as needed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _to_float_array(series: Optional[list]) -> Optional[np.ndarray]:
    if series is None:
        return None
    try:
        return pd.to_numeric(series, errors="coerce").to_numpy(dtype=float)
    except Exception:
        out = []
        for v in series:
            try:
                out.append(float(v))
            except Exception:
                out.append(np.nan)
        return np.asarray(out, dtype=float)


def _parse_json_field(raw: Optional[str], name: str) -> Tuple[Any, Optional[JSONResponse]]:
    """Parse an optional JSON string field. Returns (value, error_response)."""
    if not raw or not raw.strip():
        return None, None
    try:
        return json.loads(raw), None
    except Exception as e:
        return None, JSONResponse({"error": f"{name} is not valid JSON: {e}"}, status_code=400)


@app.get("/api/health")
def health():
    return {"ok": True, "service": "sckanalyzer-api"}

@app.post("/api/parse")
async def api_parse(
    file: UploadFile = File(...),
    delimiter: Optional[str] = Form(None),
):
    content = await file.read()
    filename = file.filename or ""
    if filename.lower().endswith(".frd"):
        try:
            return json_safe(parse_frd(content, filename=filename))
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
    return json_safe(parse_csv(content, delimiter=delimiter, filename=filename))

@app.post("/api/fit")
async def api_fit(
    # DEAD (commented out, not deleted — see dead-code review, 2026-09-22):
    # file/time_col/ru_col/ref_col/conc_col were the legacy file+column-name
    # input path, itself commented out below (the SPA always sends
    # t_json+y_json). Restore these alongside that commented-out branch.
    # file: Optional[UploadFile] = File(None),
    # time_col: Optional[str] = Form(None),
    # ru_col: Optional[str] = Form(None),
    # ref_col: Optional[str] = Form(None),
    # conc_col: Optional[str] = Form(None),
    t_json: Optional[str] = Form(None),
    y_json: Optional[str] = Form(None),
    steps_json: Optional[str] = Form(None),
    baseline_mode: str = Form("pre_first_inj"),  # "pre_first_inj" or "none"
    robust_loss: str = Form("soft_l1"),  # "linear", "soft_l1", "huber" (cauchy/arctan disabled — not exposed in the web UI)
    model: str = Form("11"),  # "11" only — "11_mt" (MTL) is disabled, not implemented/reachable
    enable_drift: bool = Form(True),  # ignored: drift is disabled in fit.py — not exposed in the web UI
    enable_bulk: bool = Form(True),
    excludes_json: Optional[str] = Form(None),
    bootstrap_n: Optional[int] = Form(None),
    bootstrap_seed: Optional[int] = Form(None),
    bounds_json: Optional[str] = Form(None),
    fixed_json: Optional[str] = Form(None),
):
    warnings = []
    # c_all (parsed conc_col values) is no longer set anywhere — its only
    # producer/consumer was the commented-out legacy branch below.
    # c_all = None

    if t_json is not None or y_json is not None:
        # Pre-processed series supplied directly (e.g. reference/blank-subtracted
        # sensorgram computed by the SPA) — skip file parsing and the same-file
        # ref_col subtraction below entirely; the caller already applied any
        # cross-replicate correction, this endpoint only fits what it's given.
        t_data, err = _parse_json_field(t_json, "t_json")
        if err:
            return err
        y_data, err = _parse_json_field(y_json, "y_json")
        if err:
            return err
        if not isinstance(t_data, list) or not isinstance(y_data, list):
            return JSONResponse({"error": "t_json and y_json must be JSON arrays"}, status_code=400)
        t = _to_float_array(t_data)
        y = _to_float_array(y_data)
        if t is None or y is None or t.size != y.size:
            return JSONResponse({"error": "t_json and y_json must be numeric arrays of equal length"}, status_code=400)

        n_rows_total = int(t.size)
        finite_mask = np.isfinite(t) & np.isfinite(y)
        dropped = int(np.size(t) - int(np.sum(finite_mask)))
        if dropped > 0:
            warnings.append(f"Dropped {dropped} non-finite rows.")
        t = t[finite_mask]
        y = y[finite_mask]

        if t.size < 5:
            return JSONResponse({"error": "Not enough valid data points after cleaning."}, status_code=400)

        order = np.argsort(t)
        sorted_by_time = not np.all(order == np.arange(order.size))
        if sorted_by_time:
            warnings.append("Time column was not sorted; data were sorted by time.")
        t = t[order]
        y = y[order]
        if np.any(np.diff(t) == 0):
            warnings.append("Duplicate time points detected; consider averaging or thinning.")
    else:
        # DEAD CODE (commented out, not deleted — see dead-code review,
        # 2026-09-22): legacy file+column-name path. The current SPA always
        # sends t_json/y_json (see api.ts's fitCsv()), never file+time_col+
        # ru_col — this branch, including same-file ref_col subtraction and
        # conc_col-based step auto-building, is unreachable from the actual
        # app. Kept here, disabled, for any direct API caller that relied on
        # it; restore by uncommenting this block and the conc_col branch
        # below, plus build_steps_from_conc() and its import (see fit.py).
        #
        # if file is None or not time_col or not ru_col:
        #     return JSONResponse({"error": "Provide file+time_col+ru_col, or t_json+y_json"}, status_code=400)
        #
        # content = await file.read()
        # filename = file.filename or ""
        # if filename.lower().endswith(".frd"):
        #     try:
        #         parsed = parse_frd(content, filename=filename)
        #     except ValueError as e:
        #         return JSONResponse({"error": str(e)}, status_code=400)
        # else:
        #     parsed = parse_csv(content, filename=filename)
        # cols = parsed["columns"]
        # if time_col not in cols or ru_col not in cols:
        #     return JSONResponse({"error": "time_col or ru_col not found in CSV columns"}, status_code=400)
        #
        # arr = parsed["data"]
        # t = _to_float_array(arr.get(time_col))
        # y = _to_float_array(arr.get(ru_col))
        # if t is None or y is None:
        #     return JSONResponse({"error": "time_col or ru_col could not be converted to numeric values"}, status_code=400)
        #
        # if ref_col:
        #     if ref_col not in cols:
        #         return JSONResponse({"error": "ref_col not found in CSV columns"}, status_code=400)
        #     ref = _to_float_array(arr.get(ref_col))
        #     if ref is None:
        #         return JSONResponse({"error": "ref_col could not be converted to numeric values"}, status_code=400)
        #     y = y - ref
        #
        # if t.size != y.size:
        #     return JSONResponse({"error": "time_col and ru_col lengths do not match"}, status_code=400)
        #
        # finite_mask = np.isfinite(t) & np.isfinite(y)
        # if ref_col:
        #     finite_mask &= np.isfinite(ref)
        #
        # if conc_col:
        #     if conc_col not in cols:
        #         return JSONResponse({"error": "conc_col not found in CSV columns"}, status_code=400)
        #     c_all = _to_float_array(arr.get(conc_col))
        #     if c_all is None:
        #         return JSONResponse({"error": "conc_col could not be converted to numeric values"}, status_code=400)
        #     finite_mask &= np.isfinite(c_all)
        #
        # dropped = int(np.size(t) - int(np.sum(finite_mask)))
        # if dropped > 0:
        #     warnings.append(f"Dropped {dropped} non-finite rows.")
        # t = t[finite_mask]
        # y = y[finite_mask]
        # if c_all is not None:
        #     c_all = c_all[finite_mask]
        #
        # if t.size < 5:
        #     return JSONResponse({"error": "Not enough valid data points after cleaning."}, status_code=400)
        #
        # order = np.argsort(t)
        # sorted_by_time = not np.all(order == np.arange(order.size))
        # if sorted_by_time:
        #     warnings.append("Time column was not sorted; data were sorted by time.")
        # t = t[order]
        # y = y[order]
        # if c_all is not None:
        #     c_all = c_all[order]
        # if np.any(np.diff(t) == 0):
        #     warnings.append("Duplicate time points detected; consider averaging or thinning.")
        # n_rows_total = int(len(arr[time_col]))
        return JSONResponse({"error": "Provide t_json and y_json (file+time_col+ru_col input is disabled)"}, status_code=400)

    steps_data, err = _parse_json_field(steps_json, "steps_json")
    if err:
        return err
    if steps_data is not None:
        steps = steps_data
    # elif conc_col:  # DEAD CODE (commented out): see legacy-path note above.
    #     steps = build_steps_from_conc(t, c_all)
    else:
        return JSONResponse({"error": "Provide steps_json"}, status_code=400)

    try:
        steps = validate_steps(steps, t0=float(t[0]), t1=float(t[-1]))
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

    if baseline_mode == "pre_first_inj":
        inj = [s for s in steps if s["C"] > 0]
        if inj:
            first = min(s["start"] for s in inj)
            mask = t < first
            if mask.sum() >= 5:
                y = y - float(np.median(y[mask]))
            else:
                y = y - float(y[0])

    excludes, err = _parse_json_field(excludes_json, "excludes_json")
    if err:
        return err
    if excludes is not None:
        if not isinstance(excludes, list):
            return JSONResponse({"error": "excludes_json must be a JSON array"}, status_code=400)
        validated_excludes = []
        for i, ex in enumerate(excludes):
            if not isinstance(ex, dict):
                return JSONResponse({"error": f"exclude {i} must be an object"}, status_code=400)
            try:
                start = float(ex.get("start", float("-inf")))
                stop = float(ex.get("stop", float("+inf")))
            except Exception:
                return JSONResponse({"error": f"exclude {i} start/stop must be numeric"}, status_code=400)
            validated_excludes.append({"start": start, "stop": stop})
        excludes = validated_excludes

    bounds, err = _parse_json_field(bounds_json, "bounds_json")
    if err:
        return err
    if bounds is not None and not isinstance(bounds, dict):
        return JSONResponse({"error": "bounds_json must be a JSON object"}, status_code=400)

    fixed, err = _parse_json_field(fixed_json, "fixed_json")
    if err:
        return err
    if fixed is not None and not isinstance(fixed, dict):
        return JSONResponse({"error": "fixed_json must be a JSON object"}, status_code=400)

    try:
        result = fit_sck_11_biacore(  # type: ignore[assignment]
            t, y, steps,
            model=model,
            robust_loss=robust_loss,
            enable_drift=enable_drift,
            enable_bulk=enable_bulk,
            excludes=excludes,
            bootstrap_n=int(bootstrap_n) if bootstrap_n is not None else 0,
            bootstrap_seed=int(bootstrap_seed) if bootstrap_seed is not None else None,
            bounds_override=bounds,
            fixed_params=fixed,
        )
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    if warnings:
        result["warnings"] = (result.get("warnings") or []) + warnings
    result["preprocess"] = {
        "dropped_nonfinite": dropped,
        "sorted_by_time": sorted_by_time,
        "n_rows": n_rows_total,
        "n_fit": int(len(t)),
    }
    return json_safe(result)


@app.post("/api/fit_global")
async def api_fit_global(
    # DEAD (commented out, not deleted — see dead-code review, 2026-09-22):
    # file/replicates_json were the legacy file+column-name input path,
    # itself commented out below (the SPA always sends series_json).
    # Restore these alongside that commented-out branch.
    # file: Optional[UploadFile] = File(None),
    # replicates_json: Optional[str] = Form(None),
    series_json: Optional[str] = Form(None),
    steps_json: Optional[str] = Form(None),
    baseline_mode: str = Form("pre_first_inj"),
    robust_loss: str = Form("soft_l1"),  # "linear", "soft_l1", "huber" (cauchy/arctan disabled — not exposed in the web UI)
    model: str = Form("11"),  # "11" only — "11_mt" (MTL) is disabled, not implemented/reachable
    enable_drift: bool = Form(True),  # ignored: drift is disabled in fit.py — not exposed in the web UI
    enable_bulk: bool = Form(True),
    share_rmax: bool = Form(True),
    share_bulk: bool = Form(True),
    excludes_json: Optional[str] = Form(None),
    bootstrap_n: Optional[int] = Form(None),
    bootstrap_seed: Optional[int] = Form(None),
    bounds_json: Optional[str] = Form(None),
    fixed_json: Optional[str] = Form(None),
):
    # Two mutually exclusive input modes: either pre-processed per-replicate
    # series (t/y arrays already reference/blank-subtracted by the SPA), or
    # the legacy file+column-name path used by direct API callers.
    reps: list = []

    if series_json is not None:
        try:
            series_spec = json.loads(series_json)
            if not isinstance(series_spec, list) or len(series_spec) == 0:
                return JSONResponse({"error": "series_json must be a non-empty array of {t, y}"}, status_code=400)
        except Exception as e:
            return JSONResponse({"error": f"series_json is not valid JSON: {e}"}, status_code=400)

        for i, spec in enumerate(series_spec):
            if not isinstance(spec, dict) or "t" not in spec or "y" not in spec:
                return JSONResponse({"error": f"Replicate {i}: series_json entries must have t and y arrays"}, status_code=400)
            t = _to_float_array(spec.get("t"))
            y = _to_float_array(spec.get("y"))
            if t is None or y is None or t.size != y.size:
                return JSONResponse({"error": f"Replicate {i}: t/y must be numeric arrays of equal length"}, status_code=400)
            finite_mask = np.isfinite(t) & np.isfinite(y)
            t = t[finite_mask]; y = y[finite_mask]
            if t.size < 5:
                return JSONResponse({"error": f"Replicate {i}: not enough valid data points"}, status_code=400)
            order = np.argsort(t); t = t[order]; y = y[order]
            reps.append((t, y))
    else:
        # DEAD CODE (commented out, not deleted — see dead-code review,
        # 2026-09-22): legacy file+replicates_json path. The current SPA
        # always sends series_json (see api.ts's fitGlobalCsv()), never
        # file+replicates_json — this branch is unreachable from the actual
        # app. Kept here, disabled, for any direct API caller that relied on
        # it; restore by uncommenting this block.
        #
        # if file is None or not replicates_json:
        #     return JSONResponse({"error": "Provide file+replicates_json, or series_json"}, status_code=400)
        #
        # content = await file.read()
        # filename = file.filename or ""
        # if filename.lower().endswith(".frd"):
        #     try:
        #         parsed = parse_frd(content, filename=filename)
        #     except ValueError as e:
        #         return JSONResponse({"error": str(e)}, status_code=400)
        # else:
        #     parsed = parse_csv(content, filename=filename)
        # cols = parsed["columns"]
        # arr = parsed["data"]
        #
        # # Parse replicates list
        # try:
        #     replicates_spec = json.loads(replicates_json)
        #     if not isinstance(replicates_spec, list) or len(replicates_spec) == 0:
        #         return JSONResponse({"error": "replicates_json must be a non-empty array of {time_col, ru_col}"}, status_code=400)
        # except Exception as e:
        #     return JSONResponse({"error": f"replicates_json is not valid JSON: {e}"}, status_code=400)
        #
        # for i, spec in enumerate(replicates_spec):
        #     time_col = spec.get("time_col", "")
        #     ru_col = spec.get("ru_col", "")
        #     if time_col not in cols or ru_col not in cols:
        #         return JSONResponse({"error": f"Replicate {i}: time_col or ru_col not found in CSV columns"}, status_code=400)
        #     t = _to_float_array(arr.get(time_col))
        #     y = _to_float_array(arr.get(ru_col))
        #     if t is None or y is None:
        #         return JSONResponse({"error": f"Replicate {i}: columns could not be converted to numeric"}, status_code=400)
        #     finite_mask = np.isfinite(t) & np.isfinite(y)
        #     t = t[finite_mask]; y = y[finite_mask]
        #     if t.size < 5:
        #         return JSONResponse({"error": f"Replicate {i}: not enough valid data points"}, status_code=400)
        #     order = np.argsort(t); t = t[order]; y = y[order]
        #     reps.append((t, y))
        return JSONResponse({"error": "Provide series_json (file+replicates_json input is disabled)"}, status_code=400)

    steps_data, err = _parse_json_field(steps_json, "steps_json")
    if err: return err

    excludes, err = _parse_json_field(excludes_json, "excludes_json")
    if err: return err
    if excludes is not None:
        if not isinstance(excludes, list):
            return JSONResponse({"error": "excludes_json must be a JSON array"}, status_code=400)
        validated_excludes = []
        for i, ex in enumerate(excludes):
            if not isinstance(ex, dict):
                return JSONResponse({"error": f"exclude {i} must be an object"}, status_code=400)
            try:
                start = float(ex.get("start", float("-inf")))
                stop = float(ex.get("stop", float("+inf")))
            except Exception:
                return JSONResponse({"error": f"exclude {i} start/stop must be numeric"}, status_code=400)
            validated_excludes.append({"start": start, "stop": stop})
        excludes = validated_excludes

    bounds, err = _parse_json_field(bounds_json, "bounds_json")
    if err: return err
    if bounds is not None and not isinstance(bounds, dict):
        return JSONResponse({"error": "bounds_json must be a JSON object"}, status_code=400)

    fixed, err = _parse_json_field(fixed_json, "fixed_json")
    if err: return err
    if fixed is not None and not isinstance(fixed, dict):
        return JSONResponse({"error": "fixed_json must be a JSON object"}, status_code=400)

    # Validate and apply steps (same time grid assumed for all reps — use first rep)
    t0 = float(min(r[0][0] for r in reps))
    t1 = float(max(r[0][-1] for r in reps))
    if steps_data is None:
        return JSONResponse({"error": "steps_json is required for global fit"}, status_code=400)
    try:
        steps = validate_steps(steps_data, t0=t0, t1=t1)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

    # Baseline correction per replicate
    if baseline_mode == "pre_first_inj":
        inj_steps = [s for s in steps if s["C"] > 0]
        if inj_steps:
            first = min(s["start"] for s in inj_steps)
            corrected = []
            for t_i, y_i in reps:
                mask = t_i < first
                if mask.sum() >= 5:
                    y_i = y_i - float(np.median(y_i[mask]))
                else:
                    y_i = y_i - float(y_i[0])
                corrected.append((t_i, y_i))
            reps = corrected

    try:
        results = fit_global_sck_11_biacore(
            reps, steps,
            model=model,
            robust_loss=robust_loss,
            enable_drift=enable_drift,
            enable_bulk=enable_bulk,
            share_rmax=share_rmax,
            share_bulk=share_bulk,
            excludes=excludes,
            bootstrap_n=int(bootstrap_n) if bootstrap_n is not None else 0,
            bootstrap_seed=int(bootstrap_seed) if bootstrap_seed is not None else None,
            bounds_override=bounds,
            fixed_params=fixed,
        )
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    return json_safe({"fit_mode": "global", "replicates": results})
