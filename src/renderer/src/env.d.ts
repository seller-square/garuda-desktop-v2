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

  interface Window {
    api: {
      selectFolder: () => Promise<string | null>
      scanFolder: (folderPath: string) => Promise<ScanResult>
    }
  }
}
