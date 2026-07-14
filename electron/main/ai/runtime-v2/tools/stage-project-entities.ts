/** Runtime v2 尚缺的结构化项目实体暂存工具。 */

import type { Tool } from '../../agent/tools/types'
import { ensureWorkspaceDb } from '../../../workspace-store'
import type { StagedChangesStore } from '../staged-changes-store'

export interface StageProjectEntitiesToolDeps {
  sessionId: string
  turnId: string
  projectId: string
  stagedStore: StagedChangesStore
}

type Action = 'create' | 'update' | 'delete'

const KNOWLEDGE_SOURCE_TYPES = new Set([
  'reference-summary',
  'reference-chunk',
  'workflow-document',
  'canon-fact',
  'chapter-summary'
])

function readString(input: Record<string, unknown>, key: string, fallback = ''): string {
  const value = input[key]
  return typeof value === 'string' ? value.trim() : fallback
}

function hasOwn(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

function readAction(input: Record<string, unknown>): Action | null {
  const action = readString(input, 'action')
  return action === 'create' || action === 'update' || action === 'delete' ? action : null
}

function readStringArray(input: Record<string, unknown>, key: string, limit = 12): string[] {
  const value = input[key]
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, limit)
    : []
}

function safeJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    return safeJsonObject(JSON.parse(value))
  } catch {
    return {}
  }
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function resolveByLabel<T extends { id: string }>(
  rows: T[],
  ref: string,
  getLabel: (row: T) => string
): T | null {
  const normalized = ref.trim().toLowerCase().replace(/\s+/g, '')
  if (!normalized) return null
  const direct = rows.find((row) => row.id === ref.trim())
  if (direct) return direct
  const exact = rows.find((row) => getLabel(row).trim().toLowerCase().replace(/\s+/g, '') === normalized)
  if (exact) return exact
  const contains = rows.filter((row) => getLabel(row).trim().toLowerCase().replace(/\s+/g, '').includes(normalized))
  return contains.length === 1 ? contains[0] : null
}

function actionError(): { content: string; isError: true } {
  return { content: 'action 必须是 create、update 或 delete。', isError: true }
}

function stageChange(
  deps: StageProjectEntitiesToolDeps,
  input: Record<string, unknown>,
  data: {
    kind: 'relationship' | 'organization_membership' | 'inspiration' | 'outline_volume' | 'knowledge_document' | 'project'
    action: Action
    entityId?: string
    entityTitle: string
    before: string
    after: string
    payload: Record<string, unknown>
  }
) {
  return deps.stagedStore.add({
    sessionId: deps.sessionId,
    turnId: deps.turnId,
    kind: data.kind,
    action: data.action,
    entityId: data.entityId,
    entityTitle: data.entityTitle,
    reason: readString(input, 'reason') || '（未提供理由）',
    before: data.before,
    after: data.after,
    entityPayload: data.payload
  })
}

async function readCharacterName(projectId: string, characterId: string): Promise<string | null> {
  const db = await ensureWorkspaceDb()
  const row = db.prepare('SELECT name FROM characters WHERE id = ? AND project_id = ?')
    .get(characterId, projectId) as { name: string } | undefined
  return row?.name ?? null
}

async function readOrganizationName(projectId: string, organizationId: string): Promise<string | null> {
  const db = await ensureWorkspaceDb()
  const row = db.prepare('SELECT name FROM organizations WHERE id = ? AND project_id = ?')
    .get(organizationId, projectId) as { name: string } | undefined
  return row?.name ?? null
}

