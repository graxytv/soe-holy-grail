const state = {
  items: [],
  soundOptions: [],
  characters: [],
  found: {},
  recent: [],
  update: { state: "idle", available: false, currentVersion: "0.1.3", latestVersion: "", message: "Update status unavailable." },
  config: {
    stashPath: "",
    saveFolder: "",
    characterPath: "",
    playerSync: { enabled: false, intervalSeconds: 10 },
    overlay: { enabled: false, size: 104, clickThrough: false },
    sound: { soundId: "", volume: 0.8 }
  },
  filter: "all",
  search: ""
};

let soundDraft = { soundId: "", volume: 80 };
let soundDraftDirty = false;
let currentSound = null;

const el = {
  itemGrid: document.getElementById("itemGrid"),
  search: document.getElementById("search"),
  filterButtons: [...document.querySelectorAll("[data-filter]")],
  percent: document.getElementById("percent"),
  totalFound: document.getElementById("totalFound"),
  totalMissing: document.getElementById("totalMissing"),
  uniqueProgress: document.getElementById("uniqueProgress"),
  setProgress: document.getElementById("setProgress"),
  runeProgress: document.getElementById("runeProgress"),
  fateProgress: document.getElementById("fateProgress"),
  recentList: document.getElementById("recentList"),
  syncDot: document.getElementById("syncDot"),
  syncText: document.getElementById("syncText"),
  syncMeta: document.getElementById("syncMeta"),
  stashPath: document.getElementById("stashPath"),
  activeCharacterPath: document.getElementById("activeCharacterPath"),
  settingsStashPath: document.getElementById("settingsStashPath"),
  settingsSaveFolder: document.getElementById("settingsSaveFolder"),
  characterSaveFolder: document.getElementById("characterSaveFolder"),
  characterList: document.getElementById("characterList"),
  scanNow: document.getElementById("scanNow"),
  syncPlayer: document.getElementById("syncPlayer"),
  chooseStash: document.getElementById("chooseStash"),
  clearStash: document.getElementById("clearStash"),
  settingsChooseStash: document.getElementById("settingsChooseStash"),
  settingsClearStash: document.getElementById("settingsClearStash"),
  refreshCharacters: document.getElementById("refreshCharacters"),
  chooseSaveFolder: document.getElementById("chooseSaveFolder"),
  clearCharacter: document.getElementById("clearCharacter"),
  settingsChooseSaveFolder: document.getElementById("settingsChooseSaveFolder"),
  settingsClearSaveFolder: document.getElementById("settingsClearSaveFolder"),
  settingsPlayerSyncEnabled: document.getElementById("settingsPlayerSyncEnabled"),
  settingsPlayerSyncInterval: document.getElementById("settingsPlayerSyncInterval"),
  settingsPlayerSyncIntervalValue: document.getElementById("settingsPlayerSyncIntervalValue"),
  settingsPlayerSyncStatus: document.getElementById("settingsPlayerSyncStatus"),
  settingsOverlayEnabled: document.getElementById("settingsOverlayEnabled"),
  settingsOverlayClickThrough: document.getElementById("settingsOverlayClickThrough"),
  settingsOverlaySize: document.getElementById("settingsOverlaySize"),
  settingsOverlaySizeValue: document.getElementById("settingsOverlaySizeValue"),
  settingsOverlayStatus: document.getElementById("settingsOverlayStatus"),
  settingsSoundSelect: document.getElementById("settingsSoundSelect"),
  settingsSoundVolume: document.getElementById("settingsSoundVolume"),
  settingsSoundVolumeValue: document.getElementById("settingsSoundVolumeValue"),
  settingsSoundTest: document.getElementById("settingsSoundTest"),
  settingsSoundSave: document.getElementById("settingsSoundSave"),
  settingsSoundStatus: document.getElementById("settingsSoundStatus"),
  updateNavButton: document.getElementById("updateNavButton"),
  settingsUpdateStatus: document.getElementById("settingsUpdateStatus"),
  settingsCurrentVersion: document.getElementById("settingsCurrentVersion"),
  settingsLatestVersion: document.getElementById("settingsLatestVersion"),
  settingsUpdateAsset: document.getElementById("settingsUpdateAsset"),
  settingsUpdateCheck: document.getElementById("settingsUpdateCheck"),
  settingsUpdateInstall: document.getElementById("settingsUpdateInstall"),
  settingsResetStatus: document.getElementById("settingsResetStatus"),
  settingsResetGrail: document.getElementById("settingsResetGrail"),
  viewButtons: [...document.querySelectorAll("[data-view]")],
  grailView: document.getElementById("grailView"),
  charactersView: document.getElementById("charactersView"),
  settingsView: document.getElementById("settingsView")
};

