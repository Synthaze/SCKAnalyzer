import React, { useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import Plotly from "plotly.js-dist-min";
import JSZip from "jszip";
import type { FitResult } from "../types";
import type { UseFitOptionsResult } from "../hooks/useFitOptions";
import { formatConc, formatCiFromSe, formatKD } from "../lib/format";
import { downloadPlotPng, downloadText, dataUrlToBlob } from "../lib/export";
import { buildConcColorScale, extractSegment, buildOverlapCsv, buildOverlapPhaseCsv } from "../lib/steps";
import HelpTip from "./HelpTip";

// Palette for replicates — distinct, accessible
const REP_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2"];
const repColor = (i: number) => REP_COLORS[i % REP_COLORS.length];

// Renders known parameter labels with a proper subscript (ka -> k_a, KD -> K_D, ...).
// Plain-text labels used elsewhere (CSV export) are untouched — this is display-only.
const SUBSCRIPT_LABELS: Record<string, React.ReactNode> = {
  ka: <>k<sub>a</sub></>,
  kd: <>k<sub>d</sub></>,
  kt: <>k<sub>t</sub></>,
  KD: <>K<sub>D</sub></>,
  Rmax: <>R<sub>max</sub></>,
};
const subscriptLabel = (label: string): React.ReactNode => SUBSCRIPT_LABELS[label] ?? label;

type Props = {
  fitOptions: UseFitOptionsResult;
  runFit: () => void;
  canFit: boolean;
  fits: FitResult[];
  stepsForShading: Array<{ start: number; stop: number; C: number }>;
  refCol: string;
  injectionSteps: Array<{ start: number; stop: number; C: number }>;
};

function mean(vals: number[]) { return vals.reduce((a, b) => a + b, 0) / vals.length; }
function sampleSd(vals: number[]) {
  if (vals.length < 2) return null;
  const m = mean(vals);
  return Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / (vals.length - 1));
}
function summarize(vals: number[], fmt: (v: number) => string) {
  const finite = vals.filter(Number.isFinite);
  if (!finite.length) return { mean: null, sd: null };
  const m = mean(finite);
  const sd = sampleSd(finite);
  return { mean: fmt(m), sd: sd !== null ? fmt(sd) : null };
}

