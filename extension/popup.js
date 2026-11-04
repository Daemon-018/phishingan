/* PhishinGAN popup: shows the scan result for the active tab and settings. */

const RESTRICTED = /^(chrome|edge|brave|about|chrome-extension|moz-extension|devtools):/i;

const el = {
  current: document.getElementById("current"),
  scan: document.getElementById("scan"),
  mode: document.getElementById("mode"),
  details: document.getElementById("details"),
  reasons: document.getElementById("reasons"),
  linksWrap: document.getElementById("links-wrap"),
  links: document.getElementById("links"),
  signals: document.getElementById("signals"),
  settings: document.getElementById("settings"),
  settingsToggle: document.getElementById("settings-toggle"),
  autoScan: document.getElementById("auto-scan"),
  notifications: document.getElementById("notifications"),
  footer: document.getElementById("footer"),
};

let activeTab = null;
let lastResult = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function verdictMeta(verdict) {
  if (verdict === "phishing") {
    return {
      color: "#ff5d6c",
      background: "#2a1218",
      icon: "!",
      title: "Likely phishing",
      sub: "Do not enter passwords, card numbers, or one-time codes.",
    };
  }
  if (verdict === "suspicious") {
    return {
      color: "#ffb020",
      background: "#2a2008",
      icon: "?",
      title: "Suspicious",
      sub: "Verify the sender or domain through a channel you trust.",
    };
  }
  return {
    color: "#3dd68c",
    background: "#0f2a1e",
    icon: "✓",
    title: "No phishing signals",
    sub: "Nothing in the page text or links looked like a credential attack.",
  };
}

function showLoading(message) {
  el.current.dataset.verdict = "";
  el.current.innerHTML = `<div class="skeleton"><span class="dot"></span><p>${escapeHtml(
    message || "Scanning this page…"
  )}</p></div>`;
  el.details.hidden = true;
}

function showError(title, message) {
  el.current.dataset.verdict = "";
  el.current.innerHTML = `<p class="error"><strong>${escapeHtml(title)}</strong>${escapeHtml(
    message
  )}</p>`;
  el.details.hidden = true;
}

