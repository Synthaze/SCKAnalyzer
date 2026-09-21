import React from "react";

export default function IntroductionSection() {
  return (
    <div className="card">
      <h3>Welcome to SCKAnalyzer</h3>
      <p style={{ marginBottom: 6 }}>
        SCKAnalyzer is a free, open-source web application for analyzing kinetic data obtained by the Single-Cycle Kinetics (SCK) method on BLI and SPR instruments, as well as on any other instrument capable of measuring interaction kinetics through titration experiments.
      </p>
      <p style={{ marginBottom: 6 }}>
        It performs global, non-linear least-squares fitting of multi-injection sensorgrams to a 1:1 Langmuir binding model only, with optional bulk-offset correction.
      </p>
      <p style={{ marginBottom: 6 }}>
        Developed at the ARNA laboratory (INSERM U1212, University of Bordeaux), it enables fast and reproducible determination of reaction rate constants (<em>k<sub>a</sub></em>, <em>k<sub>d</sub></em>) and equilibrium constants (<em>K<sub>D</sub></em>) without relying on proprietary software.
      </p>
      <p>
        Source code: <a href="https://github.com/Synthaze/SCKAnalyzer" target="_blank" rel="noopener noreferrer">github.com/synthaze/sckanalyzer</a>
      </p>
      <p>
        Sample data: <a href="/statics/data/SCK5.zip" download>SCK5.zip</a>
      </p>

      <video
        src="/statics/mp4/sckanalyzer.mp4?v=20260921c"
        controls
        style={{
          marginTop: 16,
          marginBottom: 16,
          width: "100%",
          maxWidth: 720,
          aspectRatio: "16 / 9",
          marginLeft: "auto",
          marginRight: "auto",
          display: "block",
          borderRadius: "var(--r)",
          background: "var(--surface)",
        }}
      />

      <div
        style={{
          marginTop: 20,
          padding: "14px 18px",
          border: "1px solid var(--accent)",
          borderRadius: "var(--r)",
          background: "var(--accent-faint)",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>If you use this tool, please cite:</div>
        <div style={{ fontSize: 13.5 }}>
          Malard, F., Blanc, J.-M., Schäfer, T. &amp; Di Primo, C. <em>SCKAnalyzer: An Online Tool for Single Cycle Kinetics Data Processing</em>. In preparation, 2026.
        </div>
      </div>
    </div>
  );
}
