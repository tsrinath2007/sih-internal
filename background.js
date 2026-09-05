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
    (async () => {
      try {
        let activeTab = null;
        if (sender.tab && sender.tab.id) {
          activeTab = sender.tab;
        } else {
          const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          activeTab = (tabs && tabs[0]) ? tabs[0] : null;
          if (!activeTab) {
            const anyTabs = await chrome.tabs.query({ active: true });
            activeTab = (anyTabs && anyTabs[0]) ? anyTabs[0] : null;
          }
        }

        const targetWinId = (activeTab && typeof activeTab.windowId === 'number') ? activeTab.windowId : undefined;
        const targetUrl = activeTab ? activeTab.url : '';

        const captureOptions = { format: 'png' };
        const callback = (dataUrl) => {
          if (chrome.runtime.lastError) {
            console.error('[Parallax] Capture error:', chrome.runtime.lastError.message);
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else if (!dataUrl) {
            sendResponse({ success: false, error: 'Empty capture result.' });
          } else {
            sendResponse({ success: true, dataUrl: dataUrl, pageUrl: targetUrl });
          }
        };

        if (typeof targetWinId === 'number') {
          chrome.tabs.captureVisibleTab(targetWinId, captureOptions, callback);
        } else {
          chrome.tabs.captureVisibleTab(captureOptions, callback);
        }
      } catch (err) {
        console.error('[Parallax] SCAN_REQUEST handler error:', err);
        sendResponse({ success: false, error: err.message || 'Capture failed' });
      }
    })();

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
