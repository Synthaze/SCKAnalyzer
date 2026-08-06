import React, { useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import Plotly from "plotly.js-dist-min";
import { formatKD, formatConc, roundDecimals } from "../lib/format";
import { downloadText, downloadPlotPng } from "../lib/export";
import { CONC_UNITS, CONC_MULT, type ConcUnit } from "../lib/units";
import HelpTip from "./HelpTip";

// ── 1:1 Langmuir analytic simulation ─────────────────
function simulate11(
  t: number[],
  steps: Array<{ start: number; stop: number; C: number }>,
  ka: number, kd: number, rmax: number, drift: number
): number[] {
  const n = t.length;
  if (n === 0) return [];
  const sorted = [...steps].sort((a, b) => a.start - b.start);
  const segs: Array<{ start: number; stop: number; C: number }> = [];
  let cursor = t[0];
  for (const s of sorted) {
    if (s.start > cursor + 1e-9) segs.push({ start: cursor, stop: s.start, C: 0 });
    segs.push({ ...s });
    cursor = s.stop;
  }
  if (cursor < t[n - 1] - 1e-9) segs.push({ start: cursor, stop: t[n - 1], C: 0 });

  const yhat = new Array<number>(n).fill(0);
  let R0 = 0;
  for (const seg of segs) {
    const C = seg.C;
    const k = ka * C + kd;
    const Req = C > 0 && k > 0 ? (ka * C * rmax) / k : 0;
    const dtEnd = seg.stop - seg.start;
    for (let i = 0; i < n; i++) {
      if (t[i] >= seg.start - 1e-9 && t[i] <= seg.stop + 1e-9) {
        const dt = Math.max(0, t[i] - seg.start);
        yhat[i] = Req + (R0 - Req) * Math.exp(-k * dt);
      }
    }
    R0 = Req + (R0 - Req) * Math.exp(-k * dtEnd);
  }
  if (drift !== 0) {
    const t0 = t[0];
    for (let i = 0; i < n; i++) yhat[i] += drift * (t[i] - t0);
  }
  return yhat;
}

// ── Seeded Gaussian noise (Box-Muller) ────────────────
function addGaussianNoise(y: number[], sigma: number, seed: number): number[] {
  if (sigma <= 0) return [...y];
  let s = (seed | 0) || 1;
  const lcg = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
  return y.map((v) => {
    const u1 = Math.max(lcg(), 1e-10);
    const u2 = lcg();
    return v + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  });
}

type InjRow = { conc: string; assocTime: string; dissocTime: string };

const PRESETS: Array<{ label: string; ka: string; kd: string; rmax: string }> = [
  { label: "Strong",   ka: "1e5", kd: "1e-4", rmax: "100" },
  { label: "Moderate", ka: "1e3", kd: "1e-3", rmax: "100" },
  { label: "Weak",     ka: "1e3", kd: "1e-2", rmax: "100" },
];

export default function SimulateSection() {
  const plotDivRef = useRef<Plotly.PlotlyHTMLElement | null>(null);

  // ── Kinetic params ────────────────────────────────
  const [kaStr,   setKaStr]   = useState("1e5");
  const [kdStr,   setKdStr]   = useState("1e-3");
  const [rmaxStr, setRmaxStr] = useState("100");

  // ── Optional features ─────────────────────────────
  const [enableDrift, setEnableDrift] = useState(false);
  const [driftStr,    setDriftStr]    = useState("0.001");
  const [enableNoise, setEnableNoise] = useState(false);
  const [noiseStr,    setNoiseStr]    = useState("1");
  const [noiseSeed,   setNoiseSeed]   = useState(42);

  // ── Time settings ─────────────────────────────────
  const [dtStr,       setDtStr]       = useState("0.5");
  const [baselineStr, setBaselineStr] = useState("60");

  // ── Injections ────────────────────────────────────
  const [concUnit, setConcUnit] = useState<ConcUnit>("nM");
  const [injections, setInjections] = useState<InjRow[]>([
    { conc: "6.25", assocTime: "60", dissocTime: "60" },
    { conc: "12.5", assocTime: "60", dissocTime: "60" },
    { conc: "25",   assocTime: "60", dissocTime: "60" },
    { conc: "50",   assocTime: "60", dissocTime: "60" },
  ]);

  const updateInj = (i: number, field: keyof InjRow, v: string) =>
    setInjections((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: v } : r)));
  const addInj    = () => setInjections((prev) => [...prev, { conc: "", assocTime: "60", dissocTime: "60" }]);
  const removeInj = (i: number) => setInjections((prev) => prev.filter((_, idx) => idx !== i));

  // ── Dilution series builder ────────────────────────
  const [injBuildMode, setInjBuildMode] = useState<"manual" | "dilution">("manual");
  const [dilNInj,    setDilNInj]    = useState(4);
  const [dilCFinal,  setDilCFinal]  = useState("50");
  const [dilFactor,  setDilFactor]  = useState(2);
  const [dilAssoc,   setDilAssoc]   = useState("60");
  const [dilDissoc,  setDilDissoc]  = useState("60");

  function buildInjDilutionSeries() {
    const n = Math.max(1, Math.floor(dilNInj));
    const cFinalV = Number(dilCFinal);
    const d = Math.max(1, dilFactor);
    if (!Number.isFinite(cFinalV) || cFinalV <= 0) return;
    const rows: InjRow[] = [];
    for (let i = 0; i < n; i++) {
      const c = cFinalV / Math.pow(d, n - 1 - i);
      rows.push({ conc: String(roundDecimals(c)), assocTime: dilAssoc, dissocTime: dilDissoc });
    }
    setInjections(rows);
  }

  // ── Parsed values ─────────────────────────────────
  const ka   = useMemo(() => { const v = Number(kaStr);   return Number.isFinite(v) && v > 0 ? v : null; }, [kaStr]);
  const kd   = useMemo(() => { const v = Number(kdStr);   return Number.isFinite(v) && v > 0 ? v : null; }, [kdStr]);
  const rmax = useMemo(() => { const v = Number(rmaxStr); return Number.isFinite(v) && v > 0 ? v : null; }, [rmaxStr]);
  const KD   = ka && kd ? kd / ka : null;
  const halfLife = kd ? Math.LN2 / Number(kdStr) : null;
  const drift      = enableDrift ? (Number(driftStr) || 0) : 0;
  const noiseSigma = enableNoise ? Math.max(0, Number(noiseStr) || 0) : 0;
  const dt         = Math.max(0.05, Number(dtStr) || 0.5);
  const baseline   = Math.max(0, Number(baselineStr) || 60);
  const mult = CONC_MULT[concUnit];

  // ── Build steps + time array ───────────────────────
  const { steps, tArr, stepTiming } = useMemo(() => {
    const stepsOut: Array<{ start: number; stop: number; C: number }> = [];
    type TimingEntry = { assocStart: number; assocStop: number; dissocStop: number; C: number };
    const timing: TimingEntry[] = [];
    let cursor = baseline;
    for (let i = 0; i < injections.length; i++) {
      const inj = injections[i];
      const cv    = Number(inj.conc);
      const assoc = Number(inj.assocTime);
      const dissoc = Math.max(0, Number(inj.dissocTime) || 0);
      if (!Number.isFinite(cv) || cv < 0 || !Number.isFinite(assoc) || assoc <= 0) continue;
      const C = cv * mult;
      const assocStop = cursor + assoc;
      stepsOut.push({ start: cursor, stop: assocStop, C });
      timing.push({ assocStart: cursor, assocStop, dissocStop: assocStop + dissoc, C });
      cursor = assocStop + dissoc;
    }
    const tTotal = cursor;
    if (tTotal <= 0) return { steps: stepsOut, tArr: [], stepTiming: timing };
    const nPts = Math.min(Math.round(tTotal / dt) + 1, 50000);
    const tOut: number[] = [];
    const step = tTotal / (nPts - 1);
    for (let i = 0; i < nPts; i++) tOut.push(Math.min(i * step, tTotal));
    return { steps: stepsOut, tArr: tOut, stepTiming: timing };
  }, [injections, baseline, dt, mult]);

  // ── Simulate ──────────────────────────────────────
  const yClean = useMemo(() => {
    if (!ka || !kd || !rmax || tArr.length === 0 || steps.length === 0) return [];
    return simulate11(tArr, steps, ka, kd, rmax, drift);
  }, [tArr, steps, ka, kd, rmax, drift]);

  const yNoisy = useMemo(
    () => addGaussianNoise(yClean, noiseSigma, noiseSeed),
    [yClean, noiseSigma, noiseSeed]
  );

  const yDisplay = noiseSigma > 0 ? yNoisy : yClean;
  const totalDuration = tArr.length > 0 ? tArr[tArr.length - 1] : 0;

  // ── Plot ──────────────────────────────────────────
  const plotData = useMemo<Plotly.Data[]>(() => {
    if (!yDisplay.length) return [];
    const traces: Plotly.Data[] = [{
      x: tArr, y: yDisplay,
      type: "scatter", mode: "lines",
      name: noiseSigma > 0 ? "Simulated (+ noise)" : "Simulated",
      line: { color: "#2563eb", width: 1.5 },
    }];
    if (noiseSigma > 0 && yClean.length) {
      traces.push({
        x: tArr, y: yClean,
        type: "scatter", mode: "lines",
        name: "Clean model",
        line: { color: "#dc2626", width: 1.5, dash: "dash" as const },
        opacity: 0.55,
      });
    }
    return traces;
  }, [tArr, yDisplay, yClean, noiseSigma]);

  const plotLayout = useMemo<Partial<Plotly.Layout>>(() => ({
    margin: { l: 55, r: 10, t: 45, b: 45 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    xaxis: { title: { text: "Time (s)" }, automargin: true },
    yaxis: { title: { text: "Response" }, automargin: true },
    title: { text: "Simulated SCK Sensorgram", font: { color: "#1c1916", size: 14 } },
    showlegend: noiseSigma > 0,
    shapes: steps.map((s) => ({
      type: "rect" as const, xref: "x" as const, yref: "paper" as const,
      x0: s.start, x1: s.stop, y0: 0, y1: 1,
      fillcolor: "rgba(30,79,140,0.08)", line: { width: 0 },
    })),
  }), [steps, noiseSigma]);

  // ── Exports ───────────────────────────────────────
  const csvContent = useMemo(() => {
    if (!tArr.length || !yDisplay.length) return "";
    const header = noiseSigma > 0
      ? "time_s,response_ru,response_clean_ru"
      : "time_s,response_ru";
    const rows = tArr.map((tv, i) =>
      noiseSigma > 0
        ? `${tv.toFixed(4)},${(yNoisy[i] ?? 0).toFixed(4)},${(yClean[i] ?? 0).toFixed(4)}`
        : `${tv.toFixed(4)},${(yClean[i] ?? 0).toFixed(4)}`
    );
    return [header, ...rows].join("\n");
  }, [tArr, yDisplay, yNoisy, yClean, noiseSigma]);

  const canSimulate = !!(ka && kd && rmax && steps.length > 0);

  return (
    <div>
      {/* ── Parameters card ── */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Kinetic parameters</h3>
          <div className="row" style={{ gap: 6 }}>
            <span className="muted" style={{ fontSize: 11 }}>Presets:</span>
            {PRESETS.map((p) => (
              <button key={p.label} className="secondary"
                style={{ padding: "3px 10px", fontSize: 11 }}
                onClick={() => { setKaStr(p.ka); setKdStr(p.kd); setRmaxStr(p.rmax); }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, alignItems: "end" }}>
          <label>
            <span style={{ whiteSpace: "nowrap" }}>k<sub>a</sub> (M⁻¹s⁻¹)</span>
            <input type="text" value={kaStr} onChange={(e) => setKaStr(e.target.value)}
              style={{ borderColor: ka ? undefined : "var(--error)", fontFamily: "Source Code Pro, monospace" }} />
          </label>
          <label>
            <span style={{ whiteSpace: "nowrap" }}>k<sub>d</sub> (s⁻¹)</span>
            <input type="text" value={kdStr} onChange={(e) => setKdStr(e.target.value)}
              style={{ borderColor: kd ? undefined : "var(--error)", fontFamily: "Source Code Pro, monospace" }} />
          </label>
          <label>
            <span style={{ whiteSpace: "nowrap" }}>K<sub>D</sub> (M)</span>
            <input type="text" readOnly value={KD ? KD.toExponential(3) : "—"}
              style={{ background: "var(--surface)", cursor: "default", color: "var(--text-2)", fontFamily: "Source Code Pro, monospace" }} />
          </label>
          <label>
            <span style={{ whiteSpace: "nowrap" }}>R<sub>max</sub> (RU)</span>
            <input type="text" value={rmaxStr} onChange={(e) => setRmaxStr(e.target.value)}
              style={{ borderColor: rmax ? undefined : "var(--error)", fontFamily: "Source Code Pro, monospace" }} />
          </label>
        </div>

        {/* Derived info row */}
        {(KD || halfLife) && (
          <div className="row" style={{ marginTop: 10, gap: 18, flexWrap: "wrap" }}>
            {KD && <span className="muted" style={{ fontSize: 12 }}>K<sub>D</sub> = {KD.toExponential(3)} M ({formatKD(KD)})</span>}
            {halfLife && Number.isFinite(halfLife) && <span className="muted" style={{ fontSize: 12 }}>t½ dissoc = {halfLife.toFixed(1)} s</span>}
          </div>
        )}

        {/* Optional: drift + noise */}
        <div className="row" style={{ marginTop: 16, gap: 14, flexWrap: "wrap" }}>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={enableDrift} onChange={(e) => setEnableDrift(e.target.checked)} />
            Linear drift
          </label>
          {enableDrift && (
            <label>
              Drift (RU/s)
              <input type="text" inputMode="decimal" value={driftStr}
                onChange={(e) => setDriftStr(e.target.value)} style={{ width: 100 }} />
            </label>
          )}
          <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={enableNoise} onChange={(e) => setEnableNoise(e.target.checked)} />
            Gaussian noise
          </label>
          {enableNoise && (
            <>
              <label>
                σ (RU)
                <input type="text" inputMode="decimal" value={noiseStr}
                  onChange={(e) => setNoiseStr(e.target.value)} style={{ width: 80 }} />
              </label>
              <button className="secondary" style={{ padding: "4px 10px", fontSize: 12, alignSelf: "flex-end" }}
                onClick={() => setNoiseSeed((s) => s + 1)}>
                ↺ New noise
              </button>
            </>
          )}
        </div>

        {/* Time settings */}
        <div className="row" style={{ marginTop: 14, gap: 14, flexWrap: "wrap" }}>
          <label>
            Time step (s)
            <input type="text" inputMode="decimal" value={dtStr}
              onChange={(e) => setDtStr(e.target.value)} style={{ width: 80 }} />
          </label>
        </div>
      </div>

      {/* ── Injections card ── */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, flex: 1 }}>Injection steps</h3>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 6, fontSize: 12 }}>
            Unit
            <select value={concUnit} onChange={(e) => setConcUnit(e.target.value as ConcUnit)}
              style={{ padding: "4px 24px 4px 8px", fontSize: 12 }}>
              {CONC_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
        </div>

        {/* Mode toggle */}
        <div className="row" style={{ marginBottom: 14 }}>
          <button
            className={injBuildMode === "manual" ? "primary" : "secondary"}
            onClick={() => setInjBuildMode("manual")}
          >
            Manual
          </button>
          <button
            className={injBuildMode === "dilution" ? "primary" : "secondary"}
            onClick={() => setInjBuildMode("dilution")}
          >
            From dilution series
          </button>
        </div>

        {injBuildMode === "manual" && (
          <div className="row" style={{ marginBottom: 14 }}>
            <label>
              <span>Injection start time <span className="unit">(s)</span><HelpTip text="Time at which the first injection begins (seconds from the start of the trace)." /></span>
              <input type="text" inputMode="decimal" value={baselineStr}
                onChange={(e) => setBaselineStr(e.target.value)} style={{ width: 110 }} />
            </label>
          </div>
        )}

        {injBuildMode === "dilution" && (
          <div style={{ marginBottom: 14 }}>
            <p className="muted" style={{ marginBottom: 8 }}>
              Define the injection series. Concentrations are computed automatically by successive dilution; association and dissociation times are shared across all injections.
            </p>
            <div className="grid">
              <label>
                <span>Injection start time <span className="unit">(s)</span><HelpTip text="Time at which the first injection begins (seconds from the start of the trace)." /></span>
                <input type="text" inputMode="decimal" value={baselineStr}
                  onChange={(e) => setBaselineStr(e.target.value)} />
              </label>
              <label>
                <span>Number of injections<HelpTip text="Total number of injections in the dilution series." /></span>
                <input type="text" inputMode="decimal" defaultValue={dilNInj}
                  onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setDilNInj(v); }} />
              </label>
              <label>
                <span>Final concentration <span className="unit">({concUnit})</span><HelpTip text="Highest analyte concentration in the series. Preceding injections are computed by successively dividing by the dilution factor." /></span>
                <input type="text" inputMode="decimal" value={dilCFinal}
                  onChange={(e) => setDilCFinal(e.target.value)} />
              </label>
              <label>
                <span>Dilution factor<HelpTip text="Each step is this many times less concentrated than the next (e.g. 2 = 2-fold serial dilution)." /></span>
                <input type="text" inputMode="decimal" defaultValue={dilFactor}
                  onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setDilFactor(v); }} />
              </label>
              <label>
                <span>Association <span className="unit">(s)</span><HelpTip text="Duration of each injection window (seconds). Shared by all injections." /></span>
                <input type="text" inputMode="decimal" value={dilAssoc}
                  onChange={(e) => setDilAssoc(e.target.value)} />
              </label>
              <label>
                <span>Dissociation <span className="unit">(s)</span><HelpTip text="Dissociation time after each injection (seconds). Shared by all injections." /></span>
                <input type="text" inputMode="decimal" value={dilDissoc}
                  onChange={(e) => setDilDissoc(e.target.value)} />
              </label>
            </div>
            <div style={{ marginTop: 10 }}>
              <button className="secondary" onClick={buildInjDilutionSeries}>
                Build dilution series
              </button>
            </div>
          </div>
        )}

        <table className="result-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>Concentration <span className="unit">({concUnit})</span></th>
              <th>Association <span className="unit">(s)</span></th>
              <th>Dissociation <span className="unit">(s)</span></th>
              <th>Timing <span className="unit">(s)</span></th>
              <th>Plateau <span className="unit">(RU)</span></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {injections.map((inj, i) => {
              const timing = stepTiming[i];
              const cv = Number(inj.conc) * mult;
              const plateau = (ka && kd && rmax && cv > 0)
                ? ((ka * cv * rmax) / (ka * cv + kd)).toFixed(1)
                : "—";
              return (
                <tr key={i}>
                  <td className="muted" style={{ textAlign: "center", fontSize: 12 }}>{i + 1}</td>
                  <td>
                    <input type="text" inputMode="decimal" value={inj.conc}
                      onChange={(e) => updateInj(i, "conc", e.target.value)} style={{ width: "100%" }} />
                  </td>
                  <td>
                    <input type="text" inputMode="decimal" value={inj.assocTime}
                      onChange={(e) => updateInj(i, "assocTime", e.target.value)} style={{ width: "100%" }} />
                  </td>
                  <td>
                    <input type="text" inputMode="decimal" value={inj.dissocTime}
                      onChange={(e) => updateInj(i, "dissocTime", e.target.value)} style={{ width: "100%" }} />
                  </td>
                  <td className="mono muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                    {timing
                      ? <>
                          <span title="association">▶ {timing.assocStart.toFixed(0)}–{timing.assocStop.toFixed(0)}</span>
                          {timing.dissocStop > timing.assocStop && (
                            <><br /><span title="dissociation" style={{ color: "var(--muted)" }}>⏎ {timing.assocStop.toFixed(0)}–{timing.dissocStop.toFixed(0)}</span></>
                          )}
                        </>
                      : "—"}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{plateau}</td>
                  <td style={{ width: 52, textAlign: "center" }}>
                    <button className="secondary" style={{ padding: "2px 8px", fontSize: 11 }}
                      onClick={() => removeInj(i)} disabled={injections.length <= 1}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="row" style={{ marginTop: 10, alignItems: "center", gap: 14 }}>
          <button className="secondary" style={{ padding: "4px 12px", fontSize: 12 }} onClick={addInj}>
            + Add injection
          </button>
          {totalDuration > 0 && (
            <span className="muted" style={{ fontSize: 12 }}>
              Total: {totalDuration.toFixed(0)} s · {tArr.length.toLocaleString()} pts
            </span>
          )}
        </div>
      </div>

      {/* ── Simulated sensorgram ── */}
      <div className="card">
        {canSimulate && yDisplay.length > 0 ? (
          <>
            <Plot
              data={plotData}
              layout={plotLayout as Plotly.Layout}
              style={{ width: "100%", height: "380px" }}
              useResizeHandler
              config={{ responsive: true, displaylogo: false }}
              onInitialized={(_: any, div: HTMLElement) => { plotDivRef.current = div as Plotly.PlotlyHTMLElement; }}
              onUpdate={(_: any, div: HTMLElement) => { plotDivRef.current = div as Plotly.PlotlyHTMLElement; }}
            />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="secondary"
                onClick={() => downloadPlotPng(plotDivRef.current, "sckanalyzer-simulation.png")}>
                Export PNG
              </button>
              <button className="secondary"
                onClick={() => csvContent && downloadText("sckanalyzer-simulation.csv", csvContent)}
                disabled={!csvContent}>
                Export CSV
              </button>
            </div>
          </>
        ) : (
          <div className="muted">
            {!canSimulate
              ? "Set valid ka, kd, Rmax values and at least one injection to see the simulation."
              : "Adjust parameters above to generate a sensorgram."}
          </div>
        )}
      </div>
    </div>
  );
}
