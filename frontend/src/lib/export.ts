import Plotly from "plotly.js-dist-min";

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadPlotPng(div: Plotly.PlotlyHTMLElement | null, filename: string) {
  if (!div) return;
  const url = await Plotly.toImage(div, { format: "png", scale: 2 } as Plotly.ToImgopts);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

export function dataUrlToBlob(dataUrl: string) {
  const parts = dataUrl.split(",");
  const mime = parts[0].match(/:(.*?);/)?.[1] || "image/png";
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8 = new Uint8Array(n);
  while (n--) u8[n] = bstr.charCodeAt(n);
  return new Blob([u8], { type: mime });
}
