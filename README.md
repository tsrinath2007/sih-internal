# 🛡️ Parallax — Privacy-Preserving On-Device Visual Perception for Browser Agents

**Parallax** is a Chrome Extension (Manifest V3) and local backend built for privacy-first browser automation. It captures active web pages, performs **100% on-device local OCR**, detects and redacts sensitive **PII** (Personal Identifiable Information) before any network transmission, and enforces **Human-in-the-Loop Safe Action Approvals**.

---

## 🌟 Key Architecture & Privacy Guarantees

```
┌────────────────────────────────────────────────────────────────────────┐
│                          CHROME EXTENSION POPUP                        │
│                                                                        │
│  [ Active Tab Viewport ]                                               │
│            │                                                           │
│            ▼                                                           │
│  [ Local Tesseract.js WASM ] ──► Word Bounding Boxes + Confidence      │
│            │                                                           │
│            ▼                                                           │
│  [ PII Detection & Merger ]  ──► EMAIL, PHONE, CARD (Luhn), OTP        │
│            │                                                           │
│            ├── If any confidence < 80% ──► [ BLOCKED: Manual Review ]  │
│            │                               (Network Transmission Locked│
│            ▼                                                           │
│  [ Sanitized Canvas Redaction ]                                        │
│  • Solid Black Blackout Boxes                                          │
│  • Token Replacement: [EMAIL REDACTED], [CARD REDACTED], etc.          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                         POST /analyze (Sanitized Only)
                         (0 bytes raw data transmitted)
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        PARALLAX BACKEND (Node.js)                      │
│                                                                        │
│  • Terminal Audit Logger (Displays only sanitized tokens)              │
│  • Claude Sonnet 4.6 (Summarization) or Form Automation Action         │
│  • Returns proposed action: { requires_user_approval: true }           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     HUMAN-IN-THE-LOOP APPROVAL                         │
│                                                                        │
│  [ User Reviews Action Proposal in Popup ]                             │
│       ├── [ Approve ] ──► Injects safe action into webpage (#city)     │
│       └── [ Reject ]  ──► Cancels action                               │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js** (v18+)
- **Google Chrome** browser

### 2. Install Dependencies & Configure
In the root project directory:
```bash
npm install
```

Optionally create a `.env` file from `.env.example`:
```bash
cp .env.example .env
```
*(If `ANTHROPIC_API_KEY` is not provided, the server runs in offline demo mode with built-in synthesis).*

### 3. Start the Backend Server
```bash
npm start
# Or: node server.js
```
The server will start on `http://localhost:3001`.

### 4. Load the Chrome Extension
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in top right).
3. Click **Load unpacked** (top left).
4. Select the project directory:
   ```
   C:\Users\SES\OneDrive\Desktop\SIH-Internal
   ```
5. Pin the **Parallax** extension icon to your toolbar.

---

## 🎬 End-to-End Live Hackathon Demo Walkthrough

### Scenario A: Normal Pass & Safe Action Execution
1. Open the included test page in Chrome:
   `file:///C:/Users/SES/OneDrive/Desktop/SIH-Internal/test-pages/test-page-normal.html`
2. Open the **Parallax** extension popup.
3. Click **"Scan Current Page"**:
   - The original viewport is captured.
   - Local Tesseract OCR runs in the popup.
   - The **Original** canvas shows blue bounding boxes on all detected words.
   - The **Sanitized** canvas renders solid black redaction boxes with white tags:
     - `[EMAIL REDACTED]` over `alex.vance@examplecorp.com`
     - `[PHONE REDACTED]` over `+91 98765 43210`
     - `[CARD REDACTED]` over `4532 0150 1234 5671` (validated via Luhn algorithm)
     - `[OTP REDACTED]` over `482917` (proximity-checked to "security code")
   - Status updates to: **`Status: READY — Safe to proceed`**.
4. Select **Action: Fill City Field** in the dropdown.
5. Click **"Send Sanitized Context"**:
   - Check the Node.js terminal: observe the high-visibility audit banner showing **0 bytes of raw data transmitted**.
6. In the popup, the **Human-in-the-Loop Approval Card** will slide in:
   - "Proposed Backend Agent Action: Fill 'City' field with 'Bengaluru'".
7. Click **"Approve Action"**:
   - The `#city` field on the web page is automatically filled with `"Bengaluru"` and flashes a cyan pulse animation.

### Scenario B: AI Page Summarization
1. With the scan complete on `test-page-normal.html`, select **Action: Summarize Page**.
2. Click **"Send Sanitized Context"**.
3. In the popup approval card, review the AI summary generated by Claude based solely on sanitized tokens.
4. Click **"Approve Action"** to accept the summary.

### Scenario C: Fail-Safe Gate Trigger (Low Confidence Block)
1. Open the low-confidence test page in Chrome:
   `file:///C:/Users/SES/OneDrive/Desktop/SIH-Internal/test-pages/test-page-lowconfidence.html`
2. Open the **Parallax** extension popup and click **"Scan Current Page"**.
3. Notice that faint/washed-out text drops OCR confidence below 80%.
4. The system automatically triggers the fail-safe gate:
   - Status turns red: **`Status: BLOCKED — Manual review required`**.
   - The **"Send Sanitized Context"** button is locked disabled.
   - Prevents unverified text from ever reaching backend agents.

---

## 🛠️ Project Structure

```
├── manifest.json                  # Manifest V3 configuration
├── background.js                  # Service worker for viewport capture
├── content.js                     # Content script for safe DOM field filling
├── pii-detector.js                # Regex, Luhn check, spatial merger, confidence gate
├── popup.html                     # Extension UI & side-by-side preview panels
├── popup.js                       # Client-side OCR coordinator & approval engine
├── popup.css                      # Modern Dark Navy + Teal design system
├── server.js                      # Express backend & Anthropic Claude API handler
├── lib/                           # Local, offline Tesseract.js and WASM engines
│   ├── tesseract.min.js
│   ├── worker.min.js
│   ├── tesseract-core-lstm.wasm.js
│   └── lang-data/
│       └── eng.traineddata.gz     # Local English OCR dictionary
├── test-pages/
│   ├── test-page-normal.html      # High-contrast test page with 4 PII types + #city
│   └── test-page-lowconfidence.html# Low-contrast test page for fail-safe block demo
├── .env.example                   # Environment variable template
└── package.json                   # Dependencies & scripts
```
