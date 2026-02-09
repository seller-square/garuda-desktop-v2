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

interface GarudaApi {
  selectFolder: () => Promise<string | null>
  scanFolder: (folderPath: string) => Promise<ScanResult>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: GarudaApi
  }
}
