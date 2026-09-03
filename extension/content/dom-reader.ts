/**
 * DOMReader - Extracts visible text nodes, input attributes, ARIA roles, and bounding boxes.
 */

export interface DOMElementSnapshot {
  id: string;
  tag: string;
  type?: string;
  name?: string;
  autocomplete?: string;
  placeholder?: string;
  ariaRole?: string;
  ariaLabel?: string;
  text: string;
  value?: string;
  bbox: { x: number; y: number; width: number; height: number };
  selector: string;
  isInteractive: boolean;
}

export interface DOMSnapshot {
  url: string;
  title: string;
  elements: DOMElementSnapshot[];
  timestamp: number;
}

export function readVisibleDOM(): DOMSnapshot {
  const elements: DOMElementSnapshot[] = [];

  function getUniqueSelector(el: Element): string {
    if (el.id) return `#${el.id}`;
    if (el.getAttribute('name')) return `${el.tagName.toLowerCase()}[name="${el.getAttribute('name')}"]`;
    const className = el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
    return `${el.tagName.toLowerCase()}${className}`;
  }

  // 1. Traverse interactive elements & inputs
  const interactiveNodes = document.querySelectorAll('input, textarea, select, button, a, [role], form');
  interactiveNodes.forEach((node, idx) => {
    if (!(node instanceof HTMLElement)) return;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    elements.push({
      id: node.id || `interactive-${idx}`,
      tag: node.tagName.toLowerCase(),
      type: (node as HTMLInputElement).type || undefined,
      name: (node as HTMLInputElement).name || undefined,
      autocomplete: node.getAttribute('autocomplete') || undefined,
      placeholder: (node as HTMLInputElement).placeholder || undefined,
      ariaRole: node.getAttribute('role') || undefined,
      ariaLabel: node.getAttribute('aria-label') || undefined,
      text: (node.innerText || (node as HTMLInputElement).value || '').trim(),
      value: (node as HTMLInputElement).value || undefined,
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

  // 2. Traverse visible text nodes
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'NOSCRIPT') {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let textNode: Node | null;
  let textIdx = 0;
  const range = document.createRange();
  while ((textNode = walker.nextNode())) {
    const text = (textNode.nodeValue || '').trim();
    if (!text) continue;

    try {
      range.selectNodeContents(textNode);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight) {
        elements.push({
          id: `text-${textIdx++}`,
          tag: textNode.parentElement?.tagName.toLowerCase() || 'text',
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
    } catch (e) {}
  }

  console.log('📸 [DOMReader] Extracted snapshot:', {
    url: window.location.href,
    title: document.title,
    totalElements: elements.length,
    interactiveElements: elements.filter(e => e.isInteractive).length,
    elements
  });

  return {
    url: window.location.href,
    title: document.title,
    elements,
    timestamp: Date.now()
  };
}

// Runtime message listener for service worker invocation
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'READ_DOM_SNAPSHOT') {
      const snapshot = readVisibleDOM();
      sendResponse({ success: true, snapshot });
      return true;
    }
  });
}

