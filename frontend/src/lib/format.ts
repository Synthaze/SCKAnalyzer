// Rounds to at most `decimals` decimal places, returning a plain number
// (trailing zeros are not padded) — used to strip floating-point noise
// from unit-converted display values (e.g. 33.33333333333333 -> 33.333)
// without affecting the underlying full-precision stored value.
export function roundDecimals(v: number, decimals = 3): number {
  if (!Number.isFinite(v)) return v;
  const magnitude = Math.pow(10, decimals);
  return Math.round(v * magnitude) / magnitude;
}

export function formatKD(kdM: number) {
  if (!Number.isFinite(kdM) || kdM <= 0) return "—";
  const nM = kdM * 1e9;
  const uM = kdM * 1e6;
  const mM = kdM * 1e3;
  if (nM < 1000) return `${nM.toFixed(2)} nM`;
  if (uM < 1000) return `${uM.toFixed(2)} µM`;
  if (mM < 1000) return `${mM.toFixed(2)} mM`;
  return `${kdM.toExponential(3)} M`;
}

export function formatConc(C: number) {
  if (!Number.isFinite(C)) return "—";
  if (C === 0) return "0";
  const abs = Math.abs(C);
  if (abs >= 1e-3) return `${C.toExponential(2)} M`;
  if (abs >= 1e-6) return `${(C * 1e6).toFixed(2)} µM`;
  if (abs >= 1e-9) return `${(C * 1e9).toFixed(2)} nM`;
  return `${(C * 1e12).toFixed(2)} pM`;
}

export function formatCiFromSe(value: number, se: number | null | undefined, fmt: (v: number) => string) {
  if (!Number.isFinite(value) || se === null || se === undefined || !Number.isFinite(se)) return "—";
  const z = 1.96;
  return `${fmt(value - z * se)} – ${fmt(value + z * se)}`;
}
