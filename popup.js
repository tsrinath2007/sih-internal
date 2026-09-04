// Parallax - On-Device Privacy & Redaction Shield (Popup & Sidebar)

document.addEventListener('DOMContentLoaded', async () => {
  const scanBtn = document.getElementById('scanBtn');
  const statusText = document.getElementById('statusText');

  const originalCanvas = document.getElementById('originalCanvas');
  const sanitizedCanvas = document.getElementById('sanitizedCanvas');
  const originalWrapper = document.getElementById('originalWrapper');
  const sanitizedWrapper = document.getElementById('sanitizedWrapper');

  const wordCountBadge = document.getElementById('wordCountBadge');
  const redactedCountBadge = document.getElementById('redactedCountBadge');
  const resultsDiv = document.getElementById('results');
  const redactionToolbar = document.getElementById('redactionToolbar');

  // Redaction Export & Action Buttons
  const downloadSanBtn = document.getElementById('downloadSanBtn');

  // Privacy Audit & Header Elements
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

        const statusLabel = log.blocked 
          ? '<span style="color:#fb7185; font-weight:700;">⛔ SENSITIVE</span>' 
          : '<span style="color:#34d399; font-weight:700;">✅ PROTECTED</span>';

        const actionLabel = `<span style="color:#34d399; font-weight:700;">100% On-Device</span>`;
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

  // Initial load of metrics & logs
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

  // Redaction Execution Pipeline
  async function performScan() {
    if (isScanning) return;
    isScanning = true;
    if (scanBtn) scanBtn.disabled = true;
    if (resultsDiv) resultsDiv.innerHTML = '';
    if (wordCountBadge) wordCountBadge.style.display = 'none';
    if (redactedCountBadge) redactedCountBadge.style.display = 'none';
    if (auditActionStatus) auditActionStatus.textContent = 'Scanning...';

    try {
      // Step 1: Capture Active Webpage Tab Viewport
      setStatus('Capturing Viewport...', 'capturing');

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

      // Step 2: Processing OCR Locally with Tesseract.js WASM
      setStatus('Running On-Device OCR & PII Detection...', 'processing');

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

      const optimizedImage = await downscaleImageForOCR(screenshotDataUrl, 1600);

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
          isPassword: w.isPassword,
          isSecret: w.isSecret,
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

        const piiDetection = PIIDetector.detectPII(mergedWords, { confidenceThreshold: 35.0 });

        // Detect any visual face portraits in document/screenshot image (e.g. Aadhaar cards, ID badges)
        if (typeof PIIDetector.detectVisualFaces === 'function') {
          const visualFaces = PIIDetector.detectVisualFaces(img, width, height);
          for (const vf of visualFaces) {
            const alreadyMatched = piiDetection.matches.some(m => {
              if (m.type !== 'AVATAR') return false;
              const dx = Math.abs((m.bbox.x + m.bbox.width / 2) - (vf.bbox.x + vf.bbox.width / 2));
              const dy = Math.abs((m.bbox.y + m.bbox.height / 2) - (vf.bbox.y + vf.bbox.height / 2));
              return dx < 60 && dy < 60;
            });
            if (!alreadyMatched) {
              piiDetection.matches.push(vf);
            }
          }
        }
        
        // Pinpoint exact face regions for any photographic avatar matches
        if (typeof PIIDetector.refineFaceBoundingBoxes === 'function') {
          piiDetection.matches = PIIDetector.refineFaceBoundingBoxes(piiDetection.matches, img, width, height);
        }

        // 1. Render Original Canvas: Visual Hierarchy (Faint gray for non-PII, bold red/orange for PII)
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

        // 2. Render Sanitized Canvas: Dramatic Gaussian Frosted Blur + Dark Privacy Tint + Mosaic Face
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

                // Step 1: Calculate Crisp Mosaic Pixel Block Grid (8-14 blocks across face)
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

        // Update UI Badges
        if (wordCountBadge) {
          wordCountBadge.textContent = `${mergedWords.length} words`;
          wordCountBadge.style.display = 'inline-block';
        }

        if (redactedCountBadge) {
          redactedCountBadge.textContent = `${piiDetection.matches.length} Redacted`;
          redactedCountBadge.style.display = 'inline-block';
        }

        // Update Audit Panel
        if (auditDetectedCount) auditDetectedCount.textContent = piiDetection.matches.length;
        if (auditRedactedCount) auditRedactedCount.textContent = piiDetection.matches.length;

        // Render Results Area
        renderResultsUI(piiDetection);

        // Update Status & Toolbar
        const count = piiDetection.matches.length;
        setStatus(`Redaction Complete • ${count} Sensitive Region${count === 1 ? '' : 's'} Protected`, 'ready');
        if (auditActionStatus) auditActionStatus.textContent = 'Protected (100% Local)';
        if (redactionToolbar) redactionToolbar.style.display = 'flex';

        // Log Scan to Local IndexedDB (STRICT METADATA ONLY)
        try {
          const pageUrl = activeTab ? activeTab.url : window.location.href;
          await ParallaxDB.addLog({
            pageUrl: pageUrl || 'active-tab',
            timestamp: new Date().toISOString(),
            detections: piiDetection.matches.map(m => ({
              type: m.type,
              confidence: m.confidence,
              bbox: m.bbox
            })),
            redactedCount: piiDetection.matches.length,
            blocked: piiDetection.isBlocked,
            actionType: 'ON_DEVICE_REDACT',
            actionApproved: true
          });
          await renderPopupMetricsAndLogs();
        } catch (dbErr) {
          console.warn('[ParallaxDB] Popup logging error:', dbErr);
        }

        // Cache scan data for export actions
        const sanitizedText = PIIDetector.generateSanitizedText(mergedWords, piiDetection.matches);
        currentScanData = {
          sanitized_ocr_text: sanitizedText,
          extracted_words: mergedWords,
          pii_matches: piiDetection.matches,
          status: piiDetection.status,
          is_blocked: piiDetection.isBlocked
        };
      };

      img.src = screenshotDataUrl;

    } catch (err) {
      console.error('[Parallax] Error during scan / OCR / PII pipeline:', err);
      setStatus(`Error: ${err.message}`, 'error');
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

  // Handle Download Sanitized Image
  if (downloadSanBtn) {
    downloadSanBtn.addEventListener('click', () => {
      if (!sanitizedCanvas || sanitizedCanvas.width === 0) {
        setStatus('Scan the page first before downloading', 'warning');
        return;
      }
      const link = document.createElement('a');
      link.download = `parallax-redacted-${Date.now()}.png`;
      link.href = sanitizedCanvas.toDataURL('image/png');
      link.click();
      setStatus('✓ Redacted image downloaded!', 'ready');
    });
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
    if (summary.AVATAR > 0) summaryParts.push(`${summary.AVATAR} FACE/AVATAR`);

    const summaryCountStr = summaryParts.length > 0 ? summaryParts.join(' • ') : '0 sensitive entities';

    let html = `
      <div class="results-banner banner-ready">
        <div class="banner-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          <span>100% On-Device Redaction Applied</span>
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
    if (type === 'AVATAR') return '🔒 Photographic Face Mask';
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
    if (popFsCanvas) {
      popFsCanvas.style.transform = `scale(${popFsZoom})`;
    }
    if (popFsZoomLevel) {
      popFsZoomLevel.textContent = `${Math.round(popFsZoom * 100)}%`;
    }
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

  if (popFsTabOrig) popFsTabOrig.addEventListener('click', () => { popFsMode = 'original'; renderPopFsCanvas(); });
  if (popFsTabSan) popFsTabSan.addEventListener('click', () => { popFsMode = 'sanitized'; renderPopFsCanvas(); });

  if (popFsZoomInBtn) popFsZoomInBtn.addEventListener('click', () => { popFsZoom = Math.min(3.0, popFsZoom + 0.25); applyPopFsZoom(); });
  if (popFsZoomOutBtn) popFsZoomOutBtn.addEventListener('click', () => { popFsZoom = Math.max(0.4, popFsZoom - 0.25); applyPopFsZoom(); });
  if (popFsZoomResetBtn) popFsZoomResetBtn.addEventListener('click', () => { popFsZoom = 1.0; applyPopFsZoom(); });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popFsModal && popFsModal.classList.contains('open')) {
      closePopFs();
    }
  });
});
