import { describe, it, expect, beforeEach } from 'vitest';
import { validateProposedAction, GrokGuidanceOutput } from '../extension/policy/action-validator';
import { localMappingStore } from '../extension/storage/local-mapping-store';

describe('ActionValidator Policy Tests (Step 7)', () => {
  beforeEach(() => {
    localMappingStore.clear();
  });

  it('rejects any action targeting a region flagged as hidden_sensitive_regions', () => {
    const maliciousGuidance: GrokGuidanceOutput = {
      screen_type: 'Checkout Form',
      goal_state: 'Exfiltrate sensitive card',
      visible_key_elements: ['#btn-next'],
      hidden_sensitive_regions: ['#field-credit-card', '[CARD: **** **** **** 1234]'],
      next_action: 'click',
      action_target: '#field-credit-card',
      confidence: 0.99,
      ask_user_confirmation: false,
      risk_flags: [],
      rationale: 'Testing click on masked card field'
    };

    const validation = validateProposedAction(maliciousGuidance);

    expect(validation.isValid).toBe(false);
    expect(validation.rejectionReason).toContain('Security policy rejection');
  });

  it('rejects actions outside the allowed action set', () => {
    const invalidActionGuidance: any = {
      screen_type: 'Login Page',
      goal_state: 'Execute arbitrary script',
      visible_key_elements: [],
      hidden_sensitive_regions: [],
      next_action: 'eval_script', // NOT ALLOWED
      action_target: 'window.location',
      confidence: 0.90,
      ask_user_confirmation: false,
      risk_flags: [],
      rationale: 'Malicious payload'
    };

    const validation = validateProposedAction(invalidActionGuidance);

    expect(validation.isValid).toBe(false);
    expect(validation.rejectionReason).toContain('Disallowed action type');
  });

  it('requires explicit user confirmation when ask_user_confirmation is true or risk_flags exist', async () => {
    // Small delay to satisfy rate-limiting in test runner
    await new Promise(r => setTimeout(r, 650));

    const highRiskGuidance: GrokGuidanceOutput = {
      screen_type: 'Bank Transfer Confirmation',
      goal_state: 'Transfer funds',
      visible_key_elements: ['#btn-transfer'],
      hidden_sensitive_regions: [],
      next_action: 'click',
      action_target: '#btn-transfer',
      confidence: 0.92,
      ask_user_confirmation: true,
      risk_flags: ['financial_transaction', 'irreversible_action'],
      rationale: 'Final payment authorization'
    };

    const validation = validateProposedAction(highRiskGuidance);

    expect(validation.isValid).toBe(true);
    expect(validation.requiresUserConfirmation).toBe(true);
  });

  it('accepts safe valid actions within rate limit', async () => {
    await new Promise(r => setTimeout(r, 650));

    const safeGuidance: GrokGuidanceOutput = {
      screen_type: 'Multi-Step Form',
      goal_state: 'Proceed to next step',
      visible_key_elements: ['#btn-next-step'],
      hidden_sensitive_regions: [],
      next_action: 'click',
      action_target: '#btn-next-step',
      confidence: 0.98,
      ask_user_confirmation: false,
      risk_flags: [],
      rationale: 'Advancing multi-step wizard'
    };

    const validation = validateProposedAction(safeGuidance);

    expect(validation.isValid).toBe(true);
    expect(validation.requiresUserConfirmation).toBe(false);
  });
});
