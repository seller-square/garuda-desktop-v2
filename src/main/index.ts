import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

type DetectedFileType = 'image' | 'video' | 'other'

type PlannedFile = {
  name: string
  fullPath: string
  relativePath: string
  parentRelativePath: string
  size: number
  extension: string
  fileType: DetectedFileType
  sha256: string
}

type FolderGroup = {
  relativePath: string
  fileCount: number
  totalBytes: number
  typeCounts: {
    image: number
    video: number
    other: number
  }
}

type IngestionPlan = {
  rootFolder: string
  scannedAt: string
  totalFiles: number
  totalBytes: number
  folderGroups: FolderGroup[]
  files: PlannedFile[]
}

type ScanResult =
  | { success: true; plan: IngestionPlan }
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

type DryRunRequestItem = {
  sourcePath: string
  expectedSizeBytes: number
}

type DryRunErrorType = 'missing' | 'permission' | 'unreadable' | 'zero_byte' | 'hash_mismatch'

type DryRunFileResult = {
  sourcePath: string
  ok: boolean
  errorType: DryRunErrorType | null
  message: string | null
  expectedSizeBytes: number
  currentSizeBytes: number | null
}

type ExecutionUploadItem = {
  sourcePath: string
  destinationFilename: string
  projectCode: string
  slotCode: string
  assetKind: 'IMG' | 'VID' | 'OTHER'
  mimeType: string
}

type UploadResultItem = {
  sourcePath: string
  destinationFilename: string
  destinationPath: string
}

type ExecuteUploadResult =
  | {
      success: true
      uploadedCount: number
      results: UploadResultItem[]
    }
  | {
      success: false
      uploadedCount: number
      results: UploadResultItem[]
      failedItem: ExecutionUploadItem
      error: string
    }

const CONFIG_FILE_NAME = 'garuda-config.json'
const HIDDEN_FOLDERS = new Set(['.git', 'node_modules'])
const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
  '.heic',
  '.heif',
  '.dng',
  '.arw',
  '.cr2',
  '.cr3',
  '.nef',
  '.orf',
  '.rw2'
])
const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.mkv',
  '.avi',
  '.mxf',
  '.mts',
  '.m2ts',
  '.r3d',
  '.braw',
  '.prores',
  '.webm'
])

type ScanControl = {
  cancelled: boolean
}

let activeScanControl: ScanControl | null = null

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

function classifyFsError(error: unknown): DryRunErrorType {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String(error.code)
    if (code === 'ENOENT') return 'missing'
    if (code === 'EACCES' || code === 'EPERM') return 'permission'
  }

  return 'unreadable'
}

function probeReadStream(sourcePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(sourcePath)

    stream.once('open', () => {
      stream.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })

    stream.once('error', (error) => {
      reject(error)
    })
  })
}

class FilesystemStreamingAdapter {
  private readonly driveRootPath: string

  constructor(driveRootPath: string) {
    this.driveRootPath = driveRootPath
  }

  static createFromLocalConfig(): FilesystemStreamingAdapter {
    const config = readDriveRootConfig()
    if (!config.driveRootPath) {
      throw new Error('Drive root path is not configured. Set it in Settings first.')
    }

    const validation = validateDriveRootPath(config.driveRootPath)
    if (!validation.valid || !validation.normalizedPath) {
      throw new Error(validation.error ?? 'Drive root path is invalid.')
    }

    return new FilesystemStreamingAdapter(validation.normalizedPath)
  }

  private resolveDestinationDir(projectCode: string, assetKind: string, slotCode: string): string {
    return path.join(this.driveRootPath, projectCode, 'source', assetKind, slotCode)
  }

  async uploadStream(item: ExecutionUploadItem): Promise<UploadResultItem> {
    const destinationDir = this.resolveDestinationDir(item.projectCode, item.assetKind, item.slotCode)
    await fs.promises.mkdir(destinationDir, { recursive: true })

    const destinationPath = path.join(destinationDir, item.destinationFilename)

    const sourceStream = fs.createReadStream(item.sourcePath)
    const destinationStream = fs.createWriteStream(destinationPath, { flags: 'w' })

    await pipeline(sourceStream, destinationStream)

    return {
      sourcePath: item.sourcePath,
      destinationFilename: item.destinationFilename,
      destinationPath
    }
  }
}

function shouldIgnoreDirectory(name: string): boolean {
  return HIDDEN_FOLDERS.has(name) || name.startsWith('.')
}

function shouldIgnoreFile(name: string): boolean {
  return name === '.DS_Store'
}

function detectFileType(extension: string): DetectedFileType {
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  return 'other'
}

function ensureNotCancelled(control: ScanControl): void {
  if (control.cancelled) {
    throw new Error('Scan cancelled by user')
  }
}

