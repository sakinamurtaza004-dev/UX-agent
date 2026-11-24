// HISTORY PAGE: lists saved audits, opens reports, compares before and after,
// deletes, exports. Everything is stored on this device only.
// Built with textContent only (see lib/dom.js).

const fmt = (ts) => new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const color = (s) => (s >= 80 ? "var(--pass)" : s >= 60 ? "var(--medium)" : "var(--high)");
const VL = { followed: "followed", partly: "partly followed", not: "not followed" };
const ul = (items) => { const u = el("ul"); items.forEach((t) => u.append(el("li", { text: t }))); return u; };

async function renderCompare(idA, idB) {
  const box = document.getElementById("compare");
  box.replaceChildren();
  if (!idA || !idB) return;
  const [a, b] = await Promise.all([AuditStore.getAudit(idA), AuditStore.getAudit(idB)]);
  if (!a || !b) { box.append(el("p", { class: "empty", text: "One of those audits is no longer saved." })); return; }
  const [older, newer] = a.ts <= b.ts ? [a, b] : [b, a];
  const c = compareAudits(older, newer);
  const cls = c.delta > 0 ? "up" : c.delta < 0 ? "down" : "same";

  const card = el("div", { class: "cmp" },
    el("h2", { text: "Before and after" }),
    el("div", { class: "meta", text: `${fmt(older.ts)}  →  ${fmt(newer.ts)}${c.days ? ` (${c.days} day${c.days === 1 ? "" : "s"} apart)` : ""}` }),
    el("div", { class: `delta ${cls}`, text: `${c.scoreFrom} → ${c.scoreTo}  (${c.delta > 0 ? "+" : ""}${c.delta})` }));
  if (!c.sameUrl) card.append(el("div", { class: "banner warn", text: "These two audits are of different pages, so the comparison may not be like for like." }));

  card.append(el("h3", { text: `Fixed (${c.fixed.length})` }), c.fixed.length ? ul(c.fixed) : el("div", { class: "small", text: "Nothing newly fixed." }));
  card.append(el("h3", { text: `New problems (${c.regressed.length})` }), c.regressed.length ? ul(c.regressed) : el("div", { class: "small", text: "No new problems." }));
  card.append(el("h3", { text: `Still failing (${c.still.length})` }), c.still.length ? ul(c.still) : el("div", { class: "small", text: "Nothing is still failing." }));
  if (c.lawChanges.length) {
    card.append(el("h3", { text: "UX law changes" }), ul(c.lawChanges.map((l) => `${l.name}: ${VL[l.from]} → ${VL[l.to]} (${l.improved ? "improved" : "worse"})`)));
  }
  card.append(el("div", { class: "small", text: "Comparisons cover the automatic checks and measured UX laws. The AI review is not compared, because it can vary between runs." }));
  const close = el("button", { text: "Close comparison" });
  close.addEventListener("click", () => { box.replaceChildren(); history.replaceState(null, "", "history.html"); });
  card.append(el("p", {}, close));
  box.append(card);
}

async function renderList() {
  const root = document.getElementById("list");
  const items = await AuditStore.list();
  root.replaceChildren();
  if (!items.length) {
    root.append(el("p", { class: "empty", text: "No saved audits yet. Scan a page with the extension and it will appear here." }));
    return;
  }
  for (const e of items) {
    const mini = el("div", { class: "mini", text: String(e.score) });
    mini.style.setProperty("--c", color(e.score));

    const open = el("a", { class: "btn", href: "report.html?id=" + encodeURIComponent(e.id), target: "_blank", text: "Open report" });
    const btns = el("div", { class: "btns" }, open);

    // The previous audit of the same page, if any, enables a before/after view.
    const prev = items.find((o) => o.norm === e.norm && o.ts < e.ts);
    if (prev) {
      const cmp = el("button", { text: "Compare with previous" });
      cmp.addEventListener("click", () => {
        history.replaceState(null, "", `history.html?compare=${prev.id},${e.id}`);
        renderCompare(prev.id, e.id);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      btns.append(cmp);
    }
    const del = el("button", { class: "danger", text: "Delete" });
    del.addEventListener("click", async () => {
      if (!confirm("Delete this audit from this device?")) return;
      await AuditStore.remove(e.id);
      renderList();
      document.getElementById("compare").replaceChildren();
    });
    btns.append(del);

    root.append(el("div", { class: "row" }, mini, el("div", {},
      el("div", { class: "t", text: e.title || "(untitled page)" }),
      el("div", { class: "u", text: e.url }),
      el("div", { class: "u", text: `${fmt(e.ts)} · ${e.failed} issues · ${e.passed} passed${e.hasAI ? " · AI review" : ""}` }),
      btns)));
  }
}

async function main() {
  const prefs = await AuditStore.prefs();
  const box = document.getElementById("pref-save");
  box.checked = prefs.saveHistory;
  box.addEventListener("change", () => AuditStore.setPrefs({ saveHistory: box.checked }));

  document.getElementById("btn-clear").addEventListener("click", async () => {
    if (!confirm("Delete ALL saved audits from this device? This can't be undone.")) return;
    await AuditStore.clearAll();
    renderList();
    document.getElementById("compare").replaceChildren();
  });
  document.getElementById("btn-export").addEventListener("click", async () => {
    const all = [];
    for (const e of await AuditStore.list()) { const r = await AuditStore.getAudit(e.id); if (r) all.push(r); }
    const url = URL.createObjectURL(new Blob([JSON.stringify(all, null, 2)], { type: "application/json" }));
    const a = el("a", { href: url, download: `ux-audit-history_${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });

  await renderList();
  const cmp = new URLSearchParams(location.search).get("compare");
  if (cmp) { const [x, y] = cmp.split(","); await renderCompare(x, y); }
}
main();
