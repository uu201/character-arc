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
        /** 当前已生成的总字符数（用于显示字数进度） */
        charCount?: number
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
    activeAgentProposal?: import('@/types/app').AgentProposal | null
    agentConfirmationState?: import('@/types/app').AgentConfirmationState | null
    agentExecutionStep?: import('@/types/app').AgentExecutionStep
    agentIntentState?: import('@/types/app').AgentIntentKind
  }

  type CharacterArcAssistantCommand =
    | {
        type: 'insert-into-chapter'
        kind?: import('@/types/app').AssistantCommandKind
        target?: import('@/types/app').AssistantCommandTarget
        reason?: string
        preview?: import('@/types/app').AgentProposalPreview
        destructive?: boolean
        requiresConfirmation?: boolean
        content: string
        mode: import('@/types/app').ChapterInsertionMode
      }
    | {
        type: 'update-chapter-title'
        kind?: import('@/types/app').AssistantCommandKind
        target?: import('@/types/app').AssistantCommandTarget
        reason?: string
        preview?: import('@/types/app').AgentProposalPreview
        destructive?: boolean
        requiresConfirmation?: boolean
        value: string
      }
    | {
        type: 'update-chapter-summary'
        kind?: import('@/types/app').AssistantCommandKind
        target?: import('@/types/app').AssistantCommandTarget
        reason?: string
        preview?: import('@/types/app').AgentProposalPreview
        destructive?: boolean
        requiresConfirmation?: boolean
        value: string
      }
    | {
        type: 'create-outline-item'
        kind?: import('@/types/app').AssistantCommandKind
        target?: import('@/types/app').AssistantCommandTarget
        reason?: string
        preview?: import('@/types/app').AgentProposalPreview
        destructive?: boolean
        requiresConfirmation?: boolean
        payload: Partial<import('@/types/app').OutlineItem>
      }
    | {
        type: 'append-workflow-document-entry'
        kind?: import('@/types/app').AssistantCommandKind
        target?: import('@/types/app').AssistantCommandTarget
        reason?: string
        preview?: import('@/types/app').AgentProposalPreview
        destructive?: boolean
        requiresConfirmation?: boolean
        documentKey: import('@/types/app').WorkflowDocumentKey
        entryTitle: string
        content: string
        volumeId?: string
      }
    | {
        type: 'update-workflow-document'
        kind?: import('@/types/app').AssistantCommandKind
        target?: import('@/types/app').AssistantCommandTarget
        reason?: string
        preview?: import('@/types/app').AgentProposalPreview
        destructive?: boolean
        requiresConfirmation?: boolean
        documentKey: import('@/types/app').WorkflowDocumentKey
        content: string
        volumeId?: string
      }
    | {
        type: 'save-knowledge-document'
        kind?: import('@/types/app').AssistantCommandKind
        target?: import('@/types/app').AssistantCommandTarget
        reason?: string
        preview?: import('@/types/app').AgentProposalPreview
        destructive?: boolean
        requiresConfirmation?: boolean
        document: Partial<import('@/types/app').KnowledgeDocument>
      }

  type CharacterArcAssistantPromptPayload = {
    id: string
    prompt: string
    quickAction?: string
  }

  type CharacterArcReferenceImportPayload = {
    settings: import('@/types/app').AppSettings
    projectId?: string
    projectTitle?: string
    projectGenre?: string
    projectPlatform?: string
    preferredTitle?: string
    preferredSource?: string
    projectSkills?: Array<{
      id: string
      name: string
      description: string
      content: string
    }>
  }

  type CharacterArcReferenceImportResult = {
    referenceWork: import('@/types/app').ReferenceWorkItem
    suggestedWritingStylePrompt: string
    knowledgeDocuments: import('@/types/app').KnowledgeDocument[]
  }

  type CharacterArcReferenceImportProgressPayload = {
    phase: 'extracting' | 'chunking' | 'chunk-analysis' | 'aggregating' | 'saving' | 'done'
    message: string
    current: number
    total: number
    percent: number
    sourceTitle?: string
  }

  type CharacterArcAiRunEventPayload = {
    projectId: string
    meta: Omit<import('@/types/app').AiRunRecord, 'projectId'>
  }

  type CharacterArcChapterStateWarningsPayload = {
    projectId: string
    chapterId: string
    chapterIndex: number
    generatedAt: string
    violations: Array<{
      type: 'location_mismatch' | 'item_not_owned' | 'timeline_break' | 'rule_violation' | 'state_conflict'
      severity: 'error' | 'warning'
      message: string
    }>
  }

  type CharacterArcBackfillStateProgressPayload = {
    projectId: string
    current: number
    total: number
    chapterTitle: string
    phase: 'extracting' | 'applying' | 'done'
  }

  type CharacterArcBackfillStateResult = {
    totalChapters: number
    processedChapters: number
    skipped: number
  }

  type CharacterArcAssistantMessagePayload = {
    role: 'user' | 'assistant'
    content: string
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
      saveAppSettings: (
        payload: import('@shared/ipc-types').SaveAppSettingsRequest
      ) => Promise<import('@shared/ipc-types').IpcResult>
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
      cancelAiTask: (clientTaskId: string) => Promise<{
        success: boolean
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
      onAiRunEvent: (callback: (payload: CharacterArcAiRunEventPayload) => void) => () => void
      onChapterStateWarnings: (callback: (payload: CharacterArcChapterStateWarningsPayload) => void) => () => void
      spiralBootstrap: (payload: unknown) => Promise<{
        success: boolean
        result?: import('@/features/wizard/projectSeed').SpiralBootstrapResult
        error?: string
      }>
      cancelSpiralBootstrap: () => Promise<{
        success: boolean
        error?: string
      }>
      onSpiralProgress: (callback: (payload: { phase: 'seed' | 'expand' | 'validate'; status: 'running' | 'done' | 'error'; error?: string }) => void) => () => void
      backfillProjectState: (payload: { settings: import('@/types/app').AppSettings; projectId: string }) => Promise<{
        success: boolean
        result?: CharacterArcBackfillStateResult
        error?: string
      }>
      onBackfillStateProgress: (callback: (payload: CharacterArcBackfillStateProgressPayload) => void) => () => void
      readStoryState: (projectId: string) => Promise<{
        success: boolean
        result?: {
          characterStates: Array<{
            characterId: string
            chapterIndex: number
            location: string
            physicalState: string
            mentalState: string
            arcStage: string
            powerLevel: string
            knowledge: string[]
            inventory: string[]
            goals: string[]
          }>
          activeForeshadowing: Array<{
            foreshadowingId: string
            type: string
            description: string
            status: 'active' | 'advanced' | 'resolved' | 'abandoned'
            plantedChapter: number
            plantedMethod: string
            payoffChapter: number | null
            resolvedChapter: number | null
            clues: Array<{ chapter: number; clue: string; method?: string }>
            connections: string[]
          }>
          relationships: Array<{
            relationshipId: string
            participantA: string
            participantB: string
            currentStatus: string
            tensionPoints: string[]
            trajectory: string
            lastInteractionChapter: number | null
          }>
          recentTimeline: Array<{
            chapterIndex: number
            storyDate: string
            events: string[]
            worldStateChanges: string[]
          }>
          worldRules: Array<{
            ruleId: string
            ruleContent: string
            establishedChapter: number
            exceptions: string[]
            mustComply: boolean
          }>
          activeClocks: Array<{
            clockId: string
            eventDescription: string
            deadlineChapter: number | null
            status: 'active' | 'expired' | 'resolved'
            urgency: string
          }>
        }
        error?: string
      }>
      testAiConnection: (settings: unknown) => Promise<{
        success: boolean
        result?: unknown
        error?: string
      }>
      fetchModels: (settings: unknown) => Promise<{
        success: boolean
        result?: Array<{ id: string; ownedBy: string | null }>
        error?: string
      }>
      fetchImageModels: (settings: unknown) => Promise<{
        success: boolean
        result?: Array<{ id: string; ownedBy: string | null }>
        error?: string
      }>
      generateImage: (payload: { settings: import('@/types/app').AppSettings; prompt: string }) => Promise<{
        success: boolean
        result?: {
          dataUrl: string
          revisedPrompt?: string
        }
        error?: string
      }>
      saveCoverImage: (payload: { dataUrl: string; defaultFileName?: string }) => Promise<{
        success: boolean
        canceled?: boolean
        filePath?: string
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
      exportChapterTxt: (payload: { title?: string; content?: string; defaultFileName?: string }) => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
        error?: string
      }>
      exportChapterDocx: (payload: { title?: string; content?: string; defaultFileName?: string }) => Promise<{
        success: boolean
        canceled: boolean
        filePath?: string
        error?: string
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
      setTitleBarOverlay: (options: { color: string; symbolColor: string }) => Promise<void>
      importJson: () => Promise<{
        success: boolean
        canceled: boolean
        payload?: unknown
        meta?: CharacterArcImportMeta
        error?: string
      }>
      importReferenceNovelAnalysis: (payload: CharacterArcReferenceImportPayload) => Promise<{
        success: boolean
        canceled: boolean
        result?: CharacterArcReferenceImportResult
        error?: string
      }>
      readReferenceNovelText: (refId: string) => Promise<{
        success: boolean
        content?: string
        error?: string
      }>
      scanProjectSkills: (projectId: string) => Promise<{
        success: boolean
        skills?: Array<import('@/types/app').ProjectSkillItem>
        error?: string
      }>
      importProjectSkillsPackage: (projectId: string) => Promise<{
        success: boolean
        canceled: boolean
        importedSkillIds?: string[]
        error?: string
      }>
      getProjectSkillsContext: (projectId: string) => Promise<{
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
      publishAssistantMessage: (payload: CharacterArcAssistantMessagePayload) => Promise<{
        success: boolean
        error?: string
      }>
      publishAssistantCommand: (payload: CharacterArcAssistantCommand) => Promise<{
        success: boolean
        error?: string
      }>
      approveAssistantProposal: () => Promise<{
        success: boolean
        error?: string
      }>
      rejectAssistantProposal: () => Promise<{
        success: boolean
        error?: string
      }>
      clearAssistantProposal: () => Promise<{
        success: boolean
        error?: string
      }>
      onAssistantProposalApprove: (callback: () => void) => () => void
      onAssistantProposalReject: (callback: () => void) => () => void
      onAssistantProposalClear: (callback: () => void) => () => void
      onAssistantWindowVisibility: (callback: (payload: CharacterArcAssistantVisibilityPayload) => void) => () => void
      onAssistantContext: (callback: (payload: CharacterArcAssistantContextPayload) => void) => () => void
      onAssistantPrompt: (callback: (payload: CharacterArcAssistantPromptPayload | null) => void) => () => void
      onWorkspaceSync: (callback: (payload: unknown) => void) => () => void
      onReferenceImportProgress: (callback: (payload: CharacterArcReferenceImportProgressPayload) => void) => () => void
      onAssistantMessage: (callback: (payload: CharacterArcAssistantMessagePayload) => void) => () => void
      onAssistantCommand: (callback: (payload: CharacterArcAssistantCommand) => void) => () => void
    }
  }
}

export {}
