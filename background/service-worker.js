// BACKGROUND SCRIPT (service worker): the "back office" of the extension.
//
// Its job: when the user clicks the toolbar icon, open the side panel for THAT
// tab only. Clicking the icon is also what gives Chrome's permission (activeTab)
// to read that page, so we handle the click ourselves instead of letting Chrome
// open the panel on its own.
//
// Tab-specific panels behave the way users expect: switching to another tab
// hides the panel, and switching back shows it again.

const PANEL_PATH = "panel.html";
const warn = (what) => (e) => console.warn(`UX Audit Buddy: ${what} failed:`, e && e.message ? e.message : e);

// Off everywhere by default; we switch it on per tab. (An earlier version asked Chrome to
// open the panel on icon click and Chrome remembers that, so we explicitly turn it off.)
function setup() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(warn("panel behaviour"));
  chrome.sidePanel.setOptions({ enabled: false }).catch(warn("default options"));
}
setup();
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);

// Tabs the panel was opened on (kept in session storage because this worker sleeps).
async function openedTabs() {
  try { return new Set((await chrome.storage.session.get("openedTabs")).openedTabs || []); } catch (e) { return new Set(); }
}
async function remember(tabId, on) {
  try {
    const s = await openedTabs();
    on ? s.add(tabId) : s.delete(tabId);
    await chrome.storage.session.set({ openedTabs: [...s] });
  } catch (e) { /* not fatal */ }
}

// Must run straight away inside the click: Chrome only lets us open a panel in response to a user action.
function openPanelForTab(tab) {
  const enable = chrome.sidePanel.setOptions({ tabId: tab.id, path: PANEL_PATH, enabled: true });
  const open = chrome.sidePanel.open({ tabId: tab.id });
  remember(tab.id, true);
  return Promise.allSettled([enable, open]).then((r) => { r.forEach((x) => x.status === "rejected" && warn("opening the panel")(x.reason)); return r; });
}
chrome.action.onClicked.addListener(openPanelForTab);

// Keep the panel on the same tab when the page navigates or reloads.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== "loading") return;
  if ((await openedTabs()).has(tabId)) chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true }).catch(warn("keeping the panel"));
});
chrome.tabs.onRemoved.addListener((tabId) => remember(tabId, false));

// Handles for automated tests (harmless in normal use).
globalThis.__uxab = { openPanelForTab, openedTabs, setup };
