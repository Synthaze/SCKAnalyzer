import { useState, useMemo, useEffect } from "react";
import type { Parsed } from "../types";
import { tryParseSteps, type Step } from "../lib/steps";

export type UseStepsResult = {
  stepsJson: string;
  setStepsJson: (v: string) => void;
  stepsTable: Step[];
  stepsStatus: string;
  setStepsStatus: (v: string) => void;
  stepsParsed: { steps: Step[] | null; error: string | null };
  stepsEffective: Step[];
  syncSteps: (next: Step[]) => void;
  updateStep: (idx: number, field: keyof Step, value: number) => void;
  addStepRow: () => void;
  removeStepRow: (idx: number) => void;
  insertExample: () => void;
  injStart: number;
  setInjStart: (v: number) => void;
  injDur: number;
  setInjDur: (v: number) => void;
  gapDur: number;
  setGapDur: (v: number) => void;
  nInj: number;
  setNInj: (v: number) => void;
  cFinal: number;
  setCFinal: (v: number) => void;
  dilFactor: number;
  setDilFactor: (v: number) => void;
  dissDur: number;
  setDissDur: (v: number) => void;
  buildDilutionSeries: () => void;
  createStepsFromCursors: (cursors: number[]) => void;
};

export function useSteps(parsed: Parsed | null, timeCol: string): UseStepsResult {
  const [stepsJson, setStepsJson] = useState("");
  const [stepsTable, setStepsTable] = useState<Step[]>([]);
  const [stepsStatus, setStepsStatus] = useState("");

  const [injStart, setInjStart] = useState<number>(50);
  const [injDur, setInjDur] = useState<number>(60);
  const [gapDur, setGapDur] = useState<number>(60);
  const [nInj, setNInj] = useState<number>(4);
  const [cFinal, setCFinal] = useState<number>(50e-9);
  const [dilFactor, setDilFactor] = useState<number>(2);
  const [dissDur, setDissDur] = useState<number>(120);

  const stepsParsed = useMemo(() => tryParseSteps(stepsJson), [stepsJson]);

  // Keep stepsTable in sync when stepsJson is set directly (e.g. insertExample)
  useEffect(() => {
    if (!stepsJson.trim()) {
      setStepsTable([]);
      return;
    }
    if (stepsParsed.steps) {
      setStepsTable(stepsParsed.steps);
    }
  }, [stepsJson, stepsParsed.steps]);

  const stepsEffective = useMemo(
    () => (stepsParsed.steps ?? stepsTable).filter((s) => s.stop > s.start),
    [stepsParsed.steps, stepsTable]
  );

  function syncSteps(next: Step[]) {
    setStepsTable(next);
    setStepsJson(JSON.stringify(next, null, 2));
  }

  function updateStep(idx: number, field: keyof Step, value: number) {
    const next = stepsTable.map((s, i) => (i === idx ? { ...s, [field]: value } : s));
    syncSteps(next);
  }

  function addStepRow() {
    const last = stepsTable.length ? stepsTable[stepsTable.length - 1] : null;
    const start = last ? last.stop : 0;
    const stop = last ? last.stop + 60 : 60;
    const C = last ? last.C : 1e-9;
    syncSteps([...stepsTable, { start, stop, C }]);
  }

  function removeStepRow(idx: number) {
    syncSteps(stepsTable.filter((_, i) => i !== idx));
  }

  function insertExample() {
    setStepsJson(
      JSON.stringify(
        [
          { start: 10, stop: 70, C: 1e-9 },
          { start: 70, stop: 130, C: 3e-9 },
          { start: 130, stop: 190, C: 1e-8 },
          { start: 190, stop: 250, C: 3e-8 },
        ],
        null,
        2
      )
    );
    setStepsStatus("Example inserted. Adjust times to match your run.");
  }

  function buildDilutionSeries() {
    if (!parsed || !timeCol) {
      setStepsStatus("Parse a file and pick a time column first.");
      return;
    }
    const t = (parsed.data[timeCol] ?? []).map(Number);
    if (t.length < 2) {
      setStepsStatus("Time column looks empty.");
      return;
    }
    const t0 = Math.min(...t);
    const t1 = Math.max(...t);

    const start = Math.max(injStart, t0);
    const inj = Math.max(0, injDur);
    const gap = Math.max(0, gapDur);
    const n = Math.max(1, Math.floor(nInj));
    const d = Math.max(1, dilFactor);

    if (start >= t1) {
      setStepsStatus("Injection start time must be within the time range of your data.");
      return;
    }
    if (inj <= 0) {
      setStepsStatus("Injection duration must be > 0.");
      return;
    }

    // Ascending: C_i = cFinal / dilFactor^(nInj-1-i)
    const steps: Array<{ start: number; stop: number; C: number }> = [];
    let cur = start;
    for (let i = 0; i < n; i++) {
      const C = cFinal / Math.pow(d, n - 1 - i);
      const s = cur;
      const e = cur + inj;
      steps.push({ start: s, stop: e, C });
      cur = e + gap;
      if (cur > t1) break;
    }

    const lastStop = steps.length ? steps[steps.length - 1].stop : start;
    if (dissDur > 0 && lastStop + dissDur > t1) {
      setStepsStatus(
        `Built ${steps.length} injection(s), but note: dissociation window exceeds your data end (last stop ${lastStop.toFixed(1)}s, data ends ${t1.toFixed(1)}s).`
      );
    } else {
      setStepsStatus(`Built ${steps.length} injection(s) from dilution series.`);
    }

    setStepsJson(JSON.stringify(steps, null, 2));
  }

  function createStepsFromCursors(cursors: number[]) {
    if (cursors.length < 2) {
      setStepsStatus("Need at least 2 markers to create steps.");
      return;
    }
    const sorted = [...cursors].sort((a, b) => a - b);
    const steps: Step[] = [];
    for (let i = 0; i + 1 < sorted.length; i += 2) {
      steps.push({ start: sorted[i], stop: sorted[i + 1], C: 0 });
    }
    syncSteps(steps);
    setStepsStatus(`Created ${steps.length} step(s) from markers. Fill in concentrations.`);
  }

  return {
    stepsJson,
    setStepsJson,
    stepsTable,
    stepsStatus,
    setStepsStatus,
    stepsParsed,
    stepsEffective,
    syncSteps,
    updateStep,
    addStepRow,
    removeStepRow,
    insertExample,
    injStart,
    setInjStart,
    injDur,
    setInjDur,
    gapDur,
    setGapDur,
    nInj,
    setNInj,
    cFinal,
    setCFinal,
    dilFactor,
    setDilFactor,
    dissDur,
    setDissDur,
    buildDilutionSeries,
    createStepsFromCursors,
  };
}
