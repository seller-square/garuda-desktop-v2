import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import fs from 'fs'
import path from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

/**
 * Recursively scans a directory and returns file metadata
 */
function scanDirectoryRecursive(dirPath: string): {
  name: string
  path: string
  size: number
  extension: string
}[] {
  let results: any[] = []

  const items = fs.readdirSync(dirPath, { withFileTypes: true })

  for (const item of items) {
    const fullPath = path.join(dirPath, item.name)

    if (item.isDirectory()) {
      results = results.concat(scanDirectoryRecursive(fullPath))
    } else {
      const stats = fs.statSync(fullPath)

      results.push({
        name: item.name,
        path: fullPath,
        size: stats.size,
        extension: path.extname(item.name).toLowerCase()
      })
    }
  }

  return results
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Simple IPC test
  ipcMain.on('ping', () => console.log('pong'))

  /**
   * Folder picker
   */
  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  /**
   * Folder scan
   */
  ipcMain.handle('scan-folder', async (_event, folderPath: string) => {
    try {
      const files = scanDirectoryRecursive(folderPath)
      return {
        success: true,
        count: files.length,
        files
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      }
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})