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

type Props = {
  fitOptions: UseFitOptionsResult;
  runFit: () => void;
  canFit: boolean;
  fits: FitResult[];
  stepsStatus: string;
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
  stepsStatus, stepsForShading, refCol, injectionSteps,
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
    baselineMode, setBaselineMode,
    robustLoss, setRobustLoss,
    enableDrift, setEnableDrift,
    enableBulk, setEnableBulk,
    fitKa, setFitKa, fitKd, setFitKd, fitRmax, setFitRmax, fitDrift, setFitDrift,
    kaBounds, setKaBounds, kdBounds, setKdBounds, rmaxBounds, setRmaxBounds, driftBounds, setDriftBounds,
    kaFixed, setKaFixed, kdFixed, setKdFixed, rmaxFixed, setRmaxFixed, driftFixed, setDriftFixed,
    bootstrapN, setBootstrapN, bootstrapSeed, setBootstrapSeed,
  } = fitOptions;

  const isGlobalFit = fits.length > 0 && fits[0].fit_mode === "global";

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
      title: { text: refCol ? "Response (RU, ref-subtracted)" : "Response (RU)" },
      automargin: true,
    },
  }), [baseLayout, refCol]);

  const residLayout = {
    margin: { l: 55, r: 10, t: 45, b: 45 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    legend: { orientation: "h" as const, y: -0.3, yanchor: "top", x: 0, xanchor: "left" },
    xaxis: { title: { text: "Time (s)" }, automargin: true },
    yaxis: { title: { text: "Residual (RU)" }, automargin: true },
  };

  const overlapAssocLayout = {
    margin: { l: 55, r: 10, t: 45, b: 90 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    showlegend: overlapShowLegend,
    legend: { orientation: "h" as const, y: -0.35, yanchor: "top", x: 0, xanchor: "left" },
    xaxis: { title: { text: "Time since association start (s)" }, automargin: true },
    yaxis: { title: { text: overlapNormalize ? "ΔResponse (RU)" : "Response (RU)" }, automargin: true },
  };

  const overlapDissLayout = {
    margin: { l: 55, r: 10, t: 45, b: 90 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    showlegend: overlapShowLegend,
    legend: { orientation: "h" as const, y: -0.35, yanchor: "top", x: 0, xanchor: "left" },
    xaxis: { title: { text: "Time since dissociation start (s)" }, automargin: true },
    yaxis: { title: { text: overlapNormalize ? "ΔResponse (RU)" : "Response (RU)" }, automargin: true },
  };

  // ── Combined fit + residuals plot data ────────────
  const combinedFitData = useMemo<Plotly.Data[]>(() => {
    if (!hasMultiRep && fits[0]) {
      const f = fits[0];
      return [
        { x: f.series.t, y: f.series.y,    type: "scatter", mode: "lines", name: "Data", line: { color: "#2563eb", width: 1.5 } },
        { x: f.series.t, y: f.series.yhat, type: "scatter", mode: "lines", name: "Fit",  line: { color: "#dc2626", width: 2 } },
      ];
    }
    if (isGlobalFit) {
      // All yhat are identical — show one fit curve + N data traces
      const dataTraces: Plotly.Data[] = fits.map((f, ri) => ({
        x: f.series.t, y: f.series.y,
        type: "scatter", mode: "lines",
        name: `Rep ${ri + 1} data`,
        line: { color: repColor(ri), width: 1, dash: "dot" as const },
        opacity: 0.7,
      }));
      const fitTrace: Plotly.Data = {
        x: fits[0].series.t, y: fits[0].series.yhat,
        type: "scatter", mode: "lines",
        name: "Global fit",
        line: { color: "#dc2626", width: 2.5 },
      };
      return [...dataTraces, fitTrace];
    }
    return fits.flatMap((f, ri) => [
      {
        x: f.series.t, y: f.series.y,
        type: "scatter", mode: "lines",
        name: `Rep ${ri + 1} data`,
        line: { color: repColor(ri), width: 1, dash: "dot" as const },
        opacity: 0.65,
      },
      {
        x: f.series.t, y: f.series.yhat,
        type: "scatter", mode: "lines",
        name: `Rep ${ri + 1} fit`,
        line: { color: repColor(ri), width: 2 },
      },
    ]);
  }, [fits, hasMultiRep, isGlobalFit]);

  const combinedResidData = useMemo<Plotly.Data[]>(() => {
    if (!hasMultiRep && fits[0]) {
      const f = fits[0];
      return [{ x: f.series.t, y: f.series.residual, type: "scatter", mode: "lines", name: "Residual", line: { color: "#7c3aed" } }];
    }
    return fits.map((f, ri) => ({
      x: f.series.t, y: f.series.residual,
      type: "scatter", mode: "lines",
      name: `Rep ${ri + 1}`,
      line: { color: repColor(ri), width: 1.5 },
    }));
  }, [fits, hasMultiRep]);

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
    add("Rmax", fit.params.Rmax.toFixed(3), "RU",
      fit.standard_errors?.Rmax?.toFixed(3) ?? "",
      ci["Rmax"] ? ci["Rmax"][0].toFixed(3) : "", ci["Rmax"] ? ci["Rmax"][1].toFixed(3) : "");
    return rows.join("\n");
  };

  const allParamsCsv = useMemo(() => {
    if (!fits.length) return "";
    return fits.map((f, ri) => buildParamsCsv(f, fits.length > 1 ? `Rep ${ri+1}` : undefined)).join("\n\n");
  }, [fits]);

  const buildFitCsv = (fit: FitResult, repLabel?: string) => {
    const rows = ["plot,replicate,label,time_s,response_ru"];
    const rep = repLabel ?? "1";
    for (let i = 0; i < fit.series.t.length; i++)
      rows.push(["fit", rep, "data", fit.series.t[i], fit.series.y[i]].join(","));
    for (let i = 0; i < fit.series.t.length; i++)
      rows.push(["fit", rep, "fit", fit.series.t[i], fit.series.yhat[i]].join(","));
    return rows.join("\n");
  };

  const allFitCsv = useMemo(() => {
    if (!fits.length) return "";
    return fits.map((f, ri) => buildFitCsv(f, `Rep ${ri+1}`)).join("\n");
  }, [fits]);

  const buildResidCsv = (fit: FitResult, repLabel?: string) => {
    const rows = ["plot,replicate,time_s,residual_ru"];
    const rep = repLabel ?? "1";
    for (let i = 0; i < fit.series.t.length; i++)
      rows.push(["residual", rep, fit.series.t[i], fit.series.residual[i]].join(","));
    return rows.join("\n");
  };

  const allResidCsv = useMemo(() => {
    if (!fits.length) return "";
    return fits.map((f, ri) => buildResidCsv(f, `Rep ${ri+1}`)).join("\n");
  }, [fits]);

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
    const Rmax = fit.standard_errors?.Rmax?.toFixed(3) ?? null;
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
          <button className={repFitMode === "global" ? "primary" : "secondary"} style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setRepFitMode("global")}>Global (shared ka/kd)<HelpTip text="A single ka and kd is fitted simultaneously across all replicates, with each replicate having its own Rmax. Produces more constrained, statistically robust rate estimates." /></button>
        </div>
        <span className="muted">{stepsStatus || "Ready to fit once steps are defined."}</span>
      </div>

      {/* Advanced options */}
      <details style={{ marginBottom: 12 }}>
        <summary className="muted" style={{ cursor: "pointer" }}>Advanced options</summary>
        <div className="row" style={{ marginTop: 10 }}>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={enableDrift} onChange={(e) => setEnableDrift(e.target.checked)} />
            <span className="muted">Fit linear drift</span>
            <HelpTip text="Adds a linear drift term (slope × time) to the model. Use this to correct for slow baseline drift in the instrument signal." />
          </label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={enableBulk} onChange={(e) => setEnableBulk(e.target.checked)} />
            <span className="muted">Fit bulk offsets</span>
            <HelpTip text="Fits an independent baseline offset for each injection segment to account for bulk refractive index shifts at injection transitions." />
          </label>
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
                <th>ka (1/M·s)</th>
                <td><input type="checkbox" checked={fitKa} onChange={(e) => setFitKa(e.target.checked)} /></td>
                <td><input type="number" value={kaFixed} onChange={(e) => setKaFixed(e.target.value)} disabled={fitKa} /></td>
                <td><input type="text" value={kaBounds.min} onChange={(e) => setKaBounds({ ...kaBounds, min: e.target.value })} /></td>
                <td><input type="text" value={kaBounds.max} onChange={(e) => setKaBounds({ ...kaBounds, max: e.target.value })} /></td>
              </tr>
              <tr>
                <th>kd (1/s)</th>
                <td><input type="checkbox" checked={fitKd} onChange={(e) => setFitKd(e.target.checked)} /></td>
                <td><input type="number" value={kdFixed} onChange={(e) => setKdFixed(e.target.value)} disabled={fitKd} /></td>
                <td><input type="text" value={kdBounds.min} onChange={(e) => setKdBounds({ ...kdBounds, min: e.target.value })} /></td>
                <td><input type="text" value={kdBounds.max} onChange={(e) => setKdBounds({ ...kdBounds, max: e.target.value })} /></td>
              </tr>
              <tr>
                <th>Rmax (RU)</th>
                <td><input type="checkbox" checked={fitRmax} onChange={(e) => setFitRmax(e.target.checked)} /></td>
                <td><input type="number" value={rmaxFixed} onChange={(e) => setRmaxFixed(e.target.value)} disabled={fitRmax} /></td>
                <td><input type="text" value={rmaxBounds.min} onChange={(e) => setRmaxBounds({ ...rmaxBounds, min: e.target.value })} /></td>
                <td><input type="text" value={rmaxBounds.max} onChange={(e) => setRmaxBounds({ ...rmaxBounds, max: e.target.value })} /></td>
              </tr>
              <tr>
                <th>drift (RU/s)</th>
                <td><input type="checkbox" checked={fitDrift} onChange={(e) => setFitDrift(e.target.checked)} disabled={!enableDrift} /></td>
                <td><input type="number" value={driftFixed} onChange={(e) => setDriftFixed(e.target.value)} disabled={fitDrift || !enableDrift} /></td>
                <td><input type="text" value={driftBounds.min} onChange={(e) => setDriftBounds({ ...driftBounds, min: e.target.value })} disabled={!enableDrift} /></td>
                <td><input type="text" value={driftBounds.max} onChange={(e) => setDriftBounds({ ...driftBounds, max: e.target.value })} disabled={!enableDrift} /></td>
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
            <input type="number" min={0} step={10} value={bootstrapN}
              onChange={(e) => setBootstrapN(Math.max(0, Math.floor(Number(e.target.value))))}
              style={{ width: 100 }} disabled={bootstrapN === 0} />
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

    {/* ── Parameters + quality card ── */}
    {fits.length > 0 && (
      <div className="card">
        <h3>Fit results</h3>
          {/* Parameters table — transposed: params as columns, replicates as rows */}
          <div style={{ overflowX: "auto" }}>
            {fits.length > 0 && (() => {
              const hasDrift = fits.some(f => f.params.drift_RU_per_s !== undefined);
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
                  fmt: v => v.toFixed(3),
                  fmtPlain: v => v.toFixed(3),
                  getSe: f => fmtSe(f).Rmax,
                  getCi: f => { const ci = (f.bootstrap?.ci95 ?? {})["Rmax"] as [number,number]|undefined; return ci ? `${ci[0].toFixed(3)} – ${ci[1].toFixed(3)}` : null; },
                },
                ...(hasDrift ? [{
                  key: "drift_RU_per_s", label: "drift", unit: "RU/s",
                  helpText: "Linear baseline drift rate. A small non-zero value absorbs slow instrument drift. Only present when 'Fit linear drift' is enabled.",
                  getVal: (f: FitResult) => f.params.drift_RU_per_s !== undefined ? Number(f.params.drift_RU_per_s) : null,
                  fmt: (v: number) => v.toExponential(3) as React.ReactNode,
                  fmtPlain: (v: number) => v.toExponential(3),
                  getSe: (f: FitResult) => f.standard_errors?.drift_RU_per_s !== undefined ? f.standard_errors.drift_RU_per_s.toExponential(3) : null,
                  getCi: (f: FitResult) => { const ci = (f.bootstrap?.ci95 ?? {})["drift_RU_per_s"] as [number,number]|undefined; return ci ? `${ci[0].toExponential(3)} – ${ci[1].toExponential(3)}` : null; },
                }] as ParamSpec[] : []),
              ];

              const rowFits = isGlobalFit ? [fits[0]] : fits;

              return (
                <table className="result-table" style={{ width: "auto" }}>
                  <thead>
                    <tr>
                      <th></th>
                      {specs.map(p => (
                        <React.Fragment key={p.key}>
                          <th style={{ whiteSpace: "nowrap", textTransform: "none" }}>
                            {p.label}
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
                        <th style={hasMultiRep ? { color: repColor(ri), whiteSpace: "nowrap" } : { whiteSpace: "nowrap" }}>
                          {isGlobalFit ? "Global fit" : hasMultiRep ? `Rep ${ri + 1}` : "Value"}
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

          {/* Mean ± SD summary — per-replicate multi-rep only */}
          {hasMultiRep && !isGlobalFit && (() => {
            const hasDrift = fits.some(f => f.params.drift_RU_per_s !== undefined);
            type SummaryRow = { label: string; unit: string; mean: string | null; sd: string | null };
            const rows: SummaryRow[] = [
              { label: "ka", unit: "1/M·s", ...summarize(fits.map(f => f.params.ka), v => v.toExponential(4)) },
              { label: "kd", unit: "1/s",   ...summarize(fits.map(f => f.params.kd), v => v.toExponential(4)) },
              { label: "KD", unit: "M",     ...summarize(fits.map(f => f.params.KD), v => v.toExponential(4)) },
              { label: "Rmax", unit: "RU",  ...summarize(fits.map(f => f.params.Rmax), v => v.toFixed(3)) },
              ...(hasDrift ? [{ label: "drift", unit: "RU/s", ...summarize(fits.map(f => f.params.drift_RU_per_s !== undefined ? Number(f.params.drift_RU_per_s) : NaN), v => v.toExponential(3)) }] : []),
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
                        <th style={{ textTransform: "none" }}>{r.label}</th>
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

          {/* Fit quality */}
          <div style={{ marginTop: 16, overflowX: "auto" }}>
            <div className="muted" style={{ marginBottom: 6 }}>Fit quality</div>
            {fits.length > 0 && (() => {
              return (
                <table className="result-table" style={{ width: "auto" }}>
                  <thead>
                    <tr>
                      <th></th>
                      <th style={{ textTransform: "none", whiteSpace: "nowrap" }}>RMSE <span className="unit" style={{ fontWeight: 400 }}>(RU)</span><HelpTip text="Root Mean Square Error between data and model fit (RU). Lower is better; compare across replicates to detect outliers." /></th>
                      <th style={{ textTransform: "none", whiteSpace: "nowrap" }}>R²<HelpTip text="Coefficient of determination. Values close to 1 indicate a good fit. Can be misleading for non-linear models — inspect residuals too." /></th>
                      <th style={{ textTransform: "none", whiteSpace: "nowrap" }}>Durbin-Watson<HelpTip text="Tests for autocorrelation in residuals. Values near 2 = no autocorrelation (good). Values far from 2 suggest systematic misfits or a wrong model." /></th>
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
                        <td className="mono" style={{ fontSize: 12 }}>{Number.isFinite(f.fit_quality.dw) ? f.fit_quality.dw.toFixed(3) : "—"}</td>
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
          <button className="secondary" onClick={() => allParamsCsv && downloadText("fit_parameters.csv", allParamsCsv)} disabled={!allParamsCsv}>Export parameters CSV</button>
        </div>
      </div>
    )}

    {/* ── Plots card ── */}
    {fits.length > 0 && (
      <div className="card">
          <div className="plots">
            <Plot
              data={combinedFitData}
              layout={{ ...fitLayout, title: { text: hasMultiRep ? (isGlobalFit ? "Global Fit (shared ka/kd) — all replicates" : "Per-replicate fits") : "Fit (Data + Model)", font: { color: "#1c1916", size: 14 } } } as any}
              style={{ width: "100%", height: "380px" }}
              useResizeHandler
              config={{ responsive: true, displaylogo: false }}
              onInitialized={(_: any, div: HTMLElement) => { fitDivRef.current = div as Plotly.PlotlyHTMLElement; }}
              onUpdate={(_: any, div: HTMLElement) => { fitDivRef.current = div as Plotly.PlotlyHTMLElement; }}
            />
            <div className="row">
              <button className="secondary" onClick={() => downloadPlotPng(fitDivRef.current, "plot_fit.png")}>Export fit PNG</button>
              <button className="secondary" onClick={() => allFitCsv && downloadText("plot_fit.csv", allFitCsv)} disabled={!allFitCsv}>Export fit CSV</button>
            </div>
            <Plot
              data={combinedResidData}
              layout={{ ...residLayout, title: { text: hasMultiRep ? "Residuals — all replicates" : "Residuals", font: { color: "#1c1916", size: 14 } } } as any}
              style={{ width: "100%", height: "260px" }}
              useResizeHandler
              config={{ responsive: true, displaylogo: false }}
              onInitialized={(_: any, div: HTMLElement) => { residDivRef.current = div as Plotly.PlotlyHTMLElement; }}
              onUpdate={(_: any, div: HTMLElement) => { residDivRef.current = div as Plotly.PlotlyHTMLElement; }}
            />
            <div className="row">
              <button className="secondary" onClick={() => downloadPlotPng(residDivRef.current, "plot_residual.png")}>Export residual PNG</button>
              <button className="secondary" onClick={() => allResidCsv && downloadText("plot_residual.csv", allResidCsv)} disabled={!allResidCsv}>Export residual CSV</button>
            </div>
          </div>

          <details style={{ marginTop: 16 }}>
            <summary className="muted" style={{ cursor: "pointer" }}>
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
                  <button className="secondary" onClick={() => downloadPlotPng(overlapAssocDivRef.current, "overlap_assoc.png")}>Export assoc PNG</button>
                  <button className="secondary" onClick={() => overlapSeries && downloadText("overlap_assoc.csv", buildOverlapPhaseCsv("assoc", overlapSeries.assoc, overlapNormalize, overlapBaseline))} disabled={!overlapSeries}>Export assoc CSV</button>
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
                  <button className="secondary" onClick={() => downloadPlotPng(overlapDissDivRef.current, "overlap_dissoc.png")}>Export dissoc PNG</button>
                  <button className="secondary" onClick={() => overlapSeries && downloadText("overlap_dissoc.csv", buildOverlapPhaseCsv("dissoc", overlapSeries.dissoc, overlapNormalize, overlapBaseline))} disabled={!overlapSeries}>Export dissoc CSV</button>
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
                const a = document.createElement("a"); a.href = url; a.download = "spr_sck_exports.zip"; a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download all exports (ZIP)
            </button>
          </div>
      </div>
    )}
    </>
  );
}
