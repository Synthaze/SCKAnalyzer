export const CONC_UNITS = ["pM", "nM", "µM", "mM", "M"] as const;
export type ConcUnit = (typeof CONC_UNITS)[number];
export const CONC_MULT: Record<ConcUnit, number> = { pM: 1e-12, nM: 1e-9, "µM": 1e-6, mM: 1e-3, M: 1 };
