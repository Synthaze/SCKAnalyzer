import { useLayoutEffect, useMemo, useRef, useState } from "react";
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

  // Concentration inputs (step table rows + the dilution builder's Final
  // concentration) are uncontrolled — see the note above the dilution grid
  // below — so a genuine unit switch can't be handled by just changing
  // their `defaultValue` prop (React never re-applies that after mount).
  // Previously this was forced via a concUnit-tied `key`, remounting the
  // input — but remounting a *focused* input makes the browser fire a
  // native blur first, which committed the already-rounded display text
  // back as a "new" value, silently corrupting the stored concentration.
  // Instead, on a unit change, push the newly-converted text into each
  // input directly via these refs, skipping any input that currently has
  // focus (its display just lags one unit-switch behind until it's blurred
  // — the underlying value was never touched, no correction survives it).
  const concInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const cFinalInputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    for (const [i, el] of concInputRefs.current) {
      if (document.activeElement === el) continue;
      const s = stepsTable[i];
      if (s) el.value = String(roundDecimals(s.C / CONC_MULT[concUnit]));
    }
    const cFinalEl = cFinalInputRef.current;
    if (cFinalEl && document.activeElement !== cFinalEl) {
      cFinalEl.value = String(roundDecimals(cFinal / CONC_MULT[concUnit]));
    }
    // Deliberately scoped to concUnit alone: a genuine value change (e.g.
    // rebuilding the dilution series) is handled separately, by the
    // value-based `key` on each row's concentration input forcing a fresh
    // mount with the right defaultValue — this effect's only job is the
    // "same value, different unit" resync.
  }, [concUnit]);

  // In "add marker" mode, every plot click appends a new marker time (kept
  // sorted). Marker pairing (odd = start, even = end) happens later, in
  // useSteps.ts's createStepsFromCursors, not here.
  function handlePlotClick(event: Readonly<Plotly.PlotMouseEvent>) {
    if (!addCursorMode) return;
    const pt = event.points?.[0];
    if (pt == null) return;
    const t = pt.x as number;
    setCursorTimes((prev) => [...prev, t].sort((a, b) => a - b));
  }

  // The three shape groups drawn on the preview plot below, in the fixed
  // order they must appear in layout.shapes: injection-step rectangles,
  // then exclude-window rectangles, then cursor lines. Each is memoized so
  // that BOTH the rendered shapes array further down AND handleRelayout's
  // index math (below) are built from these exact same array values —
  // previously each was recomputed independently in two separate places
  // (a stale/incorrect step count in one, the JSX in the other), which is
  // exactly what let their bookkeeping silently drift out of sync. With a
  // single shared source of truth for each group's contents and count,
  // that class of mismatch can no longer occur.
  const injectionShapes = useMemo(
    () =>
      stepsEffective.map((s) => ({
        type: "rect" as const,
        xref: "x" as const,
        yref: "paper" as const,
        x0: s.start, x1: s.stop,
        y0: 0, y1: 1,
        fillcolor: "rgba(125,211,252,0.18)",
        line: { width: 0 },
      })),
    [stepsEffective]
  );

  // The same "is this row usable" definition the fit itself relies on for
  // exclude windows (see useFitOptions.ts's excludesJson) — a row only
  // counts once both fields are non-empty AND numeric.
  const validExcludeRows = useMemo(
    () =>
      excludeRows.filter(
        (r) =>
          r.start.trim() && r.stop.trim() &&
          Number.isFinite(Number(r.start)) && Number.isFinite(Number(r.stop))
      ),
    [excludeRows]
  );

  const excludeShapes = useMemo(
    () =>
      validExcludeRows.map((r) => ({
        type: "rect" as const,
        xref: "x" as const,
        yref: "paper" as const,
        x0: Number(r.start), x1: Number(r.stop),
        y0: 0, y1: 1,
        fillcolor: "rgba(251,146,60,0.20)",
        line: { width: 0 },
      })),
    [validExcludeRows]
  );

  // Dotted amber vertical lines marking not-yet-committed injection markers
  // (before "Create steps from markers" is clicked). editable: true is what
  // lets the user drag them directly on the plot — the only shapes here
  // that ever fire a relayout event, which is why handleRelayout below only
  // needs to locate this group's offset, not identify individual injection/
  // exclude shapes.
  const cursorShapes: Partial<Plotly.Shape>[] = cursorTimes.map((t) => ({
    type: "line" as const,
    xref: "x" as const,
    yref: "paper" as const,
    x0: t, x1: t,
    y0: 0, y1: 1,
    line: { color: "#f59e0b", width: 2, dash: "dot" },
    editable: true,
  }));

  // Plotly's "shapes[i].x0 changed" relayout event fires with i being that
  // shape's index within the combined layout.shapes array below — so a
  // dragged marker's index within cursorTimes is (event shape index) minus
  // however many injection-step and exclude-window shapes precede the
  // cursor-line group, using the exact same arrays the plot itself renders.
  function handleRelayout(event: Readonly<Plotly.PlotRelayoutEvent>) {
    const updates: Record<number, number> = {};
    const cursorStart = injectionShapes.length + excludeShapes.length;
    for (const key of Object.keys(event)) {
      const m = key.match(/^shapes\[(\d+)\]\.x0$/);
      if (m) {
        const idx = Number(m[1]);
        const cursorIdx = idx - cursorStart;
        if (cursorIdx >= 0 && cursorIdx < cursorTimes.length) {
          updates[cursorIdx] = (event as Record<string, unknown>)[key] as number;
        }
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
            {/* These fields (and the step table's inputs further below) are
                uncontrolled: defaultValue + onBlur, committing the value only
                when the field loses focus rather than on every keystroke, so
                typing "1e-9" doesn't get clobbered mid-edit by a re-render.
                Concentration fields are additionally kept in sync with the
                Unit selector via the concInputRefs/cFinalInputRef effect
                above, which imperatively updates their displayed text on a
                unit change without remounting them (see that effect's
                comment for why remounting was the wrong mechanism). */}
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
                {/* cFinal (like every step's C) is always held in the hook
                    as molar; concUnit only controls this field's display —
                    converted on the way in (× CONC_MULT) and out (÷ CONC_MULT). */}
                <span>Final concentration <span className="unit">({concUnit})</span><HelpTip text="Highest analyte concentration in the series, shown in the unit selected above (stored internally in molar). Preceding injections are computed by successively dividing by the dilution factor." /></span>
                <input
                  ref={cFinalInputRef}
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
                  {/* These inputs are uncontrolled (defaultValue + onBlur —
                      see the note on this pattern above the dilution-series
                      grid), so React only ever applies defaultValue at
                      mount. Running "Build dilution series steps" again with
                      the same row count changes s.start/s.stop/s.C from
                      outside this row's own edit, without this row's
                      <input> remounting — which would otherwise leave stale
                      numbers on screen even though stepsJson/the preview
                      plot are already correct. Keying each input by its own
                      current value forces a remount (and thus a fresh
                      defaultValue read) exactly when that value changes for
                      a reason other than the field's own onBlur — by the
                      time such a rebuild runs, the button that triggered it
                      has already blurred this field naturally (clicking
                      elsewhere always blurs the previous focus), so this
                      never fires while the field is still being edited.
                      The Concentration cell's key deliberately excludes
                      concUnit — a unit switch (same value, different
                      display) is handled separately, by the
                      concInputRefs/cFinalInputRef effect above, not by
                      remounting. */}
                  <td>
                    <input
                      key={`start-${i}-${s.start}`}
                      type="text"
                      inputMode="decimal"
                      defaultValue={roundDecimals(s.start)}
                      onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) updateStep(i, "start", v); }}
                    />
                  </td>
                  <td>
                    <input
                      key={`stop-${i}-${s.stop}`}
                      type="text"
                      inputMode="decimal"
                      defaultValue={roundDecimals(s.stop)}
                      onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) updateStep(i, "stop", v); }}
                    />
                  </td>
                  <td>
                    <input
                      key={`C-${i}-${s.C}`}
                      ref={(el) => {
                        if (el) concInputRefs.current.set(i, el);
                        else concInputRefs.current.delete(i);
                      }}
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
              yaxis: { title: { text: "Response" }, automargin: true },
              showlegend: previewSeries.length > 1,
              legend: { orientation: "h" as const, y: -0.3, yanchor: "top", x: 0, xanchor: "left" },
              // Order matters here: handleRelayout above assumes injection
              // steps come first, then exclude windows, then cursor lines —
              // it reads injectionShapes/excludeShapes directly, so this
              // array and that offset calculation can't drift apart.
              shapes: [...injectionShapes, ...excludeShapes, ...cursorShapes],
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
            {/* Reuses validExcludeRows rather than re-checking excludeRows
                directly, so this chip only appears when a rectangle is
                actually rendered for it (a non-empty but non-numeric row
                previously showed the chip with nothing drawn). */}
            {validExcludeRows.length > 0 && (
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
                // Only flags a genuinely invalid (non-empty but stop <= start)
                // row — an empty or mid-typing row is not an error, it's just
                // not sent to the fit yet (see useFitOptions.ts's excludesJson,
                // which applies the same "valid" definition when serializing).
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
