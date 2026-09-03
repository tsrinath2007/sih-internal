/**
 * ActionValidator - Step 7: Local, code-enforced gating — no LLM in this execution path.
 */

import { localMappingStore } from '../storage/local-mapping-store';

export type AllowedActionType = 'click' | 'scroll' | 'type_placeholder' | 'navigate' | 'wait' | 'stop';

export interface GrokGuidanceOutput {
  screen_type: string;
  goal_state: string;
  visible_key_elements: string[];
  hidden_sensitive_regions: string[];
  next_action: AllowedActionType;
  action_target: string;
  confidence: number;
  ask_user_confirmation: boolean;
  risk_flags: string[];
  rationale: string;
}

export interface ValidationResult {
  isValid: boolean;
  requiresUserConfirmation: boolean;
  rejectionReason?: string;
}

const ALLOWED_ACTIONS: Set<string> = new Set(['click', 'scroll', 'type_placeholder', 'navigate', 'wait', 'stop']);

let lastActionTimestamp = 0;
const MIN_ACTION_INTERVAL_MS = 600; // Rate limit protection

export function validateProposedAction(guidance: GrokGuidanceOutput): ValidationResult {
  const now = Date.now();

  // 1. Rate-limiting check
  if (now - lastActionTimestamp < MIN_ACTION_INTERVAL_MS) {
    return {
      isValid: false,
      requiresUserConfirmation: false,
      rejectionReason: 'Rate limit violation: Actions dispatched too rapidly.'
    };
  }

  // 2. Allowed action set check
  if (!ALLOWED_ACTIONS.has(guidance.next_action)) {
    return {
      isValid: false,
      requiresUserConfirmation: false,
      rejectionReason: `Disallowed action type "${guidance.next_action}". Allowed: ${Array.from(ALLOWED_ACTIONS).join(', ')}`
    };
  }

  // 3. Hidden sensitive region protection check
  if (guidance.hidden_sensitive_regions && Array.isArray(guidance.hidden_sensitive_regions)) {
    for (const hiddenRegion of guidance.hidden_sensitive_regions) {
      if (guidance.action_target && (guidance.action_target.includes(hiddenRegion) || hiddenRegion.includes(guidance.action_target))) {
        return {
          isValid: false,
          requiresUserConfirmation: false,
          rejectionReason: `Security policy rejection: Action targets masked sensitive region "${hiddenRegion}".`
        };
      }
    }
  }

  // Check local mapping store for sensitive region target directly
  if (localMappingStore.isSensitiveRegion(guidance.action_target)) {
    if (guidance.next_action !== 'type_placeholder') {
      return {
        isValid: false,
        requiresUserConfirmation: false,
        rejectionReason: `Security policy rejection: Cannot perform direct "${guidance.next_action}" on sensitive region "${guidance.action_target}".`
      };
    }
  }

  // 4. Determine if explicit user confirmation is required
  let requiresUserConfirmation = false;
  if (guidance.ask_user_confirmation === true) {
    requiresUserConfirmation = true;
  }
  if (guidance.risk_flags && guidance.risk_flags.length > 0) {
    requiresUserConfirmation = true;
  }
  if (guidance.next_action === 'type_placeholder') {
    requiresUserConfirmation = true;
  }
  if (guidance.next_action === 'navigate') {
    requiresUserConfirmation = true;
  }

  lastActionTimestamp = now;

  return {
    isValid: true,
    requiresUserConfirmation
  };
}
