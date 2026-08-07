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
  t: number[];
  y: number[];
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
  // Send the already-processed sensorgram (reference/blank-subtracted, as
  // shown in the Upload/Define-steps previews) rather than re-uploading the
  // raw file — the backend must fit exactly what the user sees, not a
  // freshly re-parsed raw column.
  fd.append("t_json", JSON.stringify(payload.t));
  fd.append("y_json", JSON.stringify(payload.y));
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
  series: Array<{ t: number[]; y: number[] }>;
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
  // Send the already-processed sensorgrams (reference/blank-subtracted), one
  // per replicate, instead of re-uploading the raw file + column names.
  fd.append("series_json", JSON.stringify(payload.series));
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
