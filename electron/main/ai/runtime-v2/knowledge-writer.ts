/**
 * knowledge-writer · Runtime v2 knowledge_save_document 持久化
 *
 * 旧 agent 会把 producedKnowledgeDocuments 回灌给 renderer 再合并；
 * Runtime v2 在主进程内运行，直接写 workspace db 并刷新 snapshot 更简单可靠。
 */

import { randomUUID } from 'node:crypto'
import type { AiKnowledgeDocumentDraft } from '../shared-types'
import { ensureWorkspaceDb } from '../../workspace-store'

export interface SaveKnowledgeDocumentDeps {
  onSaved?: () => Promise<void> | void
}

export interface SaveKnowledgeDocumentInput {
  projectId: string
  draft: AiKnowledgeDocumentDraft
}

export async function saveRuntimeKnowledgeDocument(
  input: SaveKnowledgeDocumentInput,
  deps: SaveKnowledgeDocumentDeps = {}
): Promise<string> {
  const projectId = input.projectId.trim()
  if (!projectId) throw new Error('保存知识文档失败：缺少 projectId')

  const draft = input.draft
  const title = draft.title.trim()
  const content = draft.content.trim()
  if (!title || !content) throw new Error('保存知识文档失败：title 或 content 为空')

  const now = new Date().toISOString()
  const id = `knowledge-${randomUUID()}`
  const summary = (draft.summary ?? '').trim() || content.slice(0, 220)
  const keywords = Array.isArray(draft.keywords)
    ? draft.keywords.map((keyword) => String(keyword).trim()).filter(Boolean)
    : []
  const metadata = draft.metadata && typeof draft.metadata === 'object'
    ? draft.metadata
    : {}

  const db = await ensureWorkspaceDb()
  db.prepare(`
    INSERT INTO knowledge_documents (
      id, project_id, title, source_type, source_label, content, summary,
      keywords_json, metadata_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    projectId,
    title,
    draft.sourceType,
    draft.sourceLabel.trim(),
    content,
    summary,
    JSON.stringify(keywords),
    JSON.stringify(metadata),
    now,
    now
  )

  await deps.onSaved?.()
  return id
}
