// Parallax Top Bar Controller - Dual Mode: 60 FPS Instant DOM Radar + Deep WASM Vision OCR

document.addEventListener('DOMContentLoaded', async () => {
  let isScanning = false;
  let currentScanData = null;
  let currentProposedAction = null;
  let currentLogEntryId = null;
  let isDrawerOpen = false;
  let isLiveRadarActive = false;

  // Persistent Web Worker Pool for on-demand Deep OCR
  let cachedWorker = null;
  let isWorkerInitializing = false;

  const scanBtn = document.getElementById('ptbScanBtn');
  const liveRadarBtn = document.getElementById('ptbLiveRadarBtn');
  const liveRadarText = document.getElementById('ptbLiveRadarText');
  const sendBtn = document.getElementById('sendBtn');
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

  // Pre-warm Persistent WASM Worker in background for Deep Scan
  async function getPersistentWorker() {
    if (cachedWorker) return cachedWorker;
    if (isWorkerInitializing) {
      while (isWorkerInitializing) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (cachedWorker) return cachedWorker;
    }

    isWorkerInitializing = true;
    try {
      cachedWorker = await Tesseract.createWorker('eng', 1, {
        workerPath: chrome.runtime.getURL('lib/worker.min.js'),
        corePath: chrome.runtime.getURL('lib/tesseract-core-lstm.wasm.js'),
        langPath: chrome.runtime.getURL('lib/lang-data'),
        workerBlobURL: false,
        gzip: true
      });
      console.log('⚡ [Parallax] Deep WASM OCR Worker warmed in background.');
    } catch (err) {
      console.error('[Parallax] Worker init error:', err);
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

  // --------------------------------------------------------------------------
  // Instant 60 FPS DOM Spatial Sync Handler (0ms Latency)
  // --------------------------------------------------------------------------
  window.addEventListener('message', async (event) => {
    if (!event.data || typeof event.data !== 'object') return;

    if (event.data.type === 'PARALLAX_INSTANT_LIVE_SYNC' && isLiveRadarActive) {
      const { words, piiMatches, isBlocked, sanitizedText, pageUrl, viewportWidth, viewportHeight } = event.data;

      const w = viewportWidth || 1200;
      const h = viewportHeight || 800;

      // Instant Canvas Painting (60 FPS)
      if (origCanvas && origWrapper) {
        origCanvas.width = w;
        origCanvas.height = h;
        origWrapper.classList.add('has-img');
        const ctx = origCanvas.getContext('2d');
        ctx.fillStyle = '#0a0f1d';
        ctx.fillRect(0, 0, w, h);

        ctx.lineWidth = 2;
        ctx.strokeStyle = '#00f2fe';
        ctx.fillStyle = 'rgba(0, 242, 254, 0.12)';
        for (const item of words) {
          const { x, y, width: bw, height: bh } = item.bbox;
          ctx.strokeRect(x, y, bw, bh);
          ctx.fillRect(x, y, bw, bh);
        }
      }

      if (sanCanvas && sanWrapper) {
        sanCanvas.width = w;
        sanCanvas.height = h;
        sanWrapper.classList.add('has-img');
        const sCtx = sanCanvas.getContext('2d');
        sCtx.fillStyle = '#0a0f1d';
        sCtx.fillRect(0, 0, w, h);

        // Safe background wireframe
        sCtx.fillStyle = '#1e293b';
        for (const item of words) {
          const { x, y, width: bw, height: bh } = item.bbox;
          sCtx.fillRect(x, y, bw, bh);
        }

        // Blackout Sensitive Regions
        for (const match of piiMatches) {
          const { x, y, width: bw, height: bh } = match.bbox;
          const pad = 4;
          const rx = Math.max(0, x - pad);
          const ry = Math.max(0, y - pad);
          const rw = bw + pad * 2;
          const rh = bh + pad * 2;

          sCtx.fillStyle = '#05070d';
          sCtx.fillRect(rx, ry, rw, rh);
          sCtx.strokeStyle = '#10b981';
          sCtx.lineWidth = 2;
          sCtx.strokeRect(rx, ry, rw, rh);

          sCtx.font = `bold 11px "JetBrains Mono", monospace`;
          sCtx.textAlign = 'center';
          sCtx.textBaseline = 'middle';
          sCtx.fillStyle = '#34d399';
          sCtx.fillText(`[${match.type}]`, rx + rw / 2, ry + rh / 2);
        }
      }

      if (wordCount) wordCount.textContent = `${words.length} elements`;
      if (redactCount) redactCount.textContent = `${piiMatches.length} Redacted`;
      if (showcaseCount) showcaseCount.textContent = `${piiMatches.length} SENSITIVE REGION${piiMatches.length === 1 ? '' : 'S'} PROTECTED`;
      if (drawerBtnText) drawerBtnText.textContent = isDrawerOpen ? 'Collapse Showcase ▲' : `Showcase (${piiMatches.length} PII) ▼`;

      // Render Chips
      let chipsHtml = '';
      for (const m of piiMatches) {
        const masked = maskPreview(m.matchedText, m.type);
        chipsHtml += `
          <div class="ptb-pii-chip">
            <div class="ptb-chip-left">
              <span class="ptb-chip-tag ptb-tag-${m.type}">${m.type}</span>
              <span class="ptb-chip-text" title="${m.matchedText}">${masked}</span>
            </div>
            <span class="ptb-chip-conf conf-high">100% ⚡</span>
          </div>
        `;
      }
      if (chipsList) chipsList.innerHTML = chipsHtml;

      setStatus(`Live 60FPS Radar (${piiMatches.length} PII Active)`, 'ready');
      if (sendBtn) sendBtn.disabled = isBlocked;

      currentScanData = {
        sanitized_ocr_text: sanitizedText,
        extracted_words: words,
        pii_matches: piiMatches,
        status: isBlocked ? 'blocked' : 'ready',
        is_blocked: isBlocked
      };
    }
  });

  // --------------------------------------------------------------------------
  // Deep On-Device Vision Scan (WASM OCR Snapshot on button click)
  // --------------------------------------------------------------------------
  async function executeDeepVisionScan() {
    if (isScanning) return;
    isScanning = true;

    if (scanBtn) scanBtn.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    if (approvalCard) approvalCard.classList.remove('open');
    if (chipsList) chipsList.innerHTML = '';
    setStatus('Capturing Viewport...', 'capturing');

    try {
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

      window.parent.postMessage({ type: 'PARALLAX_RESTORE_CAPTURE' }, '*');

      if (!captureResponse.success || !captureResponse.dataUrl) {
        throw new Error(captureResponse.error || 'Viewport capture failed.');
      }

      const screenshotDataUrl = captureResponse.dataUrl;
      const targetPageUrl = captureResponse.pageUrl || 'http://localhost:3001/test-page-normal.html';

      setStatus('Processing Deep Vision OCR...', 'processing');

      const worker = await getPersistentWorker();
      if (!worker) throw new Error('WASM Worker failed to initialize');

      const ocrResult = await worker.recognize(screenshotDataUrl, {}, {
        text: true,
        blocks: true
      });

      let rawWords = [];
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

      const extractedWords = rawWords.map((word) => {
        const x0 = word.bbox ? word.bbox.x0 : (word.x0 || 0);
        const y0 = word.bbox ? word.bbox.y0 : (word.y0 || 0);
        const x1 = word.bbox ? word.bbox.x1 : (word.x1 || 0);
        const y1 = word.bbox ? word.bbox.y1 : (word.y1 || 0);
        return {
          text: word.text ? word.text.trim() : '',
          confidence: typeof word.confidence === 'number' ? word.confidence : 90,
          bbox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
        };
      }).filter((w) => w.text.length > 0);

      const piiDetection = PIIDetector.detectPII(extractedWords, { confidenceThreshold: 80.0 });

      const img = new Image();
      img.onload = async () => {
        const width = img.naturalWidth;
        const height = img.naturalHeight;

        if (origCanvas && origWrapper) {
          origCanvas.width = width;
          origCanvas.height = height;
          origWrapper.classList.add('has-img');
          const ctx = origCanvas.getContext('2d');
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0);

          ctx.lineWidth = 2.5;
          ctx.strokeStyle = '#00f2fe';
          ctx.fillStyle = 'rgba(0, 242, 254, 0.15)';
          for (const item of extractedWords) {
            const { x, y, width: bw, height: bh } = item.bbox;
            ctx.strokeRect(x, y, bw, bh);
            ctx.fillRect(x, y, bw, bh);
          }
        }

        if (sanCanvas && sanWrapper) {
          sanCanvas.width = width;
          sanCanvas.height = height;
          sanWrapper.classList.add('has-img');
          const sCtx = sanCanvas.getContext('2d');
          sCtx.clearRect(0, 0, width, height);
          sCtx.drawImage(img, 0, 0);

          for (const match of piiDetection.matches) {
            const { x, y, width: bw, height: bh } = match.bbox;
            const pad = 5;
            const rx = Math.max(0, x - pad);
            const ry = Math.max(0, y - pad);
            const rw = bw + pad * 2;
            const rh = bh + pad * 2;

            sCtx.fillStyle = '#05070d';
            sCtx.fillRect(rx, ry, rw, rh);

            sCtx.strokeStyle = match.isLowConfidence ? '#f43f5e' : '#00f2fe';
            sCtx.lineWidth = 2;
            sCtx.strokeRect(rx, ry, rw, rh);

            const labelText = `[REDACTED ${match.type}]`;
            const fontSize = Math.max(10, Math.min(13, Math.round(rh * 0.52)));
            sCtx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;
            sCtx.textAlign = 'center';
            sCtx.textBaseline = 'middle';
            sCtx.fillStyle = '#ffffff';
            sCtx.fillText(labelText, rx + rw / 2, ry + rh / 2);
          }
        }

        if (wordCount) wordCount.textContent = `${extractedWords.length} words`;
        if (redactCount) redactCount.textContent = `${piiDetection.matches.length} Redacted`;
        if (showcaseCount) showcaseCount.textContent = `${piiDetection.matches.length} SENSITIVE REGION${piiDetection.matches.length === 1 ? '' : 'S'} PROTECTED`;
        if (drawerBtnText) drawerBtnText.textContent = `Collapse Showcase (${piiDetection.matches.length} PII) ▲`;

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

        if (piiDetection.isBlocked) {
          setStatus('BLOCKED — Review Required', 'blocked');
          if (sendBtn) sendBtn.disabled = true;
        } else {
          setStatus('READY — Safe to proceed', 'ready');
          if (sendBtn) sendBtn.disabled = false;
        }

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

        isDrawerOpen = true;
        if (drawer) drawer.classList.add('open');
        resizeHostIframe(true);

        const sanitizedText = PIIDetector.generateSanitizedText(extractedWords, piiDetection.matches);
        currentScanData = {
          sanitized_ocr_text: sanitizedText,
          extracted_words: extractedWords,
          pii_matches: piiDetection.matches,
          status: piiDetection.status,
          is_blocked: piiDetection.isBlocked
        };
      };

      img.src = screenshotDataUrl;

    } catch (err) {
      console.error('[Parallax] Deep Scan Error:', err);
      setStatus(`Error: ${err.message}`, 'error');
    } finally {
      isScanning = false;
      if (scanBtn) scanBtn.disabled = false;
    }
  }

  // Live Radar Toggle
  function startLiveRadar() {
    isLiveRadarActive = true;
    if (liveRadarBtn) liveRadarBtn.classList.add('active');
    if (liveRadarText) liveRadarText.textContent = 'Live Radar: ON';
    setStatus('Live 60FPS Radar Active', 'ready');
    window.parent.postMessage({ type: 'PARALLAX_ENABLE_LIVE_RADAR' }, '*');
  }

  function stopLiveRadar() {
    isLiveRadarActive = false;
    if (liveRadarBtn) liveRadarBtn.classList.remove('active');
    if (liveRadarText) liveRadarText.textContent = 'Live Radar: OFF';
    setStatus('Idle', 'idle');
    window.parent.postMessage({ type: 'PARALLAX_DISABLE_LIVE_RADAR' }, '*');
  }

  function toggleLiveRadar() {
    if (isLiveRadarActive) {
      stopLiveRadar();
    } else {
      startLiveRadar();
    }
  }

  if (liveRadarBtn) liveRadarBtn.addEventListener('click', toggleLiveRadar);
  if (scanBtn) scanBtn.addEventListener('click', executeDeepVisionScan);

  // Handle Send to Backend
  if (sendBtn) {
    sendBtn.addEventListener('click', async () => {
      if (!currentScanData || currentScanData.is_blocked) {
        console.warn('[Parallax] BLOCKED: Low-confidence detection prevented network transmission.');
        return;
      }

      const selectedTask = taskSelect ? taskSelect.value : 'fill_field';
      const sanitizedImageDataUrl = sanCanvas ? sanCanvas.toDataURL('image/png') : '';

      setStatus('Sending to Agent...', 'processing');
      sendBtn.disabled = true;

      try {
        const response = await fetch('http://localhost:3001/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sanitized_ocr_text: currentScanData.sanitized_ocr_text,
            sanitized_image: sanitizedImageDataUrl,
            task: selectedTask
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
          if (data.action_type === 'fill_field') {
            proposedText.innerHTML = `
              <strong>Target Selector:</strong> <code>${data.selector}</code><br>
              <strong>Proposed Value:</strong> <span style="color: #00f2fe; font-weight: 800; font-size: 13px;">"${data.value}"</span><br>
              <span style="font-size: 11px; color: #94a3b8; margin-top: 4px; display: inline-block;">🛡️ Privacy Verified: Zero raw PII data was sent over network.</span>
            `;
          } else {
            proposedText.innerHTML = `
              <strong>AI Summary:</strong><br>
              <p style="margin-top: 6px; color: #f1f5f9; line-height: 1.4;">${data.content || 'Summary complete.'}</p>
            `;
          }
        }

        if (approvalCard) approvalCard.classList.add('open');
        setStatus('Awaiting Approval', 'processing');

        isDrawerOpen = true;
        if (drawer) drawer.classList.add('open');
        resizeHostIframe(true);

      } catch (err) {
        console.error('[Parallax] Backend Error:', err);
        setStatus(`Backend Error: ${err.message}`, 'error');
        sendBtn.disabled = false;
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

      if (currentProposedAction.action_type === 'fill_field') {
        window.parent.postMessage({
          type: 'PARALLAX_EXECUTE_FILL',
          selector: currentProposedAction.selector || '#city',
          value: currentProposedAction.value || 'Bengaluru'
        }, '*');

        if (actionFeedback) {
          actionFeedback.textContent = `✓ Approved! Auto-filled "${currentProposedAction.selector}" with "${currentProposedAction.value}" on webpage.`;
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
        ctx.fillText('Turn on "Live Radar" or click "Scan Page" first', 400, 240);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '13px sans-serif';
        ctx.fillText('Real-time privacy preview will display here in full screen', 400, 270);
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
      fsMetaText.textContent = `${wordCount ? wordCount.textContent : '0 elements'} detected • Cyan Bounding Boxes`;
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
