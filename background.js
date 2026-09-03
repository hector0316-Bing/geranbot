// Clicking the toolbar icon opens the side panel. The panel is docked by the
// browser, so it takes its own column beside the page rather than floating over
// it, keeps full height, and stays put while the page scrolls.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => console.error('Side panel unavailable:', e));
