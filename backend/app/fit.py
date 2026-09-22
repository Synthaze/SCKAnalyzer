
from __future__ import annotations
from typing import List, Dict, Any, Optional, Tuple
import numpy as np

from scipy.optimize import least_squares
# solve_ivp was only used by _simulate_11_mass_transport, now commented out
# below (dead code — MTL is not implemented/reachable). Restore this import
# alongside that function if MTL is ever re-enabled.
# from scipy.integrate import solve_ivp

Step = Dict[str, float]  # {"start": float, "stop": float, "C": float}

def validate_steps(steps: List[Dict[str, Any]], t0: float, t1: float) -> List[Step]:
    if not isinstance(steps, list) or len(steps) == 0:
        raise ValueError("steps must be a non-empty list of {start, stop, C}")
    out: List[Step] = []
    for i, s in enumerate(steps):
        if not all(k in s for k in ("start", "stop", "C")):
            raise ValueError(f"step {i} missing one of start/stop/C")
        start = float(s["start"])
        stop = float(s["stop"])
        C = float(s["C"])
        if stop <= start:
            raise ValueError(f"step {i} has stop <= start")
        out.append({"start": start, "stop": stop, "C": C})
    out.sort(key=lambda x: x["start"])
    if out[0]["start"] < t0 - 1e-9 or out[-1]["stop"] > t1 + 1e-9:
        raise ValueError("steps must lie within the time range of the data")
    for i in range(1, len(out)):
        if out[i]["start"] < out[i-1]["stop"] - 1e-12:
            raise ValueError("steps must not overlap; ensure stop/start boundaries are ordered")
    return out

# DEAD CODE (commented out, not deleted — see dead-code review, 2026-09-22):
# build_steps_from_conc() auto-built injection steps from a concentration
# column. Its only caller was the legacy file+conc_col branch of /api/fit
# (main.py), which is itself commented out below: the current SPA never
# sends a conc_col (concentrations are entered in the step table, or the
# dilution-series builder is used instead), and no UI ever exposed a
# concentration-column selector. Restore by uncommenting this function AND
# the call site (main.py, api_fit's step-resolution block) AND the import
# in main.py.
#
# def build_steps_from_conc(t: np.ndarray, c: np.ndarray, min_step_duration: float = 0.5) -> List[Step]:
#     t = np.asarray(t, float)
#     c = np.asarray(c, float)
#     change = np.where(np.diff(c) != 0)[0]
#     boundaries = [0] + (change + 1).tolist() + [len(t)]
#     steps: List[Step] = []
#     for a, b in zip(boundaries[:-1], boundaries[1:]):
#         if b - a < 2:
#             continue
#         start = float(t[a])
#         stop = float(t[b-1])
#         if stop - start < min_step_duration:
#             continue
#         steps.append({"start": start, "stop": stop, "C": float(c[a])})
#     # merge adjacent equal C
#     merged: List[Step] = []
#     for s in steps:
#         if not merged:
#             merged.append(s)
#         else:
#             prev = merged[-1]
#             if abs(prev["C"] - s["C"]) < 1e-12 and abs(prev["stop"] - s["start"]) < 1e-6:
#                 prev["stop"] = s["stop"]
#             else:
#                 merged.append(s)
#     return merged

def _injection_steps(steps: List[Step]) -> List[Step]:
    """Return only injection (association) segments where C>0."""
    return [s for s in steps if float(s["C"]) > 0.0]

# DEAD CODE (commented out, not deleted — see dead-code review, 2026-09-22):
# _conc_at_time() was only used by _simulate_11_mass_transport(), also
# commented out above. Restore alongside that function.
#
# def _conc_at_time(steps: List[Step], t: float) -> float:
#     # steps define C(t) only within their windows; outside -> 0
#     for s in steps:
#         if t >= s["start"] and t <= s["stop"]:
#             return float(s["C"])
#     return 0.0

def _simulate_11_analytic(
    t: np.ndarray,
    steps: List[Step],
    ka: float,
    kd: float,
    rmax: float,
    drift: float = 0.0,
    bulk_offsets: Optional[np.ndarray] = None,
) -> np.ndarray:
    """
    1:1 Langmuir simulation using analytic solution per segment.
    Adds:
      - linear drift term: drift * (t - t0)
      - per-injection bulk offsets: constant offset applied only during each C>0 window
    """
    t = np.asarray(t, float)
    yhat = np.zeros_like(t)

    steps = sorted(steps, key=lambda s: s["start"])
    segments: List[Step] = []
    cursor = float(t[0])
    for s in steps:
        if s["start"] > cursor:
            segments.append({"start": cursor, "stop": s["start"], "C": 0.0})
        segments.append(s)
        cursor = s["stop"]
    if cursor < float(t[-1]):
        segments.append({"start": cursor, "stop": float(t[-1]), "C": 0.0})

    R0 = 0.0
    for seg in segments:
        mask = (t >= seg["start"]) & (t <= seg["stop"])
        dt_end = float(seg["stop"]) - float(seg["start"])
        if dt_end <= 0:
            continue
        C = float(seg["C"])
        k = ka*C + kd
        if k <= 0:
            if np.any(mask):
                yhat[mask] = R0
        else:
            Req = (ka*C*rmax)/k if C > 0 else 0.0
            if np.any(mask):
                tt = t[mask]
                dt = tt - float(seg["start"])
                yhat[mask] = Req + (R0 - Req) * np.exp(-k*dt)
            R0 = Req + (R0 - Req) * np.exp(-k*dt_end)

    # add drift
    if drift != 0.0:
        yhat = yhat + drift * (t - float(t[0]))

    # add per-injection bulk offsets (applied only during injections)
    if bulk_offsets is not None:
        inj = _injection_steps(steps)
        n = min(len(inj), len(bulk_offsets))
        for i in range(n):
            s = inj[i]
            mask = (t >= s["start"]) & (t <= s["stop"])
            yhat[mask] = yhat[mask] + float(bulk_offsets[i])

    return yhat

