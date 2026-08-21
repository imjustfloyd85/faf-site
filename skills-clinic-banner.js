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
    "#faf-skills-clinic-banner{position:fixed;left:0;right:0;bottom:0;z-index:300;" +
    "display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap;" +
    "padding:12px 48px;background:#0a0a0a;border-top:1px solid #c8923c;" +
    "font-family:'Inter',sans-serif;color:#f5f0eb;text-align:center;}" +
    "#faf-skills-clinic-banner .fscb-text{font-size:13px;line-height:1.4;}" +
    "#faf-skills-clinic-banner .fscb-text strong{color:#e0b06a;}" +
    "#faf-skills-clinic-banner a.fscb-cta{flex-shrink:0;padding:8px 18px;border:1px solid #c8923c;" +
    "color:#c8923c;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;" +
    "text-decoration:none;border-radius:2px;transition:background .2s,color .2s;}" +
    "#faf-skills-clinic-banner a.fscb-cta:hover{background:#c8923c;color:#0a0a0a;}" +
    "#faf-skills-clinic-banner .fscb-close{position:absolute;right:12px;top:50%;transform:translateY(-50%);" +
    "background:none;border:none;color:#7d7a77;font-size:18px;line-height:1;cursor:pointer;padding:6px;}" +
    "#faf-skills-clinic-banner .fscb-close:hover{color:#f5f0eb;}" +
    "@media (max-width:640px){#faf-skills-clinic-banner{padding:12px 40px 12px 16px;}" +
    "#faf-skills-clinic-banner .fscb-text{font-size:12px;}}";
  document.head.appendChild(style);

  var bar = document.createElement("div");
  bar.id = "faf-skills-clinic-banner";
  bar.innerHTML =
    '<div class="fscb-text"><strong>Skills Clinic &amp; Combine</strong> — Sept 13, free, 10U/12U — register before Sept 9</div>' +
    '<a class="fscb-cta" href="skills-clinic.html">Learn More</a>' +
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
