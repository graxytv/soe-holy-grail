const { app, BrowserWindow, dialog, ipcMain, screen } = require("electron");
const fs = require("fs");
const path = require("path");
const { startAutoScan, scanSaveFiles, listCharacters, defaultSaveFolder, defaultStashPath } = require("./scanner");
const { checkForUpdate, cleanVersion, installUpdate } = require("./updater");

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const CATALOG_PATH = path.join(DATA_DIR, "d2ItemData.json");
const SOUND_CATALOG_PATH = path.join(DATA_DIR, "soundCatalog.json");
const PACKAGE_PATH = path.join(ROOT_DIR, "package.json");
const OVERLAY_TOAST_HEIGHT = 38;
const OVERLAY_MIN_WIDTH = 220;
const DEFAULT_SOUND_CONFIG = { soundId: "", volume: 0.8 };
const PACKAGE_INFO = readJson(PACKAGE_PATH, {});
const UPDATE_FEED = {
  owner: PACKAGE_INFO.update?.owner || "graxytv",
  repo: PACKAGE_INFO.update?.repo || "soe-holy-grail"
};
const CURRENT_VERSION = cleanVersion(app.getVersion() || PACKAGE_INFO.version || "0.1.0");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let mainWindow = null;
let overlayWindow = null;
let appState = null;
let stopScan = null;
let applyingOverlayBounds = false;
let overlayBoundsTimer = null;
let soundOptionsCache = null;
let updateState = {
  state: "idle",
  available: false,
  currentVersion: CURRENT_VERSION,
  latestVersion: "",
  releaseName: "",
  releaseUrl: "",
  assetName: "",
  assetSize: 0,
  progress: 0,
  checkedAt: "",
  message: `Release feed: ${UPDATE_FEED.owner}/${UPDATE_FEED.repo}`,
  error: ""
};
let updateDetails = null;
let updateBusy = false;

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function statePath() {
  return path.join(app.getPath("userData"), "grail-state.json");
}