# DEAD CODE (commented out, not deleted — see dead-code review, 2026-09-22):
# _simulate_11_mass_transport() implements the mass-transport-limited (MTL)
# extension. It is not a working/validated feature — never expose it again
# without re-validating it. The web UI has no control that can select it
# (App.tsx hardcodes model="11"). Every branch that would call this
# function (in fit_sck_11_biacore and fit_global_sck_11_biacore, both
# further down in this file) is commented out too, so it can never
# actually run, even from a direct API request with model="11_mt".
# Restore by uncommenting this function AND every commented-out
# `use_mt`/`model == "11_mt"` branch in those two functions.
#
# def _simulate_11_mass_transport(
#     t: np.ndarray,
#     steps: List[Step],
#     ka: float,
#     kd: float,
#     rmax: float,
#     kt: float,
#     drift: float = 0.0,
#     bulk_offsets: Optional[np.ndarray] = None,
# ) -> np.ndarray:
#     """
#     "Biacore-style" mass transport-limited model (simplified 2-compartment):
#       dCs/dt = kt * (C(t) - Cs)
#       dR/dt  = ka * Cs * (Rmax - R) - kd * R
#
#     Note: This captures transport lag/limitation without requiring RU↔surface-density conversion.
#     """
#     t = np.asarray(t, float)
#
#     def rhs(tt: float, y: np.ndarray) -> np.ndarray:
#         R = y[0]
#         Cs = y[1]
#         C = _conc_at_time(steps, tt)
#         dCs = kt * (C - Cs)
#         dR = ka * Cs * (rmax - R) - kd * R
#         return np.array([dR, dCs], dtype=float)
#
#     y0 = np.array([0.0, 0.0], dtype=float)
#     sol = solve_ivp(
#         rhs,
#         t_span=(float(t[0]), float(t[-1])),
#         y0=y0,
#         t_eval=t,
#         method="LSODA",
#         rtol=1e-6,
#         atol=1e-8,
#     )
#     if not sol.success:
#         # fallback to analytic no-MT if solver fails
#         yhat = _simulate_11_analytic(t, steps, ka, kd, rmax, drift=0.0, bulk_offsets=None)
#     else:
#         yhat = sol.y[0].astype(float)
#
#     if drift != 0.0:
#         yhat = yhat + drift * (t - float(t[0]))
#
#     if bulk_offsets is not None:
#         inj = _injection_steps(steps)
#         n = min(len(inj), len(bulk_offsets))
#         for i in range(n):
#             s = inj[i]
#             mask = (t >= s["start"]) & (t <= s["stop"])
#             yhat[mask] = yhat[mask] + float(bulk_offsets[i])
#
#     return yhat

def _apply_excludes(t: np.ndarray, y: np.ndarray, excludes: Optional[List[Dict[str, float]]]) -> Tuple[np.ndarray, np.ndarray]:
    if not excludes:
        return t, y
    mask = np.ones_like(t, dtype=bool)
    for ex in excludes:
        a = float(ex.get("start", -np.inf))
        b = float(ex.get("stop", +np.inf))
        if b <= a:
            continue
        mask &= ~((t >= a) & (t <= b))
    return t[mask], y[mask]

def _fit_quality_metrics(resid: np.ndarray, cost: float, nfev: int, k: int) -> Dict[str, float]:
    resid = np.asarray(resid, float)
    n = int(resid.size)
    if n == 0:
        return {
            "rmse": float("nan"),
            "mae": float("nan"),
            "r2": float("nan"),
            "cost": float(cost),
            "nfev": float(nfev),
            "n_points": 0.0,
            "dof": 0.0,
            "aic": float("nan"),
            "bic": float("nan"),
            "chi2": float("nan"),
        }
    rmse = float(np.sqrt(np.mean(resid**2)))
    mae = float(np.mean(np.abs(resid)))
    ss_res = float(np.sum(resid**2))
    # Note: R2 computed elsewhere with y-values
    if ss_res > 0 and n > 0:
        aic = float(n * np.log(ss_res / n) + 2 * k)
        bic = float(n * np.log(ss_res / n) + k * np.log(n))
    else:
        aic = float("nan")
        bic = float("nan")
    dof = float(max(1, n - k))
    # Reduced chi-square (SSR / degrees of freedom): the standard SPR/BLI
    # fit-quality metric when per-point measurement error isn't available,
    # equivalent to assuming homoscedastic noise. Values near the residual
    # variance are expected; much larger than that indicates a poor fit.
    chi2 = float(ss_res / dof) if dof > 0 else float("nan")
    return {
        "rmse": rmse,
        "mae": mae,
        "cost": float(cost),
        "nfev": float(nfev),
        "n_points": float(n),
        "dof": dof,
        "aic": aic,
        "bic": bic,
        "chi2": chi2,
    }

def _covariance_from_jacobian(J: np.ndarray) -> Tuple[Optional[np.ndarray], Optional[float]]:
    if J is None or J.size == 0:
        return None, None
    try:
        JTJ = J.T @ J
        cond = float(np.linalg.cond(JTJ))
        if not np.isfinite(cond) or cond > 1e12:
            return None, cond
        inv = np.linalg.inv(JTJ)
        return inv, cond
    except Exception:
        return None, None

class _InvalidBound(Exception):
    """Raised when a user-supplied bound is invalid for log-space conversion (non-positive)."""

def _to_log_bound(v: Optional[float]) -> Optional[float]:
    """Convert a linear-space bound to log10. Raises _InvalidBound if v is non-positive."""
    if v is None:
        return None
    if v > 0:
        return float(np.log10(v))
    raise _InvalidBound(f"bound {v} is non-positive; expected a positive value for log-space parameters")

