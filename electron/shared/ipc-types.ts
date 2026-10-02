export interface IpcResult<T = void> {
  success: boolean
  error?: string
  result?: T
}

export interface IpcPayloadResult<T = unknown> {
  success: boolean
  error?: string
  payload?: T
}

export interface AppSettingsPayload {
  provider: string
  model: string
  apiKey: string
  baseUrl: string
  apiProtocol?: 'auto' | 'openai-responses' | 'openai-chat' | 'anthropic'
  codexCliPath?: string
  codexReasoningEffort?: 'default' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
  proxyUrl: string
  temperature?: number
  topP?: number
  presencePenalty?: number
  frequencyPenalty?: number
  aiProfiles: Array<{ id: string; name: string; provider: string; baseUrl: string; apiKey: string; model: string; apiProtocol?: 'auto' | 'openai-responses' | 'openai-chat' | 'anthropic'; codexCliPath?: string; codexReasoningEffort?: 'default' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'; temperature?: number; topP?: number; presencePenalty?: number; frequencyPenalty?: number }>
  activeAiProfileId: string
  imageProvider: string
  imageModel: string
  imageApiKey: string
  imageBaseUrl: string
  autoSaveInterval: string
  uiScale: number
  workspaceMenuOrder: string[]
  darkMode: boolean
  darkModeStyle: string
}

export interface SaveAppSettingsRequest {
  theme: string
  selectedProjectId: string
  appSettings: AppSettingsPayload
}

export interface PersistedChapterRecord {
  id: string
  outlineItemId: string
  volumeId: string
  sortOrder?: number
  title: string
  summary: string
  status: 'draft' | 'review' | 'polish' | 'final'
  wordTarget: string
  content: string
  contentLoaded?: boolean
  contentLength?: number
  contentPreview?: string
  contentEnding?: string
}

export interface SaveChaptersRequest {
  projectId: string
  projectWordCount: string
  chapters: PersistedChapterRecord[]
}

export interface ChapterOrderRecord {
  id: string
  volumeId: string
  sortOrder: number
}

export interface SaveChapterOrderRequest {
  projectId: string
  chapters: ChapterOrderRecord[]
}

export interface PersistedWorldviewEntryRecord {
  id: string
  type: string
  title: string
  content: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface PersistedCharacterRecord {
  id: string
  name: string
  role: string
  description: string
  avatar: string
  tags: Array<{
    label: string
    tone?: 'default' | 'danger' | 'success' | 'warning'
  }>
}

export interface PersistedInspirationEntryRecord {
  id: string
  type: string
  title: string
  content: string
  tags: string[]
  source: 'ai' | 'manual'
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface SaveWorkspaceEntitiesRequest {
  projectId: string
  worldviewEntries?: PersistedWorldviewEntryRecord[]
  characters?: PersistedCharacterRecord[]
  inspirationEntries?: PersistedInspirationEntryRecord[]
}

export interface DatabaseBackupSummary {
  id: string
  createdAt: string
  appVersion: string
  schemaVersion: number
  type: 'pre-upgrade' | 'pre-rollback' | 'manual'
  size: number
}

export type ChapterMutationEvent =
  | ({ kind: 'upsert' } & SaveChaptersRequest)
  | ({ kind: 'reorder' } & SaveChapterOrderRequest)

export const IPC_CHANNELS = {
  LOAD_WORKSPACE: 'characterarc:load-workspace',
  SAVE_WORKSPACE: 'characterarc:save-workspace',
  SAVE_APP_SETTINGS: 'characterarc:save-app-settings',
  SAVE_CHAPTERS: 'characterarc:save-chapters',
  SAVE_CHAPTER_ORDER: 'characterarc:save-chapter-order',
  SAVE_WORKSPACE_ENTITIES: 'characterarc:save-workspace-entities',
  BACKUP_CURRENT_DATABASE: 'characterarc:backup-current-database',
  LIST_DATABASE_BACKUPS: 'characterarc:list-database-backups',
  ROLLBACK_DATABASE: 'characterarc:rollback-database'
} as const

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS]
