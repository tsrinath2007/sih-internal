var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// extension/popup/popup.ts
var require_popup = __commonJS({
  "extension/popup/popup.ts"() {
    document.addEventListener("DOMContentLoaded", () => {
      const agentState = document.getElementById("agentState");
      const nextActionText = document.getElementById("nextActionText");
      const confidenceText = document.getElementById("confidenceText");
      const startAgentBtn = document.getElementById("startAgentBtn");
      const pauseAgentBtn = document.getElementById("pauseAgentBtn");
      const stopAgentBtn = document.getElementById("stopAgentBtn");
      const confirmationCard = document.getElementById("confirmationCard");
      const proposedActionText = document.getElementById("proposedActionText");
      const confirmBtn = document.getElementById("confirmBtn");
      const rejectBtn = document.getElementById("rejectBtn");
      let isRunning = false;
      let isPaused = false;
      function refreshState() {
        chrome.runtime.sendMessage({ type: "GET_AGENT_STATUS" }, (res) => {
          if (chrome.runtime.lastError || !res) return;
          updateUI(res);
        });
      }
      function updateUI(status) {
        isRunning = status.isRunning;
        isPaused = status.isPaused;
        if (agentState) agentState.textContent = status.state || (isRunning ? isPaused ? "PAUSED" : "RUNNING" : "IDLE");
        if (nextActionText) nextActionText.textContent = status.nextAction || "\u2014";
        if (confidenceText) confidenceText.textContent = status.confidence ? `${Math.round(status.confidence * 100)}%` : "\u2014";
        if (isRunning) {
          startAgentBtn.style.display = "none";
          pauseAgentBtn.style.display = "block";
          stopAgentBtn.style.display = "block";
          pauseAgentBtn.textContent = isPaused ? "\u25B6 Resume Guidance" : "\u23F8 Pause Guidance";
        } else {
          startAgentBtn.style.display = "block";
          pauseAgentBtn.style.display = "none";
          stopAgentBtn.style.display = "none";
        }
        if (status.pendingConfirmation) {
          confirmationCard.classList.add("active");
          proposedActionText.textContent = `Action: "${status.pendingConfirmation.next_action}" on "${status.pendingConfirmation.action_target}" (Rationale: ${status.pendingConfirmation.rationale || "N/A"})`;
        } else {
          confirmationCard.classList.remove("active");
        }
      }
      startAgentBtn?.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "START_LOOP" }, (res) => {
          if (res?.success) refreshState();
        });
      });
      pauseAgentBtn?.addEventListener("click", () => {
        const action = isPaused ? "RESUME_LOOP" : "PAUSE_LOOP";
        chrome.runtime.sendMessage({ type: action }, () => refreshState());
      });
      stopAgentBtn?.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "STOP_LOOP" }, () => refreshState());
      });
      confirmBtn?.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "USER_CONFIRM_ACTION", approved: true }, () => refreshState());
      });
      rejectBtn?.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "USER_CONFIRM_ACTION", approved: false }, () => refreshState());
      });
      chrome.runtime.onMessage.addListener((message) => {
        if (message.type === "AGENT_STATUS_UPDATE") {
          updateUI(message.status);
        }
      });
      refreshState();
      setInterval(refreshState, 1500);
    });
  }
});
export default require_popup();
//# sourceMappingURL=popup.js.map
