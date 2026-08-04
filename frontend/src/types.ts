export type Parsed = { columns: string[]; n_rows: number; data: Record<string, (string | number | null)[]> };

export type FitParams = {
  ka: number;
  kd: number;
  KD: number;
  Rmax: number;
  drift_RU_per_s?: number;
  kt_per_s?: number;
  bulk_offsets_RU?: number[];
};

export type FitQuality = {
  rmse: number;
  r2: number;
  cost: number;
  mae: number;
  aic: number;
  bic: number;
  chi2: number;
  n_points: number;
  dof: number;
};

export type FitResult = {
  success: boolean;
  message: string;
  nfev: number;
  fit_mode?: "global" | "per_rep";
  params: FitParams;
  fit_quality: FitQuality;
  series: { t: number[]; y: number[]; yhat: number[]; residual: number[] };
  standard_errors?: Record<string, number> | null;
  bootstrap?: {
    n: number;
    success: number;
    failed: number;
    seed: number | null;
    ci95: Record<string, [number, number]>;
  };
  warnings?: string[];
  preprocess?: { dropped_nonfinite: number; sorted_by_time: boolean; n_rows: number; n_fit: number };
};
