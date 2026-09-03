// Service Worker - Full End-to-End Orchestrator Loop (Capture -> Redact -> Grok -> Validate -> Execute)

import { localMappingStore } from '../storage/local-mapping-store';
import { detectDOMPII, DetectedPIIEntity } from '../content/pii-detector-dom';
import { detectVisualPII } from '../content/pii-detector-visual';
import { redactScreenshotAndMap } from '../content/redactor';
import { requestGrokGuidance, SanitizedPayload } from '../api/grok-client';
import { validateProposedAction, GrokGuidanceOutput } from '../policy/action-validator';
import { DOMSnapshot } from '../content/dom-reader';

export interface AgentState {
  isRunning: boolean;
  isPaused: boolean;
  state: 'IDLE' | 'CAPTURING' | 'READING_DOM' | 'DETECTING_PII' | 'REDACTING' | 'CALLING_GROK' | 'VALIDATING' | 'AWAITING_USER' | 'EXECUTING' | 'STOPPED';
  nextAction?: string;
  confidence?: number;
  pendingConfirmation?: GrokGuidanceOutput;
  iterationCount: number;
}

let agentState: AgentState = {
  isRunning: false,
  isPaused: false,
  state: 'IDLE',
  iterationCount: 0
};

let apiKey: string = '';

function broadcastState() {
  chrome.runtime.sendMessage({
    type: 'AGENT_STATUS_UPDATE',
    status: agentState
  }).catch(() => {});
}

// Listen for popup and content script commands
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_AGENT_STATUS') {
    sendResponse(agentState);
    return true;
  }

  if (message.type === 'SET_API_KEY') {
    apiKey = message.apiKey || '';
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'START_LOOP') {
    if (!agentState.isRunning) {
      agentState.isRunning = true;
      agentState.isPaused = false;
      agentState.state = 'CAPTURING';
      agentState.iterationCount = 0;
      broadcastState();
      runGuidanceStep();
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'PAUSE_LOOP') {
    agentState.isPaused = true;
    agentState.state = 'IDLE';
    broadcastState();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'RESUME_LOOP') {
    if (agentState.isRunning && agentState.isPaused) {
      agentState.isPaused = false;
      agentState.state = 'CAPTURING';
      broadcastState();
      runGuidanceStep();
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'STOP_LOOP') {
    agentState.isRunning = false;
    agentState.isPaused = false;
    agentState.state = 'STOPPED';
    agentState.pendingConfirmation = undefined;
    localMappingStore.clear();
    broadcastState();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'USER_CONFIRM_ACTION') {
    if (agentState.pendingConfirmation) {
      const approved = message.approved;
      const pending = agentState.pendingConfirmation;
      agentState.pendingConfirmation = undefined;

      if (approved) {
        agentState.state = 'EXECUTING';
        broadcastState();
        executeActionLocally(pending);
      } else {
        agentState.state = 'IDLE';
        broadcastState();
      }
    }
    sendResponse({ success: true });
    return true;
  }
});

// Capture visible viewport screenshot
async function captureVisibleScreen(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        reject(new Error(chrome.runtime.lastError?.message || 'Failed to capture visible tab'));
      } else {
        resolve(dataUrl);
      }
    });
  });
}