function hashFileSha256(filePath: string, control: ScanControl): Promise<string> {
  return new Promise((resolve, reject) => {
    ensureNotCancelled(control)

    const hash = createHash('sha256')
    const stream = fs.createReadStream(filePath)

    stream.on('data', (chunk) => {
      if (control.cancelled) {
        stream.destroy(new Error('Scan cancelled by user'))
        return
      }

      hash.update(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    })

    stream.on('error', (error: unknown) => {
      reject(error)
    })

    stream.on('end', () => {
      resolve(hash.digest('hex'))
    })
  })
}

async function collectFilesRecursive(
  rootFolder: string,
  currentFolder: string,
  control: ScanControl,
  collector: PlannedFile[]
): Promise<void> {
  ensureNotCancelled(control)

  const entries = await fs.promises.readdir(currentFolder, { withFileTypes: true })

  for (const entry of entries) {
    ensureNotCancelled(control)

    if (entry.isDirectory()) {
      if (shouldIgnoreDirectory(entry.name)) {
        continue
      }

      const nestedPath = path.join(currentFolder, entry.name)
      await collectFilesRecursive(rootFolder, nestedPath, control, collector)
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    if (shouldIgnoreFile(entry.name)) {
      continue
    }

    const fullPath = path.join(currentFolder, entry.name)
    const relativePath = path.relative(rootFolder, fullPath)
    const parentRelativeRaw = path.dirname(relativePath)
    const parentRelativePath = parentRelativeRaw === '.' ? '/' : parentRelativeRaw
    const extension = path.extname(entry.name).toLowerCase()

    const stats = await fs.promises.stat(fullPath)
    const sha256 = await hashFileSha256(fullPath, control)

    collector.push({
      name: entry.name,
      fullPath,
      relativePath,
      parentRelativePath,
      size: stats.size,
      extension,
      fileType: detectFileType(extension),
      sha256
    })
  }
}

async function buildIngestionPlan(rootFolder: string, control: ScanControl): Promise<IngestionPlan> {
  const files: PlannedFile[] = []
  await collectFilesRecursive(rootFolder, rootFolder, control, files)
  ensureNotCancelled(control)

  const groupsMap = new Map<string, FolderGroup>()

  for (const file of files) {
    const existing = groupsMap.get(file.parentRelativePath)
    if (existing) {
      existing.fileCount += 1
      existing.totalBytes += file.size
      existing.typeCounts[file.fileType] += 1
      continue
    }

    groupsMap.set(file.parentRelativePath, {
      relativePath: file.parentRelativePath,
      fileCount: 1,
      totalBytes: file.size,
      typeCounts: {
        image: file.fileType === 'image' ? 1 : 0,
        video: file.fileType === 'video' ? 1 : 0,
        other: file.fileType === 'other' ? 1 : 0
      }
    })
  }

  const folderGroups = Array.from(groupsMap.values()).sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)

  return {
    rootFolder,
    scannedAt: new Date().toISOString(),
    totalFiles: files.length,
    totalBytes,
    folderGroups,
    files
  }
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
    const scanControl: ScanControl = { cancelled: false }
    activeScanControl = scanControl

    try {
      const plan = await buildIngestionPlan(folderPath, scanControl)
      const result: ScanResult = {
        success: true,
        plan
      }
      return result
    } catch (error: unknown) {
      const result: ScanResult = {
        success: false,
        error: getErrorMessage(error)
      }
      return result
    } finally {
      if (activeScanControl === scanControl) {
        activeScanControl = null
      }
    }
  })

  ipcMain.handle('cancel-scan-folder', async () => {
    if (activeScanControl) {
      activeScanControl.cancelled = true
    }

    return { success: true }
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

  ipcMain.handle('dry-run-stream-open', async (_event, items: DryRunRequestItem[]) => {
    const results: DryRunFileResult[] = []

    for (const item of items) {
      try {
        const stats = await fs.promises.stat(item.sourcePath)

        if (!stats.isFile()) {
          results.push({
            sourcePath: item.sourcePath,
            ok: false,
            errorType: 'unreadable',
            message: 'Path is not a regular file.',
            expectedSizeBytes: item.expectedSizeBytes,
            currentSizeBytes: null
          })
          continue
        }

        if (stats.size === 0) {
          results.push({
            sourcePath: item.sourcePath,
            ok: false,
            errorType: 'zero_byte',
            message: 'File size is zero bytes.',
            expectedSizeBytes: item.expectedSizeBytes,
            currentSizeBytes: stats.size
          })
          continue
        }

        if (stats.size !== item.expectedSizeBytes) {
          results.push({
            sourcePath: item.sourcePath,
            ok: false,
            errorType: 'hash_mismatch',
            message: `Expected ${item.expectedSizeBytes} bytes, found ${stats.size} bytes.`,
            expectedSizeBytes: item.expectedSizeBytes,
            currentSizeBytes: stats.size
          })
          continue
        }

        await probeReadStream(item.sourcePath)

        results.push({
          sourcePath: item.sourcePath,
          ok: true,
          errorType: null,
          message: null,
          expectedSizeBytes: item.expectedSizeBytes,
          currentSizeBytes: stats.size
        })
      } catch (error: unknown) {
        const errorType = classifyFsError(error)
        results.push({
          sourcePath: item.sourcePath,
          ok: false,
          errorType,
          message: getErrorMessage(error),
          expectedSizeBytes: item.expectedSizeBytes,
          currentSizeBytes: null
        })
      }
    }

    return {
      success: true,
      results
    }
  })

  ipcMain.handle('execute-filesystem-stream-plan', async (_event, items: ExecutionUploadItem[]): Promise<ExecuteUploadResult> => {
    const adapter = FilesystemStreamingAdapter.createFromLocalConfig()
    const results: UploadResultItem[] = []

    for (const item of items) {
      try {
        const uploaded = await adapter.uploadStream(item)
        results.push(uploaded)
      } catch (error: unknown) {
        return {
          success: false,
          uploadedCount: results.length,
          results,
          failedItem: item,
          error: getErrorMessage(error)
        }
      }
    }

    return {
      success: true,
      uploadedCount: results.length,
      results
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
