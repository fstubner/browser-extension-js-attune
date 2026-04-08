function hasThen(value) {
  return Boolean(value && typeof value.then === "function");
}

function lastErrorToError() {
  const err = chrome?.runtime?.lastError;
  if (!err) return null;
  return new Error(err.message || String(err));
}

function promisify(callWithCallback) {
  return new Promise((resolve, reject) => {
    callWithCallback((result) => {
      const err = lastErrorToError();
      if (err) reject(err);
      else resolve(result);
    });
  });
}

export function storageSyncGet(keys) {
  try {
    const maybe = chrome.storage.sync.get(keys);
    if (hasThen(maybe)) return maybe;
  } catch {
    // fall back to callback form
  }
  return promisify((cb) => chrome.storage.sync.get(keys, cb));
}

export function storageSyncSet(items) {
  try {
    const maybe = chrome.storage.sync.set(items);
    if (hasThen(maybe)) return maybe;
  } catch {
    // fall back to callback form
  }
  return promisify((cb) => chrome.storage.sync.set(items, cb));
}

export function tabsQuery(queryInfo) {
  try {
    const maybe = chrome.tabs.query(queryInfo);
    if (hasThen(maybe)) return maybe;
  } catch {
    // fall back
  }
  return promisify((cb) => chrome.tabs.query(queryInfo, cb));
}

export function tabsGet(tabId) {
  try {
    const maybe = chrome.tabs.get(tabId);
    if (hasThen(maybe)) return maybe;
  } catch {
    // fall back
  }
  return promisify((cb) => chrome.tabs.get(tabId, cb));
}

export function tabsCreate(createProperties) {
  try {
    const maybe = chrome.tabs.create(createProperties);
    if (hasThen(maybe)) return maybe;
  } catch {
    // fall back
  }
  return promisify((cb) => chrome.tabs.create(createProperties, cb));
}

export function tabsSendMessage(tabId, message) {
  try {
    const maybe = chrome.tabs.sendMessage(tabId, message);
    if (hasThen(maybe)) return maybe;
  } catch {
    // fall back
  }
  return promisify((cb) => chrome.tabs.sendMessage(tabId, message, cb));
}

export function scriptingExecuteScript(details) {
  try {
    const maybe = chrome.scripting.executeScript(details);
    if (hasThen(maybe)) return maybe;
  } catch {
    // fall back
  }
  return promisify((cb) => chrome.scripting.executeScript(details, cb));
}

export function permissionsContains(details) {
  try {
    const maybe = chrome.permissions.contains(details);
    if (hasThen(maybe)) return maybe;
  } catch {
    // fall back
  }
  return promisify((cb) => chrome.permissions.contains(details, cb));
}

export function permissionsRequest(details) {
  try {
    const maybe = chrome.permissions.request(details);
    if (hasThen(maybe)) return maybe;
  } catch {
    // fall back
  }
  return promisify((cb) => chrome.permissions.request(details, cb));
}

export function permissionsRemove(details) {
  try {
    const maybe = chrome.permissions.remove(details);
    if (hasThen(maybe)) return maybe;
  } catch {
    // fall back
  }
  return promisify((cb) => chrome.permissions.remove(details, cb));
}

export function runtimeSendMessage(message) {
  try {
    const maybe = chrome.runtime.sendMessage(message);
    if (hasThen(maybe)) return maybe;
  } catch {
    // fall back
  }
  return promisify((cb) => chrome.runtime.sendMessage(message, cb));
}