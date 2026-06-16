const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(rootDir, "data", "d2ItemData.json"), "utf8"));
const items = Object.entries(catalog.items || {})
  .map(([id, item]) => ({
    id,
    name: item.displayName || item.name || id,
    type: item.rare || item.type,
    code: item.code || "",
    saveId: item.saveId,
    aliasSaveIds: Array.isArray(item.aliasSaveIds) ? item.aliasSaveIds : []
  }))
  .filter((item) => item.type === "Unique" || item.type === "Set");

const byCode = new Map();
const byIdentity = new Map();
const conflicts = [];

for (const item of items) {
  if (!byCode.has(item.code)) byCode.set(item.code, []);
  byCode.get(item.code).push(item);

  const ids = [item.saveId, ...item.aliasSaveIds].filter(Number.isInteger);
  for (const saveId of ids) {
    const key = `${item.type}:${item.code}:${saveId}`;
    if (!byIdentity.has(key)) byIdentity.set(key, item);
    const existing = conflicts.find((row) => row.key === key);
    if (existing) {
      existing.items.push(item.name);
    } else {
      conflicts.push({ key, items: [item.name] });
    }
  }
}

const duplicateCodes = [...byCode.entries()]
  .filter(([, rows]) => rows.length > 1)
  .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

const realConflicts = conflicts.filter((row) => new Set(row.items).size > 1);
const shiftedPairs = [];

for (const item of items) {
  if (!Number.isInteger(item.saveId)) continue;
  const previous = byIdentity.get(`${item.type}:${item.code}:${item.saveId - 1}`);
  if (previous && previous.id !== item.id) {
    shiftedPairs.push({ advancedId: item.saveId - 1, exact: previous, shifted: item });
  }
}

console.log(`Unique/set entries: ${items.length}`);
console.log(`Base codes reused by multiple unique/set rows: ${duplicateCodes.length}`);
console.log("");
for (const [code, rows] of duplicateCodes.slice(0, 20)) {
  console.log(`${code}: ${rows.length} rows`);
  for (const row of rows.slice(0, 8)) {
    console.log(`  - ${row.name} (${row.type} saveId=${row.saveId})`);
  }
}

console.log("");
console.log(`Adjacent same-code shifted lookup pairs: ${shiftedPairs.length}`);
for (const pair of shiftedPairs.slice(0, 20)) {
  console.log(`  ${pair.exact.code} advancedId=${pair.advancedId}: ${pair.exact.name} -> ${pair.shifted.name}`);
}

if (realConflicts.length > 0) {
  console.error("");
  console.error("Conflicting code/saveId identities:");
  for (const conflict of realConflicts) {
    console.error(`  ${conflict.key}: ${conflict.items.join(", ")}`);
  }
  process.exitCode = 1;
} else {
  console.log("");
  console.log("No code/saveId identity conflicts found.");
}
