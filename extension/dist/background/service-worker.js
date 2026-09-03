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

// extension/content/pii-detector-dom.ts
function luhnCheck(numStr) {
  const digits = numStr.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}
function detectDOMPII(snapshot) {
  const detections = [];
  let counter = 1;
  for (const el of snapshot.elements) {
    const val = (el.value || el.text || "").trim();
    if (!val || val.length < 2) continue;
    if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(val) || el.autocomplete === "email" || el.type === "email" || /email/i.test(el.name || "") || /email/i.test(el.placeholder || "")) {
      if (val.includes("@") || el.type === "email" || el.autocomplete === "email") {
        detections.push({
          id: `pii-email-${counter++}`,
          type: "EMAIL",
          originalValue: val,
          surrogateValue: `alex.user${counter}@example.com`,
          selector: el.selector,
          bbox: el.bbox,
          confidence: 0.99
        });
        continue;
      }
    }
    const digitsOnly = val.replace(/\D/g, "");
    if (el.autocomplete === "cc-number" || /card|credit|debit|ccnum/i.test(el.name || "") || /card number/i.test(el.placeholder || "") || digitsOnly.length >= 13 && digitsOnly.length <= 19 && luhnCheck(digitsOnly)) {
      if (digitsOnly.length >= 12 || luhnCheck(digitsOnly)) {
        detections.push({
          id: `pii-card-${counter++}`,
          type: "CARD",
          originalValue: val,
          surrogateValue: "**** **** **** 1234",
          selector: el.selector,
          bbox: el.bbox,
          confidence: 0.98
        });
        continue;
      }
    }
    if (el.autocomplete === "tel" || el.type === "tel" || /phone|mobile|tel/i.test(el.name || "") || /^\+?91[\s\-]?[6-9]\d{9}$/.test(val.replace(/\s+/g, "")) || digitsOnly.length === 12 && digitsOnly.startsWith("91") && /^[6-9]/.test(digitsOnly.slice(2)) || digitsOnly.length === 10 && /^[6-9]/.test(digitsOnly) || /^\+?1?[\s\-\.]?\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4}$/.test(val) && digitsOnly.length >= 10) {
      if (digitsOnly.length >= 10) {
        detections.push({
          id: `pii-phone-${counter++}`,
          type: "PHONE",
          originalValue: val,
          surrogateValue: "+1 (555) 019-2834",
          selector: el.selector,
          bbox: el.bbox,
          confidence: 0.95
        });
        continue;
      }
    }
    if (el.autocomplete === "street-address" || el.autocomplete === "address-line1" || /address|street|location/i.test(el.name || "") || /address/i.test(el.placeholder || "")) {
      detections.push({
        id: `pii-address-${counter++}`,
        type: "ADDRESS",
        originalValue: val,
        surrogateValue: "123 Privacy Lane, Suite 400",
        selector: el.selector,
        bbox: el.bbox,
        confidence: 0.92
      });
      continue;
    }
    if (el.autocomplete === "name" || el.autocomplete === "given-name" || el.autocomplete === "family-name" || el.autocomplete === "cc-name" || /^name|full_?name|fname|lname|customer_?name$/i.test(el.name || "") || /^full name|your name|enter name$/i.test(el.placeholder || "")) {
      if (val.length > 2 && !/submit|button|login|signup|reset/i.test(val)) {
        detections.push({
          id: `pii-name-${counter++}`,
          type: "NAME",
          originalValue: val,
          surrogateValue: "Alex Mercer",
          selector: el.selector,
          bbox: el.bbox,
          confidence: 0.9
        });
      }
    }
  }
  return detections;
}

