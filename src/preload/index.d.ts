import { ElectronAPI } from '@electron-toolkit/preload'

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

type DriveExecutionUploadItem = {
  sourcePath: string
  destinationFilename: string
  projectCode: string
  slotCode: string
  assetKind: 'IMG' | 'VID' | 'OTHER'
  mimeType: string
}

type DriveUploadResultItem = {
  sourcePath: string
  destinationFilename: string
  fileId: string
  driveFolderId: string
}

type ExecuteDriveUploadResult =
  | { success: true; uploadedCount: number; results: DriveUploadResultItem[] }
  | {
      success: false
      uploadedCount: number
      results: DriveUploadResultItem[]
      failedItem: DriveExecutionUploadItem
      error: string
    }

interface GarudaApi {
  selectFolder: () => Promise<string | null>
  scanFolder: (folderPath: string) => Promise<ScanResult>
  cancelScanFolder: () => Promise<{ success: boolean }>
  getDriveRootPath: () => Promise<DriveRootConfig>
  validateDriveRootPath: (candidatePath: string | null) => Promise<DrivePathValidation>
  setDriveRootPath: (candidatePath: string | null) => Promise<SaveDriveRootResult>
  dryRunStreamOpen: (items: DryRunRequestItem[]) => Promise<DryRunResult>
  executeDriveUploadPlan: (items: DriveExecutionUploadItem[]) => Promise<ExecuteDriveUploadResult>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: GarudaApi
  }
}