function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function clampFloat(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeOverlayConfig(value) {
  const overlay = value && typeof value === "object" ? value : {};
  const size = clampNumber(overlay.size, 64, 240, 104);
  const bounds = overlay.bounds && typeof overlay.bounds === "object"
    ? {
      x: Number.isFinite(Number(overlay.bounds.x)) ? Math.round(Number(overlay.bounds.x)) : null,
      y: Number.isFinite(Number(overlay.bounds.y)) ? Math.round(Number(overlay.bounds.y)) : null
    }
    : null;

  return {
    enabled: Boolean(overlay.enabled),
    size,
    clickThrough: Boolean(overlay.clickThrough),
    bounds: bounds && Number.isInteger(bounds.x) && Number.isInteger(bounds.y) ? bounds : null
  };
}

function soundOptions() {
  if (soundOptionsCache) return soundOptionsCache;
  const catalog = readJson(SOUND_CATALOG_PATH, { sounds: [] });
  soundOptionsCache = Array.isArray(catalog.sounds)
    ? catalog.sounds
      .filter((sound) => sound && typeof sound.id === "string" && typeof sound.label === "string")
      .map((sound) => ({
        id: sound.id,
        label: sound.label,
        group: sound.group || "Sounds",
        kind: sound.kind || "unknown",
        file: sound.file || "",
        url: sound.url || ""
      }))
    : [];
  return soundOptionsCache;
}

function normalizeSoundConfig(value) {
  const sound = value && typeof value === "object" ? value : {};
  const validIds = new Set(soundOptions().map((option) => option.id));
  const soundId = typeof sound.soundId === "string" && validIds.has(sound.soundId) ? sound.soundId : "";
  return {
    soundId,
    volume: clampFloat(sound.volume, 0, 1, DEFAULT_SOUND_CONFIG.volume)
  };
}

function catalogItems() {
  const catalog = readJson(CATALOG_PATH, { items: {} });
  return Object.entries(catalog.items || {})
    .map(([id, item]) => ({
      id,
      name: item.displayName || item.name || id,
      type: item.rare || item.type || "Unknown",
      group: item.group || item.type || "Other",
      code: item.code || "",
      saveId: Number.isInteger(item.saveId) ? item.saveId : null,
      aliasSaveIds: Array.isArray(item.aliasSaveIds) ? item.aliasSaveIds.filter(Number.isInteger) : [],
      setId: Number.isInteger(item.setId) ? item.setId : null,
      stackSize: Number.isInteger(item.stackSize) ? item.stackSize : null,
      tier: Number.isInteger(item.tier) ? item.tier : null,
      reward: item.reward || "",
      dropLocation: item.dropLocation || "",
      image: item.img || ""
    }))
    .filter((item) => ["Unique", "Set", "Rune", "FateCard"].includes(item.type))
    .sort((a, b) => {
      const typeOrder = { Unique: 0, Set: 1, Rune: 2, FateCard: 3 };
      return (typeOrder[a.type] - typeOrder[b.type]) || a.name.localeCompare(b.name);
    });
}

function buildInitialState() {
  const items = catalogItems();
  const saved = readJson(statePath(), { found: {}, recent: [] });
  const rawConfig = readJson(configPath(), { stashPath: "", saveFolder: "", characterPath: "" });
  const migratedStashPath = typeof rawConfig.stashPath === "string"
    ? rawConfig.stashPath
    : typeof rawConfig.saveFolder === "string" && /\.stash$/i.test(rawConfig.saveFolder)
      ? rawConfig.saveFolder
      : "";
  const saveFolder = typeof rawConfig.saveFolder === "string" && !/\.stash$/i.test(rawConfig.saveFolder)
    ? rawConfig.saveFolder
    : "";
  const characterPath = typeof rawConfig.characterPath === "string" ? rawConfig.characterPath : "";
  const overlay = normalizeOverlayConfig(rawConfig.overlay || {
    enabled: rawConfig.overlayEnabled,
    size: rawConfig.overlaySize,
    clickThrough: rawConfig.overlayClickThrough
  });
  const sound = normalizeSoundConfig(rawConfig.sound || {
    soundId: rawConfig.grailSoundId,
    volume: rawConfig.grailSoundVolume
  });
  const characters = listCharacters({ stashPath: migratedStashPath, saveFolder });
  const validItemIds = new Set(items.map((item) => item.id));
  const found = saved.found && typeof saved.found === "object"
    ? Object.fromEntries(Object.entries(saved.found).filter(([itemId]) => validItemIds.has(itemId)))
    : {};
  const recent = Array.isArray(saved.recent)
    ? saved.recent.filter((row) => validItemIds.has(row.id)).slice(0, 20)
    : [];
  return {
    items,
    characters,
    found,
    recent,
    config: {
      stashPath: migratedStashPath,
      saveFolder,
      characterPath,
      defaultSaveFolder: defaultSaveFolder(migratedStashPath),
      defaultStashPath: defaultStashPath(),
      overlay,
      sound
    }
  };
}

function persistState() {
  writeJson(statePath(), {
    found: appState.found,
    recent: appState.recent
  });
}

function persistConfig() {
  writeJson(configPath(), appState.config);
}

function markFound(itemIds, source) {
  const now = new Date().toISOString();
  const added = [];
  for (const itemId of itemIds) {
    if (!appState.items.some((item) => item.id === itemId)) continue;
    if (appState.found[itemId]) continue;
    appState.found[itemId] = { foundAt: now, source };
    added.push(itemId);
  }
  if (added.length > 0) {
    const addedRows = added
      .map((id) => appState.items.find((item) => item.id === id))
      .filter(Boolean)
      .map((item) => ({ id: item.id, name: item.name, type: item.type, foundAt: now, source }));
    appState.recent = [...addedRows, ...appState.recent.filter((row) => !added.includes(row.id))].slice(0, 20);
    persistState();
    broadcastState();
    broadcastGrailAdded(addedRows);
  }
  return added;
}

function syncAutoFound(itemIds, source = "save-scan") {
  const now = new Date().toISOString();
  const scanned = new Set(itemIds.filter((itemId) => appState.items.some((item) => item.id === itemId)));
  const added = [];
  let changed = false;

  for (const itemId of scanned) {
    if (appState.found[itemId]) continue;
    appState.found[itemId] = { foundAt: now, source };
    added.push(itemId);
    changed = true;
  }

  if (changed) {
    const addedRows = added
      .map((id) => appState.items.find((item) => item.id === id))
      .filter(Boolean)
      .map((item) => ({ id: item.id, name: item.name, type: item.type, foundAt: now, source }));
    const currentFound = new Set(Object.keys(appState.found));
    appState.recent = [
      ...addedRows,
      ...appState.recent.filter((row) => currentFound.has(row.id))
    ].slice(0, 20);
    persistState();
    broadcastState();
    broadcastGrailAdded(addedRows);
  }

  return added;
}

function broadcastState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("grail:state", publicState());
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("grail:state", publicState());
  }
}

