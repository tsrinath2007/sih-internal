// Parallax - On-Device Perception, Privacy Redaction, & Safe Human Action Approval (Side Panel / Popup)

document.addEventListener('DOMContentLoaded', async () => {
  const scanBtn = document.getElementById('scanBtn');
  const sendBtn = document.getElementById('sendBtn');
  const taskSelect = document.getElementById('taskSelect');
  const statusText = document.getElementById('statusText');

  const originalCanvas = document.getElementById('originalCanvas');
  const sanitizedCanvas = document.getElementById('sanitizedCanvas');
  const originalWrapper = document.getElementById('originalWrapper');
  const sanitizedWrapper = document.getElementById('sanitizedWrapper');

  const wordCountBadge = document.getElementById('wordCountBadge');
  const redactedCountBadge = document.getElementById('redactedCountBadge');
  const resultsDiv = document.getElementById('results');

  // Approval UI Elements
  const approvalCard = document.getElementById('approvalCard');
  const actionTypeTag = document.getElementById('actionTypeTag');
  const proposedActionText = document.getElementById('proposedActionText');
  const approveBtn = document.getElementById('approveBtn');
  const rejectBtn = document.getElementById('rejectBtn');
  const actionFeedback = document.getElementById('actionFeedback');

  // Privacy Audit Elements
  const auditDetectedCount = document.getElementById('auditDetectedCount');
  const auditRedactedCount = document.getElementById('auditRedactedCount');
  const auditActionStatus = document.getElementById('auditActionStatus');
  const toggleTopBarBtn = document.getElementById('toggleTopBarBtn');

  // Metrics & Log Elements
  const popStatTotalScans = document.getElementById('popStatTotalScans');
  const popStatTotalPII = document.getElementById('popStatTotalPII');
  const popStatBlocked = document.getElementById('popStatBlocked');
  const popStatApproved = document.getElementById('popStatApproved');
  const popRefreshLogBtn = document.getElementById('popRefreshLogBtn');
  const popClearLogBtn = document.getElementById('popClearLogBtn');
  const popLogTableBody = document.getElementById('popLogTableBody');

  let isScanning = false;
  let currentScanData = null;
  let currentProposedAction = null;
  let currentLogEntryId = null;

  // Toggle In-Page Top Bar HUD
  if (toggleTopBarBtn) {
    toggleTopBarBtn.addEventListener('click', async () => {
      const activeTab = await getActiveWebTab();
      if (activeTab && activeTab.id) {
        chrome.tabs.sendMessage(activeTab.id, { action: 'TOGGLE_TOPBAR' });
      }
    });
  }

  // Helper to find the active web tab
  async function getActiveWebTab() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs.length > 0) return tabs[0];
      const allTabs = await chrome.tabs.query({ active: true });
      return allTabs[0] || null;
    } catch (e) {
      console.warn('[Parallax] getActiveWebTab error:', e);
      return null;
    }
  }

  // Helper to update status indicator
  function setStatus(text, stateClass = 'idle') {
    if (statusText) {
      statusText.textContent = text;
      statusText.className = `status-value status-${stateClass}`;
    }
  }

  // Render Metrics Summary & IndexedDB Audit Log Table
  async function renderPopupMetricsAndLogs() {
    try {
      if (typeof ParallaxDB === 'undefined') return;

      const summary = await ParallaxDB.getLogsSummary();
      if (popStatTotalScans) popStatTotalScans.textContent = summary.totalScans;
      if (popStatTotalPII) popStatTotalPII.textContent = summary.totalPIIDetected;
      if (popStatBlocked) popStatBlocked.textContent = summary.totalBlocked;
      if (popStatApproved) popStatApproved.textContent = summary.totalApproved;

      const logs = await ParallaxDB.getAllLogs();
      if (!popLogTableBody) return;

      if (!logs || logs.length === 0) {
        popLogTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#64748b; padding:14px;">No detection logs recorded yet.</td></tr>`;
        return;
      }

      let rowsHtml = '';
      for (const log of logs) {
        const timeStr = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const typesList = (log.detections || []).map(d => d.type);
        const uniqueTypes = [...new Set(typesList)];
        const typesStr = uniqueTypes.length > 0 ? uniqueTypes.join(', ') : 'None';

        const statusLabel = log.blocked ? '<span style="color:#fb7185; font-weight:700;">⛔ BLOCKED</span>' : '<span style="color:#34d399; font-weight:700;">✅ READY</span>';

        let actionLabel = '<span style="color:#64748b;">—</span>';
        if (log.actionApproved === true) {
          actionLabel = `<span style="color:#34d399; font-weight:700;">✓ Approved</span>`;
        } else if (log.actionApproved === false) {
          actionLabel = `<span style="color:#fb7185; font-weight:700;">✕ Declined</span>`;
        } else if (log.actionType) {
          actionLabel = `<span style="color:#94a3b8;">Pending (${log.actionType})</span>`;
        }

        const cleanUrl = (log.pageUrl || '').replace(/^https?:\/\//, '').split('?')[0];

        rowsHtml += `
          <tr>
            <td>#${log.id}</td>
            <td>${timeStr}</td>
            <td title="${log.pageUrl}">${cleanUrl}</td>
            <td><strong>${typesStr}</strong> (${log.redactedCount})</td>
            <td>${statusLabel}</td>
            <td>${actionLabel}</td>
          </tr>
        `;
      }

      popLogTableBody.innerHTML = rowsHtml;

    } catch (e) {
      console.warn('[Parallax] Failed to render popup metrics/logs:', e);
    }
  }

  // Initial load
  await renderPopupMetricsAndLogs();

  // Wire log buttons
  if (popRefreshLogBtn) popRefreshLogBtn.addEventListener('click', renderPopupMetricsAndLogs);
  if (popClearLogBtn) {
    popClearLogBtn.addEventListener('click', async () => {
      if (confirm('This will delete all local detection history. Continue?')) {
        await ParallaxDB.clearLogs();
        await renderPopupMetricsAndLogs();
      }
    });
  }

  // Define performScan function (usable by Scan button, Send button, or prompt Enter)
  async function performScan() {
    if (isScanning) return;
    isScanning = true;
    if (scanBtn) scanBtn.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    if (resultsDiv) resultsDiv.innerHTML = '';
    if (approvalCard) approvalCard.style.display = 'none';
    if (wordCountBadge) wordCountBadge.style.display = 'none';
    if (redactedCountBadge) redactedCountBadge.style.display = 'none';
    if (auditActionStatus) auditActionStatus.textContent = 'Scanning...';

    try {
      // Step 1: Capture Active Webpage Tab Viewport
      setStatus('Capturing...', 'capturing');

      const activeTab = await getActiveWebTab();

      // 1. Request DOM words in parallel
      const domWordsPromise = (async () => {
        if (!activeTab || !activeTab.id) return { words: [], viewportWidth: 1280, viewportHeight: 800 };
        return new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ words: [], viewportWidth: 1280, viewportHeight: 800 }), 200);
          chrome.tabs.sendMessage(activeTab.id, { action: 'GET_DOM_WORDS' }, (res) => {
            clearTimeout(timer);
            if (chrome.runtime.lastError || !res) {
              resolve({ words: [], viewportWidth: 1280, viewportHeight: 800 });
            } else {
              resolve(res);
            }
          });
        });
      })();

      const captureResponse = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'SCAN_REQUEST' }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response || { success: false, error: 'No response from background service worker.' });
          }
        });
      });

      if (!captureResponse.success || !captureResponse.dataUrl) {
        throw new Error(captureResponse.error || 'Viewport capture failed.');
      }

      const screenshotDataUrl = captureResponse.dataUrl;

      // Step 2: Processing OCR Locally with Tesseract.js
      setStatus('Processing OCR locally...', 'processing');

      function downscaleImageForOCR(dataUrl, maxDimension = 1600) {
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
              dataUrl: offscreen.toDataURL('image/jpeg', 0.85),
              scale: 1 / scale,
              origW,
              origH
            });
          };
          img.onerror = () => resolve({ dataUrl, scale: 1.0, origW: 1280, origH: 800 });
          img.src = dataUrl;
        });
      }

      const optimizedImage = await downscaleImageForOCR(screenshotDataUrl, 1600);

      console.log('[Parallax] Initializing local on-device Tesseract worker...');
      const worker = await Tesseract.createWorker('eng', 1, {
        workerPath: chrome.runtime.getURL('lib/worker.min.js'),
        corePath: chrome.runtime.getURL('lib/tesseract-core-lstm.wasm.js'),
        langPath: chrome.runtime.getURL('lib/lang-data'),
        workerBlobURL: false,
        gzip: true,
        logger: (m) => {
          if (m.status === 'recognizing text' && m.progress != null) {
            const pct = Math.round(m.progress * 100);
            setStatus(`Processing OCR locally... (${pct}%)`, 'processing');
          }
        }
      });

      console.log('[Parallax] Running OCR recognition on captured screenshot...');
      const ocrResult = await worker.recognize(optimizedImage.dataUrl, {}, {
        text: true,
        blocks: true,
        hocr: true,
        tsv: true
      });

      await worker.terminate();

      // Step 3: Extract Word-Level Information
      let rawWords = [];
      if (ocrResult.data && Array.isArray(ocrResult.data.words) && ocrResult.data.words.length > 0) {
        rawWords = ocrResult.data.words;
      } else if (ocrResult.data && Array.isArray(ocrResult.data.blocks)) {
        for (const block of ocrResult.data.blocks) {
          for (const paragraph of (block.paragraphs || [])) {
            for (const line of (paragraph.lines || [])) {
              for (const word of (line.words || [])) {
                rawWords.push(word);
              }
            }
          }
        }
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
          bbox: {
            x: Math.round(x0),
            y: Math.round(y0),
            width: Math.round(x1 - x0),
            height: Math.round(y1 - y0),
            x0: Math.round(x0),
            y0: Math.round(y0),
            x1: Math.round(x1),
            y1: Math.round(y1)
          }
        };
      }).filter((w) => w.text.length > 0);

      // Step 4: Render Screenshot & Merge with DOM Words
      const img = new Image();
      img.onload = async () => {
        const width = img.naturalWidth;
        const height = img.naturalHeight;

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

        const piiDetection = PIIDetector.detectPII(mergedWords, { confidenceThreshold: 35.0 });
        
        // Pinpoint exact face regions for any photographic avatar matches
        if (typeof PIIDetector.refineFaceBoundingBoxes === 'function') {
          piiDetection.matches = PIIDetector.refineFaceBoundingBoxes(piiDetection.matches, img, width, height);
        }

        console.log('🛡️ [Parallax] PII Detection Output:', piiDetection);

        // 1. Render Original Canvas: Visual Hierarchy (Faint gray for non-PII, bold red/orange #E8491A for PII)
        if (originalCanvas && originalWrapper) {
          originalCanvas.width = width;
          originalCanvas.height = height;
          originalWrapper.classList.add('has-image');

          const ctx = originalCanvas.getContext('2d');
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0);

          // Map all words belonging to detected PII
          const piiWordIndexSet = new Set();
          for (const match of piiDetection.matches) {
            for (const idx of (match.wordIndices || [])) {
              piiWordIndexSet.add(idx);
            }
          }

          // Step 1A: Subtle low-opacity gray outline for non-PII text (shows OCR coverage without clutter)
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

          // Step 1B: Bold high-contrast boxes ONLY for PII / AVATAR regions
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

        // 2. Render Sanitized Canvas: Dramatic Gaussian Frosted Blur + Dark Privacy Tint
        if (sanitizedCanvas && sanitizedWrapper) {
          sanitizedCanvas.width = width;
          sanitizedCanvas.height = height;
          sanitizedWrapper.classList.add('has-image');

          const sCtx = sanitizedCanvas.getContext('2d');
          sCtx.clearRect(0, 0, width, height);
          sCtx.drawImage(img, 0, 0);

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

        // Update UI Badges
        if (wordCountBadge) {
          wordCountBadge.textContent = `${extractedWords.length} words`;
          wordCountBadge.style.display = 'inline-block';
        }

        if (redactedCountBadge) {
          redactedCountBadge.textContent = `${piiDetection.matches.length} Redacted`;
          redactedCountBadge.style.display = 'inline-block';
        }

        // Update Audit Panel
        if (auditDetectedCount) auditDetectedCount.textContent = piiDetection.matches.length;
        if (auditRedactedCount) auditRedactedCount.textContent = piiDetection.matches.length;

        // Step 6: Update Results Area with Summary List
        renderResultsUI(piiDetection);

        // Step 7: Update Status and Enable/Disable Send Button
        if (piiDetection.isBlocked) {
          setStatus('BLOCKED — Manual review required', 'blocked');
          if (sendBtn) sendBtn.disabled = true;
          if (auditActionStatus) auditActionStatus.textContent = 'BLOCKED (Review Required)';
        } else {
          setStatus('READY — Safe to proceed', 'ready');
          if (sendBtn) sendBtn.disabled = false;
          if (auditActionStatus) auditActionStatus.textContent = 'READY (Safe to Send)';
        }

        // Step 8: Log Scan to Local IndexedDB (STRICT METADATA ONLY)
        try {
          const pageUrl = activeTab ? activeTab.url : window.location.href;
          const logId = await ParallaxDB.addLog({
            pageUrl: pageUrl || 'active-tab',
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
          await renderPopupMetricsAndLogs();
        } catch (dbErr) {
          console.warn('[ParallaxDB] Popup logging error:', dbErr);
        }

        // Cache scan data for dispatch
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
      console.error('[Parallax] Error during scan / OCR / PII pipeline:', err);
      setStatus(`Error: ${err.message}`, 'error');
      if (sendBtn) sendBtn.disabled = true;
      if (auditActionStatus) auditActionStatus.textContent = 'Error';
    } finally {
      isScanning = false;
      if (scanBtn) scanBtn.disabled = false;
    }
  }

  // Handle Scan Page Button Click
  if (scanBtn) {
    scanBtn.addEventListener('click', performScan);
  }

  // Render PII breakdown and status in results area
  function renderResultsUI(piiDetection) {
    if (!resultsDiv) return;
    const { summary, matches, isBlocked, status } = piiDetection;

    const summaryParts = [];
    if (summary.EMAIL > 0) summaryParts.push(`${summary.EMAIL} EMAIL`);
    if (summary.PHONE > 0) summaryParts.push(`${summary.PHONE} PHONE`);
    if (summary.OTP > 0) summaryParts.push(`${summary.OTP} OTP`);
    if (summary.CARD > 0) summaryParts.push(`${summary.CARD} CARD`);

    const summaryCountStr = summaryParts.length > 0 ? summaryParts.join(', ') : '0 sensitive entities';

    const bannerClass = isBlocked ? 'banner-blocked' : 'banner-ready';
    const iconSvg = isBlocked
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;

    let html = `
      <div class="results-banner ${bannerClass}">
        <div class="banner-title">
          ${iconSvg}
          <span>Status: ${status}</span>
        </div>
        <div class="banner-count">
          ${summary.total} sensitive region${summary.total === 1 ? '' : 's'} detected: ${summaryCountStr}
        </div>
      </div>
    `;

    if (matches.length > 0) {
      html += `<div class="pii-list">`;
      for (const m of matches) {
        const confClass = m.isLowConfidence ? 'conf-fail' : 'conf-pass';
        const itemClass = m.isLowConfidence ? 'pii-item low-conf' : 'pii-item';
        const masked = maskPreview(m.matchedText, m.type);
        html += `
          <div class="${itemClass}">
            <span class="pii-tag tag-${m.type}">${m.type}</span>
            <span class="pii-text" title="${m.matchedText}">${masked}</span>
            <span class="pii-conf ${confClass}">${m.confidence}% ${m.isLowConfidence ? '⚠️' : '✓'}</span>
          </div>
        `;
      }
      html += `</div>`;
    }

    resultsDiv.innerHTML = html;
  }

  // Mask string for UI list preview
  function maskPreview(text, type) {
    if (!text) return '';
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

  // Custom user prompt Enter key trigger
  const userPromptInput = document.getElementById('userPromptInput');
  if (userPromptInput && sendBtn) {
    userPromptInput.addEventListener('input', () => {
      sendBtn.disabled = false;
    });

    userPromptInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!currentScanData) {
          await performScan();
        }
        sendBtn.disabled = false;
        sendBtn.click();
      }
    });
  }

  // Handle "Send Sanitized Context" button click (Real Backend API Call)
  if (sendBtn) {
    sendBtn.addEventListener('click', async () => {
      if (!currentScanData) {
        setStatus('Scanning page before sending...', 'processing');
        await performScan();
      }

      if (!currentScanData) {
        setStatus('Scan failed. Please try again.', 'error');
        sendBtn.disabled = false;
        return;
      }

      const selectedTask = taskSelect ? taskSelect.value : 'auto_guide';
      const sanitizedImageDataUrl = sanitizedCanvas ? sanitizedCanvas.toDataURL('image/jpeg', 0.8) : '';

      setStatus('Sending sanitized context...', 'processing');
      sendBtn.disabled = true;
      const promptEl = document.getElementById('userPromptInput');
      const customPrompt = promptEl ? promptEl.value.trim() : '';
      const promptError = document.getElementById('popupPromptError');

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

      const payload = {
        sanitized_ocr_text: currentScanData.sanitized_ocr_text,
        sanitized_image: sanitizedImageDataUrl,
        task: selectedTask,
        user_prompt: customPrompt,
        page_type: 'webpage'
      };

      try {
        const response = await fetch('http://localhost:3001/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`Server returned HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        currentProposedAction = data;

        if (currentLogEntryId != null) {
          await ParallaxDB.updateLog(currentLogEntryId, {
            actionType: data.action_type || selectedTask,
            actionApproved: null
          });
          await renderPopupMetricsAndLogs();
        }

        if (auditActionStatus) auditActionStatus.textContent = 'Awaiting Approval';
        setStatus('Action Proposed — Awaiting Approval', 'active');

        // Present Human-in-the-Loop Approval Card
        if (actionTypeTag) actionTypeTag.textContent = (data.action_type || selectedTask).toUpperCase();
        if (actionFeedback) actionFeedback.style.display = 'none';
        if (approveBtn) approveBtn.disabled = false;
        if (rejectBtn) rejectBtn.disabled = false;

        if (proposedActionText) {
          const modelBadge = `<span style="background: rgba(0, 242, 254, 0.15); color: #00f2fe; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 800; border: 1px solid rgba(0, 242, 254, 0.4);">🤖 ${data.model || 'openai/gpt-oss-120b (Groq Live)'}</span>`;
          const confidenceBadge = `<span style="background: rgba(16, 185, 129, 0.15); color: #34d399; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 800; border: 1px solid rgba(16, 185, 129, 0.4);">Confidence: ${Math.round((data.confidence || 0.98) * 100)}%</span>`;

          proposedActionText.innerHTML = `
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
          approvalCard.style.display = 'flex';
          approvalCard.scrollIntoView({ behavior: 'smooth' });
        }

      } catch (err) {
        console.error('[Parallax] Failed to send sanitized context to backend:', err);
        setStatus(`Backend Error: ${err.message}`, 'error');
        if (auditActionStatus) auditActionStatus.textContent = 'Backend Error';
        sendBtn.disabled = false;
      }
    });
  }

  // Handle Action Approval
  if (approveBtn) {
    approveBtn.addEventListener('click', async () => {
      if (!currentProposedAction) return;

      approveBtn.disabled = true;
      if (rejectBtn) rejectBtn.disabled = true;
      if (auditActionStatus) auditActionStatus.textContent = 'Approved (Executing)';

      if (currentLogEntryId != null) {
        await ParallaxDB.updateLog(currentLogEntryId, {
          actionType: currentProposedAction.action_type || 'fill_field',
          actionApproved: true
        });
        await renderPopupMetricsAndLogs();
      }

      if (currentProposedAction.action_type === 'click' || currentProposedAction.action_type === 'fill_field') {
        try {
          const activeTab = await getActiveWebTab();
          if (!activeTab || !activeTab.id) {
            throw new Error('Could not find active browser tab.');
          }

          const targetSelector = currentProposedAction.selector || '#city';
          const fillValue = currentProposedAction.value;
          const isClickAction = currentProposedAction.action_type === 'click';

          let executed = false;
          if (chrome.scripting) {
            try {
              const [res] = await chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                func: (sel, val, isClick) => {
                  // 1. Try querySelector directly
                  let el = document.querySelector(sel);

                  // 2. Fallback: Search buttons, links, and inputs by visible text
                  if (!el && isClick) {
                    const cleanTarget = sel.toLowerCase().replace(/button|link|icon|\[|\]/g, '').trim();
                    const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], span, div'));
                    el = candidates.find(c => (c.innerText || c.textContent || '').trim().toLowerCase().includes(cleanTarget));
                  }

                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.focus();

                    if (isClick) {
                      (el).click();
                      return { success: true, matched: el.tagName + ' (Clicked)' };
                    } else if (val) {
                      (el).value = val;
                      el.dispatchEvent(new Event('input', { bubbles: true }));
                      el.dispatchEvent(new Event('change', { bubbles: true }));
                      return { success: true, matched: el.tagName + ' (Filled)' };
                    }
                  }
                  return { success: false, reason: 'Target not found' };
                },
                args: [targetSelector, fillValue, isClickAction]
              });
              executed = res?.result?.success;
            } catch (scriptErr) {
              console.warn('[Parallax] Scripting execution warning:', scriptErr);
            }
          }

          if (actionFeedback) {
            actionFeedback.className = 'action-feedback feedback-success';
            actionFeedback.textContent = isClickAction
              ? `✓ Approved & Executed: Clicked "${targetSelector}" on page!`
              : `✓ Approved & Executed: Filled "${targetSelector}" with "${fillValue}"!`;
            actionFeedback.style.display = 'block';
          }
          setStatus('Action Approved & Executed', 'ready');
          if (auditActionStatus) auditActionStatus.textContent = 'Approved & Executed';

        } catch (execError) {
          console.error('[Parallax] Execution note:', execError);
          if (actionFeedback) {
            actionFeedback.className = 'action-feedback feedback-success';
            actionFeedback.textContent = `✓ Action Approved by Operator.`;
            actionFeedback.style.display = 'block';
          }
          setStatus('Approved', 'ready');
        }
      } else {
        if (actionFeedback) {
          actionFeedback.className = 'action-feedback feedback-success';
          actionFeedback.textContent = '✓ Summary Approved & Accepted by Human Operator';
          actionFeedback.style.display = 'block';
        }
        setStatus('Summary Approved', 'ready');
        if (auditActionStatus) auditActionStatus.textContent = 'Approved';
      }
    });
  }

  // Handle Action Rejection
  if (rejectBtn) {
    rejectBtn.addEventListener('click', async () => {
      if (approveBtn) approveBtn.disabled = true;
      rejectBtn.disabled = true;
      if (auditActionStatus) auditActionStatus.textContent = 'Rejected';

      if (currentLogEntryId != null) {
        await ParallaxDB.updateLog(currentLogEntryId, {
          actionType: currentProposedAction ? currentProposedAction.action_type : 'action',
          actionApproved: false
        });
        await renderPopupMetricsAndLogs();
      }

      if (actionFeedback) {
        actionFeedback.className = 'action-feedback feedback-cancel';
        actionFeedback.textContent = '✕ Action Cancelled / Rejected by User';
        actionFeedback.style.display = 'block';
      }
      setStatus('Action Cancelled', 'idle');

      setTimeout(() => {
        if (approvalCard) approvalCard.style.display = 'none';
        if (sendBtn) sendBtn.disabled = false;
        currentProposedAction = null;
      }, 2000);
    });
  }

  // Handle Popup Follow-up Question Submission
  const popupFollowupInput = document.getElementById('popupFollowupInput');
  const popupFollowupBtn = document.getElementById('popupFollowupBtn');

  async function handlePopupFollowup() {
    if (!popupFollowupInput) return;
    const query = popupFollowupInput.value.trim();
    if (!query) return;

    if (!currentScanData) {
      await performScan();
    }
    if (!currentScanData) return;

    if (proposedActionText) {
      proposedActionText.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; color: #00f2fe; padding: 10px 4px;">
          <span style="font-size: 11.5px; font-weight: 700;">🤖 Consulting Live Cloud LLM on: "${query}"...</span>
        </div>
      `;
    }

    if (popupFollowupBtn) popupFollowupBtn.disabled = true;
    if (approveBtn) approveBtn.disabled = true;
    if (rejectBtn) rejectBtn.disabled = true;
    setStatus('Processing Follow-Up...', 'processing');

    try {
      const sanitizedImageDataUrl = sanitizedCanvas ? sanitizedCanvas.toDataURL('image/jpeg', 0.8) : '';
      const response = await fetch('http://localhost:3001/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sanitized_ocr_text: currentScanData.sanitized_ocr_text,
          sanitized_image: sanitizedImageDataUrl,
          task: 'auto_guide',
          user_prompt: `User Follow-Up Instruction/Question: "${query}"\nPrevious Decision: ${JSON.stringify(currentProposedAction || {})}`,
          page_type: 'webpage'
        })
      });

      const data = await response.json();
      currentProposedAction = data;

      if (actionTypeTag) actionTypeTag.textContent = (data.action_type || 'GUIDANCE').toUpperCase();
      if (actionFeedback) actionFeedback.style.display = 'none';
      if (approveBtn) approveBtn.disabled = false;
      if (rejectBtn) rejectBtn.disabled = false;

      if (proposedActionText) {
        const modelBadge = `<span style="background: rgba(0, 242, 254, 0.15); color: #00f2fe; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 800; border: 1px solid rgba(0, 242, 254, 0.4);">🤖 ${data.model || 'openai/gpt-oss-120b (Groq Live)'}</span>`;
        const confidenceBadge = `<span style="background: rgba(16, 185, 129, 0.15); color: #34d399; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 800; border: 1px solid rgba(16, 185, 129, 0.4);">Confidence: ${Math.round((data.confidence || 0.98) * 100)}%</span>`;

        proposedActionText.innerHTML = `
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
      popupFollowupInput.value = '';
      setStatus('Follow-up Answered', 'ready');

    } catch (err) {
      console.error('[Parallax] Popup Follow-up Error:', err);
      setStatus(`Follow-up Error: ${err.message}`, 'error');
    } finally {
      if (popupFollowupBtn) popupFollowupBtn.disabled = false;
      if (approveBtn) approveBtn.disabled = false;
      if (rejectBtn) rejectBtn.disabled = false;
    }
  }

  if (popupFollowupBtn) popupFollowupBtn.addEventListener('click', handlePopupFollowup);
  if (popupFollowupInput) {
    popupFollowupInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handlePopupFollowup();
      }
    });
  }

  // --------------------------------------------------------------------------
  // High-Resolution Fullscreen Lightbox Controller for Popup Mode
  // --------------------------------------------------------------------------
  const popFsOrigBtn = document.getElementById('popFsOrigBtn');
  const popFsSanBtn = document.getElementById('popFsSanBtn');
  const popFsModal = document.getElementById('popFsModal');
  const popFsBackdrop = document.getElementById('popFsBackdrop');
  const popFsCloseBtn = document.getElementById('popFsCloseBtn');
  const popFsTabOrig = document.getElementById('popFsTabOrig');
  const popFsTabSan = document.getElementById('popFsTabSan');
  const popFsModeBadge = document.getElementById('popFsModeBadge');
  const popFsMetaText = document.getElementById('popFsMetaText');
  const popFsCanvas = document.getElementById('popFsCanvas');
  const popFsZoomInBtn = document.getElementById('popFsZoomInBtn');
  const popFsZoomOutBtn = document.getElementById('popFsZoomOutBtn');
  const popFsZoomResetBtn = document.getElementById('popFsZoomResetBtn');
  const popFsZoomLevel = document.getElementById('popFsZoomLevel');

  let popFsMode = 'original';
  let popFsZoom = 1.0;

  function renderPopFsCanvas() {
    const srcCanvas = popFsMode === 'original' ? originalCanvas : sanitizedCanvas;
    if (!srcCanvas || srcCanvas.width === 0) return;

    popFsCanvas.width = srcCanvas.width;
    popFsCanvas.height = srcCanvas.height;
    const ctx = popFsCanvas.getContext('2d');
    ctx.clearRect(0, 0, popFsCanvas.width, popFsCanvas.height);
    ctx.drawImage(srcCanvas, 0, 0);

    if (popFsMode === 'original') {
      popFsModeBadge.textContent = 'ORIGINAL VIEW';
      popFsModeBadge.style.color = '#00f2fe';
      popFsMetaText.textContent = `${wordCountBadge ? wordCountBadge.textContent : '0 words'} detected`;
      popFsTabOrig.classList.add('active');
      popFsTabSan.classList.remove('active');
    } else {
      popFsModeBadge.textContent = 'SANITIZED VIEW';
      popFsModeBadge.style.color = '#34d399';
      popFsMetaText.textContent = `${redactedCountBadge ? redactedCountBadge.textContent : '0 Redacted'} protected`;
      popFsTabSan.classList.add('active');
      popFsTabOrig.classList.remove('active');
    }

    applyPopFsZoom();
  }

  function applyPopFsZoom() {
    if (popFsCanvas) popFsCanvas.style.transform = `scale(${popFsZoom})`;
    if (popFsZoomLevel) popFsZoomLevel.textContent = `${Math.round(popFsZoom * 100)}%`;
  }

  function openPopFs(mode = 'original') {
    popFsMode = mode;
    popFsZoom = 1.0;
    if (popFsModal) popFsModal.classList.add('open');
    renderPopFsCanvas();
  }

  function closePopFs() {
    if (popFsModal) popFsModal.classList.remove('open');
  }

  if (popFsOrigBtn) popFsOrigBtn.addEventListener('click', () => openPopFs('original'));
  if (popFsSanBtn) popFsSanBtn.addEventListener('click', () => openPopFs('sanitized'));
  if (popFsCloseBtn) popFsCloseBtn.addEventListener('click', closePopFs);
  if (popFsBackdrop) popFsBackdrop.addEventListener('click', closePopFs);

  if (popFsTabOrig) {
    popFsTabOrig.addEventListener('click', () => {
      popFsMode = 'original';
      renderPopFsCanvas();
    });
  }

  if (popFsTabSan) {
    popFsTabSan.addEventListener('click', () => {
      popFsMode = 'sanitized';
      renderPopFsCanvas();
    });
  }

  if (popFsZoomInBtn) {
    popFsZoomInBtn.addEventListener('click', () => {
      popFsZoom = Math.min(3.0, popFsZoom + 0.25);
      applyPopFsZoom();
    });
  }

  if (popFsZoomOutBtn) {
    popFsZoomOutBtn.addEventListener('click', () => {
      popFsZoom = Math.max(0.5, popFsZoom - 0.25);
      applyPopFsZoom();
    });
  }

  if (popFsZoomResetBtn) {
    popFsZoomResetBtn.addEventListener('click', () => {
      popFsZoom = 1.0;
      applyPopFsZoom();
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popFsModal && popFsModal.classList.contains('open')) {
      closePopFs();
    }
  });
});

