// BACKGROUND SCRIPT (service worker)
// Runs in the "back office" of Chrome, not inside any web page.
// For now it only says hello when the extension is installed.
chrome.runtime.onInstalled.addListener(() => {
  console.log("UX Audit Buddy installed. Ready for Step 2!");
});
