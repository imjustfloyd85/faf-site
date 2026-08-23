// Sitewide feedback / bug-report widget.
// Self-contained: injects its own styles, markup, and event handlers.
// Same IIFE pattern as skills-clinic-banner.js so any page can load it
// with a single <script src="feedback-widget.js" defer></script>.
//
// Posts to /api/feedback. No auth required (rate-limited server-side).
// Uses CSS custom properties (--gold, --dark, etc.) already defined on
// every FAF page, so it inherits the site palette automatically.

(function () {
  // Guard against double-injection
  if (document.getElementById("faf-feedback")) return;

  var style = document.createElement("style");
  style.textContent =
    "#faf-feedback{position:fixed;bottom:28px;left:28px;z-index:1000;font-family:'Inter',sans-serif;}" +
    "#feedback-btn{display:flex;align-items:center;gap:8px;padding:12px 20px;border-radius:100px;" +
    "background:var(--dark-2,#111);border:1px solid var(--border,rgba(200,146,60,.2));" +
    "color:var(--warm,#f5f0eb);font-size:12px;font-weight:700;letter-spacing:1px;" +
    "text-transform:uppercase;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,.4);" +
    "transition:border-color .2s,transform .2s;}" +
    "#feedback-btn:hover{border-color:var(--gold,#c8923c);transform:translateY(-1px);}" +
    "#feedback-btn svg{width:16px;height:16px;color:var(--gold,#c8923c);}" +
    "#feedback-panel{display:none;position:fixed;inset:0;z-index:1001;" +
    "background:rgba(5,5,5,.82);backdrop-filter:blur(4px);" +
    "align-items:center;justify-content:center;padding:24px;opacity:0;transition:opacity .25s ease;}" +
    "#faf-feedback.open #feedback-panel{display:flex;opacity:1;}" +
    "#feedback-card{background:var(--dark-2,#111);border:1px solid var(--border,rgba(200,146,60,.2));" +
    "border-top:3px solid var(--gold,#c8923c);max-width:440px;width:100%;max-height:88vh;" +
    "overflow-y:auto;padding:32px;position:relative;" +
    "transform:scale(.94) translateY(10px);transition:transform .3s cubic-bezier(.2,.8,.2,1);}" +
    "#faf-feedback.open #feedback-card{transform:scale(1) translateY(0);}" +
    "#feedback-close{position:absolute;top:14px;right:16px;background:none;border:none;" +
    "color:var(--muted,#7d7a77);font-size:22px;line-height:1;cursor:pointer;padding:4px;}" +
    "#feedback-close:hover{color:var(--gold,#c8923c);}" +
    "#feedback-card h3{font-size:20px;font-weight:800;letter-spacing:.5px;" +
    "text-transform:uppercase;color:var(--warm,#f5f0eb);margin-bottom:6px;}" +
    "#feedback-card .feedback-sub{font-size:13px;color:var(--muted,#7d7a77);" +
    "margin-bottom:20px;line-height:1.5;}" +
    ".feedback-quickfill{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;}" +
    ".feedback-quickfill button{font-size:11px;padding:6px 12px;border-radius:100px;" +
    "border:1px solid var(--border,rgba(200,146,60,.2));background:transparent;" +
    "color:var(--muted,#7d7a77);cursor:pointer;transition:border-color .2s,color .2s;}" +
    ".feedback-quickfill button:hover{border-color:var(--gold,#c8923c);color:var(--gold,#c8923c);}" +
    ".feedback-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;}" +
    "#feedback-card label{display:block;font-size:10px;font-weight:700;letter-spacing:1.5px;" +
    "text-transform:uppercase;color:var(--muted,#7d7a77);margin-bottom:6px;}" +
    "#feedback-card select,#feedback-card input,#feedback-card textarea{width:100%;" +
    "padding:10px 12px;background:var(--dark,#0a0a0a);border:1px solid var(--border,rgba(200,146,60,.2));" +
    "color:var(--warm,#f5f0eb);font-family:'Inter',sans-serif;font-size:13px;border-radius:2px;}" +
    "#feedback-card textarea{min-height:100px;resize:vertical;margin-bottom:14px;}" +
    "#feedback-card select:focus,#feedback-card input:focus,#feedback-card textarea:focus{outline:none;" +
    "border-color:var(--gold,#c8923c);}" +
    "#feedback-submit{width:100%;padding:13px;background:var(--gold,#c8923c);" +
    "color:var(--dark,#0a0a0a);border:none;font-size:12px;font-weight:700;letter-spacing:2px;" +
    "text-transform:uppercase;cursor:pointer;border-radius:2px;transition:background .2s;}" +
    "#feedback-submit:hover{background:var(--gold-lt,#e0b06a);}" +
    "#feedback-submit:disabled{opacity:.6;cursor:not-allowed;}" +
    "#feedback-status{margin-top:12px;font-size:13px;text-align:center;}" +
    "#feedback-status.success{color:#4ade80;}" +
    "#feedback-status.error{color:#f87171;}";
  document.head.appendChild(style);

  var widget = document.createElement("div");
  widget.id = "faf-feedback";
  widget.innerHTML =
    '<button id="feedback-btn">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14Z"/>' +
    '<path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>' +
    "</svg> Feedback</button>" +
    '<div id="feedback-panel"><div id="feedback-card">' +
    '<button id="feedback-close" aria-label="Close">&times;</button>' +
    "<h3>Got Feedback?</h3>" +
    '<p class="feedback-sub">Found a bug, or have an idea to make the site better? Let us know.</p>' +
    '<div class="feedback-quickfill">' +
    '<button type="button" data-kind="bug">Report a bug</button>' +
    '<button type="button" data-kind="feature">Suggest a feature</button>' +
    '<button type="button" data-kind="improve">Something could be better</button>' +
    "</div>" +
    '<div class="feedback-row"><div>' +
    '<label for="feedbackCategory">Category</label>' +
    '<select id="feedbackCategory"><option value="general">General</option>' +
    '<option value="bug">Bug</option><option value="feature">Feature</option>' +
    '<option value="ui">UI / Design</option></select>' +
    "</div><div>" +
    '<label for="feedbackPriority">Priority</label>' +
    '<select id="feedbackPriority"><option value="low">Low</option>' +
    '<option value="medium" selected>Medium</option>' +
    '<option value="high">High</option></select>' +
    "</div></div>" +
    '<label for="feedbackSuggestion">What\'s on your mind?</label>' +
    '<textarea id="feedbackSuggestion" placeholder="Tell us what happened, or what you\'d like to see..."></textarea>' +
    '<div class="feedback-row"><div>' +
    '<label for="feedbackName">Name (optional)</label>' +
    '<input type="text" id="feedbackName"/>' +
    "</div><div>" +
    '<label for="feedbackEmail">Email (optional)</label>' +
    '<input type="email" id="feedbackEmail"/>' +
    "</div></div>" +
    '<button id="feedback-submit">Send Feedback</button>' +
    '<p id="feedback-status"></p>' +
    "</div></div>";
  document.body.appendChild(widget);

  // Event handlers (scoped to avoid globals)
  function toggle(open) {
    if (open) {
      widget.classList.add("open");
    } else {
      widget.classList.remove("open");
      document.getElementById("feedback-status").textContent = "";
      document.getElementById("feedback-status").className = "";
    }
  }

  document
    .getElementById("feedback-btn")
    .addEventListener("click", function () {
      toggle(true);
    });

  document
    .getElementById("feedback-close")
    .addEventListener("click", function () {
      toggle(false);
    });

  document
    .getElementById("feedback-panel")
    .addEventListener("click", function (e) {
      if (e.target === this) toggle(false);
    });

  // Quick-fill buttons
  var starters = {
    bug: "I noticed a bug where ",
    feature: "It would be great if the site could ",
    improve: "I think this could be improved by ",
  };

  widget.querySelectorAll(".feedback-quickfill button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var kind = btn.getAttribute("data-kind");
      var ta = document.getElementById("feedbackSuggestion");
      ta.value = starters[kind] || "";
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      if (kind === "bug")
        document.getElementById("feedbackCategory").value = "bug";
      else if (kind === "feature")
        document.getElementById("feedbackCategory").value = "feature";
    });
  });

  // Submit
  document
    .getElementById("feedback-submit")
    .addEventListener("click", function () {
      var suggestion = document
        .getElementById("feedbackSuggestion")
        .value.trim();
      var statusEl = document.getElementById("feedback-status");
      var btn = document.getElementById("feedback-submit");

      if (!suggestion) {
        statusEl.textContent = "Please share a bit of detail first.";
        statusEl.className = "error";
        return;
      }

      btn.disabled = true;
      btn.textContent = "Sending...";

      fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestion: suggestion,
          category: document.getElementById("feedbackCategory").value,
          priority: document.getElementById("feedbackPriority").value,
          name: document.getElementById("feedbackName").value,
          email: document.getElementById("feedbackEmail").value,
          page: window.location.pathname,
        }),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (r) {
          if (r.ok && r.data.ok) {
            statusEl.textContent = "Thanks! We got it.";
            statusEl.className = "success";
            document.getElementById("feedbackSuggestion").value = "";
            document.getElementById("feedbackName").value = "";
            document.getElementById("feedbackEmail").value = "";
            setTimeout(function () {
              toggle(false);
            }, 1500);
          } else {
            statusEl.textContent = r.data.error || "Something went wrong.";
            statusEl.className = "error";
          }
          btn.disabled = false;
          btn.textContent = "Send Feedback";
        })
        .catch(function () {
          statusEl.textContent = "Connection error. Please try again.";
          statusEl.className = "error";
          btn.disabled = false;
          btn.textContent = "Send Feedback";
        });
    });
})();
