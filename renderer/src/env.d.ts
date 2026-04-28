/// <reference types="vite/client" />

declare global {
  type CharacterArcExportRequest = {
    data: unknown
    title?: string
    defaultPath?: string
  }

  interface Window {
    characterArc: {
      platform: string
      version: string
      loadWorkspace: () => Promise<{
        success: boolean
        payload?: unknown
        error?: string
      }>
      saveWorkspace: (payload: unknown) => Promise<{
        success: boolean
        error?: string
      }>
      pickCoverImage: () => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
        dataUrl?: string
      }>
      generateAi: (payload: unknown) => Promise<{
        success: boolean
        result?: unknown
        error?: string
      }>
      exportJson: (payload: CharacterArcExportRequest | unknown) => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
      }>
      exportText: (payload: CharacterArcExportRequest | unknown) => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
      }>
      importJson: () => Promise<{
        success: boolean
        canceled: boolean
        payload?: unknown
        error?: string
      }>
    }
  }
}

export {}
