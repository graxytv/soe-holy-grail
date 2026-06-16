const { app, BrowserWindow, nativeImage } = require("electron");
const fs = require("fs");
const path = require("path");

const rootDir = process.env.SOE_GRAIL_SCREENSHOT_ROOT || path.resolve(__dirname, "..");
const outDir = path.join(rootDir, "docs", "screenshots");
const preload = path.join(__dirname, "screenshot-preload.js");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function capture(win, name) {
  await sleep(450);
  const image = await win.webContents.capturePage();
  const resized = nativeImage.createFromBuffer(image.toPNG()).resize({ width: 1240 });
  fs.writeFileSync(path.join(outDir, `${name}.png`), resized.toPNG());
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    show: false,
    backgroundColor: "#070303",
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await win.loadFile(path.join(rootDir, "src", "index.html"));
  await win.webContents.executeJavaScript("document.fonts ? document.fonts.ready : Promise.resolve()");
  await capture(win, "grail");

  await win.webContents.executeJavaScript("document.querySelector('[data-view=\"characters\"]').click()");
  await capture(win, "characters");

  await win.webContents.executeJavaScript("document.querySelector('[data-view=\"settings\"]').click()");
  await capture(win, "settings");

  await win.close();
  app.quit();
}

app.whenReady().then(main).catch((error) => {
  console.error(error);
  app.exit(1);
});
