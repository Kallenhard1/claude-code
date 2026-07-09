// @ts-check
// Webview UI script for the Claude Code Bridge chat panel.
(function () {
  const vscode = acquireVsCodeApi();

  const statusEl = document.getElementById("status");
  const messagesEl = document.getElementById("messages");
  const form = document.getElementById("composer");
  const input = /** @type {HTMLTextAreaElement} */ (
    document.getElementById("input")
  );
  const sendBtn = /** @type {HTMLButtonElement} */ (
    document.getElementById("send")
  );

  let busy = false;

  function addMessage(role, text) {
    const wrap = document.createElement("div");
    wrap.className = "message " + role;

    const label = document.createElement("div");
    label.className = "role";
    label.textContent = role === "user" ? "You" : role === "error" ? "Error" : "Claude Code";

    const body = document.createElement("div");
    body.className = "body";
    body.textContent = text;

    wrap.appendChild(label);
    wrap.appendChild(body);
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setBusy(value) {
    busy = value;
    sendBtn.disabled = value;
    sendBtn.textContent = value ? "…" : "Send";
  }

  function submit() {
    const value = input.value.trim();
    if (!value || busy) {
      return;
    }
    addMessage("user", value);
    input.value = "";
    vscode.postMessage({ type: "prompt", value });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg?.type) {
      case "response":
        addMessage("assistant", msg.value);
        break;
      case "error":
        addMessage("error", msg.value);
        break;
      case "status":
        statusEl.textContent = msg.value;
        break;
      case "busy":
        setBusy(Boolean(msg.value));
        break;
      case "clear":
        messagesEl.innerHTML = "";
        break;
    }
  });

  vscode.postMessage({ type: "ready" });
})();
