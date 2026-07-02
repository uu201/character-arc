/**
 * StagedChangeCommitter · 变更 → 业务库写入的分发中枢
 *
 * StagedChangesStore.commit(committer) 逐条调用 committer。
 * 按 change.kind 分发到对应写库函数。
 */

import { randomUUID } from 'node:crypto'
import type {
  StagedChange,
  StagedChangeCommitResult
} from '@shared/assistant-runtime'
import { ensureWorkspaceDb } from '../../workspace-store'
import type { WorkflowDocumentKey } from '../../workspace-types'
import { commitChapterEdit } from '../agent/tools/chapter-data-access'
import type { StagedChangeCommitter } from './staged-changes-store'

/**
 * 缺 projectId 的问题：`commitChapterEdit(projectId, chapterId, ...)` 需要 projectId。
 * 从 change 本身推不出。这里通过依赖注入拿：由 ConversationManager 查 session.projectId。
 */
export interface CreateCommitterDeps {
  resolveProjectId: (sessionId: string) => string | null
  onCommitted?: () => Promise<void> | void
}

const WORKFLOW_DOCUMENT_KEYS = new Set<WorkflowDocumentKey>([
  'task_plan',
  'findings',
  'progress',
  'current_status',
  'novel_setting',
  'character_relationships',
  'pending_hooks',
  'resource_ledger'
])

export function createCommitter(deps: CreateCommitterDeps): StagedChangeCommitter {
  return async (change: StagedChange) => {
    const projectId = deps.resolveProjectId(change.sessionId)
    if (!projectId) {
      return {
        changeId: change.id,
        ok: false,
        error: `找不到 sessionId=${change.sessionId} 对应的 projectId`
      }
    }

    let result: StagedChangeCommitResult
    switch (change.kind) {
      case 'chapter':
        result = await commitChapter(change, projectId)
        break
      case 'worldview':
        result = await commitWorldview(change, projectId)
        break
      case 'character':
        result = await commitCharacter(change, projectId)
        break
      case 'outline':
        result = await commitOutline(change, projectId)
        break
      case 'organization':
        result = await commitOrganization(change, projectId)
        break
      case 'constraint':
        result = await commitConstraint(change, projectId)
        break
      case 'plot_thread':
        result = await commitPlotThread(change, projectId)
        break
      case 'workflow_document':
        result = await commitWorkflowDocument(change, projectId)
        break
      default:
        result = {
          changeId: change.id,
          ok: false,
          error: `kind="${change.kind}" 的写回尚未实现（Phase 2 后续补齐）`
        }
    }

    if (result.ok) {
      await deps.onCommitted?.()
    }
    return result
  }
}

function readPayload(change: StagedChange): Record<string, unknown> {
  if (!change.entityPayload || typeof change.entityPayload !== 'object') {
    throw new Error('变更缺少结构化 entityPayload，无法写回')
  }
  return change.entityPayload
}

function stringField(payload: Record<string, unknown>, key: string, fallback = ''): string {
  const value = payload[key]
  return typeof value === 'string' ? value.trim() : fallback
}

function tagLabels(payload: Record<string, unknown>): Array<{ label: string; tone?: string }> {
  const raw = payload.tags
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (typeof item === 'string') return { label: item.trim() }
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>
        const label = typeof record.label === 'string' ? record.label.trim() : ''
        const tone = typeof record.tone === 'string' ? record.tone.trim() : ''
        return tone ? { label, tone } : { label }
      }
      return { label: '' }
    })
    .filter((tag) => tag.label)
}

function defaultAvatar(name: string): string {
  const seed = Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const hueA = seed % 360
  const hueB = (hueA + 42) % 360
  return `linear-gradient(135deg, hsl(${hueA} 72% 68%) 0%, hsl(${hueB} 72% 56%) 100%)`
}

function defaultColor(name: string): string {
  const seed = Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const hueA = (seed + 160) % 360
  const hueB = (hueA + 36) % 360
  return `linear-gradient(135deg, hsl(${hueA} 65% 62%) 0%, hsl(${hueB} 62% 48%) 100%)`
}

function stringArrayField(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key]
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : []
}

