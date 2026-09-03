/**
 * ActionExecutor - Step 8: Safely executes validated actions locally and substitutes real values.
 */

import { localMappingStore } from '../storage/local-mapping-store';
import { AllowedActionType } from '../policy/action-validator';

export interface ActionPayload {
  action: AllowedActionType;
  target: string;
  value?: string;
}

export interface ExecutionResult {
  success: boolean;
  executedAction: AllowedActionType;
  message?: string;
}

export function executeDOMActionLocally(payload: ActionPayload): ExecutionResult {
  try {
    if (payload.action === 'stop' || payload.action === 'wait') {
      return { success: true, executedAction: payload.action, message: 'Agent paused/stopped.' };
    }

    if (payload.action === 'scroll') {
      window.scrollBy({ top: 400, behavior: 'smooth' });
      return { success: true, executedAction: 'scroll' };
    }

    if (payload.action === 'navigate' && payload.value) {
      window.location.href = payload.value;
      return { success: true, executedAction: 'navigate' };
    }

    // Locate DOM element
    const element = document.querySelector(payload.target);
    if (!element) {
      return { success: false, executedAction: payload.action, message: `Element not found: ${payload.target}` };
    }

    if (payload.action === 'click') {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (element as HTMLElement).click();
      return { success: true, executedAction: 'click' };
    }

    if (payload.action === 'type_placeholder') {
      const inputEl = element as HTMLInputElement;
      let textToType = payload.value || '';

      // RESTORE REAL VALUE FROM LOCAL MAPPING STORE
      const realValue = localMappingStore.restoreOriginalValue(textToType);
      if (realValue !== textToType) {
        console.log(`🛡️ [ActionExecutor] Substituted surrogate placeholder with real value locally.`);
        textToType = realValue;
      }

      inputEl.focus();
      inputEl.value = textToType;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));

      return { success: true, executedAction: 'type_placeholder' };
    }

    return { success: false, executedAction: payload.action, message: `Unhandled action: ${payload.action}` };
  } catch (err: any) {
    return { success: false, executedAction: payload.action, message: err.message };
  }
}

// Runtime message listener for service worker invocation
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'EXECUTE_DOM_ACTION' && message.payload) {
      const result = executeDOMActionLocally(message.payload);
      sendResponse(result);
      return true;
    }
  });
}

