const panelBehavior = { openPanelOnActionClick: true };

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior(panelBehavior).catch(() => {});
});

chrome.sidePanel.setPanelBehavior(panelBehavior).catch(() => {});