function broadcastSync(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("grail:sync", payload);
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("grail:sync", payload);
  }
}

function setUpdateState(patch) {
  updateState = {
    ...updateState,
    ...patch
  };
  broadcastState();
}

function broadcastGrailAdded(items) {
  if (!Array.isArray(items) || items.length === 0) return;
  const payload = { items };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("grail:added", payload);
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("grail:added", payload);
  }
}

function publicState() {
  return {
    items: appState.items,
    soundOptions: soundOptions(),
    characters: appState.characters,
    found: appState.found,
    recent: appState.recent,
    update: updateState,
    progress: progressState(),
    config: appState.config
  };
}

function progressState() {
  const total = appState.items.length;
  const found = appState.items.filter((item) => Boolean(appState.found[item.id])).length;
  return {
    total,
    found,
    missing: total - found,
    percent: total ? Math.round((found / total) * 1000) / 10 : 0
  };
}

function refreshCharacters() {
  appState.characters = listCharacters({
    stashPath: appState.config.stashPath,
    saveFolder: appState.config.saveFolder
  });
  if (appState.config.characterPath && !appState.characters.some((character) => character.path === appState.config.characterPath)) {
    appState.config.characterPath = "";
    persistConfig();
  }
}

async function runScan(reason = "manual") {
  broadcastSync({ state: "syncing", message: "Scanning save files...", reason });
  try {
    const result = await scanSaveFiles(appState.items, {
      stashPath: appState.config.stashPath,
      characterPath: appState.config.characterPath,
      saveFolder: appState.config.saveFolder
    });
    const added = syncAutoFound(result.found, "save-scan");
    broadcastSync({
      state: "synced",
      message: added.length > 0 ? `Found ${added.length} new grail item${added.length === 1 ? "" : "s"}.` : "No new grail items found.",
      files: result.files,
      found: result.found.length,
      added: added.length,
      reason
    });
    return { ...result, added };
  } catch (error) {
    broadcastSync({ state: "error", message: error.message || String(error), reason });
    throw error;
  }
}

async function runUpdateCheck(reason = "manual") {
  if (updateBusy) return updateState;
  updateBusy = true;
  setUpdateState({
    state: "checking",
    progress: 0,
    error: "",
    message: "Checking GitHub releases..."
  });
  try {
    const result = await checkForUpdate({
      owner: UPDATE_FEED.owner,
      repo: UPDATE_FEED.repo,
      currentVersion: CURRENT_VERSION
    });
    updateDetails = result;
    setUpdateState({
      state: result.available ? "available" : "current",
      available: result.available,
      currentVersion: result.currentVersion,
      latestVersion: result.latestVersion,
      releaseName: result.releaseName,
      releaseUrl: result.releaseUrl,
      assetName: result.asset?.name || "",
      assetSize: result.asset?.size || 0,
      checkedAt: new Date().toISOString(),
      progress: 0,
      message: result.message,
      error: "",
      reason
    });
  } catch (error) {
    const message = /HTTP 404/.test(error.message || "")
      ? `No release feed found yet for ${UPDATE_FEED.owner}/${UPDATE_FEED.repo}.`
      : error.message || String(error);
    updateDetails = null;
    setUpdateState({
      state: "error",
      available: false,
      checkedAt: new Date().toISOString(),
      progress: 0,
      message,
      error: message,
      reason
    });
  } finally {
    updateBusy = false;
  }
  return updateState;
}

async function runUpdateInstall() {
  if (updateBusy) return updateState;
  if (!updateDetails?.available) await runUpdateCheck("install");
  if (!updateDetails?.available) return updateState;

  updateBusy = true;
  setUpdateState({
    state: "downloading",
    available: true,
    progress: 0,
    error: "",
    message: `Downloading ${updateDetails.asset.name}...`
  });

  try {
    const runtimeDir = path.dirname(process.execPath);
    const exeName = path.basename(process.execPath);
    await installUpdate({
      update: updateDetails,
      tempDir: path.join(app.getPath("temp"), "soe-holy-grail-update"),
      runtimeDir,
      exeName,
      currentPid: process.pid,
      onProgress: (progress) => {
        setUpdateState({
          state: progress >= 90 ? "installing" : "downloading",
          progress,
          message: progress >= 90 ? "Preparing to restart and install..." : `Downloading update... ${progress}%`
        });
      }
    });
    setUpdateState({
      state: "installing",
      progress: 100,
      message: "Restarting to finish the update..."
    });
    setTimeout(() => app.quit(), 400);
  } catch (error) {
    const message = error.message || String(error);
    setUpdateState({
      state: "error",
      progress: 0,
      message,
      error: message
    });
    updateBusy = false;
  }

  return updateState;
}