export default function FitResultsSection({
  fitOptions, runFit, canFit, fits,
  stepsForShading, refCol, injectionSteps,
}: Props) {
  const [overlapNormalize, setOverlapNormalize] = useState(true);
  const [overlapBaseline, setOverlapBaseline] = useState<"data" | "fit">("data");
  const [overlapShowLegend, setOverlapShowLegend] = useState(true);
  // Which replicate to inspect for overlap / detail exports
  const [selectedRepIdx, setSelectedRepIdx] = useState(0);

  const fitDivRef      = useRef<Plotly.PlotlyHTMLElement | null>(null);
  const residDivRef    = useRef<Plotly.PlotlyHTMLElement | null>(null);
  const overlapAssocDivRef = useRef<Plotly.PlotlyHTMLElement | null>(null);
  const overlapDissDivRef  = useRef<Plotly.PlotlyHTMLElement | null>(null);

  const {
    repFitMode, setRepFitMode,
    shareRmax, setShareRmax,
    shareBulk, setShareBulk,
    baselineMode, setBaselineMode,
    robustLoss, setRobustLoss,
    enableBulk, setEnableBulk,
    fitKa, setFitKa, fitKd, setFitKd, fitRmax, setFitRmax,
    kaBounds, setKaBounds, kdBounds, setKdBounds, rmaxBounds, setRmaxBounds,
    kaFixed, setKaFixed, kdFixed, setKdFixed, rmaxFixed, setRmaxFixed,
    bootstrapN, setBootstrapN, bootstrapSeed, setBootstrapSeed,
  } = fitOptions;

  const isGlobalFit = fits.length > 0 && fits[0].fit_mode === "global";
  // Reflects what the *displayed* results actually did, not the live toggle
  // (which may have changed since this fit was run).
  const rmaxSharedInFit = isGlobalFit && fits.every(f => f.params.Rmax === fits[0].params.Rmax);
  // Global fit always shares ka/kd; when Rmax is shared too, every replicate
  // row would be identical, so the parameters table collapses to one row.
  const showSingleGlobalRow = isGlobalFit && rmaxSharedInFit;

  const hasMultiRep = fits.length > 1;
  const activeFit   = fits[Math.min(selectedRepIdx, fits.length - 1)] ?? null;

  // ── Shared layout pieces ──────────────────────────
  const baseLayout = useMemo(() => ({
    margin: { l: 55, r: 10, t: 45, b: 45 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    shapes: stepsForShading.map((s) => ({
      type: "rect", xref: "x", yref: "paper",
      x0: s.start, x1: s.stop, y0: 0, y1: 1,
      fillcolor: "rgba(30,79,140,0.08)", line: { width: 0 },
    })),
  }), [stepsForShading]);

  const fitLayout = useMemo(() => ({
    ...baseLayout,
    legend: { orientation: "h" as const, y: -0.3, yanchor: "top", x: 0, xanchor: "left" },
    xaxis: { title: { text: "Time (s)" }, automargin: true },
    yaxis: {
      title: { text: "Response" },
      automargin: true,
    },
  }), [baseLayout]);

  const residLayout = {
    margin: { l: 55, r: 10, t: 45, b: 45 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    legend: { orientation: "h" as const, y: -0.3, yanchor: "top", x: 0, xanchor: "left" },
    xaxis: { title: { text: "Time (s)" }, automargin: true },
    yaxis: { title: { text: "Response" }, automargin: true },
  };

  const overlapAssocLayout = {
    margin: { l: 55, r: 10, t: 45, b: 90 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    showlegend: overlapShowLegend,
    legend: { orientation: "h" as const, y: -0.35, yanchor: "top", x: 0, xanchor: "left" },
    xaxis: { title: { text: "Time since association start (s)" }, automargin: true },
    yaxis: { title: { text: overlapNormalize ? "ΔResponse" : "Response" }, automargin: true },
  };

  const overlapDissLayout = {
    margin: { l: 55, r: 10, t: 45, b: 90 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    showlegend: overlapShowLegend,
    legend: { orientation: "h" as const, y: -0.35, yanchor: "top", x: 0, xanchor: "left" },
    xaxis: { title: { text: "Time since dissociation start (s)" }, automargin: true },
    yaxis: { title: { text: overlapNormalize ? "ΔResponse" : "Response" }, automargin: true },
  };

  // ── Combined fit + residuals plot data ────────────
  const combinedFitData = useMemo<Plotly.Data[]>(() => {
    if (!hasMultiRep && fits[0]) {
      const f = fits[0];
      return [
        { x: f.series.t, y: f.series.y,    type: "scatter", mode: "lines", name: "Data", line: { color: "#2563eb", width: 1.5 } },
        { x: f.series.t, y: f.series.yhat, type: "scatter", mode: "lines", name: "Fit",  line: { color: "#000000", width: 1.0 } },
      ];
    }
    if (isGlobalFit) {
      // All yhat are identical — show one fit curve + N data traces
      const dataTraces: Plotly.Data[] = fits.map((f, ri) => ({
        x: f.series.t, y: f.series.y,
        type: "scatter", mode: "lines",
        name: `Rep ${ri + 1} data`,
        line: { color: repColor(ri), width: 1.75 },
        opacity: 0.7,
      }));
      const fitTrace: Plotly.Data = {
        x: fits[0].series.t, y: fits[0].series.yhat,
        type: "scatter", mode: "lines",
        name: "Global fit",
        line: { color: "#000000", width: 1.0 },
      };
      return [...dataTraces, fitTrace];
    }
    // Per-replicate mode with multiple replicates: show only the selected
    // replicate (switched via the Rep N buttons), styled like the global
    // fit plot — plain colored data line, black fit line — instead of
    // overlaying every replicate at once.
    const f = fits[Math.min(selectedRepIdx, fits.length - 1)];
    if (!f) return [];
    return [
      {
        x: f.series.t, y: f.series.y,
        type: "scatter", mode: "lines",
        name: `Rep ${selectedRepIdx + 1} data`,
        line: { color: repColor(selectedRepIdx), width: 1.75 },
      },
      {
        x: f.series.t, y: f.series.yhat,
        type: "scatter", mode: "lines",
        name: `Rep ${selectedRepIdx + 1} fit`,
        line: { color: "#000000", width: 1.0 },
      },
    ];
  }, [fits, hasMultiRep, isGlobalFit, selectedRepIdx]);

  const combinedResidData = useMemo<Plotly.Data[]>(() => {
    if (!hasMultiRep && fits[0]) {
      const f = fits[0];
      return [{ x: f.series.t, y: f.series.residual, type: "scatter", mode: "lines", name: "Residual", line: { color: "#7c3aed" } }];
    }
    if (!isGlobalFit) {
      const f = fits[Math.min(selectedRepIdx, fits.length - 1)];
      if (!f) return [];
      return [{
        x: f.series.t, y: f.series.residual,
        type: "scatter", mode: "lines",
        name: `Rep ${selectedRepIdx + 1}`,
        line: { color: repColor(selectedRepIdx), width: 1.5 },
      }];
    }
    return fits.map((f, ri) => ({
      x: f.series.t, y: f.series.residual,
      type: "scatter", mode: "lines",
      name: `Rep ${ri + 1}`,
      line: { color: repColor(ri), width: 1.5 },
    }));
  }, [fits, hasMultiRep, isGlobalFit, selectedRepIdx]);

  // ── Overlap for the selected replicate ───────────
  const overlapSeries = useMemo(() => {
    if (!activeFit || injectionSteps.length === 0) return null;
    const { t, y, yhat } = activeFit.series;
    const colors = buildConcColorScale(injectionSteps);
    const assoc: Array<{ x: number[]; y: number[]; name: string; dashed?: boolean; color: string }> = [];
    const dissoc: typeof assoc = [];
    const tEnd = t.length > 0 ? t[t.length - 1] : 0;

    for (let i = 0; i < injectionSteps.length; i++) {
      const inj = injectionSteps[i];
      const color = colors[i] || "hsl(210,70%,55%)";
      const baseSource = overlapBaseline === "fit" ? yhat : y;
      const baseAssoc = extractSegment(t, baseSource, inj.start, inj.stop, overlapNormalize);
      const assocBaseline = baseAssoc?.baseline;
      const aData = extractSegment(t, y,    inj.start, inj.stop, overlapNormalize, assocBaseline);
      const aFit  = extractSegment(t, yhat, inj.start, inj.stop, overlapNormalize, assocBaseline);
      if (aData) assoc.push({ ...aData, name: `Inj ${i+1} data (${formatConc(inj.C)})`, color });
      if (aFit)  assoc.push({ ...aFit,  name: `Inj ${i+1} fit (${formatConc(inj.C)})`,  dashed: true, color });

      const nextStart = i < injectionSteps.length - 1 ? injectionSteps[i+1].start : tEnd;
      if (nextStart > inj.stop) {
        const baseDiss = extractSegment(t, baseSource, inj.stop, nextStart, overlapNormalize);
        const dissBaseline = baseDiss?.baseline;
        const dData = extractSegment(t, y,    inj.stop, nextStart, overlapNormalize, dissBaseline);
        const dFit  = extractSegment(t, yhat, inj.stop, nextStart, overlapNormalize, dissBaseline);
        if (dData) dissoc.push({ ...dData, name: `Inj ${i+1} data (${formatConc(inj.C)})`, color });
        if (dFit)  dissoc.push({ ...dFit,  name: `Inj ${i+1} fit (${formatConc(inj.C)})`,  dashed: true, color });
      }
    }
    return { assoc, dissoc };
  }, [activeFit, injectionSteps, overlapNormalize, overlapBaseline]);

  const overlapRmse = useMemo(() => {
    if (!activeFit || injectionSteps.length === 0) return [];
    const { t, y, yhat } = activeFit.series;
    const tEnd = t.length > 0 ? t[t.length - 1] : 0;
    const rows: Array<{ inj: number; phase: string; rmse: number | null; C: number }> = [];
    const calcRmse = (s: number, e: number) => {
      let sum = 0, n = 0;
      for (let i = 0; i < t.length; i++) {
        if (t[i] >= s && t[i] <= e) { sum += (yhat[i] - y[i]) ** 2; n++; }
      }
      return n > 1 ? Math.sqrt(sum / n) : null;
    };
    for (let i = 0; i < injectionSteps.length; i++) {
      const inj = injectionSteps[i];
      rows.push({ inj: i+1, phase: "assoc", rmse: calcRmse(inj.start, inj.stop), C: inj.C });
      const nextStart = i < injectionSteps.length - 1 ? injectionSteps[i+1].start : tEnd;
      if (nextStart > inj.stop)
        rows.push({ inj: i+1, phase: "dissoc", rmse: calcRmse(inj.stop, nextStart), C: inj.C });
    }
    return rows;
  }, [activeFit, injectionSteps]);

  // ── CSV exports ───────────────────────────────────
  const buildParamsCsv = (fit: FitResult, repLabel?: string) => {
    const ci = fit.bootstrap?.ci95 ?? {};
    const prefix = repLabel ? `${repLabel},` : "";
    const header = repLabel
      ? ["replicate", "param", "value", "unit", "se", "ci95_low", "ci95_high"]
      : ["param", "value", "unit", "se", "ci95_low", "ci95_high"];
    const rows = [header.join(",")];
    const add = (param: string, val: string, unit: string, se: string, ciLow: string, ciHigh: string) =>
      rows.push([prefix + param, val, unit, se, ciLow, ciHigh].join(","));
    const kaLogSe = fit.standard_errors?.log10_ka;
    add("ka", fit.params.ka.toExponential(4), "1_per_M_s",
      kaLogSe !== undefined ? (fit.params.ka * Math.LN10 * kaLogSe).toExponential(3) : "",
      ci["ka"] ? ci["ka"][0].toExponential(3) : "", ci["ka"] ? ci["ka"][1].toExponential(3) : "");
    const kdLogSe = fit.standard_errors?.log10_kd;
    add("kd", fit.params.kd.toExponential(4), "1_per_s",
      kdLogSe !== undefined ? (fit.params.kd * Math.LN10 * kdLogSe).toExponential(3) : "",
      ci["kd"] ? ci["kd"][0].toExponential(3) : "", ci["kd"] ? ci["kd"][1].toExponential(3) : "");
    const seKDLog = kaLogSe !== undefined && kdLogSe !== undefined
      ? fit.params.KD * Math.LN10 * Math.sqrt(kaLogSe ** 2 + kdLogSe ** 2) : null;
    add("KD", fit.params.KD.toExponential(4), "M",
      seKDLog !== null ? seKDLog.toExponential(3) : "",
      ci["KD"] ? ci["KD"][0].toExponential(3) : "", ci["KD"] ? ci["KD"][1].toExponential(3) : "");
    add("Rmax", fit.params.Rmax.toExponential(4), "RU",
      fit.standard_errors?.Rmax?.toExponential(3) ?? "",
      ci["Rmax"] ? ci["Rmax"][0].toExponential(3) : "", ci["Rmax"] ? ci["Rmax"][1].toExponential(3) : "");
    return rows.join("\n");
  };

  const allParamsCsv = useMemo(() => {
    if (!fits.length) return "";
    return fits.map((f, ri) => buildParamsCsv(f, fits.length > 1 ? `Rep ${ri+1}` : undefined)).join("\n\n");
  }, [fits]);

  // Exports mirror what's actually on screen: in per-replicate mode with the
  // Rep N switcher, only the currently-displayed replicate is exported;
  // global fit (and single-replicate) exports still cover every replicate,
  // since those plots always show all of them at once.
  const displayedFits = useMemo(() => {
    if (hasMultiRep && !isGlobalFit) {
      const f = fits[Math.min(selectedRepIdx, fits.length - 1)];
      return f ? [{ f, ri: selectedRepIdx }] : [];
    }
    return fits.map((f, ri) => ({ f, ri }));
  }, [fits, hasMultiRep, isGlobalFit, selectedRepIdx]);

  // Side-by-side (wide) layout: each replicate gets its own block of columns
  // rather than being appended as extra rows, so series line up for
  // spreadsheet comparison. Replicates with fewer points are blank-padded.
  const allFitCsv = useMemo(() => {
    if (!displayedFits.length) return "";
    const labels = displayedFits.map(({ ri }) => (fits.length > 1 ? `Rep ${ri + 1}` : "Value"));
    const maxLen = Math.max(...displayedFits.map(({ f }) => f.series.t.length));
    const header = displayedFits.flatMap((_, i) => [`${labels[i]}_time_s`, `${labels[i]}_data_ru`, `${labels[i]}_fit_ru`]).join(",");
    const rows = [header];
    for (let i = 0; i < maxLen; i++) {
      const cells = displayedFits.flatMap(({ f }) =>
        i < f.series.t.length
          ? [String(f.series.t[i]), String(f.series.y[i]), String(f.series.yhat[i])]
          : ["", "", ""]
      );
      rows.push(cells.join(","));
    }
    return rows.join("\n");
  }, [displayedFits, fits.length]);

  const allResidCsv = useMemo(() => {
    if (!displayedFits.length) return "";
    const labels = displayedFits.map(({ ri }) => (fits.length > 1 ? `Rep ${ri + 1}` : "Value"));
    const maxLen = Math.max(...displayedFits.map(({ f }) => f.series.t.length));
    const header = displayedFits.flatMap((_, i) => [`${labels[i]}_time_s`, `${labels[i]}_residual_ru`]).join(",");
    const rows = [header];
    for (let i = 0; i < maxLen; i++) {
      const cells = displayedFits.flatMap(({ f }) =>
        i < f.series.t.length
          ? [String(f.series.t[i]), String(f.series.residual[i])]
          : ["", ""]
      );
      rows.push(cells.join(","));
    }
    return rows.join("\n");
  }, [displayedFits, fits.length]);

  const rmseCsv = useMemo(() => {
    if (!overlapRmse.length) return "";
    return ["inj,phase,conc,rmse,unit",
      ...overlapRmse.map(r => [`Inj ${r.inj}`, r.phase, formatConc(r.C), r.rmse !== null ? r.rmse.toFixed(4) : "—", "RU"].join(","))
    ].join("\n");
  }, [overlapRmse]);

  // ── Parameters table helpers ──────────────────────
  const fmtSe = (fit: FitResult) => {
    const ka  = fit.standard_errors?.log10_ka !== undefined  ? (fit.params.ka  * Math.LN10 * fit.standard_errors.log10_ka ).toExponential(3) : null;
    const kd  = fit.standard_errors?.log10_kd !== undefined  ? (fit.params.kd  * Math.LN10 * fit.standard_errors.log10_kd ).toExponential(3) : null;
    const kaLogSe = fit.standard_errors?.log10_ka;
    const kdLogSe = fit.standard_errors?.log10_kd;
    const KD  = kaLogSe !== undefined && kdLogSe !== undefined
      ? (fit.params.KD * Math.LN10 * Math.sqrt(kaLogSe**2 + kdLogSe**2)).toExponential(3) : null;
    const Rmax = fit.standard_errors?.Rmax?.toExponential(3) ?? null;
    return { ka, kd, KD, Rmax };
  };

  return (
    <>
    <div className="card">
      <h3>Fit parameters</h3>

      {/* Run button + mode selector */}
      <div className="row" style={{ marginBottom: 10 }}>
        <button onClick={runFit} className="primary" disabled={!canFit}>Run fit</button>
        <div className="row" style={{ gap: 4 }}>
          <button className={repFitMode === "per_rep" ? "primary" : "secondary"} style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setRepFitMode("per_rep")}>Per replicate<HelpTip text="Each replicate is fitted independently. Results are shown per replicate and summarised as Mean ± SD." /></button>
          <button className={repFitMode === "global" ? "primary" : "secondary"} style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setRepFitMode("global")}>
            Global (shared {subscriptLabel("ka")}/{subscriptLabel("kd")})
            <HelpTip text={shareRmax
              ? "A single ka, kd, and Rmax are fitted simultaneously across all replicates; only bulk offsets (if enabled) are fitted per replicate. Produces more constrained, statistically robust rate estimates."
              : "A single ka and kd are fitted simultaneously across all replicates, but each replicate gets its own independently fitted Rmax (useful when surface capacity genuinely differs between replicates even though the kinetics are the same); bulk offsets (if enabled) are also fitted per replicate."} />
          </button>
        </div>
        <span className="muted">{canFit ? "Ready to fit." : "Define injection steps first (tab 3)."}</span>
      </div>

      {/* Advanced options */}
      <details style={{ marginBottom: 12 }}>
        <summary className="muted" style={{ cursor: "pointer" }}>Advanced options</summary>
        <div className="row" style={{ marginTop: 10 }}>
          {repFitMode === "global" && (
            <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={shareRmax} onChange={(e) => setShareRmax(e.target.checked)} />
              <span className="muted">Share {subscriptLabel("Rmax")} across replicates</span>
              <HelpTip text="On: a single Rmax is fitted across all replicates, like ka/kd. Off: each replicate gets its own independently fitted Rmax." />
            </label>
          )}
          <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={enableBulk} onChange={(e) => setEnableBulk(e.target.checked)} />
            <span className="muted">Fit bulk offsets</span>
            <HelpTip text="Fits an independent baseline offset for each injection segment to account for bulk refractive index shifts at injection transitions." />
          </label>
          {repFitMode === "global" && enableBulk && (
            <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={shareBulk} onChange={(e) => setShareBulk(e.target.checked)} />
              <span className="muted">Share bulk offsets per injection across replicates</span>
              <HelpTip text="On: one bulk offset per injection is fitted and shared across all replicates, like ka/kd. Off: each replicate gets its own independently fitted set of bulk offsets." />
            </label>
          )}
        </div>
        <div style={{ marginTop: 10 }}>
          <label>
            Baseline mode
            <select value={baselineMode} onChange={(e) => setBaselineMode(e.target.value as "pre_first_inj" | "none")}>
              <option value="pre_first_inj">Subtract median before first injection</option>
              <option value="none">None</option>
            </select>
          </label>
        </div>
        <div style={{ marginTop: 10 }}>
          <label>
            <span>Robust loss<HelpTip text="Loss function for the optimizer. soft_l1 reduces the influence of large outliers (e.g. spikes). linear = ordinary least squares. huber is intermediate." /></span>
            <select value={robustLoss} onChange={(e) => setRobustLoss(e.target.value as "soft_l1" | "linear" | "huber")}>
              <option value="soft_l1">soft_l1 (recommended)</option>
              <option value="linear">linear</option>
              <option value="huber">huber</option>
            </select>
          </label>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="muted" style={{ marginBottom: 6 }}>Parameter selection and bounds</div>
          <table className="result-table">
            <thead><tr><th>Parameter</th><th>Fit?</th><th>Fixed value</th><th>Min</th><th>Max</th></tr></thead>
            <tbody>
              <tr>
                <th>{subscriptLabel("ka")} <span className="unit" style={{ fontWeight: 400 }}>(1/M·s)</span></th>
                <td><input type="checkbox" checked={fitKa} onChange={(e) => setFitKa(e.target.checked)} /></td>
                <td><input type="text" inputMode="decimal" value={kaFixed} onChange={(e) => setKaFixed(e.target.value)} disabled={fitKa} /></td>
                <td><input type="text" value={kaBounds.min} onChange={(e) => setKaBounds({ ...kaBounds, min: e.target.value })} /></td>
                <td><input type="text" value={kaBounds.max} onChange={(e) => setKaBounds({ ...kaBounds, max: e.target.value })} /></td>
              </tr>
              <tr>
                <th>{subscriptLabel("kd")} <span className="unit" style={{ fontWeight: 400 }}>(1/s)</span></th>
                <td><input type="checkbox" checked={fitKd} onChange={(e) => setFitKd(e.target.checked)} /></td>
                <td><input type="text" inputMode="decimal" value={kdFixed} onChange={(e) => setKdFixed(e.target.value)} disabled={fitKd} /></td>
                <td><input type="text" value={kdBounds.min} onChange={(e) => setKdBounds({ ...kdBounds, min: e.target.value })} /></td>
                <td><input type="text" value={kdBounds.max} onChange={(e) => setKdBounds({ ...kdBounds, max: e.target.value })} /></td>
              </tr>
              <tr>
                <th>{subscriptLabel("Rmax")} <span className="unit" style={{ fontWeight: 400 }}>(RU)</span></th>
                <td><input type="checkbox" checked={fitRmax} onChange={(e) => setFitRmax(e.target.checked)} /></td>
                <td><input type="text" inputMode="decimal" value={rmaxFixed} onChange={(e) => setRmaxFixed(e.target.value)} disabled={fitRmax} /></td>
                <td><input type="text" value={rmaxBounds.min} onChange={(e) => setRmaxBounds({ ...rmaxBounds, min: e.target.value })} /></td>
                <td><input type="text" value={rmaxBounds.max} onChange={(e) => setRmaxBounds({ ...rmaxBounds, max: e.target.value })} /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={bootstrapN > 0} onChange={(e) => setBootstrapN(e.target.checked ? Math.max(50, bootstrapN || 0) : 0)} />
            <span className="muted">Bootstrap 95% CIs</span>
            <HelpTip text="Estimates confidence intervals by resampling residuals and refitting many times (N iterations). More reliable than SE-based CIs for non-linear models, but slower." />
          </label>
          <label>
            N
            <input
              key={bootstrapN}
              type="text"
              inputMode="numeric"
              defaultValue={bootstrapN}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setBootstrapN(Math.max(0, Math.floor(v)));
              }}
              style={{ width: 100 }} disabled={bootstrapN === 0}
            />
          </label>
          <label>
            Seed (optional)
            <input type="text" value={bootstrapSeed} onChange={(e) => setBootstrapSeed(e.target.value)}
              placeholder="e.g. 123" style={{ width: 100 }} disabled={bootstrapN === 0} />
          </label>
        </div>
      </details>

      {fits.length === 0 && <div className="muted">Run a fit to see results.</div>}
    </div>

    {/* ── Plots card ── */}
    {fits.length > 0 && (
      <div className="card">
          <div className="plots">
            {hasMultiRep && !isGlobalFit && (
              <div className="row" style={{ gap: 4, marginBottom: 8 }}>
                {fits.map((_, ri) => (
                  <button key={ri}
                    className={selectedRepIdx === ri ? "primary" : "secondary"}
                    style={{ padding: "2px 10px", fontSize: 11 }}
                    onClick={() => setSelectedRepIdx(ri)}>
                    Rep {ri + 1}
                  </button>
                ))}
              </div>
            )}
            <Plot
              data={combinedFitData}
              layout={{ ...fitLayout, title: { text: hasMultiRep ? (isGlobalFit ? `Global Fit (shared k<sub>a</sub>/k<sub>d</sub>${rmaxSharedInFit ? "/R<sub>max</sub>" : ""}) — all replicates` : `Fit — Rep ${selectedRepIdx + 1}`) : "Fit (Data + Model)", font: { color: "#1c1916", size: 14 } } } as any}
              style={{ width: "100%", height: "380px" }}
              useResizeHandler
              config={{ responsive: true, displaylogo: false }}
              onInitialized={(_: any, div: HTMLElement) => { fitDivRef.current = div as Plotly.PlotlyHTMLElement; }}
              onUpdate={(_: any, div: HTMLElement) => { fitDivRef.current = div as Plotly.PlotlyHTMLElement; }}
            />
            <div className="row">
              <button className="secondary" onClick={() => downloadPlotPng(fitDivRef.current, "sckanalyzer-fit.png")}>Export PNG</button>
              <button className="secondary" onClick={() => allFitCsv && downloadText("sckanalyzer-fit.csv", allFitCsv)} disabled={!allFitCsv}>Export CSV</button>
            </div>
            <Plot
              data={combinedResidData}
              layout={{ ...residLayout, title: { text: hasMultiRep ? (isGlobalFit ? "Residuals — all replicates" : `Residuals — Rep ${selectedRepIdx + 1}`) : "Residuals", font: { color: "#1c1916", size: 14 } } } as any}
              style={{ width: "100%", height: "260px" }}
              useResizeHandler
              config={{ responsive: true, displaylogo: false }}
              onInitialized={(_: any, div: HTMLElement) => { residDivRef.current = div as Plotly.PlotlyHTMLElement; }}
              onUpdate={(_: any, div: HTMLElement) => { residDivRef.current = div as Plotly.PlotlyHTMLElement; }}
            />
            <div className="row">
              <button className="secondary" onClick={() => downloadPlotPng(residDivRef.current, "sckanalyzer-residuals.png")}>Export PNG</button>
              <button className="secondary" onClick={() => allResidCsv && downloadText("sckanalyzer-residuals.csv", allResidCsv)} disabled={!allResidCsv}>Export CSV</button>
            </div>
          </div>

          <details className="accordion-accent" style={{ marginTop: 16 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 15, color: "var(--text)" }}>
              <span className="accordion-chevron">▸</span>
              Association &amp; dissociation overlap{hasMultiRep ? ` — Rep ${selectedRepIdx + 1}` : ""}
            </summary>
            <div className="row" style={{ marginTop: 10, marginBottom: 8 }}>
              {hasMultiRep && fits.map((_, ri) => (
                <button key={ri}
                  className={selectedRepIdx === ri ? "primary" : "secondary"}
                  style={{ padding: "2px 10px", fontSize: 11 }}
                  onClick={() => setSelectedRepIdx(ri)}>
                  Rep {ri + 1}
                </button>
              ))}
              <label style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={overlapNormalize} onChange={(e) => setOverlapNormalize(e.target.checked)} />
                Normalize (ΔRU)
              </label>
              <label style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <span className="muted">Baseline</span>
                <select value={overlapBaseline} onChange={(e) => setOverlapBaseline(e.target.value as "data" | "fit")}>
                  <option value="data">Data</option>
                  <option value="fit">Fit</option>
                </select>
              </label>
              <label style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={overlapShowLegend} onChange={(e) => setOverlapShowLegend(e.target.checked)} />
                Legend
              </label>
            </div>

            {overlapSeries && overlapSeries.assoc.length > 0 && (
              <>
                <Plot
                  data={overlapSeries.assoc.map((s) => ({ x: s.x, y: s.y, type: "scatter", mode: "lines", name: s.name, line: s.dashed ? { dash: "dash", color: s.color } : { color: s.color } }))}
                  layout={{ ...overlapAssocLayout, title: { text: "Association Overlap", font: { color: "#1c1916", size: 14 } } } as any}
                  style={{ width: "100%", height: "320px" }}
                  useResizeHandler config={{ responsive: true, displaylogo: false }}
                  onInitialized={(_: any, div: HTMLElement) => { overlapAssocDivRef.current = div as Plotly.PlotlyHTMLElement; }}
                  onUpdate={(_: any, div: HTMLElement) => { overlapAssocDivRef.current = div as Plotly.PlotlyHTMLElement; }}
                />
                <div className="row">
                  <button className="secondary" onClick={() => downloadPlotPng(overlapAssocDivRef.current, "sckanalyzer-overlap-assoc.png")}>Export PNG</button>
                  <button className="secondary" onClick={() => overlapSeries && downloadText("sckanalyzer-overlap-assoc.csv", buildOverlapPhaseCsv("assoc", overlapSeries.assoc, overlapNormalize, overlapBaseline))} disabled={!overlapSeries}>Export CSV</button>
                </div>
              </>
            )}

            {overlapSeries && overlapSeries.dissoc.length > 0 && (
              <>
                <Plot
                  data={overlapSeries.dissoc.map((s) => ({ x: s.x, y: s.y, type: "scatter", mode: "lines", name: s.name, line: s.dashed ? { dash: "dash", color: s.color } : { color: s.color } }))}
                  layout={{ ...overlapDissLayout, title: { text: "Dissociation Overlap", font: { color: "#1c1916", size: 14 } } } as any}
                  style={{ width: "100%", height: "320px" }}
                  useResizeHandler config={{ responsive: true, displaylogo: false }}
                  onInitialized={(_: any, div: HTMLElement) => { overlapDissDivRef.current = div as Plotly.PlotlyHTMLElement; }}
                  onUpdate={(_: any, div: HTMLElement) => { overlapDissDivRef.current = div as Plotly.PlotlyHTMLElement; }}
                />
                <div className="row">
                  <button className="secondary" onClick={() => downloadPlotPng(overlapDissDivRef.current, "sckanalyzer-overlap-dissoc.png")}>Export PNG</button>
                  <button className="secondary" onClick={() => overlapSeries && downloadText("sckanalyzer-overlap-dissoc.csv", buildOverlapPhaseCsv("dissoc", overlapSeries.dissoc, overlapNormalize, overlapBaseline))} disabled={!overlapSeries}>Export CSV</button>
                </div>
              </>
            )}

          </details>

          {/* ZIP download */}
          <div style={{ marginTop: 16 }}>
            <button
              className="secondary"
              onClick={async () => {
                if (!fits.length) return;
                const zip = new JSZip();
                const manifest: string[] = [];
                const add = (path: string, data: Blob | string) => { zip.file(path, data); manifest.push(path); };
                if (fitDivRef.current) add("plots/plot_fit.png", dataUrlToBlob(await Plotly.toImage(fitDivRef.current, { format: "png", scale: 2 } as Plotly.ToImgopts)));
                if (residDivRef.current) add("plots/plot_residual.png", dataUrlToBlob(await Plotly.toImage(residDivRef.current, { format: "png", scale: 2 } as Plotly.ToImgopts)));
                if (overlapAssocDivRef.current) add("plots/overlap_assoc.png", dataUrlToBlob(await Plotly.toImage(overlapAssocDivRef.current, { format: "png", scale: 2 } as Plotly.ToImgopts)));
                if (overlapDissDivRef.current) add("plots/overlap_dissoc.png", dataUrlToBlob(await Plotly.toImage(overlapDissDivRef.current, { format: "png", scale: 2 } as Plotly.ToImgopts)));
                if (allParamsCsv) add("tables/fit_parameters.csv", allParamsCsv);
                if (allFitCsv) add("tables/plot_fit.csv", allFitCsv);
                if (allResidCsv) add("tables/plot_residual.csv", allResidCsv);
                if (rmseCsv) add("tables/overlap_rmse.csv", rmseCsv);
                if (overlapSeries) {
                  add("tables/overlap_all.csv", buildOverlapCsv(overlapSeries, overlapNormalize, overlapBaseline));
                  if (overlapSeries.assoc.length) add("tables/overlap_assoc.csv", buildOverlapPhaseCsv("assoc", overlapSeries.assoc, overlapNormalize, overlapBaseline));
                  if (overlapSeries.dissoc.length) add("tables/overlap_dissoc.csv", buildOverlapPhaseCsv("dissoc", overlapSeries.dissoc, overlapNormalize, overlapBaseline));
                }
                if (manifest.length) add("manifest.txt", manifest.join("\n"));
                const blob = await zip.generateAsync({ type: "blob" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a"); a.href = url; a.download = "sckanalyzer-exports.zip"; a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download all exports (ZIP)
            </button>
          </div>
      </div>
    )}

    {/* ── Parameters + quality card ── */}
    {fits.length > 0 && (
      <div className="card">
        <h3>Fit results</h3>
          {/* Parameters table — transposed: params as columns, replicates as rows */}
          <div style={{ overflowX: "auto" }}>
            {fits.length > 0 && (() => {
              const showCi = fits.some(f => f.bootstrap?.ci95 && Object.keys(f.bootstrap.ci95).length > 0);

              type ParamSpec = {
                key: string; label: string; unit: string; helpText?: string;
                getVal: (f: FitResult) => number | null;
                fmt: (v: number) => React.ReactNode;
                fmtPlain: (v: number) => string;
                getSe: (f: FitResult) => string | null;
                getCi: (f: FitResult) => string | null;
              };

              const specs: ParamSpec[] = [
                {
                  key: "ka", label: "ka", unit: "1/M·s",
                  helpText: "Association rate constant (on-rate): how fast the analyte binds the ligand. Units: M⁻¹s⁻¹.",
                  getVal: f => f.params.ka,
                  fmt: v => v.toExponential(4),
                  fmtPlain: v => v.toExponential(4),
                  getSe: f => fmtSe(f).ka,
                  getCi: f => { const ci = (f.bootstrap?.ci95 ?? {})["ka"] as [number,number]|undefined; return ci ? `${ci[0].toExponential(3)} – ${ci[1].toExponential(3)}` : null; },
                },
                {
                  key: "kd", label: "kd", unit: "1/s",
                  helpText: "Dissociation rate constant (off-rate): how fast the analyte–ligand complex falls apart. Units: s⁻¹.",
                  getVal: f => f.params.kd,
                  fmt: v => v.toExponential(4),
                  fmtPlain: v => v.toExponential(4),
                  getSe: f => fmtSe(f).kd,
                  getCi: f => { const ci = (f.bootstrap?.ci95 ?? {})["kd"] as [number,number]|undefined; return ci ? `${ci[0].toExponential(3)} – ${ci[1].toExponential(3)}` : null; },
                },
                {
                  key: "KD", label: "KD", unit: "M",
                  helpText: "Equilibrium dissociation constant = kd / ka. Lower values indicate tighter binding. Units: M.",
                  getVal: f => f.params.KD,
                  fmt: v => v.toExponential(4),
                  fmtPlain: v => v.toExponential(4),
                  getSe: f => fmtSe(f).KD,
                  getCi: f => { const ci = (f.bootstrap?.ci95 ?? {})["KD"] as [number,number]|undefined; return ci ? `${ci[0].toExponential(3)} – ${ci[1].toExponential(3)}` : null; },
                },
                {
                  key: "Rmax", label: "Rmax", unit: "RU",
                  helpText: "Maximum binding capacity. Signal expected when all ligand sites are occupied. Units: RU.",
                  getVal: f => f.params.Rmax,
                  fmt: v => v.toExponential(4),
                  fmtPlain: v => v.toExponential(4),
                  getSe: f => fmtSe(f).Rmax,
                  getCi: f => { const ci = (f.bootstrap?.ci95 ?? {})["Rmax"] as [number,number]|undefined; return ci ? `${ci[0].toExponential(3)} – ${ci[1].toExponential(3)}` : null; },
                },
              ];

              // When ka, kd, and Rmax are all shared, every replicate's row
              // would be identical — collapse to a single "Global fit" row
              // instead of repeating the same numbers once per replicate.
              const rowFits = showSingleGlobalRow ? fits.slice(0, 1) : fits;

              return (
                <table className="result-table" style={{ width: "auto" }}>
                  <thead>
                    <tr>
                      <th></th>
                      {specs.map(p => (
                        <React.Fragment key={p.key}>
                          <th style={{ whiteSpace: "nowrap", textTransform: "none" }}>
                            {subscriptLabel(p.label)}
                            {p.helpText && <HelpTip text={p.helpText} />}
                            <span className="unit" style={{ fontWeight: 400, marginLeft: 4 }}>({p.unit})</span>
                          </th>
                          <th className="muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>SE<HelpTip text="Standard error from the Jacobian covariance matrix at the solution. May be absent if the fit is poorly conditioned or optimizer hit a bound." /></th>
                          {showCi && <th className="muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>95% CI</th>}
                        </React.Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rowFits.map((f, ri) => (
                      <tr key={ri}>
                        <th style={hasMultiRep && !showSingleGlobalRow ? { color: repColor(ri), whiteSpace: "nowrap" } : { whiteSpace: "nowrap" }}>
                          {showSingleGlobalRow ? "Global fit" : hasMultiRep ? `Rep ${ri + 1}` : "Value"}
                        </th>
                        {specs.map(p => {
                          const val = p.getVal(f);
                          const seStr = p.getSe(f);
                          const ciStr = showCi ? p.getCi(f) : null;
                          return (
                            <React.Fragment key={p.key}>
                              <td className="mono" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{val !== null ? p.fmt(val) : "—"}</td>
                              <td className="mono" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{seStr ?? "—"}</td>
                              {showCi && <td className="mono" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{ciStr ?? "—"}</td>}
                            </React.Fragment>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
          </div>

          {/* Mean ± SD summary. Hidden entirely for a fully-shared global fit
              (every row above is identical, so a mean/SD would be vacuous).
              For a global fit with an unshared Rmax, only Rmax varies across
              replicates (ka/kd stay shared), so only its row is meaningful. */}
          {hasMultiRep && !showSingleGlobalRow && (() => {
            type SummaryRow = { label: string; unit: string; mean: string | null; sd: string | null };
            const rows: SummaryRow[] = isGlobalFit
              ? [
                  { label: "Rmax", unit: "RU", ...summarize(fits.map(f => f.params.Rmax), v => v.toExponential(4)) },
                ]
              : [
                  { label: "ka", unit: "1/M·s", ...summarize(fits.map(f => f.params.ka), v => v.toExponential(4)) },
                  { label: "kd", unit: "1/s",   ...summarize(fits.map(f => f.params.kd), v => v.toExponential(4)) },
                  { label: "KD", unit: "M",     ...summarize(fits.map(f => f.params.KD), v => v.toExponential(4)) },
                  { label: "Rmax", unit: "RU",  ...summarize(fits.map(f => f.params.Rmax), v => v.toExponential(4)) },
                ];
            return (
              <div style={{ marginTop: 16 }}>
                <div className="muted" style={{ marginBottom: 6 }}>Summary ({fits.length} replicates)</div>
                <table className="result-table">
                  <thead>
                    <tr>
                      <th style={{ textTransform: "none" }}>Parameter</th>
                      <th style={{ textTransform: "none" }}>Mean</th>
                      <th style={{ textTransform: "none" }}>SD</th>
                      <th style={{ textTransform: "none" }}>Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.label}>
                        <th style={{ textTransform: "none" }}>{subscriptLabel(r.label)}</th>
                        <td className="mono" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{r.mean ?? "—"}</td>
                        <td className="mono" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{r.sd ?? "—"}</td>
                        <td className="unit" style={{ textAlign: "left" }}>{r.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}

          <div style={{ marginTop: 16, display: "flex", gap: 24, flexWrap: "wrap" }}>
            {/* Fit quality */}
            <div style={{ overflowX: "auto" }}>
              <div className="muted" style={{ marginBottom: 6 }}>Fit quality</div>
              {fits.length > 0 && (() => {
                return (
                  <table className="result-table" style={{ width: "auto" }}>
                    <thead>
                      <tr>
                        <th></th>
                        <th style={{ textTransform: "none", whiteSpace: "nowrap" }}>RMSE <span className="unit" style={{ fontWeight: 400 }}>(RU)</span><HelpTip text="Root Mean Square Error between data and model fit (RU). Lower is better; compare across replicates to detect outliers." /></th>
                        <th style={{ textTransform: "none", whiteSpace: "nowrap" }}>R²<HelpTip text="Coefficient of determination. Values close to 1 indicate a good fit. Can be misleading for non-linear models — inspect residuals too." /></th>
                        <th style={{ textTransform: "none", whiteSpace: "nowrap" }}>Chi<sup>2</sup><HelpTip text="Reduced chi-square: residual sum of squares divided by degrees of freedom. Lower is better; a much larger value than the residual noise variance indicates a poor fit." /></th>
                        <th style={{ textTransform: "none", whiteSpace: "nowrap" }}>N points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fits.map((f, ri) => (
                        <tr key={ri}>
                          <th style={fits.length > 1 ? { color: repColor(ri), whiteSpace: "nowrap" } : { whiteSpace: "nowrap" }}>
                            {fits.length > 1 ? `Rep ${ri + 1}` : "Value"}
                          </th>
                          <td className="mono" style={{ fontSize: 12 }}>{f.fit_quality.rmse.toFixed(4)}</td>
                          <td className="mono" style={{ fontSize: 12 }}>{Number.isFinite(f.fit_quality.r2) ? f.fit_quality.r2.toFixed(4) : "—"}</td>
                          <td className="mono" style={{ fontSize: 12 }}>{Number.isFinite(f.fit_quality.chi2) ? f.fit_quality.chi2.toExponential(4) : "—"}</td>
                          <td className="mono" style={{ fontSize: 12 }}>{Math.round(f.fit_quality.n_points)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
              {fits.some(f => f.warnings && f.warnings.length > 0) && (
                <div className="muted" style={{ marginTop: 8 }}>
                  {fits.flatMap((f, ri) => (f.warnings ?? []).map((w, wi) => (
                    <div key={`${ri}-${wi}`}>{hasMultiRep ? `Rep ${ri + 1}: ` : ""}⚠ {w}</div>
                  )))}
                </div>
              )}
            </div>

            {/* Bulk offsets */}
            {fits.some(f => (f.params.bulk_offsets_RU?.length ?? 0) > 0) && (() => {
              const maxBulkCount = Math.max(0, ...fits.map(f => f.params.bulk_offsets_RU?.length ?? 0));
              return (
                <div style={{ overflowX: "auto" }}>
                  <div className="muted" style={{ marginBottom: 6 }}>
                    Bulk offsets
                    <HelpTip text="Per-injection baseline offset fitted to account for bulk refractive index shifts at each injection transition." />
                  </div>
                  <table className="result-table" style={{ width: "auto" }}>
                    <thead>
                      <tr>
                        <th></th>
                        {Array.from({ length: maxBulkCount }, (_, idx) => (
                          <th key={idx} style={{ textTransform: "none", whiteSpace: "nowrap" }}>
                            Inj {idx + 1} <span className="unit">(RU)</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {fits.map((f, ri) => (
                        <tr key={ri}>
                          <th style={fits.length > 1 ? { color: repColor(ri), whiteSpace: "nowrap" } : { whiteSpace: "nowrap" }}>
                            {fits.length > 1 ? `Rep ${ri + 1}` : "Value"}
                          </th>
                          {Array.from({ length: maxBulkCount }, (_, idx) => {
                            const v = f.params.bulk_offsets_RU?.[idx];
                            return (
                              <td key={idx} className="mono" style={{ fontSize: 12 }}>
                                {v !== undefined ? v.toFixed(3) : "—"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>

        {fits.some(f => f.bootstrap && f.bootstrap.n > 0) && (
          <div className="muted" style={{ marginTop: 6 }}>
            Bootstrap:{" "}
            {(isGlobalFit ? [fits[0]] : fits).map((f, ri) =>
              f.bootstrap && f.bootstrap.n > 0
                ? `${hasMultiRep ? `Rep ${ri + 1}: ` : ""}${f.bootstrap.success}/${f.bootstrap.n} successful${f.bootstrap.failed ? ` (${f.bootstrap.failed} failed)` : ""}`
                : null
            ).filter(Boolean).join(" · ")}.
          </div>
        )}
        <div className="row" style={{ marginTop: 8 }}>
          <button className="secondary" onClick={() => allParamsCsv && downloadText("sckanalyzer-parameters.csv", allParamsCsv)} disabled={!allParamsCsv}>Export CSV</button>
        </div>
      </div>
    )}
    </>
  );
}
