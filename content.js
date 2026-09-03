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

  // 2. Inject Live In-Page DOM Shield Styles into Host Page
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

    .parallax-live-shielded {
      border-color: #10b981 !important;
      box-shadow: 0 0 14px rgba(16, 185, 129, 0.4) !important;
      position: relative !important;
    }

    .parallax-live-badge {
      position: absolute;
      z-index: 2147483640;
      background: rgba(6, 10, 18, 0.95);
      border: 1px solid #10b981;
      color: #34d399;
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.5px;
      padding: 3px 8px;
      border-radius: 6px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.6), 0 0 10px rgba(16, 185, 129, 0.4);
      display: inline-flex;
      align-items: center;
      gap: 5px;
      pointer-events: none;
      animation: parallaxBadgePop 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes parallaxBadgePop {
      from { transform: translateY(4px) scale(0.9); opacity: 0; }
      to { transform: translateY(0) scale(1); opacity: 1; }
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
          const rect = range.getBoundingClientRect();
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

    // Include Form Inputs and Textareas
    const inputs = document.querySelectorAll('input, textarea');
    for (const inp of inputs) {
      if (inp.type === 'hidden' || inp.type === 'password') continue;
      const val = (inp.value || inp.placeholder || '').trim();
      if (!val) continue;
      const rect = inp.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight) {
        const parts = val.split(/\s+/);
        let currX = rect.left + 8;
        for (const p of parts) {
          if (!p) continue;
          const pw = Math.min(rect.width, Math.max(20, p.length * 8));
          words.push({
            text: p,
            confidence: 99,
            bbox: {
              x: Math.round(currX),
              y: Math.round(rect.top + 4),
              width: Math.round(pw),
              height: Math.round(rect.height - 8)
            }
          });
          currX += pw + 6;
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

  // 4. Live Real-Time PII Input Evaluator (In-Page Floating Badges)
  const activeBadges = new Map();

  function evaluateFieldPrivacy(target) {
    if (!target || !(target instanceof HTMLElement)) return;
    if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') return;

    const val = (target.value || '').trim();
    if (!val || val.length < 3) {
      removeBadge(target);
      return;
    }

    const digitsOnly = val.replace(/\D/g, '');
    let detectedType = null;

    if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(val)) {
      detectedType = 'EMAIL';
    } else if (
      /^\+?91[\s\-]?[6-9]\d{9}$/.test(val.replace(/\s+/g, '')) ||
      (digitsOnly.length === 12 && digitsOnly.startsWith('91') && /^[6-9]/.test(digitsOnly.slice(2))) ||
      (digitsOnly.length === 10 && /^[6-9]/.test(digitsOnly))
    ) {
      detectedType = 'PHONE';
    } else if (digitsOnly.length >= 13 && digitsOnly.length <= 19) {
      if (typeof PIIDetector !== 'undefined' && PIIDetector.luhnCheck(digitsOnly)) {
        detectedType = 'CARD';
      }
    } else if (/^\d{4,8}$/.test(val)) {
      const hint = (target.id + ' ' + target.name + ' ' + target.placeholder + ' ' + (target.getAttribute('aria-label') || '')).toLowerCase();
      if (/otp|code|verify|verification|pin|security/.test(hint)) {
        detectedType = 'OTP';
      }
    }

    if (detectedType) {
      attachBadge(target, detectedType);
    } else {
      removeBadge(target);
    }

    if (isLiveRadarActive) {
      clearTimeout(liveRadarDebounceTimer);
      liveRadarDebounceTimer = setTimeout(triggerInstantLiveSync, 40);
    }
  }

  function attachBadge(target, type) {
    removeBadge(target);
    target.classList.add('parallax-live-shielded');

    const rect = target.getBoundingClientRect();
    const badge = document.createElement('div');
    badge.className = 'parallax-live-badge';
    badge.innerHTML = `<span>🛡️</span> <span>LIVE SHIELD: ${type}</span>`;
    badge.style.top = `${window.scrollY + rect.top - 24}px`;
    badge.style.left = `${window.scrollX + rect.left}px`;

    document.body.appendChild(badge);
    activeBadges.set(target, badge);
  }

  function removeBadge(target) {
    target.classList.remove('parallax-live-shielded');
    if (activeBadges.has(target)) {
      const badge = activeBadges.get(target);
      if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
      activeBadges.delete(target);
    }
  }

  // Real-time Event Listeners
  document.addEventListener('input', (e) => evaluateFieldPrivacy(e.target), true);
  document.addEventListener('change', (e) => evaluateFieldPrivacy(e.target), true);
  window.addEventListener('scroll', () => {
    for (const [target, badge] of activeBadges.entries()) {
      const rect = target.getBoundingClientRect();
      badge.style.top = `${window.scrollY + rect.top - 24}px`;
      badge.style.left = `${window.scrollX + rect.left}px`;
    }
    if (isLiveRadarActive) {
      clearTimeout(liveRadarDebounceTimer);
      liveRadarDebounceTimer = setTimeout(triggerInstantLiveSync, 50);
    }
  }, { passive: true });

  // 5. Message Router (HUD <-> Host Webpage)
  window.addEventListener('message', (event) => {
    if (!event.data || typeof event.data !== 'object') return;

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

    if (event.data.type === 'PARALLAX_EXECUTE_FILL') {
      const selector = event.data.selector || '#city';
      const value = event.data.value || 'Bengaluru';
      const target = document.querySelector(selector);

      if (target) {
        target.value = value;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.focus();

        target.classList.add('parallax-highlight');
        setTimeout(() => target.classList.remove('parallax-highlight'), 3500);
      }
    }
  });

  // Listen for toolbar icon toggle message
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