function restartAutoScan() {
  if (stopScan) {
    stopScan();
    stopScan = null;
  }
  stopScan = startAutoScan(appState.items, {
    stashPath: appState.config.stashPath,
    characterPath: appState.config.characterPath,
    saveFolder: appState.config.saveFolder,
    onStatus: broadcastSync,
    onFound: (ids) => syncAutoFound(ids, "save-scan")
  });
}

function defaultOverlayBounds(size) {
  const { workArea } = screen.getPrimaryDisplay();
  const dimensions = overlayWindowDimensions(size);
  return {
    x: workArea.x + workArea.width - dimensions.width - 32,
    y: workArea.y + 32,
    ...dimensions
  };
}

function currentOverlayBounds(size) {
  const saved = appState.config.overlay.bounds;
  const dimensions = overlayWindowDimensions(size);
  if (!saved) return defaultOverlayBounds(size);
  return {
    x: saved.x,
    y: saved.y,
    ...dimensions
  };
}

function overlayWindowDimensions(size) {
  return {
    width: Math.max(OVERLAY_MIN_WIDTH, size),
    height: size + OVERLAY_TOAST_HEIGHT
  };
}

function circleSizeFromWindowBounds(bounds, fallback) {
  return clampNumber(Math.min(bounds.width, bounds.height - OVERLAY_TOAST_HEIGHT), 64, 240, fallback);
}

function rememberOverlayBoundsSoon() {
  if (!overlayWindow || overlayWindow.isDestroyed() || applyingOverlayBounds) return;
  clearTimeout(overlayBoundsTimer);
  overlayBoundsTimer = setTimeout(() => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    const bounds = overlayWindow.getBounds();
    const size = circleSizeFromWindowBounds(bounds, appState.config.overlay.size);
    appState.config.overlay = normalizeOverlayConfig({
      ...appState.config.overlay,
      size,
      bounds: { x: bounds.x, y: bounds.y }
    });
    persistConfig();
    broadcastState();
  }, 180);
}

function applyOverlayConfig() {
  const overlay = normalizeOverlayConfig(appState.config.overlay);
  appState.config.overlay = overlay;

  if (!overlay.enabled) {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
    overlayWindow = null;
    return;
  }

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = new BrowserWindow({
      ...currentOverlayBounds(overlay.size),
      minWidth: OVERLAY_MIN_WIDTH,
      minHeight: 64 + OVERLAY_TOAST_HEIGHT,
      frame: false,
      transparent: true,
      resizable: true,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      backgroundColor: "#00000000",
      title: "SoE Grail Overlay",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    overlayWindow.setMenuBarVisibility(false);
    overlayWindow.setAlwaysOnTop(true, "screen-saver");
    if (typeof overlayWindow.setVisibleOnAllWorkspaces === "function") {
      overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    overlayWindow.loadFile(path.join(__dirname, "overlay.html"));
    overlayWindow.once("ready-to-show", () => {
      if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.showInactive();
    });
    overlayWindow.on("move", rememberOverlayBoundsSoon);
    overlayWindow.on("resize", () => {
      if (!overlayWindow || overlayWindow.isDestroyed() || applyingOverlayBounds) return;
      const [width, height] = overlayWindow.getSize();
      const size = circleSizeFromWindowBounds({ width, height }, overlay.size);
      applyingOverlayBounds = true;
      const dimensions = overlayWindowDimensions(size);
      overlayWindow.setSize(dimensions.width, dimensions.height);
      applyingOverlayBounds = false;
      rememberOverlayBoundsSoon();
    });
    overlayWindow.on("closed", () => {
      overlayWindow = null;
    });
  }

  applyingOverlayBounds = true;
  overlayWindow.setBounds(currentOverlayBounds(overlay.size));
  overlayWindow.setIgnoreMouseEvents(overlay.clickThrough, { forward: true });
  applyingOverlayBounds = false;
  if (!overlayWindow.isVisible()) overlayWindow.showInactive();
  broadcastState();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#070303",
    title: "SoE Holy Grail",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
  });
}

