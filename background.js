// Parallax Background Service Worker - Top Control Bar Architecture

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Parallax] Service worker installed.');
});

// Toggle Top Control Bar on extension action icon click
chrome.action.onClicked.addListener(async (tab) => {
  if (tab && tab.id) {
    try {
      chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_TOPBAR' }, () => {
        if (chrome.runtime.lastError) {
          console.log('[Parallax] Injecting topbar manually...');
        }
      });
    } catch (e) {
      console.warn('[Parallax] Action click error:', e);
    }
  }
});

// Message listener for capture and tab info
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.action === 'SCAN_REQUEST') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs && tabs[0] ? tabs[0] : (sender.tab || null);
      const targetWinId = activeTab ? activeTab.windowId : null;
      const targetUrl = activeTab ? activeTab.url : (sender.tab ? sender.tab.url : '');

      chrome.tabs.captureVisibleTab(targetWinId, { format: 'png' }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          console.error('[Parallax] Capture error:', chrome.runtime.lastError.message);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else if (!dataUrl) {
          sendResponse({ success: false, error: 'Empty capture result.' });
        } else {
          sendResponse({ success: true, dataUrl: dataUrl, pageUrl: targetUrl });
        }
      });
    });

    return true;
  }

  if (message && message.action === 'GET_ACTIVE_TAB_URL') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs && tabs[0] ? tabs[0] : null;
      sendResponse({ url: activeTab ? activeTab.url : '' });
    });
    return true;
  }
});
