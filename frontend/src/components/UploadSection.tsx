import React, { useRef, useState, useCallback, useMemo } from "react";
import Plot from "react-plotly.js";
import Plotly from "plotly.js-dist-min";
import type { UseFilesetsResult } from "../hooks/useFilesets";
import HelpTip from "./HelpTip";
import { downloadText, downloadPlotPng } from "../lib/export";

type Props = {
  filesets: UseFilesetsResult;
  stepsForShading: Array<{ start: number; stop: number; C: number }>;
};

export default function UploadSection({ filesets, stepsForShading }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [mergeSelection, setMergeSelection] = useState<Set<string>>(new Set());
  const plotDivRef = useRef<Plotly.PlotlyHTMLElement | null>(null);

  const {
    datasets, addFiles, removeDataset, updateDataset,
    updateReplicate, addReplicate, removeReplicate, mergeDatasets,
    computedSeries, primaryId, setPrimaryId, primaryDataset,
  } = filesets;

  // All series belonging to the active dataset — a merged/multi-replicate
  // dataset has more than one, and every one of them must be exported.
  const activeDatasetSeries = computedSeries.filter(
    (s) => s.datasetId === (primaryId || primaryDataset?.id)
  );

  const sensorgramCsv = useMemo(() => {
    if (activeDatasetSeries.length === 0) return "";
    const maxLen = Math.max(...activeDatasetSeries.map((s) => s.t.length));
    if (maxLen === 0) return "";
    const header = activeDatasetSeries
      .flatMap((s) => [`${s.label}_time_s`, `${s.label}_response_ru`])
      .join(",");
    const rows: string[] = [];
    for (let i = 0; i < maxLen; i++) {
      const cells = activeDatasetSeries.flatMap((s) => [
        i < s.t.length ? String(s.t[i]) : "",
        i < s.y.length ? String(s.y[i]) : "",
      ]);
      rows.push(cells.join(","));
    }
    return [header, ...rows].join("\n");
  }, [activeDatasetSeries]);

  const datasetCsv = useMemo(() => {
    if (!primaryDataset?.parsed) return "";
    const { data, n_rows } = primaryDataset.parsed;
    const selectedCols = new Set<string>();
    primaryDataset.replicates.forEach((r) => {
      if (r.xCol) selectedCols.add(r.xCol);
      if (r.yCol) selectedCols.add(r.yCol);
    });
    const columns = primaryDataset.parsed.columns.filter((c) => selectedCols.has(c));
    const lines = [columns.join(",")];
    for (let i = 0; i < n_rows; i++) {
      lines.push(columns.map((col) => data[col]?.[i] ?? "").join(","));
    }
    return lines.join("\n");
  }, [primaryDataset]);

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
      line: { width: 2 },
      // Non-active-dataset series start hidden but stay in the legend —
      // clicking their legend entry (standard Plotly behavior) re-enables them.
      visible: isPrimary ? true : "legendonly",
    };
  });

  const plotLayout: Partial<Plotly.Layout> = {
    margin: { l: 55, r: 10, t: 45, b: 45 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    xaxis: { title: { text: "Time (s)" }, automargin: true },
    yaxis: { title: { text: "Response" }, automargin: true },
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

  // Lists every replicate across all parsed datasets (including other
  // replicates of the *same* dataset), excluding only the one replicate
  // currently being configured — so a specific reference/blank replicate
  // can be chosen unambiguously, not just its parent dataset.
  const replicateOptions = (excludeDatasetId: string, excludeReplicateIndex: number) => {
    const opts: Array<{ key: string; label: string }> = [];
    for (const d of datasets) {
      if (!d.parsed || d.replicates.length === 0) continue;
      d.replicates.forEach((rep, ri) => {
        if (d.id === excludeDatasetId && ri === excludeReplicateIndex) return;
        const custom = rep.name.trim();
        const label = custom
          ? `${d.label} · ${custom}`
          : d.replicates.length > 1 ? `${d.label} · Series ${ri + 1}` : d.label;
        opts.push({ key: `${d.id}__${ri}`, label });
      });
    }
    return opts;
  };

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

        {datasets.map((ds) => {
          const isPrimary = ds.id === (primaryId || primaryDataset?.id);
          const cols = ds.parsed?.columns ?? [];
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
                <input
                  type="text"
                  value={ds.label}
                  onChange={(e) => updateDataset(ds.id, { label: e.target.value })}
                  title="Dataset name (shown in legends and exports)"
                  style={{
                    fontWeight: 600, fontSize: 13, padding: "2px 6px", minWidth: 100,
                    background: "transparent", color: "inherit",
                    border: "1px solid transparent", borderRadius: 4,
                  }}
                  onFocus={(e) => { e.target.style.border = "1px solid var(--border, #555)"; }}
                  onBlur={(e) => { e.target.style.border = "1px solid transparent"; }}
                />
                {ds.label !== ds.file.name && (
                  <span className="muted" style={{ fontSize: 11 }}>({ds.file.name})</span>
                )}
                {ds.parsed && <span className="muted" style={{ fontSize: 12 }}>{ds.parsed.n_rows} rows</span>}
                {ds.loading && <span className="muted" style={{ fontSize: 12 }}>Parsing…</span>}
                {ds.error && <span style={{ color: "#f87171", fontSize: 12 }}>⚠ {ds.error}</span>}
                <button
                  className="secondary"
                  style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 12 }}
                  onClick={() => removeDataset(ds.id)}
                >
                  Remove dataset
                </button>
              </div>

              {/* Replicates */}
              {cols.length > 0 && ds.replicates.map((rep, ri) => {
                const others = replicateOptions(ds.id, ri);
                return (
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
                  <label style={{ fontSize: 12 }}>
                    <span>Series name<HelpTip text="Optional custom name for this series, shown in legends, exports, and reference/blank selectors instead of the default 'Series N'." /></span>
                    <input
                      type="text"
                      value={rep.name}
                      placeholder={`Series ${ri + 1}`}
                      onChange={(e) => updateReplicate(ds.id, ri, { name: e.target.value })}
                      style={{ padding: "4px 6px", fontSize: 12, width: 110 }}
                    />
                  </label>

                  <label style={{ fontSize: 12 }}>
                    <span>Time (X)<HelpTip text="Column containing time values (seconds). Used as the x-axis of the sensorgram." /></span>
                    <select
                      value={rep.xCol}
                      onChange={(e) => updateReplicate(ds.id, ri, { xCol: e.target.value })}
                      style={{ padding: "4px 6px", fontSize: 12, minWidth: 120 }}
                    >
                      {cols.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>

                  <label style={{ fontSize: 12 }}>
                    <span>Signal (Y)<HelpTip text="Column containing the SPR response signal in RU. This is the binding signal to be fitted." /></span>
                    <select
                      value={rep.yCol}
                      onChange={(e) => updateReplicate(ds.id, ri, { yCol: e.target.value })}
                      style={{ padding: "4px 6px", fontSize: 12, minWidth: 120 }}
                    >
                      {cols.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>

                  <div style={{ borderLeft: "1px solid rgba(255,255,255,0.12)", paddingLeft: 10, display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
                    <span className="muted" style={{ fontSize: 11, alignSelf: "flex-end" }}>Y = Y −</span>
                    <label style={{ fontSize: 12 }}>
                      <span>Ref. sensorgram<HelpTip text="Double-reference subtraction: subtracts a reference channel (blank flow cell) to remove non-specific binding and bulk refractive index shifts." /></span>
                      <select
                        value={rep.refReplicateKey}
                        onChange={(e) => updateReplicate(ds.id, ri, { refReplicateKey: e.target.value })}
                        style={{ padding: "4px 6px", fontSize: 12, width: 140 }}
                      >
                        <option value="">—</option>
                        {others.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                      </select>
                    </label>
                    {rep.refReplicateKey && (
                      <button
                        className="secondary"
                        style={{ padding: "2px 8px", fontSize: 11 }}
                        onClick={() => updateReplicate(ds.id, ri, { refReplicateKey: "" })}
                      >
                        ×
                      </button>
                    )}
                  </div>

                  <div style={{ borderLeft: "1px solid rgba(255,255,255,0.12)", paddingLeft: 10, display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
                    <span className="muted" style={{ fontSize: 11, alignSelf: "flex-end" }}>−</span>
                    <label style={{ fontSize: 12 }}>
                      <span>Blank run (double-ref)<HelpTip text="Double referencing: subtracts another already-referenced run (typically a buffer/blank injection) from this trace, i.e. (this − ref) − (blank − blank's own ref). Give the blank dataset its own Ref. sensorgram above to fill in the blank_ref term; leave it unset for plain blank subtraction." /></span>
                      <select
                        value={rep.blankReplicateKey}
                        onChange={(e) => updateReplicate(ds.id, ri, { blankReplicateKey: e.target.value })}
                        style={{ padding: "4px 6px", fontSize: 12, width: 140 }}
                      >
                        <option value="">—</option>
                        {others.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                      </select>
                    </label>
                    {rep.blankReplicateKey && (
                      <button
                        className="secondary"
                        style={{ padding: "2px 8px", fontSize: 11 }}
                        onClick={() => updateReplicate(ds.id, ri, { blankReplicateKey: "" })}
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
                      Remove series
                    </button>
                  )}
                </div>
                );
              })}

              {cols.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <button
                    className="secondary"
                    style={{ padding: "4px 10px", fontSize: 12 }}
                    onClick={() => addReplicate(ds.id)}
                  >
                    + Add series
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <div style={{ marginTop: 14 }}>
          <button
            className="primary"
            style={{ padding: "6px 14px", fontSize: 12 }}
            disabled={mergeSelection.size < 2}
            onClick={() => {
              mergeDatasets([...mergeSelection]);
              setMergeSelection(new Set());
            }}
          >
            {mergeSelection.size >= 2 ? `Merge ${mergeSelection.size} datasets as new` : "Merge datasets as new"}
          </button>
        </div>
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
            onInitialized={(_: any, div: HTMLElement) => { plotDivRef.current = div as Plotly.PlotlyHTMLElement; }}
            onUpdate={(_: any, div: HTMLElement) => { plotDivRef.current = div as Plotly.PlotlyHTMLElement; }}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="secondary"
              onClick={() => downloadPlotPng(plotDivRef.current, "sckanalyzer-sensorgram.png")}>
              Export PNG
            </button>
            <button className="secondary"
              onClick={() => sensorgramCsv && downloadText("sckanalyzer-sensorgram.csv", sensorgramCsv)}
              disabled={!sensorgramCsv}>
              Export CSV
            </button>
          </div>
        </div>
      )}

      {/* Data table for primary dataset */}
      {primaryDataset?.parsed && (() => {
        const { data, n_rows } = primaryDataset.parsed;
        const selectedCols = new Set<string>();
        primaryDataset.replicates.forEach((r) => {
          if (r.xCol) selectedCols.add(r.xCol);
          if (r.yCol) selectedCols.add(r.yCol);
        });
        const columns = primaryDataset.parsed.columns.filter((c) => selectedCols.has(c));
        const MAX_ROWS = 500;
        const shown = Math.min(n_rows, MAX_ROWS);
        return (
          <div className="card">
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Data — {primaryDataset.label}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                {n_rows} rows · {columns.length} columns
                {n_rows > MAX_ROWS && ` · showing first ${MAX_ROWS}`}
              </span>
              <button className="secondary" style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 12 }}
                onClick={() => datasetCsv && downloadText("sckanalyzer-dataset.csv", datasetCsv)}
                disabled={!datasetCsv}>
                Export CSV
              </button>
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
                        <td className="muted" style={{ padding: "2px 8px", textAlign: "left" }}>{i + 1}</td>
                        {columns.map((col) => {
                          const v = data[col]?.[i];
                          return (
                            <td key={col} style={{ padding: "2px 8px", textAlign: "left", whiteSpace: "nowrap" }}>
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
