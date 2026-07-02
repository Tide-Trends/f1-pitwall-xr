const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pitwall', {
  platform: process.platform,
  isElectron: true,

  openF1TV: () => ipcRenderer.invoke('pitwall:f1tv-open'),
  finishF1TVLogin: () => ipcRenderer.invoke('pitwall:f1tv-finish'),

  completeLogin: (payload) => ipcRenderer.invoke('pitwall:complete-login', payload),
});
