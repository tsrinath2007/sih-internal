/**
 * Redactor - Step 4: Applies semantic replacement to screen & registers local PII mapping.
 */

import { DetectedPIIEntity } from './pii-detector-dom';
import { localMappingStore, PIIRegionMapping } from '../storage/local-mapping-store';

export interface RedactionResult {
  sanitizedScreenshot: string;
  appliedMappings: PIIRegionMapping[];
}

export async function redactScreenshotAndMap(
  rawScreenshotUrl: string,
  detectedEntities: DetectedPIIEntity[]
): Promise<RedactionResult> {
  const appliedMappings: PIIRegionMapping[] = [];

  // Register all detections into local secure in-memory store
  for (const entity of detectedEntities) {
    const mapping: PIIRegionMapping = {
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

  // Draw semantic surrogate overlays on canvas
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ sanitizedScreenshot: rawScreenshotUrl, appliedMappings });
        return;
      }

      // Draw base image
      ctx.drawImage(img, 0, 0);

      // Apply semantic replacements
      for (const entity of detectedEntities) {
        const { x, y, width, height } = entity.bbox;
        const pad = 4;
        const rx = Math.max(0, x - pad);
        const ry = Math.max(0, y - pad);
        const rw = width + pad * 2;
        const rh = height + pad * 2;

        // Draw solid opaque blackout/surrogate background
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(rx, ry, rw, rh);

        // Draw subtle privacy border
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rx, ry, rw, rh);

        // Stamp semantic surrogate placeholder
        ctx.fillStyle = '#f8fafc';
        const fontSize = Math.max(10, Math.min(13, Math.round(rh * 0.55)));
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`[${entity.type}: ${entity.surrogateValue}]`, rx + rw / 2, ry + rh / 2);
      }

      resolve({
        sanitizedScreenshot: canvas.toDataURL('image/png'),
        appliedMappings
      });
    };
    img.src = rawScreenshotUrl;
  });
}