export function makeStageRelationshipTool(deps: StageProjectEntitiesToolDeps): Tool {
  return {
    definition: {
      name: 'stage_relationship',
      description:
        '暂存人物关系新增、修改或删除。create 需 from_character_id、to_character_id、type、description；update/delete 必须用 read_project_data(relationships) 返回的 match_id 精确定位。',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'update', 'delete'] },
          match_id: { type: 'string', description: 'update/delete 的人物关系 ID。' },
          from_character_id: { type: 'string', description: '起点人物 ID。' },
          to_character_id: { type: 'string', description: '终点人物 ID。' },
          type: { type: 'string', description: '关系类型。' },
          description: { type: 'string', description: '关系描述。' },
          intensity: { type: 'integer', description: '关系强度，0-100。' },
          reason: { type: 'string', description: '新增、修改或删除原因。' }
        },
        required: ['action', 'reason']
      }
    },
    handler: async (input) => {
      const action = readAction(input)
      if (!action) return actionError()
      const db = await ensureWorkspaceDb()
      const matchId = readString(input, 'match_id')
      const before = action === 'create' ? undefined : db.prepare(`
        SELECT id, from_character_id, to_character_id, type, description, intensity
        FROM character_relationships WHERE id = ? AND project_id = ?
      `).get(matchId, deps.projectId) as {
        id: string; from_character_id: string; to_character_id: string; type: string; description: string; intensity: number
      } | undefined
      if (action !== 'create' && !before) {
        return { content: '人物关系不存在；update/delete 请提供准确的 match_id。', isError: true }
      }

      const fromId = hasOwn(input, 'from_character_id') ? readString(input, 'from_character_id') : before?.from_character_id ?? ''
      const toId = hasOwn(input, 'to_character_id') ? readString(input, 'to_character_id') : before?.to_character_id ?? ''
      const relationType = hasOwn(input, 'type') ? readString(input, 'type') : before?.type ?? ''
      const description = hasOwn(input, 'description') ? readString(input, 'description') : before?.description ?? ''
      const intensityValue = hasOwn(input, 'intensity') ? Number(input.intensity) : before?.intensity ?? 50
      const intensity = Number.isFinite(intensityValue) ? Math.min(100, Math.max(0, Math.round(intensityValue))) : -1

      const oldFromName = before ? await readCharacterName(deps.projectId, before.from_character_id) : null
      const oldToName = before ? await readCharacterName(deps.projectId, before.to_character_id) : null
      const beforeText = before
        ? [`人物：${oldFromName ?? before.from_character_id} → ${oldToName ?? before.to_character_id}`, `类型：${before.type}`, `强度：${before.intensity}`, `描述：${before.description}`].join('\n')
        : ''
      if (action === 'delete') {
        const change = stageChange(deps, input, {
          kind: 'relationship', action, entityId: before!.id,
          entityTitle: `${oldFromName ?? before!.from_character_id} → ${oldToName ?? before!.to_character_id}`,
          before: beforeText, after: '', payload: { ...before }
        })
        return { content: `已暂存人物关系删除（change_id=${change.id}）。尚未写回，需用户确认。` }
      }

      const fromName = await readCharacterName(deps.projectId, fromId)
      const toName = await readCharacterName(deps.projectId, toId)
      if (!fromName || !toName) return { content: 'from_character_id 或 to_character_id 不属于当前项目。', isError: true }
      if (!relationType || !description || intensity < 0) {
        return { content: '人物关系缺少合法的 type、description 或 intensity。', isError: true }
      }
      const afterText = [`人物：${fromName} → ${toName}`, `类型：${relationType}`, `强度：${intensity}`, `描述：${description}`].join('\n')
      if (beforeText === afterText) return { content: '人物关系没有发生变化。', isError: true }
      const change = stageChange(deps, input, {
        kind: 'relationship', action, entityId: before?.id,
        entityTitle: `${fromName} → ${toName}`, before: beforeText, after: afterText,
        payload: { fromCharacterId: fromId, toCharacterId: toId, type: relationType, description, intensity }
      })
      return { content: `已暂存人物关系${action === 'create' ? '新增' : '修改'}（change_id=${change.id}）：${fromName} → ${toName}。尚未写回，需用户确认。` }
    }
  }
}

