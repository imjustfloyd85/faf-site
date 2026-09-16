// Newsletter signup modal for index.html and frisco-elite.html only.
// Appears after a short scroll (150px), not on immediate page load.
// Once dismissed or subscribed, sets a localStorage flag so it never
// shows again for that visitor.

(function () {
  var STORAGE_KEY = "faf-newsletter-popup-dismissed";
  if (localStorage.getItem(STORAGE_KEY) === "1") return;

  var shown = false;

  function injectModal() {
    if (shown) return;
    shown = true;
    window.removeEventListener("scroll", onScroll);

    var style = document.createElement("style");
    style.textContent = [
      "#faf-nl-overlay{position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:24px;opacity:0;transition:opacity .3s ease}",
      "#faf-nl-overlay.visible{opacity:1}",
      "#faf-nl-modal{position:relative;background:#111;border:1px solid var(--border,rgba(200,146,60,.2));border-radius:4px;max-width:420px;width:100%;padding:40px 32px 32px;text-align:center;transform:translateY(16px);transition:transform .3s ease}",
      "#faf-nl-overlay.visible #faf-nl-modal{transform:translateY(0)}",
      "#faf-nl-close{position:absolute;top:12px;right:12px;background:none;border:none;color:var(--muted,#7d7a77);font-size:22px;line-height:1;cursor:pointer;padding:4px 8px;transition:color .2s}",
      "#faf-nl-close:hover{color:var(--warm,#f5f0eb)}",
      "#faf-nl-modal h2{font-family:'Playfair Display',serif;font-style:italic;font-weight:400;font-size:26px;color:var(--gold,#c8923c);margin-bottom:8px}",
      "#faf-nl-modal p{font-family:'Inter',sans-serif;font-size:14px;line-height:1.6;color:var(--muted,#7d7a77);margin-bottom:20px}",
      "#faf-nl-form{display:flex;gap:8px}",
      "#faf-nl-form input{flex:1;padding:12px 14px;background:rgba(255,255,255,.05);border:1px solid var(--border,rgba(200,146,60,.2));border-radius:4px;color:var(--warm,#f5f0eb);font-family:'Inter',sans-serif;font-size:14px}",
      "#faf-nl-form input:focus{outline:none;border-color:var(--gold,#c8923c)}",
      "#faf-nl-form input::placeholder{color:var(--muted,#7d7a77)}",
      "#faf-nl-form button{padding:12px 22px;background:var(--gold,#c8923c);color:#0a0a0a;font-family:'Inter',sans-serif;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;border:none;border-radius:4px;cursor:pointer;white-space:nowrap;transition:background .2s}",
      "#faf-nl-form button:hover{background:var(--gold-lt,#e0b06a)}",
      "#faf-nl-form button:disabled{opacity:.5;cursor:not-allowed}",
      "#faf-nl-status{font-family:'Inter',sans-serif;font-size:12px;margin-top:10px;min-height:18px}",
      "#faf-nl-status.success{color:#27ae60}",
      "#faf-nl-status.error{color:#c0392b}",
      "@media(max-width:480px){#faf-nl-modal{padding:32px 20px 24px}#faf-nl-form{flex-direction:column}}",
    ].join("");
    document.head.appendChild(style);

    var overlay = document.createElement("div");
    overlay.id = "faf-nl-overlay";
    overlay.innerHTML =
      '<div id="faf-nl-modal">' +
      '<button id="faf-nl-close" aria-label="Close">&times;</button>' +
      "<h2>Stay in the game</h2>" +
      "<p>Get news on upcoming games, events, and ways to get involved with FAF.</p>" +
      '<form id="faf-nl-form">' +
      '<input type="email" id="faf-nl-email" placeholder="Your email" required autocomplete="email" />' +
      '<button type="submit" id="faf-nl-btn">Sign Up</button>' +
      "</form>" +
      '<div id="faf-nl-status"></div>' +
      "</div>";
    document.body.appendChild(overlay);

    // Fade in
    requestAnimationFrame(function () {
      overlay.classList.add("visible");
    });

    function dismiss() {
      localStorage.setItem(STORAGE_KEY, "1");
      overlay.classList.remove("visible");
      setTimeout(function () {
        overlay.remove();
      }, 300);
    }

    // Close button
    document.getElementById("faf-nl-close").addEventListener("click", dismiss);

    // Click outside modal to close
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) dismiss();
    });

    // Escape key
    document.addEventListener("keydown", function handler(e) {
      if (e.key === "Escape") {
        dismiss();
        document.removeEventListener("keydown", handler);
      }
    });

    // Form submit
    document
      .getElementById("faf-nl-form")
      .addEventListener("submit", function (e) {
        e.preventDefault();
        var email = document.getElementById("faf-nl-email").value.trim();
        var btn = document.getElementById("faf-nl-btn");
        var status = document.getElementById("faf-nl-status");
        if (!email) return;

        btn.disabled = true;
        btn.textContent = "...";
        status.textContent = "";
        status.className = "";

        fetch("/api/newsletter-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email }),
        })
          .then(function (res) {
            return res.json().then(function (d) {
              return { ok: res.ok, data: d };
            });
          })
          .then(function (r) {
            if (r.ok && r.data.success) {
              status.textContent = r.data.message || "You're subscribed!";
              status.id = "faf-nl-status";
              status.className = "success";
              localStorage.setItem(STORAGE_KEY, "1");
              setTimeout(dismiss, 2200);
            } else {
              status.textContent = r.data.error || "Something went wrong.";
              status.className = "error";
              btn.disabled = false;
              btn.textContent = "Sign Up";
            }
          })
          .catch(function () {
            status.textContent = "Connection error. Try again.";
            status.className = "error";
            btn.disabled = false;
            btn.textContent = "Sign Up";
          });
      });
  }

  function onScroll() {
    if (window.scrollY > 150) {
      injectModal();
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });

  // Fallback: if the user never scrolls (short viewport or
  // they're already scrolled past 150 on load), fire after 3s
  setTimeout(function () {
    injectModal();
  }, 3000);
})();
