import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createClient } from '@supabase/supabase-js'
import icon from '../../resources/icon.png?asset'

type DetectedFileType = 'image' | 'video' | 'other'

type PlannedFile = {
  absolutePath: string
  filename: string
  name: string
  fullPath: string
  parentRelativePath: string
  fileType: DetectedFileType
  sha256: string
  relativePath: string
  sizeBytes: number
  extension: string
}

type IngestionPlan = {
  root: string
  rootPath: string
  totalFiles: number
  totalFolders: number
  totalBytes: number
  totalSizeBytes: number
  foldersScanned: number
  byExt: Record<string, number>
  folders: string[]
  files: PlannedFile[]
}

type ScanResult =
  | { success: true; plan: IngestionPlan }
  | { success: false; error: string; plan: IngestionPlan }

type ScanOptions = {
  ignoreHidden?: boolean
  ignoreSystemFiles?: boolean
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

type VerifyDestinationRequestItem = {
  filePath: string
  expectedSizeBytes: number | null
  expectedFilename: string | null
}

type VerifyDestinationResultItem = {
  filePath: string
  localPath: string
  exists: boolean
  filenameMatches: boolean
  sizeMatches: boolean
  actualSizeBytes: number | null
  error: string | null
}

type ExecutionUploadItem = {
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
}

type UploadResultItem = {
  projectId: string
  slotId: string
  sourcePath: string
  destinationFilename: string
  destinationPath: string
  status: 'success' | 'failed' | 'skipped'
  skippedReason: string | null
  error: string | null
}

type StreamedFileWriteResult = {
  sourcePath: string
  destinationFilename: string
  destinationPath: string
}

type ExecuteUploadResult =
  | {
      success: true
      uploadedCount: number
      skippedCount: number
      failedCount: number
      results: UploadResultItem[]
      executionResults: ExecutionResult[]
    }
  | {
      success: false
      uploadedCount: number
      skippedCount: number
      failedCount: number
      results: UploadResultItem[]
      executionResults: ExecutionResult[]
      failedItem: ExecutionUploadItem
      error: string
    }

type ExecutionRequest = {
  accessToken: string
  destinationRootPath: string
  items: ExecutionUploadItem[]
}

type ExecutionResult = {
  projectId: string
  slotId: string
  sourcePath: string
  finalPath: string
  plannedFilename: string
  sha256: string
  sizeBytes: number
  plannedSequence: number
  status: 'success' | 'failed' | 'skipped'
  error?: string
}

const HIDDEN_FOLDERS = new Set(['.git', 'node_modules', '__MACOSX'])
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

function getSupabaseExecutionClient(accessToken: string) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables in main process.')
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  })
}

