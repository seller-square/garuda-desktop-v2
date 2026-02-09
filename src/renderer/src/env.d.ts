/// <reference types="vite/client" />

export {}

declare global {
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

  interface Window {
    api: {
      selectFolder: () => Promise<string | null>
      scanFolder: (folderPath: string) => Promise<ScanResult>
      getDriveRootPath: () => Promise<DriveRootConfig>
      validateDriveRootPath: (candidatePath: string | null) => Promise<DrivePathValidation>
      setDriveRootPath: (candidatePath: string | null) => Promise<SaveDriveRootResult>
    }
  }
}
