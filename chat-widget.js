// Sitewide FAF chat widget.
// Self-contained: injects its own styles, markup, and event handlers.
// Same IIFE pattern as feedback-widget.js so any page can load it
// with a single <script src="chat-widget.js" defer></script>.
//
// POSTs to https://chat.legacy7u.org/chat (backend managed separately).

(function () {
  // Guard against double-injection
  if (document.getElementById("faf-chat")) return;

  var style = document.createElement("style");
  style.textContent =
    "#faf-chat{position:fixed;bottom:28px;right:28px;z-index:1000;font-family:'Inter',sans-serif;}" +
    "#chat-btn{width:56px;height:56px;border-radius:50%;background:#c8923c;border:none;cursor:pointer;" +
    "display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(200,146,60,.5);" +
    "transition:transform .2s,background .2s;}" +
    "#chat-btn:hover{background:#e0b06a;transform:scale(1.06);}" +
    "#chat-btn svg{width:24px;height:24px;color:#0a0a0a;}" +
    "#chat-panel{position:absolute;bottom:70px;right:0;width:340px;max-height:500px;background:#111;" +
    "border:1px solid rgba(200,146,60,.25);border-radius:4px;display:none;flex-direction:column;" +
    "box-shadow:0 16px 48px rgba(0,0,0,.6);overflow:hidden;}" +
    "#chat-panel.open{display:flex;}" +
    "#chat-header{background:#0a0a0a;padding:16px 20px;border-bottom:1px solid rgba(200,146,60,.15);" +
    "display:flex;align-items:center;justify-content:space-between;}" +
    "#chat-header-info{display:flex;align-items:center;gap:12px;}" +
    "#chat-avatar{width:36px;height:36px;border-radius:50%;background:#c8923c;display:flex;" +
    "align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#0a0a0a;" +
    "letter-spacing:.5px;flex-shrink:0;}" +
    "#chat-name{font-size:13px;font-weight:700;color:#f5f0eb;}" +
    "#chat-status{font-size:11px;color:#7d7a77;letter-spacing:1px;}" +
    "#chat-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;" +
    "min-height:200px;max-height:320px;}" +
    ".chat-msg{display:flex;}" +
    ".chat-msg.user{justify-content:flex-end;}" +
    ".chat-msg.assistant{justify-content:flex-start;}" +
    ".chat-bubble{max-width:80%;padding:10px 14px;border-radius:4px;font-size:14px;line-height:1.6;}" +
    ".chat-msg.user .chat-bubble{background:#c8923c;color:#0a0a0a;font-weight:500;}" +
    ".chat-msg.assistant .chat-bubble{background:#1a1a1a;color:#f5f0eb;border:1px solid rgba(200,146,60,.15);}" +
    ".chat-typing .chat-bubble{color:#7d7a77;}" +
    "#chat-input-row{display:flex;border-top:1px solid rgba(200,146,60,.15);}" +
    "#chat-input{flex:1;background:#0a0a0a;border:none;padding:14px 16px;color:#f5f0eb;font-size:14px;" +
    "font-family:'Inter',sans-serif;outline:none;}" +
    "#chat-input::placeholder{color:#7d7a77;}" +
    "#chat-input-row button{background:none;border:none;padding:0 16px;cursor:pointer;}" +
    "#chat-input-row button svg{width:18px;height:18px;color:#c8923c;}" +
    "#chat-input-row button:hover svg{color:#e0b06a;}" +
    "@media(max-width:400px){#chat-panel{width:calc(100vw - 32px);right:-8px;}}";
  document.head.appendChild(style);

  var widget = document.createElement("div");
  widget.id = "faf-chat";
  widget.innerHTML =
    '<button id="chat-btn" aria-label="Chat with us">' +
    '<svg id="chat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
    '<svg id="chat-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none">' +
    '<path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
    '<div id="chat-panel">' +
    '<div id="chat-header"><div id="chat-header-info">' +
    '<div id="chat-avatar">FAF</div>' +
    '<div><div id="chat-name">Fathers &amp; Football</div>' +
    '<div id="chat-status">Ask us anything</div></div>' +
    "</div></div>" +
    '<div id="chat-messages">' +
    '<div class="chat-msg assistant"><div class="chat-bubble">' +
    "Hey! I can answer questions about Fathers and Football, our programs in Virginia and Texas, or how to get involved. What can I help with?" +
    "</div></div></div>" +
    '<div id="chat-input-row">' +
    '<input type="text" id="chat-input" placeholder="Type a message..."/>' +
    '<button id="chat-send-btn">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<path d="M22 2L11 13M22 2L15 22 11 13 2 9l20-7z"/></svg></button>' +
    "</div></div>";
  document.body.appendChild(widget);

  var chatHistory = [];

  function toggleChat() {
    var p = document.getElementById("chat-panel");
    var i = document.getElementById("chat-icon");
    var c = document.getElementById("chat-close");
    p.classList.toggle("open");
    i.style.display = p.classList.contains("open") ? "none" : "block";
    c.style.display = p.classList.contains("open") ? "block" : "none";
    if (p.classList.contains("open"))
      document.getElementById("chat-input").focus();
  }

  function addMsg(role, text) {
    var msgs = document.getElementById("chat-messages");
    var d = document.createElement("div");
    d.className = "chat-msg " + role;
    d.innerHTML = '<div class="chat-bubble">' + text + "</div>";
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    return d;
  }

  async function sendMsg() {
    var inp = document.getElementById("chat-input");
    var text = inp.value.trim();
    if (!text) return;
    inp.value = "";
    addMsg("user", text);
    chatHistory.push({ role: "user", content: text });
    var typing = addMsg("assistant chat-typing", "...");
    try {
      var res = await fetch("https://chat.legacy7u.org/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chatHistory.slice(-10) }),
      });
      var data = await res.json();
      var reply =
        (data.content && data.content[0] && data.content[0].text) ||
        "Sorry, something went wrong. Email info@fathersandfootball.org.";
      typing.remove();
      addMsg("assistant", reply);
      chatHistory.push({ role: "assistant", content: reply });
    } catch (e) {
      typing.remove();
      addMsg(
        "assistant",
        "Having trouble connecting. Email info@fathersandfootball.org.",
      );
    }
  }

  document.getElementById("chat-btn").addEventListener("click", toggleChat);
  document.getElementById("chat-send-btn").addEventListener("click", sendMsg);
  document
    .getElementById("chat-input")
    .addEventListener("keydown", function (e) {
      if (e.key === "Enter") sendMsg();
    });
})();
