const fs = require("fs");
const os = require("os");
const path = require("path");

const QUALITY_SET = 5;
const QUALITY_UNIQUE = 7;
const DEBOUNCE_MS = 1200;
const POLL_MS = 15000;
const D2_CLASSES = [
  { name: "Amazon", key: "amazon", icon: "AM" },
  { name: "Sorceress", key: "sorceress", icon: "SO" },
  { name: "Necromancer", key: "necromancer", icon: "NE" },
  { name: "Paladin", key: "paladin", icon: "PA" },
  { name: "Barbarian", key: "barbarian", icon: "BA" },
  { name: "Druid", key: "druid", icon: "DR" },
  { name: "Assassin", key: "assassin", icon: "AS" }
];

function readBits(bytes, bitOffset, bitLength) {
  let value = 0;
  for (let i = 0; i < bitLength; i += 1) {
    const absoluteBit = bitOffset + i;
    const byte = bytes[absoluteBit >> 3];
    const bit = (byte >> (absoluteBit & 7)) & 1;
    value |= bit << i;
  }
  return value >>> 0;
}

function readItemCode(bytes, offset) {
  const bitBase = offset * 8 + 76;
  const chars = [];
  for (let i = 0; i < 4; i += 1) {
    const value = readBits(bytes, bitBase + i * 8, 8);
    if (value !== 0 && value !== 32) chars.push(String.fromCharCode(value));
  }
  return chars.join("").trim().toLowerCase();
}

function readAdvancedId(bytes, offset, quality) {
  let bit = offset * 8 + 154;
  if (readBits(bytes, bit, 1)) bit += 4;
  else bit += 1;

  if (readBits(bytes, bit, 1)) bit += 12;
  else bit += 1;

  if (quality === 1 || quality === 3) bit += 3;
  if (quality === 4) bit += 22;

  if (quality === QUALITY_SET || quality === QUALITY_UNIQUE) {
    return readBits(bytes, bit, 12);
  }
  return null;
}

function normalizeCode(code) {
  return String(code || "").trim();
}

function makeKey(id, code) {
  return `${id}:${normalizeCode(code)}`;
}

function normalizeRuneCode(code) {
  const match = /^r(\d{2})s?$/.exec(normalizeCode(code));
  if (!match) return null;
  const number = Number(match[1]);
  if (number < 1 || number > 33) return null;
  return `r${String(number).padStart(2, "0")}`;
}

function normalizeFateCardCode(code) {
  const match = /^fa(\d{2})$/.exec(normalizeCode(code));
  if (!match) return null;
  const number = Number(match[1]);
  if (number < 1 || number > 63) return null;
  return `fa${String(number).padStart(2, "0")}`;
}

function isSharedStashFile(filePath) {
  const name = path.basename(filePath).toLowerCase();
  return name === "pd2_shared.stash" || name === "pd2_hc_shared.stash";
}

function isCharacterSaveFile(filePath) {
  return path.extname(filePath).toLowerCase() === ".d2s";
}

function isD2ItemListHeader(bytes, offset) {
  return offset + 5 < bytes.length
    && bytes[offset] === 0x4a
    && bytes[offset + 1] === 0x4d
    && bytes[offset + 4] === 0x4a
    && bytes[offset + 5] === 0x4d;
}

function itemRecordOffsets(bytes) {
  const headers = [];
  for (let offset = 0; offset + 5 < bytes.length; offset += 1) {
    if (isD2ItemListHeader(bytes, offset)) headers.push(offset);
  }

  const offsets = [];
  if (headers.length === 0) return offsets;

  for (let index = 0; index < headers.length; index += 1) {
    const start = headers[index] + 4;
    const end = index + 1 < headers.length ? headers[index + 1] : bytes.length;
    for (let offset = start; offset + 24 < end; offset += 1) {
      if (bytes[offset] !== 0x4a || bytes[offset + 1] !== 0x4d) continue;
      if (isD2ItemListHeader(bytes, offset)) continue;
      offsets.push(offset);
    }
  }

  return offsets;
}

function materialRuneCodes(bytes) {
  const codes = [];
  if (bytes.length < 4) return codes;

  for (let offset = 0; offset < bytes.length - 4; offset += 1) {
    if (bytes[offset] !== 0x63 || bytes[offset + 1] !== 0x75) continue;
    const countsStart = offset + 2;
    if (countsStart + 33 * 2 > bytes.length) continue;

    let plausible = true;
    const parsed = [];
    for (let index = 0; index < 33; index += 1) {
      const start = countsStart + index * 2;
      const value = bytes[start] | (bytes[start + 1] << 8);
      if (value > 9999) {
        plausible = false;
        break;
      }
      parsed.push(value);
    }

    if (!plausible || !parsed.some((value) => value > 0)) continue;
    for (let index = 0; index < parsed.length; index += 1) {
      if (parsed[index] > 0) codes.push(`r${String(index + 1).padStart(2, "0")}`);
    }
    return codes;
  }

  return codes;
}