export function makeStageOrganizationMembershipTool(deps: StageProjectEntitiesToolDeps): Tool {
  return {
    definition: {
      name: 'stage_organization_membership',
      description:
        '暂存人物组织归属的新增、修改或删除。create 需 character_id、organization_id、role；update/delete 必须用 read_project_data(organization_memberships) 返回的 match_id。',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'update', 'delete'] },
          match_id: { type: 'string', description: 'update/delete 的成员归属 ID。' },
          character_id: { type: 'string', description: '人物 ID。' },
          organization_id: { type: 'string', description: '组织 ID。' },
          role: { type: 'string', description: '人物在组织中的身份。' },
          notes: { type: 'string', description: '补充说明，可为空。' },
          reason: { type: 'string', description: '新增、修改或删除原因。' }
        },
        required: ['action', 'reason']
      }
    },
    handler: async (input) => {
      const action = readAction(input)
      if (!action) return actionError()
      const db = await ensureWorkspaceDb()
      const before = action === 'create' ? undefined : db.prepare(`
        SELECT id, character_id, organization_id, role, notes
        FROM organization_memberships WHERE id = ? AND project_id = ?
      `).get(readString(input, 'match_id'), deps.projectId) as {
        id: string; character_id: string; organization_id: string; role: string; notes: string
      } | undefined
      if (action !== 'create' && !before) {
        return { content: '组织成员归属不存在；update/delete 请提供准确的 match_id。', isError: true }
      }
      const characterId = hasOwn(input, 'character_id') ? readString(input, 'character_id') : before?.character_id ?? ''
      const organizationId = hasOwn(input, 'organization_id') ? readString(input, 'organization_id') : before?.organization_id ?? ''
      const role = hasOwn(input, 'role') ? readString(input, 'role') : before?.role ?? ''
      const notes = hasOwn(input, 'notes') ? readString(input, 'notes') : before?.notes ?? ''
      const oldCharacter = before ? await readCharacterName(deps.projectId, before.character_id) : null
      const oldOrganization = before ? await readOrganizationName(deps.projectId, before.organization_id) : null
      const beforeText = before
        ? [`人物：${oldCharacter ?? before.character_id}`, `组织：${oldOrganization ?? before.organization_id}`, `身份：${before.role}`, `说明：${before.notes || '（空）'}`].join('\n')
        : ''
      if (action === 'delete') {
        const change = stageChange(deps, input, {
          kind: 'organization_membership', action, entityId: before!.id,
          entityTitle: `${oldCharacter ?? before!.character_id} @ ${oldOrganization ?? before!.organization_id}`,
          before: beforeText, after: '', payload: { ...before }
        })
        return { content: `已暂存组织成员归属删除（change_id=${change.id}）。尚未写回，需用户确认。` }
      }
      const characterName = await readCharacterName(deps.projectId, characterId)
      const organizationName = await readOrganizationName(deps.projectId, organizationId)
      if (!characterName || !organizationName) return { content: 'character_id 或 organization_id 不属于当前项目。', isError: true }
      if (!role) return { content: 'role 不能为空。', isError: true }
      const afterText = [`人物：${characterName}`, `组织：${organizationName}`, `身份：${role}`, `说明：${notes || '（空）'}`].join('\n')
      if (beforeText === afterText) return { content: '组织成员归属没有发生变化。', isError: true }
      const change = stageChange(deps, input, {
        kind: 'organization_membership', action, entityId: before?.id,
        entityTitle: `${characterName} @ ${organizationName}`, before: beforeText, after: afterText,
        payload: { characterId, organizationId, role, notes }
      })
      return { content: `已暂存组织成员归属${action === 'create' ? '新增' : '修改'}（change_id=${change.id}）：${characterName} @ ${organizationName}。尚未写回，需用户确认。` }
    }
  }
}

