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
  proxyUrl: string
  temperature?: number
  topP?: number
  presencePenalty?: number
  frequencyPenalty?: number
  aiProfiles: Array<{ id: string; name: string; provider: string; baseUrl: string; apiKey: string; model: string; apiProtocol?: 'auto' | 'openai-responses' | 'openai-chat' | 'anthropic'; temperature?: number; topP?: number; presencePenalty?: number; frequencyPenalty?: number }>
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

export const IPC_CHANNELS = {
  LOAD_WORKSPACE: 'characterarc:load-workspace',
  SAVE_WORKSPACE: 'characterarc:save-workspace',
  SAVE_APP_SETTINGS: 'characterarc:save-app-settings'
} as const

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS]
