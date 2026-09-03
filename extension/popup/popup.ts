// Popup UI Controller - User confirmation, pause/resume, and stop agent loop

document.addEventListener('DOMContentLoaded', () => {
  const agentState = document.getElementById('agentState') as HTMLElement;
  const nextActionText = document.getElementById('nextActionText') as HTMLElement;
  const confidenceText = document.getElementById('confidenceText') as HTMLElement;

  const startAgentBtn = document.getElementById('startAgentBtn') as HTMLButtonElement;
  const pauseAgentBtn = document.getElementById('pauseAgentBtn') as HTMLButtonElement;
  const stopAgentBtn = document.getElementById('stopAgentBtn') as HTMLButtonElement;

  const confirmationCard = document.getElementById('confirmationCard') as HTMLElement;
  const proposedActionText = document.getElementById('proposedActionText') as HTMLElement;
  const confirmBtn = document.getElementById('confirmBtn') as HTMLButtonElement;
  const rejectBtn = document.getElementById('rejectBtn') as HTMLButtonElement;

  let isRunning = false;
  let isPaused = false;

  // Poll current agent state from background service worker
  function refreshState() {
    chrome.runtime.sendMessage({ type: 'GET_AGENT_STATUS' }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      updateUI(res);
    });
  }

  function updateUI(status: {
    isRunning: boolean;
    isPaused: boolean;
    state: string;
    nextAction?: string;
    confidence?: number;
    pendingConfirmation?: any;
  }) {
    isRunning = status.isRunning;
    isPaused = status.isPaused;

    if (agentState) agentState.textContent = status.state || (isRunning ? (isPaused ? 'PAUSED' : 'RUNNING') : 'IDLE');
    if (nextActionText) nextActionText.textContent = status.nextAction || '—';
    if (confidenceText) confidenceText.textContent = status.confidence ? `${Math.round(status.confidence * 100)}%` : '—';

    if (isRunning) {
      startAgentBtn.style.display = 'none';
      pauseAgentBtn.style.display = 'block';
      stopAgentBtn.style.display = 'block';
      pauseAgentBtn.textContent = isPaused ? '▶ Resume Guidance' : '⏸ Pause Guidance';
    } else {
      startAgentBtn.style.display = 'block';
      pauseAgentBtn.style.display = 'none';
      stopAgentBtn.style.display = 'none';
    }

    if (status.pendingConfirmation) {
      confirmationCard.classList.add('active');
      proposedActionText.textContent = `Action: "${status.pendingConfirmation.next_action}" on "${status.pendingConfirmation.action_target}" (Rationale: ${status.pendingConfirmation.rationale || 'N/A'})`;
    } else {
      confirmationCard.classList.remove('active');
    }
  }

  startAgentBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'START_LOOP' }, (res) => {
      if (res?.success) refreshState();
    });
  });

  pauseAgentBtn?.addEventListener('click', () => {
    const action = isPaused ? 'RESUME_LOOP' : 'PAUSE_LOOP';
    chrome.runtime.sendMessage({ type: action }, () => refreshState());
  });

  stopAgentBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_LOOP' }, () => refreshState());
  });

  confirmBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'USER_CONFIRM_ACTION', approved: true }, () => refreshState());
  });

  rejectBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'USER_CONFIRM_ACTION', approved: false }, () => refreshState());
  });

  // Listen for real-time status updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'AGENT_STATUS_UPDATE') {
      updateUI(message.status);
    }
  });

  refreshState();
  setInterval(refreshState, 1500);
});
