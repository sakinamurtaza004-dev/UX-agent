// REPORT PAGE: shows one saved audit as a complete document (summary or full).
// Reads the record from this device's storage (nothing is fetched online).
// The document itself is drawn by lib/report-render.js.

async function main() {
  const root = document.getElementById("root");
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  const a = id ? await AuditStore.getAudit(id) : null;
  if (!a) {
    root.replaceChildren(el("p", { class: "empty", text: "This report wasn't found on this device. It may have been deleted. Open the History page to see saved audits." }));
    document.getElementById("toolbar").querySelectorAll("button, select").forEach((b) => (b.disabled = true));
    return;
  }

  // Which version? The link can say (?view=), otherwise the last one used, otherwise the summary.
  const prefs = await AuditStore.prefs();
  let view = ["summary", "full"].includes(params.get("view")) ? params.get("view") : (prefs.reportView || "summary");
  const select = document.getElementById("view");

  const show = () => {
    select.value = view;
    document.title = `UX Audit ${view === "summary" ? "Summary" : "Report"} - ${a.title || a.url}`;
    root.replaceChildren(ReportRender.renderReport(a, view));
  };
  show();
  select.addEventListener("change", async () => {
    view = select.value;
    show();
    history.replaceState(null, "", `report.html?id=${encodeURIComponent(id)}&view=${view}`);
    await AuditStore.setPrefs({ reportView: view });
  });

  // Print / Save as PDF prints whichever version is on screen.
  document.getElementById("btn-print").addEventListener("click", () => window.print());
  document.getElementById("btn-html").addEventListener("click", async () => downloadFile(fileBase(a, view) + ".html", await standaloneHtml(a, view), "text/html"));
  // "Ask my AI chat": findings only (saved reports don't keep the page's text).
  const slot = document.getElementById("chat-slot");
  document.getElementById("btn-ai").addEventListener("click", () => {
    if (!slot.firstChild) { slot.append(renderChatPanel({ getRecord: () => a })); slot.classList.add("chatslot"); }
    slot.hidden = !slot.hidden;
    if (!slot.hidden) slot.scrollIntoView({ block: "nearest" });
  });
  document.getElementById("btn-json").addEventListener("click", () => downloadFile(fileBase(a) + ".json", JSON.stringify(a, null, 2), "application/json"));
}
main();
