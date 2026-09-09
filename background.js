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

// Keeping time for a page that is in the background.
//
// Chrome clamps a hidden tab's timers to about one a second, and after a few
// minutes hidden to one a minute - which is why a fill appeared to stop the
// moment the user looked at another tab. A service worker is not a tab and is
// not clamped, so the page asks this to do its waiting instead of setTimeout.
// The reply is a message, and messages are delivered to a hidden page promptly.
const MAX_SLEEP = 60000;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'SLEEP') return undefined;
  const ms = Math.min(Math.max(Number(msg.ms) || 0, 0), MAX_SLEEP);
  setTimeout(() => sendResponse({ ok: true }), ms);
  return true; // keep the channel open until the timer fires
});

// A closed tab takes its session with it.
chrome.tabs.onRemoved.addListener((tabId) => {
  const store = chrome.storage.session ?? chrome.storage.local;
  store.remove(`tab:${tabId}`).catch(() => { /* nothing stored for it */ });
});
