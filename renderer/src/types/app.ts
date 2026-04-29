export type ThemeName = 'ocean' | 'jade' | 'amber' | 'rose'

export type PanelName = 'overview' | 'world' | 'characters' | 'relations' | 'inspiration' | 'outline' | 'chapters' | 'settings'

export interface ProjectSummary {
  id: string
  title: string
  genre: string
  wordCount: string
  lastEdited: string
  cover: string
  writingStylePresetId: string
  writingStylePrompt: string
}

export interface WorldviewEntry {
  id: string
  type: string
  title: string
  content: string
  sortOrder: number
  createdAt: string
  updatedAt: string
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

export interface OrganizationEntry {
  id: string
  name: string
  type: string
  description: string
  motto: string
  color: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CharacterRelationship {
  id: string
  fromCharacterId: string
  toCharacterId: string
  type: string
  description: string
  intensity: number
  createdAt: string
  updatedAt: string
}

export interface OrganizationMembership {
  id: string
  characterId: string
  organizationId: string
  role: string
  notes: string
  createdAt: string
  updatedAt: string
}

export interface InspirationEntry {
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

export interface OutlineVolume {
  id: string
  title: string
  wordTarget: string
  summary: string
}

export interface OutlineItem {
  id: string
  volumeId: string
  title: string
  wordTarget: string
  conflict: string
  summary: string
  sortOrder: number
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

export type ChapterInsertionMode = 'cursor' | 'append' | 'replace-selection'

export interface ChapterInsertionRequest {
  id: string
  chapterId: string
  content: string
  mode: ChapterInsertionMode
}

export interface ChapterSelectionState {
  chapterId: string
  text: string
}

export interface ChapterDraft {
  id: string
  volumeId: string
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

export interface ProjectWorkspaceData {
  worldviewEntries: WorldviewEntry[]
  characters: CharacterCard[]
  organizations: OrganizationEntry[]
  characterRelationships: CharacterRelationship[]
  organizationMemberships: OrganizationMembership[]
  inspirationEntries: InspirationEntry[]
  outlineVolumes: OutlineVolume[]
  outlineItems: OutlineItem[]
  chapters: ChapterDraft[]
  chapterVersions: ChapterVersion[]
  messages: ChatMessage[]
}

export interface AppSettings {
  provider: string
  model: string
  apiKey: string
  baseUrl: string
  autoSaveInterval: string
  uiScale: number
}
