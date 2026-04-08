import { scriptingExecuteScript, storageSyncSet, tabsGet, tabsSendMessage } from "./shared/chromeAsync.js";
import { getConfig, getOriginPatternFromUrl, isProbablyInjectableUrl, setOriginEnabled } from "./shared/config.js";

const CONTENT_SCRIPT_FILE = "src/content/contentScript.js";

async function ensureInjectedIfEnabled(tabId, url) {
  if (!isProbablyInjectableUrl(url)) return;

  const config = await getConfig();
  if (!config.globalEnabled) return;

  const pattern = getOriginPatternFromUrl(url);
  if (!pattern) return;
  if (!config.enabledOrigins[pattern]) return;

  try {
    await scriptingExecuteScript({
      target: { tabId, allFrames: false },
      files: [CONTENT_SCRIPT_FILE]
    });
  } catch {
    // If we don't have permission (or tab isn't ready), injection will fail.
    // Popup flow can request permission and retry explicitly.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  // No-op for now (keep install lightweight; no network calls).
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  void ensureInjectedIfEnabled(tabId, tab?.url);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await tabsGet(tabId);
    void ensureInjectedIfEnabled(tabId, tab?.url);
  } catch {
    // ignore
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    if (!message || typeof message !== "object") return;

    if (message.type === "ATTUNE_GET_CONFIG") {
      sendResponse(await getConfig());
      return;
    }

    if (message.type === "ATTUNE_SET_GLOBAL_ENABLED") {
      const config = await getConfig();
      const next = { ...config, globalEnabled: Boolean(message.value) };
      await storageSyncSet({ attuneConfig: next });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "ATTUNE_SET_VOCAL_ENHANCED") {
      const config = await getConfig();
      const next = { ...config, vocalEnhanced: Boolean(message.enabled) };
      await storageSyncSet({ attuneConfig: next });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "ATTUNE_SET_ORIGIN_ENABLED") {
      const url = message.url;
      const enabled = Boolean(message.enabled);
      if (!isProbablyInjectableUrl(url)) {
        sendResponse({ ok: false, error: "not_injectable_url" });
        return;
      }

      const pattern = getOriginPatternFromUrl(url);
      if (!pattern) {
        sendResponse({ ok: false, error: "no_origin" });
        return;
      }

      if (enabled) {
        // Permission must be requested from the popup (user gesture), so we only
        // persist the intent here. The popup will request permission and call us.
        await setOriginEnabled(pattern, true);
        try {
          if (sender?.tab?.id) await ensureInjectedIfEnabled(sender.tab.id, url);
        } catch {
          // ignore
        }
        sendResponse({ ok: true, pattern });
        return;
      }

      await setOriginEnabled(pattern, false);
      sendResponse({ ok: true, pattern });
      return;
    }

    if (message.type === "ATTUNE_PING_TAB") {
      const tabId = message.tabId;
      const url = message.url;
      if (typeof tabId !== "number" || !isProbablyInjectableUrl(url)) {
        sendResponse({ ok: false });
        return;
      }
      try {
        const response = await tabsSendMessage(tabId, { type: "ATTUNE_PING" });
        sendResponse({ ok: true, response });
      } catch {
        sendResponse({ ok: true, response: null });
      }
      return;
    }
  })();
  // Return true to keep the message channel open until the async sendResponse
  // call above completes. Without this Chrome closes the port synchronously
  // and the response never reaches the caller.
  return true;
});

// External Connection for Payment / Activation Flow
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  // Exact-match the hostname to prevent subdomain or path spoofing
  // (e.g. evil-attune-api.com or evil.com?x=attune-api.com would pass an .includes() check)
  if (!sender.url) return;
  try {
    const { hostname, protocol } = new URL(sender.url);
    if (protocol !== "https:" || hostname !== "attune-api.com") return;
  } catch {
    return;
  }

  if (message?.type === "ATTUNE_ACTIVATE_PRO") {
    const key = message.licenseKey;
    if (key && typeof key === "string" && key.length > 10) {
       getConfig().then(async (currentConfig) => {
           const next = { ...currentConfig, pro: true, licenseKey: key };
           await storageSyncSet({ attuneConfig: next });
           sendResponse({ success: true });
       });
       return true; // Keep channel open for async response
    }
    sendResponse({ success: false, error: "invalid_key_format" });
  }
});