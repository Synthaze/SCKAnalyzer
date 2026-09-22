// State for every control in the Fit tab's "Advanced options" panel, plus
// the derived JSON blob sent to the backend for exclusion windows. This
// hook only holds UI state — it doesn't know about ka/kd/Rmax fit results
// or run the fit itself; App.tsx reads these values when it builds the
// /api/fit(_global) request (see runFit() there).
import { useState, useMemo } from "react";

// A bound as raw text-input strings (not numbers) so a field can be
// legitimately empty while being edited, without forcing it to 0.
// App.tsx parses these to numbers (or drops them) when building the request.
export type BoundsPair = { min: string; max: string };

export type ExcludeRow = { start: string; stop: string };

export type UseFitOptionsResult = {
  // "global" fits ka/kd jointly across all replicates (see
  // fit_global_sck_11_biacore in the backend); "per_rep" fits each
  // replicate independently. Only meaningful when there's more than one
  // replicate — App.tsx ignores it otherwise.
  repFitMode: "per_rep" | "global";
  setRepFitMode: (v: "per_rep" | "global") => void;
  // Independent of repFitMode: in global mode, whether Rmax is one shared
  // value across replicates or fitted separately per replicate. Ignored in
  // per-replicate mode.
  shareRmax: boolean;
  setShareRmax: (v: boolean) => void;
  // Same idea as shareRmax, but for the per-injection bulk offsets (only
  // relevant when enableBulk is also true).
  shareBulk: boolean;
  setShareBulk: (v: boolean) => void;
  // Whether the fit includes a per-injection bulk (refractive-index)
  // offset term at all. There is no equivalent toggle for instrument
  // drift — that nuisance parameter is not exposed in this UI at all (see
  // backend/app/fit.py's dead-code notes).
  enableBulk: boolean;
  setEnableBulk: (v: boolean) => void;
  // scipy least_squares loss function. Only these three are offered here;
  // the backend additionally accepts "cauchy"/"arctan" for direct API
  // callers, but no UI control exposes them.
  robustLoss: "soft_l1" | "linear" | "huber";
  setRobustLoss: (v: "soft_l1" | "linear" | "huber") => void;
  // Backend-applied baseline correction at fit time (subtract the median
  // response before the first injection, or none). This is separate from,
  // and independent of, the Upload tab's "Baseline → 0" checkbox, which
  // only affects what's displayed/exported there, never the fit — see
  // useFilesets.ts's yFit vs y split.
  baselineMode: "pre_first_inj" | "none";
  setBaselineMode: (v: "pre_first_inj" | "none") => void;
  // fitKa/fitKd/fitRmax: true = let the optimizer vary this parameter;
  // false = hold it at its *Fixed value instead (see kaFixed etc. below).
  fitKa: boolean;
  setFitKa: (v: boolean) => void;
  fitKd: boolean;
  setFitKd: (v: boolean) => void;
  fitRmax: boolean;
  setFitRmax: (v: boolean) => void;
  // Optional min/max bounds, only applied when non-empty; ignored entirely
  // when the corresponding fit* flag above is false (the fixed value wins).
  kaBounds: BoundsPair;
  setKaBounds: (v: BoundsPair) => void;
  kdBounds: BoundsPair;
  setKdBounds: (v: BoundsPair) => void;
  rmaxBounds: BoundsPair;
  setRmaxBounds: (v: BoundsPair) => void;
  // Value used when the matching fit* flag is false. Defaults (1e5, 1e-3,
  // 100) are plausible starting guesses, not meaningful "off" values.
  kaFixed: string;
  setKaFixed: (v: string) => void;
  kdFixed: string;
  setKdFixed: (v: string) => void;
  rmaxFixed: string;
  setRmaxFixed: (v: string) => void;
  // 0 disables bootstrap CI entirely; App.tsx floors any enabled value to
  // 50 before sending it.
  bootstrapN: number;
  setBootstrapN: (v: number) => void;
  bootstrapSeed: string;
  setBootstrapSeed: (v: string) => void;
  // Raw, possibly-incomplete rows as the user is typing; excludesJson below
  // is the filtered, validated, backend-ready derivation of this list.
  excludeRows: ExcludeRow[];
  addExcludeRow: () => void;
  removeExcludeRow: (i: number) => void;
  updateExcludeRow: (i: number, field: keyof ExcludeRow, v: string) => void;
  // JSON-encoded array of valid {start, stop} windows, or "" if none are
  // valid yet — see the derivation below for exactly what counts as valid.
  excludesJson: string;
};