function readStackQuantity(bytes, offset) {
  const bitBase = offset * 8;
  if (readBits(bytes, bitBase + 37, 1)) return 1;

  const quality = readBits(bytes, bitBase + 150, 4);
  let bit = bitBase + 154;

  bit += readBits(bytes, bit, 1) ? 4 : 1;
  bit += readBits(bytes, bit, 1) ? 12 : 1;

  if (quality === 1 || quality === 3) bit += 3;
  else if (quality === 4) bit += 22;
  else if (quality === QUALITY_SET || quality === QUALITY_UNIQUE) bit += 12;
  else if (quality === 6 || quality === 8) {
    bit += 16;
    for (let i = 0; i < 6; i += 1) {
      const hasAffix = readBits(bytes, bit, 1);
      bit += 1;
      if (hasAffix) bit += 11;
    }
  }

  if (readBits(bytes, bitBase + 42, 1)) bit += 16;

  if (readBits(bytes, bitBase + 40, 1)) {
    for (let i = 0; i < 16; i += 1) {
      const ch = readBits(bytes, bit, 7);
      bit += 7;
      if (ch === 0) break;
    }
  }

  bit += 1;
  const quantity = readBits(bytes, bit, 9);
  return quantity > 0 && quantity <= 999 ? quantity : 1;
}

function buildLookup(items) {
  const byRuneCode = new Map();
  const byFateCardCode = new Map();
  const fateCardGoals = new Map();
  const byUniqueIdAndCode = new Map();
  const bySetIdAndCode = new Map();
  const knownCodes = new Set();

  for (const item of items) {
    const code = normalizeCode(item.code);
    if (code) knownCodes.add(code);
    if (item.type === "Rune" && code) {
      byRuneCode.set(code, item.id);
    } else if (item.type === "FateCard" && code) {
      const stackSize = Math.max(1, Number(item.stackSize) || 1);
      const fateCardCode = normalizeFateCardCode(code);
      if (fateCardCode) {
        const goal = { id: item.id, stackSize };
        byFateCardCode.set(fateCardCode, goal);
        fateCardGoals.set(item.id, goal);
      }
    } else if (item.type === "Unique" && Number.isInteger(item.saveId) && code) {
      byUniqueIdAndCode.set(makeKey(item.saveId, code), item.id);
      for (const aliasId of item.aliasSaveIds || []) {
        if (Number.isInteger(aliasId)) byUniqueIdAndCode.set(makeKey(aliasId, code), item.id);
      }
    } else if (item.type === "Set" && code) {
      if (Number.isInteger(item.saveId)) bySetIdAndCode.set(makeKey(item.saveId, code), item.id);
      for (const aliasId of item.aliasSaveIds || []) {
        if (Number.isInteger(aliasId)) bySetIdAndCode.set(makeKey(aliasId, code), item.id);
      }
    }
  }

  return { byRuneCode, byFateCardCode, fateCardGoals, byUniqueIdAndCode, bySetIdAndCode, knownCodes };
}

function lookupAdvancedItem(map, advancedId, code) {
  return map.get(makeKey(advancedId, code))
    || map.get(makeKey(advancedId + 1, code))
    || null;
}

function looksLikeItemRecord(bytes, offset, code) {
  if (offset + 32 >= bytes.length) return false;
  if (bytes[offset] !== 0x4a || bytes[offset + 1] !== 0x4d) return false;

  const bitBase = offset * 8;
  const isEar = readBits(bytes, bitBase + 32, 1);
  if (isEar) return false;

  const location = readBits(bytes, bitBase + 58, 3);
  const bodyLocation = readBits(bytes, bitBase + 61, 4);
  const x = readBits(bytes, bitBase + 65, 4);
  const y = readBits(bytes, bitBase + 69, 4);
  const panel = readBits(bytes, bitBase + 73, 3);

  if (location > 7 || bodyLocation > 13 || x > 15 || y > 15 || panel > 7) return false;
  return /^[ -~]{2,4}$/.test(code);
}

