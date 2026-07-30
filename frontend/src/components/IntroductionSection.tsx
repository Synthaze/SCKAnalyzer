import React from "react";

export default function IntroductionSection() {
  return (
    <div className="card">
      <h3>Welcome to SCKAnalyzer</h3>
      <p style={{ marginBottom: 6 }}>
        SCKAnalyzer is a free, open-source web application for analyzing Single-Cycle Kinetics (SCK) biosensor experiments (SPR / BLI).
      </p>
      <p style={{ marginBottom: 6 }}>
        It performs global, non-linear least-squares fitting of multi-injection sensorgrams to a 1:1 Langmuir binding model, with optional mass-transport limitation, instrument drift, and bulk-offset correction.
      </p>
      <p style={{ marginBottom: 6 }}>
        Developed at the ARNA laboratory (INSERM U1212, University of Bordeaux), it is designed for fast, reproducible kinetic parameter estimation without proprietary software.
      </p>
      <p>
        Source code: <a href="https://github.com/Synthaze/SCKAnalyzer" target="_blank" rel="noopener noreferrer">github.com/synthaze/sckanalyzer</a>
      </p>

      <div
        style={{
          marginTop: 16,
          marginBottom: 16,
          width: "100%",
          maxWidth: 720,
          aspectRatio: "16 / 9",
          marginLeft: "auto",
          marginRight: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px dashed var(--border-hi)",
          borderRadius: "var(--r)",
          background: "var(--surface)",
        }}
      >
        <span className="muted">Tutorial video — coming soon</span>
      </div>

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
          Malard, F. &amp; Di Primo, C. <em>SCKAnalyzer: An Online Tool for Single Cycle Kinetics Data Processing</em>. In preparation, 2026.
        </div>
      </div>
    </div>
  );
}