export function makeStageInspirationTool(deps: StageProjectEntitiesToolDeps): Tool {
  return {
    definition: {
      name: 'stage_inspiration',
      description: '暂存灵感卡片新增、修改或删除。update/delete 可用 match_id 或 match_title 定位；tags 最多保留 8 个。',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'update', 'delete'] },
          match_id: { type: 'string' },
          match_title: { type: 'string' },
          type: { type: 'string', description: '灵感类型。' },
          title: { type: 'string', description: '灵感标题。' },
          content: { type: 'string', description: '灵感内容。' },
          tags: { type: 'array', items: { type: 'string' } },
          source: { type: 'string', enum: ['ai', 'manual'] },
          reason: { type: 'string' }
        },
        required: ['action', 'reason']
      }
    },
    handler: async (input) => {
      const action = readAction(input)
      if (!action) return actionError()
      const db = await ensureWorkspaceDb()
      const rows = db.prepare(`
        SELECT id, type, title, content, tags_json, source FROM inspiration_entries
        WHERE project_id = ? ORDER BY sort_order
      `).all(deps.projectId) as Array<{ id: string; type: string; title: string; content: string; tags_json: string; source: string }>
      const ref = readString(input, 'match_id') || readString(input, 'match_title')
      const before = action === 'create' ? undefined : resolveByLabel(rows, ref, (row) => row.title) ?? undefined
      if (action !== 'create' && !before) return { content: '无法定位灵感卡片，请提供准确的 match_id 或唯一标题。', isError: true }
      const type = hasOwn(input, 'type') ? readString(input, 'type') : before?.type ?? '场景火花'
      const title = hasOwn(input, 'title') ? readString(input, 'title') : before?.title ?? ''
      const content = hasOwn(input, 'content') ? readString(input, 'content') : before?.content ?? ''
      const tags = hasOwn(input, 'tags') ? readStringArray(input, 'tags', 8) : parseJsonArray(before?.tags_json ?? '[]')
      const source = hasOwn(input, 'source') ? readString(input, 'source') : before?.source ?? 'ai'
      const render = (entry: { type: string; title: string; content: string; tags: string[]; source: string }) => [
        `类型：${entry.type}`, `标题：${entry.title}`, `来源：${entry.source}`,
        `标签：${entry.tags.join(' / ') || '（空）'}`, `内容：${entry.content}`
      ].join('\n')
      const beforeText = before ? render({ ...before, tags: parseJsonArray(before.tags_json) }) : ''
      if (action === 'delete') {
        const change = stageChange(deps, input, {
          kind: 'inspiration', action, entityId: before!.id, entityTitle: before!.title,
          before: beforeText, after: '', payload: { title: before!.title }
        })
        return { content: `已暂存灵感删除（change_id=${change.id}）：${before!.title}。尚未写回，需用户确认。` }
      }
      if (!type || !title || !content || !['ai', 'manual'].includes(source)) {
        return { content: '灵感卡片缺少合法的 type、title、content 或 source。', isError: true }
      }
      const afterText = render({ type, title, content, tags, source })
      if (beforeText === afterText) return { content: '灵感卡片没有发生变化。', isError: true }
      const change = stageChange(deps, input, {
        kind: 'inspiration', action, entityId: before?.id, entityTitle: title,
        before: beforeText, after: afterText, payload: { type, title, content, tags, source }
      })
      return { content: `已暂存灵感${action === 'create' ? '新增' : '修改'}（change_id=${change.id}）：${title}。尚未写回，需用户确认。` }
    }
  }
}

type VolumeRow = { id: string; title: string; word_target: string; summary: string; sort_order: number }

export function makeListOutlineVolumesTool(deps: StageProjectEntitiesToolDeps): Tool {
  return {
    definition: {
      name: 'list_outline_volumes',
      description: '列出当前项目分卷及其 volume_id、章节数和大纲节点数，供章节/大纲绑定与分卷维护工具使用。',
      inputSchema: { type: 'object', properties: {} }
    },
    handler: async () => {
      const db = await ensureWorkspaceDb()
      const rows = db.prepare(`
        SELECT v.id, v.title, v.word_target, v.summary,
          (SELECT COUNT(*) FROM chapters c WHERE c.project_id = v.project_id AND c.volume_id = v.id) AS chapter_count,
          (SELECT COUNT(*) FROM outline_items o WHERE o.project_id = v.project_id AND o.volume_id = v.id) AS outline_count
        FROM outline_volumes v WHERE v.project_id = ? ORDER BY v.sort_order
      `).all(deps.projectId) as Array<VolumeRow & { chapter_count: number; outline_count: number }>
      if (!rows.length) return { content: '当前项目没有分卷。' }
      return {
        content: rows.map((row, index) => [
          `${index + 1}. [${row.id}] ${row.title}`,
          `字数目标：${row.word_target}`,
          `摘要：${row.summary || '（空）'}`,
          `章节数：${row.chapter_count}；大纲节点数：${row.outline_count}`
        ].join('\n')).join('\n\n')
      }
    }
  }
}