function scanFile(filePath, lookup) {
  const bytes = fs.readFileSync(filePath);
  const found = new Set();
  const fateCardCounts = new Map();

  if (isSharedStashFile(filePath)) {
    for (const runeCode of materialRuneCodes(bytes)) {
      if (lookup.byRuneCode.has(runeCode)) found.add(lookup.byRuneCode.get(runeCode));
    }
  }

  for (const offset of itemRecordOffsets(bytes)) {
    const code = readItemCode(bytes, offset);
    if (!lookup.knownCodes.has(code)) continue;
    if (!looksLikeItemRecord(bytes, offset, code)) continue;

    const fateCardCode = normalizeFateCardCode(code);
    if (fateCardCode && lookup.byFateCardCode.has(fateCardCode)) {
      const goal = lookup.byFateCardCode.get(fateCardCode);
      fateCardCounts.set(goal.id, (fateCardCounts.get(goal.id) || 0) + readStackQuantity(bytes, offset));
      continue;
    }

    const runeCode = normalizeRuneCode(code);
    if (runeCode && lookup.byRuneCode.has(runeCode)) {
      found.add(lookup.byRuneCode.get(runeCode));
      continue;
    }

    const bitBase = offset * 8;
    const quality = readBits(bytes, bitBase + 150, 4);
    const advancedId = readAdvancedId(bytes, offset, quality);
    if (advancedId == null) continue;

    if (quality === QUALITY_UNIQUE) {
      const itemId = lookupAdvancedItem(lookup.byUniqueIdAndCode, advancedId, code);
      if (itemId) found.add(itemId);
    } else if (quality === QUALITY_SET) {
      const itemId = lookupAdvancedItem(lookup.bySetIdAndCode, advancedId, code);
      if (itemId) found.add(itemId);
    }
  }

  return { found, fateCardCounts };
}

function defaultStashPath() {
  return "C:\\Program Files (x86)\\Diablo II\\Save\\pd2_shared.stash";
}

function defaultSaveFolder(stashPath = "") {
  const selected = String(stashPath || "").trim();
  return path.dirname(selected || defaultStashPath());
}

function defaultSaveFolders(stashPath) {
  const home = os.homedir();
  const selected = String(stashPath || "").trim();
  if (selected) return [selected];
  return [
    path.join(home, "Saved Games", "Diablo II", "pd2_shared.stash"),
    path.join(home, "Saved Games", "Diablo II", "pd2_hc_shared.stash"),
    path.join(home, "Saved Games", "ProjectD2", "pd2_shared.stash"),
    path.join(home, "Saved Games", "ProjectD2", "pd2_hc_shared.stash"),
    path.join(home, "Saved Games", "PD2", "pd2_shared.stash"),
    path.join(home, "Saved Games", "PD2", "pd2_hc_shared.stash"),
    defaultStashPath(),
    "C:\\Program Files (x86)\\Diablo II\\Save\\pd2_hc_shared.stash",
    "C:\\Program Files\\Diablo II\\Save\\pd2_shared.stash",
    "C:\\Program Files\\Diablo II\\Save\\pd2_hc_shared.stash"
  ].filter(Boolean);
}

function characterFolder(options = {}) {
  return String(options.saveFolder || "").trim() || defaultSaveFolder(options.stashPath || "");
}

function readD2String(bytes, offset, length) {
  return bytes
    .subarray(offset, Math.min(offset + length, bytes.length))
    .toString("ascii")
    .replace(/\0.*$/, "")
    .trim();
}

function readCharacterInfo(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length < 44) throw new Error("Character file is too small.");
  if (bytes[0] !== 0x55 || bytes[1] !== 0xaa || bytes[2] !== 0x55 || bytes[3] !== 0xaa) {
    throw new Error("Character file has an invalid Diablo II header.");
  }

  const stat = fs.statSync(filePath);
  const classId = bytes[40];
  const classInfo = D2_CLASSES[classId] || { name: "Unknown", key: "unknown", icon: "D2" };
  const name = readD2String(bytes, 20, 16) || path.basename(filePath, path.extname(filePath));

  return {
    path: filePath,
    fileName: path.basename(filePath),
    name,
    classId,
    className: classInfo.name,
    classKey: classInfo.key,
    classIcon: classInfo.icon,
    level: bytes[43] || 0,
    modifiedAt: stat.mtime.toISOString()
  };
}

function listCharacters(options = {}) {
  const folder = characterFolder(options);
  if (!folder || !fs.existsSync(folder)) return [];
  const stat = fs.statSync(folder);
  if (!stat.isDirectory()) return [];

  const characters = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".d2s")) continue;
    const filePath = path.join(folder, entry.name);
    try {
      characters.push(readCharacterInfo(filePath));
    } catch (_error) {}
  }

  characters.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
  return characters;
}

