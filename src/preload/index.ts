import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer (Garuda APIs)
const api = {
  // Open native folder picker
  selectFolder: () => {
    return electronAPI.ipcRenderer.invoke('select-folder')
  },

  // Scan a selected folder recursively
  scanFolder: (folderPath: string) => {
    return electronAPI.ipcRenderer.invoke('scan-folder', folderPath)
  },

  getDriveRootPath: () => {
    return electronAPI.ipcRenderer.invoke('get-drive-root-path')
  },

  validateDriveRootPath: (candidatePath: string | null) => {
    return electronAPI.ipcRenderer.invoke('validate-drive-root-path', candidatePath)
  },

  setDriveRootPath: (candidatePath: string | null) => {
    return electronAPI.ipcRenderer.invoke('set-drive-root-path', candidatePath)
  }
}

// Expose APIs safely
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
