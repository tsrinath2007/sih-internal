// extension/content/pii-detector-dom.ts
function luhnCheck(numStr) {
  const digits = numStr.replace(/\D/g, "");
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
  return sum % 10 === 0;
}

// extension/content/pii-detector-visual.ts
async function detectVisualPII(screenshotDataUrl) {
  const visualEntities = [];
  try {
    if (typeof document === "undefined") return visualEntities;
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Image failed to load in visual detector"));
      img.src = screenshotDataUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || 1200;
    canvas.height = img.naturalHeight || 800;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return visualEntities;
    ctx.drawImage(img, 0, 0);
    const canvasElements = document.querySelectorAll('canvas, svg, img[alt*="card"], img[alt*="email"]');
    let counter = 100;
    canvasElements.forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const altOrLabel = (el.getAttribute("alt") || el.getAttribute("aria-label") || "").trim();
      if (!altOrLabel) return;
      if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(altOrLabel)) {
        visualEntities.push({
          id: `pii-visual-email-${counter++}`,
          type: "EMAIL",
          originalValue: altOrLabel,
          surrogateValue: `visual.user${counter}@example.com`,
          bbox: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          confidence: 0.94
        });
      }
      const digits = altOrLabel.replace(/\D/g, "");
      if (digits.length >= 13 && digits.length <= 19 && luhnCheck(digits)) {
        visualEntities.push({
          id: `pii-visual-card-${counter++}`,
          type: "CARD",
          originalValue: altOrLabel,
          surrogateValue: "**** **** **** 1234",
          bbox: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          confidence: 0.96
        });
      }
    });
  } catch (err) {
    console.warn("\u26A0\uFE0F [PIIDetectorVisual] Fallback pass error:", err);
  }
  return visualEntities;
}
export {
  detectVisualPII
};
//# sourceMappingURL=pii-detector-visual.js.map