export function makeStageOutlineVolumeTool(deps: StageProjectEntitiesToolDeps): Tool {
  return {
    definition: {
      name: 'stage_outline_volume',
      description:
        '暂存分卷新增、修改或删除。update/delete 可用 match_id 或 match_title；删除时会把章节和大纲节点迁移到 fallback_volume_id（缺省为相邻分卷），且项目至少保留一个分卷。',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'update', 'delete'] },
          match_id: { type: 'string' },
          match_title: { type: 'string' },
          title: { type: 'string' },
          word_target: { type: 'string' },
          summary: { type: 'string' },
          fallback_volume_id: { type: 'string', description: '删除时承接章节和大纲节点的分卷 ID。' },
          reason: { type: 'string' }
        },
        required: ['action', 'reason']
      }
    },
    handler: async (input) => {
      const action = readAction(input)
      if (!action) return actionError()
      const db = await ensureWorkspaceDb()
      const rows = db.prepare(`
        SELECT id, title, word_target, summary, sort_order FROM outline_volumes
        WHERE project_id = ? ORDER BY sort_order
      `).all(deps.projectId) as VolumeRow[]
      const ref = readString(input, 'match_id') || readString(input, 'match_title')
      const before = action === 'create' ? undefined : resolveByLabel(rows, ref, (row) => row.title) ?? undefined
      if (action !== 'create' && !before) return { content: '无法定位分卷，请提供准确的 match_id 或唯一标题。', isError: true }
      const render = (volume: { title: string; wordTarget: string; summary: string }) => [
        `标题：${volume.title}`, `字数目标：${volume.wordTarget}`, `摘要：${volume.summary || '（空）'}`
      ].join('\n')
      const beforeText = before ? render({ title: before.title, wordTarget: before.word_target, summary: before.summary }) : ''
      if (action === 'delete') {
        if (rows.length <= 1) return { content: '项目至少需要保留一个分卷，无法删除最后一个分卷。', isError: true }
        const requestedFallback = readString(input, 'fallback_volume_id')
        const beforeIndex = rows.findIndex((row) => row.id === before!.id)
        const fallback = requestedFallback
          ? rows.find((row) => row.id === requestedFallback && row.id !== before!.id)
          : rows.filter((row) => row.id !== before!.id)[Math.max(0, beforeIndex - 1)] ?? rows.find((row) => row.id !== before!.id)
        if (!fallback) return { content: 'fallback_volume_id 无效或指向待删除分卷。', isError: true }
        const chapterCount = (db.prepare('SELECT COUNT(*) AS value FROM chapters WHERE project_id = ? AND volume_id = ?').get(deps.projectId, before!.id) as { value: number }).value
        const outlineCount = (db.prepare('SELECT COUNT(*) AS value FROM outline_items WHERE project_id = ? AND volume_id = ?').get(deps.projectId, before!.id) as { value: number }).value
        const workflowCount = (db.prepare('SELECT COUNT(*) AS value FROM workflow_documents WHERE project_id = ? AND volume_id = ?').get(deps.projectId, before!.id) as { value: number }).value
        const change = stageChange(deps, input, {
          kind: 'outline_volume', action, entityId: before!.id, entityTitle: before!.title,
          before: [beforeText, `删除后迁移：${chapterCount} 个章节、${outlineCount} 个大纲节点 → ${fallback.title}`, `该分卷的 ${workflowCount} 份创作记忆将随分卷删除。`].join('\n'),
          after: '', payload: { fallbackVolumeId: fallback.id }
        })
        return { content: `已暂存分卷删除（change_id=${change.id}）：${before!.title}；章节和大纲将迁移到 ${fallback.title}。尚未写回，需用户确认。` }
      }
      const title = hasOwn(input, 'title') ? readString(input, 'title') : before?.title ?? ''
      const wordTarget = hasOwn(input, 'word_target') ? readString(input, 'word_target') : before?.word_target ?? '目标 5万字'
      const summary = hasOwn(input, 'summary') ? readString(input, 'summary') : before?.summary ?? ''
      if (!title || !wordTarget) return { content: '分卷 title 和 word_target 不能为空。', isError: true }
      const afterText = render({ title, wordTarget, summary })
      if (beforeText === afterText) return { content: '分卷信息没有发生变化。', isError: true }
      const change = stageChange(deps, input, {
        kind: 'outline_volume', action, entityId: before?.id, entityTitle: title,
        before: beforeText, after: afterText, payload: { title, wordTarget, summary }
      })
      return { content: `已暂存分卷${action === 'create' ? '新增' : '修改'}（change_id=${change.id}）：${title}。尚未写回，需用户确认。` }
    }
  }
}

type KnowledgeRow = {
  id: string; title: string; source_type: string; source_label: string; content: string; summary: string
  keywords_json: string; metadata_json: string
}

