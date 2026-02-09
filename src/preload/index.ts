import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

function logInvoke(method: string, ...args: unknown[]) {
  console.log(`[preload:${method}]`, ...args)
}

// Custom APIs for renderer (Garuda APIs)
const api = {
  // Open native folder picker
  selectFolder: () => {
    logInvoke('selectFolder')
    return electronAPI.ipcRenderer.invoke('select-folder')
  },

  // Scan a selected folder recursively
  scanFolder: (folderPath: string, options?: { ignoreHidden?: boolean; ignoreSystemFiles?: boolean }) => {
    logInvoke('scanFolder', { folderPath, options })
    return electronAPI.ipcRenderer.invoke('scan-folder', folderPath, options)
  },

  validateFolderReadable: (candidatePath: string | null) => {
    logInvoke('validateFolderReadable', { candidatePath })
    return electronAPI.ipcRenderer.invoke('validate-folder-readable', candidatePath)
  },

  cancelScanFolder: () => {
    logInvoke('cancelScanFolder')
    return electronAPI.ipcRenderer.invoke('cancel-scan-folder')
  },

  dryRunStreamOpen: (items: Array<{ sourcePath: string; expectedSizeBytes: number }>) => {
    logInvoke('dryRunStreamOpen', { count: items.length })
    return electronAPI.ipcRenderer.invoke('dry-run-stream-open', items)
  },

  verifyDestinationPaths: (
    items: Array<{ filePath: string; expectedSizeBytes: number | null; expectedFilename: string | null }>
  ) => {
    logInvoke('verifyDestinationPaths', { count: items.length })
    return electronAPI.ipcRenderer.invoke('verify-destination-paths', items)
  },

  executeFilesystemStreamPlan: (request: {
    accessToken: string
    destinationRootPath: string
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
    logInvoke('executeFilesystemStreamPlan', { destinationRootPath: request.destinationRootPath, count: request.items.length })
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
