import { useState, useMemo } from "react";

export type BoundsPair = { min: string; max: string };

export type ExcludeRow = { start: string; stop: string };

export type UseFitOptionsResult = {
  repFitMode: "per_rep" | "global";
  setRepFitMode: (v: "per_rep" | "global") => void;
  enableDrift: boolean;
  setEnableDrift: (v: boolean) => void;
  enableBulk: boolean;
  setEnableBulk: (v: boolean) => void;
  robustLoss: "soft_l1" | "linear" | "huber";
  setRobustLoss: (v: "soft_l1" | "linear" | "huber") => void;
  baselineMode: "pre_first_inj" | "none";
  setBaselineMode: (v: "pre_first_inj" | "none") => void;
  fitKa: boolean;
  setFitKa: (v: boolean) => void;
  fitKd: boolean;
  setFitKd: (v: boolean) => void;
  fitRmax: boolean;
  setFitRmax: (v: boolean) => void;
  fitDrift: boolean;
  setFitDrift: (v: boolean) => void;
  kaBounds: BoundsPair;
  setKaBounds: (v: BoundsPair) => void;
  kdBounds: BoundsPair;
  setKdBounds: (v: BoundsPair) => void;
  rmaxBounds: BoundsPair;
  setRmaxBounds: (v: BoundsPair) => void;
  driftBounds: BoundsPair;
  setDriftBounds: (v: BoundsPair) => void;
  kaFixed: string;
  setKaFixed: (v: string) => void;
  kdFixed: string;
  setKdFixed: (v: string) => void;
  rmaxFixed: string;
  setRmaxFixed: (v: string) => void;
  driftFixed: string;
  setDriftFixed: (v: string) => void;
  bootstrapN: number;
  setBootstrapN: (v: number) => void;
  bootstrapSeed: string;
  setBootstrapSeed: (v: string) => void;
  excludeRows: ExcludeRow[];
  addExcludeRow: () => void;
  removeExcludeRow: (i: number) => void;
  updateExcludeRow: (i: number, field: keyof ExcludeRow, v: string) => void;
  excludesJson: string;
};

export function useFitOptions(): UseFitOptionsResult {
  const [repFitMode, setRepFitMode] = useState<"per_rep" | "global">("per_rep");
  const [enableDrift, setEnableDrift] = useState<boolean>(false);
  const [enableBulk, setEnableBulk] = useState<boolean>(true);
  const [robustLoss, setRobustLoss] = useState<"soft_l1" | "linear" | "huber">("soft_l1");
  const [baselineMode, setBaselineMode] = useState<"pre_first_inj" | "none">("pre_first_inj");
  const [fitKa, setFitKa] = useState(true);
  const [fitKd, setFitKd] = useState(true);
  const [fitRmax, setFitRmax] = useState(true);
  const [fitDrift, setFitDrift] = useState(true);
  const [kaBounds, setKaBounds] = useState<BoundsPair>({ min: "", max: "" });
  const [kdBounds, setKdBounds] = useState<BoundsPair>({ min: "", max: "" });
  const [rmaxBounds, setRmaxBounds] = useState<BoundsPair>({ min: "", max: "" });
  const [driftBounds, setDriftBounds] = useState<BoundsPair>({ min: "", max: "" });
  const [kaFixed, setKaFixed] = useState<string>("1e5");
  const [kdFixed, setKdFixed] = useState<string>("1e-3");
  const [rmaxFixed, setRmaxFixed] = useState<string>("100");
  const [driftFixed, setDriftFixed] = useState<string>("0");
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

  const excludesJson = useMemo(() => {
    const valid = excludeRows.filter((r) => {
      const s = Number(r.start);
      const e = Number(r.stop);
      return Number.isFinite(s) && Number.isFinite(e) && r.start.trim() !== "" && r.stop.trim() !== "";
    });
    if (!valid.length) return "";
    return JSON.stringify(valid.map((r) => ({ start: Number(r.start), stop: Number(r.stop) })));
  }, [excludeRows]);

  return {
    repFitMode,
    setRepFitMode,
    enableDrift,
    setEnableDrift,
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
    fitDrift,
    setFitDrift,
    kaBounds,
    setKaBounds,
    kdBounds,
    setKdBounds,
    rmaxBounds,
    setRmaxBounds,
    driftBounds,
    setDriftBounds,
    kaFixed,
    setKaFixed,
    kdFixed,
    setKdFixed,
    rmaxFixed,
    setRmaxFixed,
    driftFixed,
    setDriftFixed,
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
