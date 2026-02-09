/// <reference types="vite/client" />

export {}

declare global {
  type DetectedFileType = 'image' | 'video' | 'other'

  type ScannedFile = {
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
    files: ScannedFile[]
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

  type SaveDriveRootResult = {
    success: boolean
    driveRootPath: string | null
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

  type DryRunResult = {
    success: boolean
    results: DryRunFileResult[]
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

  interface Window {
    api: {
      selectFolder: () => Promise<string | null>
      scanFolder: (folderPath: string) => Promise<ScanResult>
      cancelScanFolder: () => Promise<{ success: boolean }>
      getDriveRootPath: () => Promise<DriveRootConfig>
      validateDriveRootPath: (candidatePath: string | null) => Promise<DrivePathValidation>
      setDriveRootPath: (candidatePath: string | null) => Promise<SaveDriveRootResult>
      dryRunStreamOpen: (items: DryRunRequestItem[]) => Promise<DryRunResult>
      executeFilesystemStreamPlan: (request: ExecuteFilesystemStreamRequest) => Promise<ExecuteFilesystemStreamResult>
    }
  }
}
