import { ElectronAPI } from '@electron-toolkit/preload'

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

type SaveDriveRootResult = {
  success: boolean
  driveRootPath: string | null
  error: string | null
}

interface GarudaApi {
  selectFolder: () => Promise<string | null>
  scanFolder: (folderPath: string) => Promise<ScanResult>
  getDriveRootPath: () => Promise<DriveRootConfig>
  validateDriveRootPath: (candidatePath: string | null) => Promise<DrivePathValidation>
  setDriveRootPath: (candidatePath: string | null) => Promise<SaveDriveRootResult>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: GarudaApi
  }
}