function renderResult(result) {
  lastResult = result;
  if (!result) {
    showError("Not scanned yet", "Open a page, then press “Scan this page”.");
    return;
  }

  const meta = verdictMeta(result.verdict);
  const score = Number(result.risk_score || 0);
  const host = result.hostname || result.url || "";
  const barWidth = Math.max(2, Math.min(100, score));
  const mode =
    result.mode === "email"
      ? "Email mode"
      : result.mode === "login"
        ? "Login mode"
        : "Page mode";

  el.current.dataset.verdict = result.verdict;
  el.current.innerHTML = `
    <div class="verdict-row">
      <div class="verdict-icon" style="background:${meta.background};color:${meta.color}">${meta.icon}</div>
      <div class="verdict-copy">
        <p class="verdict-title" style="color:${meta.color}">${escapeHtml(meta.title)}</p>
        <p class="verdict-sub">${escapeHtml(meta.sub)}</p>
        <span class="host" title="${escapeHtml(host)}">${escapeHtml(host)}</span>
      </div>
    </div>
    <div class="meter"><span style="width:${barWidth}%;background:${meta.color}"></span></div>
    <div class="meter-row">
      <span>Risk <b>${score}/100</b></span>
      <span>Model ${Math.round((result.model?.probability || 0) * 100)}% · Rules ${Math.round(
        (result.rules?.score || 0) * 100
      )}%</span>
    </div>
  `;

  el.mode.textContent = mode;
  el.mode.hidden = false;

  const reasons = result.reasons || [];
  el.details.hidden = false;
  el.reasons.innerHTML = reasons.length
    ? reasons
        .map(
          (reason) => `
        <li class="reason">
          <div class="reason-top">
            <span class="reason-label">${escapeHtml(reason.label)}</span>
            <span class="reason-cat">${escapeHtml(reason.category || "signal")}</span>
          </div>
          ${reason.detail ? `<p class="reason-detail">${escapeHtml(reason.detail)}</p>` : ""}
          <div class="reason-bar"><span style="width:${Math.max(
            4,
            Math.min(100, reason.strength || 0)
          )}%"></span></div>
        </li>`
        )
        .join("")
    : `<li class="reason"><p class="reason-detail">No individual signals crossed the reporting threshold.</p></li>`;

  const links = (result.urls || []).filter((url) => url.risk > 0);
  el.linksWrap.hidden = links.length === 0;
  el.links.innerHTML = links
    .slice(0, 8)
    .map(
      (url) => `
      <li class="link">
        <code title="${escapeHtml(url.url)}">${escapeHtml(url.defanged || url.url)}</code>
        <span class="risk">${Math.round(url.risk)}</span>
      </li>`
    )
    .join("");

  const stats = result.stats || {};
  el.signals.textContent = JSON.stringify(
    {
      verdict: result.verdict,
      risk_score: result.risk_score,
      confidence: result.confidence,
      model: result.model,
      rules: result.rules,
      thresholds: result.thresholds,
      stats,
      scannedAt: result.scannedAt ? new Date(result.scannedAt).toISOString() : null,
    },
    null,
    2
  );

  el.scan.textContent = "Scan again";
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

function sendToBackground(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

async function scanActiveTab() {
  if (!activeTab) return;
  if (RESTRICTED.test(activeTab.url || "")) {
    showError(
      "This page cannot be scanned",
      "Chrome blocks extensions on internal pages, the Web Store, and other extensions."
    );
    return;
  }

  el.scan.disabled = true;
  el.scan.textContent = "Scanning…";
  showLoading("Reading this page locally…");

  const payload = await sendToTab(activeTab.id, { type: "EXTRACT_PAGE" });
  if (!payload || payload.error) {
    el.scan.disabled = false;
    el.scan.textContent = "Scan this page";
    showError(
      "Could not read this page",
      "Reload the page so PhishinGAN can attach, then try again."
    );
    return;
  }

  const result = await sendToBackground({
    type: "SCAN_PAGE",
    tabId: activeTab.id,
    payload,
  });
  el.scan.disabled = false;
  el.scan.textContent = "Scan again";

  if (!result || result.error) {
    showError("Scan failed", result?.error || "The detector returned no result.");
    return;
  }
  renderResult(result);
}

async function loadSettings() {
  const settings = await sendToBackground({ type: "GET_SETTINGS" });
  el.autoScan.checked = settings?.autoScan !== false;
  el.notifications.checked = settings?.notifications !== false;
}

async function init() {
  activeTab = await getActiveTab();

  if (!activeTab) {
    showError("No active tab", "Open a page and try again.");
    return;
  }
  if (RESTRICTED.test(activeTab.url || "")) {
    showError(
      "This page cannot be scanned",
      "Chrome blocks extensions on internal pages, the Web Store, and other extensions."
    );
    el.scan.disabled = true;
    return;
  }

  await loadSettings();

  const stored = await sendToBackground({ type: "GET_RESULT", tabId: activeTab.id });
  if (stored) {
    renderResult(stored);
  } else {
    showLoading("Press “Scan this page” to check it locally.");
    el.scan.textContent = "Scan this page";
  }
}

el.scan.addEventListener("click", scanActiveTab);

el.settingsToggle.addEventListener("click", () => {
  el.settings.hidden = !el.settings.hidden;
});

el.autoScan.addEventListener("change", () => {
  sendToBackground({ type: "SET_SETTING", key: "autoScan", value: el.autoScan.checked });
});

el.notifications.addEventListener("change", () => {
  sendToBackground({
    type: "SET_SETTING",
    key: "notifications",
    value: el.notifications.checked,
  });
});

init();
