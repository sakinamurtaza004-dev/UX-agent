// SHOW ON PAGE: draws boxes over the elements behind an issue.
//
// Injected on demand (when the user clicks "Show on page"). It reads the
// element list the scanner saved for that check and draws outlines in a
// shadow-DOM overlay that never touches the page's own styles or events
// (pointer-events: none), with one small "Clear" button. Esc also clears.
// Highlights disappear on their own after a minute, and when the page reloads.
(() => {
  const HOST_ID = "__uxab-overlay";
  let cleanup = null;

  function clear() {
    if (cleanup) { cleanup(); cleanup = null; }
    const old = document.getElementById(HOST_ID);
    if (old) old.remove();
  }

  function highlight(checkId) {
    clear();
    const all = (window.__uxabTargets && window.__uxabTargets[checkId]) || [];
    const live = all.filter((el) => el.isConnected);
    if (!live.length) return { shown: 0, total: all.length, gone: all.length };
    const els = live.slice(0, 60);

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent =
      ".b{position:fixed;box-sizing:border-box;border:2px solid #F04438;background:rgba(240,68,56,.14);border-radius:4px;pointer-events:none}" +
      ".n{position:absolute;top:-10px;left:-2px;background:#F04438;color:#fff;font:700 10px/14px system-ui,sans-serif;padding:0 5px;border-radius:7px;min-width:14px;text-align:center}" +
      ".c{position:fixed;top:12px;right:12px;pointer-events:auto;background:#101828;color:#fff;border:0;border-radius:8px;padding:8px 12px;font:600 12px system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)}" +
      ".c:focus-visible{outline:2px solid #fff;outline-offset:2px}";
    root.append(style);

    const boxes = els.map((el, i) => {
      const b = document.createElement("div");
      b.className = "b";
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = String(i + 1);
      b.append(n);
      root.append(b);
      return b;
    });
    const btn = document.createElement("button");
    btn.className = "c";
    btn.type = "button";
    btn.textContent = `Clear highlights (${all.length > els.length ? els.length + " of " + all.length : els.length})`;
    btn.addEventListener("click", clear);
    root.append(btn);
    document.documentElement.append(host);

    let queued = false;
    const place = () => {
      queued = false;
      els.forEach((el, i) => {
        const r = el.getBoundingClientRect(), b = boxes[i];
        const hidden = r.width === 0 && r.height === 0;
        b.style.display = hidden ? "none" : "block";
        b.style.left = r.left - 2 + "px";
        b.style.top = r.top - 2 + "px";
        b.style.width = Math.max(r.width, 8) + 4 + "px";
        b.style.height = Math.max(r.height, 8) + 4 + "px";
      });
    };
    const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(place); } };
    const onKey = (e) => { if (e.key === "Escape") clear(); };
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.addEventListener("keydown", onKey, true);
    const timer = setTimeout(clear, 60000);
    cleanup = () => {
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("keydown", onKey, true);
      clearTimeout(timer);
    };

    place();
    els[0].scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    return { shown: els.length, total: all.length, gone: all.length - live.length };
  }

  window.__uxabHighlight = highlight;
  window.__uxabClear = clear;
})();
