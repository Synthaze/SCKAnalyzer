export type Step = { start: number; stop: number; C: number };
export type InjectionStep = { start: number; stop: number; C: number };

export function tryParseSteps(jsonText: string): { steps: Step[] | null; error: string | null } {
  const s = jsonText.trim();
  if (!s) return { steps: null, error: null };
  try {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) return { steps: null, error: "Steps JSON must be an array." };
    const out: Step[] = [];
    for (let i = 0; i < arr.length; i++) {
      const it = arr[i];
      if (typeof it !== "object" || it === null) return { steps: null, error: `Step ${i} is not an object.` };
      const start = Number((it as any).start);
      const stop = Number((it as any).stop);
      const C = Number((it as any).C);
      if (!Number.isFinite(start) || !Number.isFinite(stop) || !Number.isFinite(C))
        return { steps: null, error: `Step ${i} has non-numeric start/stop/C.` };
      if (stop <= start) return { steps: null, error: `Step ${i} stop must be > start.` };
      out.push({ start, stop, C });
    }
    out.sort((a, b) => a.start - b.start);
    for (let i = 1; i < out.length; i++) {
      if (out[i].start < out[i - 1].stop) return { steps: null, error: "Steps overlap. Ensure stop/start boundaries are ordered." };
    }
    return { steps: out, error: null };
  } catch (e: any) {
    return { steps: null, error: `Invalid JSON: ${String(e?.message ?? e)}` };
  }
}

// DEAD CODE (commented out, not deleted — see dead-code review, 2026-09-22):
// buildInjectionsFromConc() auto-built injection steps from a concentration
// array. It has zero callers anywhere in the frontend — no UI ever exposed
// a concentration-column selector; steps are defined via marker-clicking or
// the dilution-series builder instead (see SckParamsSection.tsx). Mirrors
// the backend's build_steps_from_conc(), also commented out (fit.py).
//
// export function buildInjectionsFromConc(tRaw: number[], cRaw: number[]): InjectionStep[] {
//   if (tRaw.length !== cRaw.length || tRaw.length === 0) return [];
//   const changeIdx: number[] = [];
//   for (let i = 1; i < cRaw.length; i++) if (cRaw[i] !== cRaw[i - 1]) changeIdx.push(i);
//   const boundaries = [0, ...changeIdx, cRaw.length];
//   const inj: InjectionStep[] = [];
//   for (let k = 0; k < boundaries.length - 1; k++) {
//     const a = boundaries[k],
//       b = boundaries[k + 1];
//     if (b - a < 3) continue;
//     const start = tRaw[a];
//     const stop = tRaw[b - 1];
//     const C = cRaw[a];
//     if (C > 0) inj.push({ start, stop, C });
//   }
//   return inj;
// }

export function extractSegment(t: number[], y: number[], start: number, stop: number, normalize: boolean, baseline?: number) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < t.length; i++) {
    const ti = t[i];
    if (ti >= start && ti <= stop) {
      xs.push(ti);
      ys.push(y[i]);
    }
  }
  if (xs.length < 2) return null;
  const y0 = baseline !== undefined ? baseline : ys[0];
  return {
    x: xs.map((v) => v - start),
    y: normalize ? ys.map((v) => v - y0) : ys.slice(),
    baseline: y0,
  };
}

export function buildConcColorScale(steps: InjectionStep[]) {
  const cs = steps.map((s) => Math.max(s.C, 1e-30));
  const logs = cs.map((c) => Math.log10(c));
  const min = Math.min(...logs);
  const max = Math.max(...logs);
  const range = max - min || 1;
  return steps.map((s) => {
    const v = (Math.log10(Math.max(s.C, 1e-30)) - min) / range;
    const hue = 210 - v * 180; // blue -> orange
    return `hsl(${hue.toFixed(1)}, 70%, 55%)`;
  });
}

export function buildOverlapCsv(
  overlap: { assoc: Array<any>; dissoc: Array<any> },
  normalized: boolean,
  baselineSource: "data" | "fit"
) {
  const rows: string[] = [];
  rows.push("phase,inj,label,time_since_phase_s,response_ru,normalized,baseline_source");
  const pushRows = (phase: string, s: any) => {
    const inj = s.name.split(" ")[1] || "";
    for (let i = 0; i < s.x.length; i++) {
      rows.push(`${phase},${inj},${s.name},${s.x[i]},${s.y[i]},${normalized},${baselineSource}`);
    }
  };
  for (const s of overlap.assoc) pushRows("assoc", s);
  for (const s of overlap.dissoc) pushRows("dissoc", s);
  return rows.join("\n");
}

// Side-by-side (wide) layout: each series (one per injection × data/fit) gets
// its own time/response column pair instead of being appended as extra rows,
// so curves line up for spreadsheet comparison. Shorter series are blank-padded.
export function buildOverlapPhaseCsv(
  phase: "assoc" | "dissoc",
  series: Array<any>,
  normalized: boolean,
  baselineSource: "data" | "fit"
) {
  if (series.length === 0) return "";
  const maxLen = Math.max(...series.map((s) => s.x.length));
  const meta = `# phase=${phase}, normalized=${normalized}, baseline_source=${baselineSource}`;
  const header = series.flatMap((s) => [`${s.name}_time_since_phase_s`, `${s.name}_response_ru`]).join(",");
  const rows = [meta, header];
  for (let i = 0; i < maxLen; i++) {
    const cells = series.flatMap((s) => (i < s.x.length ? [String(s.x[i]), String(s.y[i])] : ["", ""]));
    rows.push(cells.join(","));
  }
  return rows.join("\n");
}
