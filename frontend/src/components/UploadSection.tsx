import React, { useRef, useState, useCallback } from "react";
import Plot from "react-plotly.js";
import Plotly from "plotly.js-dist-min";
import type { UseFilesetsResult } from "../hooks/useFilesets";
import HelpTip from "./HelpTip";

type Props = {
  filesets: UseFilesetsResult;
  stepsForShading: Array<{ start: number; stop: number; C: number }>;
};

export default function UploadSection({ filesets, stepsForShading }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [mergeSelection, setMergeSelection] = useState<Set<string>>(new Set());

  const {
    datasets, addFiles, removeDataset, updateDataset,
    updateReplicate, addReplicate, removeReplicate, mergeDatasets,
    computedSeries, primaryId, setPrimaryId, primaryDataset,
  } = filesets;

  const toggleMerge = useCallback((id: string) => {
    setMergeSelection((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const plotData: Plotly.Data[] = computedSeries.map((s) => {
    const isPrimary = s.datasetId === (primaryId || primaryDataset?.id);
    return {
      x: s.t,
      y: s.y,
      type: "scatter",
      mode: "lines",
      name: s.label,
      line: { width: isPrimary ? 2 : 1 },
      opacity: isPrimary ? 1 : 0.6,
    };
  });

  const plotLayout: Partial<Plotly.Layout> = {
    margin: { l: 55, r: 10, t: 45, b: 45 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    xaxis: { title: { text: "Time (s)" }, automargin: true },
    yaxis: { title: { text: "Response (RU)" }, automargin: true },
    title: { text: "Sensorgram preview", font: { color: "#1c1916", size: 14 } },
    showlegend: computedSeries.length > 1,
    legend: { orientation: "h" as const, y: -0.3, yanchor: "top", x: 0, xanchor: "left" },
    shapes: stepsForShading.map((s) => ({
      type: "rect" as const,
      xref: "x" as const,
      yref: "paper" as const,
      x0: s.start, x1: s.stop,
      y0: 0, y1: 1,
      fillcolor: "rgba(125,211,252,0.10)",
      line: { width: 0 },
    })),
  };

  const otherParsedDatasets = (excludeId: string) =>
    datasets.filter((d) => d.id !== excludeId && d.parsed && d.replicates.length > 0);

  return (
    <div>
      {/* File upload card */}
      <div className="card">
        <h3>Upload file results</h3>
        <div
          className={`drop-zone${dragOver ? " drag-over" : ""}`}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files); }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt,.dat,.frd"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                addFiles(e.target.files);
                e.target.value = "";
              }
            }}
          />
          <button className="secondary" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
            Choose files…
          </button>
          <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
            or drag &amp; drop · CSV, TXT, DAT, FRD · multiple files supported
          </div>
        </div>

        {mergeSelection.size >= 2 && (
          <div style={{ marginTop: 10 }}>
            <button
              className="secondary"
              style={{ padding: "5px 12px", fontSize: 12 }}
              onClick={() => {
                mergeDatasets([...mergeSelection]);
                setMergeSelection(new Set());
              }}
            >
              Merge {mergeSelection.size} files into one dataset
            </button>
          </div>
        )}

        {datasets.map((ds) => {
          const isPrimary = ds.id === (primaryId || primaryDataset?.id);
          const cols = ds.parsed?.columns ?? [];
          const others = otherParsedDatasets(ds.id);
          const showMergeCheck = datasets.length >= 2;

          return (
            <div key={ds.id} className={`file-card${isPrimary ? " primary" : ""}`}>
              {/* File header row */}
              <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <label style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <input type="radio" name="primary-dataset" checked={isPrimary} onChange={() => setPrimaryId(ds.id)} />
                </label>
                {showMergeCheck && (
                  <label style={{ flexDirection: "row", alignItems: "center", gap: 4, fontSize: 11 }} title="Select for merge">
                    <input
                      type="checkbox"
                      checked={mergeSelection.has(ds.id)}
                      onChange={() => toggleMerge(ds.id)}
                    />
                    merge
                  </label>
                )}
                <span style={{ fontWeight: 600, fontSize: 13 }}>{ds.file.name}</span>
                {ds.parsed && <span className="muted" style={{ fontSize: 12 }}>{ds.parsed.n_rows} rows</span>}
                {ds.loading && <span className="muted" style={{ fontSize: 12 }}>Parsing…</span>}
                {ds.error && <span style={{ color: "#f87171", fontSize: 12 }}>⚠ {ds.error}</span>}
                <button
                  className="secondary"
                  style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 12 }}
                  onClick={() => removeDataset(ds.id)}
                >
                  Remove
                </button>
              </div>

              {/* Replicates */}
              {cols.length > 0 && ds.replicates.map((rep, ri) => (
                <div
                  key={ri}
                  style={{
                    marginTop: 8,
                    paddingTop: 8,
                    borderTop: "1px solid rgba(255,255,255,0.08)",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    alignItems: "flex-end",
                  }}
                >
                  <span className="muted" style={{ fontSize: 11, alignSelf: "center", minWidth: 48 }}>
                    rep {ri + 1}
                  </span>

                  <label style={{ fontSize: 12 }}>
                    <span>Time (X)<HelpTip text="Column containing time values (seconds). Used as the x-axis of the sensorgram." /></span>
                    <select
                      value={rep.xCol}
                      onChange={(e) => updateReplicate(ds.id, ri, { xCol: e.target.value })}
                      style={{ padding: "4px 6px", fontSize: 12 }}
                    >
                      {cols.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>

                  <label style={{ fontSize: 12 }}>
                    <span>Signal (Y)<HelpTip text="Column containing the SPR response signal in RU. This is the binding signal to be fitted." /></span>
                    <select
                      value={rep.yCol}
                      onChange={(e) => updateReplicate(ds.id, ri, { yCol: e.target.value })}
                      style={{ padding: "4px 6px", fontSize: 12 }}
                    >
                      {cols.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>

                  <label style={{ fontSize: 12 }}>
                    <span>Conc (Z)<HelpTip text="Optional column with analyte concentration (M). Used to auto-detect injection steps from concentration changes." /></span>
                    <select
                      value={rep.concCol}
                      onChange={(e) => updateReplicate(ds.id, ri, { concCol: e.target.value })}
                      style={{ padding: "4px 6px", fontSize: 12 }}
                    >
                      <option value="">—</option>
                      {cols.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>

                  <div style={{ borderLeft: "1px solid rgba(255,255,255,0.12)", paddingLeft: 10, display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
                    <span className="muted" style={{ fontSize: 11, alignSelf: "center" }}>Y = Y −</span>
                    <label style={{ fontSize: 12 }}>
                      <span>Ref. sensorgram<HelpTip text="Double-reference subtraction: subtracts a reference channel (blank flow cell) to remove non-specific binding and bulk refractive index shifts." /></span>
                      <select
                        value={rep.refDatasetId}
                        onChange={(e) => updateReplicate(ds.id, ri, { refDatasetId: e.target.value })}
                        style={{ padding: "4px 6px", fontSize: 12 }}
                      >
                        <option value="">—</option>
                        {others.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                      </select>
                    </label>
                    {rep.refDatasetId && (
                      <button
                        className="secondary"
                        style={{ padding: "2px 8px", fontSize: 11 }}
                        onClick={() => updateReplicate(ds.id, ri, { refDatasetId: "" })}
                      >
                        ×
                      </button>
                    )}
                  </div>

                  <label style={{ flexDirection: "row", alignItems: "center", gap: 4, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={rep.normalizeBaseline}
                      onChange={(e) => updateReplicate(ds.id, ri, { normalizeBaseline: e.target.checked })}
                    />
                    Baseline → 0<HelpTip text="Shifts the trace so the median of the first 5 % of points is zero. Useful for visual alignment; the fit applies its own baseline correction." />
                  </label>

                  {ds.replicates.length > 1 && (
                    <button
                      className="secondary"
                      style={{ padding: "2px 8px", fontSize: 11 }}
                      onClick={() => removeReplicate(ds.id, ri)}
                    >
                      Remove replicate
                    </button>
                  )}
                </div>
              ))}

              {cols.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <button
                    className="secondary"
                    style={{ padding: "4px 10px", fontSize: 12 }}
                    onClick={() => addReplicate(ds.id)}
                  >
                    + Add replicate
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Preview plot */}
      {computedSeries.length > 0 && (
        <div className="card">
          <Plot
            data={plotData}
            layout={plotLayout as Plotly.Layout}
            style={{ width: "100%", height: "380px" }}
            useResizeHandler
            config={{ responsive: true, displaylogo: false }}
          />
        </div>
      )}

      {/* Data table for primary dataset */}
      {primaryDataset?.parsed && (() => {
        const { columns, data, n_rows } = primaryDataset.parsed;
        const MAX_ROWS = 500;
        const shown = Math.min(n_rows, MAX_ROWS);
        return (
          <div className="card">
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Data — {primaryDataset.label}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                {n_rows} rows · {columns.length} columns
                {n_rows > MAX_ROWS && ` · showing first ${MAX_ROWS}`}
              </span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <div style={{ maxHeight: 320, overflowY: "auto" }}>
                <table className="result-table" style={{ minWidth: "100%", fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ position: "sticky", top: 0, background: "var(--card)", zIndex: 1, padding: "4px 8px" }}>#</th>
                      {columns.map((col) => (
                        <th key={col} style={{ position: "sticky", top: 0, background: "var(--card)", zIndex: 1, padding: "4px 8px", whiteSpace: "nowrap" }}>
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: shown }, (_, i) => (
                      <tr key={i}>
                        <td className="muted" style={{ padding: "2px 8px", textAlign: "right" }}>{i + 1}</td>
                        {columns.map((col) => {
                          const v = data[col]?.[i];
                          return (
                            <td key={col} style={{ padding: "2px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                              {v == null ? <span className="muted">—</span> : typeof v === "number" ? v.toPrecision(6) : String(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