function mergeState(next) {
  state.items = next.items || [];
  state.soundOptions = next.soundOptions || [];
  state.characters = next.characters || [];
  state.found = next.found || {};
  state.recent = next.recent || [];
  state.update = next.update || state.update;
  state.config = next.config || {
    stashPath: "",
    saveFolder: "",
    characterPath: "",
    playerSync: { enabled: false, intervalSeconds: 10 },
    overlay: { enabled: false, size: 104, clickThrough: false },
    sound: { soundId: "", volume: 0.8 }
  };
  state.config.playerSync = {
    enabled: Boolean(state.config.playerSync?.enabled),
    intervalSeconds: Math.min(60, Math.max(3, Number(state.config.playerSync?.intervalSeconds) || 10))
  };
  state.config.overlay = {
    enabled: Boolean(state.config.overlay?.enabled),
    size: Math.min(240, Math.max(64, Number(state.config.overlay?.size) || 104)),
    clickThrough: Boolean(state.config.overlay?.clickThrough),
    bounds: state.config.overlay?.bounds || null
  };
  state.config.sound = normalizeSoundConfig(state.config.sound);
  if (!soundDraftDirty) {
    soundDraft = {
      soundId: state.config.sound.soundId,
      volume: Math.round(state.config.sound.volume * 100)
    };
  }
  render();
}

function isFound(itemId) {
  return Boolean(state.found[itemId]);
}

function itemCounts(type) {
  const items = state.items.filter((item) => item.type === type);
  const found = items.filter((item) => isFound(item.id)).length;
  return { found, total: items.length };
}

function typeLabel(type) {
  return type === "FateCard" ? "Fate Card" : type;
}

function typeClass(type) {
  return String(type || "Unknown").replace(/[^a-z0-9_-]/gi, "");
}

function itemDetail(item) {
  const bits = [];
  if (item.code) bits.push(item.code);
  if (item.type === "FateCard" && item.stackSize) bits.push(`${item.stackSize}x`);
  return bits.join(" ");
}

function normalizeSoundConfig(value) {
  const sound = value && typeof value === "object" ? value : {};
  const soundId = typeof sound.soundId === "string" ? sound.soundId : "";
  const volume = Number.isFinite(Number(sound.volume)) ? Number(sound.volume) : 0.8;
  return {
    soundId,
    volume: Math.min(1, Math.max(0, volume))
  };
}

function soundOptionById(soundId) {
  return state.soundOptions.find((option) => option.id === soundId) || null;
}

function soundUrl(option) {
  if (!option) return "";
  if (option.kind === "builtin" && option.file) return `../assets/sounds/${encodeURIComponent(option.file)}`;
  return option.url || "";
}

async function playSoundOption(option, volume) {
  const url = soundUrl(option);
  if (!url) throw new Error("No sound selected.");
  if (currentSound) {
    currentSound.pause();
    currentSound.currentTime = 0;
  }
  currentSound = new Audio(url);
  currentSound.volume = Math.min(1, Math.max(0, Number(volume) || 0));
  await currentSound.play();
}

