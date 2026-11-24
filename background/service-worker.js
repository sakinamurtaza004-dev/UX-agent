// BACKGROUND SCRIPT (service worker): the "back office" of the extension.
// Its only job: make the toolbar icon open the side panel. Clicking the icon is
// also what gives Chrome permission (activeTab) to read the page you're on.
const openPanelOnIconClick = () =>
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((e) => console.warn("Side panel setup failed:", e));

chrome.runtime.onInstalled.addListener(openPanelOnIconClick);
chrome.runtime.onStartup.addListener(openPanelOnIconClick);
