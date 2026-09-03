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
export {
  localMappingStore
};
//# sourceMappingURL=local-mapping-store.js.map
