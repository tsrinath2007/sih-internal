/**
 * LocalMappingStore - In-Memory Ephemeral Storage for PII Surrogates & Real Values.
 * 
 * STRICT PRIVACY RULE:
 * - This mapping NEVER leaves the local browser context.
 * - Cleared when the active tab closes, agent resets, or execution finishes.
 * - Real values are only restored at local execution time (step 8).
 */

export interface PIIRegionMapping {
  id: string;
  originalValue: string;
  surrogateValue: string;
  type: 'NAME' | 'EMAIL' | 'PHONE' | 'CARD' | 'ADDRESS' | 'ID' | 'CUSTOM';
  selector?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  timestamp: number;
}

class LocalMappingStore {
  private static instance: LocalMappingStore;
  private mappings: Map<string, PIIRegionMapping> = new Map();
  private surrogateToOriginal: Map<string, string> = new Map();

  private constructor() {}

  public static getInstance(): LocalMappingStore {
    if (!LocalMappingStore.instance) {
      LocalMappingStore.instance = new LocalMappingStore();
    }
    return LocalMappingStore.instance;
  }

  public setMapping(mapping: PIIRegionMapping): void {
    this.mappings.set(mapping.id, mapping);
    this.surrogateToOriginal.set(mapping.surrogateValue, mapping.originalValue);
  }

  public getMapping(id: string): PIIRegionMapping | undefined {
    return this.mappings.get(id);
  }

  public getAllMappings(): PIIRegionMapping[] {
    return Array.from(this.mappings.values());
  }

  public restoreOriginalValue(surrogateOrText: string): string {
    let result = surrogateOrText;
    for (const [surrogate, original] of this.surrogateToOriginal.entries()) {
      if (result.includes(surrogate)) {
        result = result.replaceAll(surrogate, original);
      }
    }
    return result;
  }

  public getOriginalForSurrogate(surrogate: string): string | undefined {
    return this.surrogateToOriginal.get(surrogate);
  }

  public isSensitiveRegion(targetIdentifier: string): boolean {
    for (const m of this.mappings.values()) {
      if (m.id === targetIdentifier || m.selector === targetIdentifier || m.surrogateValue === targetIdentifier) {
        return true;
      }
    }
    return false;
  }

  public clear(): void {
    this.mappings.clear();
    this.surrogateToOriginal.clear();
  }
}

export const localMappingStore = LocalMappingStore.getInstance();