function collectSaveFiles(rootDir) {
  const files = [];
  if (!rootDir || !fs.existsSync(rootDir)) return files;
  const stat = fs.statSync(rootDir);
  if (stat.isFile()) {
    if (isSharedStashFile(rootDir)) files.push(rootDir);
    return files;
  }
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    if (lower === "pd2_shared.stash" || lower === "pd2_hc_shared.stash") {
      files.push(fullPath);
    }
  }
  return files;
}

function listSaveFiles(options = {}) {
  const stashPath = typeof options === "string" ? options : options.stashPath || options.extraFolder || "";
  const saveFolder = typeof options === "object" ? String(options.saveFolder || "").trim() : "";
  const seen = new Set();
  const files = [];
  const scanRoots = saveFolder && !stashPath
    ? [saveFolder, ...defaultSaveFolders(stashPath)]
    : defaultSaveFolders(stashPath);
  for (const dir of scanRoots) {
    for (const filePath of collectSaveFiles(dir)) {
      const normalized = filePath.toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        files.push(filePath);
      }
    }
  }
  return files;
}

async function scanSaveFiles(items, options = {}) {
  const lookup = buildLookup(items);
  const files = listSaveFiles({
    stashPath: options.stashPath || options.extraFolder || "",
    saveFolder: options.saveFolder || ""
  });
  const characterPath = String(options.characterPath || "").trim();
  if (characterPath && fs.existsSync(characterPath) && isCharacterSaveFile(characterPath)) {
    const normalized = characterPath.toLowerCase();
    if (!files.some((file) => file.toLowerCase() === normalized)) files.push(characterPath);
  }
  const found = new Set();
  const fateCardCounts = new Map();
  const errors = [];

  for (const file of files) {
    try {
      const result = scanFile(file, lookup);
      for (const itemId of result.found) found.add(itemId);
      for (const [itemId, count] of result.fateCardCounts) {
        fateCardCounts.set(itemId, (fateCardCounts.get(itemId) || 0) + count);
      }
    } catch (error) {
      errors.push({ file, error: error.message || String(error) });
    }
  }

  for (const [itemId, goal] of lookup.fateCardGoals) {
    if ((fateCardCounts.get(itemId) || 0) >= goal.stackSize) found.add(itemId);
  }

  return {
    files,
    found: [...found],
    fateCardCounts: Object.fromEntries(fateCardCounts),
    errors
  };
}

function startAutoScan(items, options = {}) {
  const watchers = [];
  let timer = null;
  let pollTimer = null;

  const schedule = (reason = "watch") => {
    if (timer) clearTimeout(timer);
    options.onStatus?.({ state: "syncing", message: "Save change detected...", reason });
    timer = setTimeout(async () => {
      try {
        const result = await scanSaveFiles(items, {
          stashPath: options.stashPath || options.extraFolder || "",
          characterPath: options.characterPath || "",
          saveFolder: options.saveFolder || ""
        });
        const added = options.onFound?.(result.found) || [];
        options.onStatus?.({
          state: "synced",
          message: added.length ? `Found ${added.length} new grail item${added.length === 1 ? "" : "s"}.` : "Save scan complete.",
          files: result.files,
          found: result.found.length,
          added: added.length,
          reason
        });
      } catch (error) {
        options.onStatus?.({ state: "error", message: error.message || String(error), reason });
      }
    }, DEBOUNCE_MS);
  };

  const watchTargets = [
    ...defaultSaveFolders(options.stashPath || options.extraFolder || ""),
    options.characterPath || "",
    characterFolder({ stashPath: options.stashPath || options.extraFolder || "", saveFolder: options.saveFolder || "" })
  ];
  const seenTargets = new Set();

  for (const target of watchTargets) {
    if (!fs.existsSync(target)) continue;
    const stat = fs.statSync(target);
    const dir = stat.isFile() ? path.dirname(target) : target;
    const normalized = dir.toLowerCase();
    if (seenTargets.has(normalized)) continue;
    seenTargets.add(normalized);
    try {
      watchers.push(fs.watch(dir, { recursive: true }, () => schedule("watch")));
    } catch (_error) {
      try {
        watchers.push(fs.watch(dir, () => schedule("watch")));
      } catch (_ignored) {}
    }
  }

  schedule("startup");
  pollTimer = setInterval(() => schedule("poll"), POLL_MS);

  return () => {
    if (timer) clearTimeout(timer);
    if (pollTimer) clearInterval(pollTimer);
    for (const watcher of watchers) watcher.close();
  };
}

module.exports = {
  buildLookup,
  readBits,
  readItemCode,
  readCharacterInfo,
  scanFile,
  lookupAdvancedItem,
  scanSaveFiles,
  startAutoScan,
  listSaveFiles,
  listCharacters,
  defaultSaveFolder,
  defaultStashPath
};
