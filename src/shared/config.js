import { storageSyncGet, storageSyncSet } from "./chromeAsync.js";

const DEFAULT_CONFIG = Object.freeze({
  globalEnabled: true,
  vocalEnhanced: false,
  pro: false,
  licenseKey: null,
  enabledOrigins: {}
});

export async function getConfig() {
  const stored = await storageSyncGet(["attuneConfig"]);
  const config = stored?.attuneConfig && typeof stored.attuneConfig === "object" ? stored.attuneConfig : {};

  return {
    globalEnabled: typeof config.globalEnabled === "boolean" ? config.globalEnabled : DEFAULT_CONFIG.globalEnabled,
    vocalEnhanced: typeof config.vocalEnhanced === "boolean" ? config.vocalEnhanced : DEFAULT_CONFIG.vocalEnhanced,
    pro: typeof config.pro === "boolean" ? config.pro : DEFAULT_CONFIG.pro,
    licenseKey: typeof config.licenseKey === "string" ? config.licenseKey : DEFAULT_CONFIG.licenseKey,
    enabledOrigins: config.enabledOrigins && typeof config.enabledOrigins === "object" ? config.enabledOrigins : {}
  };
}

export async function setOriginEnabled(pattern, enabled) {
  const config = await getConfig();
  const enabledOrigins = { ...config.enabledOrigins };
  if (enabled) enabledOrigins[pattern] = true;
  else delete enabledOrigins[pattern];
  await storageSyncSet({ attuneConfig: { ...config, enabledOrigins } });
}

export function isProbablyInjectableUrl(url) {
  if (!url || typeof url !== "string") return false;
  return url.startsWith("http://") || url.startsWith("https://");
}

export function getOriginPatternFromUrl(url) {
  if (!isProbablyInjectableUrl(url)) return null;
  try {
    const origin = new URL(url).origin;
    return `${origin}/*`;
  } catch {
    return null;
  }
}