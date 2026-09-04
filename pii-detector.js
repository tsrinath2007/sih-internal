/**
 * Parallax PII Detection & Bounding Box Merger Engine
 * Client-Side Privacy Protection: EMAIL, PHONE, CARD, OTP
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PIIDetector = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  /**
   * Luhn algorithm validation for payment card numbers
   */
  function luhnCheck(numStr) {
    const digits = numStr.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) return false;

    let sum = 0;
    let shouldDouble = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let digit = parseInt(digits.charAt(i), 10);
      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      shouldDouble = !shouldDouble;
    }
    return (sum % 10) === 0;
  }

  /**
   * Compute Euclidean distance between two rectangular bounding boxes
   */
  function getBboxDistance(b1, b2) {
    const dx = Math.max(0, Math.max(b1.x - (b2.x + b2.width), b2.x - (b1.x + b1.width)));
    const dy = Math.max(0, Math.max(b1.y - (b2.y + b2.height), b2.y - (b1.y + b1.height)));
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Compute merged bounding box covering an array of bounding boxes
   */
  function computeMergedBbox(bboxes) {
    if (!bboxes || bboxes.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    const minX = Math.min(...bboxes.map(b => b.x));
    const minY = Math.min(...bboxes.map(b => b.y));
    const maxX = Math.max(...bboxes.map(b => b.x + b.width));
    const maxY = Math.max(...bboxes.map(b => b.y + b.height));
    return {
      x: Math.round(minX),
      y: Math.round(minY),
      width: Math.round(maxX - minX),
      height: Math.round(maxY - minY)
    };
  }

  /**
   * Trim non-matching boundary tokens
   */
  function trimSlice(slice, type) {
    let result = [...slice];
    if (type === 'EMAIL') {
      // Find the token that contains '@' or '©'
      const atIdx = result.findIndex(w => /[@©]/.test(w.text));
      if (atIdx !== -1) {
        let start = atIdx;
        // If the token starts with '@', include the preceding token if it's alphanumeric username
        if (start > 0 && /^[@©]/.test(result[atIdx].text) && /^[a-zA-Z0-9._%+-]+$/.test(result[start - 1].text)) {
          start--;
        }
        let end = atIdx;
        // If the token ends with '@' or '.', include the next token if it's domain part
        if (end < result.length - 1 && (/[@©]$/.test(result[end].text) || /\.$/.test(result[end].text)) && /^[a-zA-Z0-9.-]+$/.test(result[end + 1].text)) {
          end++;
        }
        result = result.slice(start, end + 1);
      } else {
        result = result.filter(w => /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i.test(w.text));
      }
    } else if (type === 'CARD') {
      while (result.length > 0 && !/\d/.test(result[0].text)) {
        result.shift();
      }
      while (result.length > 0 && !/\d/.test(result[result.length - 1].text)) {
        result.pop();
      }
      result = result.filter(w => /[\d\-]/.test(w.text));
    } else if (type === 'PHONE') {
      while (result.length > 0 && !/[\d+]/.test(result[0].text)) {
        result.shift();
      }
      while (result.length > 0 && !/\d/.test(result[result.length - 1].text)) {
        result.pop();
      }
      result = result.filter(w => /[\d+\-\(\)\.]/.test(w.text));
    } else if (type === 'OTP' || type === 'ACCOUNT_NUM') {
      result = result.filter(w => /^\d+$/.test(w.text.replace(/[^0-9]/g, '')));
    } else if (type === 'PAN' || type === 'IFSC') {
      result = result.filter(w => /^[a-zA-Z0-9]+$/.test(w.text.replace(/[^a-zA-Z0-9]/g, '')));
    }
    return result;
  }

  /**
   * Main PII detection function (Strictly EMAIL, PHONE, CARD, OTP)
   */
  function detectPII(words, options = {}) {
    const confidenceThreshold = options.confidenceThreshold != null ? options.confidenceThreshold : 35.0;
    const matches = [];
    const usedWordIndices = new Set();

    if (!Array.isArray(words) || words.length === 0) {
      return {
        matches: [],
        isBlocked: false,
        status: 'READY — Safe to proceed',
        summary: { total: 0, EMAIL: 0, PHONE: 0, OTP: 0, CARD: 0, lowConfidenceCount: 0 }
      };
    }

    // Trigger words for OTP proximity detection (explicit OTP/PIN keywords only)
    const otpTriggerKeywords = ['otp', 'one-time', 'passcode', 'verification', 'verify', 'pin', '2fa', 'mfa'];
    const triggerWordBoxes = words
      .map((w, idx) => ({ ...w, originalIdx: idx }))
      .filter(w => {
        const clean = w.text.toLowerCase().replace(/[^a-z0-9]/g, '');
        return otpTriggerKeywords.includes(clean);
      });

    // Group words into lines by Y position
    const indexedWords = words.map((w, idx) => ({
      ...w,
      originalIdx: idx,
      bbox: {
        x: w.bbox.x != null ? w.bbox.x : (w.bbox.x0 || 0),
        y: w.bbox.y != null ? w.bbox.y : (w.bbox.y0 || 0),
        width: w.bbox.width != null ? w.bbox.width : ((w.bbox.x1 || 0) - (w.bbox.x0 || 0)),
        height: w.bbox.height != null ? w.bbox.height : ((w.bbox.y1 || 0) - (w.bbox.y0 || 0))
      }
    }));

    const sortedWords = [...indexedWords].sort((a, b) => {
      const yDiff = a.bbox.y - b.bbox.y;
      if (Math.abs(yDiff) > 12) return yDiff;
      return a.bbox.x - b.bbox.x;
    });

    const lines = [];
    for (const word of sortedWords) {
      let placed = false;
      for (const line of lines) {
        const avgY = line.reduce((sum, w) => sum + w.bbox.y, 0) / line.length;
        const avgH = line.reduce((sum, w) => sum + w.bbox.height, 0) / line.length;
        if (Math.abs(word.bbox.y - avgY) < Math.max(14, avgH * 0.65)) {
          line.push(word);
          placed = true;
          break;
        }
      }
      if (!placed) {
        lines.push([word]);
      }
    }

    for (const line of lines) {
      line.sort((a, b) => a.bbox.x - b.bbox.x);
    }

    // Sliding window pass across words in lines
    for (const line of lines) {
      const n = line.length;
      for (let winSize = Math.min(8, n); winSize >= 1; winSize--) {
        for (let i = 0; i <= n - winSize; i++) {
          const rawSlice = line.slice(i, i + winSize);
          const originalIndices = rawSlice.map(w => w.originalIdx);

          if (originalIndices.some(idx => usedWordIndices.has(idx))) continue;

          let gapTooBig = false;
          for (let g = 0; g < rawSlice.length - 1; g++) {
            const gap = rawSlice[g + 1].bbox.x - (rawSlice[g].bbox.x + rawSlice[g].bbox.width);
            if (gap > 75) {
              gapTooBig = true;
              break;
            }
          }
          if (gapTooBig && winSize > 1) continue;

          const joinedSpace = rawSlice.map(w => w.text).join(' ');
          const joinedNone = rawSlice.map(w => w.text).join('');
          const cleanText = joinedSpace.trim().replace(/^[\(\[\{<:;,.]+|[\)\]\}>:;,.]+$/g, '');
          const cleanNone = joinedNone.trim().replace(/^[\(\[\{<:;,.]+|[\)\]\}>:;,.]+$/g, '');
          const digits = cleanNone.replace(/\D/g, '');

          let matchType = null;
          let matchedText = cleanText;

          // 1. EMAIL (Standard, partial, OCR-split, or embedded in token)
          const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i;
          const emailSpacePattern = /[a-zA-Z0-9._%+-]+[\s]*[@©][\s]*[a-zA-Z0-9.-]+[\s]*\.[\s]*[a-zA-Z]{2,}/i;
          const em1 = cleanText.match(emailPattern);
          const em2 = joinedNone.match(emailPattern);
          const em3 = cleanText.match(emailSpacePattern);

          if (em1 || em2 || em3 || /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+/.test(cleanText)) {
            matchType = 'EMAIL';
            matchedText = (em1 ? em1[0] : (em2 ? em2[0] : (em3 ? em3[0] : cleanText)));
          }
          // 2. INDIAN PAN CARD (5 letters, 4 digits, 1 letter e.g. ABCDE1234F, XYZPQ9876R)
          else if (/^[a-zA-Z]{5}[0-9]{4}[a-zA-Z]$/i.test(cleanNone)) {
            matchType = 'PAN';
            matchedText = cleanNone.toUpperCase();
          }
          // 3. BANK IFSC CODE (4 letters, 0, 6 alphanumeric e.g. HDFC0001234, SBIN0001234)
          else if (/^[a-zA-Z]{4}[0oO][a-zA-Z0-9]{6}$/i.test(cleanNone)) {
            matchType = 'IFSC';
            matchedText = cleanNone.toUpperCase();
          }
          // 4. PAYMENT CARD (13-19 digits: Luhn validated OR standard card format 4-4-4-4 / 4-6-5 with card prefix/keywords)
          else if (
            digits.length >= 13 && digits.length <= 19 &&
            !/^(account|acc|wire|phone|tel)/i.test((line[i - 1]?.text || '')) &&
            (
              luhnCheck(digits) ||
              (/^(\d{4}[\s\-]?){3}\d{1,4}$/.test(cleanText) && /^(4|5[1-5]|2[2-7]|3[47]|6011|65|35)/.test(digits)) ||
              (/^3[47]\d{2}[\s\-]?\d{6}[\s\-]?\d{5}$/.test(cleanText)) ||
              (/^(card|visa|mastercard|amex|debit|credit)/i.test((line[i - 1]?.text || ''))) ||
              (/^(card|visa|mastercard|amex|debit|credit)/i.test((line[i - 2]?.text || '')))
            )
          ) {
            matchType = 'CARD';
            matchedText = joinedSpace;
          }
          // 5. BANK ACCOUNT NUMBERS (9-18 digits preceded by Account, Acc, A/C, Wire, Beneficiary, Settlement keywords)
          else if (
            digits.length >= 9 && digits.length <= 18 &&
            (
              /^(account|acc|a\/c|beneficiary|settlement|wire|acct|iban|routing)/i.test((line[i - 1]?.text || '')) ||
              /^(account|acc|a\/c|beneficiary|settlement|wire|acct|iban|routing)/i.test((line[i - 2]?.text || '')) ||
              /^(account|acc|a\/c|beneficiary|settlement)/i.test(cleanText) ||
              /^ACCOUNT[\s\:\#]+\d{9,18}$/i.test(cleanText)
            )
          ) {
            matchType = 'ACCOUNT_NUM';
            matchedText = joinedSpace;
          }
          // 6. PHONE (Indian, US, European (+33, +44, +49), and all international formats)
          else if (
            !/[a-zA-Z]{2,}/.test(cleanText.replace(/^(tel|phone|ph|mob|mobile|hotline|desk|fax):?\s*/i, '')) &&
            !/^(account|acc|routing|ifsc|pan|otp)/i.test((line[i - 1]?.text || '')) &&
            (
              // International prefix with + (e.g. +33 1 42 68 55 00, +44 20 7946 0919, +1-888-555-0199, +91 98765 43210)
              (/^\+\d{1,4}[\s\-\.]?\(?\d{1,4}\)?([\s\-\.]?\d{1,4}){1,5}$/.test(cleanText) && digits.length >= 7 && digits.length <= 15) ||
              /^\+?91[\s\-]?[6-9]\d{9}$/.test(cleanText.replace(/\s+/g, '')) ||
              /^(\+?91[\s\-]?)?[6-9]\d{4}[\s\-]?\d{5}$/.test(cleanText) ||
              /^(\+?91[\s\-]?)?[6-9]\d{2}[\s\-]?\d{3}[\s\-]?\d{4}$/.test(cleanText) ||
              (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2)) && /^[\+\d\s\-\(\)\.]+$/.test(cleanText)) ||
              (digits.length === 10 && /^[6-9]/.test(digits) && /^[\+\d\s\-\(\)\.]+$/.test(cleanText)) ||
              /^\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/.test(cleanText) ||
              /^\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/.test(cleanText) ||
              /^1[-.\s]?800[-.\s]?\d{3}[-.\s]?\d{4}$/.test(cleanText) ||
              /^\+1[-.\s]?888[-.\s]?\d{3}[-.\s]?\d{4}$/.test(cleanText)
            )
          ) {
            matchType = 'PHONE';
            matchedText = joinedSpace;
          }
          // 7. OTP (4-8 digits near trigger keywords or standalone 6-digit OTP, excluding calendar years)
          else if (/^\d{4,8}$/.test(cleanText)) {
            const numVal = parseInt(digits, 10);
            const isYear = digits.length === 4 && numVal >= 1900 && numVal <= 2099;
            
            // Check context for dates (e.g. Q1-Q4, FY, yr, year, months)
            const prevWord = (i > 0 && line[i - 1]) ? line[i - 1].text.toLowerCase() : '';
            const nextWord = (i + winSize < n && line[i + winSize]) ? line[i + winSize].text.toLowerCase() : '';
            const isDateContext = /^(q[1-4]|fy|v|ver|version|yr|year|since|est|in|on|of|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/i.test(prevWord.replace(/[^a-z0-9]/gi, '')) ||
                                  /^(q[1-4]|fy|yr|year|edition|release)$/i.test(nextWord.replace(/[^a-z0-9]/gi, ''));

            if (!isYear && !isDateContext) {
              const sliceBbox = computeMergedBbox(rawSlice.map((w) => w.bbox));
              const isNearTrigger = triggerWordBoxes.some((tb) => {
                if (rawSlice.some((sw) => sw.originalIdx === tb.originalIdx)) return false;
                const dist = getBboxDistance(sliceBbox, tb.bbox);
                const isSameRow = Math.abs((sliceBbox.y + sliceBbox.height / 2) - (tb.bbox.y + tb.bbox.height / 2)) < 30;
                return dist <= 120 || (isSameRow && dist <= 160);
              });

              if (isNearTrigger || (cleanText.length === 6 && digits.length === 6 && !/^(19|20)\d\d/.test(digits))) {
                matchType = 'OTP';
                matchedText = cleanText;
              }
            }
          }

          if (matchType) {
            const trimmedSlice = trimSlice(rawSlice, matchType);
            if (trimmedSlice.length === 0) continue;

            const finalIndices = trimmedSlice.map(w => w.originalIdx);
            const mergedBbox = computeMergedBbox(trimmedSlice.map(w => w.bbox));
            const avgConfidence = trimmedSlice.reduce((s, w) => s + (w.confidence || 0), 0) / trimmedSlice.length;
            const isLowConfidence = avgConfidence < confidenceThreshold;

            matches.push({
              type: matchType,
              bbox: mergedBbox,
              confidence: Number(avgConfidence.toFixed(1)),
              matchedText: trimmedSlice.map(w => w.text).join(' '),
              wordIndices: finalIndices,
              isLowConfidence: isLowConfidence
            });

            for (const idx of finalIndices) {
              usedWordIndices.add(idx);
            }
          }
        }
      }
    }

    // Explicit Avatar & Face Photo Anonymization with Overlap Merging
    const avatarBoxes = [];
    for (let wIdx = 0; wIdx < indexedWords.length; wIdx++) {
      const w = indexedWords[wIdx];
      if ((w.isAvatar || w.text === '[PHOTO_AVATAR]') && !usedWordIndices.has(w.originalIdx)) {
        usedWordIndices.add(w.originalIdx);
        avatarBoxes.push({
          originalIdx: w.originalIdx,
          bbox: { ...w.bbox }
        });
      }
    }

    // Merge overlapping or nested avatar boxes
    const mergedAvatarGroups = [];
    for (const ab of avatarBoxes) {
      let merged = false;
      for (const group of mergedAvatarGroups) {
        const gBox = group.bbox;
        const b = ab.bbox;
        const xOverlap = Math.max(0, Math.min(gBox.x + gBox.width, b.x + b.width) - Math.max(gBox.x, b.x));
        const yOverlap = Math.max(0, Math.min(gBox.y + gBox.height, b.y + b.height) - Math.max(gBox.y, b.y));
        const overlapArea = xOverlap * yOverlap;
        const minArea = Math.min(gBox.width * gBox.height, b.width * b.height);

        if (overlapArea > 0 || (minArea > 0 && overlapArea / minArea > 0.15) || (Math.abs(gBox.x - b.x) < 40 && Math.abs(gBox.y - b.y) < 40)) {
          const minX = Math.min(gBox.x, b.x);
          const minY = Math.min(gBox.y, b.y);
          const maxX = Math.max(gBox.x + gBox.width, b.x + b.width);
          const maxY = Math.max(gBox.y + gBox.height, b.y + b.height);
          group.bbox = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
          group.indices.push(ab.originalIdx);
          merged = true;
          break;
        }
      }
      if (!merged) {
        mergedAvatarGroups.push({
          bbox: { ...ab.bbox },
          indices: [ab.originalIdx]
        });
      }
    }

    for (const group of mergedAvatarGroups) {
      matches.push({
        type: 'AVATAR',
        bbox: group.bbox,
        confidence: 98.0,
        matchedText: 'User Profile Photo',
        wordIndices: group.indices,
        isLowConfidence: false
      });
    }

    matches.sort((a, b) => {
      const yDiff = a.bbox.y - b.bbox.y;
      if (Math.abs(yDiff) > 12) return yDiff;
      return a.bbox.x - b.bbox.x;
    });

    const summary = {
      total: matches.length,
      EMAIL: matches.filter(m => m.type === 'EMAIL').length,
      PHONE: matches.filter(m => m.type === 'PHONE').length,
      OTP: matches.filter(m => m.type === 'OTP').length,
      CARD: matches.filter(m => m.type === 'CARD').length,
      AVATAR: matches.filter(m => m.type === 'AVATAR').length,
      PAN: matches.filter(m => m.type === 'PAN').length,
      IFSC: matches.filter(m => m.type === 'IFSC').length,
      ACCOUNT_NUM: matches.filter(m => m.type === 'ACCOUNT_NUM').length,
      lowConfidenceCount: matches.filter(m => m.isLowConfidence).length
    };

    const hasLowConfidence = summary.lowConfidenceCount > 0;
    const isBlocked = hasLowConfidence;
    const status = isBlocked
      ? 'BLOCKED — Low Confidence detected'
      : 'READY — Safe to proceed';

    return { matches, isBlocked, status, summary };
  }

  /**
   * Replace all detected PII text tokens with redaction placeholders
   */
  function generateSanitizedText(words, matches) {
    if (!words || words.length === 0) return '';
    if (!matches || matches.length === 0) {
      return words.map(w => w.text).join(' ');
    }

    const wordIndexToMatch = new Map();
    for (const match of matches) {
      const sortedWordIndices = [...match.wordIndices].sort((a, b) => a - b);
      const headIdx = sortedWordIndices[0];
      for (const idx of match.wordIndices) {
        wordIndexToMatch.set(idx, {
          type: match.type,
          isHead: idx === headIdx
        });
      }
    }

    const tokens = [];
    for (let i = 0; i < words.length; i++) {
      if (wordIndexToMatch.has(i)) {
        const info = wordIndexToMatch.get(i);
        if (info.isHead) {
          tokens.push(`[REDACTED ${info.type}]`);
        }
      } else {
        tokens.push(words[i].text);
      }
    }

    return tokens.join(' ');
  }

  /**
   * Refines avatar / photo bounding boxes to pinpoint ONLY the exact human face region
   * For small avatars (<= 110px), keeps the tight icon crop.
   * For larger photos/portraits/ID cards/webcams, uses calibrated YCbCr chrominance + connected
   * component face cluster localization to tightly isolate the face (rejecting wooden desks, clothing, background, and cards).
   */
  function refineFaceBoundingBoxes(matches, img, canvasW, canvasH) {
    if (!matches || !Array.isArray(matches) || !img) return matches;

    for (const match of matches) {
      if (match.type !== 'AVATAR') continue;

      const { x, y, width: bw, height: bh } = match.bbox;
      // If it's already a small circular/square avatar icon (<= 110px), keep the exact badge
      if (bw <= 110 && bh <= 110) continue;

      const px = Math.max(0, x);
      const py = Math.max(0, y);
      const pw = Math.min(canvasW - px, bw);
      const ph = Math.min(canvasH - py, bh);

      if (pw < 40 || ph < 40) continue;

      try {
        const sampleW = Math.min(240, Math.max(80, Math.round(pw / 2)));
        const sampleH = Math.min(240, Math.max(80, Math.round(ph / 2)));
        const off = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
        if (!off) {
          const fw = Math.round(pw * 0.28);
          const fh = Math.round(ph * 0.32);
          match.bbox = { x: Math.round(px + (pw - fw) / 2), y: Math.round(py + ph * 0.10), width: fw, height: fh };
          continue;
        }

        off.width = sampleW;
        off.height = sampleH;
        const oCtx = off.getContext('2d', { willReadFrequently: true });
        oCtx.drawImage(img, px, py, pw, ph, 0, 0, sampleW, sampleH);

        const imgData = oCtx.getImageData(0, 0, sampleW, sampleH);
        const data = imgData.data;
        const skinMap = new Uint8Array(sampleW * sampleH);

        // Step 1: Strict YCbCr + RGB Human Skin Chrominance Classifier
        // Rejects brown/amber wooden desks, blue/dark clothing, and white/gray cards
        for (let sy = 0; sy < sampleH; sy++) {
          for (let sx = 0; sx < sampleW; sx++) {
            const idx = (sy * sampleW + sx) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];

            const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
            const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

            // Universal Human Face Skin Criteria
            const isSkin = (
              cb >= 80 && cb <= 126 &&
              cr >= 133 && cr <= 174 &&
              r > 70 && g > 40 && b > 25 &&
              (r - g) >= 8 && (r - g) <= 75 &&
              (r - b) >= 12
            );

            if (isSkin) {
              skinMap[sy * sampleW + sx] = 1;
            }
          }
        }

        // Step 2: Connected Component Face Clustering
        const visited = new Uint8Array(sampleW * sampleH);
        const clusters = [];

        for (let cy = 0; cy < sampleH; cy++) {
          for (let cx = 0; cx < sampleW; cx++) {
            const idx = cy * sampleW + cx;
            if (skinMap[idx] && !visited[idx]) {
              let count = 0;
              let minX = cx, maxX = cx, minY = cy, maxY = cy;
              const queue = [cx, cy];
              visited[idx] = 1;

              let qHead = 0;
              while (qHead < queue.length) {
                const qx = queue[qHead++];
                const qy = queue[qHead++];
                count++;

                if (qx < minX) minX = qx;
                if (qx > maxX) maxX = qx;
                if (qy < minY) minY = qy;
                if (qy > maxY) maxY = qy;

                // 8-way neighbors with 2px stride bridge
                const neighbors = [
                  [qx + 1, qy], [qx - 1, qy], [qx, qy + 1], [qx, qy - 1],
                  [qx + 2, qy], [qx - 2, qy], [qx, qy + 2], [qx, qy - 2]
                ];
                for (const [nx, ny] of neighbors) {
                  if (nx >= 0 && nx < sampleW && ny >= 0 && ny < sampleH) {
                    const nIdx = ny * sampleW + nx;
                    if (skinMap[nIdx] && !visited[nIdx]) {
                      visited[nIdx] = 1;
                      queue.push(nx, ny);
                    }
                  }
                }
              }

              const cw = maxX - minX + 1;
              const ch = maxY - minY + 1;
              const ratio = ch / Math.max(1, cw);

              // Valid human face clusters have natural proportions (ratio between 0.75 and 1.85)
              if (count >= 25 && ratio >= 0.70 && ratio <= 1.95 && cw >= 12 && ch >= 14) {
                clusters.push({ minX, maxX, minY, maxY, cw, ch, count, ratio });
              }
            }
          }
        }

        const scaleX = pw / sampleW;
        const scaleY = ph / sampleH;

        if (clusters.length > 0) {
          // Sort by skin pixel mass
          clusters.sort((a, b) => b.count - a.count);
          const best = clusters[0];

          // Expand tightly around the face to encompass hairline, forehead, glasses, and chin
          const padX = Math.round(best.cw * 0.12);
          const padYTop = Math.round(best.ch * 0.18); // Forehead / hair
          const padYBottom = Math.round(best.ch * 0.10); // Chin

          const relX = Math.max(0, best.minX - padX);
          const relY = Math.max(0, best.minY - padYTop);
          const relW = Math.min(sampleW - relX, best.cw + padX * 2);
          const relH = Math.min(sampleH - relY, best.ch + padYTop + padYBottom);

          match.bbox = {
            x: Math.round(px + relX * scaleX),
            y: Math.round(py + relY * scaleY),
            width: Math.round(relW * scaleX),
            height: Math.round(relH * scaleY)
          };
        } else {
          // Fallback: tight 28% upper-center portrait face box
          const fw = Math.round(pw * 0.28);
          const fh = Math.round(ph * 0.32);
          const fx = Math.round(px + (pw - fw) / 2);
          const fy = Math.round(py + ph * 0.10);
          match.bbox = { x: fx, y: fy, width: fw, height: fh };
        }
      } catch (err) {
        const fw = Math.round(pw * 0.28);
        const fh = Math.round(ph * 0.32);
        const fx = Math.round(px + (pw - fw) / 2);
        const fy = Math.round(py + ph * 0.10);
        match.bbox = { x: fx, y: fy, width: fw, height: fh };
      }
    }
    return matches;
  }

  return {
    detectPII,
    refineFaceBoundingBoxes,
    generateSanitizedText,
    luhnCheck
  };
}));