export function makeStageKnowledgeDocumentTool(deps: StageProjectEntitiesToolDeps): Tool {
  return {
    definition: {
      name: 'stage_knowledge_document',
      description:
        '暂存项目知识文档的新增、修改或删除。与 knowledge_save_document 不同，本工具不会直接落库。update/delete 可用 match_id 或 match_title；项目约束请使用 stage_constraint。',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'update', 'delete'] },
          match_id: { type: 'string' },
          match_title: { type: 'string' },
          title: { type: 'string' },
          source_type: { type: 'string', enum: Array.from(KNOWLEDGE_SOURCE_TYPES) },
          source_label: { type: 'string' },
          content: { type: 'string' },
          summary: { type: 'string' },
          keywords: { type: 'array', items: { type: 'string' } },
          metadata: { type: 'object', additionalProperties: true },
          write_mode: { type: 'string', enum: ['replace', 'merge'], description: 'update 正文时 replace=替换，merge=追加。' },
          reason: { type: 'string' }
        },
        required: ['action', 'reason']
      }
    },
    handler: async (input) => {
      const action = readAction(input)
      if (!action) return actionError()
      const db = await ensureWorkspaceDb()
      const rows = db.prepare(`
        SELECT id, title, source_type, source_label, content, summary, keywords_json, metadata_json
        FROM knowledge_documents WHERE project_id = ? ORDER BY updated_at DESC
      `).all(deps.projectId) as KnowledgeRow[]
      const ref = readString(input, 'match_id') || readString(input, 'match_title')
      const before = action === 'create' ? undefined : resolveByLabel(rows, ref, (row) => row.title) ?? undefined
      if (action !== 'create' && !before) return { content: '无法定位知识文档，请提供准确的 match_id 或唯一标题。', isError: true }
      if (before?.source_type === 'canon-fact' && before.source_label === 'global-constraint') {
        return { content: '该文档属于项目约束，请使用 stage_constraint 修改或删除。', isError: true }
      }
      const render = (doc: { title: string; sourceType: string; sourceLabel: string; content: string; summary: string; keywords: string[]; metadata: Record<string, unknown> }) => [
        `标题：${doc.title}`, `类型：${doc.sourceType}`, `来源：${doc.sourceLabel || '（空）'}`,
        `摘要：${doc.summary || '（空）'}`, `关键词：${doc.keywords.join(' / ') || '（空）'}`,
        `元数据：${JSON.stringify(doc.metadata)}`, `内容：${doc.content}`
      ].join('\n')
      const beforeText = before ? render({
        title: before.title, sourceType: before.source_type, sourceLabel: before.source_label,
        content: before.content, summary: before.summary, keywords: parseJsonArray(before.keywords_json),
        metadata: parseJsonObject(before.metadata_json)
      }) : ''
      if (action === 'delete') {
        const change = stageChange(deps, input, {
          kind: 'knowledge_document', action, entityId: before!.id, entityTitle: before!.title,
          before: beforeText, after: '', payload: { title: before!.title }
        })
        return { content: `已暂存知识文档删除（change_id=${change.id}）：${before!.title}。尚未写回，需用户确认。` }
      }
      const title = hasOwn(input, 'title') ? readString(input, 'title') : before?.title ?? ''
      const sourceType = hasOwn(input, 'source_type') ? readString(input, 'source_type') : before?.source_type ?? 'canon-fact'
      const sourceLabel = hasOwn(input, 'source_label') ? readString(input, 'source_label') : before?.source_label ?? 'assistant-v2'
      const incomingContent = hasOwn(input, 'content') ? readString(input, 'content') : before?.content ?? ''
      const content = before && hasOwn(input, 'content') && readString(input, 'write_mode') === 'merge'
        ? [before.content.trim(), incomingContent].filter(Boolean).join('\n\n')
        : incomingContent
      const summary = hasOwn(input, 'summary') ? readString(input, 'summary') : before?.summary || content.slice(0, 220)
      const keywords = hasOwn(input, 'keywords') ? readStringArray(input, 'keywords') : parseJsonArray(before?.keywords_json ?? '[]')
      const metadata = hasOwn(input, 'metadata') ? safeJsonObject(input.metadata) : parseJsonObject(before?.metadata_json ?? '{}')
      if (!title || !content || !KNOWLEDGE_SOURCE_TYPES.has(sourceType)) {
        return { content: '知识文档缺少合法的 title、source_type 或 content。', isError: true }
      }
      if (sourceType === 'canon-fact' && sourceLabel === 'global-constraint') {
        return { content: '项目约束请使用 stage_constraint。', isError: true }
      }
      const afterText = render({ title, sourceType, sourceLabel, content, summary, keywords, metadata })
      if (beforeText === afterText) return { content: '知识文档没有发生变化。', isError: true }
      const change = stageChange(deps, input, {
        kind: 'knowledge_document', action, entityId: before?.id, entityTitle: title,
        before: beforeText, after: afterText,
        payload: { title, sourceType, sourceLabel, content, summary, keywords, metadata }
      })
      return { content: `已暂存知识文档${action === 'create' ? '新增' : '修改'}（change_id=${change.id}）：${title}。尚未写回，需用户确认。` }
    }
  }
}

