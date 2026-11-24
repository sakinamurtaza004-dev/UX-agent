// AUDIT STORE: keeps audits on THIS device (chrome.storage.local).
// Nothing here is ever uploaded. The list keeps the 50 most recent audits.
// Depends on: indexEntry() from audit-model.js.

const AuditStore = (() => {
  const INDEX = "auditIndex";
  const MAX = 50;
  const TEMP = "audit:last"; // used when history is switched off: one temporary report
  const get = async (k) => (await chrome.storage.local.get(k))[k];

  async function list() {
    return ((await get(INDEX)) || []).slice().sort((a, b) => b.ts - a.ts);
  }

  // Returns { ok, history, error }. Never throws, so a full disk can't break the popup.
  async function save(rec, keepInHistory) {
    try {
      if (!keepInHistory) {
        await chrome.storage.local.set({ [TEMP]: rec });
        return { ok: true, history: false };
      }
      const idx = await list();
      const next = [indexEntry(rec), ...idx.filter((e) => e.id !== rec.id)].sort((a, b) => b.ts - a.ts);
      const dropped = next.slice(MAX);
      await chrome.storage.local.set({ ["audit:" + rec.id]: rec, [INDEX]: next.slice(0, MAX) });
      if (dropped.length) await chrome.storage.local.remove(dropped.map((e) => "audit:" + e.id));
      return { ok: true, history: true };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  }

  async function getAudit(id) {
    return (await get(id === "last" ? TEMP : "audit:" + id)) || null;
  }

  // The latest earlier audit of the same page (for before-and-after).
  async function previousFor(rec) {
    const norm = normalizeUrl(rec.url);
    const hit = (await list()).find((e) => e.norm === norm && e.id !== rec.id && e.ts < rec.ts);
    return hit ? getAudit(hit.id) : null;
  }

  async function remove(id) {
    await chrome.storage.local.set({ [INDEX]: (await list()).filter((e) => e.id !== id) });
    await chrome.storage.local.remove("audit:" + id);
  }

  async function clearAll() {
    const keys = (await list()).map((e) => "audit:" + e.id);
    await chrome.storage.local.remove([...keys, INDEX, TEMP]);
  }

  async function prefs() {
    return Object.assign({ saveHistory: true }, (await get("prefs")) || {});
  }
  async function setPrefs(p) {
    await chrome.storage.local.set({ prefs: Object.assign(await prefs(), p) });
  }

  return { list, save, getAudit, previousFor, remove, clearAll, prefs, setPrefs, MAX };
})();
