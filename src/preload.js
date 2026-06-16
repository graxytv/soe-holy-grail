const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("soeGrail", {
  getInitialData: () => ipcRenderer.invoke("grail:getInitialData"),
  toggleItem: (itemId, found) => ipcRenderer.invoke("grail:toggleItem", itemId, found),
  scanNow: () => ipcRenderer.invoke("grail:scanNow"),
  chooseStashFile: () => ipcRenderer.invoke("grail:chooseStashFile"),
  clearStashFile: () => ipcRenderer.invoke("grail:clearStashFile"),
  refreshCharacters: () => ipcRenderer.invoke("grail:refreshCharacters"),
  selectCharacter: (characterPath) => ipcRenderer.invoke("grail:selectCharacter", characterPath),
  chooseSaveFolder: () => ipcRenderer.invoke("grail:chooseSaveFolder"),
  clearSaveFolder: () => ipcRenderer.invoke("grail:clearSaveFolder"),
  setOverlayConfig: (patch) => ipcRenderer.invoke("grail:setOverlayConfig", patch),
  setSoundConfig: (patch) => ipcRenderer.invoke("grail:setSoundConfig", patch),
  checkForUpdates: () => ipcRenderer.invoke("grail:checkForUpdates"),
  installUpdate: () => ipcRenderer.invoke("grail:installUpdate"),
  onState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("grail:state", listener);
    return () => ipcRenderer.removeListener("grail:state", listener);
  },
  onSync: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("grail:sync", listener);
    return () => ipcRenderer.removeListener("grail:sync", listener);
  },
  onGrailAdded: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("grail:added", listener);
    return () => ipcRenderer.removeListener("grail:added", listener);
  }
});
