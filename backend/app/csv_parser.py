
from __future__ import annotations
from typing import Optional, Dict, Any, List
import pandas as pd
import io
import re
import codecs

_NUM_RE = re.compile(r"^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$")


def _decode_text_auto(content: bytes) -> str:
    """Decodes text, auto-detecting UTF-16 (with or without BOM) in addition
    to plain UTF-8 — some instrument export dialogs (e.g. Biacore's Windows
    text export) write UTF-16LE with a BOM instead of UTF-8."""
    if content.startswith(codecs.BOM_UTF16_LE) or content.startswith(codecs.BOM_UTF16_BE):
        return content.decode("utf-16")
    if content.startswith(codecs.BOM_UTF8):
        return content.decode("utf-8-sig")
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError:
        # No BOM but riddled with NUL bytes is a strong UTF-16 signature.
        if content[:200].count(b"\x00") > 10:
            return content.decode("utf-16")
        return content.decode("latin-1")


def _parse_dat_xy_pairs(text: str) -> Optional[Dict[str, Any]]:
    """Parses the Biacore-style DAT export where each tab-separated field is
    itself an "X, Y" pair (one such field per injection cycle/series), e.g.:

        0.000, 0.000\t0.000, 0.000\t0.000, 0.000\t0.000, 0.000
        0.200, -0.010\t0.200, -0.014\t0.200, -0.015\t0.200, -0.012

    with no header row and fixed-length trailing blank padding rows
    (" ,  \\t ,  \\t..."). Returns None if the text doesn't match this shape.
    """
    lines = [l for l in text.splitlines() if l.strip() != ""]
    if not lines:
        return None

    n_groups = lines[0].count("\t") + 1
    if n_groups < 1:
        return None

    def split_pair(field: str) -> tuple[Optional[float], Optional[float]]:
        parts = field.split(",")
        if len(parts) != 2:
            return None, None
        xs, ys = parts[0].strip(), parts[1].strip()
        if xs and _NUM_RE.match(xs) and ys and _NUM_RE.match(ys):
            return float(xs), float(ys)
        return None, None

    # Confirm the shape on a sample of rows before committing to this parser.
    sample = lines[: min(20, len(lines))]
    matched = 0
    for l in sample:
        fields = l.split("\t")
        if len(fields) == n_groups and all(split_pair(f) != (None, None) for f in fields):
            matched += 1
    if matched < max(1, len(sample) // 2):
        return None

    cols: List[str] = []
    for i in range(n_groups):
        cols += [f"Series {i + 1}_X", f"Series {i + 1}_Y"]
    data: Dict[str, List[Optional[float]]] = {c: [] for c in cols}

    for l in lines:
        fields = l.split("\t")
        fields = (fields + [""] * n_groups)[:n_groups]
        for i, f in enumerate(fields):
            x, y = split_pair(f)
            data[f"Series {i + 1}_X"].append(x)
            data[f"Series {i + 1}_Y"].append(y)

    df = pd.DataFrame(data, columns=cols)
    # Drop trailing rows padded blank across every column (export artifact).
    df = df.dropna(how="all")
    return {"columns": list(df.columns), "n_rows": int(len(df)), "data": {c: df[c].tolist() for c in df.columns}}


def _parse_dat(content: bytes) -> Dict[str, Any]:
    """Best-effort BLI/SPR DAT parser (FortéBio/Octet/BLItz/Biacore export format).

    These files are typically tab-separated with optional metadata lines at the
    top (comments starting with #, key:value pairs, blank lines, etc.).  We
    skip all non-numeric leading rows and find the first row whose fields are
    all numeric (after stripping) — that becomes the header candidate row,
    or we try to detect a named header row just before the numeric block.
    """
    text = _decode_text_auto(content)

    xy_pairs = _parse_dat_xy_pairs(text)
    if xy_pairs is not None:
        return xy_pairs

    lines = text.splitlines()

    # Detect delimiter: prefer tab if it splits into >=2 cols on most lines
    def split_line(line: str, sep: str):
        return [f.strip() for f in line.split(sep)]

    delimiter = "\t"
    for sep in ["\t", ",", ";"]:
        numeric_count = sum(
            1
            for l in lines
            if not l.strip().startswith("#") and len(split_line(l, sep)) >= 2
            and all(
                re.match(r"^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$", f)
                for f in split_line(l, sep)
                if f
            )
        )
        if numeric_count >= 2:
            delimiter = sep
            break

    def is_numeric_row(fields):
        if not fields:
            return False
        return all(
            re.match(r"^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$", f)
            for f in fields
            if f
        )

    # Find first fully-numeric line index
    first_data_idx = None
    for i, line in enumerate(lines):
        if line.strip().startswith("#") or not line.strip():
            continue
        fields = split_line(line, delimiter)
        if is_numeric_row(fields):
            first_data_idx = i
            break

    if first_data_idx is None:
        # Fall back to generic CSV parse
        return _parse_generic(content, None)

    # Check if the previous non-empty non-comment line looks like a header
    header = None
    for j in range(first_data_idx - 1, -1, -1):
        prev = lines[j].strip()
        if not prev or prev.startswith("#"):
            continue
        fields = split_line(lines[j], delimiter)
        if not is_numeric_row(fields):
            header = fields
        break

    data_lines = []
    for line in lines[first_data_idx:]:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        fields = split_line(line, delimiter)
        if is_numeric_row(fields):
            data_lines.append(fields)

    if not data_lines:
        return _parse_generic(content, None)

    n_cols = len(data_lines[0])
    if header is None or len(header) != n_cols:
        header = [f"col{i+1}" for i in range(n_cols)]

    # Build dataframe
    rows = [[float(f) for f in row if f] for row in data_lines if len([f for f in row if f]) == n_cols]
    if not rows:
        return _parse_generic(content, None)

    df = pd.DataFrame(rows, columns=header)
    df.columns = [str(c).strip() for c in df.columns]
    data = {c: df[c].tolist() for c in df.columns}
    return {"columns": list(df.columns), "n_rows": int(len(df)), "data": data}


def _parse_generic(content: bytes, delimiter: Optional[str]) -> Dict[str, Any]:
    if delimiter is None:
        for d in [",", "\t", ";", "|"]:
            try:
                df = pd.read_csv(io.BytesIO(content), sep=d)
                if df.shape[1] >= 2:
                    delimiter = d
                    break
            except Exception:
                pass
        if delimiter is None:
            df = pd.read_csv(io.BytesIO(content))
    else:
        df = pd.read_csv(io.BytesIO(content), sep=delimiter)

    df = df.dropna(axis=1, how="all")
    df = df.dropna(axis=0, how="all")
    df.columns = [str(c).strip() for c in df.columns]
    data = {c: df[c].tolist() for c in df.columns}
    return {"columns": list(df.columns), "n_rows": int(len(df)), "data": data}


def parse_csv(content: bytes, delimiter: Optional[str] = None, filename: Optional[str] = None) -> Dict[str, Any]:
    if filename and filename.lower().endswith(".dat"):
        return _parse_dat(content)
    return _parse_generic(content, delimiter)
