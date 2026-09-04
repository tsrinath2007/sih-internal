// Parallax Content Script - Injects Top Bar HUD, 60 FPS Instant DOM Spatial Radar & In-Page Shield

(function () {
  if (document.getElementById('parallax-topbar-iframe')) return;

  // 1. Inject Top Bar HUD Iframe
  const iframe = document.createElement('iframe');
  iframe.id = 'parallax-topbar-iframe';
  iframe.src = chrome.runtime.getURL('topbar.html');
  iframe.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 54px;
    z-index: 2147483647;
    border: none;
    background: transparent;
    overflow: hidden;
    transition: height 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.15s ease;
  `;

  document.documentElement.appendChild(iframe);
  document.body.style.marginTop = '54px';

  let isVisible = true;
  let isLiveRadarActive = false;
  let liveRadarDebounceTimer = null;

  // 2. Inject Clean Focus Highlight Styles into Host Page
  const styleEl = document.createElement('style');
  styleEl.id = 'parallax-live-shield-styles';
  styleEl.textContent = `
    .parallax-highlight {
      outline: 3px solid #00f2fe !important;
      box-shadow: 0 0 25px #00f2fe !important;
      transition: all 0.3s ease !important;
      animation: parallaxPulseRing 1.5s infinite alternate !important;
    }
    @keyframes parallaxPulseRing {
      from { box-shadow: 0 0 10px rgba(0, 242, 254, 0.5); }
      to { box-shadow: 0 0 30px rgba(0, 242, 254, 0.9); }
    }
  `;
  document.head.appendChild(styleEl);

  // 3. Instant 60 FPS DOM Spatial Word & Coordinate Extractor (< 2ms)
  function extractVisibleWordsFast() {
    const words = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'NOSCRIPT' || parent.id === 'parallax-topbar-iframe') {
          return NodeFilter.FILTER_REJECT;
        }
        const style = window.getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let node;
    const range = document.createRange();
    while ((node = walker.nextNode())) {
      const text = node.nodeValue;
      const re = /\S+/g;
      let match;
      while ((match = re.exec(text))) {
        const start = match.index;
        const end = start + match[0].length;
        try {
          range.setStart(node, start);
          range.setEnd(node, end);
          let rect = range.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) {
            const parent = node.parentElement;
            if (parent) rect = parent.getBoundingClientRect();
          }
          if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight) {
            words.push({
              text: match[0],
              confidence: 99,
              bbox: {
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              }
            });
          }
        } catch (e) {}
      }
    }

    // Include Form Inputs, Textareas, Buttons, and Interactive Elements
    const inputs = document.querySelectorAll('input, textarea, button, a, [role="button"], [aria-label]');
    for (const inp of inputs) {
      if (inp.id === 'parallax-topbar-iframe') continue;
      const val = (inp.value || inp.placeholder || inp.getAttribute('aria-label') || inp.innerText || '').trim();
      if (!val) continue;
      const rect = inp.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight) {
        const parts = val.split(/\s+/);
        // For compact buttons/avatars/icons (< 100px) or non-text inputs, snap bounding box to the exact element rect
        if (rect.width <= 100 || (inp.tagName !== 'INPUT' && inp.tagName !== 'TEXTAREA')) {
          for (const p of parts) {
            if (!p) continue;
            words.push({
              text: p,
              confidence: 99,
              bbox: {
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              }
            });
          }
        } else {
          let currX = rect.left + 4;
          for (const p of parts) {
            if (!p) continue;
            const pw = Math.min(rect.width, Math.max(16, p.length * 8));
            words.push({
              text: p,
              confidence: 99,
              bbox: {
                x: Math.round(currX),
                y: Math.round(rect.top + 2),
                width: Math.round(pw),
                height: Math.round(rect.height - 4)
              }
            });
            currX += pw + 4;
          }
        }
      }
    }

    // Auto-detect User Avatars, Profile Pictures, and Circular Face Photos for Anonymization
    const avatarCandidates = document.querySelectorAll('img, [role="img"], svg.avatar, .avatar, .profile-pic, .user-avatar, [class*="avatar"], [class*="profile-photo"]');
    for (const el of avatarCandidates) {
      if (el.id === 'parallax-topbar-iframe') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width >= 20 && rect.width <= 160 && rect.height >= 20 && rect.height <= 160 && rect.bottom > 0 && rect.top < window.innerHeight) {
        const isSquareOrRound = Math.abs(rect.width - rect.height) <= 20;
        const className = (el.className || '').toString().toLowerCase();
        const src = (el.src || '').toLowerCase();
        const isAvatar = isSquareOrRound && (
          className.includes('avatar') || 
          className.includes('profile') || 
          className.includes('user') ||
          className.includes('account') ||
          src.includes('avatar') || 
          src.includes('photo') || 
          src.includes('googleusercontent') ||
          src.includes('profile') ||
          el.getAttribute('role') === 'img' ||
          window.getComputedStyle(el).borderRadius.includes('50%') ||
          window.getComputedStyle(el).borderRadius.includes('9999px')
        );

        if (isAvatar) {
          words.push({
            text: '[PHOTO_AVATAR]',
            isAvatar: true,
            confidence: 98,
            bbox: {
              x: Math.round(rect.left),
              y: Math.round(rect.top),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            }
          });
        }
      }
    }

    return words;
  }

  // Trigger Instant Live Sync to HUD
  function triggerInstantLiveSync() {
    if (!isLiveRadarActive || !iframe.contentWindow) return;

    const words = extractVisibleWordsFast();
    const piiResult = typeof PIIDetector !== 'undefined' ? PIIDetector.detectPII(words, { confidenceThreshold: 80.0 }) : { matches: [], isBlocked: false, status: 'ready' };
    const sanitizedText = typeof PIIDetector !== 'undefined' ? PIIDetector.generateSanitizedText(words, piiResult.matches) : '';

    iframe.contentWindow.postMessage({
      type: 'PARALLAX_INSTANT_LIVE_SYNC',
      words: words,
      piiMatches: piiResult.matches,
      isBlocked: piiResult.isBlocked,
      status: piiResult.status,
      sanitizedText: sanitizedText,
      pageUrl: window.location.href,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    }, '*');
  }

  // 4. Clean event listeners for live radar without in-page visual badges
  if (isLiveRadarActive) {
    window.addEventListener('scroll', () => {
      clearTimeout(liveRadarDebounceTimer);
      liveRadarDebounceTimer = setTimeout(triggerInstantLiveSync, 50);
    }, { passive: true });
  }

  // 5. Message Router (HUD <-> Host Webpage)
  window.addEventListener('message', (event) => {
    if (!event.data || typeof event.data !== 'object') return;

    if (event.data.type === 'PARALLAX_REQUEST_DOM_WORDS') {
      const words = extractVisibleWordsFast();
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          type: 'PARALLAX_DOM_WORDS_RESPONSE',
          words: words,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1
        }, '*');
      }
    }

    if (event.data.type === 'PARALLAX_ENABLE_LIVE_RADAR') {
      isLiveRadarActive = true;
      triggerInstantLiveSync();
    }

    if (event.data.type === 'PARALLAX_DISABLE_LIVE_RADAR') {
      isLiveRadarActive = false;
    }

    if (event.data.type === 'PARALLAX_RESIZE_IFRAME') {
      iframe.style.height = event.data.height || '54px';
    }

    if (event.data.type === 'PARALLAX_PREPARE_CAPTURE') {
      iframe.style.visibility = 'hidden';
      iframe.style.opacity = '0';
    }

    if (event.data.type === 'PARALLAX_RESTORE_CAPTURE') {
      iframe.style.visibility = 'visible';
      iframe.style.opacity = '1';
    }

    if (event.data.type === 'PARALLAX_HIDE_TOPBAR') {
      isVisible = false;
      iframe.style.display = 'none';
      document.body.style.marginTop = '0px';
    }

    if (event.data.type === 'PARALLAX_EXECUTE_ACTION' || event.data.type === 'PARALLAX_EXECUTE_FILL') {
      const sel = event.data.selector || '#city';
      const val = event.data.value;
      const isClick = event.data.action === 'click';

      let target = null;
      try {
        target = document.querySelector(sel);
      } catch (e) {}

      if (!target && isClick) {
        const cleanTarget = sel.toLowerCase().replace(/button|link|icon|\[|\]|["']/g, '').trim();
        const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"], [tabindex], span, div'));
        target = candidates.find(c => {
          const text = (c.innerText || c.textContent || c.getAttribute('aria-label') || c.getAttribute('title') || '').trim().toLowerCase();
          return text === cleanTarget || (cleanTarget.length > 2 && text.includes(cleanTarget));
        });
      }

      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.focus();

        if (isClick) {
          target.click();
        } else if (val) {
          target.value = val;
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
        }

        target.classList.add('parallax-highlight');
        setTimeout(() => target.classList.remove('parallax-highlight'), 3500);
      }
    }
  });

  // Listen for toolbar icon toggle message & DOM word requests
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && (message.action === 'GET_DOM_WORDS' || message.type === 'READ_DOM_SNAPSHOT')) {
      const words = extractVisibleWordsFast();
      sendResponse({
        success: true,
        words: words,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1
      });
      return true;
    }

    if (message && message.action === 'TOGGLE_TOPBAR') {
      isVisible = !isVisible;
      iframe.style.display = isVisible ? 'block' : 'none';
      document.body.style.marginTop = isVisible ? '54px' : '0px';
      sendResponse({ visible: isVisible });
    }

    if (message && message.action === 'EXECUTE_FILL_FIELD') {
      const selector = message.selector || '#city';
      const value = message.value || 'Bengaluru';
      const target = document.querySelector(selector);
      if (target) {
        target.value = value;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.focus();
        target.classList.add('parallax-highlight');
        setTimeout(() => target.classList.remove('parallax-highlight'), 3500);
        sendResponse({ success: true });
      }
      return true;
    }
  });
})();
