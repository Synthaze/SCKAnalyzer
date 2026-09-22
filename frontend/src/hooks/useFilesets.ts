import { useState, useMemo, useCallback } from "react";
import type { Parsed } from "../types";
import { parseCsv } from "../api";

export type Replicate = {
  xCol: string;
  yCol: string;
  name: string;
  refReplicateKey: string;
  blankReplicateKey: string;
  normalizeBaseline: boolean;
};

export type FileDataset = {
  id: string;
  file: File;
  parsed: Parsed | null;
  replicates: Replicate[];
  label: string;
  loading: boolean;
  error: string;
};

export type ComputedSeries = {
  id: string;         // `${datasetId}__${replicateIndex}`
  datasetId: string;
  replicateIndex: number;
  t: number[];
  y: number[];
  // Reference/blank-subtracted response WITHOUT the "Baseline → 0" visual
  // shift applied. That checkbox is a display-only convenience for the
  // Prepare-dataset/Define-steps previews (its own helptext says the fit
  // applies its own baseline correction) — anything sent to the fit must
  // use this field, never `y`, or the visual shift would silently change
  // the fitted values.
  yFit: number[];
  label: string;
};

export type UseFilesetsResult = {
  datasets: FileDataset[];
  addFiles: (files: FileList | File[]) => Promise<void>;
  removeDataset: (id: string) => void;
  updateDataset: (id: string, patch: Partial<FileDataset>) => void;
  updateReplicate: (datasetId: string, repIdx: number, patch: Partial<Replicate>) => void;
  addReplicate: (datasetId: string) => void;
  removeReplicate: (datasetId: string, repIdx: number) => void;
  mergeDatasets: (ids: string[]) => void;
  computedSeries: ComputedSeries[];
  primaryId: string;
  setPrimaryId: (id: string) => void;
  primaryDataset: FileDataset | null;
};

function guessColumn(columns: string[], needles: string[]): string {
  const lower = (s: string) => s.toLowerCase();
  for (const n of needles) {
    const idx = columns.findIndex((c) => lower(c) === lower(n) || lower(c).includes(lower(n)));
    if (idx >= 0) return columns[idx];
  }
  return "";
}

function lerp(tRef: number[], yRef: number[], t: number): number {
  if (tRef.length === 0) return 0;
  if (t <= tRef[0]) return yRef[0];
  if (t >= tRef[tRef.length - 1]) return yRef[tRef.length - 1];
  let lo = 0, hi = tRef.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tRef[mid] <= t) lo = mid; else hi = mid;
  }
  const frac = (t - tRef[lo]) / (tRef[hi] - tRef[lo]);
  return yRef[lo] + frac * (yRef[hi] - yRef[lo]);
}

let _idCounter = 0;
function nextId() {
  return `ds-${++_idCounter}-${Date.now()}`;
}

function defaultReplicate(columns: string[]): Replicate {
  const xCol = guessColumn(columns, ["time", "seconds", "sec", "t", "x"]) || columns[0] || "";
  const yCol = guessColumn(columns, ["ru", "response", "signal", "y"]) || columns[1] || "";
  return { xCol, yCol, name: "", refReplicateKey: "", blankReplicateKey: "", normalizeBaseline: false };
}

// Falls back to "Series N" only when no custom name has been set, and only
// qualifies the dataset label with a series suffix when there's more than
// one series (a custom name is shown regardless, since the user asked for it).
function seriesLabel(datasetLabel: string, rep: Pick<Replicate, "name">, ri: number, repCount: number): string {
  const custom = rep.name.trim();
  if (custom) return `${datasetLabel} · ${custom}`;
  return repCount > 1 ? `${datasetLabel} · Series ${ri + 1}` : datasetLabel;
}

