
// App.tsx is the orchestration root: it owns all shared state (via the
// useFilesets/useSteps/useFitOptions hooks), the tab navigation, and the
// only code path that actually calls the fit API (runFit). Every tab
// component below is comparatively "dumb" — it receives what it needs as
// props/hook results and reports user actions back up through callbacks,
// rather than owning cross-tab state itself.
import { useMemo, useRef, useState } from "react";
import type { FitResult } from "./types";
import { fitCsv as fitCsvApi, fitGlobalCsv as fitGlobalCsvApi } from "./api";
import { useFilesets } from "./hooks/useFilesets";
import { useSteps } from "./hooks/useSteps";
import { useFitOptions } from "./hooks/useFitOptions";
import IntroductionSection from "./components/IntroductionSection";
import UploadSection from "./components/UploadSection";
import SckParamsSection from "./components/SckParamsSection";
import FitResultsSection from "./components/FitResultsSection";
import SimulateSection from "./components/SimulateSection";

export default function App() {
  const [activeTab, setActiveTab] = useState<"intro" | "upload" | "sck" | "fit" | "simulate">("intro");
  const filesets = useFilesets();
  const steps = useSteps(
    filesets.primaryDataset?.parsed ?? null,
    filesets.primaryDataset?.replicates[0]?.xCol ?? ""
  );
  const fitOptions = useFitOptions();
  const [fits, setFits] = useState<FitResult[]>([]);
  const fitAbortRef = useRef<AbortController | null>(null);

  // "Injection" specifically means C > 0 — a C = 0 row in the step table is
  // a dissociation-only/baseline segment, not something to overlay-color by
  // concentration or count as a bulk-offset slot. Sorted since the step
  // table lets a user add/reorder rows out of time order.
  const injectionSteps = useMemo(
    () => steps.stepsEffective.filter((s) => s.C > 0).sort((a, b) => a.start - b.start),
    [steps.stepsEffective]
  );

  const stepsForShading = injectionSteps;

  // Feeds only the Define-steps tab's own preview plot (SckParamsSection).
  // Distinct from FitResultsSection's plots, which read `fits` (the actual
  // fit results) instead — this is purely a "does my step table line up
  // with my data" sanity check, computed before any fit has run.
  const sckPreviewSeries = useMemo(() => {
    const primary = filesets.primaryDataset;
    if (!primary) return null;
    const series = filesets.computedSeries.filter((s) => s.datasetId === primary.id);
    return series.length > 0 ? series : null;
  }, [filesets.computedSeries, filesets.primaryDataset]);

  // Gates the "Run fit" button: needs a parsed primary dataset with its
  // first replicate's columns assigned, and a step definition that's both
  // present and (if hand-edited as JSON) actually valid.
  const canFit = useMemo(() => {
    const primary = filesets.primaryDataset;
    if (!primary || !primary.parsed) return false;
    const rep0 = primary.replicates[0];
    if (!rep0?.xCol || !rep0?.yCol) return false;
    if (!steps.stepsJson.trim()) return false;
    if (steps.stepsParsed.error) return false;
    return true;
  }, [filesets.primaryDataset, steps.stepsJson, steps.stepsParsed.error]);

  async function runFit() {
    const primary = filesets.primaryDataset;
    if (!primary || !primary.parsed) return;

    // Fit the already-processed sensorgram (reference/blank-subtracted, as
    // shown in the Upload/Define-steps previews) rather than re-reading the
    // raw file — computedSeries carries that correction, matched back to
    // each configured replicate by its index within the dataset. Uses
    // yFit (never the display-only y), since y may carry the "Baseline → 0"
    // visual shift from the Prepare-dataset tab, which must not leak into
    // the fit — that tab's checkbox is for preview purposes only.
    const seriesByRepIdx = new Map(
      filesets.computedSeries
        .filter((s) => s.datasetId === primary.id)
        .map((s) => [s.replicateIndex, { t: s.t, y: s.yFit }])
    );
    const validReps = primary.replicates
      .map((r, ri) => (r.xCol && r.yCol ? seriesByRepIdx.get(ri) : undefined))
      .filter((s): s is NonNullable<typeof s> => !!s);
    if (validReps.length === 0) return;

    fitAbortRef.current?.abort();
    fitAbortRef.current = new AbortController();
    const signal = fitAbortRef.current.signal;

    const n = validReps.length;
    steps.setStepsStatus(n > 1 ? `Fitting ${n} replicates…` : "Fitting…");
    setFits([]);

    const {
      repFitMode,
      shareRmax,
      shareBulk,
      enableBulk, robustLoss, baselineMode,
      fitKa, fitKd, fitRmax,
      kaBounds, kdBounds, rmaxBounds,
      kaFixed, kdFixed, rmaxFixed,
      bootstrapN, bootstrapSeed, excludesJson,
    } = fitOptions;

    const bounds: Record<string, [number | null, number | null]> = {};
    const fixed: Record<string, number> = {};
    const parseBound = (v: string) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
    if (kaBounds.min || kaBounds.max) bounds.ka = [parseBound(kaBounds.min), parseBound(kaBounds.max)];
    if (kdBounds.min || kdBounds.max) bounds.kd = [parseBound(kdBounds.min), parseBound(kdBounds.max)];
    if (rmaxBounds.min || rmaxBounds.max) bounds.Rmax = [parseBound(rmaxBounds.min), parseBound(rmaxBounds.max)];
    if (!fitKa && kaFixed.trim()) fixed.ka = Number(kaFixed);
    if (!fitKd && kdFixed.trim()) fixed.kd = Number(kdFixed);
    if (!fitRmax && rmaxFixed.trim()) fixed.Rmax = Number(rmaxFixed);

    const boundsJson = Object.keys(bounds).length ? JSON.stringify(bounds) : undefined;
    const fixedJson  = Object.keys(fixed).length  ? JSON.stringify(fixed)  : undefined;

    const sharedArgs = {
      steps_json: steps.stepsJson.trim() ? steps.stepsJson : undefined,
      baseline_mode: baselineMode,
      robust_loss: robustLoss,
      // model/enable_drift are hardcoded, not user-configurable: this app
      // only ever fits the 1:1 Langmuir model with drift disabled. The
      // mass-transport-limited model and instrument drift exist in the
      // backend's fit.py but are commented out there (dead code — not a
      // working/validated feature, see fit.py's dead-code notes) — there is
      // deliberately no UI control for either.
      model: "11" as const,
      enable_drift: false,
      enable_bulk: enableBulk,
      excludes_json: excludesJson.trim() ? excludesJson : undefined,
      bootstrap_n: bootstrapN,
      bootstrap_seed: bootstrapSeed.trim() || undefined,
      bounds_json: boundsJson,
      fixed_json: fixedJson,
      signal,
    };

    try {
      let results;
      if (repFitMode === "global" && n > 1) {
        results = await fitGlobalCsvApi({
          series: validReps.map((r) => ({ t: r.t, y: r.y })),
          share_rmax: shareRmax,
          share_bulk: shareBulk,
          ...sharedArgs,
        });
      } else {
        results = await Promise.all(
          validReps.map((rep) => fitCsvApi({ t: rep.t, y: rep.y, ...sharedArgs }))
        );
      }
      setFits(results);
      const nOk = results.filter((r) => r.success).length;
      steps.setStepsStatus(
        n > 1
          ? `${nOk}/${n} fits complete.`
          : results[0].success ? "Fit complete." : `Fit finished: ${results[0].message}`
      );
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      steps.setStepsStatus(e instanceof Error ? e.message : "Fit failed.");
    }
  }

  return (
    <div className="container">
      <div className="header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24 }}>
        <div>
          <div className="h1">SCKAnalyzer</div>
          <div className="sub">Workflow for single-cycle kinetics fitting.</div>
          <div className="header-meta">
            <span className="chip">SCK</span>
            <span className="chip">1:1 Langmuir</span>
            <span className="chip">Global fitting</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
          <img src="/arna.png" alt="ARNA logo" style={{ height: 56, width: "auto" }} />
          <span className="muted" style={{ fontSize: 11, textAlign: "right", maxWidth: 240, lineHeight: 1.4 }}>
            Developed and maintained at ARNA, INSERM U1212, University of Bordeaux
          </span>
        </div>
      </div>

      <nav className="tabs-nav">
        <button className={`tab-btn${activeTab === "intro" ? " active" : ""}`} onClick={() => setActiveTab("intro")}>
          1 · Discover
        </button>
        <button className={`tab-btn${activeTab === "upload" ? " active" : ""}`} onClick={() => setActiveTab("upload")}>
          2 · Prepare dataset
        </button>
        <button className={`tab-btn${activeTab === "sck" ? " active" : ""}`} onClick={() => setActiveTab("sck")}>
          3 · Define steps
        </button>
        <button className={`tab-btn${activeTab === "fit" ? " active" : ""}`} onClick={() => setActiveTab("fit")}>
          4 · Run fit
        </button>
        <button className={`tab-btn${activeTab === "simulate" ? " active" : ""}`} onClick={() => setActiveTab("simulate")}>
          5 · Simulate
        </button>
      </nav>

      {activeTab === "intro" && <IntroductionSection />}

      {activeTab === "upload" && (
        <UploadSection filesets={filesets} stepsForShading={stepsForShading} />
      )}

      {activeTab === "sck" && (
        <SckParamsSection
          steps={steps}
          canBuildDilution={!!filesets.primaryDataset?.parsed && !!filesets.primaryDataset?.replicates[0]?.xCol}
          previewSeries={sckPreviewSeries}
          excludeRows={fitOptions.excludeRows}
          addExcludeRow={fitOptions.addExcludeRow}
          removeExcludeRow={fitOptions.removeExcludeRow}
          updateExcludeRow={fitOptions.updateExcludeRow}
        />
      )}

      {activeTab === "fit" && (
        <FitResultsSection
          fitOptions={fitOptions}
          runFit={runFit}
          canFit={canFit}
          fits={fits}
          stepsStatus={steps.stepsStatus}
          stepsForShading={stepsForShading}
          // refCol: DEAD CODE (commented out, not deleted — see dead-code
          // review, 2026-09-23) — FitResultsSection never read this prop
          // (also commented out on its side).
          // refCol={filesets.primaryDataset?.replicates[0]?.refReplicateKey ? "ref" : ""}
          injectionSteps={injectionSteps}
        />
      )}

      {activeTab === "simulate" && <SimulateSection />}

      <footer className="muted" style={{ textAlign: "center", padding: "10px 0 24px 0" }}>
        © 2026 ARNA laboratory (INSERM U1212, University of Bordeaux)
      </footer>
    </div>
  );
}
