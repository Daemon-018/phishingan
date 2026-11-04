/* PhishinGAN service worker: loads the bundled model, scans, badges, notifies. */

// Chrome loads this file as a service worker, so pull in the scoring engine.
// Firefox loads both files from manifest background.scripts, where
// importScripts is not available.
if (typeof importScripts === "function") {
  importScripts("lib/phishingan.js");
}

// storage.session is Chrome-only on older browsers; fall back to local.
const sessionStore = (() => {
  try {
    return chrome.storage.session || chrome.storage.local;
  } catch (error) {
    return chrome.storage.local;
  }
})();

const resultKey = (tabId) => `pg_result_${tabId}`;
const notified = new Set();
let modelPromise = null;

async function ensureModel() {
  if (!modelPromise) {
    modelPromise = fetch(chrome.runtime.getURL("model/model.json"))
      .then((response) => {
        if (!response.ok) throw new Error("could not load the bundled model");
        return response.json();
      })
      .then((data) => {
        PhishinGAN.setModel(data);
        return data;
      })
      .catch((error) => {
        modelPromise = null;
        throw error;
      });
  }
  return modelPromise;
}

async function getSettings() {
  return chrome.storage.local.get({ autoScan: true, notifications: true });
}

async function updateBadge(tabId, result) {
  const text =
    result.verdict === "phishing" ? "!" : result.verdict === "suspicious" ? "?" : "";
  const color =
    result.verdict === "phishing"
      ? "#ff5d6c"
      : result.verdict === "suspicious"
        ? "#ffb020"
        : "#3dd68c";
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text });
}

async function handleScan(payload, tabId) {
  await ensureModel();
  const result = PhishinGAN.scanPage(payload);
  result.scannedAt = Date.now();
  result.url = payload.url || "";
  result.title = payload.title || "";

  if (tabId != null) {
    await sessionStore.set({ [resultKey(tabId)]: result });
    await updateBadge(tabId, result);

    const settings = await getSettings();
    if (
      settings.notifications &&
      result.verdict === "phishing" &&
      payload.url &&
      !notified.has(payload.url)
    ) {
      notified.add(payload.url);
      chrome.notifications.create(`pg_${Date.now()}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "PhishinGAN: likely phishing",
        message: `This page looks dangerous (risk ${result.risk_score}/100). Do not enter credentials.`,
        priority: 2,
      });
    }
  }
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === "SCAN_PAGE") {
    const tabId = sender.tab ? sender.tab.id : message.tabId;
    handleScan(message.payload, tabId)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === "GET_RESULT") {
    sessionStore
      .get(resultKey(message.tabId))
      .then((data) => sendResponse(data[resultKey(message.tabId)] || null));
    return true;
  }

  if (message.type === "GET_SETTINGS") {
    getSettings().then(sendResponse);
    return true;
  }

  if (message.type === "SET_SETTING") {
    chrome.storage.local
      .set({ [message.key]: message.value })
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "CLEAR_RESULT") {
    sessionStore.remove(resultKey(message.tabId)).then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  sessionStore.remove(resultKey(tabId));
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ autoScan: true, notifications: true }).then((settings) => {
    chrome.storage.local.set(settings);
  });
});