export function useFitOptions(): UseFitOptionsResult {
  const [repFitMode, setRepFitMode] = useState<"per_rep" | "global">("per_rep");
  const [shareRmax, setShareRmax] = useState<boolean>(true);
  const [shareBulk, setShareBulk] = useState<boolean>(true);
  const [enableBulk, setEnableBulk] = useState<boolean>(true);
  const [robustLoss, setRobustLoss] = useState<"soft_l1" | "linear" | "huber">("soft_l1");
  const [baselineMode, setBaselineMode] = useState<"pre_first_inj" | "none">("pre_first_inj");
  const [fitKa, setFitKa] = useState(true);
  const [fitKd, setFitKd] = useState(true);
  const [fitRmax, setFitRmax] = useState(true);
  const [kaBounds, setKaBounds] = useState<BoundsPair>({ min: "", max: "" });
  const [kdBounds, setKdBounds] = useState<BoundsPair>({ min: "", max: "" });
  const [rmaxBounds, setRmaxBounds] = useState<BoundsPair>({ min: "", max: "" });
  const [kaFixed, setKaFixed] = useState<string>("1e5");
  const [kdFixed, setKdFixed] = useState<string>("1e-3");
  const [rmaxFixed, setRmaxFixed] = useState<string>("100");
  const [bootstrapN, setBootstrapN] = useState<number>(0);
  const [bootstrapSeed, setBootstrapSeed] = useState<string>("");
  const [excludeRows, setExcludeRows] = useState<ExcludeRow[]>([]);

  const addExcludeRow = () => {
    setExcludeRows((prev) => [...prev, { start: "", stop: "" }]);
  };

  const removeExcludeRow = (i: number) => {
    setExcludeRows((prev) => prev.filter((_, idx) => idx !== i));
  };

  const updateExcludeRow = (i: number, field: keyof ExcludeRow, v: string) => {
    setExcludeRows((prev) => prev.map((row, idx) => (idx === i ? { ...row, [field]: v } : row)));
  };

  // Silently drops incomplete/invalid rows (empty fields, non-numeric text,
  // or stop <= start) rather than blocking the fit on a row the user hasn't
  // finished typing yet. A row that never becomes valid is just never sent
  // to the backend — there's no separate error state for this field.
  const excludesJson = useMemo(() => {
    const valid = excludeRows.filter((r) => {
      const s = Number(r.start);
      const e = Number(r.stop);
      return Number.isFinite(s) && Number.isFinite(e) && r.start.trim() !== "" && r.stop.trim() !== "" && e > s;
    });
    if (!valid.length) return "";
    return JSON.stringify(valid.map((r) => ({ start: Number(r.start), stop: Number(r.stop) })));
  }, [excludeRows]);

  return {
    repFitMode,
    setRepFitMode,
    shareRmax,
    setShareRmax,
    shareBulk,
    setShareBulk,
    enableBulk,
    setEnableBulk,
    robustLoss,
    setRobustLoss,
    baselineMode,
    setBaselineMode,
    fitKa,
    setFitKa,
    fitKd,
    setFitKd,
    fitRmax,
    setFitRmax,
    kaBounds,
    setKaBounds,
    kdBounds,
    setKdBounds,
    rmaxBounds,
    setRmaxBounds,
    kaFixed,
    setKaFixed,
    kdFixed,
    setKdFixed,
    rmaxFixed,
    setRmaxFixed,
    bootstrapN,
    setBootstrapN,
    bootstrapSeed,
    setBootstrapSeed,
    excludeRows,
    addExcludeRow,
    removeExcludeRow,
    updateExcludeRow,
    excludesJson,
  };
}