function playConfiguredSound() {
  const sound = normalizeSoundConfig(state.config.sound);
  if (!sound.soundId || sound.volume <= 0) return;
  const option = soundOptionById(sound.soundId);
  if (!option) return;
  playSoundOption(option, sound.volume).catch(() => {});
}

function renderProgress() {
  const total = state.items.length;
  const found = state.items.filter((item) => isFound(item.id)).length;
  const missing = total - found;
  const percent = total ? Math.round((found / total) * 1000) / 10 : 0;

  el.percent.textContent = `${percent}%`;
  el.totalFound.textContent = found;
  el.totalMissing.textContent = missing;

  const unique = itemCounts("Unique");
  const set = itemCounts("Set");
  const rune = itemCounts("Rune");
  const fate = itemCounts("FateCard");
  el.uniqueProgress.textContent = `${unique.found}/${unique.total}`;
  el.setProgress.textContent = `${set.found}/${set.total}`;
  el.runeProgress.textContent = `${rune.found}/${rune.total}`;
  el.fateProgress.textContent = `${fate.found}/${fate.total}`;
}

function renderRecent() {
  if (!state.recent.length) {
    el.recentList.innerHTML = `<div class="sync-meta">Recent auto or manual finds will appear here.</div>`;
    return;
  }

  el.recentList.innerHTML = state.recent.slice(0, 20).map((row) => {
    const item = state.items.find((candidate) => candidate.id === row.id) || row;
    const when = row.foundAt ? new Date(row.foundAt).toLocaleString() : "";
    return `
      <div class="recent-item quality-${typeClass(item.type)}">
        <span title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        <small>${escapeHtml(when)}</small>
      </div>
    `;
  }).join("");
}

