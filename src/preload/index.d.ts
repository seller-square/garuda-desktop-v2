import { ElectronAPI } from '@electron-toolkit/preload'

type ScannedFile = {
  absolutePath: string
  relativePath: string
  filename: string
  extension: string
  size: number
}

type IngestionPlan = {
  root: string
  totalFiles: number
  totalSize: number
  folders: string[]
  files: ScannedFile[]
}

type ScanResult =
  | { success: true; plan: IngestionPlan }
  | { success: false; error: string; plan: IngestionPlan }

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

type DryRunResult = {
  success: boolean
  results: DryRunFileResult[]
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

type VerifyDestinationResult = {
  success: boolean
  results: VerifyDestinationResultItem[]
}

type FilesystemExecutionUploadItem = {
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

type FilesystemUploadResultItem = {
  projectId: string
  slotId: string
  sourcePath: string
  destinationFilename: string
  destinationPath: string
  status: 'success' | 'failed' | 'skipped'
  skippedReason: string | null
  error: string | null
}

type ExecutionResultItem = {
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

type ExecuteFilesystemStreamResult =
  | {
      success: true
      uploadedCount: number
      skippedCount: number
      failedCount: number
      results: FilesystemUploadResultItem[]
      executionResults: ExecutionResultItem[]
    }
  | {
      success: false
      uploadedCount: number
      skippedCount: number
      failedCount: number
      results: FilesystemUploadResultItem[]
      executionResults: ExecutionResultItem[]
      failedItem: FilesystemExecutionUploadItem
      error: string
    }

type ExecuteFilesystemStreamRequest = {
  accessToken: string
  items: FilesystemExecutionUploadItem[]
}

interface GarudaApi {
  selectFolder: () => Promise<string | null>
  scanFolder: (folderPath: string) => Promise<ScanResult>
  cancelScanFolder: () => Promise<{ success: boolean }>
  dryRunStreamOpen: (items: DryRunRequestItem[]) => Promise<DryRunResult>
  verifyDestinationPaths: (items: VerifyDestinationRequestItem[]) => Promise<VerifyDestinationResult>
  executeFilesystemStreamPlan: (request: ExecuteFilesystemStreamRequest) => Promise<ExecuteFilesystemStreamResult>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: GarudaApi
  }
}
