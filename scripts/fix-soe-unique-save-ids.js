const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const catalogPath = path.join(rootDir, "data", "d2ItemData.json");
const defaultSourcePath = path.resolve(
  rootDir,
  "..",
  "PD2-Sanctuary-of-Exile-13.0.1",
  "standard-mode",
  "data",
  "global",
  "excel",
  "UniqueItems.txt"
);
const sourcePath = process.argv[2] ? path.resolve(process.argv[2]) : defaultSourcePath;

function normalizeName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function rowForGeneratedSaveId(lines, saveId) {
  const lineIndex = saveId + 1;
  const line = lines[lineIndex];
  if (!line) return null;

  const cols = line.split("\t");
  return {
    name: cols[0],
    version: cols[1],
    enabled: cols[2],
    code: String(cols[8] || "").trim().toLowerCase(),
    lineNumber: lineIndex + 1
  };
}

const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const sourceLines = fs.readFileSync(sourcePath, "utf8").split(/\r?\n/);
let changed = 0;

for (const item of Object.values(catalog.items || {})) {
  if ((item.rare || item.type) !== "Unique" || !Number.isInteger(item.saveId)) continue;

  const row = rowForGeneratedSaveId(sourceLines, item.saveId);
  if (!row || row.version !== "100" || row.enabled !== "1") continue;

  const itemCode = String(item.code || "").trim().toLowerCase();
  if (row.code !== itemCode || normalizeName(row.name) !== normalizeName(item.name)) {
    throw new Error(
      `Catalog/source mismatch for saveId ${item.saveId}: ${item.name} (${itemCode}) vs `
      + `${row.name} (${row.code}) on UniqueItems.txt line ${row.lineNumber}`
    );
  }

  item.saveId -= 1;
  changed += 1;
}

fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, "\t")}\n`, "utf8");
console.log(`Shifted ${changed} SoE version-100 unique save IDs.`);