function activeCharacter() {
  return state.characters.find((character) => character.path === state.config.characterPath) || null;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function activeSaveFolder() {
  if (state.config.saveFolder) return state.config.saveFolder;
  if (state.config.stashPath) {
    const match = state.config.stashPath.match(/^(.*)[\\/][^\\/]+$/);
    if (match) return match[1];
  }
  return state.config.defaultSaveFolder || "C:\\Program Files (x86)\\Diablo II\\Save";
}

function renderCharacters() {
  const active = activeCharacter();
  const folder = activeSaveFolder();
  el.characterSaveFolder.textContent = `Save folder: ${folder}`;
  el.settingsSaveFolder.textContent = state.config.saveFolder ? `Selected save folder: ${folder}` : `Default save folder: ${folder}`;

  if (!state.characters.length) {
    el.characterList.innerHTML = `<div class="empty-state">No character files found in the current save folder.</div>`;
    return;
  }

  el.characterList.innerHTML = state.characters.map((character) => {
    const selected = active && active.path === character.path;
    const classKey = String(character.classKey || "unknown").replace(/[^a-z0-9-]/gi, "");
    const portraitSrc = `../assets/classes/${classKey}.png`;
    return `
      <button class="character-card ${selected ? "active" : ""} class-${escapeHtml(character.classKey)}" type="button" data-character-path="${escapeHtml(character.path)}">
        <span class="class-portrait" aria-hidden="true">
          <img src="${escapeHtml(portraitSrc)}" alt="" />
        </span>
        <span class="character-main">
          <strong>${escapeHtml(character.name)}</strong>
          <small>${escapeHtml(character.className)} / Level ${escapeHtml(character.level)}</small>
        </span>
        <span class="character-meta">
          <span>${selected ? "Active" : "Select"}</span>
          <small>${escapeHtml(formatDate(character.modifiedAt))}</small>
        </span>
      </button>
    `;
  }).join("");
}

function visibleItems() {
  const query = state.search.trim().toLowerCase();
  return state.items.filter((item) => {
    if (state.filter === "found" && !isFound(item.id)) return false;
    if (state.filter === "missing" && isFound(item.id)) return false;
    if (["Unique", "Set", "Rune", "FateCard"].includes(state.filter) && item.type !== state.filter) return false;
    if (!query) return true;
    return `${item.name} ${item.code} ${item.group} ${item.reward} ${item.dropLocation}`.toLowerCase().includes(query);
  });
}

function renderItems() {
  const rows = visibleItems();
  if (!rows.length) {
    el.itemGrid.innerHTML = `<div class="empty-state">No grail items match the current filter.</div>`;
    return;
  }

  el.itemGrid.innerHTML = rows.map((item) => `
    <button class="item-row ${isFound(item.id) ? "found" : ""} quality-${typeClass(item.type)}" type="button" data-item-id="${escapeHtml(item.id)}" title="${escapeHtml(item.name)}">
      <span class="check">${isFound(item.id) ? "X" : ""}</span>
      <span class="item-name">${escapeHtml(item.name)} <span class="item-code">${escapeHtml(itemDetail(item))}</span></span>
      <span class="item-type">${escapeHtml(typeLabel(item.type))}</span>
    </button>
  `).join("");
}

function renderFolder() {
  const activePath = state.config.stashPath || state.config.defaultStashPath || "C:\\Program Files (x86)\\Diablo II\\Save\\pd2_shared.stash";
  const label = state.config.stashPath ? `Selected stash: ${activePath}` : `Default stash: ${activePath}`;
  const character = activeCharacter();
  el.stashPath.textContent = label;
  el.settingsStashPath.textContent = label;
  el.activeCharacterPath.textContent = character
    ? `Active character: ${character.name} (${character.className})`
    : "Active character: none";
  el.syncPlayer.disabled = !character;
}

function renderPlayerSyncSettings() {
  const playerSync = state.config.playerSync || { enabled: false, intervalSeconds: 10 };
  const interval = Math.min(60, Math.max(3, Number(playerSync.intervalSeconds) || 10));
  const hasCharacter = Boolean(activeCharacter());
  el.settingsPlayerSyncEnabled.checked = Boolean(playerSync.enabled);
  el.settingsPlayerSyncInterval.value = interval;
  el.settingsPlayerSyncInterval.disabled = !playerSync.enabled;
  el.settingsPlayerSyncIntervalValue.textContent = `${interval}s`;
  el.settingsPlayerSyncStatus.textContent = playerSync.enabled
    ? hasCharacter
      ? `Auto-syncing active player every ${interval} seconds.`
      : `Auto-sync enabled; select an active character.`
    : "Manual player sync only.";
}

function renderOverlaySettings() {
  const overlay = state.config.overlay || { enabled: false, size: 104, clickThrough: false };
  el.settingsOverlayEnabled.checked = overlay.enabled;
  el.settingsOverlayClickThrough.checked = overlay.clickThrough;
  el.settingsOverlaySize.value = overlay.size;
  el.settingsOverlaySizeValue.textContent = `${overlay.size}px`;
  el.settingsOverlayStatus.textContent = overlay.enabled
    ? `Overlay active at ${overlay.size}px${overlay.clickThrough ? " / click-through locked" : ""}.`
    : "Overlay disabled.";
}

function renderSoundSettings() {
  const selected = soundOptionById(soundDraft.soundId);
  const groups = new Map();
  for (const option of state.soundOptions) {
    const group = option.group || "Sounds";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(option);
  }

  el.settingsSoundSelect.innerHTML = [
    `<option value="">No sound</option>`,
    ...[...groups.entries()].map(([group, options]) => `
      <optgroup label="${escapeHtml(group)}">
        ${options.map((option) => `<option value="${escapeHtml(option.id)}">${escapeHtml(option.label)}</option>`).join("")}
      </optgroup>
    `)
  ].join("");
  el.settingsSoundSelect.value = soundDraft.soundId;
  el.settingsSoundVolume.value = soundDraft.volume;
  el.settingsSoundVolumeValue.textContent = `${soundDraft.volume}%`;
  el.settingsSoundTest.disabled = !selected;
  const saved = state.config.sound || { soundId: "", volume: 0.8 };
  const isDirty = soundDraftDirty
    || saved.soundId !== soundDraft.soundId
    || Math.round((Number(saved.volume) || 0) * 100) !== soundDraft.volume;
  el.settingsSoundSave.disabled = !isDirty;
  el.settingsSoundStatus.textContent = selected
    ? `${selected.label}${isDirty ? " / unsaved" : " / saved"}`
    : `No grail sound${isDirty ? " / unsaved" : ""}.`;
}

function renderUpdateSettings() {
  const update = state.update || {};
  const busy = update.state === "checking" || update.state === "downloading" || update.state === "installing";
  const available = Boolean(update.available);
  const latest = update.latestVersion ? `v${update.latestVersion}` : "Not checked";
  const progress = Number.isFinite(Number(update.progress)) && Number(update.progress) > 0
    ? ` (${Math.round(Number(update.progress))}%)`
    : "";

  el.updateNavButton.classList.toggle("hidden", !available || busy);
  el.updateNavButton.textContent = update.latestVersion ? `Update v${update.latestVersion}` : "Update";
  el.settingsUpdateStatus.textContent = `${update.message || "Ready to check for updates."}${progress}`;
  el.settingsCurrentVersion.textContent = `Current: v${update.currentVersion || "0.1.3"}`;
  el.settingsLatestVersion.textContent = `Latest: ${latest}`;
  el.settingsUpdateAsset.textContent = update.assetName ? `Asset: ${update.assetName}` : "Asset: none";
  el.settingsUpdateCheck.disabled = busy;
  el.settingsUpdateInstall.disabled = !available || busy;
  el.settingsUpdateInstall.textContent = update.state === "downloading"
    ? "Downloading..."
    : update.state === "installing"
      ? "Installing..."
      : "Install Update";
}

function renderResetSettings() {
  const count = Object.keys(state.found || {}).length;
  el.settingsResetStatus.textContent = count === 0
    ? "No grail progress is currently saved."
    : `${count} found item${count === 1 ? "" : "s"} currently saved.`;
}

function render() {
  renderProgress();
  renderRecent();
  renderItems();
  renderCharacters();
  renderFolder();
  renderPlayerSyncSettings();
  renderOverlaySettings();
  renderSoundSettings();
  renderUpdateSettings();
  renderResetSettings();
}

function setSync(payload) {
  el.syncDot.className = `sync-dot ${payload.state || "idle"}`;
  el.syncText.textContent = payload.message || "Save scan status updated.";
  const files = Array.isArray(payload.files) ? payload.files.length : 0;
  const added = Number.isInteger(payload.added) ? payload.added : 0;
  const found = Number.isInteger(payload.found) ? payload.found : 0;
  const bits = [];
  if (files) bits.push(`${files} files`);
  if (found) bits.push(`${found} matches`);
  if (added) bits.push(`${added} new`);
  el.syncMeta.textContent = bits.length ? bits.join(" / ") : (payload.reason ? `Reason: ${payload.reason}` : "Ready.");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

el.search.addEventListener("input", () => {
  state.search = el.search.value;
  renderItems();
});

for (const button of el.filterButtons) {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    el.filterButtons.forEach((candidate) => candidate.classList.toggle("active", candidate === button));
    renderItems();
  });
}

