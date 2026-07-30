import React, { useState } from "react";
import Plot from "react-plotly.js";
import Plotly from "plotly.js-dist-min";
import type { UseStepsResult } from "../hooks/useSteps";
import type { ExcludeRow } from "../hooks/useFitOptions";
import HelpTip from "./HelpTip";
import { CONC_UNITS, CONC_MULT, type ConcUnit } from "../lib/units";
import { roundDecimals } from "../lib/format";

type Props = {
  steps: UseStepsResult;
  canBuildDilution: boolean;
  previewSeries: Array<{ t: number[]; y: number[]; label: string }> | null;
  excludeRows: ExcludeRow[];
  addExcludeRow: () => void;
  removeExcludeRow: (i: number) => void;
  updateExcludeRow: (i: number, field: "start" | "stop", v: string) => void;
};

export default function SckParamsSection({
  steps,
  canBuildDilution,
  previewSeries,
  excludeRows,
  addExcludeRow,
  removeExcludeRow,
  updateExcludeRow,
}: Props) {
  const [buildMode, setBuildMode] = useState<"markers" | "dilution">("markers");
  const [cursorTimes, setCursorTimes] = useState<number[]>([]);
  const [addCursorMode, setAddCursorMode] = useState(false);
  const [concUnit, setConcUnit] = useState<ConcUnit>("nM");

  const {
    stepsTable, stepsStatus, stepsParsed, stepsEffective,
    syncSteps, updateStep, addStepRow, removeStepRow,
    createStepsFromCursors,
    injStart, setInjStart,
    injDur, setInjDur,
    gapDur, setGapDur,
    nInj, setNInj,
    cFinal, setCFinal,
    dilFactor, setDilFactor,
    dissDur, setDissDur,
    buildDilutionSeries,
  } = steps;

  function handlePlotClick(event: Readonly<Plotly.PlotMouseEvent>) {
    if (!addCursorMode) return;
    const pt = event.points?.[0];
    if (pt == null) return;
    const t = pt.x as number;
    setCursorTimes((prev) => [...prev, t].sort((a, b) => a - b));
  }

  function handleRelayout(event: Readonly<Plotly.PlotRelayoutEvent>) {
    const updates: Record<number, number> = {};
    for (const key of Object.keys(event)) {
      const m = key.match(/^shapes\[(\d+)\]\.x0$/);
      if (m) {
        const idx = Number(m[1]);
        const shapeStart = stepsEffective.filter((s) => s.C > 0).length;
        const excludeStart = shapeStart + cursorTimes.length;
        const cursorIdx = idx - shapeStart;
        if (cursorIdx >= 0 && cursorIdx < cursorTimes.length) {
          updates[cursorIdx] = (event as Record<string, unknown>)[key] as number;
        }
        void excludeStart;
      }
    }
    if (Object.keys(updates).length > 0) {
      setCursorTimes((prev) => {
        const next = [...prev];
        for (const [i, v] of Object.entries(updates)) {
          next[Number(i)] = v;
        }
        return next.sort((a, b) => a - b);
      });
    }
  }

  const cursorShapes: Partial<Plotly.Shape>[] = cursorTimes.map((t) => ({
    type: "line" as const,
    xref: "x" as const,
    yref: "paper" as const,
    x0: t, x1: t,
    y0: 0, y1: 1,
    line: { color: "#f59e0b", width: 2, dash: "dot" },
    editable: true,
  }));

  return (
    <div>
      {/* Injection steps card */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, flex: 1 }}>Define injection steps<HelpTip text="Time windows where analyte is injected. Each step defines a start time, stop time, and concentration. Association kinetics are fitted within these windows; dissociation follows each stop time." /></h3>
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
            className={buildMode === "markers" ? "primary" : "secondary"}
            onClick={() => setBuildMode("markers")}
          >
            From injection markers
          </button>
          <button
            className={buildMode === "dilution" ? "primary" : "secondary"}
            onClick={() => setBuildMode("dilution")}
          >
            From dilution series
          </button>
        </div>

        {/* Method A — injection markers */}
        {buildMode === "markers" && (
          <div style={{ marginBottom: 14 }}>
            <p className="muted" style={{ marginBottom: 8 }}>
              Click the sensorgram to place markers in pairs: odd clicks = injection start, even clicks = injection end. Concentrations must be filled in manually.
            </p>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              <button
                className={addCursorMode ? "primary" : "secondary"}
                onClick={() => setAddCursorMode((v) => !v)}
              >
                {addCursorMode
                  ? (cursorTimes.length % 2 === 0 ? "Click to place start…" : "Click to place end…")
                  : "Add injection marker"}
              </button>
              <button
                className="secondary"
                disabled={cursorTimes.length < 2}
                onClick={() => {
                  createStepsFromCursors(cursorTimes);
                  setAddCursorMode(false);
                }}
              >
                Create steps from markers
              </button>
              {cursorTimes.length > 0 && (
                <button className="secondary" onClick={() => setCursorTimes([])}>
                  Clear markers
                </button>
              )}
              {cursorTimes.length < 2 && (
                <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
                  ({cursorTimes.length} marker{cursorTimes.length !== 1 ? "s" : ""} — need at least 2)
                </span>
              )}
            </div>
            {cursorTimes.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {Array.from({ length: Math.ceil(cursorTimes.length / 2) }, (_, pairIdx) => {
                  const s = cursorTimes[pairIdx * 2];
                  const e = cursorTimes[pairIdx * 2 + 1];
                  return (
                    <span
                      key={pairIdx}
                      style={{
                        background: "rgba(245,158,11,0.18)",
                        border: "1px solid rgba(245,158,11,0.5)",
                        borderRadius: 4,
                        padding: "2px 8px",
                        fontSize: 12,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <span style={{ color: "#fbbf24" }}>inj {pairIdx + 1}:</span>
                      <span
                        title="Click to remove start marker"
                        style={{ cursor: "pointer" }}
                        onClick={() => setCursorTimes((prev) => prev.filter((_, idx) => idx !== pairIdx * 2))}
                      >
                        {s.toFixed(1)} s ×
                      </span>
                      {e != null && (
                        <>
                          <span className="muted">→</span>
                          <span
                            title="Click to remove end marker"
                            style={{ cursor: "pointer" }}
                            onClick={() => setCursorTimes((prev) => prev.filter((_, idx) => idx !== pairIdx * 2 + 1))}
                          >
                            {e.toFixed(1)} s ×
                          </span>
                        </>
                      )}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Method B — dilution series */}
        {buildMode === "dilution" && (
          <div style={{ marginBottom: 14 }}>
            <p className="muted" style={{ marginBottom: 8 }}>
              Define the injection timing and concentration series. Times and concentrations are computed automatically.
            </p>
            <div className="grid">
              <label>
                <span>Injection start time (s)<HelpTip text="Time at which the first injection begins (seconds from the start of the trace)." /></span>
                <input type="text" inputMode="decimal" defaultValue={injStart}
                  onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setInjStart(v); }} />
              </label>
              <label>
                <span>Injection duration (s)<HelpTip text="Duration of each injection window (seconds). All injections share the same duration." /></span>
                <input type="text" inputMode="decimal" defaultValue={injDur}
                  onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setInjDur(v); }} />
              </label>
              <label>
                <span>Gap between injections (s)<HelpTip text="Dissociation time between consecutive injections (seconds). The analyte is washed off for this duration before the next injection." /></span>
                <input type="text" inputMode="decimal" defaultValue={gapDur}
                  onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setGapDur(v); }} />
              </label>
              <label>
                <span>Number of injections<HelpTip text="Total number of injections in the dilution series." /></span>
                <input type="text" inputMode="decimal" defaultValue={nInj}
                  onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setNInj(v); }} />
              </label>
              <label>
                <span>Final concentration <span className="unit">({concUnit})</span><HelpTip text="Highest analyte concentration in the series, shown in the unit selected above (stored internally in molar). Preceding injections are computed by successively dividing by the dilution factor." /></span>
                <input
                  key={`cFinal-${concUnit}`}
                  type="text"
                  inputMode="decimal"
                  defaultValue={roundDecimals(cFinal / CONC_MULT[concUnit])}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) setCFinal(v * CONC_MULT[concUnit]);
                  }}
                />
              </label>
              <label>
                <span>Dilution factor<HelpTip text="Each step is this many times less concentrated than the next (e.g. 2 = 2-fold serial dilution)." /></span>
                <input type="text" inputMode="decimal" defaultValue={dilFactor}
                  onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setDilFactor(v); }} />
              </label>
              <label>
                <span>Final dissociation (s)<HelpTip text="Duration of the dissociation window appended after the last injection (seconds)." /></span>
                <input type="text" inputMode="decimal" defaultValue={dissDur}
                  onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setDissDur(v); }} />
              </label>
            </div>
            <div style={{ marginTop: 10 }}>
              <button
                className="secondary"
                disabled={!canBuildDilution}
                onClick={buildDilutionSeries}
              >
                Build dilution series steps
              </button>
              {!canBuildDilution && (
                <span className="muted" style={{ marginLeft: 10, fontSize: 12 }}>
                  Load and select a time column first (Tab 1).
                </span>
              )}
            </div>
          </div>
        )}

        {/* Step table — always visible */}
        <table className="result-table">
          <thead>
            <tr>
              <th>Start <span className="unit">(s)</span><HelpTip text="Injection window start time (seconds). Association phase begins here." /></th>
              <th>Stop <span className="unit">(s)</span><HelpTip text="Injection window end time (seconds). Dissociation phase begins after this point." /></th>
              <th>Concentration <span className="unit">({concUnit})</span><HelpTip text="Analyte concentration during this injection, shown in the unit selected above (stored internally in molar). Set to 0 for baseline or dissociation-only segments." /></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {stepsTable.length === 0 ? (
              <tr>
                <td className="muted" colSpan={4}>No steps yet.</td>
              </tr>
            ) : (
              stepsTable.map((s, i) => (
                <tr key={`step-${i}`}>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      defaultValue={roundDecimals(s.start)}
                      onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) updateStep(i, "start", v); }}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      defaultValue={roundDecimals(s.stop)}
                      onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) updateStep(i, "stop", v); }}
                    />
                  </td>
                  <td>
                    <input
                      key={`C-${i}-${concUnit}`}
                      type="text"
                      inputMode="decimal"
                      defaultValue={roundDecimals(s.C / CONC_MULT[concUnit])}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) updateStep(i, "C", v * CONC_MULT[concUnit]);
                      }}
                    />
                  </td>
                  <td><button className="secondary" onClick={() => removeStepRow(i)}>Remove</button></td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="row" style={{ marginTop: 8 }}>
          <button className="secondary" onClick={addStepRow}>Add step</button>
          {stepsTable.length > 0 && (
            <button className="secondary" onClick={() => syncSteps([])}>Clear</button>
          )}
          <span className="muted">{stepsStatus}</span>
        </div>

        {stepsParsed.error && (
          <div className="muted" style={{ marginTop: 6 }}>⚠ {stepsParsed.error}</div>
        )}
      </div>

      {/* Sensorgram preview with step highlights + cursor markers */}
      {previewSeries && (
        <div className="card">
          <h3>Sensorgram preview</h3>
          <Plot
            data={previewSeries.map((s, i) => ({
              x: s.t,
              y: s.y,
              type: "scatter",
              mode: "lines",
              name: s.label,
              line: { color: `hsl(${210 + i * 40}, 80%, 65%)`, width: 1.5 },
            }))}
            layout={{
              margin: { l: 55, r: 10, t: 30, b: 45 },
              paper_bgcolor: "rgba(0,0,0,0)",
              plot_bgcolor: "rgba(0,0,0,0)",
              xaxis: { title: { text: "Time (s)" }, automargin: true },
              yaxis: { title: { text: "Response (RU)" }, automargin: true },
              showlegend: previewSeries.length > 1,
              legend: { orientation: "h" as const, y: -0.3, yanchor: "top", x: 0, xanchor: "left" },
              shapes: [
                ...stepsEffective.map((s) => ({
                  type: "rect" as const,
                  xref: "x" as const,
                  yref: "paper" as const,
                  x0: s.start, x1: s.stop,
                  y0: 0, y1: 1,
                  fillcolor: "rgba(125,211,252,0.18)",
                  line: { width: 0 },
                })),
                ...excludeRows
                  .filter((r) => r.start.trim() && r.stop.trim() && Number.isFinite(Number(r.start)) && Number.isFinite(Number(r.stop)))
                  .map((r) => ({
                    type: "rect" as const,
                    xref: "x" as const,
                    yref: "paper" as const,
                    x0: Number(r.start), x1: Number(r.stop),
                    y0: 0, y1: 1,
                    fillcolor: "rgba(251,146,60,0.20)",
                    line: { width: 0 },
                  })),
                ...cursorShapes,
              ],
            } as any}
            style={{ width: "100%", height: "300px" }}
            useResizeHandler
            config={{ responsive: true, displaylogo: false, edits: { shapePosition: cursorTimes.length > 0 } }}
            onClick={handlePlotClick}
            onRelayout={handleRelayout}
          />
          <div className="muted" style={{ fontSize: 11, marginTop: 6, display: "flex", gap: 14 }}>
            {stepsEffective.length > 0 && (
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ display: "inline-block", width: 12, height: 12, background: "rgba(125,211,252,0.5)", borderRadius: 2 }} />
                Injection steps
              </span>
            )}
            {excludeRows.some((r) => r.start.trim() && r.stop.trim()) && (
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ display: "inline-block", width: 12, height: 12, background: "rgba(251,146,60,0.5)", borderRadius: 2 }} />
                Excluded windows
              </span>
            )}
            {cursorTimes.length > 0 && (
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ display: "inline-block", width: 3, height: 12, background: "#f59e0b", borderRadius: 1 }} />
                Injection markers
              </span>
            )}
          </div>
        </div>
      )}

      {/* Exclude windows card */}
      <div className="card">
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Exclude windows<HelpTip text="Time ranges to ignore during fitting. Points within these windows are removed before the optimizer runs. Use these to mask artefacts such as air bubbles or injection spikes." /></span>
          <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
            Time ranges to exclude from fitting (e.g. air bubbles, injection spikes).
          </span>
        </div>
        <table className="result-table">
          <thead>
            <tr><th>Start <span className="unit">(s)</span></th><th>Stop <span className="unit">(s)</span></th><th>Remove</th></tr>
          </thead>
          <tbody>
            {excludeRows.length === 0 ? (
              <tr>
                <td className="muted" colSpan={3}>No exclusion windows defined.</td>
              </tr>
            ) : (
              excludeRows.map((row, i) => {
                const s = Number(row.start);
                const e = Number(row.stop);
                const invalidRange =
                  row.start.trim() !== "" && row.stop.trim() !== "" &&
                  Number.isFinite(s) && Number.isFinite(e) && e <= s;
                return (
                <tr key={`excl-${i}`}>
                  <td>
                    <input type="text" value={row.start} onChange={(e) => updateExcludeRow(i, "start", e.target.value)} placeholder="e.g. 120" />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={row.stop}
                      onChange={(e) => updateExcludeRow(i, "stop", e.target.value)}
                      placeholder="e.g. 130"
                      style={invalidRange ? { borderColor: "var(--error)" } : undefined}
                      title={invalidRange ? "Stop must be greater than start" : undefined}
                    />
                  </td>
                  <td>
                    <button className="secondary" onClick={() => removeExcludeRow(i)}>Remove</button>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="secondary" onClick={addExcludeRow}>Add window</button>
        </div>
      </div>
    </div>
  );
}