async function validateLocalDirectory(candidatePath: string): Promise<string> {
  const normalizedPath = path.resolve(candidatePath.trim())
  const stats = await fs.promises.stat(normalizedPath)
  if (!stats.isDirectory()) {
    throw new Error('Selected path is not a directory.')
  }

  await fs.promises.access(normalizedPath, fs.constants.R_OK | fs.constants.W_OK)
  return normalizedPath
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
  private readonly destinationRootPath: string

  constructor(destinationRootPath: string) {
    this.destinationRootPath = destinationRootPath
  }

  private resolveDestinationDir(projectCode: string, assetKind: string, slotCode: string): string {
    return path.join(this.destinationRootPath, projectCode, 'source', assetKind, slotCode)
  }

  async uploadStream(item: ExecutionUploadItem): Promise<StreamedFileWriteResult> {
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

async function projectUploadExistsBySha256(
  supabaseClient: ReturnType<typeof getSupabaseExecutionClient>,
  projectId: string,
  sha256: string
): Promise<boolean> {
  const { data, error } = await supabaseClient
    .from('project_uploads')
    .select('id')
    .eq('project_id', projectId)
    .eq('sha256', sha256)
    .eq('is_source_file', true)
    .limit(1)

  if (error) {
    throw error
  }

  return Array.isArray(data) && data.length > 0
}

async function insertProjectUploadSuccess(
  supabaseClient: ReturnType<typeof getSupabaseExecutionClient>,
  item: ExecutionUploadItem
): Promise<void> {
  const { error } = await supabaseClient.from('project_uploads').insert({
    project_id: item.projectId,
    slot_id: item.slotId,
    upload_source: 'garuda',
    is_source_file: true,
    upload_stage: 'completed',
    file_path: item.destinationPath,
    original_filename: item.sourceFilename,
    final_filename: item.destinationFilename,
    sha256: item.sha256,
    file_size: item.sizeBytes,
    sequence_number: item.plannedSequence,
    completed_at: new Date().toISOString()
  })

  if (error) {
    throw error
  }
}

async function updateSlotCurrentSequence(
  supabaseClient: ReturnType<typeof getSupabaseExecutionClient>,
  slotId: string,
  nextSequence: number
): Promise<void> {
  const { data, error } = await supabaseClient.from('project_slots').select('current_sequence').eq('id', slotId).single()
  if (error) {
    throw error
  }

  const currentSequence =
    data && typeof data.current_sequence === 'number' && Number.isFinite(data.current_sequence) ? data.current_sequence : 0

  const targetSequence = Math.max(currentSequence, nextSequence)
  const { error: updateError } = await supabaseClient
    .from('project_slots')
    .update({ current_sequence: targetSequence })
    .eq('id', slotId)

  if (updateError) {
    throw updateError
  }
}

function shouldIgnoreDirectory(name: string): boolean {
  return HIDDEN_FOLDERS.has(name) || name.startsWith('.')
}

function shouldIgnoreFile(name: string): boolean {
  return name === '.DS_Store' || name.startsWith('.')
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
  options: ScanOptions,
  collector: PlannedFile[],
  folders: Set<string>,
  byExt: Record<string, number>
): Promise<void> {
  ensureNotCancelled(control)

  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(currentFolder, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    ensureNotCancelled(control)
    const fullPath = path.join(currentFolder, entry.name)

    try {
      if (entry.isSymbolicLink()) {
        // Ignore symlinks to avoid traversal loops.
        continue
      }

      const isDirectory = entry.isDirectory()
      const isFile = entry.isFile()

      if (isDirectory) {
        if (options.ignoreHidden !== false && shouldIgnoreDirectory(entry.name)) {
          continue
        }

        const relativeFolder = path.relative(rootFolder, fullPath).replace(/\\/g, '/')
        folders.add(relativeFolder === '' ? '/' : relativeFolder)
        await collectFilesRecursive(rootFolder, fullPath, control, options, collector, folders, byExt)
        continue
      }

      if (!isFile) {
        continue
      }

      if (options.ignoreSystemFiles !== false && shouldIgnoreFile(entry.name)) {
        continue
      }

      const relativePath = path.relative(rootFolder, fullPath).replace(/\\/g, '/')
      const parentRelativeRaw = path.dirname(relativePath).replace(/\\/g, '/')
      const parentRelativePath = parentRelativeRaw === '.' ? '/' : parentRelativeRaw
      const extension = path.extname(entry.name).toLowerCase()
      const fileStats = await fs.promises.stat(fullPath)
      const sha256 = await hashFileSha256(fullPath, control)
      byExt[extension || '(no_ext)'] = (byExt[extension || '(no_ext)'] ?? 0) + 1

      collector.push({
        absolutePath: fullPath,
        fullPath,
        name: entry.name,
        filename: entry.name,
        relativePath,
        parentRelativePath,
        sizeBytes: fileStats.size,
        extension,
        fileType: detectFileType(extension),
        sha256
      })
    } catch {
      continue
    }
  }
}

function emptyIngestionPlan(rootFolder: string): IngestionPlan {
  return {
    root: path.basename(rootFolder),
    rootPath: rootFolder,
    totalFiles: 0,
    totalFolders: 0,
    totalBytes: 0,
    totalSizeBytes: 0,
    foldersScanned: 0,
    byExt: {},
    folders: [],
    files: []
  }
}

async function buildIngestionPlan(rootFolder: string, control: ScanControl, options: ScanOptions): Promise<IngestionPlan> {
  const files: PlannedFile[] = []
  const folders = new Set<string>()
  const byExt: Record<string, number> = {}
  await collectFilesRecursive(rootFolder, rootFolder, control, options, files, folders, byExt)
  ensureNotCancelled(control)

  const totalSizeBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0)
  const normalizedFolders = Array.from(folders.values()).sort((a, b) => a.localeCompare(b))

  return {
    root: path.basename(rootFolder),
    rootPath: rootFolder,
    totalFiles: files.length,
    totalFolders: normalizedFolders.length + 1,
    totalBytes: totalSizeBytes,
    totalSizeBytes,
    foldersScanned: normalizedFolders.length,
    byExt,
    folders: normalizedFolders,
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

  ipcMain.handle('validate-folder-readable', async (_event, candidatePath: string | null) => {
    if (!candidatePath || candidatePath.trim().length === 0) {
      return { valid: false, normalizedPath: null, error: 'Path is required.' }
    }

    try {
      const normalizedPath = path.resolve(candidatePath.trim())
      const stats = await fs.promises.stat(normalizedPath)
      if (!stats.isDirectory()) {
        return { valid: false, normalizedPath: null, error: 'Selected path is not a directory.' }
      }

      await fs.promises.access(normalizedPath, fs.constants.R_OK)
      return { valid: true, normalizedPath, error: null }
    } catch (error: unknown) {
      return { valid: false, normalizedPath: null, error: getErrorMessage(error) }
    }
  })

  /**
   * Folder scan
   */
  ipcMain.handle('scan-folder', async (_event, folderPath: string, options?: ScanOptions) => {
    const scanControl: ScanControl = { cancelled: false }
    activeScanControl = scanControl

    const normalizedRoot = path.resolve(folderPath)
    console.log('[ipc:scan-folder] requested', { folderPath, normalizedRoot, options })

    try {
      const stats = await fs.promises.stat(normalizedRoot)
      if (!stats.isDirectory()) {
        throw new Error('Selected source path is not a directory.')
      }

      await fs.promises.access(normalizedRoot, fs.constants.R_OK)
      const plan = await buildIngestionPlan(normalizedRoot, scanControl, {
        ignoreHidden: options?.ignoreHidden ?? true,
        ignoreSystemFiles: options?.ignoreSystemFiles ?? true
      })
      console.log('[ipc:scan-folder] complete', {
        rootPath: plan.rootPath,
        totalFiles: plan.totalFiles,
        totalFolders: plan.totalFolders,
        totalBytes: plan.totalBytes
      })
      const result: ScanResult = {
        success: true,
        plan
      }
      return result
    } catch (error: unknown) {
      console.error('[ipc:scan-folder] failed', { normalizedRoot, error: getErrorMessage(error) })
      const result: ScanResult = {
        success: false,
        error: getErrorMessage(error),
        plan: emptyIngestionPlan(normalizedRoot)
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

  ipcMain.handle('verify-destination-paths', async (_event, items: VerifyDestinationRequestItem[]) => {
    const results: VerifyDestinationResultItem[] = []

    for (const item of items) {
      try {
        if (!item.filePath || item.filePath.startsWith('local://')) {
          throw new Error('Destination file path is not a local filesystem path.')
        }

        const localPath = path.resolve(item.filePath)
        const stats = await fs.promises.stat(localPath)

        const expectedFilename = item.expectedFilename ?? path.basename(item.filePath)
        const filenameMatches = path.basename(localPath) === expectedFilename
        const sizeMatches = item.expectedSizeBytes === null ? true : stats.size === item.expectedSizeBytes

        results.push({
          filePath: item.filePath,
          localPath,
          exists: true,
          filenameMatches,
          sizeMatches,
          actualSizeBytes: stats.size,
          error: null
        })
      } catch (error: unknown) {
        const localPath = item.filePath ? path.resolve(item.filePath) : ''

        results.push({
          filePath: item.filePath,
          localPath,
          exists: false,
          filenameMatches: false,
          sizeMatches: false,
          actualSizeBytes: null,
          error: getErrorMessage(error)
        })
      }
    }

    return {
      success: true,
      results
    }
  })

  ipcMain.handle('execute-filesystem-stream-plan', async (_event, payload: ExecutionRequest): Promise<ExecuteUploadResult> => {
    const { accessToken, destinationRootPath, items } = payload
    const normalizedDestinationRoot = await validateLocalDirectory(destinationRootPath)
    const adapter = new FilesystemStreamingAdapter(normalizedDestinationRoot)
    const supabaseClient = getSupabaseExecutionClient(accessToken)
    const results: UploadResultItem[] = []
    const executionResults: ExecutionResult[] = []

    let uploadedCount = 0
    let skippedCount = 0
    let failedCount = 0

    const slotTotals = new Map<string, number>()
    const slotSucceeded = new Map<string, number>()
    const slotFailed = new Set<string>()
    const slotMaxInsertedSequence = new Map<string, number>()

    for (const item of items) {
      slotTotals.set(item.slotId, (slotTotals.get(item.slotId) ?? 0) + 1)
    }

    const finalizeSlotSequences = async () => {
      for (const [slotId, total] of slotTotals.entries()) {
        if (slotFailed.has(slotId)) {
          continue
        }

        const succeeded = slotSucceeded.get(slotId) ?? 0
        if (succeeded !== total) {
          continue
        }

        const maxSequence = slotMaxInsertedSequence.get(slotId)
        if (!maxSequence) {
          continue
        }

        await updateSlotCurrentSequence(supabaseClient, slotId, maxSequence)
      }
    }

    for (const item of items) {
      try {
        const alreadyExists = await projectUploadExistsBySha256(supabaseClient, item.projectId, item.sha256)
        if (alreadyExists) {
          skippedCount += 1
          slotSucceeded.set(item.slotId, (slotSucceeded.get(item.slotId) ?? 0) + 1)
          const skippedResult: UploadResultItem = {
            projectId: item.projectId,
            slotId: item.slotId,
            sourcePath: item.sourcePath,
            destinationFilename: item.destinationFilename,
            destinationPath: item.destinationPath,
            status: 'skipped',
            skippedReason: 'sha256 already exists for this project',
            error: null
          }
          results.push(skippedResult)
          executionResults.push({
            projectId: item.projectId,
            slotId: item.slotId,
            sourcePath: item.sourcePath,
            finalPath: item.destinationPath,
            plannedFilename: item.destinationFilename,
            sha256: item.sha256,
            sizeBytes: item.sizeBytes,
            plannedSequence: item.plannedSequence,
            status: 'skipped'
          })
          continue
        }

        const uploaded = await adapter.uploadStream(item)
        const destinationStats = await fs.promises.stat(uploaded.destinationPath)
        if (destinationStats.size !== item.sizeBytes) {
          throw new Error(
            `Size mismatch after stream write. Expected ${item.sizeBytes} bytes, got ${destinationStats.size} bytes.`
          )
        }

        await insertProjectUploadSuccess(supabaseClient, item)

        uploadedCount += 1
        slotSucceeded.set(item.slotId, (slotSucceeded.get(item.slotId) ?? 0) + 1)
        const previousMax = slotMaxInsertedSequence.get(item.slotId) ?? 0
        slotMaxInsertedSequence.set(item.slotId, Math.max(previousMax, item.plannedSequence))

        results.push({
          projectId: item.projectId,
          slotId: item.slotId,
          sourcePath: uploaded.sourcePath,
          destinationFilename: uploaded.destinationFilename,
          destinationPath: uploaded.destinationPath,
          status: 'success',
          skippedReason: null,
          error: null
        })
        executionResults.push({
          projectId: item.projectId,
          slotId: item.slotId,
          sourcePath: item.sourcePath,
          finalPath: item.destinationPath,
          plannedFilename: item.destinationFilename,
          sha256: item.sha256,
          sizeBytes: item.sizeBytes,
          plannedSequence: item.plannedSequence,
          status: 'success'
        })
      } catch (error: unknown) {
        failedCount += 1
        slotFailed.add(item.slotId)
        const message = getErrorMessage(error)

        results.push({
          projectId: item.projectId,
          slotId: item.slotId,
          sourcePath: item.sourcePath,
          destinationFilename: item.destinationFilename,
          destinationPath: item.destinationPath,
          status: 'failed',
          skippedReason: null,
          error: message
        })
        executionResults.push({
          projectId: item.projectId,
          slotId: item.slotId,
          sourcePath: item.sourcePath,
          finalPath: item.destinationPath,
          plannedFilename: item.destinationFilename,
          sha256: item.sha256,
          sizeBytes: item.sizeBytes,
          plannedSequence: item.plannedSequence,
          status: 'failed',
          error: message
        })

        await finalizeSlotSequences()

        return {
          success: false,
          uploadedCount,
          skippedCount,
          failedCount,
          results,
          executionResults,
          failedItem: item,
          error: message
        }
      }
    }

    await finalizeSlotSequences()

    return {
      success: true,
      uploadedCount,
      skippedCount,
      failedCount,
      results,
      executionResults
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
