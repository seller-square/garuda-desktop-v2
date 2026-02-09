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

  cancelScanFolder: () => {
    return electronAPI.ipcRenderer.invoke('cancel-scan-folder')
  },

  dryRunStreamOpen: (items: Array<{ sourcePath: string; expectedSizeBytes: number }>) => {
    return electronAPI.ipcRenderer.invoke('dry-run-stream-open', items)
  },

  verifyDestinationPaths: (
    items: Array<{ filePath: string; expectedSizeBytes: number | null; expectedFilename: string | null }>
  ) => {
    return electronAPI.ipcRenderer.invoke('verify-destination-paths', items)
  },

  executeFilesystemStreamPlan: (request: {
    accessToken: string
    items: Array<{
      projectId: string
      slotId: string
      sourcePath: string
      sourceFilename: string
      destinationFilename: string
      destinationPath: string
      plannedSequence: number
      sha256: string
      sizeBytes: number
      projectCode: string
      slotCode: string
      assetKind: 'IMG' | 'VID' | 'OTHER'
      mimeType: string
    }>
  }) => {
    return electronAPI.ipcRenderer.invoke('execute-filesystem-stream-plan', request)
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
