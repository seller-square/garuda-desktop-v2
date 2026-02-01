/// <reference types="vite/client" />

export {}

declare global {
  interface Window {
    api: {
      selectFolder: () => Promise<string | null>
      scanFolder: (folderPath: string) => Promise<{
        success: boolean
        count?: number
        files?: {
          name: string
          path: string
          size: number
          extension: string
        }[]
        error?: string
      }>
    }
  }
}