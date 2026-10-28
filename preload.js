const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('auraNative', {
  apiRequest: (args) => ipcRenderer.invoke('aura:api-request', args),
  testConnection: (args) => ipcRenderer.invoke('aura:test-connection', args),
  toggleFullScreen: () => ipcRenderer.invoke('aura:toggle-fullscreen'),
  isFullScreen: () => ipcRenderer.invoke('aura:is-fullscreen'),
  copyToClipboard: (text) => ipcRenderer.invoke('aura:copy-clipboard', text),
  openExternal: (url) => ipcRenderer.invoke('aura:open-external', url),
  platform: process.platform,
  version: process.versions.electron,
  mediaProxy: (url) => `aura://stream?url=${encodeURIComponent(url)}`
});
