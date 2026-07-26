
from __future__ import annotations
from typing import Optional, Dict, Any
import pandas as pd
import io
import re


def _parse_dat(content: bytes) -> Dict[str, Any]:
    """Best-effort BLI DAT parser (FortéBio/Octet/BLItz format).

    These files are typically tab-separated with optional metadata lines at the
    top (comments starting with #, key:value pairs, blank lines, etc.).  We
    skip all non-numeric leading rows and find the first row whose fields are
    all numeric (after stripping) — that becomes the header candidate row,
    or we try to detect a named header row just before the numeric block.
    """
    text = content.decode("utf-8", errors="replace")
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
    df.columns = [str(c).strip() for c in df.columns]
    data = {c: df[c].tolist() for c in df.columns}
    return {"columns": list(df.columns), "n_rows": int(len(df)), "data": data}


def parse_csv(content: bytes, delimiter: Optional[str] = None, filename: Optional[str] = None) -> Dict[str, Any]:
    if filename and filename.lower().endswith(".dat"):
        return _parse_dat(content)
    return _parse_generic(content, delimiter)
