const { contextBridge } = require("electron");
const fs = require("fs");
const path = require("path");

const rootDir = process.env.SOE_GRAIL_SCREENSHOT_ROOT || path.resolve(__dirname, "..");
const catalogPath = path.join(rootDir, "data", "d2ItemData.json");

function readCatalogItems() {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
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

const items = readCatalogItems();
const foundIds = [
  ...items.filter((item) => item.type === "Unique").slice(0, 52).map((item) => item.id),
  ...items.filter((item) => item.type === "Set").slice(0, 18).map((item) => item.id),
  ...items.filter((item) => item.type === "Rune").slice(0, 14).map((item) => item.id),
  ...items.filter((item) => item.type === "FateCard").slice(0, 9).map((item) => item.id)
];

const found = Object.fromEntries(foundIds.map((id, index) => [
  id,
  {
    foundAt: new Date(Date.now() - index * 1000 * 60 * 12).toISOString(),
    source: index % 3 === 0 ? "manual" : "save-scan"
  }
]));

const recent = foundIds
  .slice(0, 20)
  .map((id, index) => {
    const item = items.find((candidate) => candidate.id === id);
    return {
      id,
      name: item?.name || id,
      type: item?.type || "Unknown",
      foundAt: new Date(Date.now() - index * 1000 * 60 * 12).toISOString(),
      source: "save-scan"
    };
  });

const state = {
  items,
  soundOptions: [
    { id: "soe-1", label: "SoE Companion Sound 1", group: "SoE Companion", kind: "builtin", file: "1.mp3" },
    { id: "filterblade:Maven:divine1.ogg", label: "Maven - Divine 1", group: "FilterBlade - Maven", kind: "filterblade", url: "https://www.filterblade.xyz/assets/communitySounds/Maven/divine1.ogg" }
  ],
  characters: [
    {
      path: "C:\\Games\\Diablo II\\Save\\Graxy.d2s",
      fileName: "Graxy.d2s",
      name: "Graxy",
      classId: 1,
      className: "Sorceress",
      classKey: "sorceress",
      classIcon: "SO",
      level: 91,
      modifiedAt: new Date().toISOString()
    },
    {
      path: "C:\\Games\\Diablo II\\Save\\GrailSin.d2s",
      fileName: "GrailSin.d2s",
      name: "GrailSin",
      classId: 6,
      className: "Assassin",
      classKey: "assassin",
      classIcon: "AS",
      level: 84,
      modifiedAt: new Date(Date.now() - 1000 * 60 * 60 * 7).toISOString()
    },
    {
      path: "C:\\Games\\Diablo II\\Save\\RuneDad.d2s",
      fileName: "RuneDad.d2s",
      name: "RuneDad",
      classId: 4,
      className: "Barbarian",
      classKey: "barbarian",
      classIcon: "BA",
      level: 76,
      modifiedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString()
    }
  ],
  found,
  recent,
  update: {
    state: "available",
    available: true,
    currentVersion: "0.1.0",
    latestVersion: "0.1.1",
    releaseName: "SoE Holy Grail v0.1.1",
    releaseUrl: "https://github.com/graxytv/soe-holy-grail/releases/latest",
    assetName: "SoE-Holy-Grail-win32-x64-v0.1.1.zip",
    assetSize: 301410011,
    progress: 0,
    checkedAt: new Date().toISOString(),
    message: "Version 0.1.1 is available.",
    error: ""
  },
  progress: {
    total: items.length,
    found: foundIds.length,
    missing: items.length - foundIds.length,
    percent: Math.round((foundIds.length / items.length) * 1000) / 10
  },
  config: {
    stashPath: "C:\\Games\\Diablo II\\Save\\pd2_shared.stash",
    saveFolder: "C:\\Games\\Diablo II\\Save",
    characterPath: "C:\\Games\\Diablo II\\Save\\Graxy.d2s",
    defaultSaveFolder: "C:\\Games\\Diablo II\\Save",
    defaultStashPath: "C:\\Games\\Diablo II\\Save\\pd2_shared.stash",
    overlay: { enabled: true, size: 112, clickThrough: true, bounds: null },
    sound: { soundId: "soe-1", volume: 0.8 }
  }
};

contextBridge.exposeInMainWorld("soeGrail", {
  getInitialData: () => Promise.resolve(state),
  toggleItem: () => Promise.resolve(state),
  scanNow: () => Promise.resolve({ files: [], found: Object.keys(found), added: [] }),
  chooseStashFile: () => Promise.resolve(state),
  clearStashFile: () => Promise.resolve(state),
  refreshCharacters: () => Promise.resolve(state),
  selectCharacter: () => Promise.resolve(state),
  chooseSaveFolder: () => Promise.resolve(state),
  clearSaveFolder: () => Promise.resolve(state),
  setOverlayConfig: () => Promise.resolve(state),
  setSoundConfig: () => Promise.resolve(state),
  checkForUpdates: () => Promise.resolve(state.update),
  installUpdate: () => Promise.resolve(state.update),
  onState: () => () => {},
  onSync: (callback) => {
    setTimeout(() => callback({ state: "synced", message: "Save scan complete.", files: ["pd2_shared.stash", "Graxy.d2s"], found: foundIds.length, added: 3 }), 300);
    return () => {};
  },
  onGrailAdded: () => () => {}
});
