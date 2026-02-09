/// <reference types="vite/client" />

export {}

declare global {
  type ScannedFile = {
    absolutePath: string
    relativePath: string
    filename: string
    extension: string
    sizeBytes: number
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
    files: ScannedFile[]
    folders: string[]
  }

  type ScanOptions = {
    ignoreHidden?: boolean
    ignoreSystemFiles?: boolean
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
    destinationRootPath: string
    items: FilesystemExecutionUploadItem[]
  }

  type FolderReadableValidation = {
    valid: boolean
    normalizedPath: string | null
    error: string | null
  }

  interface Window {
    api: {
      selectFolder: () => Promise<string | null>
      scanFolder: (folderPath: string, options?: ScanOptions) => Promise<ScanResult>
      validateFolderReadable: (candidatePath: string | null) => Promise<FolderReadableValidation>
      cancelScanFolder: () => Promise<{ success: boolean }>
      dryRunStreamOpen: (items: DryRunRequestItem[]) => Promise<DryRunResult>
      verifyDestinationPaths: (items: VerifyDestinationRequestItem[]) => Promise<VerifyDestinationResult>
      executeFilesystemStreamPlan: (request: ExecuteFilesystemStreamRequest) => Promise<ExecuteFilesystemStreamResult>
    }
  }
}
