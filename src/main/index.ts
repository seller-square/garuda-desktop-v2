import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import fs from 'fs'
import path from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

type ScannedFile = {
  name: string
  path: string
  size: number
  extension: string
}

type ScanResult =
  | { success: true; count: number; files: ScannedFile[] }
  | { success: false; error: string }

type DriveRootConfig = {
  driveRootPath: string | null
  updatedAt: string | null
}

type DrivePathValidation = {
  valid: boolean
  normalizedPath: string | null
  error: string | null
}

const CONFIG_FILE_NAME = 'garuda-config.json'

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function getConfigPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE_NAME)
}

function readDriveRootConfig(): DriveRootConfig {
  const configPath = getConfigPath()

  if (!fs.existsSync(configPath)) {
    return { driveRootPath: null, updatedAt: null }
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<DriveRootConfig>
    return {
      driveRootPath: typeof parsed.driveRootPath === 'string' ? parsed.driveRootPath : null,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null
    }
  } catch {
    return { driveRootPath: null, updatedAt: null }
  }
}

function writeDriveRootConfig(config: DriveRootConfig): void {
  const configPath = getConfigPath()
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
}

function validateDriveRootPath(candidatePath: string | null): DrivePathValidation {
  if (!candidatePath || candidatePath.trim().length === 0) {
    return { valid: false, normalizedPath: null, error: 'Drive root path is required.' }
  }

  try {
    const normalizedPath = path.resolve(candidatePath.trim())
    const stats = fs.statSync(normalizedPath)

    if (!stats.isDirectory()) {
      return { valid: false, normalizedPath: null, error: 'Selected path is not a directory.' }
    }

    fs.accessSync(normalizedPath, fs.constants.R_OK | fs.constants.W_OK)

    return { valid: true, normalizedPath, error: null }
  } catch (error: unknown) {
    return {
      valid: false,
      normalizedPath: null,
      error: `Invalid path: ${getErrorMessage(error)}`
    }
  }
}

/**
 * Recursively scans a directory and returns file metadata
 */
function scanDirectoryRecursive(dirPath: string): {
  name: string
  path: string
  size: number
  extension: string
}[] {
  let results: ScannedFile[] = []

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
      const result: ScanResult = {
        success: true,
        count: files.length,
        files
      }
      return result
    } catch (error: unknown) {
      const result: ScanResult = {
        success: false,
        error: getErrorMessage(error)
      }
      return result
    }
  })

  ipcMain.handle('get-drive-root-path', async () => {
    const config = readDriveRootConfig()
    return config
  })

  ipcMain.handle('validate-drive-root-path', async (_event, candidatePath: string | null) => {
    return validateDriveRootPath(candidatePath)
  })

  ipcMain.handle('set-drive-root-path', async (_event, candidatePath: string | null) => {
    if (candidatePath === null || candidatePath.trim() === '') {
      writeDriveRootConfig({ driveRootPath: null, updatedAt: new Date().toISOString() })
      return { success: true, driveRootPath: null, error: null }
    }

    const validation = validateDriveRootPath(candidatePath)
    if (!validation.valid || !validation.normalizedPath) {
      return { success: false, driveRootPath: null, error: validation.error ?? 'Invalid path.' }
    }

    writeDriveRootConfig({
      driveRootPath: validation.normalizedPath,
      updatedAt: new Date().toISOString()
    })

    return { success: true, driveRootPath: validation.normalizedPath, error: null }
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
