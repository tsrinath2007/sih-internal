// extension/storage/local-mapping-store.ts
var LocalMappingStore = class _LocalMappingStore {
  static instance;
  mappings = /* @__PURE__ */ new Map();
  surrogateToOriginal = /* @__PURE__ */ new Map();
  constructor() {
  }
  static getInstance() {
    if (!_LocalMappingStore.instance) {
      _LocalMappingStore.instance = new _LocalMappingStore();
    }
    return _LocalMappingStore.instance;
  }
  setMapping(mapping) {
    this.mappings.set(mapping.id, mapping);
    this.surrogateToOriginal.set(mapping.surrogateValue, mapping.originalValue);
  }
  getMapping(id) {
    return this.mappings.get(id);
  }
  getAllMappings() {
    return Array.from(this.mappings.values());
  }
  restoreOriginalValue(surrogateOrText) {
    let result = surrogateOrText;
    for (const [surrogate, original] of this.surrogateToOriginal.entries()) {
      if (result.includes(surrogate)) {
        result = result.replaceAll(surrogate, original);
      }
    }
    return result;
  }
  getOriginalForSurrogate(surrogate) {
    return this.surrogateToOriginal.get(surrogate);
  }
  isSensitiveRegion(targetIdentifier) {
    for (const m of this.mappings.values()) {
      if (m.id === targetIdentifier || m.selector === targetIdentifier || m.surrogateValue === targetIdentifier) {
        return true;
      }
    }
    return false;
  }
  clear() {
    this.mappings.clear();
    this.surrogateToOriginal.clear();
  }
};
var localMappingStore = LocalMappingStore.getInstance();

// extension/content/redactor.ts
async function redactScreenshotAndMap(rawScreenshotUrl, detectedEntities) {
  const appliedMappings = [];
  for (const entity of detectedEntities) {
    const mapping = {
      id: entity.id,
      originalValue: entity.originalValue,
      surrogateValue: entity.surrogateValue,
      type: entity.type,
      selector: entity.selector,
      bbox: entity.bbox,
      timestamp: Date.now()
    };
    localMappingStore.setMapping(mapping);
    appliedMappings.push(mapping);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve({ sanitizedScreenshot: rawScreenshotUrl, appliedMappings });
        return;
      }
      ctx.drawImage(img, 0, 0);
      for (const entity of detectedEntities) {
        const { x, y, width, height } = entity.bbox;
        const pad = 4;
        const rx = Math.max(0, x - pad);
        const ry = Math.max(0, y - pad);
        const rw = width + pad * 2;
        const rh = height + pad * 2;
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.fillStyle = "#f8fafc";
        const fontSize = Math.max(10, Math.min(13, Math.round(rh * 0.55)));
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`[${entity.type}: ${entity.surrogateValue}]`, rx + rw / 2, ry + rh / 2);
      }
      resolve({
        sanitizedScreenshot: canvas.toDataURL("image/png"),
        appliedMappings
      });
    };
    img.src = rawScreenshotUrl;
  });
}
export {
  redactScreenshotAndMap
};
//# sourceMappingURL=redactor.js.map
