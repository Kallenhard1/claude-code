// @ts-check
// Webview UI for the Claude Code Bridge chat panel. Renders streamed CLI
// output: assistant text token-by-token, tool-use cards, and a usage footer.
(function () {
  const vscode = acquireVsCodeApi();

  const statusEl = document.getElementById("status");
  const messagesEl = document.getElementById("messages");
  const form = document.getElementById("composer");
  const input = /** @type {HTMLTextAreaElement} */ (document.getElementById("input"));
  const sendBtn = /** @type {HTMLButtonElement} */ (document.getElementById("send"));
  const cancelBtn = /** @type {HTMLButtonElement} */ (document.getElementById("cancel"));
  const contextToggle = /** @type {HTMLInputElement} */ (document.getElementById("context"));

  let busy = false;
  /** Current assistant text bubble being streamed into (or null). */
  let currentText = null;
  /** Map of tool_use id -> card element, to attach results. */
  const toolCards = new Map();

  function scrollToEnd() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addBubble(role, text) {
    const wrap = document.createElement("div");
    wrap.className = "message " + role;
    const label = document.createElement("div");
    label.className = "role";
    label.textContent =
      role === "user" ? "You" : role === "error" ? "Error" : "Claude Code";
    const body = document.createElement("div");
    body.className = "body";
    body.textContent = text || "";
    wrap.appendChild(label);
    wrap.appendChild(body);
    messagesEl.appendChild(wrap);
    scrollToEnd();
    return body;
  }

  function appendText(text) {
    if (!currentText) {
      currentText = addBubble("assistant", "");
    }
    currentText.textContent += text;
    scrollToEnd();
  }

  function addToolCard(id, name, inputObj) {
    currentText = null; // subsequent text starts a fresh bubble
    const card = document.createElement("details");
    card.className = "tool";
    const summary = document.createElement("summary");
    summary.textContent = "🔧 " + name;
    card.appendChild(summary);

    const pre = document.createElement("pre");
    pre.className = "tool-input";
    try {
      pre.textContent = JSON.stringify(inputObj, null, 2);
    } catch {
      pre.textContent = String(inputObj);
    }
    card.appendChild(pre);
    messagesEl.appendChild(card);
    toolCards.set(id, card);
    scrollToEnd();
  }

  function addToolResult(id, text, isError) {
    const card = toolCards.get(id);
    if (!card) {
      return;
    }
    const summary = card.querySelector("summary");
    if (summary && isError) {
      summary.classList.add("error");
    }
    const pre = document.createElement("pre");
    pre.className = "tool-result" + (isError ? " error" : "");
    const trimmed =
      text.length > 2000 ? text.slice(0, 2000) + "\n… (truncated)" : text;
    pre.textContent = trimmed || "(no output)";
    card.appendChild(pre);
    scrollToEnd();
  }

  function addFooter(event) {
    const footer = document.createElement("div");
    footer.className = "footer" + (event.isError ? " error" : "");
    const bits = [];
    if (typeof event.costUsd === "number") {
      bits.push("$" + event.costUsd.toFixed(4));
    }
    if (
      typeof event.inputTokens === "number" ||
      typeof event.outputTokens === "number"
    ) {
      bits.push(
        (event.inputTokens || 0) + " in / " + (event.outputTokens || 0) + " out tokens",
      );
    }
    if (event.isError) {
      bits.unshift("completed with error");
    }
    footer.textContent = bits.join(" · ") || "done";
    messagesEl.appendChild(footer);
    currentText = null;
    scrollToEnd();
  }

  function setBusy(value) {
    busy = value;
    sendBtn.disabled = value;
    cancelBtn.disabled = !value;
    sendBtn.textContent = value ? "…" : "Send";
  }

  function handleStream(event) {
    switch (event.type) {
      case "assistant-start":
        currentText = null;
        break;
      case "text-delta":
        appendText(event.text);
        break;
      case "thinking-delta":
        // Thinking is not rendered as answer text; ignore for now.
        break;
      case "tool-use":
        addToolCard(event.id, event.name, event.input);
        break;
      case "tool-result":
        addToolResult(event.toolUseId, event.text, event.isError);
        break;
      case "result":
        addFooter(event);
        break;
      case "notice":
        addBubble("error", event.text);
        break;
      case "init":
        // Surfaced via status; nothing to render.
        break;
    }
  }

  function submit() {
    const value = input.value.trim();
    if (!value || busy) {
      return;
    }
    addBubble("user", value);
    currentText = null;
    input.value = "";
    vscode.postMessage({
      type: "prompt",
      value,
      includeContext: contextToggle.checked,
    });
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

  cancelBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "cancel" });
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg?.type) {
      case "stream":
        handleStream(msg.event);
        break;
      case "error":
        addBubble("error", msg.value);
        break;
      case "status":
        statusEl.textContent = msg.value;
        break;
      case "busy":
        setBusy(Boolean(msg.value));
        break;
      case "clear":
        messagesEl.innerHTML = "";
        toolCards.clear();
        currentText = null;
        break;
    }
  });

  vscode.postMessage({ type: "ready" });
})();
