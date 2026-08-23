// Sitewide promo bar for the Sept 13 Skills Clinic & Combine.
// Self-contained: injects its own styles and markup, fixed to the bottom of
// the viewport so it never collides with each page's independently-tuned
// fixed nav / hero spacing. Nudges the feedback/chat corner buttons up out
// of the way if they're present on the page.

(function () {
  var DISMISS_KEY = "faf-skills-clinic-banner-dismissed";
  if (sessionStorage.getItem(DISMISS_KEY) === "1") return;

  var style = document.createElement("style");
  style.textContent =
    "@keyframes fscbPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,255,255,.55)}50%{box-shadow:0 0 0 8px rgba(255,255,255,0)}}" +
    "#faf-skills-clinic-banner{position:fixed;left:0;right:0;bottom:0;z-index:300;" +
    "display:flex;align-items:center;justify-content:center;gap:18px;flex-wrap:wrap;" +
    "padding:16px 52px;background:linear-gradient(90deg,#e0a83c 0%,#f2b93f 50%,#e0842e 100%);" +
    "box-shadow:0 -4px 20px rgba(224,168,60,.35);" +
    "font-family:'Inter',sans-serif;color:#0a0a0a;text-align:center;}" +
    "#faf-skills-clinic-banner .fscb-text{font-size:15px;font-weight:600;line-height:1.4;}" +
    "#faf-skills-clinic-banner .fscb-text strong{font-weight:800;text-transform:uppercase;letter-spacing:.5px;}" +
    "#faf-skills-clinic-banner a.fscb-cta{flex-shrink:0;padding:11px 26px;border:none;border-radius:999px;" +
    "background:#0a0a0a;color:#f2b93f;font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;" +
    "text-decoration:none;animation:fscbPulse 2.2s ease-in-out infinite;transition:transform .15s,background .2s,color .2s;}" +
    "#faf-skills-clinic-banner a.fscb-cta:hover{background:#1a1a1a;color:#ffce6a;transform:scale(1.05);}" +
    "#faf-skills-clinic-banner .fscb-close{position:absolute;right:14px;top:50%;transform:translateY(-50%);" +
    "background:rgba(10,10,10,.15);border:none;border-radius:50%;width:26px;height:26px;color:#0a0a0a;" +
    "font-size:18px;line-height:1;cursor:pointer;padding:0;}" +
    "#faf-skills-clinic-banner .fscb-close:hover{background:rgba(10,10,10,.3);}" +
    "@media (max-width:640px){#faf-skills-clinic-banner{padding:14px 44px 14px 16px;gap:12px;}" +
    "#faf-skills-clinic-banner .fscb-text{font-size:13px;}" +
    "#faf-skills-clinic-banner a.fscb-cta{padding:9px 20px;}}";
  document.head.appendChild(style);

  var bar = document.createElement("div");
  bar.id = "faf-skills-clinic-banner";
  bar.innerHTML =
    '<div class="fscb-text"><strong>Skills Clinic &amp; Combine</strong> — Sept 13, free, 10U/12U — register before Sept 9</div>' +
    '<a class="fscb-cta" href="skills-clinic.html">Register Now</a>' +
    '<button class="fscb-close" aria-label="Dismiss">&times;</button>';
  document.body.appendChild(bar);

  bar.querySelector(".fscb-close").addEventListener("click", function () {
    sessionStorage.setItem(DISMISS_KEY, "1");
    bar.remove();
    adjustCorners(0);
  });

  function adjustCorners(offset) {
    ["faf-feedback", "faf-chat"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.bottom = offset ? offset + "px" : "";
    });
  }

  requestAnimationFrame(function () {
    adjustCorners(bar.offsetHeight + 12);
  });
})();
