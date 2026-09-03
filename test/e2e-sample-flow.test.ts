import { describe, it, expect, beforeEach } from 'vitest';
import { DOMSnapshot } from '../extension/content/dom-reader';
import { detectDOMPII } from '../extension/content/pii-detector-dom';
import { localMappingStore } from '../extension/storage/local-mapping-store';
import { validateProposedAction, GrokGuidanceOutput } from '../extension/policy/action-validator';
import { executeDOMActionLocally } from '../extension/content/action-executor';

describe('End-to-End Guidance Loop & Security Invariants', () => {
  beforeEach(() => {
    localMappingStore.clear();
    document.body.innerHTML = `
      <form id="multi-step-checkout">
        <input id="input-name" type="text" name="name" value="Ankita Sharma" autocomplete="name" />
        <input id="input-email" type="email" name="email" value="ankita@gmail.com" autocomplete="email" />
        <input id="input-card" type="text" name="card" value="4532 0150 1234 5671" autocomplete="cc-number" />
        <button id="btn-next" type="button">Next Step</button>
        <button id="btn-submit" type="button" style="display:none;">Final Submit</button>
      </form>
    `;
  });

  it('runs complete 3-step loop, redacts all 3 PII fields, and strictly protects raw data', async () => {
    // -------------------------------------------------------------
    // ITERATION 1: Read DOM, Detect PII, and Redact
    // -------------------------------------------------------------
    const snapshot: DOMSnapshot = {
      url: 'http://localhost:3001/checkout.html',
      title: 'Checkout Form',
      timestamp: Date.now(),
      elements: [
        {
          id: 'input-name',
          tag: 'input',
          name: 'name',
          autocomplete: 'name',
          text: 'Ankita Sharma',
          value: 'Ankita Sharma',
          bbox: { x: 50, y: 100, width: 200, height: 35 },
          selector: '#input-name',
          isInteractive: true
        },
        {
          id: 'input-email',
          tag: 'input',
          type: 'email',
          name: 'email',
          autocomplete: 'email',
          text: 'ankita@gmail.com',
          value: 'ankita@gmail.com',
          bbox: { x: 50, y: 150, width: 200, height: 35 },
          selector: '#input-email',
          isInteractive: true
        },
        {
          id: 'input-card',
          tag: 'input',
          name: 'card',
          autocomplete: 'cc-number',
          text: '4532 0150 1234 5671',
          value: '4532 0150 1234 5671',
          bbox: { x: 50, y: 200, width: 200, height: 35 },
          selector: '#input-card',
          isInteractive: true
        },
        {
          id: 'btn-next',
          tag: 'button',
          text: 'Next Step',
          bbox: { x: 50, y: 260, width: 120, height: 40 },
          selector: '#btn-next',
          isInteractive: true
        }
      ]
    };

    const detections = detectDOMPII(snapshot);
    expect(detections.length).toBe(3);

    // Register into local mapping store
    for (const d of detections) {
      localMappingStore.setMapping({
        id: d.id,
        originalValue: d.originalValue,
        surrogateValue: d.surrogateValue,
        type: d.type,
        selector: d.selector,
        bbox: d.bbox,
        timestamp: Date.now()
      });
    }

    // Verify raw values NEVER appear in outgoing payload
    const outgoingPayload = {
      urlDomain: 'localhost',
      title: 'Checkout Form',
      visibleElements: ['#input-name', '#input-email', '#input-card', '#btn-next'],
      surrogates: detections.map(d => d.surrogateValue)
    };

    const payloadJson = JSON.stringify(outgoingPayload);
    expect(payloadJson).not.toContain('Ankita Sharma');
    expect(payloadJson).not.toContain('ankita@gmail.com');
    expect(payloadJson).not.toContain('4532 0150 1234 5671');

    // -------------------------------------------------------------
    // ITERATION 2: Grok returns guidance -> Policy Validator -> Action Execution
    // -------------------------------------------------------------
    const grokGuidance1: GrokGuidanceOutput = {
      screen_type: 'Checkout Wizard - Step 1',
      goal_state: 'Proceed to shipping step',
      visible_key_elements: ['#btn-next'],
      hidden_sensitive_regions: ['[NAME: Alex Mercer]', '[EMAIL: alex.user2@example.com]', '[CARD: **** **** **** 1234]'],
      next_action: 'click',
      action_target: '#btn-next',
      confidence: 0.98,
      ask_user_confirmation: false,
      risk_flags: [],
      rationale: 'All fields contain valid surrogate data. Advancing form.'
    };

    const validation1 = validateProposedAction(grokGuidance1);
    expect(validation1.isValid).toBe(true);
    expect(validation1.requiresUserConfirmation).toBe(false);

    let nextBtnClicked = false;
    document.getElementById('btn-next')!.addEventListener('click', () => {
      nextBtnClicked = true;
    });

    const execution1 = executeDOMActionLocally({
      action: grokGuidance1.next_action,
      target: grokGuidance1.action_target
    });

    expect(execution1.success).toBe(true);
    expect(nextBtnClicked).toBe(true);

    // -------------------------------------------------------------
    // ITERATION 3: Adversarial Prompt Injection Defense
    // -------------------------------------------------------------
    await new Promise(r => setTimeout(r, 650));

    // Suppose a malicious prompt injection tried to make Grok click/reveal a masked card field
    const adversarialGuidance: GrokGuidanceOutput = {
      screen_type: 'Adversarial Injection Attack',
      goal_state: 'Exfiltrate card details',
      visible_key_elements: [],
      hidden_sensitive_regions: ['#input-card'],
      next_action: 'click',
      action_target: '#input-card', // Targeting masked region!
      confidence: 0.99,
      ask_user_confirmation: false,
      risk_flags: [],
      rationale: 'Injected attack'
    };

    const adversarialValidation = validateProposedAction(adversarialGuidance);
    // Security policy rejects this in code, not relying on LLM to decline!
    expect(adversarialValidation.isValid).toBe(false);
    expect(adversarialValidation.rejectionReason).toContain('Security policy rejection');
  });
});