export function useFilesets(): UseFilesetsResult {
  const [datasets, setDatasets] = useState<FileDataset[]>([]);
  const [primaryId, setPrimaryId] = useState<string>("");

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files);

    const placeholders: FileDataset[] = arr.map((f) => ({
      id: nextId(),
      file: f,
      parsed: null,
      replicates: [],
      label: f.name,
      loading: true,
      error: "",
    }));

    setDatasets((prev) => [...prev, ...placeholders]);

    for (const ph of placeholders) {
      try {
        const parsed = await parseCsv(ph.file);
        const rep = defaultReplicate(parsed.columns);
        setDatasets((prev) =>
          prev.map((d) =>
            d.id === ph.id
              ? { ...d, parsed, replicates: [rep], loading: false, error: "" }
              : d
          )
        );
        setPrimaryId((cur) => (cur === "" ? ph.id : cur));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setDatasets((prev) =>
          prev.map((d) => (d.id === ph.id ? { ...d, loading: false, error: msg || "Parse failed." } : d))
        );
      }
    }
  }, []);

  const removeDataset = useCallback((id: string) => {
    setDatasets((prev) => prev.filter((d) => d.id !== id));
    setPrimaryId((cur) => (cur === id ? "" : cur));
  }, []);

  const updateDataset = useCallback((id: string, patch: Partial<FileDataset>) => {
    setDatasets((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, []);

  const updateReplicate = useCallback((datasetId: string, repIdx: number, patch: Partial<Replicate>) => {
    setDatasets((prev) =>
      prev.map((d) =>
        d.id === datasetId
          ? { ...d, replicates: d.replicates.map((r, i) => (i === repIdx ? { ...r, ...patch } : r)) }
          : d
      )
    );
  }, []);

  const addReplicate = useCallback((datasetId: string) => {
    setDatasets((prev) =>
      prev.map((d) => {
        if (d.id !== datasetId || !d.parsed) return d;
        const rep = defaultReplicate(d.parsed.columns);
        return { ...d, replicates: [...d.replicates, rep] };
      })
    );
  }, []);

  const mergeDatasets = useCallback((ids: string[]) => {
    const newId = nextId();
    setDatasets((prev) => {
      const sources = ids
        .map((id) => prev.find((d) => d.id === id))
        .filter((d): d is FileDataset => d != null && d.parsed != null && d.replicates.length > 0);
      if (sources.length < 2) return prev;

      const maxRows = Math.max(...sources.map((d) => d.parsed!.n_rows));
      const allCols: string[] = [];
      const allData: Record<string, (string | number | null)[]> = {};
      const replicates: Replicate[] = [];

      sources.forEach((d, i) => {
        const prefix = `f${i + 1}_`;

        // Prefix/copy each raw column once per source file (columns belong
        // to the file, not to any one of its series).
        for (const col of d.parsed!.columns) {
          const newCol = `${prefix}${col}`;
          allCols.push(newCol);
          const arr = d.parsed!.data[col] as (string | number | null)[];
          allData[newCol] = arr.length < maxRows
            ? [...arr, ...Array<null>(maxRows - arr.length).fill(null)]
            : arr;
        }

        // Carry over *every* series of this source, not just the first —
        // a multi-series dataset must contribute one merged replicate per
        // series, or the extra series are silently dropped.
        d.replicates.forEach((rep) => {
          const newXCol = rep.xCol ? `${prefix}${rep.xCol}` : "";
          const newYCol = rep.yCol ? `${prefix}${rep.yCol}` : "";
          replicates.push({
            xCol: newXCol || `${prefix}${d.parsed!.columns[0]}`,
            yCol: newYCol || `${prefix}${d.parsed!.columns[1] ?? d.parsed!.columns[0]}`,
            name: rep.name,
            refReplicateKey: rep.refReplicateKey,
            blankReplicateKey: rep.blankReplicateKey,
            normalizeBaseline: rep.normalizeBaseline,
          });
        });
      });

      const mergedParsed: Parsed = { columns: allCols, n_rows: maxRows, data: allData };

      const csvLines = [allCols.join(",")];
      for (let r = 0; r < maxRows; r++) {
        csvLines.push(allCols.map((c) => allData[c][r] ?? "").join(","));
      }
      const label = sources.map((d) => d.label).join(" + ");
      const syntheticFile = new File([csvLines.join("\n")], `${label}.csv`, { type: "text/csv" });

      const mergedDs: FileDataset = {
        id: newId,
        file: syntheticFile,
        parsed: mergedParsed,
        replicates,
        label,
        loading: false,
        error: "",
      };

      // Source datasets are kept as-is; merging only adds a new combined
      // dataset rather than replacing/removing the files it was built from.
      return [...prev, mergedDs];
    });
    setPrimaryId(newId);
  }, []);

  const removeReplicate = useCallback((datasetId: string, repIdx: number) => {
    setDatasets((prev) =>
      prev.map((d) =>
        d.id === datasetId
          ? { ...d, replicates: d.replicates.filter((_, i) => i !== repIdx) }
          : d
      )
    );
  }, []);

  const computedSeries = useMemo<ComputedSeries[]>(() => {
    // Pass 1: compute raw (sorted, uncorrected) series per (dataset, replicateIndex)
    type BaseEntry = { t: number[]; y: number[] };
    const rawSeries: Map<string, BaseEntry> = new Map();

    for (const d of datasets) {
      if (!d.parsed) continue;
      for (let ri = 0; ri < d.replicates.length; ri++) {
        const rep = d.replicates[ri];
        if (!rep.xCol || !rep.yCol) continue;

        const tRaw = (d.parsed.data[rep.xCol] ?? []).map(Number);
        const yRaw = (d.parsed.data[rep.yCol] ?? []).map(Number);

        const order = tRaw
          .map((v, i) => [v, i] as [number, number])
          .sort((a, b) => a[0] - b[0])
          .map((p) => p[1]);
        const t = order.map((i) => tRaw[i]);
        const ySorted = order.map((i) => yRaw[i]);

        rawSeries.set(`${d.id}__${ri}`, { t, y: ySorted });
      }
    }

    // Pass 2: single reference subtraction — sample − ref (and, uniformly,
    // buffer − buffer_ref for whatever dataset is used as someone's blank).
    const singleRefSeries: Map<string, BaseEntry> = new Map();

    for (const d of datasets) {
      if (!d.parsed) continue;
      for (let ri = 0; ri < d.replicates.length; ri++) {
        const rep = d.replicates[ri];
        if (!rep.xCol || !rep.yCol) continue;

        const key = `${d.id}__${ri}`;
        const base = rawSeries.get(key);
        if (!base) continue;

        let y = base.y;

        // refReplicateKey stores a specific replicate key ("datasetId__index"),
        // not just a dataset id, so a multi-replicate reference file is
        // disambiguated rather than always falling back to its replicate 0.
        if (rep.refReplicateKey && rep.refReplicateKey !== key) {
          const refBase = rawSeries.get(rep.refReplicateKey);
          if (refBase && refBase.t.length > 0) {
            y = base.t.map((t, i) => base.y[i] - lerp(refBase.t, refBase.y, t));
          }
        }

        singleRefSeries.set(key, { t: base.t, y });
      }
    }

    // Pass 3: double reference (blank) subtraction — (sample − sample_ref) −
    // (blank − blank_ref) — then baseline normalization on the final,
    // displayed trace. Baseline correction must come last and be driven by
    // the sample replicate's own toggle — otherwise it silently depends on
    // whichever baseline flag happens to be set on the reference/blank
    // dataset's own replicate. Only one level of blank nesting is applied:
    // the blank's own blank (if any) is not chained further.
    const result: ComputedSeries[] = [];

    for (const d of datasets) {
      if (!d.parsed) continue;
      for (let ri = 0; ri < d.replicates.length; ri++) {
        const rep = d.replicates[ri];
        if (!rep.xCol || !rep.yCol) continue;

        const key = `${d.id}__${ri}`;
        const corrected = singleRefSeries.get(key);
        if (!corrected) continue;

        let yFit = corrected.y;

        // blankReplicateKey likewise stores a specific replicate key.
        if (rep.blankReplicateKey && rep.blankReplicateKey !== key) {
          const blankCorrected = singleRefSeries.get(rep.blankReplicateKey);
          if (blankCorrected && blankCorrected.t.length > 0) {
            yFit = corrected.t.map((t, i) => yFit[i] - lerp(blankCorrected.t, blankCorrected.y, t));
          }
        }

        // yFit (ref/blank-subtracted only) is what gets fitted. y adds the
        // "Baseline → 0" visual shift on top, for display purposes only.
        let y = yFit;
        if (rep.normalizeBaseline && y.length > 0) {
          const n5pct = Math.max(1, Math.floor(y.length * 0.05));
          const slice = y.slice(0, n5pct);
          const sorted = [...slice].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          const median =
            sorted.length % 2 === 0
              ? (sorted[mid - 1] + sorted[mid]) / 2
              : sorted[mid];
          y = y.map((v) => v - median);
        }

        const label = seriesLabel(d.label, rep, ri, d.replicates.length);

        result.push({ id: key, datasetId: d.id, replicateIndex: ri, t: corrected.t, y, yFit, label });
      }
    }

    return result;
  }, [datasets]);

  const primaryDataset = useMemo<FileDataset | null>(() => {
    if (primaryId) {
      const found = datasets.find((d) => d.id === primaryId);
      if (found) return found;
    }
    return datasets[0] ?? null;
  }, [datasets, primaryId]);

  return {
    datasets,
    addFiles,
    removeDataset,
    updateDataset,
    updateReplicate,
    addReplicate,
    removeReplicate,
    mergeDatasets,
    computedSeries,
    primaryId,
    setPrimaryId,
    primaryDataset,
  };
}
