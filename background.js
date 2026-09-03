// The side panel is scoped to the tab it was opened on.
//
// Chrome's default is one panel per window, which follows you from tab to tab.
// Turning the default off and enabling the panel only for the tab whose toolbar
// icon was clicked gives each tab its own instance: switching to a tab that
// never opened it shows nothing, and opening it there starts a fresh session.

const PANEL = 'panel.html';

async function defaultOff() {
  try {
    await chrome.sidePanel.setOptions({ enabled: false });
  } catch (e) {
    console.error('Could not turn the default side panel off:', e);
  }
}

chrome.runtime.onInstalled.addListener(defaultOff);
chrome.runtime.onStartup.addListener(defaultOff);

// Opening has to happen inside the click's user gesture, so no awaits before it.
chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  chrome.sidePanel.setOptions({ tabId: tab.id, path: PANEL, enabled: true });
  chrome.sidePanel.open({ tabId: tab.id }).catch((e) => console.error('Side panel:', e));
});

// A closed tab takes its session with it.
chrome.tabs.onRemoved.addListener((tabId) => {
  const store = chrome.storage.session ?? chrome.storage.local;
  store.remove(`tab:${tabId}`).catch(() => { /* nothing stored for it */ });
});