def fit_sck_11_biacore(
    t: np.ndarray,
    y: np.ndarray,
    steps: List[Step],
    model: str = "11",  # "11" or "11_mt"
    robust_loss: str = "soft_l1",
    enable_drift: bool = True,
    enable_bulk: bool = True,
    excludes: Optional[List[Dict[str, float]]] = None,
    bootstrap_n: int = 0,
    bootstrap_seed: Optional[int] = None,
    bounds_override: Optional[Dict[str, Any]] = None,
    fixed_params: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Biacore-grade-ish fitter:
      - global 1:1 kinetics across full run
      - optional per-injection bulk offsets (RI step shifts)
      - optional exclusion windows
    """
    # DEAD CODE (commented out below, not deleted — see dead-code review,
    # 2026-09-22): instrument drift and the mass-transport-limited (MTL)
    # model are not exposed anywhere in the web UI (App.tsx hardcodes
    # enable_drift=False, model="11") and MTL is not a working/validated
    # feature. Every `enable_drift`/`use_mt` branch below is commented out;
    # `enable_drift` and `use_mt` themselves are unused now — restore both
    # the commented-out branches and a `use_mt = (model == "11_mt")` /
    # `enable_drift` parameter check if either is ever re-enabled.
    t = np.asarray(t, float)
    y = np.asarray(y, float)

    t_fit, y_fit = _apply_excludes(t, y, excludes)
    if t_fit.size == 0:
        raise ValueError(
            "No data points remain after applying the exclusion windows — "
            "check that they don't cover the entire trace."
        )

    inj = _injection_steps(steps)
    n_inj = len(inj)

    # Initial guesses
    y_max = float(np.nanmax(y_fit)) if y_fit.size else float(np.nanmax(y))
    rmax0 = max(y_max, 10.0)
    ka0, kd0 = 1e5, 1e-3
    # drift0, kt0 (1/s, rough) were the drift/MTL initial guesses, now dead
    # (see the commented-out x0 branches below):
    # drift0 = 0.0
    # kt0 = 50.0

    # Parameter vector:
    # [log10_ka, log10_kd, Rmax, bulk_0..bulk_{n-1}]
    x0 = [np.log10(ka0), np.log10(kd0), rmax0]
    lb = [2.0, -6.0, 0.0]
    ub = [9.0, 1.0, 1e6]

    # Drift disabled (dead code, see note above):
    # if enable_drift:
    #     x0 += [drift0]
    #     lb += [-0.1]   # RU/s
    #     ub += [0.1]

    # MTL disabled (dead code, see the note above this function and
    # _simulate_11_mass_transport's comment block further up):
    # use_mt = (model == "11_mt")
    # if use_mt:
    #     x0 += [np.log10(kt0)]
    #     lb += [-3.0]   # kt 1e-3 .. 1e4 1/s
    #     ub += [4.0]

    if enable_bulk and n_inj > 0:
        x0 += [0.0] * n_inj
        lb += [-500.0] * n_inj
        ub += [500.0] * n_inj

    x0 = np.array(x0, dtype=float)
    lb = np.array(lb, dtype=float)
    ub = np.array(ub, dtype=float)

    param_names: List[str] = ["log10_ka", "log10_kd", "Rmax"]
    # Drift/MTL disabled (dead code, see note above):
    # if enable_drift:
    #     param_names.append("drift_RU_per_s")
    # if use_mt:
    #     param_names.append("log10_kt")
    if enable_bulk and n_inj > 0:
        for i in range(n_inj):
            param_names.append(f"bulk_offset_{i}_RU")

    def _set_bounds(idx: int, lo: Optional[float], hi: Optional[float]) -> None:
        if lo is not None:
            lb[idx] = float(lo)
        if hi is not None:
            ub[idx] = float(hi)
        if lb[idx] > ub[idx]:
            lb[idx], ub[idx] = ub[idx], lb[idx]
        if lb[idx] == ub[idx]:
            # scipy's least_squares requires lb < ub strictly (equal bounds
            # raise ValueError). fixed_params fixes a parameter via
            # _set_bounds(idx, v, v), i.e. lo == hi — widen by a tiny,
            # scale-aware epsilon so the bound is valid while the parameter
            # stays numerically fixed for all practical purposes.
            eps = max(abs(lb[idx]) * 1e-6, 1e-9)
            lb[idx] -= eps
            ub[idx] += eps
        if x0[idx] < lb[idx]:
            x0[idx] = lb[idx]
        if x0[idx] > ub[idx]:
            x0[idx] = ub[idx]

    if bounds_override:
        for key, bounds in bounds_override.items():
            # "drift_RU_per_s"/"kt_per_s" removed from this whitelist (dead
            # code — enable_drift/use_mt are disabled, see above): letting
            # them through here was a silent no-op anyway, since every
            # branch that would act on them below is already commented out.
            # if key not in ("ka", "kd", "Rmax", "drift_RU_per_s", "kt_per_s"):
            if key not in ("ka", "kd", "Rmax"):
                continue
            if not isinstance(bounds, (list, tuple)) or len(bounds) != 2:
                continue
            lo = bounds[0]
            hi = bounds[1]
            try:
                lo = None if lo is None else float(lo)
                hi = None if hi is None else float(hi)
            except Exception:
                continue
            try:
                if key == "ka":
                    _set_bounds(param_names.index("log10_ka"), _to_log_bound(lo), _to_log_bound(hi))
                elif key == "kd":
                    _set_bounds(param_names.index("log10_kd"), _to_log_bound(lo), _to_log_bound(hi))
                # MTL/drift disabled (dead code, see note above):
                # elif key == "kt_per_s" and use_mt:
                #     _set_bounds(param_names.index("log10_kt"), _to_log_bound(lo), _to_log_bound(hi))
                elif key == "Rmax":
                    _set_bounds(param_names.index("Rmax"), lo, hi)
                # elif key == "drift_RU_per_s" and enable_drift:
                #     _set_bounds(param_names.index("drift_RU_per_s"), lo, hi)
            except _InvalidBound:
                continue

    if fixed_params:
        for key, val in fixed_params.items():
            try:
                v = float(val)
            except Exception:
                continue
            if key == "ka" and v > 0:
                idx = param_names.index("log10_ka")
                v = float(np.log10(v))
                _set_bounds(idx, v, v)
            elif key == "kd" and v > 0:
                idx = param_names.index("log10_kd")
                v = float(np.log10(v))
                _set_bounds(idx, v, v)
            # MTL/drift disabled (dead code, see note above):
            # elif key == "kt_per_s" and use_mt and v > 0:
            #     idx = param_names.index("log10_kt")
            #     v = float(np.log10(v))
            #     _set_bounds(idx, v, v)
            elif key == "Rmax":
                idx = param_names.index("Rmax")
                _set_bounds(idx, v, v)
            # elif key == "drift_RU_per_s" and enable_drift:
            #     idx = param_names.index("drift_RU_per_s")
            #     _set_bounds(idx, v, v)

    def unpack(x: np.ndarray):
        i = 0
        ka = 10**x[i]; i += 1
        kd = 10**x[i]; i += 1
        rmax = float(x[i]); i += 1
        drift = 0.0
        # Drift/MTL are disabled — see note above. The parameter vector
        # never has a drift or kt slot, so `i` must not advance for either.
        # if enable_drift:
        #     drift = float(x[i]); i += 1
        kt = None
        # if use_mt:
        #     kt = 10**x[i]; i += 1
        bulk = None
        if enable_bulk and n_inj > 0:
            bulk = x[i:i+n_inj].astype(float).copy()
            i += n_inj
        return ka, kd, rmax, drift, kt, bulk

    def predict(tt: np.ndarray, x: np.ndarray) -> np.ndarray:
        ka, kd, rmax, drift, kt, bulk = unpack(x)
        # MTL disabled (dead code, see note above; also
        # _simulate_11_mass_transport itself is commented out):
        # if use_mt and kt is not None:
        #     return _simulate_11_mass_transport(tt, steps, ka, kd, rmax, kt, drift=drift, bulk_offsets=bulk)
        return _simulate_11_analytic(tt, steps, ka, kd, rmax, drift=drift, bulk_offsets=bulk)

    def residuals(x: np.ndarray, y_target: np.ndarray) -> np.ndarray:
        yhat = predict(t_fit, x)
        return yhat - y_target

    def _run_fit(y_target: np.ndarray, x0_override: Optional[np.ndarray] = None):
        return least_squares(
            lambda x: residuals(x, y_target),
            x0_override if x0_override is not None else x0,
            bounds=(lb, ub),
            # Whitelist restricted to what the web UI actually exposes
            # (soft_l1/linear/huber) — see dead-code review, 2026-09-22.
            # scipy also supports "cauchy"/"arctan", accepted here before,
            # but no UI control ever offered them; removed so they can't be
            # silently selected via a direct API request either.
            loss=robust_loss if robust_loss in ("linear", "soft_l1", "huber") else "soft_l1",
            f_scale=1.0,
            max_nfev=8000,
        )

    res = _run_fit(y_fit, None)

    ka, kd, rmax, drift, kt, bulk = unpack(res.x)
    KD = float(kd/ka) if ka > 0 else float("nan")

    # Full trace (may include user-excluded windows); used for plotting/QC only.
    yhat = predict(t, res.x)
    resid = (yhat - y)

    # Fit-quality diagnostics and standard errors use only the points that
    # actually informed the fit: excluded windows are not part of the
    # objective, so they must not count toward reported goodness-of-fit.
    yhat_fit = predict(t_fit, res.x)
    resid_fit = yhat_fit - y_fit
    ss_res = float(np.sum(resid_fit**2))
    ss_tot = float(np.sum((y_fit - np.mean(y_fit))**2))
    r2 = float(1.0 - ss_res/ss_tot) if ss_tot > 0 else float("nan")

    # Covariance approx
    se = None
    cov = None
    cov_cond = None
    try:
        J = res.jac
        dof = max(1, len(y_fit) - len(res.x))
        s2 = float(np.sum(resid_fit**2)) / dof
        cov, cov_cond = _covariance_from_jacobian(J)
        if cov is not None:
            cov = cov * s2
            se = np.sqrt(np.diag(cov))
    except Exception:
        pass

    params: Dict[str, Any] = {"ka": float(ka), "kd": float(kd), "KD": KD, "Rmax": float(rmax)}
    # Drift/MTL disabled (dead code, see note above):
    # if enable_drift:
    #     params["drift_RU_per_s"] = float(drift)
    # if use_mt and kt is not None:
    #     params["kt_per_s"] = float(kt)
    if enable_bulk and bulk is not None:
        params["bulk_offsets_RU"] = bulk.tolist()

    fit_quality = _fit_quality_metrics(resid_fit, res.cost, res.nfev, len(res.x))
    fit_quality["r2"] = r2

    warnings: List[str] = []
    if res.nfev >= 8000:
        warnings.append("Reached max evaluations; fit may not be fully converged.")
    if cov_cond is not None and cov_cond > 1e10:
        warnings.append("Jacobian is ill-conditioned; standard errors may be unreliable.")

    out: Dict[str, Any] = {
        "success": bool(res.success),
        "message": str(res.message),
        "nfev": int(res.nfev),
        # MTL disabled (dead code, see above), so this is always "11":
        # "model": "11_mt" if use_mt else "11",
        "model": "11",
        "options": {
            # Drift disabled (dead code, see above) — always False,
            # regardless of the enable_drift argument:
            "enable_drift": False,
            "enable_bulk": bool(enable_bulk),
            "excludes": excludes or [],
        },
        "params": params,
        "params_log10": {"log10_ka": float(res.x[0]), "log10_kd": float(res.x[1])},
        "fit_quality": fit_quality,
        "standard_errors": None,
        "series": {"t": t.tolist(), "y": y.tolist(), "yhat": yhat.tolist(), "residual": resid.tolist()},
        "warnings": warnings,
    }

    # MTL disabled (dead code, see note above):
    # if use_mt:
    #     # locate log10_kt index
    #     base = 3 + (1 if enable_drift else 0)
    #     out["params_log10"]["log10_kt"] = float(res.x[base])

    if se is not None:
        # Map SEs by name
        names = ["log10_ka", "log10_kd", "Rmax"]
        idx = 3
        # Drift/MTL disabled (dead code, see note above):
        # if enable_drift:
        #     names.append("drift_RU_per_s"); idx += 1
        # if use_mt:
        #     names.append("log10_kt"); idx += 1
        if enable_bulk and n_inj > 0:
            for i in range(n_inj):
                names.append(f"bulk_offset_{i}_RU")
        out["standard_errors"] = {names[i]: float(se[i]) for i in range(min(len(names), len(se)))}

    if bootstrap_n and bootstrap_n > 0:
        rng = np.random.default_rng(bootstrap_seed)
        params_list: List[Dict[str, float]] = []
        failures = 0
        for _ in range(int(bootstrap_n)):
            idx = rng.integers(0, len(resid_fit), size=len(resid_fit))
            yb = yhat_fit + resid_fit[idx]
            try:
                res_b = _run_fit(yb, res.x)
                if not res_b.success:
                    failures += 1
                    continue
                # drift/kt slots unpacked but unused (_): drift/MTL are
                # disabled (dead code, see note above).
                ka_b, kd_b, rmax_b, _, _, bulk_b = unpack(res_b.x)
                entry: Dict[str, float] = {
                    "ka": float(ka_b),
                    "kd": float(kd_b),
                    "KD": float(kd_b / ka_b) if ka_b > 0 else float("nan"),
                    "Rmax": float(rmax_b),
                }
                if enable_bulk and bulk_b is not None:
                    for i in range(len(bulk_b)):
                        entry[f"bulk_offset_{i}_RU"] = float(bulk_b[i])
                params_list.append(entry)
            except Exception:
                failures += 1
                continue
        ci95: Dict[str, List[float]] = {}
        if params_list:
            keys = params_list[0].keys()
            for k in keys:
                vals = np.array([p.get(k, float("nan")) for p in params_list], dtype=float)
                vals = vals[np.isfinite(vals)]
                if vals.size:
                    lo, hi = np.nanpercentile(vals, [2.5, 97.5]).tolist()
                    ci95[k] = [float(lo), float(hi)]
        out["bootstrap"] = {
            "n": int(bootstrap_n),
            "success": int(len(params_list)),
            "failed": int(failures),
            "seed": int(bootstrap_seed) if bootstrap_seed is not None else None,
            "ci95": ci95,
        }

    return out


def fit_global_sck_11_biacore(
    reps: List[Tuple[np.ndarray, np.ndarray]],
    steps: List[Step],
    model: str = "11",
    robust_loss: str = "soft_l1",
    enable_drift: bool = True,
    enable_bulk: bool = True,
    share_rmax: bool = True,
    share_bulk: bool = True,
    excludes: Optional[List[Dict[str, float]]] = None,
    bootstrap_n: int = 0,
    bootstrap_seed: Optional[int] = None,
    bounds_override: Optional[Dict[str, Any]] = None,
    fixed_params: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """
    Global fit across N replicates: shared ka, kd. Rmax is shared too by
    default (share_rmax=True); set share_rmax=False to fit an independent
    Rmax per replicate instead (e.g. when surface capacity is expected to
    differ between replicates even though the underlying kinetics, ka/kd,
    are the same). Per-injection bulk offsets are likewise shared across
    replicates by default (share_bulk=True) — the bulk RI shift at a given
    injection is usually a systematic, concentration-dependent artifact
    rather than something that should vary randomly between replicates;
    set share_bulk=False to fit an independent set of offsets per replicate
    instead.

    Parameter vector layout (share_rmax=True, share_bulk=True — the default):
      [log10_ka, log10_kd, Rmax, [bulk_0..bulk_{m-1}]]

    Parameter vector layout (share_rmax=False, share_bulk=False):
      [log10_ka, log10_kd,
       [Rmax_0], [bulk_0_0..m-1],
       [Rmax_1], [bulk_1_0..m-1],
       ...]

    (share_rmax and share_bulk are independent — any combination is valid;
    each parameter simply lives in the shared block or the per-replicate
    block depending on its own flag.)
    """
    # DEAD CODE (commented out below, not deleted — see dead-code review,
    # 2026-09-22): instrument drift and the mass-transport-limited (MTL)
    # model are not exposed anywhere in the web UI (App.tsx hardcodes
    # enable_drift=False, model="11") and MTL is not a working/validated
    # feature. Every `enable_drift`/`use_mt` branch below is commented out;
    # `enable_drift` and `use_mt` themselves are unused now — restore both
    # the commented-out branches and a `use_mt = (model == "11_mt")` /
    # `enable_drift` parameter check if either is ever re-enabled.
    n_reps = len(reps)
    if n_reps == 0:
        return []

    reps_fit: List[Tuple[np.ndarray, np.ndarray]] = [
        _apply_excludes(t, y, excludes) for t, y in reps
    ]
    empty_reps = [i + 1 for i, (t_fit_i, _) in enumerate(reps_fit) if t_fit_i.size == 0]
    if empty_reps:
        raise ValueError(
            f"No data points remain after applying the exclusion windows for "
            f"replicate(s) {', '.join(str(i) for i in empty_reps)} — check "
            "that they don't cover the entire trace."
        )

    inj = _injection_steps(steps)
    n_inj = len(inj)
    # MTL disabled (dead code, see the note above this function and
    # _simulate_11_mass_transport's comment block further up):
    # use_mt = (model == "11_mt")
    bulk_active = enable_bulk and n_inj > 0

    # Shared block: log10_ka, log10_kd, [Rmax if shared],
    #               [bulk_0..bulk_{n_inj-1} if shared]
    # MTL disabled (dead code, see above), so the `+ (1 if use_mt else 0)`
    # kt slot is never allocated:
    # n_shared = 2 + (1 if share_rmax else 0) + (1 if use_mt else 0)
    n_shared = 2 + (1 if share_rmax else 0)
    rmax_shared_idx = 2 if share_rmax else None
    # MTL disabled (dead code, see above); kt_shared_idx no longer needed —
    # restore `kt_shared_idx = (2 + (1 if share_rmax else 0)) if use_mt else None`
    # alongside every other commented-out use_mt branch if MTL is re-enabled.
    bulk_shared_idx: Optional[int] = None
    if bulk_active and share_bulk:
        bulk_shared_idx = n_shared
        n_shared += n_inj

    # Per-rep block: [Rmax_i if not shared], [bulk_i_0..n_inj-1 if not shared]
    # (drift_i slot removed: drift is disabled, see below)
    per_rep = 0
    rmax_rep_offset: Optional[int] = None
    if not share_rmax:
        rmax_rep_offset = per_rep
        per_rep += 1
    # Drift disabled (dead code, see the note above this function);
    # drift_rep_offset no longer needed — restore
    # `drift_rep_offset: Optional[int] = None` plus
    # `if enable_drift: drift_rep_offset = per_rep; per_rep += 1`
    # alongside every other commented-out enable_drift branch if drift is
    # re-enabled.
    bulk_rep_offset: Optional[int] = None
    if bulk_active and not share_bulk:
        bulk_rep_offset = per_rep
        per_rep += n_inj

    ka0, kd0 = 1e5, 1e-3
    # kt0 was the MTL initial guess, now dead (see the commented-out x0_list
    # branch above): kt0 = 50.0
    all_ymax = max((float(np.nanmax(y_i)) for _, y_i in reps if y_i.size), default=10.0)
    rmax0 = max(all_ymax, 10.0)

    x0_list: List[float] = [np.log10(ka0), np.log10(kd0)]
    lb_list: List[float] = [2.0, -6.0]
    ub_list: List[float] = [9.0, 1.0]
    if share_rmax:
        x0_list += [rmax0]; lb_list += [0.0]; ub_list += [1e6]
    # MTL disabled (dead code, see note above):
    # if use_mt:
    #     x0_list += [np.log10(kt0)]; lb_list += [-3.0]; ub_list += [4.0]
    if bulk_active and share_bulk:
        x0_list += [0.0] * n_inj; lb_list += [-500.0] * n_inj; ub_list += [500.0] * n_inj

    for _, y_i in reps:
        if not share_rmax:
            rmax0_i = max(float(np.nanmax(y_i)) if y_i.size else 10.0, 10.0)
            x0_list += [rmax0_i]; lb_list += [0.0]; ub_list += [1e6]
        # Drift disabled (dead code, see note above):
        # if enable_drift:
        #     x0_list += [0.0]; lb_list += [-0.1]; ub_list += [0.1]
        if bulk_active and not share_bulk:
            x0_list += [0.0] * n_inj; lb_list += [-500.0] * n_inj; ub_list += [500.0] * n_inj

    x0_arr = np.array(x0_list, dtype=float)
    lb_arr = np.array(lb_list, dtype=float)
    ub_arr = np.array(ub_list, dtype=float)

    def _set_b(idx: int, lo: Optional[float], hi: Optional[float]) -> None:
        if lo is not None: lb_arr[idx] = float(lo)
        if hi is not None: ub_arr[idx] = float(hi)
        if lb_arr[idx] > ub_arr[idx]: lb_arr[idx], ub_arr[idx] = ub_arr[idx], lb_arr[idx]
        if lb_arr[idx] == ub_arr[idx]:
            # scipy's least_squares requires lb < ub strictly (equal bounds
            # raise ValueError). fixed_params fixes a parameter via
            # _set_b(idx, v, v), i.e. lo == hi — widen by a tiny, scale-aware
            # epsilon so the bound is valid while the parameter stays
            # numerically fixed for all practical purposes.
            eps = max(abs(lb_arr[idx]) * 1e-6, 1e-9)
            lb_arr[idx] -= eps
            ub_arr[idx] += eps
        if x0_arr[idx] < lb_arr[idx]: x0_arr[idx] = lb_arr[idx]
        if x0_arr[idx] > ub_arr[idx]: x0_arr[idx] = ub_arr[idx]

    if bounds_override:
        for key, bounds in bounds_override.items():
            if not isinstance(bounds, (list, tuple)) or len(bounds) != 2: continue
            lo, hi = bounds
            try:
                lo = None if lo is None else float(lo)
                hi = None if hi is None else float(hi)
            except Exception:
                continue
            try:
                if key == "ka": _set_b(0, _to_log_bound(lo), _to_log_bound(hi))
                elif key == "kd": _set_b(1, _to_log_bound(lo), _to_log_bound(hi))
                elif key == "Rmax":
                    if share_rmax:
                        _set_b(rmax_shared_idx, lo, hi)
                    else:
                        for ri in range(n_reps): _set_b(n_shared + ri * per_rep + rmax_rep_offset, lo, hi)
                # MTL/drift disabled (dead code, see note above):
                # elif key == "kt_per_s" and use_mt: _set_b(kt_shared_idx, _to_log_bound(lo), _to_log_bound(hi))
                # elif key == "drift_RU_per_s" and enable_drift:
                #     for ri in range(n_reps): _set_b(n_shared + ri * per_rep + drift_rep_offset, lo, hi)
            except _InvalidBound:
                continue

    if fixed_params:
        for key, val in fixed_params.items():
            try: v = float(val)
            except Exception: continue
            if key == "ka" and v > 0:
                lv = float(np.log10(v)); _set_b(0, lv, lv)
            elif key == "kd" and v > 0:
                lv = float(np.log10(v)); _set_b(1, lv, lv)
            elif key == "Rmax":
                if share_rmax:
                    _set_b(rmax_shared_idx, v, v)
                else:
                    for ri in range(n_reps): _set_b(n_shared + ri * per_rep + rmax_rep_offset, v, v)
            # MTL/drift disabled (dead code, see note above):
            # elif key == "kt_per_s" and use_mt and v > 0:
            #     lv = float(np.log10(v)); _set_b(kt_shared_idx, lv, lv)
            # elif key == "drift_RU_per_s" and enable_drift:
            #     for ri in range(n_reps): _set_b(n_shared + ri * per_rep + drift_rep_offset, v, v)

    def unpack_shared(x: np.ndarray):
        ka = 10 ** float(x[0]); kd = 10 ** float(x[1])
        rmax = float(x[rmax_shared_idx]) if share_rmax else None
        # MTL disabled (dead code, see note above):
        # kt = 10 ** float(x[kt_shared_idx]) if use_mt else None
        kt = None
        bulk_shared: Optional[np.ndarray] = None
        if bulk_shared_idx is not None:
            bulk_shared = x[bulk_shared_idx: bulk_shared_idx + n_inj].astype(float).copy()
        return ka, kd, rmax, kt, bulk_shared

    def unpack_rep(x: np.ndarray, ri: int):
        base = n_shared + ri * per_rep
        rmax_i = None if share_rmax else float(x[base + rmax_rep_offset])
        # Drift disabled (dead code, see note above):
        # drift = float(x[base + drift_rep_offset]) if enable_drift else 0.0
        drift = 0.0
        bulk_i: Optional[np.ndarray] = None
        if bulk_rep_offset is not None:
            bulk_i = x[base + bulk_rep_offset: base + bulk_rep_offset + n_inj].astype(float).copy()
        return rmax_i, drift, bulk_i

    def predict_rep(tt: np.ndarray, x: np.ndarray, ri: int) -> np.ndarray:
        ka, kd, rmax_shared_val, kt, bulk_shared_val = unpack_shared(x)
        rmax_i, drift, bulk_i = unpack_rep(x, ri)
        rmax = rmax_shared_val if share_rmax else rmax_i
        bulk = bulk_shared_val if share_bulk else bulk_i
        # MTL disabled (dead code, see note above; also
        # _simulate_11_mass_transport itself is commented out):
        # if use_mt and kt is not None:
        #     return _simulate_11_mass_transport(tt, steps, ka, kd, rmax, kt, drift=drift, bulk_offsets=bulk)
        return _simulate_11_analytic(tt, steps, ka, kd, rmax, drift=drift, bulk_offsets=bulk)

    def residuals_all(x: np.ndarray) -> np.ndarray:
        parts = [predict_rep(t_fit_i, x, ri) - y_fit_i for ri, (t_fit_i, y_fit_i) in enumerate(reps_fit)]
        return np.concatenate(parts)

    # Whitelist restricted to what the web UI actually exposes (soft_l1/
    # linear/huber) — see dead-code review, 2026-09-22. scipy also supports
    # "cauchy"/"arctan", accepted here before, but no UI control ever
    # offered them; removed so they can't be silently selected via a direct
    # API request either.
    res = least_squares(
        residuals_all, x0_arr,
        bounds=(lb_arr, ub_arr),
        loss=robust_loss if robust_loss in ("linear", "soft_l1", "huber") else "soft_l1",
        f_scale=1.0, max_nfev=12000,
    )

    ka, kd, rmax_shared_val, kt, bulk_shared_val = unpack_shared(res.x)
    KD = float(kd / ka) if ka > 0 else float("nan")

    se_all: Optional[np.ndarray] = None
    cov_cond: Optional[float] = None
    try:
        J = res.jac
        total_pts = sum(t_fit_i.size for t_fit_i, _ in reps_fit)
        dof_global = max(1, total_pts - len(res.x))
        s2_global = float(np.sum(residuals_all(res.x) ** 2)) / dof_global
        cov, cov_cond = _covariance_from_jacobian(J)
        if cov is not None:
            cov = cov * s2_global
            se_all = np.sqrt(np.diag(cov))
    except Exception:
        pass

    # Bootstrap
    bs_params_list: List[List[Dict[str, float]]] = [[] for _ in range(n_reps)]
    bs_failures = 0
    if bootstrap_n and bootstrap_n > 0:
        rng = np.random.default_rng(bootstrap_seed)
        resid_concat = residuals_all(res.x)
        split_pts = [t_fit_i.size for t_fit_i, _ in reps_fit]
        for _ in range(int(bootstrap_n)):
            new_reps_fit_bs: List[Tuple[np.ndarray, np.ndarray]] = []
            ptr = 0
            for ri, (t_fit_i, y_fit_i) in enumerate(reps_fit):
                n_i = split_pts[ri]
                r_i = resid_concat[ptr: ptr + n_i]
                yhat_fit_i = y_fit_i + r_i  # model prediction at the optimum (r_i = yhat - y_fit_i)
                idx_bs = rng.integers(0, n_i, size=n_i)
                new_reps_fit_bs.append((t_fit_i, yhat_fit_i + r_i[idx_bs]))
                ptr += n_i
            try:
                res_b = least_squares(
                    lambda x, nrf=new_reps_fit_bs: np.concatenate([predict_rep(t_i, x, ri) - y_i for ri, (t_i, y_i) in enumerate(nrf)]),
                    res.x, bounds=(lb_arr, ub_arr), loss="soft_l1", f_scale=1.0, max_nfev=8000,
                )
                if not res_b.success:
                    bs_failures += 1; continue
                # kt slot unpacked but unused (_): MTL disabled, see note above.
                ka_b, kd_b, rmax_shared_b, _, bulk_shared_b = unpack_shared(res_b.x)
                for ri in range(n_reps):
                    # drift slot unpacked but unused (_): drift disabled, see note above.
                    rmax_i_b, _, bulk_i_b = unpack_rep(res_b.x, ri)
                    rmax_b = rmax_shared_b if share_rmax else rmax_i_b
                    bulk_b = bulk_shared_b if share_bulk else bulk_i_b
                    entry_bs: Dict[str, float] = {
                        "ka": float(ka_b), "kd": float(kd_b),
                        "KD": float(kd_b / ka_b) if ka_b > 0 else float("nan"),
                        "Rmax": float(rmax_b),
                    }
                    if bulk_b is not None:
                        for i in range(len(bulk_b)): entry_bs[f"bulk_offset_{i}_RU"] = float(bulk_b[i])
                    bs_params_list[ri].append(entry_bs)
            except Exception:
                bs_failures += 1; continue

    results: List[Dict[str, Any]] = []
    for ri, (t_i, y_i) in enumerate(reps):
        # drift slot unpacked but unused (_): drift disabled, see note above.
        rmax_i, _, bulk_i = unpack_rep(res.x, ri)
        rmax = rmax_shared_val if share_rmax else rmax_i
        bulk = bulk_shared_val if share_bulk else bulk_i

        # Full trace (may include user-excluded windows); used for plotting/QC only.
        yhat_i = predict_rep(t_i, res.x, ri)
        resid_i = yhat_i - y_i

        # Fit-quality diagnostics use only the points that actually informed
        # the fit for this replicate (excluded windows are not part of the
        # objective, so they must not count toward reported goodness-of-fit).
        t_fit_i, y_fit_i = reps_fit[ri]
        yhat_fit_i = predict_rep(t_fit_i, res.x, ri)
        resid_fit_i = yhat_fit_i - y_fit_i
        ss_res = float(np.sum(resid_fit_i ** 2))
        ss_tot = float(np.sum((y_fit_i - np.mean(y_fit_i)) ** 2))
        r2_i = float(1.0 - ss_res / ss_tot) if ss_tot > 0 else float("nan")
        k_eff = n_shared + per_rep
        fq_i = _fit_quality_metrics(resid_fit_i, res.cost, res.nfev, k_eff)
        fq_i["r2"] = r2_i

        se_out: Optional[Dict[str, float]] = None
        if se_all is not None:
            se_out = {"log10_ka": float(se_all[0]), "log10_kd": float(se_all[1])}
            if share_rmax:
                se_out["Rmax"] = float(se_all[rmax_shared_idx])
            else:
                se_out["Rmax"] = float(se_all[n_shared + ri * per_rep + rmax_rep_offset])
            # MTL/drift disabled (dead code, see note above):
            # if use_mt: se_out["log10_kt"] = float(se_all[kt_shared_idx])
            # if enable_drift and drift_rep_offset is not None:
            #     se_out["drift_RU_per_s"] = float(se_all[n_shared + ri * per_rep + drift_rep_offset])
            if bulk_active:
                for i in range(n_inj):
                    if share_bulk:
                        se_out[f"bulk_offset_{i}_RU"] = float(se_all[bulk_shared_idx + i])
                    else:
                        se_out[f"bulk_offset_{i}_RU"] = float(se_all[n_shared + ri * per_rep + bulk_rep_offset + i])

        params_i: Dict[str, Any] = {"ka": float(ka), "kd": float(kd), "KD": KD, "Rmax": float(rmax)}
        # Drift/MTL disabled (dead code, see note above):
        # if enable_drift: params_i["drift_RU_per_s"] = float(drift_i)
        # if use_mt and kt is not None: params_i["kt_per_s"] = float(kt)
        if bulk is not None: params_i["bulk_offsets_RU"] = bulk.tolist()

        bs_out: Optional[Dict[str, Any]] = None
        if bootstrap_n and bootstrap_n > 0:
            pl = bs_params_list[ri]
            ci95_i: Dict[str, List[float]] = {}
            if pl:
                for k in pl[0].keys():
                    vals = np.array([p.get(k, float("nan")) for p in pl], dtype=float)
                    vals = vals[np.isfinite(vals)]
                    if vals.size:
                        lo_b, hi_b = np.nanpercentile(vals, [2.5, 97.5]).tolist()
                        ci95_i[k] = [float(lo_b), float(hi_b)]
            bs_out = {"n": int(bootstrap_n), "success": int(len(pl)),
                      "failed": int(bs_failures) if ri == 0 else 0,
                      "seed": int(bootstrap_seed) if bootstrap_seed is not None else None,
                      "ci95": ci95_i}

        warnings_i: List[str] = []
        if res.nfev >= 12000:
            warnings_i.append("Reached max evaluations; global fit may not be fully converged.")
        if cov_cond is not None and cov_cond > 1e10:
            warnings_i.append("Jacobian is ill-conditioned; standard errors may be unreliable.")

        out_i: Dict[str, Any] = {
            "success": bool(res.success), "message": str(res.message), "nfev": int(res.nfev),
            # MTL disabled (dead code, see above), so this is always "11":
            # "model": "11_mt" if use_mt else "11",
            "model": "11", "fit_mode": "global",
            # Drift disabled (dead code, see above) — "enable_drift" is
            # always False, regardless of the enable_drift argument.
            "options": {"enable_drift": False, "enable_bulk": bool(enable_bulk), "share_rmax": bool(share_rmax), "share_bulk": bool(share_bulk), "excludes": excludes or []},
            "params": params_i,
            "params_log10": {"log10_ka": float(res.x[0]), "log10_kd": float(res.x[1])},
            "fit_quality": fq_i, "standard_errors": se_out,
            "series": {"t": t_i.tolist(), "y": y_i.tolist(), "yhat": yhat_i.tolist(), "residual": resid_i.tolist()},
            "warnings": warnings_i,
        }
        if bs_out is not None: out_i["bootstrap"] = bs_out
        results.append(out_i)

    return results
