/// <reference types="vite/client" />

declare global {
  type CharacterArcExportRequest = {
    data: unknown
    title?: string
    defaultPath?: string
  }

  type CharacterArcImportMeta = {
    schemaVersion: string
    moduleType: import('@/types/app').ImportExportModuleType
    compatibilityNote: string
    isLegacy: boolean
  }

  type CharacterArcAiStreamEvent =
    | {
        streamId: string
        type: 'chunk'
        delta: string
      }
    | {
        streamId: string
        type: 'done' | 'canceled'
        content?: string
      }
    | {
        streamId: string
        type: 'error'
        error: string
      }

  type CharacterArcAssistantVisibilityPayload = {
    visible: boolean
  }

  type CharacterArcAssistantContextPayload = {
    selectedProjectId?: string
    selectedChapterId?: string
    currentChapterSelection?: {
      chapterId: string
      text: string
    } | null
  }

  type CharacterArcAssistantCommand =
    | {
        type: 'insert-into-chapter'
        content: string
        mode: import('@/types/app').ChapterInsertionMode
      }
    | {
        type: 'update-chapter-title'
        value: string
      }
    | {
        type: 'update-chapter-summary'
        value: string
      }
    | {
        type: 'create-outline-item'
        payload: Partial<import('@/types/app').OutlineItem>
      }

  type CharacterArcAssistantPromptPayload = {
    id: string
    prompt: string
    quickAction?: string
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
      startAiStream: (payload: unknown) => Promise<{
        success: boolean
        result?: {
          streamId: string
        }
        error?: string
      }>
      stopAiStream: (streamId: string) => Promise<{
        success: boolean
        error?: string
      }>
      onAiStreamEvent: (callback: (payload: CharacterArcAiStreamEvent) => void) => () => void
      testAiConnection: (settings: unknown) => Promise<{
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
      setZoomFactor: (factor: number) => Promise<{
        success: boolean
        factor?: number
        error?: string
      }>
      getZoomFactor: () => Promise<{
        success: boolean
        factor?: number
        error?: string
      }>
      importJson: () => Promise<{
        success: boolean
        canceled: boolean
        payload?: unknown
        meta?: CharacterArcImportMeta
        error?: string
      }>
      scanProjectSkills: () => Promise<{
        success: boolean
        skills?: Array<import('@/types/app').ProjectSkillItem>
        error?: string
      }>
      getProjectSkillsContext: () => Promise<{
        success: boolean
        skills?: Array<{
          id: string
          name: string
          description: string
          content: string
        }>
        error?: string
      }>
      openAssistantWindow: () => Promise<{
        success: boolean
        visible?: boolean
        error?: string
      }>
      closeAssistantWindow: () => Promise<{
        success: boolean
        visible?: boolean
        error?: string
      }>
      getAssistantWindowState: () => Promise<{
        success: boolean
        visible?: boolean
        error?: string
      }>
      publishAssistantContext: (payload: CharacterArcAssistantContextPayload) => Promise<{
        success: boolean
        error?: string
      }>
      getAssistantContext: () => Promise<{
        success: boolean
        payload?: CharacterArcAssistantContextPayload
        error?: string
      }>
      publishAssistantPrompt: (payload: CharacterArcAssistantPromptPayload) => Promise<{
        success: boolean
        error?: string
      }>
      getAssistantPrompt: () => Promise<{
        success: boolean
        payload?: CharacterArcAssistantPromptPayload | null
        error?: string
      }>
      clearAssistantPrompt: (promptId: string) => Promise<{
        success: boolean
        error?: string
      }>
      publishWorkspaceSync: (payload: unknown) => Promise<{
        success: boolean
        error?: string
      }>
      publishAssistantCommand: (payload: CharacterArcAssistantCommand) => Promise<{
        success: boolean
        error?: string
      }>
      onAssistantWindowVisibility: (callback: (payload: CharacterArcAssistantVisibilityPayload) => void) => () => void
      onAssistantContext: (callback: (payload: CharacterArcAssistantContextPayload) => void) => () => void
      onAssistantPrompt: (callback: (payload: CharacterArcAssistantPromptPayload | null) => void) => () => void
      onWorkspaceSync: (callback: (payload: unknown) => void) => () => void
      onAssistantCommand: (callback: (payload: CharacterArcAssistantCommand) => void) => () => void
    }
  }
}

export {}
