// Parallax Top Bar Controller - High-Resolution Visual Perception & Redaction Engine

// Debug Overlay Mode Toggle (defaults to false)
// When true, draws DOM-sourced boxes in blue (#3b82f6) and OCR-sourced boxes in yellow (#eab308)
window.PARALLAX_DEBUG = typeof window.PARALLAX_DEBUG !== 'undefined' ? window.PARALLAX_DEBUG : false;

document.addEventListener('DOMContentLoaded', async () => {
  let isScanning = false;
  let currentScanData = null;
  let isDrawerOpen = false;

  // Persistent WebAssembly Worker Pool (Pre-warmed in memory)
  let cachedWorker = null;
  let isWorkerInitializing = false;

  const scanBtn = document.getElementById('ptbScanBtn');
  const statusText = document.getElementById('ptbStatusText');
  const drawerBtn = document.getElementById('ptbToggleDrawerBtn');
  const drawerBtnText = document.getElementById('ptbDrawerBtnText');
  const closeBtn = document.getElementById('ptbCloseBtn');
  const drawer = document.getElementById('ptbDrawer');
  const showcaseCount = document.getElementById('ptbShowcaseCount');
  const toggleReceiptsBtn = document.getElementById('ptbToggleReceiptsBtn');

  // Redaction Toolbar Export Tools
  const downloadBtn = document.getElementById('ptbDownloadBtn');

  const origCanvas = document.getElementById('ptbOriginalCanvas');
  const sanCanvas = document.getElementById('ptbSanitizedCanvas');
  const origWrapper = document.getElementById('ptbOrigWrapper');
  const sanWrapper = document.getElementById('ptbSanWrapper');
  const wordCount = document.getElementById('ptbWordCount');
  const redactCount = document.getElementById('ptbRedactCount');
  const chipsList = document.getElementById('ptbChipsList');

  // Metrics & Log Elements
  const metricTotalScans = document.getElementById('metricTotalScans');
  const metricTotalPII = document.getElementById('metricTotalPII');
  const metricTotalBlocked = document.getElementById('metricTotalBlocked');
  const metricTotalApproved = document.getElementById('metricTotalApproved');
  const refreshLogBtn = document.getElementById('ptbRefreshLogBtn');
  const clearLogBtn = document.getElementById('ptbClearLogBtn');
  const logTableBody = document.getElementById('ptbLogTableBody');
  const logBadgeCount = document.getElementById('ptbLogBadgeCount');

  // Fullscreen Elements
  const fsOrigBtn = document.getElementById('ptbFullscreenOrigBtn');
  const fsSanBtn = document.getElementById('ptbFullscreenSanBtn');
  const fsModal = document.getElementById('ptbFsModal');
  const fsBackdrop = document.getElementById('ptbFsBackdrop');
  const fsCloseBtn = document.getElementById('ptbFsCloseBtn');
  const fsTabOrig = document.getElementById('ptbFsTabOrig');
  const fsTabSan = document.getElementById('ptbFsTabSan');
  const fsModeBadge = document.getElementById('ptbFsModeBadge');
  const fsMetaText = document.getElementById('ptbFsMetaText');
  const fsCanvas = document.getElementById('ptbFsCanvas');
  const fsZoomInBtn = document.getElementById('ptbFsZoomInBtn');
  const fsZoomOutBtn = document.getElementById('ptbFsZoomOutBtn');
  const fsZoomResetBtn = document.getElementById('ptbFsZoomResetBtn');
  const fsZoomLevel = document.getElementById('ptbFsZoomLevel');

  let currentFsMode = 'original';
  let currentZoom = 1.0;

  function setStatus(text, stateClass = 'idle') {
    if (statusText) {
      statusText.textContent = text;
      const statusPill = statusText.closest('.ptb-status-pill');
      if (statusPill) {
        statusPill.className = `ptb-status-pill ptb-status-${stateClass}`;
      }
    }
  }

  function resizeHostIframe(expanded) {
    window.parent.postMessage({
      type: 'PARALLAX_RESIZE_IFRAME',
      height: expanded ? '85vh' : '58px'
    }, '*');
  }

  // Pre-warm Persistent WASM Worker in background with auto-recovery
  async function getPersistentWorker() {
    if (cachedWorker) return cachedWorker;
    if (isWorkerInitializing) {
      let waitCount = 0;
      while (isWorkerInitializing && waitCount < 30) {
        await new Promise((r) => setTimeout(r, 50));
        waitCount++;
      }
      if (cachedWorker) return cachedWorker;
    }

    isWorkerInitializing = true;
    try {
      if (typeof Tesseract === 'undefined') {
        console.warn('[Parallax] Tesseract library not yet loaded in scope.');
        return null;
      }
      cachedWorker = await Tesseract.createWorker('eng', 1, {
        workerPath: chrome.runtime.getURL('lib/worker.min.js'),
        corePath: chrome.runtime.getURL('lib/tesseract-core-lstm.wasm.js'),
        langPath: chrome.runtime.getURL('lib/lang-data'),
        workerBlobURL: false,
        gzip: true
      });
      return cachedWorker;
    } catch (e) {
      console.warn('[Parallax] Worker initialization fallback:', e);
      return null;
    } finally {
      isWorkerInitializing = false;
    }
  }

  // Warm up worker on startup
  setTimeout(() => { getPersistentWorker().catch(() => {}); }, 300);

  // Render Metrics & Audit Logs from IndexedDB
  async function renderMetricsAndLogs() {
    try {
      if (typeof ParallaxDB === 'undefined') return;

      const summary = await ParallaxDB.getLogsSummary();
      if (metricTotalScans) metricTotalScans.textContent = summary.totalScans;
      if (metricTotalPII) metricTotalPII.textContent = summary.totalPIIDetected;
      if (metricTotalBlocked) metricTotalBlocked.textContent = summary.totalBlocked;
      if (metricTotalApproved) metricTotalApproved.textContent = summary.totalApproved;

      const logs = await ParallaxDB.getAllLogs();
      if (logBadgeCount) logBadgeCount.textContent = `${logs.length} records`;
      if (!logTableBody) return;

      if (!logs || logs.length === 0) {
        logTableBody.innerHTML = `<tr><td colspan="6" class="ptb-log-empty">No detection logs recorded yet. Scan a page to generate local audit records.</td></tr>`;
        return;
      }

      let rowsHtml = '';
      for (const log of logs) {
        const timeStr = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const typesList = (log.detections || []).map(d => d.type);
        const uniqueTypes = [...new Set(typesList)];
        const typesStr = uniqueTypes.length > 0 ? uniqueTypes.join(', ') : 'None';

        const statusLabel = log.blocked 
          ? '<span class="ptb-log-tag tag-blocked">⛔ SENSITIVE</span>' 
          : '<span class="ptb-log-tag tag-approved">✅ PROTECTED</span>';

        const outcomeLabel = `<span style="color:#34d399; font-weight:700;">100% On-Device</span>`;
        const cleanUrl = (log.pageUrl || '').replace(/^https?:\/\//, '').split('?')[0];

        rowsHtml += `
          <tr>
            <td class="cell-id">#${log.id}</td>
            <td class="cell-time">${timeStr}</td>
            <td class="cell-url" title="${log.pageUrl}">${cleanUrl}</td>
            <td class="cell-types"><strong>${typesStr}</strong> (${log.redactedCount})</td>
            <td class="cell-status">${statusLabel}</td>
            <td class="cell-action">${outcomeLabel}</td>
          </tr>
        `;
      }

      logTableBody.innerHTML = rowsHtml;
    } catch (e) {
      console.warn('[Parallax] Failed to render metrics/logs:', e);
    }
  }

  // Load metrics initially
  await renderMetricsAndLogs();

  // Wire log buttons
  if (refreshLogBtn) refreshLogBtn.addEventListener('click', renderMetricsAndLogs);
  if (clearLogBtn) {
    clearLogBtn.addEventListener('click', async () => {
      if (confirm('Delete all local detection audit records? This cannot be undone.')) {
        await ParallaxDB.clearLogs();
        await renderMetricsAndLogs();
      }
    });
  }

  // Showcase Drawer Toggle
  function toggleDrawer() {
    isDrawerOpen = !isDrawerOpen;
    if (drawer) {
      drawer.classList.toggle('open', isDrawerOpen);
    }
    if (drawerBtnText) {
      const count = currentScanData ? currentScanData.pii_matches.length : 0;
      drawerBtnText.textContent = isDrawerOpen ? 'Collapse Showcase ▲' : `Showcase (${count}) ▼`;
    }
    resizeHostIframe(isDrawerOpen);
  }

  if (drawerBtn) drawerBtn.addEventListener('click', toggleDrawer);

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      window.parent.postMessage({ type: 'PARALLAX_HIDE_TOPBAR' }, '*');
    });
  }

  function maskPreview(text, type) {
    if (!text) return '';
    if (type === 'AVATAR') return '🔒 Face Mask';
    if (type === 'CARD' || type === 'ACCOUNT_NUM') {
      const digits = text.replace(/\D/g, '');
      return `•••• •••• •••• ${digits.slice(-4)}`;
    }
    if (type === 'EMAIL') {
      const parts = text.split('@');
      if (parts.length === 2) {
        return `${parts[0].slice(0, 2)}•••@${parts[1]}`;
      }
    }
    if (type === 'PHONE') {
      const digits = text.replace(/\D/g, '');
      return `+•• ••••• ${digits.slice(-4)}`;
    }
    if (type === 'OTP') {
      return `•••••• (${text.length} digits)`;
    }
    if (type === 'IFSC') {
      return `${text.slice(0, 4)}•••••••`;
    }
    return text;
  }

  function downscaleImageForOCR(dataUrl, maxDimension = 2560) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const origW = img.naturalWidth;
        const origH = img.naturalHeight;
        if (origW <= maxDimension && origH <= maxDimension) {
          resolve({ dataUrl, scale: 1.0, origW, origH });
          return;
        }
        const scale = Math.min(maxDimension / origW, maxDimension / origH);
        const targetW = Math.round(origW * scale);
        const targetH = Math.round(origH * scale);

        const offscreen = document.createElement('canvas');
        offscreen.width = targetW;
        offscreen.height = targetH;
        const ctx = offscreen.getContext('2d');
        ctx.drawImage(img, 0, 0, targetW, targetH);
        resolve({
          dataUrl: offscreen.toDataURL('image/png'),
          scale: 1 / scale,
          origW,
          origH
        });
      };
      img.onerror = () => resolve({ dataUrl, scale: 1.0, origW: 1280, origH: 800 });
      img.src = dataUrl;
    });
  }

  // --------------------------------------------------------------------------
  // Main On-Device Perception & Privacy Redaction Pipeline
  // --------------------------------------------------------------------------
  async function executePerceptionScan() {
    if (isScanning) return;
    isScanning = true;
    if (scanBtn) scanBtn.disabled = true;

    setStatus('Capturing Viewport...', 'capturing');

    try {
      // Hide iframe cleanly so it is NEVER captured in the screenshot
      window.parent.postMessage({ type: 'PARALLAX_PREPARE_CAPTURE' }, '*');
      await new Promise((r) => setTimeout(r, 90));

      // --- ATOMIC CAPTURE & DOM VIEWPORT MEASUREMENT ---
      // To prevent layout, zoom, or scroll drift between the DOM coordinate space and the
      // screenshot pixel coordinate space, we capture the DOM snapshot (including
      // viewportWidth and viewportHeight) in the exact same tick / execution window as
      // chrome.tabs.captureVisibleTab(), before heavy async OCR processing begins.
      //
      // Previously, domWordsPromise was fired before hiding the iframe, followed by a 90ms delay,
      // followed by capture, and then awaited AFTER heavy async OCR processing (500ms-2000ms later).
      // Any DOM reflow, scroll, or resize during that window resulted in misaligned scaleX/scaleY.
      //
      // With Promise.all here:
      // 1. Both the DOM reader and captureVisibleTab sample the exact same live viewport state.
      // 2. The host iframe is restored immediately once the visual snapshot and metrics are locked.
      // 3. Downscale and OCR run asynchronously afterward without affecting spatial alignment.
      const domWordsPromise = new Promise((resolve) => {
        const handler = (event) => {
          if (event.data && event.data.type === 'PARALLAX_DOM_WORDS_RESPONSE') {
            window.removeEventListener('message', handler);
            resolve(event.data);
          }
        };
        window.addEventListener('message', handler);
        window.parent.postMessage({ type: 'PARALLAX_REQUEST_DOM_WORDS' }, '*');
        setTimeout(() => resolve({ words: [], viewportWidth: window.innerWidth || 1280, viewportHeight: window.innerHeight || 800 }), 400);
      });

      const capturePromise = new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'SCAN_REQUEST' }, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res || { success: false, error: 'Capture failed.' });
          }
        });
      });

      const [domData, captureResponse] = await Promise.all([domWordsPromise, capturePromise]);

      // Restore iframe immediately after capture and DOM measurement are locked in
      window.parent.postMessage({ type: 'PARALLAX_RESTORE_CAPTURE' }, '*');

      if (!captureResponse.success || !captureResponse.dataUrl) {
        throw new Error(captureResponse.error || 'Viewport capture failed.');
      }

      const screenshotDataUrl = captureResponse.dataUrl;
      const targetPageUrl = captureResponse.pageUrl || 'webpage';

      setStatus('Processing On-Device OCR & PII Detection...', 'processing');

      // High-Speed Downscaled OCR Pre-processing
      const optimizedImage = await downscaleImageForOCR(screenshotDataUrl, 2560);

      let rawWords = [];
      try {
        const worker = await getPersistentWorker();
        if (worker) {
          const ocrResult = await worker.recognize(optimizedImage.dataUrl, {}, {
            text: true,
            blocks: true
          });

          if (ocrResult.data && Array.isArray(ocrResult.data.words) && ocrResult.data.words.length > 0) {
            rawWords = ocrResult.data.words;
          } else if (ocrResult.data && Array.isArray(ocrResult.data.blocks)) {
            for (const block of ocrResult.data.blocks) {
              for (const p of (block.paragraphs || [])) {
                for (const line of (p.lines || [])) {
                  for (const w of (line.words || [])) {
                    rawWords.push(w);
                  }
                }
              }
            }
          }
        }
      } catch (ocrErr) {
        console.warn('[Parallax] OCR perception fallback to DOM spatial extractor:', ocrErr);
      }

      const scaleMult = optimizedImage.scale;
      const extractedWords = rawWords.map((word) => {
        const x0 = (word.bbox ? word.bbox.x0 : (word.x0 || 0)) * scaleMult;
        const y0 = (word.bbox ? word.bbox.y0 : (word.y0 || 0)) * scaleMult;
        const x1 = (word.bbox ? word.bbox.x1 : (word.x1 || 0)) * scaleMult;
        const y1 = (word.bbox ? word.bbox.y1 : (word.y1 || 0)) * scaleMult;
        return {
          text: word.text ? word.text.trim() : '',
          confidence: typeof word.confidence === 'number' ? word.confidence : 90,
          source: 'OCR',
          bbox: { x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) }
        };
      }).filter((w) => w.text.length > 0);

      // Render Canvases OVER REAL SCREENSHOT IMAGE
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = async () => {
          try {
            const width = img.naturalWidth;
            const height = img.naturalHeight;

            // Use locked domData captured atomically with screenshot
            const domWords = domData.words || [];
            const viewW = domData.viewportWidth || (window.innerWidth || 1280);
            const viewH = domData.viewportHeight || (window.innerHeight || 800);
            const scaleX = width / Math.max(1, viewW);
            const scaleY = height / Math.max(1, viewH);

            const scaledDomWords = domWords.map(w => ({
              text: w.text,
              isAvatar: w.isAvatar,
              isPassword: w.isPassword,
              isSecret: w.isSecret,
              confidence: w.confidence || 99,
              source: 'DOM',
              bbox: {
                x: Math.round(w.bbox.x * scaleX),
                y: Math.round(w.bbox.y * scaleY),
                width: Math.round(w.bbox.width * scaleX),
                height: Math.round(w.bbox.height * scaleY)
              }
            }));

            // Run independent detections for Cross-Validation Safety Check
            const domPiiResult = PIIDetector.detectPII(scaledDomWords, { confidenceThreshold: 35.0, cardLuhnConfidenceThreshold: 20.0 });
            const ocrPiiResult = PIIDetector.detectPII(extractedWords, { confidenceThreshold: 35.0, cardLuhnConfidenceThreshold: 20.0 });

            // High-Precision Word Fusion: DOM Words + OCR Words
            const mergedWords = [...scaledDomWords];
            for (const ow of extractedWords) {
              const isCovered = scaledDomWords.some(dw => {
                const xOverlap = Math.max(0, Math.min(dw.bbox.x + dw.bbox.width, ow.bbox.x + ow.bbox.width) - Math.max(dw.bbox.x, ow.bbox.x));
                const yOverlap = Math.max(0, Math.min(dw.bbox.y + dw.bbox.height, ow.bbox.y + ow.bbox.height) - Math.max(dw.bbox.y, ow.bbox.y));
                const dy = Math.abs(dw.bbox.y - ow.bbox.y);
                const dx = Math.abs(dw.bbox.x - ow.bbox.x);
                return (xOverlap > 4 && dy < 25) || (dx < 45 && dy < 25) || (dw.text && ow.text && dw.text.toLowerCase() === ow.text.toLowerCase() && dy < 30);
              });
              if (!isCovered) {
                mergedWords.push(ow);
              }
            }

            // Run Strict Core PII Detector on merged words (EMAIL, PHONE, CARD, OTP, AADHAAR, PAN, IFSC, DOB, AVATAR)
            const piiDetection = PIIDetector.detectPII(mergedWords, { confidenceThreshold: 35.0, cardLuhnConfidenceThreshold: 20.0 });

            // --- CROSS-VALIDATION SAFETY CHECK ("POSITION UNCERTAIN") ---
            // If a DOM match and an OCR match reference similar text content but their
            // bounding boxes are > 40px apart on either axis, this indicates coordinate misalignment
            // between the live DOM and the captured pixels (e.g. dynamic layout shift, scroll drift,
            // or offscreen CSS transforms). Rather than guessing which position is correct (which
            // could leave real PII unredacted and exposed), mark overall page status as BLOCKED,
            // surface "Sensitive match found but position could not be confirmed — review manually."
            // in the HUD, and retain both candidate bounding boxes with zero silent drops.
            const crossValidation = (typeof PIIDetector.crossValidatePositions === 'function')
              ? PIIDetector.crossValidatePositions(domPiiResult.matches, ocrPiiResult.matches, { maxDistance: 40 })
              : { isPositionUncertain: false, uncertainPairs: [] };

            const isPositionUncertain = crossValidation.isPositionUncertain;

            if (isPositionUncertain) {
              piiDetection.isBlocked = true;
              piiDetection.status = 'BLOCKED — Sensitive match found but position could not be confirmed — review manually.';

              // Retain both candidate bounding boxes from DOM and OCR so zero sensitive data is silently dropped
              for (const pair of crossValidation.uncertainPairs) {
                const hasDom = piiDetection.matches.some(m => Math.abs(m.bbox.x - pair.domMatch.bbox.x) < 10 && Math.abs(m.bbox.y - pair.domMatch.bbox.y) < 10);
                if (!hasDom) piiDetection.matches.push({ ...pair.domMatch, isPositionUncertain: true });

                const hasOcr = piiDetection.matches.some(m => Math.abs(m.bbox.x - pair.ocrMatch.bbox.x) < 10 && Math.abs(m.bbox.y - pair.ocrMatch.bbox.y) < 10);
                if (!hasOcr) piiDetection.matches.push({ ...pair.ocrMatch, isPositionUncertain: true });
              }
            }

            // Detect any visual face portraits in document/screenshot image (e.g. Aadhaar cards, ID badges)
            if (typeof PIIDetector.detectVisualFaces === 'function') {
              const visualFaces = PIIDetector.detectVisualFaces(img, width, height);
              for (const vf of visualFaces) {
                const alreadyMatched = piiDetection.matches.some(m => {
                  if (m.type !== 'AVATAR') return false;
                  const xOverlap = Math.max(0, Math.min(m.bbox.x + m.bbox.width, vf.bbox.x + vf.bbox.width) - Math.max(m.bbox.x, vf.bbox.x));
                  const yOverlap = Math.max(0, Math.min(m.bbox.y + m.bbox.height, vf.bbox.y + vf.bbox.height) - Math.max(m.bbox.y, vf.bbox.y));
                  const overlapArea = xOverlap * yOverlap;
                  const minArea = Math.min(m.bbox.width * m.bbox.height, vf.bbox.width * vf.bbox.height);
                  return overlapArea > 0.4 * minArea;
                });
                if (!alreadyMatched) {
                  piiDetection.matches.push(vf);
                  if (piiDetection.summary) {
                    piiDetection.summary.total = (piiDetection.summary.total || 0) + 1;
                    piiDetection.summary.AVATAR = (piiDetection.summary.AVATAR || 0) + 1;
                  }
                }
              }
            }

            // Pinpoint exact face regions for any photographic avatar matches
            if (typeof PIIDetector.refineFaceBoundingBoxes === 'function') {
              piiDetection.matches = PIIDetector.refineFaceBoundingBoxes(piiDetection.matches, img, width, height);
            }

            // 1. Original View: Visual Hierarchy (Faint gray for non-PII, bold red/orange #E8491A for PII)
            if (origCanvas && origWrapper) {
              origCanvas.width = width;
              origCanvas.height = height;
              origWrapper.classList.add('has-img');
              const ctx = origCanvas.getContext('2d');
              ctx.clearRect(0, 0, width, height);
              ctx.drawImage(img, 0, 0);

              const piiWordIndexSet = new Set();
              for (const match of piiDetection.matches) {
                for (const idx of (match.wordIndices || [])) {
                  piiWordIndexSet.add(idx);
                }
              }

              // --- DEBUG OVERLAY MODE ---
              // When window.PARALLAX_DEBUG is true, draw all detected word bounding boxes color-coded:
              // - DOM-sourced words in blue (#3b82f6)
              // - OCR-sourced words in yellow (#eab308)
              if (window.PARALLAX_DEBUG) {
                for (const w of mergedWords) {
                  const { x, y, width: bw, height: bh } = w.bbox;
                  const isDom = w.source === 'DOM';
                  ctx.lineWidth = 1.5;
                  ctx.strokeStyle = isDom ? '#3b82f6' : '#eab308';
                  ctx.fillStyle = isDom ? 'rgba(59, 130, 246, 0.15)' : 'rgba(234, 179, 8, 0.15)';
                  ctx.strokeRect(x, y, bw, bh);
                  ctx.fillRect(x, y, bw, bh);

                  // Micro source badge
                  ctx.font = 'bold 9px "JetBrains Mono", monospace';
                  ctx.fillStyle = isDom ? '#3b82f6' : '#eab308';
                  ctx.fillText(isDom ? 'DOM' : 'OCR', x + 2, Math.max(9, y - 2));
                }
              } else {
                // Step 1A: Subtle low-opacity gray outline for non-PII text
                ctx.lineWidth = 1;
                ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
                ctx.fillStyle = 'rgba(148, 163, 184, 0.04)';
                for (let i = 0; i < mergedWords.length; i++) {
                  if (!piiWordIndexSet.has(i)) {
                    const { x, y, width: bw, height: bh } = mergedWords[i].bbox;
                    ctx.strokeRect(x, y, bw, bh);
                    ctx.fillRect(x, y, bw, bh);
                  }
                }
              }

              // Step 1B: Bold high-contrast red/orange (#E8491A) boxes ONLY for PII regions
              for (const match of piiDetection.matches) {
                const { x, y, width: bw, height: bh } = match.bbox;
                const pad = 4;
                const rx = Math.max(0, Math.floor(x - pad));
                const ry = Math.max(0, Math.floor(y - pad));
                const rw = Math.min(width - rx, Math.ceil(bw + pad * 2));
                const rh = Math.min(height - ry, Math.ceil(bh + pad * 2));

                const isAvatar = match.type === 'AVATAR';
                const tagColor = isAvatar ? '#a855f7' : '#E8491A';
                const tagBg = isAvatar ? 'rgba(168, 85, 247, 0.18)' : 'rgba(232, 73, 26, 0.22)';

                ctx.lineWidth = 3;
                ctx.strokeStyle = tagColor;
                ctx.fillStyle = tagBg;
                ctx.strokeRect(rx, ry, rw, rh);
                ctx.fillRect(rx, ry, rw, rh);

                // High-contrast PII / AVATAR label tag
                const tagH = Math.min(15, Math.max(11, Math.round(rh * 0.45)));
                const tagW = Math.min(rw, Math.max(50, match.type.length * 7 + 12));
                ctx.fillStyle = tagColor;
                ctx.fillRect(rx, Math.max(0, ry - tagH), tagW, tagH);
                ctx.font = `bold ${Math.round(tagH * 0.72)}px "JetBrains Mono", monospace`;
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(`! ${match.type}`, rx + 4, Math.max(0, ry - tagH) + tagH / 2);
              }
            }

            // 2. Sanitized View: Dramatic Gaussian Frosted Blur + Dark Privacy Tint + Cyber Mosaic
            if (sanCanvas && sanWrapper) {
              sanCanvas.width = width;
              sanCanvas.height = height;
              sanWrapper.classList.add('has-img');
              const sCtx = sanCanvas.getContext('2d');
              sCtx.clearRect(0, 0, width, height);
              sCtx.drawImage(img, 0, 0);

              for (const match of piiDetection.matches) {
                const { x, y, width: bw, height: bh } = match.bbox;
                const isAvatar = match.type === 'AVATAR';

                if (isAvatar) {
                  // --- ICONIC HIGH-TECH MOSAIC / PIXELATION FACE PRIVACY ---
                  const pad = 4;
                  const rx = Math.max(0, Math.floor(x - pad));
                  const ry = Math.max(0, Math.floor(y - pad));
                  const rw = Math.min(width - rx, Math.ceil(bw + pad * 2));
                  const rh = Math.min(height - ry, Math.ceil(bh + pad * 2));

                  if (rw > 4 && rh > 4) {
                    const isSmallIcon = (rw <= 140 && rh <= 140) && Math.abs(rw - rh) / Math.max(rw, rh) < 0.2;
                    const radius = isSmallIcon ? Math.min(rw, rh) / 2 : Math.min(14, rw * 0.05, rh * 0.05);

                    sCtx.save();
                    sCtx.beginPath();
                    if (typeof sCtx.roundRect === 'function') {
                      sCtx.roundRect(rx, ry, rw, rh, [radius]);
                    } else {
                      sCtx.rect(rx, ry, rw, rh);
                    }
                    sCtx.clip();

                    // Step 1: Calculate Crisp Mosaic Pixel Block Grid
                    const blockSize = Math.max(8, Math.min(20, Math.round(Math.min(rw, rh) / 9)));
                    const cols = Math.max(4, Math.round(rw / blockSize));
                    const rows = Math.max(4, Math.round(rh / blockSize));

                    // Step 2: Downsample Face Region to Grid Dimensions
                    const off = document.createElement('canvas');
                    off.width = cols;
                    off.height = rows;
                    const oCtx = off.getContext('2d');
                    oCtx.drawImage(img, rx, ry, rw, rh, 0, 0, cols, rows);

                    // Step 3: Draw Crisp Un-smoothed Pixelated Mosaic Blocks
                    sCtx.imageSmoothingEnabled = false;
                    if ('mozImageSmoothingEnabled' in sCtx) sCtx.mozImageSmoothingEnabled = false;
                    if ('webkitImageSmoothingEnabled' in sCtx) sCtx.webkitImageSmoothingEnabled = false;
                    if ('msImageSmoothingEnabled' in sCtx) sCtx.msImageSmoothingEnabled = false;
                    sCtx.drawImage(off, 0, 0, cols, rows, rx, ry, rw, rh);

                    // Step 4: Draw Cyber Mosaic Grid Lines
                    sCtx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
                    sCtx.lineWidth = 1;
                    for (let c = 1; c < cols; c++) {
                      const gx = rx + c * (rw / cols);
                      sCtx.beginPath();
                      sCtx.moveTo(gx, ry);
                      sCtx.lineTo(gx, ry + rh);
                      sCtx.stroke();
                    }
                    for (let r = 1; r < rows; r++) {
                      const gy = ry + r * (rh / rows);
                      sCtx.beginPath();
                      sCtx.moveTo(rx, gy);
                      sCtx.lineTo(rx + rw, gy);
                      sCtx.stroke();
                    }

                    // Step 5: Subtle Frosted Privacy Sheen
                    sCtx.fillStyle = 'rgba(255, 255, 255, 0.04)';
                    sCtx.fillRect(rx, ry, rw, rh);

                    sCtx.restore();
                  }

                } else {
                  // --- TEXT PII REDACTION (Dramatic Pitch-Black Solid Redaction Box) ---
                  const padX = 8;
                  const padY = 5;
                  const rh = Math.max(22, bh + padY * 2);
                  const labelText = `[REDACTED ${match.type}]`;
                  const fontSize = Math.max(10, Math.min(13, Math.round(rh * 0.52)));
                  sCtx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;
                  const textMetrics = sCtx.measureText(labelText);
                  const minBoxWidth = Math.ceil(textMetrics.width + 16);
                  const effectiveW = Math.max(bw + padX * 2, minBoxWidth);
                  const rx = Math.max(0, Math.round(x + bw / 2 - effectiveW / 2));
                  const ry = Math.max(0, y - padY);
                  const rw = effectiveW;

                  // Solid Pitch-Black Block
                  sCtx.fillStyle = '#030712';
                  sCtx.fillRect(rx, ry, rw, rh);

                  // Sharp High-Contrast Highlight Border
                  sCtx.strokeStyle = match.isLowConfidence ? '#f43f5e' : '#00f2fe';
                  sCtx.lineWidth = 2;
                  sCtx.strokeRect(rx, ry, rw, rh);

                  // Bold White Monospace Centered Label
                  sCtx.textAlign = 'center';
                  sCtx.textBaseline = 'middle';
                  sCtx.fillStyle = '#ffffff';
                  sCtx.fillText(labelText, rx + rw / 2, ry + rh / 2);
                }
              }
            }

            if (wordCount) wordCount.textContent = `${mergedWords.length} words`;
            if (redactCount) redactCount.textContent = `${piiDetection.matches.length} Redacted`;
            if (showcaseCount) showcaseCount.textContent = `${piiDetection.matches.length} SENSITIVE REGION${piiDetection.matches.length === 1 ? '' : 'S'} PROTECTED`;
            if (drawerBtnText) drawerBtnText.textContent = isDrawerOpen ? 'Collapse Showcase ▲' : `Showcase (${piiDetection.matches.length}) ▼`;

            // Render Glass Chips
            let chipsHtml = '';
            if (isPositionUncertain) {
              chipsHtml += `
                <div class="ptb-pii-chip" style="border-color: #f43f5e; background: rgba(244, 63, 94, 0.18);">
                  <div class="ptb-chip-left">
                    <span class="ptb-chip-tag" style="background: #f43f5e; color: #fff;">POSITION UNCERTAIN</span>
                    <span class="ptb-chip-text" style="color: #fca5a5;">Review manually: spatial discrepancy between DOM and OCR coordinates</span>
                  </div>
                  <span class="ptb-chip-conf conf-low">⚠️ BLOCKED</span>
                </div>
              `;
            }
            for (const m of piiDetection.matches) {
              const masked = maskPreview(m.matchedText, m.type);
              const confClass = m.isLowConfidence ? 'conf-low' : 'conf-high';
              chipsHtml += `
                <div class="ptb-pii-chip">
                  <div class="ptb-chip-left">
                    <span class="ptb-chip-tag ptb-tag-${m.type}">${m.type}</span>
                    <span class="ptb-chip-text" title="${m.matchedText}">${masked}</span>
                  </div>
                  <span class="ptb-chip-conf ${confClass}">${m.confidence}% ${m.isLowConfidence ? '⚠️' : '✓'}</span>
                </div>
              `;
            }
            if (chipsList) chipsList.innerHTML = chipsHtml;

            const matchCount = piiDetection.matches.length;
            if (isPositionUncertain) {
              setStatus('Sensitive match found but position could not be confirmed — review manually.', 'blocked');
            } else if (piiDetection.isBlocked) {
              setStatus(piiDetection.status, 'blocked');
            } else {
              setStatus(`Redaction Complete • ${matchCount} Protected`, 'ready');
            }

            // Log to IndexedDB (STRICT METADATA ONLY)
            try {
              await ParallaxDB.addLog({
                pageUrl: targetPageUrl,
                timestamp: new Date().toISOString(),
                detections: piiDetection.matches.map(m => ({
                  type: m.type,
                  confidence: m.confidence,
                  bbox: m.bbox
                })),
                redactedCount: piiDetection.matches.length,
                blocked: piiDetection.isBlocked,
                actionType: 'ON_DEVICE_REDACT',
                actionApproved: !piiDetection.isBlocked
              });
              await renderMetricsAndLogs();
            } catch (logErr) {
              console.warn('[ParallaxDB] Logging failed:', logErr);
            }

            // Open Showcase Drawer on Scan
            isDrawerOpen = true;
            if (drawer) drawer.classList.add('open');
            resizeHostIframe(true);

            const sanitizedText = PIIDetector.generateSanitizedText(mergedWords, piiDetection.matches);
            currentScanData = {
              sanitized_ocr_text: sanitizedText,
              extracted_words: mergedWords,
              pii_matches: piiDetection.matches,
              status: piiDetection.status,
              is_blocked: piiDetection.isBlocked
            };

            resolve();
          } catch (loadErr) {
            console.error('[Parallax] Canvas draw error:', loadErr);
            reject(loadErr);
          }
        };

        img.onerror = () => reject(new Error('Failed to load screenshot into image'));
        img.src = screenshotDataUrl;
      });

    } catch (err) {
      console.error('[Parallax] Scan Error:', err);
      setStatus(`Error: ${err.message}`, 'error');
    } finally {
      isScanning = false;
      if (scanBtn) scanBtn.disabled = false;
    }
  }

  if (scanBtn) scanBtn.addEventListener('click', () => executePerceptionScan());

  // Handle Download Sanitized Image
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      if (!sanCanvas || sanCanvas.width === 0) {
        setStatus('Scan the page first before downloading', 'warning');
        return;
      }
      const link = document.createElement('a');
      link.download = `parallax-redacted-${Date.now()}.png`;
      link.href = sanCanvas.toDataURL('image/png');
      link.click();
      setStatus('✓ Redacted image downloaded!', 'ready');
    });
  }

  // Handle Toggle Receipts Button
  const logSection = document.getElementById('ptbLogSection');
  const metricsPanel = document.getElementById('ptbMetricsPanel');
  let areReceiptsVisible = true;

  if (toggleReceiptsBtn) {
    toggleReceiptsBtn.addEventListener('click', () => {
      areReceiptsVisible = !areReceiptsVisible;
      if (logSection) logSection.style.display = areReceiptsVisible ? 'block' : 'none';
      if (metricsPanel) metricsPanel.style.display = areReceiptsVisible ? 'grid' : 'none';
      toggleReceiptsBtn.textContent = areReceiptsVisible ? '📊 Hide Metrics & Receipts ▲' : '📊 Reveal Metrics & Receipts ▼';
    });
  }

  // Handle Local Detection Audit Log Minimization / Collapse
  const logTableWrap = document.getElementById('ptbLogTableWrap');
  const logToggleBtn = document.getElementById('ptbLogToggleBtn');
  const logHeaderToggle = document.getElementById('ptbLogHeaderToggle');
  const logCollapseIcon = document.getElementById('ptbLogCollapseIcon');
  let isLogCollapsed = false;

  function toggleLogCollapse() {
    isLogCollapsed = !isLogCollapsed;
    if (logTableWrap) {
      logTableWrap.classList.toggle('collapsed', isLogCollapsed);
    }
    if (logToggleBtn) {
      logToggleBtn.textContent = isLogCollapsed ? '+ Expand' : '− Minimize';
    }
    if (logCollapseIcon) {
      logCollapseIcon.classList.toggle('ptb-log-collapsed-icon', isLogCollapsed);
    }
  }

  if (logToggleBtn) logToggleBtn.addEventListener('click', toggleLogCollapse);
  if (logHeaderToggle) logHeaderToggle.addEventListener('click', toggleLogCollapse);

  // --------------------------------------------------------------------------
  // Fullscreen Modal Viewer
  // --------------------------------------------------------------------------
  function renderFsCanvas() {
    const sourceCanvas = currentFsMode === 'original' ? origCanvas : sanCanvas;
    if (!sourceCanvas || sourceCanvas.width === 0) {
      if (fsCanvas) {
        fsCanvas.width = 800;
        fsCanvas.height = 500;
        const ctx = fsCanvas.getContext('2d');
        ctx.fillStyle = '#060a14';
        ctx.fillRect(0, 0, 800, 500);
        ctx.fillStyle = '#00f2fe';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Scan a page first to view in Full Screen', 400, 240);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '13px sans-serif';
        ctx.fillText('Click "Scan & Redact Page" to run visual perception scan', 400, 270);
      }
      return;
    }

    fsCanvas.width = sourceCanvas.width;
    fsCanvas.height = sourceCanvas.height;
    const ctx = fsCanvas.getContext('2d');
    ctx.clearRect(0, 0, fsCanvas.width, fsCanvas.height);
    ctx.drawImage(sourceCanvas, 0, 0);

    if (currentFsMode === 'original') {
      fsModeBadge.textContent = 'ORIGINAL VIEW';
      fsModeBadge.style.color = '#00f2fe';
      fsMetaText.textContent = `${wordCount ? wordCount.textContent : '0 words'} detected`;
      fsTabOrig.classList.add('active');
      fsTabSan.classList.remove('active');
    } else {
      fsModeBadge.textContent = 'SANITIZED VIEW';
      fsModeBadge.style.color = '#34d399';
      fsMetaText.textContent = `${redactCount ? redactCount.textContent : '0 Redacted'} protected`;
      fsTabSan.classList.add('active');
      fsTabOrig.classList.remove('active');
    }

    applyZoom();
  }

  function applyZoom() {
    if (fsCanvas) {
      fsCanvas.style.transform = `scale(${currentZoom})`;
    }
    if (fsZoomLevel) {
      fsZoomLevel.textContent = `${Math.round(currentZoom * 100)}%`;
    }
  }

  function openFullscreen(mode = 'original') {
    currentFsMode = mode;
    currentZoom = 1.0;
    if (fsModal) {
      fsModal.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    renderFsCanvas();
  }

  function closeFullscreen() {
    if (fsModal) {
      fsModal.classList.remove('open');
      document.body.style.overflow = '';
    }
  }

  if (fsOrigBtn) fsOrigBtn.addEventListener('click', () => openFullscreen('original'));
  if (fsSanBtn) fsSanBtn.addEventListener('click', () => openFullscreen('sanitized'));
  if (fsCloseBtn) fsCloseBtn.addEventListener('click', closeFullscreen);
  if (fsBackdrop) fsBackdrop.addEventListener('click', closeFullscreen);

  if (fsTabOrig) fsTabOrig.addEventListener('click', () => { currentFsMode = 'original'; renderFsCanvas(); });
  if (fsTabSan) fsTabSan.addEventListener('click', () => { currentFsMode = 'sanitized'; renderFsCanvas(); });

  if (fsZoomInBtn) fsZoomInBtn.addEventListener('click', () => { currentZoom = Math.min(3.0, currentZoom + 0.25); applyZoom(); });
  if (fsZoomOutBtn) fsZoomOutBtn.addEventListener('click', () => { currentZoom = Math.max(0.4, currentZoom - 0.25); applyZoom(); });
  if (fsZoomResetBtn) fsZoomResetBtn.addEventListener('click', () => { currentZoom = 1.0; applyZoom(); });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && fsModal && fsModal.classList.contains('open')) {
      closeFullscreen();
    }
  });
});