// --------------------------------------------------------------------------
// Full Multi-Step Guidance Pipeline Loop
// --------------------------------------------------------------------------
async function runGuidanceStep() {
  if (!agentState.isRunning || agentState.isPaused) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found');

    agentState.iterationCount++;
    console.log(`\n🚀 [Parallax Agent] Starting Iteration #${agentState.iterationCount}`);

    // Step 1: Capture Screen
    agentState.state = 'CAPTURING';
    broadcastState();
    const rawScreenshot = await captureVisibleScreen(tab.id);

    // Step 2: Read DOM Snapshot
    agentState.state = 'READING_DOM';
    broadcastState();
    const domResponse = await new Promise<{ success: boolean; snapshot: DOMSnapshot }>((resolve) => {
      chrome.tabs.sendMessage(tab.id!, { type: 'READ_DOM_SNAPSHOT' }, (res) => {
        if (chrome.runtime.lastError || !res) {
          resolve({
            success: false,
            snapshot: { url: tab.url || '', title: tab.title || '', elements: [], timestamp: Date.now() }
          });
        } else {
          resolve(res);
        }
      });
    });

    const domSnapshot = domResponse.snapshot;

    // Step 3: Detect PII (DOM-first pass + Visual fallback)
    agentState.state = 'DETECTING_PII';
    broadcastState();
    const domDetections = detectDOMPII(domSnapshot);
    const visualDetections = await detectVisualPII(rawScreenshot);
    const allDetections: DetectedPIIEntity[] = [...domDetections, ...visualDetections];

    console.log(`🛡️ [Parallax Agent] Detected ${allDetections.length} sensitive PII regions.`);

    // Step 4: Redact Screen & Update Local Mapping
    agentState.state = 'REDACTING';
    broadcastState();
    const redactionResult = await redactScreenshotAndMap(rawScreenshot, allDetections);

    // Step 5 & 6: Send Sanitized View to Grok Guidance Client
    agentState.state = 'CALLING_GROK';
    broadcastState();

    const sanitizedPayload: SanitizedPayload = {
      sanitizedScreenshotUrl: redactionResult.sanitizedScreenshot,
      urlDomain: new URL(domSnapshot.url || 'http://localhost').hostname,
      pageTitleCategory: domSnapshot.title || 'Web Form',
      elementRoles: domSnapshot.elements.map(e => `${e.tag}:${e.ariaRole || e.type || 'element'}`)
    };

    // Call Grok Client (with fallback to structured mock for automated tests)
    const guidanceOutput = await requestGrokGuidance(sanitizedPayload, apiKey, !apiKey);

    agentState.nextAction = `${guidanceOutput.next_action} -> ${guidanceOutput.action_target}`;
    agentState.confidence = guidanceOutput.confidence;

    console.log('🤖 [Grok Guidance Output]:', guidanceOutput);

    // Step 7: Local, Code-Enforced Policy Validation
    agentState.state = 'VALIDATING';
    broadcastState();
    const validation = validateProposedAction(guidanceOutput);

    if (!validation.isValid) {
      console.warn(`⛔ [ActionValidator] REJECTED action: ${validation.rejectionReason}`);
      agentState.state = 'STOPPED';
      agentState.isRunning = false;
      broadcastState();
      return;
    }

    // If confirmation is required, pause loop and await user click-through
    if (validation.requiresUserConfirmation) {
      console.log('⚠️ [ActionValidator] Action requires explicit user confirmation.');
      agentState.state = 'AWAITING_USER';
      agentState.pendingConfirmation = guidanceOutput;
      broadcastState();
      return;
    }

    // Step 8: Execute Action Locally
    agentState.state = 'EXECUTING';
    broadcastState();
    await executeActionLocally(guidanceOutput);

  } catch (err: any) {
    console.error('[Parallax ServiceWorker] Error in guidance step:', err);
    agentState.isRunning = false;
    agentState.state = 'STOPPED';
    broadcastState();
  }
}

async function executeActionLocally(guidance: GrokGuidanceOutput) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  console.log(`⚡ [Parallax Agent] Executing action: "${guidance.next_action}" on "${guidance.action_target}"`);

  chrome.tabs.sendMessage(tab.id, {
    type: 'EXECUTE_DOM_ACTION',
    payload: {
      action: guidance.next_action,
      target: guidance.action_target
    }
  }, (res) => {
    console.log('[Parallax ActionExecutor Response]:', res);

    if (guidance.next_action === 'stop') {
      agentState.isRunning = false;
      agentState.state = 'STOPPED';
      broadcastState();
      return;
    }

    // Step 9: Repeat Loop after short delay
    if (agentState.isRunning && !agentState.isPaused) {
      setTimeout(runGuidanceStep, 1500);
    }
  });
}

// Tab close cleanup listener
chrome.tabs.onRemoved.addListener(() => {
  localMappingStore.clear();
});