// extension/content/pii-detector-visual.ts
async function detectVisualPII(screenshotDataUrl) {
  const visualEntities = [];
  try {
    if (typeof document === "undefined") return visualEntities;
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Image failed to load in visual detector"));
      img.src = screenshotDataUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || 1200;
    canvas.height = img.naturalHeight || 800;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return visualEntities;
    ctx.drawImage(img, 0, 0);
    const canvasElements = document.querySelectorAll('canvas, svg, img[alt*="card"], img[alt*="email"]');
    let counter = 100;
    canvasElements.forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const altOrLabel = (el.getAttribute("alt") || el.getAttribute("aria-label") || "").trim();
      if (!altOrLabel) return;
      if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(altOrLabel)) {
        visualEntities.push({
          id: `pii-visual-email-${counter++}`,
          type: "EMAIL",
          originalValue: altOrLabel,
          surrogateValue: `visual.user${counter}@example.com`,
          bbox: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          confidence: 0.94
        });
      }
      const digits = altOrLabel.replace(/\D/g, "");
      if (digits.length >= 13 && digits.length <= 19 && luhnCheck(digits)) {
        visualEntities.push({
          id: `pii-visual-card-${counter++}`,
          type: "CARD",
          originalValue: altOrLabel,
          surrogateValue: "**** **** **** 1234",
          bbox: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          confidence: 0.96
        });
      }
    });
  } catch (err) {
    console.warn("\u26A0\uFE0F [PIIDetectorVisual] Fallback pass error:", err);
  }
  return visualEntities;
}

// extension/content/redactor.ts
async function redactScreenshotAndMap(rawScreenshotUrl, detectedEntities) {
  const appliedMappings = [];
  for (const entity of detectedEntities) {
    const mapping = {
      id: entity.id,
      originalValue: entity.originalValue,
      surrogateValue: entity.surrogateValue,
      type: entity.type,
      selector: entity.selector,
      bbox: entity.bbox,
      timestamp: Date.now()
    };
    localMappingStore.setMapping(mapping);
    appliedMappings.push(mapping);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve({ sanitizedScreenshot: rawScreenshotUrl, appliedMappings });
        return;
      }
      ctx.drawImage(img, 0, 0);
      for (const entity of detectedEntities) {
        const { x, y, width, height } = entity.bbox;
        const pad = 4;
        const rx = Math.max(0, x - pad);
        const ry = Math.max(0, y - pad);
        const rw = width + pad * 2;
        const rh = height + pad * 2;
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.fillStyle = "#f8fafc";
        const fontSize = Math.max(10, Math.min(13, Math.round(rh * 0.55)));
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`[${entity.type}: ${entity.surrogateValue}]`, rx + rw / 2, ry + rh / 2);
      }
      resolve({
        sanitizedScreenshot: canvas.toDataURL("image/png"),
        appliedMappings
      });
    };
    img.src = rawScreenshotUrl;
  });
}