app.whenReady().then(() => {
  appState = buildInitialState();
  persistState();
  createWindow();
  applyOverlayConfig();
  restartAutoScan();
  setTimeout(() => {
    runUpdateCheck("startup").catch(() => {});
  }, 1800);

  ipcMain.handle("grail:getInitialData", () => publicState());
  ipcMain.handle("grail:toggleItem", (_event, itemId, found) => {
    if (!appState.items.some((item) => item.id === itemId)) return publicState();
    if (found) {
      markFound([itemId], "manual");
    } else {
      delete appState.found[itemId];
      appState.recent = appState.recent.filter((row) => row.id !== itemId);
      persistState();
      broadcastState();
    }
    return publicState();
  });
  ipcMain.handle("grail:scanNow", () => runScan("manual"));
  ipcMain.handle("grail:chooseStashFile", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose Sanctuary of Exile shared stash",
      defaultPath: appState.config.stashPath || appState.config.defaultStashPath,
      properties: ["openFile"],
      filters: [
        { name: "PD2 shared stash", extensions: ["stash"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    if (!result.canceled && result.filePaths[0]) {
      appState.config.stashPath = result.filePaths[0];
      if (!appState.config.saveFolder) appState.config.defaultSaveFolder = defaultSaveFolder(appState.config.stashPath);
      persistConfig();
      refreshCharacters();
      restartAutoScan();
      broadcastState();
      runScan("stash-selected").catch(() => {});
    }
    return publicState();
  });
  ipcMain.handle("grail:clearStashFile", () => {
    appState.config.stashPath = "";
    appState.config.defaultSaveFolder = defaultSaveFolder();
    persistConfig();
    refreshCharacters();
    restartAutoScan();
    broadcastState();
    return publicState();
  });
  ipcMain.handle("grail:refreshCharacters", () => {
    refreshCharacters();
    broadcastState();
    return publicState();
  });
  ipcMain.handle("grail:selectCharacter", (_event, characterPath) => {
    const selected = String(characterPath || "").trim();
    if (selected && appState.characters.some((character) => character.path === selected)) {
      appState.config.characterPath = selected;
    } else {
      appState.config.characterPath = "";
    }
    persistConfig();
    restartAutoScan();
    broadcastState();
    runScan("character-selected").catch(() => {});
    return publicState();
  });
  ipcMain.handle("grail:chooseSaveFolder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose Diablo II save folder",
      defaultPath: appState.config.saveFolder || defaultSaveFolder(appState.config.stashPath),
      properties: ["openDirectory"]
    });
    if (!result.canceled && result.filePaths[0]) {
      appState.config.saveFolder = result.filePaths[0];
      appState.config.defaultSaveFolder = defaultSaveFolder(appState.config.stashPath);
      persistConfig();
      refreshCharacters();
      restartAutoScan();
      broadcastState();
      runScan("save-folder-selected").catch(() => {});
    }
    return publicState();
  });
  ipcMain.handle("grail:clearSaveFolder", () => {
    appState.config.saveFolder = "";
    appState.config.defaultSaveFolder = defaultSaveFolder(appState.config.stashPath);
    persistConfig();
    refreshCharacters();
    restartAutoScan();
    broadcastState();
    return publicState();
  });
  ipcMain.handle("grail:setOverlayConfig", (_event, patch) => {
    const nextOverlay = patch && typeof patch === "object" ? patch : {};
    appState.config.overlay = normalizeOverlayConfig({
      ...appState.config.overlay,
      ...nextOverlay
    });
    persistConfig();
    applyOverlayConfig();
    broadcastState();
    return publicState();
  });
  ipcMain.handle("grail:setSoundConfig", (_event, patch) => {
    const nextSound = patch && typeof patch === "object" ? patch : {};
    appState.config.sound = normalizeSoundConfig({
      ...appState.config.sound,
      ...nextSound
    });
    persistConfig();
    broadcastState();
    return publicState();
  });
  ipcMain.handle("grail:checkForUpdates", () => runUpdateCheck("manual"));
  ipcMain.handle("grail:installUpdate", () => runUpdateInstall());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  clearTimeout(overlayBoundsTimer);
  if (stopScan) stopScan();
  if (process.platform !== "darwin") app.quit();
});