for (const button of el.viewButtons) {
  button.addEventListener("click", () => {
    const view = button.dataset.view;
    el.viewButtons.forEach((candidate) => candidate.classList.toggle("active", candidate === button));
    el.grailView.classList.toggle("active", view === "grail");
    el.charactersView.classList.toggle("active", view === "characters");
    el.settingsView.classList.toggle("active", view === "settings");
  });
}

el.itemGrid.addEventListener("click", async (event) => {
  const row = event.target.closest("[data-item-id]");
  if (!row) return;
  const itemId = row.dataset.itemId;
  const nextFound = !isFound(itemId);
  const next = await window.soeGrail.toggleItem(itemId, nextFound);
  mergeState(next);
});

el.scanNow.addEventListener("click", () => {
  window.soeGrail.scanNow().catch((error) => setSync({ state: "error", message: error.message || String(error) }));
});

el.syncPlayer.addEventListener("click", () => {
  window.soeGrail.syncPlayer().catch((error) => setSync({ state: "error", message: error.message || String(error) }));
});

async function chooseStashFile() {
  const next = await window.soeGrail.chooseStashFile();
  mergeState(next);
}

async function clearStashFile() {
  const next = await window.soeGrail.clearStashFile();
  mergeState(next);
}

async function chooseSaveFolder() {
  const next = await window.soeGrail.chooseSaveFolder();
  mergeState(next);
}

