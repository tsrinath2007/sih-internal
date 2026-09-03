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

// extension/policy/action-validator.ts
var ALLOWED_ACTIONS = /* @__PURE__ */ new Set(["click", "scroll", "type_placeholder", "navigate", "wait", "stop"]);
var lastActionTimestamp = 0;
var MIN_ACTION_INTERVAL_MS = 600;
function validateProposedAction(guidance) {
  const now = Date.now();
  if (now - lastActionTimestamp < MIN_ACTION_INTERVAL_MS) {
    return {
      isValid: false,
      requiresUserConfirmation: false,
      rejectionReason: "Rate limit violation: Actions dispatched too rapidly."
    };
  }
  if (!ALLOWED_ACTIONS.has(guidance.next_action)) {
    return {
      isValid: false,
      requiresUserConfirmation: false,
      rejectionReason: `Disallowed action type "${guidance.next_action}". Allowed: ${Array.from(ALLOWED_ACTIONS).join(", ")}`
    };
  }
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
  if (localMappingStore.isSensitiveRegion(guidance.action_target)) {
    if (guidance.next_action !== "type_placeholder") {
      return {
        isValid: false,
        requiresUserConfirmation: false,
        rejectionReason: `Security policy rejection: Cannot perform direct "${guidance.next_action}" on sensitive region "${guidance.action_target}".`
      };
    }
  }
  let requiresUserConfirmation = false;
  if (guidance.ask_user_confirmation === true) {
    requiresUserConfirmation = true;
  }
  if (guidance.risk_flags && guidance.risk_flags.length > 0) {
    requiresUserConfirmation = true;
  }
  if (guidance.next_action === "type_placeholder") {
    requiresUserConfirmation = true;
  }
  if (guidance.next_action === "navigate") {
    requiresUserConfirmation = true;
  }
  lastActionTimestamp = now;
  return {
    isValid: true,
    requiresUserConfirmation
  };
}
export {
  validateProposedAction
};
//# sourceMappingURL=action-validator.js.map
