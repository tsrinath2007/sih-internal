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

// extension/content/action-executor.ts
function executeDOMActionLocally(payload) {
  try {
    if (payload.action === "stop" || payload.action === "wait") {
      return { success: true, executedAction: payload.action, message: "Agent paused/stopped." };
    }
    if (payload.action === "scroll") {
      window.scrollBy({ top: 400, behavior: "smooth" });
      return { success: true, executedAction: "scroll" };
    }
    if (payload.action === "navigate" && payload.value) {
      window.location.href = payload.value;
      return { success: true, executedAction: "navigate" };
    }
    const element = document.querySelector(payload.target);
    if (!element) {
      return { success: false, executedAction: payload.action, message: `Element not found: ${payload.target}` };
    }
    if (payload.action === "click") {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.click();
      return { success: true, executedAction: "click" };
    }
    if (payload.action === "type_placeholder") {
      const inputEl = element;
      let textToType = payload.value || "";
      const realValue = localMappingStore.restoreOriginalValue(textToType);
      if (realValue !== textToType) {
        console.log(`\u{1F6E1}\uFE0F [ActionExecutor] Substituted surrogate placeholder with real value locally.`);
        textToType = realValue;
      }
      inputEl.focus();
      inputEl.value = textToType;
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      inputEl.dispatchEvent(new Event("change", { bubbles: true }));
      return { success: true, executedAction: "type_placeholder" };
    }
    return { success: false, executedAction: payload.action, message: `Unhandled action: ${payload.action}` };
  } catch (err) {
    return { success: false, executedAction: payload.action, message: err.message };
  }
}
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "EXECUTE_DOM_ACTION" && message.payload) {
      const result = executeDOMActionLocally(message.payload);
      sendResponse(result);
      return true;
    }
  });
}
export {
  executeDOMActionLocally
};
//# sourceMappingURL=action-executor.js.map
