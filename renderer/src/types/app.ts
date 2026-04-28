export type ThemeName = 'ocean' | 'jade' | 'amber' | 'rose'

export type PanelName = 'overview' | 'world' | 'characters' | 'outline' | 'chapters' | 'settings'

export interface ProjectSummary {
  id: string
  title: string
  genre: string
  wordCount: string
  lastEdited: string
  cover: string
}

export interface WorldviewEntry {
  id: string
  type: string
  title: string
  content: string
}

export interface CharacterTag {
  label: string
  tone?: 'default' | 'danger' | 'success' | 'warning'
}

export interface CharacterCard {
  id: string
  name: string
  role: string
  description: string
  avatar: string
  tags: CharacterTag[]
}

export interface OutlineItem {
  id: string
  title: string
  wordTarget: string
  conflict: string
  summary: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export interface AssistantPromptRequest {
  id: string
  prompt: string
  quickAction?: string
}

export interface ChapterDraft {
  id: string
  title: string
  summary: string
  status: 'draft' | 'review' | 'polish' | 'final'
  wordTarget: string
  content: string
}

export interface ChapterVersion {
  id: string
  chapterId: string
  title: string
  summary: string
  status: ChapterDraft['status']
  wordTarget: string
  content: string
  createdAt: string
}

export interface AppSettings {
  provider: string
  model: string
  apiKey: string
  baseUrl: string
  autoSaveInterval: string
}
