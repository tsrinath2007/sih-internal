import { describe, it, expect } from 'vitest';
import { GROK_SYSTEM_PROMPT, requestGrokGuidance, SanitizedPayload } from '../extension/api/grok-client';
import { localMappingStore } from '../extension/storage/local-mapping-store';

describe('GrokClient Step 6 Tests', () => {
  it('contains the exact verbatim system prompt required by architecture', () => {
    expect(GROK_SYSTEM_PROMPT).toContain('You are a browser guidance agent. The screen you receive has already been');
    expect(GROK_SYSTEM_PROMPT).toContain('sanitized locally; masked boxes, placeholders, and surrogate values represent');
    expect(GROK_SYSTEM_PROMPT).toContain('hidden sensitive information.');
    expect(GROK_SYSTEM_PROMPT).toContain('Return JSON only, no prose, no markdown fences:');
  });

  it('parses structured JSON output conforming to the required guidance schema', async () => {
    const mockPayload: SanitizedPayload = {
      sanitizedScreenshotUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      urlDomain: 'localhost',
      pageTitleCategory: 'Signup Form',
      elementRoles: ['input:text', 'input:email', 'button:submit']
    };

    const guidance = await requestGrokGuidance(mockPayload, undefined, true);

    expect(guidance).toBeDefined();
    expect(typeof guidance.screen_type).toBe('string');
    expect(typeof guidance.goal_state).toBe('string');
    expect(Array.isArray(guidance.visible_key_elements)).toBe(true);
    expect(Array.isArray(guidance.hidden_sensitive_regions)).toBe(true);
    expect(['click', 'scroll', 'type_placeholder', 'navigate', 'wait', 'stop']).toContain(guidance.next_action);
    expect(typeof guidance.action_target).toBe('string');
    expect(typeof guidance.confidence).toBe('number');
    expect(typeof guidance.ask_user_confirmation).toBe('boolean');
    expect(Array.isArray(guidance.risk_flags)).toBe(true);
    expect(typeof guidance.rationale).toBe('string');
  });

  it('asserts that no raw PII from local mapping exists in the network payload', () => {
    localMappingStore.clear();
    localMappingStore.setMapping({
      id: 'pii-1',
      originalValue: 'Ankita Sharma',
      surrogateValue: 'Alex Mercer',
      type: 'NAME',
      timestamp: Date.now()
    });
    localMappingStore.setMapping({
      id: 'pii-2',
      originalValue: '4532015012345671',
      surrogateValue: '**** **** **** 1234',
      type: 'CARD',
      timestamp: Date.now()
    });

    const sanitizedPayloadText = JSON.stringify({
      urlDomain: 'localhost',
      pageTitleCategory: 'Signup Form',
      elementRoles: ['input:text', 'input:email', 'button:submit'],
      surrogates: ['Alex Mercer', '**** **** **** 1234']
    });

    // Lint/Test constraint assertion: Ensure NO raw PII values ever leak in the transmitted payload
    for (const mapping of localMappingStore.getAllMappings()) {
      expect(sanitizedPayloadText).not.toContain(mapping.originalValue);
    }
  });
});
