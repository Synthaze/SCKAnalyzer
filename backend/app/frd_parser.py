
from __future__ import annotations
import base64
import xml.etree.ElementTree as ET
from typing import Dict, Any

import numpy as np

# Step types to include in the stitched kinetics trace
_KINETICS_TYPES = frozenset({"BASELINE", "ASSOC", "DISASSOC"})


def _decode_float32(b64_text: str, n: int) -> np.ndarray:
    raw = base64.b64decode(b64_text.replace("\n", "").replace("\r", "").replace(" ", ""))
    n_use = min(n, len(raw) // 4)
    return np.frombuffer(raw[: n_use * 4], dtype="<f4").astype(np.float64)


def parse_frd(content: bytes, filename: str = "") -> Dict[str, Any]:
    """Parse an Octet BLI FRD file and return a Parsed-shaped dict.

    Columns returned: time_s (cumulative in-well time, seconds),
    signal_nm (BLI shift, nm), conc_M (analyte concentration in M; 0 for
    baseline/dissociation segments).

    KREGENERATION and NEUTRALIZATION steps are excluded from the trace.
    AssayXData encodes cumulative in-well time in seconds (shared across all
    steps, plate-movement time excluded), so arrays concatenate directly.
    """
    try:
        root = ET.fromstring(content.decode("utf-8-sig", errors="replace"))
    except ET.ParseError as exc:
        raise ValueError(f"FRD file is not valid XML: {exc}") from exc

    kd = root.find("KineticsData")
    if kd is None:
        raise ValueError("No KineticsData element found — not a valid Octet FRD file.")

    t_parts: list[np.ndarray] = []
    y_parts: list[np.ndarray] = []
    c_parts: list[np.ndarray] = []

    for step in kd.findall("Step"):
        cd = step.find("CommonData")
        st_el = step.find("StepType")
        if cd is None or st_el is None:
            continue

        step_type = (st_el.text or "").strip()
        if step_type not in _KINETICS_TYPES:
            continue

        x_el = step.find("AssayXData")
        y_el = step.find("AssayYData")
        if x_el is None or y_el is None or not x_el.text:
            continue

        n = int(x_el.get("Points", "0"))
        if n == 0:
            continue

        t_arr = _decode_float32(x_el.text, n)
        y_arr = _decode_float32(y_el.text, n)

        # Concentration: ASSOC steps carry MolarConcentration in nM → convert to M
        if step_type == "ASSOC":
            c_el = cd.find("MolarConcentration")
            try:
                conc_nM = float(c_el.text) if c_el is not None and c_el.text else 0.0
            except ValueError:
                conc_nM = 0.0
            conc_M = max(0.0, conc_nM) * 1e-9
        else:
            conc_M = 0.0

        t_parts.append(t_arr)
        y_parts.append(y_arr)
        c_parts.append(np.full(len(t_arr), conc_M))

    if not t_parts:
        raise ValueError(
            "No BASELINE / ASSOC / DISASSOC steps found in FRD file — "
            "is this a kinetics experiment?"
        )

    t = np.concatenate(t_parts)
    y = np.concatenate(y_parts)
    c = np.concatenate(c_parts)

    order = np.argsort(t, kind="stable")
    t, y, c = t[order], y[order], c[order]

    return {
        "columns": ["time_s", "signal_nm", "conc_M"],
        "n_rows": int(len(t)),
        "data": {
            "time_s": t.tolist(),
            "signal_nm": y.tolist(),
            "conc_M": c.tolist(),
        },
    }
