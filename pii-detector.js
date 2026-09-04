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
      result = result.filter(w => /[\d+\-]/.test(w.text));
    } else if (type === 'OTP') {
      result = result.filter(w => /^\d+$/.test(w.text.replace(/[^0-9]/g, '')));
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
      for (let winSize = Math.min(6, n); winSize >= 1; winSize--) {
        for (let i = 0; i <= n - winSize; i++) {
          const rawSlice = line.slice(i, i + winSize);
          const originalIndices = rawSlice.map(w => w.originalIdx);

          if (originalIndices.some(idx => usedWordIndices.has(idx))) continue;

          let gapTooBig = false;
          for (let g = 0; g < rawSlice.length - 1; g++) {
            const gap = rawSlice[g + 1].bbox.x - (rawSlice[g].bbox.x + rawSlice[g].bbox.width);
            if (gap > 65) {
              gapTooBig = true;
              break;
            }
          }
          if (gapTooBig && winSize > 1) continue;

          const joinedSpace = rawSlice.map(w => w.text).join(' ');
          const joinedNone = rawSlice.map(w => w.text).join('');
          const cleanText = joinedSpace.trim().replace(/^[\(\[\{<:;,.]+|[\)\]\}>:;,.]+$/g, '');
          const digits = joinedNone.replace(/\D/g, '');

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
          // 2. PHONE (Indian numbers with +91, 10 digits starting with 6-9, or international — strictly numeric phone characters)
          else if (
            !/[a-zA-Z]{2,}/.test(cleanText.replace(/^(tel|phone|ph|mob|mobile):?\s*/i, '')) &&
            (
              /^\+?91[\s\-]?[6-9]\d{9}$/.test(cleanText.replace(/\s+/g, '')) ||
              /^(\+?91[\s\-]?)?[6-9]\d{4}[\s\-]?\d{5}$/.test(cleanText) ||
              /^(\+?91[\s\-]?)?[6-9]\d{2}[\s\-]?\d{3}[\s\-]?\d{4}$/.test(cleanText) ||
              (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2)) && /^[\+\d\s\-\(\)\.]+$/.test(cleanText)) ||
              (digits.length === 10 && /^[6-9]/.test(digits) && /^[\+\d\s\-\(\)\.]+$/.test(cleanText)) ||
              /^\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/.test(cleanText) ||
              /^\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/.test(cleanText)
            )
          ) {
            matchType = 'PHONE';
            matchedText = joinedSpace;
          }
          // 3. PAYMENT CARD (13-19 digits with strict Luhn Check and numeric tokens)
          else if (/^[\d\s\-]{13,23}$/.test(joinedSpace) && digits.length >= 13 && digits.length <= 19 && luhnCheck(digits)) {
            matchType = 'CARD';
            matchedText = joinedSpace;
          }
          // 4. OTP (4-8 digits near trigger keywords or standalone 6-digit OTP, excluding calendar years)
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

    // Explicit Avatar & Face Photo Anonymization
    for (let wIdx = 0; wIdx < indexedWords.length; wIdx++) {
      const w = indexedWords[wIdx];
      if ((w.isAvatar || w.text === '[PHOTO_AVATAR]') && !usedWordIndices.has(w.originalIdx)) {
        usedWordIndices.add(w.originalIdx);
        matches.push({
          type: 'AVATAR',
          bbox: w.bbox,
          confidence: 98.0,
          matchedText: 'User Profile Photo',
          wordIndices: [w.originalIdx],
          isLowConfidence: false
        });
      }
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

  return {
    detectPII,
    generateSanitizedText,
    luhnCheck
  };
}));