async function clearSaveFolder() {
  const next = await window.soeGrail.clearSaveFolder();
  mergeState(next);
}

let overlaySizeTimer = null;
let playerSyncIntervalTimer = null;

async function setOverlayConfig(patch) {
  const next = await window.soeGrail.setOverlayConfig({
    ...(state.config.overlay || {}),
    ...patch
  });
  mergeState(next);
}

async function setPlayerSyncConfig(patch) {
  const next = await window.soeGrail.setPlayerSyncConfig({
    ...(state.config.playerSync || {}),
    ...patch
  });
  mergeState(next);
}

function schedulePlayerSyncInterval(intervalSeconds) {
  clearTimeout(playerSyncIntervalTimer);
  playerSyncIntervalTimer = setTimeout(() => {
    setPlayerSyncConfig({ intervalSeconds }).catch((error) => setSync({ state: "error", message: error.message || String(error) }));
  }, 120);
}

function scheduleOverlaySize(size) {
  clearTimeout(overlaySizeTimer);
  overlaySizeTimer = setTimeout(() => {
    setOverlayConfig({ size }).catch((error) => setSync({ state: "error", message: error.message || String(error) }));
  }, 80);
}

function setSoundDraft(patch) {
  soundDraftDirty = true;
  soundDraft = {
    ...soundDraft,
    ...patch
  };
  renderSoundSettings();
}

el.chooseStash.addEventListener("click", chooseStashFile);
el.settingsChooseStash.addEventListener("click", chooseStashFile);
el.clearStash.addEventListener("click", clearStashFile);
el.settingsClearStash.addEventListener("click", clearStashFile);
el.refreshCharacters.addEventListener("click", async () => {
  const next = await window.soeGrail.refreshCharacters();
  mergeState(next);
});
el.chooseSaveFolder.addEventListener("click", chooseSaveFolder);
el.clearCharacter.addEventListener("click", async () => {
  const next = await window.soeGrail.selectCharacter("");
  mergeState(next);
});
el.settingsChooseSaveFolder.addEventListener("click", chooseSaveFolder);
el.settingsClearSaveFolder.addEventListener("click", clearSaveFolder);
el.settingsPlayerSyncEnabled.addEventListener("change", () => {
  setPlayerSyncConfig({ enabled: el.settingsPlayerSyncEnabled.checked }).catch((error) => setSync({ state: "error", message: error.message || String(error) }));
});
el.settingsPlayerSyncInterval.addEventListener("input", () => {
  const interval = Math.min(60, Math.max(3, Math.round(Number(el.settingsPlayerSyncInterval.value) || 10)));
  el.settingsPlayerSyncIntervalValue.textContent = `${interval}s`;
  el.settingsPlayerSyncStatus.textContent = el.settingsPlayerSyncEnabled.checked
    ? activeCharacter()
      ? `Auto-syncing active player every ${interval} seconds.`
      : `Auto-sync enabled; select an active character.`
    : "Manual player sync only.";
  schedulePlayerSyncInterval(interval);
});
el.settingsOverlayEnabled.addEventListener("change", () => {
  setOverlayConfig({ enabled: el.settingsOverlayEnabled.checked }).catch((error) => setSync({ state: "error", message: error.message || String(error) }));
});
el.settingsOverlayClickThrough.addEventListener("change", () => {
  setOverlayConfig({ clickThrough: el.settingsOverlayClickThrough.checked }).catch((error) => setSync({ state: "error", message: error.message || String(error) }));
});
el.settingsOverlaySize.addEventListener("input", () => {
  const size = Number(el.settingsOverlaySize.value) || 104;
  el.settingsOverlaySizeValue.textContent = `${size}px`;
  el.settingsOverlayStatus.textContent = el.settingsOverlayEnabled.checked
    ? `Overlay active at ${size}px${el.settingsOverlayClickThrough.checked ? " / click-through locked" : ""}.`
    : "Overlay disabled.";
  scheduleOverlaySize(size);
});

