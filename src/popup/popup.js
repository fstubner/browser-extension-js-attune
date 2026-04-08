import { getConfig, getOriginPatternFromUrl, isProbablyInjectableUrl } from "../shared/config.js";
import {
  permissionsContains,
  permissionsRemove,
  permissionsRequest,
  runtimeSendMessage,
  scriptingExecuteScript,
  tabsCreate,
  tabsQuery,
  tabsSendMessage
} from "../shared/chromeAsync.js";

function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: ${id}`);
  return el;
}

async function getActiveTab() {
  const [tab] = await tabsQuery({ active: true, currentWindow: true });
  return tab || null;
}

async function hasOriginPermission(pattern) {
  return permissionsContains({ origins: [pattern] });
}

async function requestOriginPermission(pattern) {
  return permissionsRequest({ origins: [pattern] });
}

async function removeOriginPermission(pattern) {
  return permissionsRemove({ origins: [pattern] });
}

async function pingTab(tab) {
  if (!tab?.id || !tab?.url) return null;
  const response = await runtimeSendMessage({ type: "ATTUNE_PING_TAB", tabId: tab.id, url: tab.url });
  return response?.response || null;
}

function setText(el, text) {
  el.textContent = text;
}

function showError(msg) {
  const box = $("siteError");
  setText(box, msg);
  box.hidden = !msg;
}

function showStatus(msg) {
  const box = $("status");
  setText(box, msg);
  box.hidden = !msg;
}

async function refresh() {
  showError("");
  showStatus("");

  const tab = await getActiveTab();
  const config = await getConfig();

  $("globalToggle").checked = Boolean(config.globalEnabled);
  $("vocalToggle").checked = Boolean(config.vocalEnhanced);

  if (!tab?.url || !isProbablyInjectableUrl(tab.url)) {
    setText($("siteHint"), "Not available on this page");
    $("siteToggle").checked = false;
    $("siteToggle").disabled = true;
    return;
  }

  const origin = new URL(tab.url).origin;
  const pattern = getOriginPatternFromUrl(tab.url);
  const enabledForSite = Boolean(pattern && config.enabledOrigins[pattern]);
  const hasPerm = Boolean(pattern && (await hasOriginPermission(pattern)));

  setText($("siteHint"), origin);
  $("siteToggle").disabled = false;
  $("siteToggle").checked = enabledForSite && hasPerm;

  const ping = await pingTab(tab);
  if (enabledForSite && hasPerm) {
    if (ping?.ok) {
      showStatus(
        `Running • ${ping.processors} media element${ping.processors === 1 ? "" : "s"} • AudioContext: ${ping.audioContextState}`
      );
      if (ping.lastError) showError(ping.lastError);
    } else {
      showStatus("Enabled • waiting for media to play");
    }
  }

  // Pro State Rendering
  const isPro = Boolean(config.pro);
  if (isPro) {
    $("upgradeBtn").hidden = true;

    // Unlock Per-site tuning (example feature)
    const perSiteRow = document.querySelector(".card.pro .row:nth-child(2)");
    if (perSiteRow) {
       const badge = perSiteRow.querySelector(".pill.disabled");
       if (badge) {
         badge.textContent = "Unlocked";
         badge.className = "pill";
         badge.style.background = "#10b981";
       }
    }
  } else {
    $("upgradeBtn").hidden = false;
  }
}

async function setGlobalEnabled(value) {
  await runtimeSendMessage({ type: "ATTUNE_SET_GLOBAL_ENABLED", value });

  // Best-effort: notify currently injected tab (if present).
  const tab = await getActiveTab();
  if (tab?.id) {
    try {
      await tabsSendMessage(tab.id, { type: "ATTUNE_SET_ENABLED", enabled: value });
    } catch {
      // ignore
    }
  }
}

async function setSiteEnabled(tab, enabled) {
  if (!tab?.url || !isProbablyInjectableUrl(tab.url)) return;
  const pattern = getOriginPatternFromUrl(tab.url);
  if (!pattern) return;

  if (enabled) {
    const granted = await requestOriginPermission(pattern);
    if (!granted) {
      showError("Permission denied. Attune needs site access to level audio.");
      $("siteToggle").checked = false;
      return;
    }

    await runtimeSendMessage({ type: "ATTUNE_SET_ORIGIN_ENABLED", url: tab.url, enabled: true });

    try {
      await scriptingExecuteScript({ target: { tabId: tab.id }, files: ["src/content/contentScript.js"] });
    } catch {
      // ignore
    }
    return;
  }

  await runtimeSendMessage({ type: "ATTUNE_SET_ORIGIN_ENABLED", url: tab.url, enabled: false });
  await removeOriginPermission(pattern);

  try {
    await tabsSendMessage(tab.id, { type: "ATTUNE_SET_ENABLED", enabled: false });
  } catch {
    // ignore
  }
}

function init() {
  $("globalToggle").addEventListener("change", async (e) => {
    await setGlobalEnabled(Boolean(e.target.checked));
    await refresh();
  });

  $("vocalToggle").addEventListener("change", async (e) => {
    const enabled = Boolean(e.target.checked);

    // Background persists the new value and responds.
    await runtimeSendMessage({ type: "ATTUNE_SET_VOCAL_ENHANCED", enabled });

    // Best-effort: notify the currently active tab so the audio graph updates
    // without waiting for the user to reload the page.
    const tab = await getActiveTab();
    if (tab?.id) {
      try {
        await tabsSendMessage(tab.id, { type: "ATTUNE_SET_VOCAL_ENHANCED", enabled });
      } catch {
        // ignore — tab may not have the content script injected yet
      }
    }
  });

  $("siteToggle").addEventListener("change", async (e) => {
    const tab = await getActiveTab();
    if (!tab) return;
    await setSiteEnabled(tab, Boolean(e.target.checked));
    await refresh();
  });

  $("upgradeBtn").addEventListener("click", async () => {
    await tabsCreate({ url: "https://attune-api.com/checkout" });
  });

  void refresh();
}

init();