// extension/api/grok-client.ts
var GROK_SYSTEM_PROMPT = `You are a browser guidance agent. The screen you receive has already been
sanitized locally; masked boxes, placeholders, and surrogate values represent
hidden sensitive information. Treat them as intentional privacy protections,
never ask to reveal originals, and reason only from the sanitized view.

For each screen, first summarize what the page appears to be, then state the
user's likely current step, then propose the next safest action. If
information is missing because of masking, say exactly what is missing and
continue with the best privacy-preserving guidance possible.

IMPORTANT FIELD VALIDATION:
Check if any filled or redacted values contradict their form field labels (e.g. an [EMAIL] entered into a 'Roll Number' or 'Phone' field). If there is a mismatch, add an item to risk_flags (e.g. 'mismatch: Roll Number field contains an email address') and highlight the warning in rationale so the user can fix it before submitting.

Return JSON only, no prose, no markdown fences:
{
  "screen_type": string,
  "goal_state": string,
  "visible_key_elements": string[],
  "hidden_sensitive_regions": string[],
  "next_action": "click" | "scroll" | "type_placeholder" | "navigate" | "wait" | "stop",
  "action_target": string,
  "confidence": number,
  "ask_user_confirmation": boolean,
  "risk_flags": string[],
  "rationale": string
}`;
async function requestGrokGuidance(payload, apiKey2, mockMode = false) {
  const activeKey = apiKey2 || (typeof process !== "undefined" && process.env ? process.env.GROQ_API_KEY : "") || "";
  if (mockMode && !apiKey2) {
    return {
      screen_type: "Registration Form",
      goal_state: "Complete form submission",
      visible_key_elements: ["#name", "#email", "#card", 'button[type="submit"]'],
      hidden_sensitive_regions: ["[NAME: Alex Mercer]", "[EMAIL: user1@example.com]", "[CARD: **** **** **** 1234]"],
      next_action: "click",
      action_target: 'button[type="submit"]',
      confidence: 0.96,
      ask_user_confirmation: false,
      risk_flags: [],
      rationale: "All required fields are populated with valid privacy surrogate values. Safe to proceed by clicking submit."
    };
  }
  const isGroq = true;
  const endpoint = isGroq ? "https://api.groq.com/openai/v1/chat/completions" : "https://api.x.ai/v1/chat/completions";
  const model = isGroq ? "openai/gpt-oss-120b" : "grok-vision-beta";
  const userContent = [
    {
      type: "text",
      text: `Page Category: ${payload.pageTitleCategory}
Domain: ${payload.urlDomain}
Element Roles: ${payload.elementRoles.join(", ")}
Provide the next safest browser action based on this sanitized view.`
    }
  ];
  if (!isGroq && payload.sanitizedScreenshotUrl) {
    userContent.push({
      type: "image_url",
      image_url: { url: payload.sanitizedScreenshotUrl }
    });
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${activeKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: GROK_SYSTEM_PROMPT },
        { role: "user", content: isGroq ? userContent[0].text : userContent }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    })
  });
  if (!response.ok) {
    throw new Error(`Cloud Guidance API error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  const rawContent = data.choices?.[0]?.message?.content || "{}";
  const cleanJson = rawContent.replace(/```json/g, "").replace(/```/g, "").trim();
  return JSON.parse(cleanJson);
}

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

// extension/background/service-worker.ts
var agentState = {
  isRunning: false,
  isPaused: false,
  state: "IDLE",
  iterationCount: 0
};
var apiKey = "";
function broadcastState() {
  chrome.runtime.sendMessage({
    type: "AGENT_STATUS_UPDATE",
    status: agentState
  }).catch(() => {
  });
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_AGENT_STATUS") {
    sendResponse(agentState);
    return true;
  }
  if (message.type === "SET_API_KEY") {
    apiKey = message.apiKey || "";
    sendResponse({ success: true });
    return true;
  }
  if (message.type === "START_LOOP") {
    if (!agentState.isRunning) {
      agentState.isRunning = true;
      agentState.isPaused = false;
      agentState.state = "CAPTURING";
      agentState.iterationCount = 0;
      broadcastState();
      runGuidanceStep();
    }
    sendResponse({ success: true });
    return true;
  }
  if (message.type === "PAUSE_LOOP") {
    agentState.isPaused = true;
    agentState.state = "IDLE";
    broadcastState();
    sendResponse({ success: true });
    return true;
  }
  if (message.type === "RESUME_LOOP") {
    if (agentState.isRunning && agentState.isPaused) {
      agentState.isPaused = false;
      agentState.state = "CAPTURING";
      broadcastState();
      runGuidanceStep();
    }
    sendResponse({ success: true });
    return true;
  }
  if (message.type === "STOP_LOOP") {
    agentState.isRunning = false;
    agentState.isPaused = false;
    agentState.state = "STOPPED";
    agentState.pendingConfirmation = void 0;
    localMappingStore.clear();
    broadcastState();
    sendResponse({ success: true });
    return true;
  }
  if (message.type === "USER_CONFIRM_ACTION") {
    if (agentState.pendingConfirmation) {
      const approved = message.approved;
      const pending = agentState.pendingConfirmation;
      agentState.pendingConfirmation = void 0;
      if (approved) {
        agentState.state = "EXECUTING";
        broadcastState();
        executeActionLocally(pending);
      } else {
        agentState.state = "IDLE";
        broadcastState();
      }
    }
    sendResponse({ success: true });
    return true;
  }
});
async function captureVisibleScreen(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        reject(new Error(chrome.runtime.lastError?.message || "Failed to capture visible tab"));
      } else {
        resolve(dataUrl);
      }
    });
  });
}
async function runGuidanceStep() {
  if (!agentState.isRunning || agentState.isPaused) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab found");
    agentState.iterationCount++;
    console.log(`
\u{1F680} [Parallax Agent] Starting Iteration #${agentState.iterationCount}`);
    agentState.state = "CAPTURING";
    broadcastState();
    const rawScreenshot = await captureVisibleScreen(tab.id);
    agentState.state = "READING_DOM";
    broadcastState();
    const domResponse = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { type: "READ_DOM_SNAPSHOT" }, (res) => {
        if (chrome.runtime.lastError || !res) {
          resolve({
            success: false,
            snapshot: { url: tab.url || "", title: tab.title || "", elements: [], timestamp: Date.now() }
          });
        } else {
          resolve(res);
        }
      });
    });
    const domSnapshot = domResponse.snapshot;
    agentState.state = "DETECTING_PII";
    broadcastState();
    const domDetections = detectDOMPII(domSnapshot);
    const visualDetections = await detectVisualPII(rawScreenshot);
    const allDetections = [...domDetections, ...visualDetections];
    console.log(`\u{1F6E1}\uFE0F [Parallax Agent] Detected ${allDetections.length} sensitive PII regions.`);
    agentState.state = "REDACTING";
    broadcastState();
    const redactionResult = await redactScreenshotAndMap(rawScreenshot, allDetections);
    agentState.state = "CALLING_GROK";
    broadcastState();
    const sanitizedPayload = {
      sanitizedScreenshotUrl: redactionResult.sanitizedScreenshot,
      urlDomain: new URL(domSnapshot.url || "http://localhost").hostname,
      pageTitleCategory: domSnapshot.title || "Web Form",
      elementRoles: domSnapshot.elements.map((e) => `${e.tag}:${e.ariaRole || e.type || "element"}`)
    };
    const guidanceOutput = await requestGrokGuidance(sanitizedPayload, apiKey, !apiKey);
    agentState.nextAction = `${guidanceOutput.next_action} -> ${guidanceOutput.action_target}`;
    agentState.confidence = guidanceOutput.confidence;
    console.log("\u{1F916} [Grok Guidance Output]:", guidanceOutput);
    agentState.state = "VALIDATING";
    broadcastState();
    const validation = validateProposedAction(guidanceOutput);
    if (!validation.isValid) {
      console.warn(`\u26D4 [ActionValidator] REJECTED action: ${validation.rejectionReason}`);
      agentState.state = "STOPPED";
      agentState.isRunning = false;
      broadcastState();
      return;
    }
    if (validation.requiresUserConfirmation) {
      console.log("\u26A0\uFE0F [ActionValidator] Action requires explicit user confirmation.");
      agentState.state = "AWAITING_USER";
      agentState.pendingConfirmation = guidanceOutput;
      broadcastState();
      return;
    }
    agentState.state = "EXECUTING";
    broadcastState();
    await executeActionLocally(guidanceOutput);
  } catch (err) {
    console.error("[Parallax ServiceWorker] Error in guidance step:", err);
    agentState.isRunning = false;
    agentState.state = "STOPPED";
    broadcastState();
  }
}
async function executeActionLocally(guidance) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  console.log(`\u26A1 [Parallax Agent] Executing action: "${guidance.next_action}" on "${guidance.action_target}"`);
  chrome.tabs.sendMessage(tab.id, {
    type: "EXECUTE_DOM_ACTION",
    payload: {
      action: guidance.next_action,
      target: guidance.action_target
    }
  }, (res) => {
    console.log("[Parallax ActionExecutor Response]:", res);
    if (guidance.next_action === "stop") {
      agentState.isRunning = false;
      agentState.state = "STOPPED";
      broadcastState();
      return;
    }
    if (agentState.isRunning && !agentState.isPaused) {
      setTimeout(runGuidanceStep, 1500);
    }
  });
}
chrome.tabs.onRemoved.addListener(() => {
  localMappingStore.clear();
});
//# sourceMappingURL=service-worker.js.map
