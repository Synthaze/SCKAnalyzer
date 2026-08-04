from __future__ import annotations
import math
from typing import Any


def json_safe(obj: Any) -> Any:
    """Recursively replaces non-finite floats (NaN/Infinity) with None.

    Starlette's default JSONResponse serializes with allow_nan=False, so any
    NaN reaching a response (e.g. from a trailing blank CSV row, a ragged
    merged dataset, or an edge-case metric like r2 when ss_tot == 0) raises
    an unhandled ValueError and surfaces to the client as an opaque 500
    ("Internal Server Error") instead of valid JSON.
    """
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [json_safe(v) for v in obj]
    return obj
