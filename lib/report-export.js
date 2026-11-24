// REPORT EXPORT: file names, downloads and the standalone HTML file.
// Shared by the report page and the side panel's "Download report" menu.
// Depends on lib/dom.js (el), lib/report-render.js (ReportRender).

const safeName = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "page";

// ux-audit_www-example-com_2026-11-24_summary.pdf
function fileBase(a, view) {
  let host = "page";
  try { host = new URL(a.url).hostname; } catch (e) { /* keep default */ }
  return `ux-audit_${safeName(host)}_${new Date(a.ts).toISOString().slice(0, 10)}` + (view ? `_${view}` : "");
}

// Save a file from an extension page without leaving it (no extra permission needed).
function downloadFile(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// A single self-contained .html file: inlined CSS, no scripts, works offline.
async function standaloneHtml(a, view = "full") {
  const css = await (await fetch(chrome.runtime.getURL("report.css"))).text();
  const holder = document.createElement("div");
  holder.append(ReportRender.renderReport(a, view));
  const title = (a.title || "UX Audit Report").replace(/[<&>]/g, " ");
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${title} - UX Audit Report</title><style>${css}</style></head>` +
    `<body style="background:#fafafa"><main>${holder.innerHTML}</main></body></html>`;
}
