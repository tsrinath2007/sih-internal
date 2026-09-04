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

    // Auto-detect User Avatars, Profile Pictures, Headshots, and Photos for Anonymization
    const avatarCandidates = document.querySelectorAll('img, [style*="background-image"]');
    for (const el of avatarCandidates) {
      if (el.id === 'parallax-topbar-iframe' || el.closest('#parallax-topbar-iframe')) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width >= 24 && rect.width <= 2500 && rect.height >= 24 && rect.height <= 2500 && rect.bottom > 0 && rect.top < window.innerHeight) {
        const classStr = (el.getAttribute('class') || el.className?.baseVal || el.className || '').toString().toLowerCase();
        const idStr = (el.getAttribute('id') || '').toLowerCase();
        const srcStr = (el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('xlink:href') || el.src || '').toLowerCase();
        const styleStr = (el.getAttribute('style') || '').toLowerCase();
        const altStr = (el.getAttribute('alt') || '').toLowerCase();
        const ariaStr = (el.getAttribute('aria-label') || el.parentElement?.getAttribute('aria-label') || '').toLowerCase();
        const parentClass = (el.parentElement?.getAttribute('class') || '').toLowerCase();
        const parentId = (el.parentElement?.getAttribute('id') || '').toLowerCase();
        const tagName = el.tagName.toUpperCase();

        const isLogoOrBrand = 
          altStr.includes('logo') ||
          altStr.includes('brand') ||
          classStr.includes('logo') ||
          classStr.includes('brand') ||
          classStr.includes('site-title') ||
          idStr.includes('logo') ||
          idStr.includes('brand') ||
          srcStr.includes('logo') ||
          srcStr.includes('brand') ||
          ariaStr.includes('logo') ||
          ariaStr.includes('home') ||
          parentClass.includes('logo') ||
          parentClass.includes('brand') ||
          parentId.includes('logo') ||
          parentId.includes('brand');

        if (isLogoOrBrand) {
          continue; // Skip logos & branding completely
        }

        // Check if this image element is a genuine user avatar or personal portrait photo
        const isAvatar = 
          srcStr.includes('googleusercontent.com') ||
          srcStr.includes('gravatar.com') ||
          srcStr.includes('twimg.com/profile_images') ||
          srcStr.includes('githubusercontent.com/u') ||
          srcStr.includes('avatar') ||
          srcStr.includes('profile_image') ||
          srcStr.includes('user_photo') ||
          srcStr.includes('profile-pic') ||
          srcStr.includes('headshot') ||
          classStr.includes('avatar') ||
          classStr.includes('profile-image') ||
          classStr.includes('profile-pic') ||
          classStr.includes('profile-photo') ||
          classStr.includes('user-avatar') ||
          classStr.includes('author-image') ||
          classStr.includes('member-photo') ||
          classStr.includes('student-photo') ||
          idStr.includes('avatar') ||
          idStr.includes('profile-pic') ||
          idStr.includes('profile-photo') ||
          idStr.includes('student-photo') ||
          parentClass.includes('avatar') ||
          parentClass.includes('user-profile') ||
          parentId.includes('avatar') ||
          altStr.includes('profile photo') ||
          altStr.includes('avatar') ||
          altStr.includes('user profile') ||
          altStr.includes('account photo') ||
          altStr.includes('profile picture') ||
          ariaStr.includes('profile photo') ||
          ariaStr.includes('user profile') ||
          ariaStr.includes('profile picture') ||
          ariaStr.includes('account of');

        if (isAvatar && rect.width >= 24 && rect.height >= 24) {
          words.push({
            text: '[PHOTO_AVATAR]',
            isAvatar: true,
            confidence: 99,
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
