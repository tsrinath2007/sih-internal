# Parallax: Privacy-Preserving Browser Vision Agent (Chrome Extension)

> **Core Principle**: *Sanitize locally, guide remotely, execute locally.*
> Sensitive values never leave the device; only redacted screenshots and structured metadata are transmitted to the cloud LLM (Grok/xAI).

---

## 🏗️ Architecture Pipeline

```
Capture Screen ──> Read DOM ──> Detect PII ──> Redact Screen ──> Send Sanitized View
                                                                          │
  ┌───────────────────────────────────────────────────────────────────────┘
  ▼
Grok Guidance ──> Validate Action ──> Execute Locally ──> Repeat Loop
```

1. **Capture Screen**: Content script/service worker captures the visible tab (`chrome.tabs.captureVisibleTab`) and current DOM snapshot.
2. **Read DOM** (`extension/content/dom-reader.ts`): Extracts visible text nodes, input attributes (`name`, `type`, `autocomplete`, `placeholder`), ARIA roles, and bounding boxes for every element.
3. **Detect PII** (`extension/content/pii-detector-dom.ts` & `pii-detector-visual.ts`):
   * **DOM-first pass**: Regex + Luhn Mod-10 Checksum + autocomplete attribute NER (catches emails, phone numbers, card numbers, addresses, names in form fields) — primary, sub-millisecond, precise pass.
   * **Visual fallback pass**: Fast sub-50ms CPU canvas pass for visual cards, avatars, and embedded graphic text.
4. **Redact Screen** (`extension/content/redactor.ts`): Applies **semantic surrogate replacement** (e.g., real name $\rightarrow$ `Alex Mercer`, card $\rightarrow$ `**** **** **** 1234`) and records a volatile local mapping in `extension/storage/local-mapping-store.ts`.
5. **Send Sanitized View** (`extension/api/grok-client.ts`): Transmits **only** the redacted screenshot + minimal page metadata (URL domain, page title category, element roles) to the Grok API. The local PII mapping is **never** sent over the network.
6. **Grok Guidance**: Grok reasons strictly over the sanitized view and outputs structured JSON only.
7. **Validate Action** (`extension/policy/action-validator.ts`): **Local, code-enforced policy checks** gate all execution before touching the DOM:
   * Rejects any action targeting a region flagged in `hidden_sensitive_regions`.
   * Rejects actions outside the allowed action set (`click`, `scroll`, `type_placeholder`, `navigate`, `wait`, `stop`).
   * Pauses for explicit user confirmation if `ask_user_confirmation` is true or if typing into a sensitive field.
   * Enforces rate limiting ($> 600\text{ms}$) to prevent prompt-injection runaway behavior.
8. **Execute Locally** (`extension/content/action-executor.ts`): Performs the validated action. If the action is `type_placeholder`, it substitutes the real value from the local mapping **at the moment of typing**.
9. **Repeat Loop**: Continues until `next_action == "stop"` or cancelled by the user.

---

## 📁 File Structure

```
/extension
  manifest.json                 # Manifest V3 Configuration
  /background
    service-worker.ts           # Orchestrates the full capture-redact-guide-execute loop
  /content
    dom-reader.ts                # Step 2: Structured DOM extraction
    pii-detector-dom.ts          # Step 3a: Primary DOM regex/attribute NER detector
    pii-detector-visual.ts       # Step 3b: Fast sub-50ms visual canvas fallback pass
    redactor.ts                  # Step 4: Semantic surrogate replacement & mapping
    action-executor.ts           # Step 8: Safe local DOM execution & real-value substitution
  /policy
    action-validator.ts          # Step 7: Code-enforced security gating (no LLM in path)
  /api
    grok-client.ts               # Step 6: Verbatim Grok system prompt & JSON parser
  /popup
    popup.html / popup.ts        # Human confirmation UI, pause/resume, stop controls
  /storage
    local-mapping-store.ts       # Ephemeral in-memory PII store (never synced/transmitted)
  /test
    pii-detector.test.ts         # Unit tests for PII and Luhn checksum
    action-validator.test.ts     # Security policy tests & injection blocking
    redactor-mapping.test.ts     # Semantic replacement round-trip tests
    grok-client.test.ts          # Grok payload assertions & zero-leak linting
    e2e-sample-flow.test.ts      # Multi-step checkout guidance flow test
README.md
```

---

## 🔒 Security Invariants & Defenses

1. **Zero-Leak Guarantee**:
   * Unit tests (`test/grok-client.test.ts` & `test/e2e-sample-flow.test.ts`) assert that outgoing network payloads contain **0 bytes of raw PII**.
2. **Code-Enforced Action Gating**:
   * If a malicious webpage contains prompt-injection text instructing the agent to click or reveal a masked field, `action-validator.ts` **blocks the action in code**, independent of the LLM's judgment.
3. **Volatile Local Mapping**:
   * Mappings are stored strictly in memory and cleared immediately on tab closure or agent reset.

---

## ⚠️ Known Limitations

* **Contextual PII**: A string that is harmless on one page (e.g. `"John Doe"` in a news article) may be sensitive on another (e.g. account holder on a bank statement). In this prototype, PII detection is stateless per-page.

---

## 🚀 Running the Extension (Demo Guide)

### 1. Build TypeScript Source

```bash
npm install
npm run build
```

### 2. Run Automated Test Suites

```bash
npm test
```

### 3. Load Unpacked in Chrome

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (top right toggle).
3. Click **Load unpacked** and select the `/extension` directory.
4. Open the test page: `http://localhost:3001/test-pages/test-page-normal.html`.
5. Click the **Parallax** extension icon in your toolbar and press **"Start Guidance Loop"**!