async function commitWorldview(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const now = new Date().toISOString()
  const title = stringField(payload, 'title')
  const content = stringField(payload, 'content')
  const type = stringField(payload, 'type', '设定')

  if (!title || !content) {
    return { changeId: change.id, ok: false, error: '世界观变更缺少 title 或 content' }
  }

  if (change.action === 'create') {
    const id = `world-${randomUUID()}`
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS value FROM worldview_entries WHERE project_id = ?')
      .get(projectId) as { value: number } | undefined
    db.prepare(`
      INSERT INTO worldview_entries (id, project_id, type, title, content, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, type, title, content, Number(maxOrder?.value ?? -1) + 1, now, now)
    return { changeId: change.id, ok: true, entityId: id }
  }

  if (!change.entityId) {
    return { changeId: change.id, ok: false, error: '世界观 update 缺少 entityId' }
  }

  const result = db.prepare(`
    UPDATE worldview_entries
    SET type = ?, title = ?, content = ?, updated_at = ?
    WHERE id = ? AND project_id = ?
  `).run(type, title, content, now, change.entityId, projectId)
  if (result.changes === 0) {
    return { changeId: change.id, ok: false, error: `世界观条目不存在：${change.entityId}` }
  }
  return { changeId: change.id, ok: true, entityId: change.entityId }
}

async function commitCharacter(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const name = stringField(payload, 'name')
  const role = stringField(payload, 'role')
  const description = stringField(payload, 'description')
  const tags = tagLabels(payload)

  if (!name || !description) {
    return { changeId: change.id, ok: false, error: '人物变更缺少 name 或 description' }
  }

  if (change.action === 'create') {
    const id = `character-${randomUUID()}`
    db.prepare(`
      INSERT INTO characters (id, project_id, name, role, description, avatar, tags_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, name, role, description, defaultAvatar(name), JSON.stringify(tags))
    return { changeId: change.id, ok: true, entityId: id }
  }

  if (!change.entityId) {
    return { changeId: change.id, ok: false, error: '人物 update 缺少 entityId' }
  }

  const existing = db.prepare('SELECT avatar FROM characters WHERE id = ? AND project_id = ?')
    .get(change.entityId, projectId) as { avatar: string } | undefined
  if (!existing) {
    return { changeId: change.id, ok: false, error: `人物不存在：${change.entityId}` }
  }

  const result = db.prepare(`
    UPDATE characters
    SET name = ?, role = ?, description = ?, avatar = ?, tags_json = ?
    WHERE id = ? AND project_id = ?
  `).run(name, role, description, existing.avatar || defaultAvatar(name), JSON.stringify(tags), change.entityId, projectId)
  if (result.changes === 0) {
    return { changeId: change.id, ok: false, error: `人物不存在：${change.entityId}` }
  }
  return { changeId: change.id, ok: true, entityId: change.entityId }
}

async function ensureOutlineVolume(projectId: string, requestedVolumeId: string): Promise<string> {
  const db = await ensureWorkspaceDb()
  if (requestedVolumeId) {
    const existing = db.prepare('SELECT id FROM outline_volumes WHERE id = ? AND project_id = ?')
      .get(requestedVolumeId, projectId) as { id: string } | undefined
    if (existing) return existing.id
  }

  const first = db.prepare('SELECT id FROM outline_volumes WHERE project_id = ? ORDER BY sort_order ASC LIMIT 1')
    .get(projectId) as { id: string } | undefined
  if (first) return first.id

  const id = `volume-${randomUUID()}`
  db.prepare(`
    INSERT INTO outline_volumes (id, project_id, title, word_target, summary, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, projectId, '故事开端', '目标 5万字', '用于承载当前项目的默认分卷。', 0)
  return id
}

async function commitOutline(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const title = stringField(payload, 'title')
  const summary = stringField(payload, 'summary')
  const conflict = stringField(payload, 'conflict')
  const wordTarget = stringField(payload, 'wordTarget') || stringField(payload, 'word_target', '预估 3000字')
  const volumeId = await ensureOutlineVolume(projectId, stringField(payload, 'volumeId') || stringField(payload, 'volume_id'))

  if (!title || !summary) {
    return { changeId: change.id, ok: false, error: '大纲变更缺少 title 或 summary' }
  }

  if (change.action === 'create') {
    const id = `outline-${randomUUID()}`
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS value FROM outline_items WHERE project_id = ? AND volume_id = ?')
      .get(projectId, volumeId) as { value: number } | undefined
    db.prepare(`
      INSERT INTO outline_items (id, project_id, volume_id, title, word_target, conflict, summary, status, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, volumeId, title, wordTarget, conflict, summary, 'planned', Number(maxOrder?.value ?? -1) + 1)
    return { changeId: change.id, ok: true, entityId: id }
  }

  if (!change.entityId) {
    return { changeId: change.id, ok: false, error: '大纲 update 缺少 entityId' }
  }

  const result = db.prepare(`
    UPDATE outline_items
    SET volume_id = ?, title = ?, word_target = ?, conflict = ?, summary = ?
    WHERE id = ? AND project_id = ?
  `).run(volumeId, title, wordTarget, conflict, summary, change.entityId, projectId)
  if (result.changes === 0) {
    return { changeId: change.id, ok: false, error: `大纲节点不存在：${change.entityId}` }
  }
  return { changeId: change.id, ok: true, entityId: change.entityId }
}

async function commitWorkflowDocument(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const now = new Date().toISOString()
  const rawKey = stringField(payload, 'key') || stringField(payload, 'docKey') || stringField(payload, 'doc_key')
  const key = WORKFLOW_DOCUMENT_KEYS.has(rawKey as WorkflowDocumentKey)
    ? rawKey as WorkflowDocumentKey
    : null
  const title = stringField(payload, 'title')
  const content = stringField(payload, 'content')
  const volumeId = await ensureOutlineVolume(projectId, stringField(payload, 'volumeId') || stringField(payload, 'volume_id'))

  if (!key || !title || !content) {
    return { changeId: change.id, ok: false, error: '创作记忆变更缺少 key、title 或 content' }
  }

  const existing = db.prepare(`
    SELECT id
    FROM workflow_documents
    WHERE project_id = ? AND volume_id = ? AND doc_key = ?
  `).get(projectId, volumeId, key) as { id: string } | undefined

  const id = existing?.id || change.entityId || `${projectId}-${volumeId}-${key}`
  if (existing) {
    db.prepare(`
      UPDATE workflow_documents
      SET title = ?, content = ?, updated_at = ?
      WHERE id = ? AND project_id = ?
    `).run(title, content, now, existing.id, projectId)
    return { changeId: change.id, ok: true, entityId: existing.id }
  }

  const maxOrder = db.prepare(`
    SELECT COALESCE(MAX(sort_order), -1) AS value
    FROM workflow_documents
    WHERE project_id = ? AND volume_id = ?
  `).get(projectId, volumeId) as { value: number } | undefined
  db.prepare(`
    INSERT INTO workflow_documents (id, project_id, volume_id, doc_key, title, content, updated_at, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, projectId, volumeId, key, title, content, now, Number(maxOrder?.value ?? -1) + 1)
  return { changeId: change.id, ok: true, entityId: id }
}

async function commitOrganization(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const now = new Date().toISOString()
  const name = stringField(payload, 'name')
  const type = stringField(payload, 'type')
  const description = stringField(payload, 'description')
  const motto = stringField(payload, 'motto')

  if (!name || !type || !description) {
    return { changeId: change.id, ok: false, error: '组织变更缺少 name、type 或 description' }
  }

  if (change.action === 'create') {
    const id = `organization-${randomUUID()}`
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS value FROM organizations WHERE project_id = ?')
      .get(projectId) as { value: number } | undefined
    db.prepare(`
      INSERT INTO organizations (id, project_id, name, type, description, motto, color, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, name, type, description, motto, defaultColor(name), Number(maxOrder?.value ?? -1) + 1, now, now)
    return { changeId: change.id, ok: true, entityId: id }
  }

  if (!change.entityId) {
    return { changeId: change.id, ok: false, error: '组织 update 缺少 entityId' }
  }

  const existing = db.prepare('SELECT color FROM organizations WHERE id = ? AND project_id = ?')
    .get(change.entityId, projectId) as { color: string } | undefined
  if (!existing) {
    return { changeId: change.id, ok: false, error: `组织不存在：${change.entityId}` }
  }

  const result = db.prepare(`
    UPDATE organizations
    SET name = ?, type = ?, description = ?, motto = ?, color = ?, updated_at = ?
    WHERE id = ? AND project_id = ?
  `).run(name, type, description, motto, existing.color || defaultColor(name), now, change.entityId, projectId)
  if (result.changes === 0) {
    return { changeId: change.id, ok: false, error: `组织不存在：${change.entityId}` }
  }
  return { changeId: change.id, ok: true, entityId: change.entityId }
}

async function commitConstraint(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const now = new Date().toISOString()
  const title = stringField(payload, 'title')
  const content = stringField(payload, 'content')
  const scope = stringField(payload, 'scope', 'project')
  const rawWeight = stringField(payload, 'weight', 'core')
  const weight = rawWeight === 'important' || rawWeight === 'supporting' ? rawWeight : 'core'
  const locked = payload.locked === false ? false : true
  const keywords = stringArrayField(payload, 'keywords')

  if (!title || !content) {
    return { changeId: change.id, ok: false, error: '项目约束缺少 title 或 content' }
  }

  const metadata = { scope, weight, locked }
  const summary = content.length > 120 ? `${content.slice(0, 120)}…` : content

  if (change.action === 'create') {
    const id = `constraint-${randomUUID()}`
    db.prepare(`
      INSERT INTO knowledge_documents (id, project_id, title, source_type, source_label, content, summary, keywords_json, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      title,
      'canon-fact',
      'global-constraint',
      content,
      summary,
      JSON.stringify(keywords),
      JSON.stringify(metadata),
      now,
      now
    )
    return { changeId: change.id, ok: true, entityId: id }
  }

  if (!change.entityId) {
    return { changeId: change.id, ok: false, error: '项目约束 update 缺少 entityId' }
  }

  const result = db.prepare(`
    UPDATE knowledge_documents
    SET title = ?, content = ?, summary = ?, keywords_json = ?, metadata_json = ?, updated_at = ?
    WHERE id = ? AND project_id = ? AND source_type = 'canon-fact' AND source_label = 'global-constraint'
  `).run(title, content, summary, JSON.stringify(keywords), JSON.stringify(metadata), now, change.entityId, projectId)
  if (result.changes === 0) {
    return { changeId: change.id, ok: false, error: `项目约束不存在：${change.entityId}` }
  }
  return { changeId: change.id, ok: true, entityId: change.entityId }
}

async function commitPlotThread(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  const db = await ensureWorkspaceDb()
  const payload = readPayload(change)
  const now = new Date().toISOString()
  const title = stringField(payload, 'title')
  const description = stringField(payload, 'description')
  const openedInChapterId = stringField(payload, 'openedInChapterId') || stringField(payload, 'opened_in_chapter_id')
  const closedInChapterId = stringField(payload, 'closedInChapterId') || stringField(payload, 'closed_in_chapter_id')
  const rawStatus = stringField(payload, 'status', 'open')
  const status = rawStatus === 'resolved' ? 'resolved' : 'open'
  const tags = stringArrayField(payload, 'tags')

  if (!title || !description) {
    return { changeId: change.id, ok: false, error: '剧情线索缺少 title 或 description' }
  }

  if (change.action === 'create') {
    const id = `plot-thread-${randomUUID()}`
    db.prepare(`
      INSERT INTO plot_threads (id, project_id, title, description, opened_in_chapter_id, status, closed_in_chapter_id, tags_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, title, description, openedInChapterId, status, closedInChapterId, JSON.stringify(tags), now, now)
    return { changeId: change.id, ok: true, entityId: id }
  }

  if (!change.entityId) {
    return { changeId: change.id, ok: false, error: '剧情线索 update 缺少 entityId' }
  }

  const result = db.prepare(`
    UPDATE plot_threads
    SET title = ?, description = ?, opened_in_chapter_id = ?, status = ?, closed_in_chapter_id = ?, tags_json = ?, updated_at = ?
    WHERE id = ? AND project_id = ?
  `).run(title, description, openedInChapterId, status, closedInChapterId, JSON.stringify(tags), now, change.entityId, projectId)
  if (result.changes === 0) {
    return { changeId: change.id, ok: false, error: `剧情线索不存在：${change.entityId}` }
  }
  return { changeId: change.id, ok: true, entityId: change.entityId }
}

async function commitChapter(
  change: StagedChange,
  projectId: string
): Promise<StagedChangeCommitResult> {
  if (change.action !== 'update') {
    return { changeId: change.id, ok: false, error: `章节暂只支持 update` }
  }
  if (!change.entityId || !change.chapterHtml) {
    return { changeId: change.id, ok: false, error: '章节变更缺少 entityId 或 chapterHtml' }
  }
  try {
    await commitChapterEdit(
      projectId,
      change.entityId,
      change.chapterHtml.old,
      change.chapterHtml.new
    )
    return { changeId: change.id, ok: true, entityId: change.entityId }
  } catch (e) {
    return {
      changeId: change.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}
