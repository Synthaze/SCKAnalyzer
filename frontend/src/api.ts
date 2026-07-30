import type { FitResult, Parsed } from "./types";

export async function parseCsv(file: File): Promise<Parsed> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/parse", { method: "POST", body: fd });
  const j = await res.json();
  if (!res.ok) {
    throw new Error(j?.error || "Parse failed.");
  }
  return j as Parsed;
}

export async function fitCsv(payload: {
  file: File;
  time_col: string;
  ru_col: string;
  ref_col?: string;
  conc_col?: string;
  steps_json?: string;
  baseline_mode?: string;
  robust_loss?: string;
  model?: string;
  enable_drift?: boolean;
  enable_bulk?: boolean;
  excludes_json?: string;
  bootstrap_n?: number;
  bootstrap_seed?: string;
  bounds_json?: string;
  fixed_json?: string;
  signal?: AbortSignal;
}): Promise<FitResult> {
  const fd = new FormData();
  fd.append("file", payload.file);
  fd.append("time_col", payload.time_col);
  fd.append("ru_col", payload.ru_col);
  if (payload.ref_col) fd.append("ref_col", payload.ref_col);
  if (payload.conc_col) fd.append("conc_col", payload.conc_col);
  if (payload.steps_json) fd.append("steps_json", payload.steps_json);
  if (payload.baseline_mode) fd.append("baseline_mode", payload.baseline_mode);
  if (payload.robust_loss) fd.append("robust_loss", payload.robust_loss);
  if (payload.model) fd.append("model", payload.model);
  if (payload.enable_drift !== undefined) fd.append("enable_drift", String(payload.enable_drift));
  if (payload.enable_bulk !== undefined) fd.append("enable_bulk", String(payload.enable_bulk));
  if (payload.excludes_json) fd.append("excludes_json", payload.excludes_json);
  if (payload.bootstrap_n && payload.bootstrap_n > 0) {
    fd.append("bootstrap_n", String(payload.bootstrap_n));
    if (payload.bootstrap_seed) fd.append("bootstrap_seed", payload.bootstrap_seed);
  }
  if (payload.bounds_json) fd.append("bounds_json", payload.bounds_json);
  if (payload.fixed_json) fd.append("fixed_json", payload.fixed_json);

  const res = await fetch("/api/fit", { method: "POST", body: fd, signal: payload.signal });
  const j = await res.json();
  if (!res.ok) {
    throw new Error(j?.error || "Fit failed.");
  }
  return j as FitResult;
}

export async function fitGlobalCsv(payload: {
  file: File;
  replicates: Array<{ time_col: string; ru_col: string }>;
  steps_json?: string;
  baseline_mode?: string;
  robust_loss?: string;
  model?: string;
  enable_drift?: boolean;
  enable_bulk?: boolean;
  share_rmax?: boolean;
  share_bulk?: boolean;
  excludes_json?: string;
  bootstrap_n?: number;
  bootstrap_seed?: string;
  bounds_json?: string;
  fixed_json?: string;
  signal?: AbortSignal;
}): Promise<FitResult[]> {
  const fd = new FormData();
  fd.append("file", payload.file);
  fd.append("replicates_json", JSON.stringify(payload.replicates));
  if (payload.steps_json) fd.append("steps_json", payload.steps_json);
  if (payload.baseline_mode) fd.append("baseline_mode", payload.baseline_mode);
  if (payload.robust_loss) fd.append("robust_loss", payload.robust_loss);
  if (payload.model) fd.append("model", payload.model);
  if (payload.enable_drift !== undefined) fd.append("enable_drift", String(payload.enable_drift));
  if (payload.enable_bulk !== undefined) fd.append("enable_bulk", String(payload.enable_bulk));
  if (payload.share_rmax !== undefined) fd.append("share_rmax", String(payload.share_rmax));
  if (payload.share_bulk !== undefined) fd.append("share_bulk", String(payload.share_bulk));
  if (payload.excludes_json) fd.append("excludes_json", payload.excludes_json);
  if (payload.bootstrap_n && payload.bootstrap_n > 0) {
    fd.append("bootstrap_n", String(payload.bootstrap_n));
    if (payload.bootstrap_seed) fd.append("bootstrap_seed", payload.bootstrap_seed);
  }
  if (payload.bounds_json) fd.append("bounds_json", payload.bounds_json);
  if (payload.fixed_json) fd.append("fixed_json", payload.fixed_json);

  const res = await fetch("/api/fit_global", { method: "POST", body: fd, signal: payload.signal });
  const j = await res.json();
  if (!res.ok) {
    throw new Error(j?.error || "Global fit failed.");
  }
  return (j.replicates ?? []) as FitResult[];
}
