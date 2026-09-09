const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('workspacexSetup', {
  state: () => ipcRenderer.invoke('setup:state'),
  createHost: (input) => ipcRenderer.invoke('setup:create-host', input),
  join: (invite) => ipcRenderer.invoke('setup:join', invite),
  retry: () => ipcRenderer.invoke('setup:retry'),
  pause: () => ipcRenderer.invoke('setup:pause'),
  open: () => ipcRenderer.invoke('setup:open'),
  copyInvite: () => ipcRenderer.invoke('setup:copy-invite'),
  updateMail: (key) => ipcRenderer.invoke('setup:update-mail', key),
  license: () => ipcRenderer.invoke('setup:license'),
  progress: (callback) => {
    const handler = (_event, value) => callback(value)
    ipcRenderer.on('setup:progress', handler)
    return () => ipcRenderer.removeListener('setup:progress', handler)
  },
})