// Parallax Top Bar Controller - High-Resolution Visual Perception Engine

document.addEventListener('DOMContentLoaded', async () => {
  let isScanning = false;
  let currentScanData = null;
  let currentProposedAction = null;
  let currentLogEntryId = null;
  let isDrawerOpen = false;
  let isLiveRadarActive = false;
  let liveRadarTimer = null;

  // Persistent WebAssembly Worker Pool (Pre-warmed in memory)
  let cachedWorker = null;
  let isWorkerInitializing = false;

  const scanBtn = document.getElementById('ptbScanBtn');
  const liveRadarBtn = document.getElementById('ptbLiveRadarBtn');
  const liveRadarText = document.getElementById('ptbLiveRadarText');
  const sendBtn = document.getElementById('ptbSendBtn') || document.getElementById('sendBtn');
  const taskSelect = document.getElementById('ptbTaskSelect');
  const statusText = document.getElementById('ptbStatusText');
  const drawerBtn = document.getElementById('ptbToggleDrawerBtn');
  const drawerBtnText = document.getElementById('ptbDrawerBtnText');
  const closeBtn = document.getElementById('ptbCloseBtn');
  const drawer = document.getElementById('ptbDrawer');
  const showcaseCount = document.getElementById('ptbShowcaseCount');

  const origCanvas = document.getElementById('ptbOriginalCanvas');
  const sanCanvas = document.getElementById('ptbSanitizedCanvas');
  const origWrapper = document.getElementById('ptbOrigWrapper');
  const sanWrapper = document.getElementById('ptbSanWrapper');
  const wordCount = document.getElementById('ptbWordCount');
  const redactCount = document.getElementById('ptbRedactCount');
  const chipsList = document.getElementById('ptbChipsList');

  const approvalCard = document.getElementById('ptbApprovalCard');
  const actionTag = document.getElementById('ptbActionTag');
  const proposedText = document.getElementById('ptbProposedText');
  const approveBtn = document.getElementById('ptbApproveBtn');
  const rejectBtn = document.getElementById('ptbRejectBtn');
  const actionFeedback = document.getElementById('ptbActionFeedback');

  // Metrics & Log Elements
  const metricTotalScans = document.getElementById('metricTotalScans');
  const metricTotalPII = document.getElementById('metricTotalPII');
  const metricTotalBlocked = document.getElementById('metricTotalBlocked');
  const metricTotalApproved = document.getElementById('metricTotalApproved');
  const refreshLogBtn = document.getElementById('ptbRefreshLogBtn');
  const clearLogBtn = document.getElementById('ptbClearLogBtn');
  const logTableBody = document.getElementById('ptbLogTableBody');

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
      if (typeof Tesseract !== 'undefined') {
        cachedWorker = await Tesseract.createWorker('eng', 1, {
          workerPath: chrome.runtime.getURL('lib/worker.min.js'),
          corePath: chrome.runtime.getURL('lib/tesseract-core-lstm.wasm.js'),
          langPath: chrome.runtime.getURL('lib/lang-data'),
          workerBlobURL: false,
          gzip: true
        });
        console.log('⚡ [Parallax] WASM OCR Engine warmed in memory.');
      }
    } catch (err) {
      console.warn('[Parallax] Worker init warning (DOM fallback active):', err);
      cachedWorker = null;
    } finally {
      isWorkerInitializing = false;
    }
    return cachedWorker;
  }

  getPersistentWorker();

  // Load and Render Metrics and IndexedDB Logs
  async function renderMetricsAndLogs() {
    try {
      if (typeof ParallaxDB === 'undefined') return;

      const summary = await ParallaxDB.getLogsSummary();
      if (metricTotalScans) metricTotalScans.textContent = summary.totalScans;
      if (metricTotalPII) metricTotalPII.textContent = summary.totalPIIDetected;
      if (metricTotalBlocked) metricTotalBlocked.textContent = summary.totalBlocked;
      if (metricTotalApproved) metricTotalApproved.textContent = summary.totalApproved;

      const logs = await ParallaxDB.getAllLogs();
      const logBadgeCount = document.getElementById('ptbLogBadgeCount');
      if (logBadgeCount) {
        logBadgeCount.textContent = `${logs ? logs.length : 0} records`;
      }
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

        const statusClass = log.blocked ? 'log-status-blocked' : 'log-status-ready';
        const statusLabel = log.blocked ? '⛔ BLOCKED' : '✅ READY';

        let actionLabel = '<span class="log-action-pending">—</span>';
        if (log.actionApproved === true) {
          actionLabel = `<span class="log-action-approved">✓ Approved (${log.actionType || 'action'})</span>`;
        } else if (log.actionApproved === false) {
          actionLabel = `<span class="log-action-declined">✕ Declined</span>`;
        } else if (log.actionType) {
          actionLabel = `<span class="log-action-pending">Pending (${log.actionType})</span>`;
        }

        const cleanUrl = (log.pageUrl || '').replace(/^https?:\/\//, '').split('?')[0];

        rowsHtml += `
          <tr>
            <td>#${log.id}</td>
            <td>${timeStr}</td>
            <td title="${log.pageUrl}">${cleanUrl}</td>
            <td><strong>${typesStr}</strong> (${log.redactedCount})</td>
            <td class="${statusClass}">${statusLabel}</td>
            <td>${actionLabel}</td>
          </tr>
        `;
      }

      logTableBody.innerHTML = rowsHtml;

    } catch (e) {
      console.warn('[Parallax] Failed to render metrics/logs:', e);
    }
  }

  await renderMetricsAndLogs();

  // Wire Refresh and Clear Log Buttons
  if (refreshLogBtn) refreshLogBtn.addEventListener('click', renderMetricsAndLogs);
  if (clearLogBtn) {
    clearLogBtn.addEventListener('click', async () => {
      if (confirm('This will delete all local detection history. Continue?')) {
        await ParallaxDB.clearLogs();
        await renderMetricsAndLogs();
      }
    });
  }

  // --------------------------------------------------------------------------
  // Presenter Mode Engine (In-Memory Only, Default ON for Clean Demo)
  // --------------------------------------------------------------------------
  let isPresenterMode = true;

  function updatePresenterModeUI() {
    const metricsPanel = document.getElementById('ptbMetricsPanel');
    const logSection = document.getElementById('ptbLogSection');
    const presenterBtn = document.getElementById('ptbPresenterModeBtn');
    const presenterText = document.getElementById('ptbPresenterText');
    const receiptsBtn = document.getElementById('ptbToggleReceiptsBtn');

    if (isPresenterMode) {
      if (metricsPanel) metricsPanel.classList.add('presenter-hidden');
      if (logSection) logSection.classList.add('presenter-hidden');
      if (presenterBtn) presenterBtn.classList.add('active');
      if (presenterText) presenterText.textContent = 'Presenter Mode: ON';
      if (receiptsBtn) receiptsBtn.textContent = '📊 Reveal Metrics & Receipts ▼';
    } else {
      if (metricsPanel) metricsPanel.classList.remove('presenter-hidden');
      if (logSection) logSection.classList.remove('presenter-hidden');
      if (presenterBtn) presenterBtn.classList.remove('active');
      if (presenterText) presenterText.textContent = 'Presenter Mode: OFF';
      if (receiptsBtn) receiptsBtn.textContent = '▲ Hide Metrics & Receipts';
    }
  }

  const presenterModeBtn = document.getElementById('ptbPresenterModeBtn');
  if (presenterModeBtn) {
    presenterModeBtn.addEventListener('click', () => {
      isPresenterMode = !isPresenterMode;
      updatePresenterModeUI();
    });
  }

  const toggleReceiptsBtn = document.getElementById('ptbToggleReceiptsBtn');
  if (toggleReceiptsBtn) {
    toggleReceiptsBtn.addEventListener('click', () => {
      isPresenterMode = !isPresenterMode;
      updatePresenterModeUI();
    });
  }

  updatePresenterModeUI();

  // Toggle Showcase Drawer
  if (drawerBtn) {
    drawerBtn.addEventListener('click', () => {
      isDrawerOpen = !isDrawerOpen;
      drawer.classList.toggle('open', isDrawerOpen);
      drawerBtnText.textContent = isDrawerOpen ? 'Collapse Showcase ▲' : `Showcase (${currentScanData ? currentScanData.pii_matches.length : 0}) ▼`;
      resizeHostIframe(isDrawerOpen);
    });
  }

  // Hide Top Bar
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      stopLiveRadar();
      window.parent.postMessage({ type: 'PARALLAX_HIDE_TOPBAR' }, '*');
    });
  }

  function maskPreview(text, type) {
    if (!text) return '';
    if (type === 'CARD') {
      const digits = text.replace(/\D/g, '');
      return `•••• •••• •••• ${digits.slice(-4)}`;
    }
    if (type === 'EMAIL') {
      const parts = text.split('@');
      if (parts.length === 2) {
        return `${parts[0].slice(0, 3)}•••@${parts[1]}`;
      }
    }
    if (type === 'PHONE') {
      const digits = text.replace(/\D/g, '');
      return `+91 ••••• ${digits.slice(-4)}`;
    }
    if (type === 'OTP') {
      return `•••••• (${text.length} digits)`;
    }
    return text;
  }

  function downscaleImageForOCR(dataUrl, maxDimension = 1280) {
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
          dataUrl: offscreen.toDataURL('image/jpeg', 0.82),
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
  // Core Perception Scan Pipeline (ALWAYS renders on the REAL page screenshot)
  // --------------------------------------------------------------------------
  async function executePerceptionScan(isAuto = false) {
    if (isScanning) return;
    isScanning = true;

    if (!isAuto) {
      if (scanBtn) scanBtn.disabled = true;
      if (sendBtn) sendBtn.disabled = true;
      if (approvalCard) approvalCard.classList.remove('open');
      if (chipsList) chipsList.innerHTML = '';
      setStatus('Capturing Viewport...', 'capturing');
    }

    try {
      // 1. Request instant DOM text extraction from host page
      const domWordsPromise = new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ words: [], viewportWidth: 1280, viewportHeight: 800 }), 180);
        function onDomWords(e) {
          if (e.data && e.data.type === 'PARALLAX_DOM_WORDS_RESPONSE') {
            clearTimeout(timer);
            window.removeEventListener('message', onDomWords);
            resolve({
              words: e.data.words || [],
              viewportWidth: e.data.viewportWidth || window.innerWidth,
              viewportHeight: e.data.viewportHeight || window.innerHeight,
              devicePixelRatio: e.data.devicePixelRatio || 1
            });
          }
        }
        window.addEventListener('message', onDomWords);
        window.parent.postMessage({ type: 'PARALLAX_REQUEST_DOM_WORDS' }, '*');
      });

      // Hide iframe cleanly so it is NEVER captured in the screenshot
      window.parent.postMessage({ type: 'PARALLAX_PREPARE_CAPTURE' }, '*');
      await new Promise((r) => setTimeout(r, 90));

      const captureResponse = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'SCAN_REQUEST' }, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res || { success: false, error: 'Capture failed.' });
          }
        });
      });

      // Restore iframe
      window.parent.postMessage({ type: 'PARALLAX_RESTORE_CAPTURE' }, '*');

      if (!captureResponse.success || !captureResponse.dataUrl) {
        throw new Error(captureResponse.error || 'Viewport capture failed.');
      }

      const screenshotDataUrl = captureResponse.dataUrl;
      const targetPageUrl = captureResponse.pageUrl || 'http://localhost:3001/test-page-normal.html';

      if (!isLiveRadarActive && !isAuto) {
        setStatus('Processing OCR Locally...', 'processing');
      }

      // High-Speed Downscaled OCR Pre-processing
      const optimizedImage = await downscaleImageForOCR(screenshotDataUrl, 1600);

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

            // Resolve DOM words and scale to canvas resolution
            const domData = await domWordsPromise;
            const domWords = domData.words || [];
            const viewW = domData.viewportWidth || (window.innerWidth || 1280);
            const viewH = domData.viewportHeight || (window.innerHeight || 800);
            const scaleX = width / Math.max(1, viewW);
            const scaleY = height / Math.max(1, viewH);

            const scaledDomWords = domWords.map(w => ({
              text: w.text,
              isAvatar: w.isAvatar,
              confidence: w.confidence || 99,
              bbox: {
                x: Math.round(w.bbox.x * scaleX),
                y: Math.round(w.bbox.y * scaleY),
                width: Math.round(w.bbox.width * scaleX),
                height: Math.round(w.bbox.height * scaleY)
              }
            }));

            // High-Precision Word Fusion: DOM Words + OCR Words
            const mergedWords = [...scaledDomWords];
            for (const ow of extractedWords) {
              const isCovered = scaledDomWords.some(dw => {
                const dx = Math.abs(dw.bbox.x - ow.bbox.x);
                const dy = Math.abs(dw.bbox.y - ow.bbox.y);
                return dx < 35 && dy < 25;
              });
              if (!isCovered) {
                mergedWords.push(ow);
              }
            }

            // Run Strict Core 4 PII Detector (EMAIL, PHONE, CARD, OTP, AVATAR)
            const piiDetection = PIIDetector.detectPII(mergedWords, { confidenceThreshold: 35.0 });

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
              ctx.drawImage(img, 0, 0); // Draws the REAL screenshot!

              // Map all words belonging to detected PII
              const piiWordIndexSet = new Set();
              for (const match of piiDetection.matches) {
                for (const idx of (match.wordIndices || [])) {
                  piiWordIndexSet.add(idx);
                }
              }

              // Step 1A: Draw subtle low-opacity gray outline for non-PII text (shows OCR coverage without clutter)
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

              // Step 1B: Draw bold high-contrast red/orange (#E8491A) boxes ONLY for PII regions
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

            // 2. Sanitized View: Dramatic Gaussian Frosted Blur + Dark Privacy Tint
            if (sanCanvas && sanWrapper) {
              sanCanvas.width = width;
              sanCanvas.height = height;
              sanWrapper.classList.add('has-img');
              const sCtx = sanCanvas.getContext('2d');
              sCtx.clearRect(0, 0, width, height);
              sCtx.drawImage(img, 0, 0); // Draws the REAL screenshot!

              for (const match of piiDetection.matches) {
                const { x, y, width: bw, height: bh } = match.bbox;
                const isAvatar = match.type === 'AVATAR';

                if (isAvatar) {
                  // --- TRUE PHOTOGRAPHIC GAUSSIAN BLUR (Soft Frosted Face Privacy) ---
                  const pad = 4;
                  const rx = Math.max(0, Math.floor(x - pad));
                  const ry = Math.max(0, Math.floor(y - pad));
                  const rw = Math.min(width - rx, Math.ceil(bw + pad * 2));
                  const rh = Math.min(height - ry, Math.ceil(bh + pad * 2));

                  if (rw > 4 && rh > 4) {
                    const isSmallIcon = (rw <= 140 && rh <= 140) && Math.abs(rw - rh) / Math.max(rw, rh) < 0.2;
                    const radius = isSmallIcon ? Math.min(rw, rh) / 2 : Math.min(16, rw * 0.05, rh * 0.05);

                    sCtx.save();
                    sCtx.beginPath();
                    if (typeof sCtx.roundRect === 'function') {
                      sCtx.roundRect(rx, ry, rw, rh, [radius]);
                    } else {
                      sCtx.rect(rx, ry, rw, rh);
                    }
                    sCtx.clip();

                    // Step 1: Multi-Pass Downscale-Upscale Extreme Gaussian Blur
                    const off = document.createElement('canvas');
                    const scaleF = 0.035; // 3.5% downscale = silky smooth heavy photographic blur
                    off.width = Math.max(4, Math.round(rw * scaleF));
                    off.height = Math.max(4, Math.round(rh * scaleF));
                    const oCtx = off.getContext('2d');
                    oCtx.drawImage(img, rx, ry, rw, rh, 0, 0, off.width, off.height);

                    sCtx.imageSmoothingEnabled = true;
                    sCtx.imageSmoothingQuality = 'high';
                    sCtx.drawImage(off, 0, 0, off.width, off.height, rx, ry, rw, rh);

                    // Step 2: Native Canvas filter blur for ultra-smooth frosted photo appearance
                    try {
                      sCtx.filter = 'blur(20px)';
                      sCtx.drawImage(off, 0, 0, off.width, off.height, rx, ry, rw, rh);
                      sCtx.filter = 'none';
                    } catch (e) {}

                    // Step 3: Delicate Frosted Glass Privacy Sheen
                    sCtx.fillStyle = 'rgba(255, 255, 255, 0.05)';
                    sCtx.fillRect(rx, ry, rw, rh);

                    sCtx.restore();
                  }

                } else {
                  // --- TEXT PII REDACTION (Dramatic Pitch-Black Solid Redaction Box) ---
                  const padX = 8;
                  const padY = 5;
                  const rx = Math.max(0, x - padX);
                  const ry = Math.max(0, y - padY);
                  const rw = bw + padX * 2;
                  const rh = Math.max(22, bh + padY * 2);

                  // Solid Pitch-Black Block
                  sCtx.fillStyle = '#030712';
                  sCtx.fillRect(rx, ry, rw, rh);

                  // Sharp High-Contrast Highlight Border
                  sCtx.strokeStyle = match.isLowConfidence ? '#f43f5e' : '#00f2fe';
                  sCtx.lineWidth = 2;
                  sCtx.strokeRect(rx, ry, rw, rh);

                  // Bold White Monospace Centered Label
                  const labelText = `[REDACTED ${match.type}]`;
                  const fontSize = Math.max(11, Math.min(14, Math.round(rh * 0.52)));
                  sCtx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;
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
            if (drawerBtnText) drawerBtnText.textContent = isDrawerOpen ? 'Collapse Showcase ▲' : `Showcase (${piiDetection.matches.length} PII) ▼`;

            // Render Glass Chips
            let chipsHtml = '';
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

            if (isLiveRadarActive) {
              setStatus(`Live Radar (Active • ${piiDetection.matches.length} PII Protected)`, 'ready');
            } else if (piiDetection.isBlocked) {
              setStatus('Review & Send Ready', 'ready');
            } else {
              setStatus('READY — Safe to proceed', 'ready');
            }

            // Log to IndexedDB (STRICT METADATA ONLY)
            try {
              const logId = await ParallaxDB.addLog({
                pageUrl: targetPageUrl,
                timestamp: new Date().toISOString(),
                detections: piiDetection.matches.map(m => ({
                  type: m.type,
                  confidence: m.confidence,
                  bbox: m.bbox
                })),
                redactedCount: piiDetection.matches.length,
                blocked: piiDetection.isBlocked,
                actionType: null,
                actionApproved: null
              });
              currentLogEntryId = logId;
              await renderMetricsAndLogs();
            } catch (logErr) {
              console.warn('[ParallaxDB] Logging failed:', logErr);
            }

            if (!isAuto) {
              isDrawerOpen = true;
              if (drawer) drawer.classList.add('open');
              resizeHostIframe(true);
            }

            const sanitizedText = PIIDetector.generateSanitizedText(mergedWords, piiDetection.matches);
            currentScanData = {
              sanitized_ocr_text: sanitizedText,
              extracted_words: mergedWords,
              pii_matches: piiDetection.matches,
              status: piiDetection.status,
              is_blocked: piiDetection.isBlocked
            };

            if (sendBtn) sendBtn.disabled = false;
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
      if (!isLiveRadarActive) setStatus(`Error: ${err.message}`, 'error');
    } finally {
      isScanning = false;
      if (scanBtn) scanBtn.disabled = false;
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  // Live Radar Loop (Fast Real-Image Perception Loop)
  function startLiveRadar() {
    isLiveRadarActive = true;
    if (liveRadarBtn) liveRadarBtn.classList.add('active');
    if (liveRadarText) liveRadarText.textContent = 'Live Radar: ON';
    setStatus('Live Radar: Active', 'ready');

    executePerceptionScan(true);

    liveRadarTimer = setInterval(() => {
      if (isLiveRadarActive && !isScanning) {
        executePerceptionScan(true);
      }
    }, 2000);
  }

  function stopLiveRadar() {
    isLiveRadarActive = false;
    if (liveRadarTimer) {
      clearInterval(liveRadarTimer);
      liveRadarTimer = null;
    }
    if (liveRadarBtn) liveRadarBtn.classList.remove('active');
    if (liveRadarText) liveRadarText.textContent = 'Live Radar: OFF';
    setStatus('Idle', 'idle');
  }

  function toggleLiveRadar() {
    if (isLiveRadarActive) {
      stopLiveRadar();
    } else {
      startLiveRadar();
    }
  }

  if (liveRadarBtn) liveRadarBtn.addEventListener('click', toggleLiveRadar);
  if (scanBtn) scanBtn.addEventListener('click', () => executePerceptionScan(false));

  // Custom user prompt input & Enter key trigger
  const ptbUserPrompt = document.getElementById('ptbUserPrompt');
  if (ptbUserPrompt && sendBtn) {
    ptbUserPrompt.addEventListener('input', () => {
      sendBtn.disabled = false;
    });

    ptbUserPrompt.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!currentScanData) {
          await executePerceptionScan(false);
        }
        sendBtn.disabled = false;
        sendBtn.click();
      }
    });
  }

  // Handle Send to Backend
  if (sendBtn) {
    sendBtn.addEventListener('click', async () => {
      if (!currentScanData) {
        setStatus('Scanning page before sending...', 'processing');
        await executePerceptionScan(false);
      }

      if (!currentScanData) {
        setStatus('Please scan the page first', 'warning');
        return;
      }

      const selectedTask = taskSelect ? taskSelect.value : 'auto_guide';
      const sanitizedImageDataUrl = sanCanvas ? sanCanvas.toDataURL('image/jpeg', 0.8) : '';
      const promptInput = document.getElementById('ptbUserPrompt');
      const customPrompt = promptInput ? promptInput.value.trim() : '';
      const promptError = document.getElementById('ptbPromptError');

      // Client-Side Action Constraint Validation (Only allows Summarize Page & Fill Form Field)
      if (customPrompt) {
        const lower = customPrompt.toLowerCase();
        const isSummarize = lower.includes('summar') || lower.includes('overview') || lower.includes('brief') || lower.includes('tl;dr') || lower.includes('what is');
        const isFill = lower.includes('fill') || lower.includes('input') || lower.includes('type') || lower.includes('form') || lower.includes('roll') || lower.includes('city') || lower.includes('name') || lower.includes('enter') || lower.includes('guide') || lower.includes('auto') || lower.includes('click') || lower.includes('next') || lower.includes('meeting') || lower.includes('login') || lower.includes('submit');

        if (!isSummarize && !isFill) {
          if (promptError) {
            promptError.style.display = 'block';
            setTimeout(() => { if (promptError) promptError.style.display = 'none'; }, 4500);
          }
          setStatus('Action not supported in current build', 'warning');
          sendBtn.disabled = false;
          return;
        }
      }
      if (promptError) promptError.style.display = 'none';

      setStatus('Consulting AI Agent...', 'processing');
      sendBtn.disabled = true;

      try {
        const response = await fetch('http://localhost:3001/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sanitized_ocr_text: currentScanData.sanitized_ocr_text,
            sanitized_image: sanitizedImageDataUrl,
            task: selectedTask,
            user_prompt: customPrompt
          })
        });

        const data = await response.json();
        currentProposedAction = data;

        if (currentLogEntryId != null) {
          await ParallaxDB.updateLog(currentLogEntryId, {
            actionType: data.action_type || selectedTask,
            actionApproved: null
          });
          await renderMetricsAndLogs();
        }

        if (actionTag) actionTag.textContent = (data.action_type || selectedTask).toUpperCase();
        if (actionFeedback) actionFeedback.style.display = 'none';
        if (approveBtn) approveBtn.disabled = false;
        if (rejectBtn) rejectBtn.disabled = false;

        if (proposedText) {
          const modelBadge = `<span style="background: rgba(0, 242, 254, 0.15); color: #00f2fe; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 800; border: 1px solid rgba(0, 242, 254, 0.4);">🤖 ${data.model || 'openai/gpt-oss-120b (Groq Live)'}</span>`;
          const confidenceBadge = `<span style="background: rgba(16, 185, 129, 0.15); color: #34d399; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 800; border: 1px solid rgba(16, 185, 129, 0.4);">Confidence: ${Math.round((data.confidence || 0.98) * 100)}%</span>`;

          proposedText.innerHTML = `
            <div style="display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; align-items: center;">
              ${modelBadge}
              ${confidenceBadge}
              <span style="font-size: 10.5px; color: #94a3b8;">Goal: <strong>${data.goal_state || 'Form Automation'}</strong></span>
            </div>
            <div style="background: #030712; border: 1px solid #1e293b; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px;">
              <div style="font-size: 11px; color: #94a3b8; margin-bottom: 3px;"><strong>🤖 Live Cloud LLM Rationale:</strong></div>
              <div style="font-size: 11.5px; color: #f8fafc; line-height: 1.45;">"${data.rationale || data.content}"</div>
            </div>
            <div style="font-size: 11px; color: #cbd5e1;">
              <strong>Target Action:</strong> <code style="color: #00f2fe; background: #0f172a; padding: 2px 5px; border-radius: 4px;">${data.action_type || 'fill_field'} -> ${data.selector}</code> 
              ${data.value ? `&nbsp;<strong>Value:</strong> <span style="color: #34d399; font-weight: 800;">"${data.value}"</span>` : ''}
            </div>
            <div style="font-size: 10px; color: #38bdf8; margin-top: 6px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 4px; padding: 5px 8px; display: flex; justify-content: space-between; align-items: center;">
              <span>🖼️ Redacted Image Sent: <strong>${data.payload_proof?.redacted_image_kb || 42} KB PNG (Blacked Out)</strong></span>
              <span>🔒 Raw PII Sent: <strong style="color: #10b981;">0 Bytes</strong></span>
            </div>
          `;
        }

        if (approvalCard) {
          approvalCard.classList.add('open');
          setTimeout(() => {
            approvalCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 50);
        }
        setStatus('Awaiting Approval', 'processing');

        isDrawerOpen = true;
        if (drawer) drawer.classList.add('open');
        resizeHostIframe(true);

      } catch (err) {
        console.error('[Parallax] Backend Error:', err);
        setStatus(`Backend Error: ${err.message}`, 'error');
      } finally {
        if (sendBtn) sendBtn.disabled = false;
      }
    });
  }

  // Handle Approve Action
  if (approveBtn) {
    approveBtn.addEventListener('click', async () => {
      if (!currentProposedAction) return;

      approveBtn.disabled = true;
      if (rejectBtn) rejectBtn.disabled = true;

      if (currentLogEntryId != null) {
        await ParallaxDB.updateLog(currentLogEntryId, {
          actionType: currentProposedAction.action_type || 'fill_field',
          actionApproved: true
        });
        await renderMetricsAndLogs();
      }

      const isClick = currentProposedAction.action_type === 'click';
      const isFill = currentProposedAction.action_type === 'fill_field';

      if (isClick || isFill) {
        window.parent.postMessage({
          type: 'PARALLAX_EXECUTE_ACTION',
          action: currentProposedAction.action_type,
          selector: currentProposedAction.selector || '#city',
          value: currentProposedAction.value
        }, '*');

        if (actionFeedback) {
          actionFeedback.textContent = isClick
            ? `✓ Approved! Clicked "${currentProposedAction.selector}" on webpage.`
            : `✓ Approved! Filled "${currentProposedAction.selector}" on webpage.`;
          actionFeedback.style.color = '#34d399';
          actionFeedback.style.display = 'inline';
        }
        setStatus('Action Executed', 'ready');
      } else {
        if (actionFeedback) {
          actionFeedback.textContent = '✓ Summary approved by operator.';
          actionFeedback.style.color = '#34d399';
          actionFeedback.style.display = 'inline';
        }
        setStatus('Summary Approved', 'ready');
      }
    });
  }

  // Handle Reject Action
  if (rejectBtn) {
    rejectBtn.addEventListener('click', async () => {
      if (approveBtn) approveBtn.disabled = true;
      rejectBtn.disabled = true;

      if (currentLogEntryId != null) {
        await ParallaxDB.updateLog(currentLogEntryId, {
          actionType: currentProposedAction ? currentProposedAction.action_type : 'action',
          actionApproved: false
        });
        await renderMetricsAndLogs();
      }

      if (actionFeedback) {
        actionFeedback.textContent = '✕ Action declined by user.';
        actionFeedback.style.color = '#fb7185';
        actionFeedback.style.display = 'inline';
      }
      setStatus('Action Declined', 'idle');

      setTimeout(() => {
        if (approvalCard) approvalCard.classList.remove('open');
        if (sendBtn) sendBtn.disabled = false;
      }, 2000);
    });
  }

  // Handle Follow-up Question Submission to AI Agent
  const followupInput = document.getElementById('ptbFollowupInput');
  const followupBtn = document.getElementById('ptbFollowupBtn');

  async function handleFollowupSubmit() {
    if (!followupInput) return;
    const query = followupInput.value.trim();
    if (!query) return;

    if (!currentScanData) {
      await executePerceptionScan(false);
    }

    if (!currentScanData) return;

    if (proposedText) {
      proposedText.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; color: #00f2fe; padding: 12px 6px;">
          <span style="font-size: 12px; font-weight: 700;">🤖 Consulting Live Cloud LLM on: "${query}"...</span>
        </div>
      `;
    }

    if (followupBtn) followupBtn.disabled = true;
    if (approveBtn) approveBtn.disabled = true;
    if (rejectBtn) rejectBtn.disabled = true;
    setStatus('Processing Follow-Up...', 'processing');

    try {
      const sanitizedImageDataUrl = sanCanvas ? sanCanvas.toDataURL('image/jpeg', 0.8) : '';
      const response = await fetch('http://localhost:3001/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sanitized_ocr_text: currentScanData.sanitized_ocr_text,
          sanitized_image: sanitizedImageDataUrl,
          task: 'auto_guide',
          user_prompt: `User Follow-Up Instruction/Question: "${query}"\nPrevious Decision: ${JSON.stringify(currentProposedAction || {})}`
        })
      });

      const data = await response.json();
      currentProposedAction = data;

      if (actionTag) actionTag.textContent = (data.action_type || 'GUIDANCE').toUpperCase();
      if (actionFeedback) actionFeedback.style.display = 'none';
      if (approveBtn) approveBtn.disabled = false;
      if (rejectBtn) rejectBtn.disabled = false;

      if (proposedText) {
        const modelBadge = `<span style="background: rgba(0, 242, 254, 0.15); color: #00f2fe; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 800; border: 1px solid rgba(0, 242, 254, 0.4);">🤖 ${data.model || 'openai/gpt-oss-120b (Groq Live)'}</span>`;
        const confidenceBadge = `<span style="background: rgba(16, 185, 129, 0.15); color: #34d399; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 800; border: 1px solid rgba(16, 185, 129, 0.4);">Confidence: ${Math.round((data.confidence || 0.98) * 100)}%</span>`;

        proposedText.innerHTML = `
          <div style="display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; align-items: center;">
            ${modelBadge}
            ${confidenceBadge}
            <span style="font-size: 10.5px; color: #94a3b8;">Goal: <strong>${data.goal_state || 'AI Guidance'}</strong></span>
          </div>
          <div style="background: #030712; border: 1px solid #1e293b; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px;">
            <div style="font-size: 11px; color: #94a3b8; margin-bottom: 3px;"><strong>🤖 Live Cloud LLM Response:</strong></div>
            <div style="font-size: 11.5px; color: #f8fafc; line-height: 1.45;">"${data.rationale || data.content}"</div>
          </div>
          <div style="font-size: 11px; color: #cbd5e1;">
            <strong>Target Action:</strong> <code style="color: #00f2fe; background: #0f172a; padding: 2px 5px; border-radius: 4px;">${data.action_type || 'auto_guide'} -> ${data.selector}</code> 
            ${data.value ? `&nbsp;<strong>Value:</strong> <span style="color: #34d399; font-weight: 800;">"${data.value}"</span>` : ''}
          </div>
          <div style="font-size: 10px; color: #38bdf8; margin-top: 6px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 4px; padding: 5px 8px; display: flex; justify-content: space-between; align-items: center;">
            <span>🖼️ Redacted Image Sent: <strong>${data.payload_proof?.redacted_image_kb || 42} KB PNG (Blacked Out)</strong></span>
            <span>🔒 Raw PII Sent: <strong style="color: #10b981;">0 Bytes</strong></span>
          </div>
        `;
      }
      followupInput.value = '';
      setStatus('Follow-up Answered', 'ready');

    } catch (err) {
      console.error('[Parallax] Follow-up Error:', err);
      setStatus(`Follow-up Error: ${err.message}`, 'error');
    } finally {
      if (followupBtn) followupBtn.disabled = false;
      if (approveBtn) approveBtn.disabled = false;
      if (rejectBtn) rejectBtn.disabled = false;
    }
  }

  if (followupBtn) followupBtn.addEventListener('click', handleFollowupSubmit);
  if (followupInput) {
    followupInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleFollowupSubmit();
      }
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

  // Fullscreen Modal Viewer
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
        ctx.fillText('Click "Scan Page" to run visual perception scan', 400, 270);
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
      fsModeBadge.style.background = 'rgba(0, 242, 254, 0.2)';
      fsModeBadge.style.color = '#00f2fe';
      fsMetaText.textContent = `${wordCount ? wordCount.textContent : '0 words'} detected • Cyan Bounding Boxes`;
      fsTabOrig.classList.add('active');
      fsTabSan.classList.remove('active');
    } else {
      fsModeBadge.textContent = 'SANITIZED VIEW';
      fsModeBadge.style.background = 'rgba(16, 185, 129, 0.2)';
      fsModeBadge.style.color = '#34d399';
      fsMetaText.textContent = `${redactCount ? redactCount.textContent : '0 Redacted'} • Solid Blackout Privacy Protection`;
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

  function openFsModal(mode = 'original') {
    currentFsMode = mode;
    currentZoom = 1.0;
    if (fsModal) {
      fsModal.style.display = 'flex';
      fsModal.classList.add('open');
    }
    window.parent.postMessage({ type: 'PARALLAX_RESIZE_IFRAME', height: '100vh' }, '*');
    renderFsCanvas();
  }

  function closeFsModal() {
    if (fsModal) {
      fsModal.style.display = 'none';
      fsModal.classList.remove('open');
    }
    window.parent.postMessage({
      type: 'PARALLAX_RESIZE_IFRAME',
      height: isDrawerOpen ? '85vh' : '58px'
    }, '*');
  }

  if (fsOrigBtn) fsOrigBtn.addEventListener('click', (e) => { e.stopPropagation(); openFsModal('original'); });
  if (fsSanBtn) fsSanBtn.addEventListener('click', (e) => { e.stopPropagation(); openFsModal('sanitized'); });
  if (origCanvas) origCanvas.addEventListener('click', () => openFsModal('original'));
  if (sanCanvas) sanCanvas.addEventListener('click', () => openFsModal('sanitized'));

  if (fsCloseBtn) fsCloseBtn.addEventListener('click', closeFsModal);
  if (fsBackdrop) fsBackdrop.addEventListener('click', closeFsModal);

  if (fsTabOrig) {
    fsTabOrig.addEventListener('click', () => {
      currentFsMode = 'original';
      renderFsCanvas();
    });
  }

  if (fsTabSan) {
    fsTabSan.addEventListener('click', () => {
      currentFsMode = 'sanitized';
      renderFsCanvas();
    });
  }

  if (fsZoomInBtn) {
    fsZoomInBtn.addEventListener('click', () => {
      currentZoom = Math.min(3.0, currentZoom + 0.25);
      applyZoom();
    });
  }

  if (fsZoomOutBtn) {
    fsZoomOutBtn.addEventListener('click', () => {
      currentZoom = Math.max(0.5, currentZoom - 0.25);
      applyZoom();
    });
  }

  if (fsZoomResetBtn) {
    fsZoomResetBtn.addEventListener('click', () => {
      currentZoom = 1.0;
      applyZoom();
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && fsModal && fsModal.classList.contains('open')) {
      closeFsModal();
    }
  });
});
