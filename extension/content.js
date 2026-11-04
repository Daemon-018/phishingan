/* PhishinGAN content script: extracts page signals and renders a warning banner. */

(function () {
  if (window.__PHISHINGAN_LOADED__) return;
  window.__PHISHINGAN_LOADED__ = true;

  const BANNER_ID = "phishingan-banner-host";
  const EMAIL_HOSTS = [
    "mail.google.com",
    "outlook.live.com",
    "outlook.office.com",
    "outlook.office365.com",
    "mail.yahoo.com",
    "mail.proton.me",
    "mail.zoho.com",
  ];

  const EMAIL_BODY_SELECTORS = [
    "div.a3s",
    'div[role="document"]',
    '[aria-label="Message body"]',
    ".allowTextSelection",
    'div[data-test-id="message-view-body-content"]',
    ".msg-body",
    ".message-content",
    ".proton-message-content",
  ];

  const EMAIL_SUBJECT_SELECTORS = [
    "h2.hP",
    'div[role="heading"][aria-level="2"]',
    'h1[data-test-id="message-subject"]',
    ".message-header-subject",
  ];

  function findEmailBody() {
    for (const selector of EMAIL_BODY_SELECTORS) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        if (node.innerText && node.innerText.trim().length > 20) return node;
      }
    }
    return null;
  }

  function findEmailSubject() {
    for (const selector of EMAIL_SUBJECT_SELECTORS) {
      const node = document.querySelector(selector);
      if (node && node.innerText.trim()) return node.innerText.trim();
    }
    return "";
  }

  let lastScannedText = "";
  let scanning = false;
  let autoTimer = null;

  function registrable(host) {
    const suffixes = new Set([
      "co.uk", "org.uk", "ac.uk", "gov.uk", "co.in", "net.in", "org.in",
      "co.jp", "ne.jp", "or.jp", "com.au", "net.au", "org.au", "com.br",
      "com.mx", "com.sg", "com.hk", "com.tw", "co.za", "co.nz", "co.kr",
      "com.tr", "com.ar", "com.cn", "com.my", "co.id", "co.th", "com.ph",
      "com.vn", "com.pk", "com.sa", "com.eg",
    ]);
    const parts = String(host || "").toLowerCase().split(".").filter(Boolean);
    if (parts.length <= 2) return parts.join(".");
    if (suffixes.has(parts.slice(-2).join("."))) return parts.slice(-3).join(".");
    return parts.slice(-2).join(".");
  }

  function isEmailHost(host) {
    const value = String(host || "").toLowerCase();
    return EMAIL_HOSTS.some((item) => value === item || value.endsWith("." + item));
  }

  function visibleText() {
    const host = location.hostname;
    if (host === "mail.google.com") {
      const body = document.querySelector("div.a3s");
      if (body && body.innerText.trim()) return body.innerText;
    }
    return document.body ? document.body.innerText : "";
  }

  function extractPage() {
    const host = location.hostname;
    const emailHost = isEmailHost(host);
    const emailBody = emailHost ? findEmailBody() : null;

    let title = document.title || "";
    if (emailBody) {
      const subject = findEmailSubject();
      if (subject) title = subject + " — " + title;
    }

    let text = emailBody ? emailBody.innerText : visibleText();
    if (emailHost && !emailBody) text = "";
    text = text.replace(/\s+/g, " ").trim().slice(0, 8000);

    const scope = emailBody || document;
    const links = Array.from(scope.querySelectorAll("a[href]"))
      .slice(0, 100)
      .map((anchor) => ({
        href: anchor.href,
        text: (anchor.innerText || anchor.getAttribute("aria-label") || "")
          .trim()
          .slice(0, 120),
      }))
      .filter((link) => /^https?:/i.test(link.href));

    const forms = Array.from(scope.querySelectorAll("form"))
      .slice(0, 25)
      .map((form) => {
        let resolved = null;
        try {
          resolved = new URL(form.getAttribute("action") || location.href, location.href);
        } catch (error) {
          resolved = null;
        }
        return {
          action: resolved ? resolved.href : "",
          method: (form.getAttribute("method") || "get").toLowerCase(),
          hasPassword: Boolean(form.querySelector('input[type="password"]')),
          crossOrigin: resolved
            ? registrable(resolved.hostname) !== registrable(location.hostname)
            : false,
          inputs: Array.from(form.querySelectorAll("input"))
            .slice(0, 20)
            .map((input) => input.type || "text"),
        };
      });

    if (!forms.some((form) => form.hasPassword) && scope.querySelector('input[type="password"]')) {
      forms.push({
        action: location.href,
        method: "post",
        hasPassword: true,
        crossOrigin: false,
        inputs: ["password"],
      });
    }

    return {
      url: location.href,
      hostname: host,
      secure: location.protocol === "https:",
      title,
      text,
      links,
      forms,
      kind: emailBody ? "email" : "page",
    };
  }

  function removeBanner() {
    const existing = document.getElementById(BANNER_ID);
    if (existing) existing.remove();
  }

  function showBanner(result) {
    if (!result || result.error) return;
    if (result.verdict === "legitimate") {
      removeBanner();
      return;
    }

    removeBanner();
    const host = document.createElement("div");
    host.id = BANNER_ID;
    const shadow = host.attachShadow({ mode: "closed" });

    const phishing = result.verdict === "phishing";
    const accent = phishing ? "#ff5d6c" : "#ffb020";
    const background = phishing ? "#1b0b10" : "#1d1505";
    const reasons = (result.reasons || []).slice(0, 3);

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .bar {
          position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
          display: flex; gap: 12px; align-items: flex-start;
          padding: 12px 16px;
          background: ${background};
          color: #f1f5fb;
          border-bottom: 2px solid ${accent};
          box-shadow: 0 10px 34px rgba(0,0,0,0.45);
          font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        }
        .mark {
          flex: none; width: 30px; height: 30px; border-radius: 9px;
          display: grid; place-items: center;
          background: ${accent}; color: #1b0b10; font-weight: 800; font-size: 15px;
        }
        .copy { flex: 1; min-width: 0; }
        .title { font-weight: 700; color: ${accent}; font-size: 14px; margin: 0 0 2px; }
        .sub { margin: 0; color: #b9c6d8; }
        .reasons { margin: 7px 0 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 5px; }
        .reasons li {
          font-size: 11px; color: #e8eef7; border: 1px solid rgba(255,255,255,0.15);
          background: rgba(255,255,255,0.05); border-radius: 999px; padding: 2px 7px;
        }
        .actions { flex: none; display: flex; gap: 6px; align-items: center; }
        button {
          font: inherit; cursor: pointer; border-radius: 7px; padding: 5px 9px;
          border: 1px solid rgba(255,255,255,0.22); background: transparent; color: #e8eef7;
        }
        button:hover { background: rgba(255,255,255,0.08); }
        .dismiss { border-color: transparent; color: #9fb0c7; font-size: 16px; line-height: 1; padding: 2px 6px; }
      </style>
      <div class="bar" role="alert">
        <div class="mark">${phishing ? "!" : "?"}</div>
        <div class="copy">
          <p class="title">${phishing ? "PhishinGAN: likely phishing page" : "PhishinGAN: suspicious page"}</p>
          <p class="sub">
            ${
              phishing
                ? "Do not enter passwords, card numbers, or one-time codes. Close this page if you did not expect it."
                : "Some signals look wrong. Verify the sender or domain through a channel you trust before signing in."
            }
            Risk ${result.risk_score}/100.
          </p>
          <ul class="reasons">
            ${reasons.map((reason) => `<li>${escapeHtml(reason.label)}</li>`).join("")}
          </ul>
        </div>
        <div class="actions">
          <button type="button" class="rescan">Rescan</button>
          <button type="button" class="dismiss" aria-label="Dismiss warning">×</button>
        </div>
      </div>
    `;

    shadow.querySelector(".dismiss").addEventListener("click", removeBanner);
    shadow.querySelector(".rescan").addEventListener("click", () => scanPage(true));
    document.documentElement.appendChild(host);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function scanPage(force) {
    if (scanning) return;
    const payload = extractPage();
    if (!force && payload.text === lastScannedText) return;
    if (!payload.text && !payload.forms.length) return;

    scanning = true;
    lastScannedText = payload.text;
    chrome.runtime.sendMessage({ type: "SCAN_PAGE", payload }, (result) => {
      scanning = false;
      if (chrome.runtime.lastError) return;
      showBanner(result);
    });
  }

  function maybeAutoScan() {
    chrome.storage.local.get({ autoScan: true }, (settings) => {
      if (!settings.autoScan) return;
      const hasPassword = Boolean(document.querySelector('input[type="password"]'));
      const emailPage = isEmailHost(location.hostname);
      if (!hasPassword && !emailPage) return;

      clearTimeout(autoTimer);
      autoTimer = setTimeout(() => scanPage(false), emailPage ? 1400 : 700);

      if (emailPage) {
        const observer = new MutationObserver(() => {
          const body = findEmailBody();
          const current = body
            ? body.innerText.replace(/\s+/g, " ").trim()
            : "";
          if (current && current !== lastScannedText) {
            clearTimeout(autoTimer);
            autoTimer = setTimeout(() => scanPage(false), 600);
          }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
      }
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return false;
    if (message.type === "EXTRACT_PAGE") {
      sendResponse(extractPage());
      return true;
    }
    if (message.type === "SCAN_NOW") {
      scanPage(true);
      sendResponse({ started: true });
      return true;
    }
    return false;
  });

  maybeAutoScan();
})();
