// extension/content/dom-reader.ts
function readVisibleDOM() {
  const elements = [];
  function getUniqueSelector(el) {
    if (el.id) return `#${el.id}`;
    if (el.getAttribute("name")) return `${el.tagName.toLowerCase()}[name="${el.getAttribute("name")}"]`;
    const className = el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
    return `${el.tagName.toLowerCase()}${className}`;
  }
  const interactiveNodes = document.querySelectorAll("input, textarea, select, button, a, [role], form");
  interactiveNodes.forEach((node, idx) => {
    if (!(node instanceof HTMLElement)) return;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    elements.push({
      id: node.id || `interactive-${idx}`,
      tag: node.tagName.toLowerCase(),
      type: node.type || void 0,
      name: node.name || void 0,
      autocomplete: node.getAttribute("autocomplete") || void 0,
      placeholder: node.placeholder || void 0,
      ariaRole: node.getAttribute("role") || void 0,
      ariaLabel: node.getAttribute("aria-label") || void 0,
      text: (node.innerText || node.value || "").trim(),
      value: node.value || void 0,
      bbox: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      selector: getUniqueSelector(node),
      isInteractive: true
    });
  });
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || parent.tagName === "SCRIPT" || parent.tagName === "STYLE" || parent.tagName === "NOSCRIPT") {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let textNode;
  let textIdx = 0;
  const range = document.createRange();
  while (textNode = walker.nextNode()) {
    const text = (textNode.nodeValue || "").trim();
    if (!text) continue;
    try {
      range.selectNodeContents(textNode);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight) {
        elements.push({
          id: `text-${textIdx++}`,
          tag: textNode.parentElement?.tagName.toLowerCase() || "text",
          text,
          bbox: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          selector: getUniqueSelector(textNode.parentElement || document.body),
          isInteractive: false
        });
      }
    } catch (e) {
    }
  }
  console.log("\u{1F4F8} [DOMReader] Extracted snapshot:", {
    url: window.location.href,
    title: document.title,
    totalElements: elements.length,
    interactiveElements: elements.filter((e) => e.isInteractive).length,
    elements
  });
  return {
    url: window.location.href,
    title: document.title,
    elements,
    timestamp: Date.now()
  };
}
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "READ_DOM_SNAPSHOT") {
      const snapshot = readVisibleDOM();
      sendResponse({ success: true, snapshot });
      return true;
    }
  });
}
export {
  readVisibleDOM
};
//# sourceMappingURL=dom-reader.js.map