el.settingsSoundSelect.addEventListener("change", () => {
  setSoundDraft({ soundId: el.settingsSoundSelect.value });
});

el.settingsSoundVolume.addEventListener("input", () => {
  const volume = Math.min(100, Math.max(0, Math.round(Number(el.settingsSoundVolume.value) || 0)));
  setSoundDraft({ volume });
});

el.settingsSoundTest.addEventListener("click", () => {
  const option = soundOptionById(soundDraft.soundId);
  playSoundOption(option, soundDraft.volume / 100)
    .then(() => {
      el.settingsSoundStatus.textContent = `${option.label} / previewing`;
    })
    .catch((error) => {
      el.settingsSoundStatus.textContent = error.message || String(error);
    });
});

el.settingsSoundSave.addEventListener("click", async () => {
  const nextSound = {
    soundId: soundDraft.soundId,
    volume: soundDraft.volume / 100
  };
  try {
    soundDraftDirty = false;
    const next = await window.soeGrail.setSoundConfig(nextSound);
    mergeState(next);
  } catch (error) {
    soundDraftDirty = true;
    el.settingsSoundStatus.textContent = error.message || String(error);
  }
});

el.settingsUpdateCheck.addEventListener("click", async () => {
  try {
    const next = await window.soeGrail.checkForUpdates();
    mergeState({ ...state, update: next });
  } catch (error) {
    el.settingsUpdateStatus.textContent = error.message || String(error);
  }
});

async function installAvailableUpdate() {
  try {
    const next = await window.soeGrail.installUpdate();
    mergeState({ ...state, update: next });
  } catch (error) {
    el.settingsUpdateStatus.textContent = error.message || String(error);
  }
}

el.settingsUpdateInstall.addEventListener("click", installAvailableUpdate);
el.updateNavButton.addEventListener("click", installAvailableUpdate);

el.settingsResetGrail.addEventListener("click", async () => {
  try {
    el.settingsResetGrail.disabled = true;
    const next = await window.soeGrail.resetGrailData();
    mergeState(next);
    if (next.resetCompleted) {
      setSync({ state: "idle", message: "Grail data reset.", reason: "reset" });
    }
  } catch (error) {
    setSync({ state: "error", message: error.message || String(error) });
  } finally {
    el.settingsResetGrail.disabled = false;
  }
});

el.characterList.addEventListener("click", async (event) => {
  const card = event.target.closest("[data-character-path]");
  if (!card) return;
  const next = await window.soeGrail.selectCharacter(card.dataset.characterPath);
  mergeState(next);
});

window.soeGrail.onState(mergeState);
window.soeGrail.onSync(setSync);
window.soeGrail.onGrailAdded((payload) => {
  if (payload?.items?.length) playConfiguredSound();
});

window.soeGrail.getInitialData().then(mergeState);