export function makeStageProjectMetadataTool(deps: StageProjectEntitiesToolDeps): Tool {
  return {
    definition: {
      name: 'stage_project_metadata',
      description:
        '暂存修改当前项目基础资料。可修改 title、genre、novel_length、target_platform、writing_style_preset_id、writing_style_prompt；不允许修改 API 密钥、项目 ID 或删除项目。',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          genre: { type: 'string' },
          novel_length: { type: 'string', enum: ['short', 'long'] },
          target_platform: { type: 'string' },
          writing_style_preset_id: { type: 'string' },
          writing_style_prompt: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['reason']
      }
    },
    handler: async (input) => {
      const db = await ensureWorkspaceDb()
      const before = db.prepare(`
        SELECT id, title, genre, novel_length, target_platform, writing_style_preset_id, writing_style_prompt
        FROM projects WHERE id = ?
      `).get(deps.projectId) as {
        id: string; title: string; genre: string; novel_length: string; target_platform: string
        writing_style_preset_id: string; writing_style_prompt: string
      } | undefined
      if (!before) return { content: '当前项目不存在。', isError: true }
      const keys = ['title', 'genre', 'novel_length', 'target_platform', 'writing_style_preset_id', 'writing_style_prompt']
      if (!keys.some((key) => hasOwn(input, key))) return { content: '至少需要提供一个要修改的项目字段。', isError: true }
      const title = hasOwn(input, 'title') ? readString(input, 'title') : before.title
      const genre = hasOwn(input, 'genre') ? readString(input, 'genre') : before.genre
      const novelLength = hasOwn(input, 'novel_length') ? readString(input, 'novel_length') : before.novel_length
      const targetPlatform = hasOwn(input, 'target_platform') ? readString(input, 'target_platform') : before.target_platform
      const writingStylePresetId = hasOwn(input, 'writing_style_preset_id') ? readString(input, 'writing_style_preset_id') : before.writing_style_preset_id
      const writingStylePrompt = hasOwn(input, 'writing_style_prompt') ? readString(input, 'writing_style_prompt') : before.writing_style_prompt
      if (!title || !genre || !['short', 'long'].includes(novelLength)) {
        return { content: '项目 title、genre 不能为空，novel_length 必须是 short 或 long。', isError: true }
      }
      const render = (project: { title: string; genre: string; novelLength: string; targetPlatform: string; writingStylePresetId: string; writingStylePrompt: string }) => [
        `标题：${project.title}`, `题材：${project.genre}`, `篇幅：${project.novelLength}`,
        `目标平台：${project.targetPlatform || '（空）'}`, `风格预设：${project.writingStylePresetId || '（空）'}`,
        `风格要求：${project.writingStylePrompt || '（空）'}`
      ].join('\n')
      const beforeText = render({
        title: before.title, genre: before.genre, novelLength: before.novel_length,
        targetPlatform: before.target_platform, writingStylePresetId: before.writing_style_preset_id,
        writingStylePrompt: before.writing_style_prompt
      })
      const afterText = render({ title, genre, novelLength, targetPlatform, writingStylePresetId, writingStylePrompt })
      if (beforeText === afterText) return { content: '项目资料没有发生变化。', isError: true }
      const change = stageChange(deps, input, {
        kind: 'project', action: 'update', entityId: deps.projectId, entityTitle: title,
        before: beforeText, after: afterText,
        payload: { title, genre, novelLength, targetPlatform, writingStylePresetId, writingStylePrompt }
      })
      return { content: `已暂存项目资料修改（change_id=${change.id}）：${title}。尚未写回，需用户确认。` }
    }
  }
}

export function makeStageProjectEntityTools(deps: StageProjectEntitiesToolDeps): Tool[] {
  return [
    makeStageRelationshipTool(deps),
    makeStageOrganizationMembershipTool(deps),
    makeStageInspirationTool(deps),
    makeListOutlineVolumesTool(deps),
    makeStageOutlineVolumeTool(deps),
    makeStageKnowledgeDocumentTool(deps),
    makeStageProjectMetadataTool(deps)
  ]
}
