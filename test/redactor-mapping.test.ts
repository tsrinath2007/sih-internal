import { describe, it, expect, beforeEach } from 'vitest';
import { localMappingStore } from '../extension/storage/local-mapping-store';
import { DetectedPIIEntity } from '../extension/content/pii-detector-dom';

describe('Redactor & LocalMappingStore Round-Trip Tests', () => {
  beforeEach(() => {
    localMappingStore.clear();
  });

  it('stores PII mapping locally and performs bidirectional round-trip substitution', () => {
    const rawEntities: DetectedPIIEntity[] = [
      {
        id: 'pii-name-1',
        type: 'NAME',
        originalValue: 'Ankita Sharma',
        surrogateValue: 'Alex Mercer',
        selector: '#field-name',
        bbox: { x: 10, y: 20, width: 100, height: 25 },
        confidence: 0.95
      },
      {
        id: 'pii-email-2',
        type: 'EMAIL',
        originalValue: 'ankita@gmail.com',
        surrogateValue: 'alex.user2@example.com',
        selector: '#field-email',
        bbox: { x: 10, y: 50, width: 150, height: 25 },
        confidence: 0.99
      },
      {
        id: 'pii-card-3',
        type: 'CARD',
        originalValue: '4532 0150 1234 5671',
        surrogateValue: '**** **** **** 1234',
        selector: '#field-card',
        bbox: { x: 10, y: 80, width: 180, height: 25 },
        confidence: 0.98
      }
    ];

    // Populate local mapping store
    for (const entity of rawEntities) {
      localMappingStore.setMapping({
        id: entity.id,
        originalValue: entity.originalValue,
        surrogateValue: entity.surrogateValue,
        type: entity.type,
        selector: entity.selector,
        bbox: entity.bbox,
        timestamp: Date.now()
      });
    }

    expect(localMappingStore.getAllMappings().length).toBe(3);

    // Test reverse lookup
    expect(localMappingStore.getOriginalForSurrogate('Alex Mercer')).toBe('Ankita Sharma');
    expect(localMappingStore.getOriginalForSurrogate('alex.user2@example.com')).toBe('ankita@gmail.com');
    expect(localMappingStore.getOriginalForSurrogate('**** **** **** 1234')).toBe('4532 0150 1234 5671');

    // Test text stream restoration (when Grok tells agent to type placeholder)
    const incomingGuidanceString = 'Type Alex Mercer into #confirm-name and alex.user2@example.com into #confirm-email';
    const restoredExecutionString = localMappingStore.restoreOriginalValue(incomingGuidanceString);

    expect(restoredExecutionString).toBe('Type Ankita Sharma into #confirm-name and ankita@gmail.com into #confirm-email');

    // Verify sensitive region identification
    expect(localMappingStore.isSensitiveRegion('#field-name')).toBe(true);
    expect(localMappingStore.isSensitiveRegion('#field-email')).toBe(true);
    expect(localMappingStore.isSensitiveRegion('#button-submit')).toBe(false);

    // Verify cleanup
    localMappingStore.clear();
    expect(localMappingStore.getAllMappings().length).toBe(0);
  });
});
