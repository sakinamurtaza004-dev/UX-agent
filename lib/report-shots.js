// REPORT SCREENSHOTS: takes a picture of each problem area on the page being audited,
// so the PDF can show what the problem looks like.
//
// Only runs when the user clicks Download, only on the tab they audited, and only if that
// tab is still showing the audited page. Pictures go straight into the downloaded file;
// they are never stored by the extension or sent anywhere.
// Uses the access the toolbar click already gave (activeTab + scripting): no extra permission.

const ReportShots = (() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const PAD = 70, MIN_W = 420, MIN_H = 150, MAX_OUT_W = 900;

  // Scroll the first visible offending element of a check into view and report where it is.
  async function locate(tabId, checkId) {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [checkId],
      func: async (id) => {
        const old = document.getElementById("__uxab-overlay"); if (old) old.remove();
        const els = (window.__uxabTargets && window.__uxabTargets[id]) || [];
        const el = els.find((e) => { if (!e.isConnected) return false; const r = e.getBoundingClientRect(); return r.width >= 4 && r.height >= 4; });
        if (!el) return null;
        el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight };
      },
    });
    return result;
  }

  // Cut the area around the element out of a full-window picture and outline the element in red.
  async function crop(dataUrl, box) {
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const k = bmp.width / box.vw;                                         // picture pixels per page pixel
    let cw = Math.min(box.vw, Math.max(box.w + 2 * PAD, MIN_W)), ch = Math.min(box.vh, Math.max(box.h + 2 * PAD, MIN_H));
    let cx = Math.min(Math.max(box.x + box.w / 2 - cw / 2, 0), box.vw - cw), cy = Math.min(Math.max(box.y + box.h / 2 - ch / 2, 0), box.vh - ch);
    const out = Math.min(1, MAX_OUT_W / (cw * k));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(cw * k * out)); canvas.height = Math.max(1, Math.round(ch * k * out));
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(bmp, cx * k, cy * k, cw * k, ch * k, 0, 0, canvas.width, canvas.height);
    const s = k * out;
    const rx = (box.x - cx) * s - 2, ry = (box.y - cy) * s - 2, rw = box.w * s + 4, rh = box.h * s + 4;
    g.fillStyle = "rgba(240,68,56,.12)"; g.fillRect(rx, ry, rw, rh);
    g.strokeStyle = "#F04438"; g.lineWidth = Math.max(2, 2.5 * out * Math.min(k, 2)); g.strokeRect(rx, ry, rw, rh);
    bmp.close();
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.82));
    return { jpeg: new Uint8Array(await blob.arrayBuffer()), w: canvas.width, h: canvas.height };
  }

  // checks: failed checks in the order they appear. Returns { shots: {checkId: {jpeg,w,h}}, reason }.
  async function collect({ tabId, expectedUrl, sameUrl, checks, max, onProgress }) {
    const shots = {};
    let tab;
    try { tab = await chrome.tabs.get(tabId); } catch (e) { return { shots, reason: "The audited tab is closed." }; }
    if (!sameUrl(tab.url, expectedUrl)) return { shots, reason: "The tab is no longer on the audited page." };
    if (!tab.active) return { shots, reason: "The audited tab isn't the one in front." };
    let scroll = null;
    try {
      [{ result: scroll }] = await chrome.scripting.executeScript({ target: { tabId }, func: () => ({ x: scrollX, y: scrollY }) });
      let done = 0, last = 0;
      for (const c of checks) {
        if (done >= max) break;
        let box;
        try { box = await locate(tabId, c.id); } catch (e) { continue; }
        if (!box) continue;
        await sleep(Math.max(0, 650 - (Date.now() - last)));              // Chrome allows about 2 captures a second
        let url;
        try { url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 85 }); last = Date.now(); }
        catch (e) { return { shots, reason: "Chrome didn't allow a screenshot of this tab." }; }
        try { shots[c.id] = await crop(url, box); done++; onProgress && onProgress(done, Math.min(max, checks.length)); } catch (e) { /* skip this one */ }
      }
    } finally {
      if (scroll) { try { await chrome.scripting.executeScript({ target: { tabId }, args: [scroll], func: (s) => scrollTo(s.x, s.y) }); } catch (e) { /* page gone */ } }
    }
    return { shots, reason: Object.keys(shots).length ? "" : "No problem areas could be pictured." };
  }

  return { collect };
})();
