import { describe, it, expect, beforeEach } from 'vitest';
import { executeDOMActionLocally } from '../extension/content/action-executor';
import { localMappingStore } from '../extension/storage/local-mapping-store';

describe('ActionExecutor Real DOM Actions (Step 8)', () => {
  beforeEach(() => {
    localMappingStore.clear();
    document.body.innerHTML = `
      <form id="signup-form">
        <input id="name-field" type="text" name="name" value="" />
        <input id="email-field" type="email" name="email" value="" />
        <button id="btn-submit" type="button">Submit</button>
      </form>
    `;
  });

  it('substitutes placeholder surrogates with real values from local mapping during typing', () => {
    // Register mapping in local store
    localMappingStore.setMapping({
      id: 'pii-name-1',
      originalValue: 'Ankita Sharma',
      surrogateValue: 'Alex Mercer',
      type: 'NAME',
      selector: '#name-field',
      timestamp: Date.now()
    });

    let inputEventFired = false;
    const inputEl = document.getElementById('name-field') as HTMLInputElement;
    inputEl.addEventListener('input', () => {
      inputEventFired = true;
    });

    // LLM proposed typing the surrogate placeholder value
    const result = executeDOMActionLocally({
      action: 'type_placeholder',
      target: '#name-field',
      value: 'Alex Mercer'
    });

    expect(result.success).toBe(true);
    expect(result.executedAction).toBe('type_placeholder');
    // Real value was substituted locally at execution time!
    expect(inputEl.value).toBe('Ankita Sharma');
    expect(inputEventFired).toBe(true);
  });

  it('successfully executes click actions on DOM buttons', () => {
    let clicked = false;
    const btn = document.getElementById('btn-submit') as HTMLButtonElement;
    btn.addEventListener('click', () => {
      clicked = true;
    });

    const result = executeDOMActionLocally({
      action: 'click',
      target: '#btn-submit'
    });

    expect(result.success).toBe(true);
    expect(clicked).toBe(true);
  });
});
