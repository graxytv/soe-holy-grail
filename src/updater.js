const childProcess = require("child_process");
const fs = require("fs");
const https = require("https");
const path = require("path");

const USER_AGENT = "SoE-Holy-Grail-Updater";
const UPDATE_ASSET_PATTERN = /soe[-_\s]*holy[-_\s]*grail.*(?:win|x64|portable|runtime).*\.zip$/i;

function cleanVersion(version) {
  return String(version || "0.0.0").trim().replace(/^v/i, "");
}

function compareVersions(left, right) {
  const a = cleanVersion(left).split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const b = cleanVersion(right).split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(a.length, b.length, 3);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": USER_AGENT
      }
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        requestJson(response.headers.location).then(resolve, reject);
        return;
      }

      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`GitHub returned HTTP ${response.statusCode}.`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
  });
}

function selectReleaseAsset(release) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const zipAssets = assets.filter((asset) => /\.zip$/i.test(asset.name || "") && !/source/i.test(asset.name || ""));
  return zipAssets.find((asset) => UPDATE_ASSET_PATTERN.test(asset.name || ""))
    || zipAssets.find((asset) => /soe[-_\s]*holy[-_\s]*grail/i.test(asset.name || ""))
    || null;
}

async function checkForUpdate({ owner, repo, currentVersion }) {
  const release = await requestJson(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
  const latestVersion = cleanVersion(release.tag_name || release.name || "");
  const isNewer = compareVersions(latestVersion, currentVersion) > 0;
  const asset = selectReleaseAsset(release);

  return {
    available: Boolean(isNewer && asset),
    currentVersion: cleanVersion(currentVersion),
    latestVersion,
    releaseName: release.name || release.tag_name || latestVersion,
    releaseUrl: release.html_url || "",
    notes: release.body || "",
    publishedAt: release.published_at || "",
    asset: asset
      ? {
        name: asset.name,
        size: asset.size || 0,
        url: asset.browser_download_url
      }
      : null,
    message: !isNewer
      ? "You are on the latest version."
      : asset
        ? `Version ${latestVersion} is available.`
        : `Version ${latestVersion} is available, but no portable Windows zip asset was found.`
  };
}

function downloadFile(url, destination, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const file = fs.createWriteStream(destination);

    const start = (nextUrl) => {
      const request = https.get(nextUrl, { headers: { "User-Agent": USER_AGENT } }, (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
          response.resume();
          start(response.headers.location);
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          reject(new Error(`Download returned HTTP ${response.statusCode}.`));
          return;
        }

        const total = Number(response.headers["content-length"]) || 0;
        let received = 0;
        response.on("data", (chunk) => {
          received += chunk.length;
          if (total) onProgress?.(Math.round((received / total) * 70));
        });
        response.pipe(file);
        file.on("finish", () => {
          file.close(() => resolve(destination));
        });
      });
      request.on("error", reject);
    };

    file.on("error", reject);
    start(url);
  });
}

function runPowerShell(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn("powershell.exe", args, {
      windowsHide: true,
      ...options
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `PowerShell exited with code ${code}.`));
    });
  });
}

async function extractZip(zipPath, extractDir, onProgress) {
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  await runPowerShell([
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command",
    "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
    zipPath,
    extractDir
  ]);
  onProgress?.(90);
}

function hasRuntimeMarkers(directory) {
  return fs.existsSync(path.join(directory, "resources", "app", "package.json"))
    && fs.existsSync(path.join(directory, "resources", "app", "src", "main.js"));
}

function findRuntimeRoot(extractDir) {
  if (hasRuntimeMarkers(extractDir)) return extractDir;
  const queue = [{ directory: extractDir, depth: 0 }];
  while (queue.length) {
    const current = queue.shift();
    if (hasRuntimeMarkers(current.directory)) return current.directory;
    if (current.depth >= 3) continue;
    for (const entry of fs.readdirSync(current.directory, { withFileTypes: true })) {
      if (entry.isDirectory()) queue.push({ directory: path.join(current.directory, entry.name), depth: current.depth + 1 });
    }
  }
  return null;
}

function writeInstallScript(scriptPath) {
  const script = `
$ErrorActionPreference = "Stop"
$source = Resolve-Path -LiteralPath $env:SOE_UPDATE_SOURCE
$target = Resolve-Path -LiteralPath $env:SOE_UPDATE_TARGET
$exeName = $env:SOE_UPDATE_EXE
$pidToWait = [int]$env:SOE_UPDATE_PID

if (!(Test-Path -LiteralPath (Join-Path $source "resources\\app\\package.json"))) {
  throw "Update source does not look like a SoE Holy Grail runtime folder."
}
if (!(Test-Path -LiteralPath (Join-Path $target "resources\\app\\package.json"))) {
  throw "Update target does not look like a SoE Holy Grail runtime folder."
}

Wait-Process -Id $pidToWait -ErrorAction SilentlyContinue
Copy-Item -LiteralPath (Join-Path $source "*") -Destination $target -Recurse -Force
Start-Process -FilePath (Join-Path $target $exeName) -WorkingDirectory $target
`;
  fs.writeFileSync(scriptPath, script.trimStart(), "utf8");
}

async function installUpdate({ update, tempDir, runtimeDir, exeName, currentPid, onProgress }) {
  if (!update?.asset?.url) throw new Error("No update asset is available.");
  if (!hasRuntimeMarkers(runtimeDir)) throw new Error("Current app folder does not look like a SoE Holy Grail runtime folder.");

  const downloadPath = path.join(tempDir, update.asset.name);
  const extractDir = path.join(tempDir, "extracted");
  const scriptPath = path.join(tempDir, "install-update.ps1");

  fs.mkdirSync(tempDir, { recursive: true });
  await downloadFile(update.asset.url, downloadPath, onProgress);
  await extractZip(downloadPath, extractDir, onProgress);
  const sourceRuntime = findRuntimeRoot(extractDir);
  if (!sourceRuntime) throw new Error("The downloaded zip did not contain a SoE Holy Grail runtime folder.");

  writeInstallScript(scriptPath);
  onProgress?.(100);
  childProcess.spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", scriptPath
  ], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      SOE_UPDATE_SOURCE: sourceRuntime,
      SOE_UPDATE_TARGET: runtimeDir,
      SOE_UPDATE_EXE: exeName,
      SOE_UPDATE_PID: String(currentPid)
    }
  }).unref();
}

module.exports = {
  checkForUpdate,
  compareVersions,
  cleanVersion,
  installUpdate
};
