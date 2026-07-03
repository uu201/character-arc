/**
 * stage_worldview / stage_character / stage_outline 工具工厂
 *
 * 三个工具共用相同模式：
 *   - action='create'：新建实体（before=''）
 *   - action='update'：按 match_* 定位现有实体，计算 before/after 差异
 *   - reason 写给用户看的一句话
 * 产出进入 StagedChangesStore，不直接写库。
 */

import type { Tool } from '../../agent/tools/types'
import type { StagedChangesStore } from '../staged-changes-store'
import type { SnapshotAccessor } from '../providers/shared'
import { getProjectView } from '../providers/shared'
import type { WorkflowDocumentKey } from '../../../workspace-types'

export interface StageEntitiesToolDeps {
  sessionId: string
  turnId: string
  projectId: string
  currentChapterId?: string
  stagedStore: StagedChangesStore
  snapshot: SnapshotAccessor
}

const WORKFLOW_DOCUMENT_TITLES: Record<WorkflowDocumentKey, string> = {
  task_plan: '创作计划',
  findings: '灵感与发现',
  progress: '写作进度',
  current_status: '项目概况',
  novel_setting: '世界与设定',
  character_relationships: '人物关系',
  pending_hooks: '伏笔悬念',
  resource_ledger: '素材清单'
}

const WORKFLOW_DOCUMENT_KEYS = new Set<WorkflowDocumentKey>(
  Object.keys(WORKFLOW_DOCUMENT_TITLES) as WorkflowDocumentKey[]
)

// ── 文本序列化辅助 ────────────────────────────────────────

function renderWorldviewText(entry: {
  type?: string; title?: string; content?: string
}): string {
  return [
    entry.type ? `分类：${entry.type}` : '',
    entry.title ? `标题：${entry.title}` : '',
    entry.content ? `内容：${entry.content}` : ''
  ].filter(Boolean).join('\n')
}

function renderCharacterText(c: {
  name?: string; role?: string; description?: string; tags?: Array<{ label?: string } | string>
}): string {
  const tagsStr = (c.tags ?? [])
    .map((t) => (typeof t === 'string' ? t : t.label))
    .join(' / ')
  return [
    c.name ? `姓名：${c.name}` : '',
    c.role ? `定位：${c.role}` : '',
    c.description ? `描述：${c.description}` : '',
    tagsStr ? `标签：${tagsStr}` : ''
  ].filter(Boolean).join('\n')
}

function renderOutlineText(item: {
  title?: string; conflict?: string; summary?: string; wordTarget?: string
}): string {
  return [
    item.title ? `标题：${item.title}` : '',
    item.wordTarget ? `字数目标：${item.wordTarget}` : '',
    item.conflict ? `核心冲突：${item.conflict}` : '',
    item.summary ? `摘要：${item.summary}` : ''
  ].filter(Boolean).join('\n')
}

function renderOrganizationText(entry: {
  name?: string; type?: string; description?: string; motto?: string
}): string {
  return [
    entry.name ? `名称：${entry.name}` : '',
    entry.type ? `类型：${entry.type}` : '',
    entry.motto ? `信条：${entry.motto}` : '',
    entry.description ? `描述：${entry.description}` : ''
  ].filter(Boolean).join('\n')
}

function renderConstraintText(entry: {
  title?: string; content?: string; scope?: string; weight?: string; locked?: boolean; keywords?: string[]
}): string {
  return [
    entry.title ? `标题：${entry.title}` : '',
    entry.scope ? `范围：${entry.scope}` : '',
    entry.weight ? `权重：${entry.weight}` : '',
    typeof entry.locked === 'boolean' ? `锁定：${entry.locked ? '是' : '否'}` : '',
    entry.keywords?.length ? `关键词：${entry.keywords.join(' / ')}` : '',
    entry.content ? `内容：${entry.content}` : ''
  ].filter(Boolean).join('\n')
}

function renderPlotThreadText(entry: {
  title?: string; description?: string; status?: string; openedInChapterId?: string; closedInChapterId?: string; tags?: string[]
}): string {
  return [
    entry.title ? `标题：${entry.title}` : '',
    entry.status ? `状态：${entry.status}` : '',
    entry.openedInChapterId ? `埋设章节：${entry.openedInChapterId}` : '',
    entry.closedInChapterId ? `收束章节：${entry.closedInChapterId}` : '',
    entry.tags?.length ? `标签：${entry.tags.join(' / ')}` : '',
    entry.description ? `描述：${entry.description}` : ''
  ].filter(Boolean).join('\n')
}

function renderWorkflowDocumentText(entry: {
  title?: string; key?: string; volumeTitle?: string; content?: string
}): string {
  return [
    entry.title ? `标题：${entry.title}` : '',
    entry.key ? `文档键：${entry.key}` : '',
    entry.volumeTitle ? `所属分卷：${entry.volumeTitle}` : '',
    entry.content ? `内容：${entry.content}` : ''
  ].filter(Boolean).join('\n')
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, '').toLowerCase()
}

function readString(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (item && typeof item === 'object' && 'label' in item) {
        return String((item as { label?: unknown }).label ?? '').trim()
      }
      return ''
    })
    .filter(Boolean)
}

function readBoolean(input: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = input[key]
  return typeof value === 'boolean' ? value : fallback
}

/**
 * 长文本合并（write_mode='merge' 时用）：把新内容并入旧内容而非覆盖。
 * - 任一为空 → 取另一个；存在包含关系 → 取更完整的；否则旧 + 空行 + 新。
 */
function mergeLongText(currentValue: string, incomingValue: string): string {
  const currentText = currentValue.trim()
  const incomingText = incomingValue.trim()
  if (!incomingText) return currentText
  if (!currentText) return incomingText
  if (currentText.includes(incomingText)) return currentText
  if (incomingText.includes(currentText)) return incomingText
  return `${currentText}\n\n${incomingText}`
}

/** update 写入模式：默认 replace（整体替换）；merge=把新内容追加/并入旧内容。 */
function readWriteMode(input: Record<string, unknown>): 'replace' | 'merge' {
  return readString(input, 'write_mode') === 'merge' ? 'merge' : 'replace'
}

/** 对单个长文本字段按 write_mode 解析出最终值（在工具层算好，保证暂存 diff = 最终写回）。 */
function resolveLongText(mode: 'replace' | 'merge', currentValue: string, incomingValue: string): string {
  return mode === 'merge' ? mergeLongText(currentValue, incomingValue) : incomingValue
}

/** update/delete 通用的 action 校验。 */
function isKnownAction(action: string): action is 'create' | 'update' | 'delete' {
  return action === 'create' || action === 'update' || action === 'delete'
}

/** 共享的 write_mode 输入 schema 片段。 */
const WRITE_MODE_SCHEMA = {
  type: 'string',
  enum: ['replace', 'merge'],
  description: 'update 时的写入模式：replace=用新内容整体替换旧内容（默认）；merge=把新内容并入旧内容末尾，用于补充而非重写。'
} as const

function readWorkflowDocumentKey(value: string): WorkflowDocumentKey | null {
  return WORKFLOW_DOCUMENT_KEYS.has(value as WorkflowDocumentKey) ? value as WorkflowDocumentKey : null
}

function hasOwn(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

function formatCandidateList(candidates: Array<{ entityId: string; label: string; hint?: string }>): string {
  return candidates.map((c, index) => `${index + 1}. ${c.label}${c.hint ? `｜${c.hint}` : ''} (${c.entityId})`).join('\n')
}

type ProjectView = NonNullable<ReturnType<typeof getProjectView>>

function readProjectView(deps: StageEntitiesToolDeps): ProjectView | null {
  return getProjectView(deps.snapshot.getSnapshot(), deps.projectId)
}

function defaultWorkflowVolumeId(view: ProjectView, deps: StageEntitiesToolDeps): string {
  const currentChapter = deps.currentChapterId
    ? view.workspace.chapters.find((chapter) => chapter.id === deps.currentChapterId)
    : null
  return currentChapter?.volumeId || view.workspace.outlineVolumes[0]?.id || ''
}

function appendWorkflowDocumentContent(existing: string, addition: string): string {
  const oldContent = existing.trim()
  const newContent = addition.trim()
  if (!oldContent) return newContent
  if (!newContent) return oldContent
  return `${oldContent}\n\n${newContent}`
}

function isWorkflowPlaceholderContent(content: string): boolean {
  const text = content.trim()
  return !text || /待\s*AI\s*生成/.test(text)
}

type MatchResult<T extends { id: string }> =
  | { ok: true; entity: T }
  | { ok: false; message: string; candidates?: Array<{ entityId: string; label: string; hint?: string }> }

function matchOne<T extends { id: string }>(
  rows: T[],
  ref: string,
  getLabel: (row: T) => string,
  getHint: (row: T) => string = () => ''
): MatchResult<T> {
  const rawRef = ref.trim()
  if (!rawRef) {
    return { ok: false, message: 'update 需要提供 match_id / match_title / match_name。' }
  }

  const direct = rows.find((row) => row.id === rawRef)
  if (direct) return { ok: true, entity: direct }

  const normalizedRef = normalizeText(rawRef)
  const exact = rows.find((row) => normalizeText(getLabel(row)) === normalizedRef)
  if (exact) return { ok: true, entity: exact }

  const contains = rows.filter((row) => normalizeText(getLabel(row)).includes(normalizedRef))
  if (contains.length === 1) return { ok: true, entity: contains[0] }

  const candidates = (contains.length ? contains : rows)
    .slice(0, 8)
    .map((row) => ({
      entityId: row.id,
      label: getLabel(row),
      hint: getHint(row)
    }))

  return {
    ok: false,
    message: contains.length > 1
      ? `匹配到多个候选，请改用 match_id 精确指定：\n${formatCandidateList(candidates)}`
      : `未找到匹配目标"${rawRef}"。可选目标：\n${formatCandidateList(candidates)}`,
    candidates
  }
}

export function makeStageWorldviewTool(deps: StageEntitiesToolDeps): Tool {
  return {
    definition: {
      name: 'stage_worldview',
      description:
        '暂存世界观/设定条目的新增、修改或删除，不直接写库。create 需提供 type/title/content；update 需提供 match_id 或 match_title，并提供要改的新字段；delete 需提供 match_id 或 match_title。reason 会显示在暂存卡片上。',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'update', 'delete'], description: 'create=新增；update=修改；delete=删除已有条目。' },
          match_id: { type: 'string', description: 'update/delete 可选：目标世界观条目 ID。' },
          match_title: { type: 'string', description: 'update/delete 可选：目标世界观标题，支持精确或唯一包含匹配。' },
          type: { type: 'string', description: '设定分类，如 地理/法则/势力/历史。create 必填；update 可选。' },
          title: { type: 'string', description: '设定标题。create 必填；update 可选。' },
          content: { type: 'string', description: '设定正文。create 必填；update 可选。' },
          write_mode: WRITE_MODE_SCHEMA,
          reason: { type: 'string', description: '简短说明为什么要新增/修改/删除。' }
        },
        required: ['action', 'reason']
      }
    },
    handler: async (input) => {
      const view = readProjectView(deps)
      if (!view) return { content: '当前项目快照未就绪，无法暂存世界观变更。', isError: true }

      const action = readString(input, 'action')
      const reason = readString(input, 'reason') || '（未提供理由）'
      if (!isKnownAction(action)) {
        return { content: 'action 必须是 create、update 或 delete。', isError: true }
      }

      if (action === 'create') {
        const payload = {
          type: readString(input, 'type'),
          title: readString(input, 'title'),
          content: readString(input, 'content')
        }
        if (!payload.title || !payload.content) {
          return { content: 'create 需要提供 title 和 content。', isError: true }
        }

        const change = deps.stagedStore.add({
          sessionId: deps.sessionId,
          turnId: deps.turnId,
          kind: 'worldview',
          action: 'create',
          entityTitle: payload.title,
          reason,
          before: '',
          after: renderWorldviewText(payload),
          entityPayload: payload
        })
        return { content: `已暂存世界观新增（change_id=${change.id}）：${payload.title}。尚未写回，需用户确认。` }
      }

      const ref = readString(input, 'match_id') || readString(input, 'match_title')
      const matched = matchOne(
        view.workspace.worldviewEntries,
        ref,
        (row) => row.title,
        (row) => row.type
      )
      if (!matched.ok) return { content: matched.message, isError: true }

      const before = matched.entity

      if (action === 'delete') {
        const change = deps.stagedStore.add({
          sessionId: deps.sessionId,
          turnId: deps.turnId,
          kind: 'worldview',
          action: 'delete',
          entityId: before.id,
          entityTitle: before.title,
          reason,
          before: renderWorldviewText(before),
          after: ''
        })
        return { content: `已暂存世界观删除（change_id=${change.id}）：${before.title}。尚未写回，需用户确认。` }
      }

      const writeMode = readWriteMode(input)
      const payload = {
        type: hasOwn(input, 'type') ? readString(input, 'type') : before.type,
        title: hasOwn(input, 'title') ? readString(input, 'title') : before.title,
        content: hasOwn(input, 'content')
          ? resolveLongText(writeMode, before.content, readString(input, 'content'))
          : before.content
      }
      if (!payload.title || !payload.content) {
        return { content: 'update 后的 title 和 content 不能为空。', isError: true }
      }

      const change = deps.stagedStore.add({
        sessionId: deps.sessionId,
        turnId: deps.turnId,
        kind: 'worldview',
        action: 'update',
        entityId: before.id,
        entityTitle: payload.title || before.title,
        reason,
        before: renderWorldviewText(before),
        after: renderWorldviewText(payload),
        entityPayload: payload
      })
      return { content: `已暂存世界观修改（change_id=${change.id}）：${before.title}。尚未写回，需用户确认。` }
    }
  }
}

export function makeStageCharacterTool(deps: StageEntitiesToolDeps): Tool {
  return {
    definition: {
      name: 'stage_character',
      description:
        '暂存人物卡新增、修改或删除，不直接写库。create 需提供 name/role/description；update 需提供 match_id 或 match_name，并提供要改的新字段；delete 需提供 match_id 或 match_name。tags 接受字符串数组。',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'update', 'delete'], description: 'create=新增；update=修改；delete=删除已有人物。' },
          match_id: { type: 'string', description: 'update/delete 可选：目标人物 ID。' },
          match_name: { type: 'string', description: 'update/delete 可选：目标人物姓名，支持精确或唯一包含匹配。' },
          name: { type: 'string', description: '人物姓名。create 必填；update 可选。' },
          role: { type: 'string', description: '人物定位/身份。create 必填；update 可选。' },
          description: { type: 'string', description: '人物卡正文描述。create 必填；update 可选。' },
          tags: { type: 'array', items: { type: 'string' }, description: '人物标签数组，如 ["主角","复仇线"]。' },
          write_mode: WRITE_MODE_SCHEMA,
          reason: { type: 'string', description: '简短说明为什么要新增/修改/删除。' }
        },
        required: ['action', 'reason']
      }
    },
    handler: async (input) => {
      const view = readProjectView(deps)
      if (!view) return { content: '当前项目快照未就绪，无法暂存人物变更。', isError: true }

      const action = readString(input, 'action')
      const reason = readString(input, 'reason') || '（未提供理由）'
      if (!isKnownAction(action)) {
        return { content: 'action 必须是 create、update 或 delete。', isError: true }
      }

      if (action === 'create') {
        const payload = {
          name: readString(input, 'name'),
          role: readString(input, 'role'),
          description: readString(input, 'description'),
          tags: readTags(input.tags)
        }
        if (!payload.name || !payload.description) {
          return { content: 'create 需要提供 name 和 description。', isError: true }
        }

        const change = deps.stagedStore.add({
          sessionId: deps.sessionId,
          turnId: deps.turnId,
          kind: 'character',
          action: 'create',
          entityTitle: payload.name,
          reason,
          before: '',
          after: renderCharacterText(payload),
          entityPayload: payload
        })
        return { content: `已暂存人物新增（change_id=${change.id}）：${payload.name}。尚未写回，需用户确认。` }
      }

      const ref = readString(input, 'match_id') || readString(input, 'match_name')
      const matched = matchOne(
        view.workspace.characters,
        ref,
        (row) => row.name,
        (row) => row.role
      )
      if (!matched.ok) return { content: matched.message, isError: true }

      const before = matched.entity

      if (action === 'delete') {
        const change = deps.stagedStore.add({
          sessionId: deps.sessionId,
          turnId: deps.turnId,
          kind: 'character',
          action: 'delete',
          entityId: before.id,
          entityTitle: before.name,
          reason,
          before: renderCharacterText(before),
          after: ''
        })
        return { content: `已暂存人物删除（change_id=${change.id}）：${before.name}。尚未写回，需用户确认。` }
      }

      const writeMode = readWriteMode(input)
      const payload = {
        name: hasOwn(input, 'name') ? readString(input, 'name') : before.name,
        role: hasOwn(input, 'role') ? readString(input, 'role') : before.role,
        description: hasOwn(input, 'description')
          ? resolveLongText(writeMode, before.description, readString(input, 'description'))
          : before.description,
        tags: hasOwn(input, 'tags') ? readTags(input.tags) : before.tags.map((tag) => tag.label)
      }
      if (!payload.name || !payload.description) {
        return { content: 'update 后的 name 和 description 不能为空。', isError: true }
      }

      const change = deps.stagedStore.add({
        sessionId: deps.sessionId,
        turnId: deps.turnId,
        kind: 'character',
        action: 'update',
        entityId: before.id,
        entityTitle: payload.name || before.name,
        reason,
        before: renderCharacterText(before),
        after: renderCharacterText(payload),
        entityPayload: payload
      })
      return { content: `已暂存人物修改（change_id=${change.id}）：${before.name}。尚未写回，需用户确认。` }
    }
  }
}

export function makeStageOutlineTool(deps: StageEntitiesToolDeps): Tool {
  return {
    definition: {
      name: 'stage_outline',
      description:
        '暂存大纲节点新增、修改或删除，不直接写库。create 需提供 title/summary，可选 volume_id/word_target/conflict；update 需提供 match_id 或 match_title，并提供要改的新字段；delete 需提供 match_id 或 match_title。',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'update', 'delete'], description: 'create=新增；update=修改；delete=删除已有大纲节点。' },
          match_id: { type: 'string', description: 'update/delete 可选：目标大纲节点 ID。' },
          match_title: { type: 'string', description: 'update/delete 可选：目标大纲标题，支持精确或唯一包含匹配。' },
          volume_id: { type: 'string', description: 'create/update 可选：所属分卷 ID。缺省使用当前项目第一个分卷。' },
          title: { type: 'string', description: '大纲节点标题。create 必填；update 可选。' },
          word_target: { type: 'string', description: '预估字数，如 "预估 3000字"。' },
          conflict: { type: 'string', description: '一句话核心冲突。' },
          summary: { type: 'string', description: '剧情推进摘要。create 必填；update 可选。' },
          write_mode: WRITE_MODE_SCHEMA,
          reason: { type: 'string', description: '简短说明为什么要新增/修改/删除。' }
        },
        required: ['action', 'reason']
      }
    },
    handler: async (input) => {
      const view = readProjectView(deps)
      if (!view) return { content: '当前项目快照未就绪，无法暂存大纲变更。', isError: true }

      const action = readString(input, 'action')
      const reason = readString(input, 'reason') || '（未提供理由）'
      if (!isKnownAction(action)) {
        return { content: 'action 必须是 create、update 或 delete。', isError: true }
      }

      if (action === 'create') {
        const volumeId = readString(input, 'volume_id') || view.workspace.outlineVolumes[0]?.id || ''
        const payload = {
          volumeId,
          title: readString(input, 'title'),
          wordTarget: readString(input, 'word_target'),
          conflict: readString(input, 'conflict'),
          summary: readString(input, 'summary')
        }
        if (!payload.title || !payload.summary) {
          return { content: 'create 需要提供 title 和 summary。', isError: true }
        }

        const change = deps.stagedStore.add({
          sessionId: deps.sessionId,
          turnId: deps.turnId,
          kind: 'outline',
          action: 'create',
          entityTitle: payload.title,
          reason,
          before: '',
          after: renderOutlineText(payload),
          entityPayload: payload
        })
        return { content: `已暂存大纲新增（change_id=${change.id}）：${payload.title}。尚未写回，需用户确认。` }
      }

      const ref = readString(input, 'match_id') || readString(input, 'match_title')
      const matched = matchOne(
        view.workspace.outlineItems,
        ref,
        (row) => row.title,
        (row) => row.conflict || row.summary.slice(0, 60)
      )
      if (!matched.ok) return { content: matched.message, isError: true }

      const before = matched.entity

      if (action === 'delete') {
        const change = deps.stagedStore.add({
          sessionId: deps.sessionId,
          turnId: deps.turnId,
          kind: 'outline',
          action: 'delete',
          entityId: before.id,
          entityTitle: before.title,
          reason,
          before: renderOutlineText(before),
          after: ''
        })
        return { content: `已暂存大纲删除（change_id=${change.id}）：${before.title}。尚未写回，需用户确认。` }
      }

      const writeMode = readWriteMode(input)
      const payload = {
        volumeId: hasOwn(input, 'volume_id') ? readString(input, 'volume_id') : before.volumeId,
        title: hasOwn(input, 'title') ? readString(input, 'title') : before.title,
        wordTarget: hasOwn(input, 'word_target') ? readString(input, 'word_target') : before.wordTarget,
        conflict: hasOwn(input, 'conflict') ? readString(input, 'conflict') : before.conflict,
        summary: hasOwn(input, 'summary')
          ? resolveLongText(writeMode, before.summary, readString(input, 'summary'))
          : before.summary
      }
      if (!payload.title || !payload.summary) {
        return { content: 'update 后的 title 和 summary 不能为空。', isError: true }
      }

      const change = deps.stagedStore.add({
        sessionId: deps.sessionId,
        turnId: deps.turnId,
        kind: 'outline',
        action: 'update',
        entityId: before.id,
        entityTitle: payload.title || before.title,
        reason,
        before: renderOutlineText(before),
        after: renderOutlineText(payload),
        entityPayload: payload
      })
      return { content: `已暂存大纲修改（change_id=${change.id}）：${before.title}。尚未写回，需用户确认。` }
    }
  }
}

export function makeStageOrganizationTool(deps: StageEntitiesToolDeps): Tool {
  return {
    definition: {
      name: 'stage_organization',
      description:
        '暂存组织/势力条目的新增、修改或删除，不直接写库。create 需提供 name/type/description；update 需提供 match_id 或 match_name，并提供要改的新字段；delete 需提供 match_id 或 match_name。',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'update', 'delete'], description: 'create=新增；update=修改；delete=删除已有组织。' },
          match_id: { type: 'string', description: 'update/delete 可选：目标组织 ID。' },
          match_name: { type: 'string', description: 'update/delete 可选：目标组织名称，支持精确或唯一包含匹配。' },
          name: { type: 'string', description: '组织名称。create 必填；update 可选。' },
          type: { type: 'string', description: '组织类型，如 帝国/商会/反抗军/宗门。create 必填；update 可选。' },
          description: { type: 'string', description: '组织描述。create 必填；update 可选。' },
          motto: { type: 'string', description: '组织信条/口号。' },
          write_mode: WRITE_MODE_SCHEMA,
          reason: { type: 'string', description: '简短说明为什么要新增/修改/删除。' }
        },
        required: ['action', 'reason']
      }
    },
    handler: async (input) => {
      const view = readProjectView(deps)
      if (!view) return { content: '当前项目快照未就绪，无法暂存组织变更。', isError: true }

      const action = readString(input, 'action')
      const reason = readString(input, 'reason') || '（未提供理由）'
      if (!isKnownAction(action)) {
        return { content: 'action 必须是 create、update 或 delete。', isError: true }
      }

      if (action === 'create') {
        const payload = {
          name: readString(input, 'name'),
          type: readString(input, 'type'),
          description: readString(input, 'description'),
          motto: readString(input, 'motto')
        }
        if (!payload.name || !payload.type || !payload.description) {
          return { content: 'create 需要提供 name、type 和 description。', isError: true }
        }
        const change = deps.stagedStore.add({
          sessionId: deps.sessionId,
          turnId: deps.turnId,
          kind: 'organization',
          action: 'create',
          entityTitle: payload.name,
          reason,
          before: '',
          after: renderOrganizationText(payload),
          entityPayload: payload
        })
        return { content: `已暂存组织新增（change_id=${change.id}）：${payload.name}。尚未写回，需用户确认。` }
      }

      const ref = readString(input, 'match_id') || readString(input, 'match_name')
      const matched = matchOne(
        view.workspace.organizations,
        ref,
        (row) => row.name,
        (row) => row.type
      )
      if (!matched.ok) return { content: matched.message, isError: true }

      const before = matched.entity

      if (action === 'delete') {
        const change = deps.stagedStore.add({
          sessionId: deps.sessionId,
          turnId: deps.turnId,
          kind: 'organization',
          action: 'delete',
          entityId: before.id,
          entityTitle: before.name,
          reason,
          before: renderOrganizationText(before),
          after: ''
        })
        return { content: `已暂存组织删除（change_id=${change.id}）：${before.name}。尚未写回，需用户确认。` }
      }

      const writeMode = readWriteMode(input)
      const payload = {
        name: hasOwn(input, 'name') ? readString(input, 'name') : before.name,
        type: hasOwn(input, 'type') ? readString(input, 'type') : before.type,
        description: hasOwn(input, 'description')
          ? resolveLongText(writeMode, before.description, readString(input, 'description'))
          : before.description,
        motto: hasOwn(input, 'motto') ? readString(input, 'motto') : before.motto
      }
      if (!payload.name || !payload.type || !payload.description) {
        return { content: 'update 后的 name、type 和 description 不能为空。', isError: true }
      }
      const change = deps.stagedStore.add({
        sessionId: deps.sessionId,
        turnId: deps.turnId,
        kind: 'organization',
        action: 'update',
        entityId: before.id,
        entityTitle: payload.name,
        reason,
        before: renderOrganizationText(before),
        after: renderOrganizationText(payload),
        entityPayload: payload
      })
      return { content: `已暂存组织修改（change_id=${change.id}）：${before.name}。尚未写回，需用户确认。` }
    }
  }
}

export function makeStageConstraintTool(deps: StageEntitiesToolDeps): Tool {
  return {
    definition: {
      name: 'stage_constraint',
      description:
        '暂存项目级硬约束/红线新增、修改或删除，不直接写库。约束会写入项目知识库 canon-fact/global-constraint。',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'update', 'delete'], description: 'create=新增；update=修改；delete=删除已有约束。' },
          match_id: { type: 'string', description: 'update/delete 可选：目标约束知识文档 ID。' },
          match_title: { type: 'string', description: 'update/delete 可选：目标约束标题。' },
          title: { type: 'string', description: '约束标题。create 必填；update 可选。' },
          content: { type: 'string', description: '约束正文。create 必填；update 可选。' },
          scope: { type: 'string', description: '适用范围，默认 project。' },
          weight: { type: 'string', enum: ['core', 'important', 'supporting'], description: '约束权重。' },
          locked: { type: 'boolean', description: '是否锁定。' },
          keywords: { type: 'array', items: { type: 'string' }, description: '关键词数组。' },
          write_mode: WRITE_MODE_SCHEMA,
          reason: { type: 'string', description: '简短说明为什么要新增/修改/删除。' }
        },
        required: ['action', 'reason']
      }
    },
    handler: async (input) => {
      const snapshot = deps.snapshot.getSnapshot()
      const view = getProjectView(snapshot, deps.projectId)
      if (!view) return { content: '当前项目快照未就绪，无法暂存项目约束。', isError: true }

      const action = readString(input, 'action')
      const reason = readString(input, 'reason') || '（未提供理由）'
      if (!isKnownAction(action)) {
        return { content: 'action 必须是 create、update 或 delete。', isError: true }
      }

      const knowledgeDocuments = snapshot?.knowledgeDocuments ?? []
      const constraints = knowledgeDocuments
        .map((doc) => doc as (typeof knowledgeDocuments)[number] & { projectId?: string })
        .filter((doc) =>
          (doc.projectId ?? '') === deps.projectId &&
          doc.sourceType === 'canon-fact' &&
          doc.sourceLabel === 'global-constraint'
        )

      if (action === 'create') {
        const payload = {
          title: readString(input, 'title'),
          content: readString(input, 'content'),
          scope: readString(input, 'scope') || 'project',
          weight: readString(input, 'weight') || 'core',
          locked: readBoolean(input, 'locked', true),
          keywords: readTags(input.keywords)
        }
        if (!payload.title || !payload.content) {
          return { content: 'create 需要提供 title 和 content。', isError: true }
        }
        const change = deps.stagedStore.add({
          sessionId: deps.sessionId,
          turnId: deps.turnId,
          kind: 'constraint',
          action: 'create',
          entityTitle: payload.title,
          reason,
          before: '',
          after: renderConstraintText(payload),
          entityPayload: payload
        })
        return { content: `已暂存项目约束新增（change_id=${change.id}）：${payload.title}。尚未写回，需用户确认。` }
      }

      const ref = readString(input, 'match_id') || readString(input, 'match_title')
      const matched = matchOne(
        constraints,
        ref,
        (row) => row.title,
        (row) => row.summary || row.content.slice(0, 60)
      )
      if (!matched.ok) return { content: matched.message, isError: true }

      const before = matched.entity
      const meta = before.metadata ?? {}
      const beforeText = renderConstraintText({
        title: before.title,
        content: before.content,
        scope: String(meta.scope ?? 'project'),
        weight: String(meta.weight ?? 'core'),
        locked: meta.locked !== false,
        keywords: before.keywords
      })

      if (action === 'delete') {
        const change = deps.stagedStore.add({
          sessionId: deps.sessionId,
          turnId: deps.turnId,
          kind: 'constraint',
          action: 'delete',
          entityId: before.id,
          entityTitle: before.title,
          reason,
          before: beforeText,
          after: ''
        })
        return { content: `已暂存项目约束删除（change_id=${change.id}）：${before.title}。尚未写回，需用户确认。` }
      }

      const writeMode = readWriteMode(input)
      const payload = {
        title: hasOwn(input, 'title') ? readString(input, 'title') : before.title,
        content: hasOwn(input, 'content')
          ? resolveLongText(writeMode, before.content, readString(input, 'content'))
          : before.content,
        scope: hasOwn(input, 'scope') ? readString(input, 'scope') : String(meta.scope ?? 'project'),
        weight: hasOwn(input, 'weight') ? readString(input, 'weight') : String(meta.weight ?? 'core'),
        locked: hasOwn(input, 'locked') ? readBoolean(input, 'locked', true) : meta.locked !== false,
        keywords: hasOwn(input, 'keywords') ? readTags(input.keywords) : before.keywords
      }
      if (!payload.title || !payload.content) {
        return { content: 'update 后的 title 和 content 不能为空。', isError: true }
      }
      const change = deps.stagedStore.add({
        sessionId: deps.sessionId,
        turnId: deps.turnId,
        kind: 'constraint',
        action: 'update',
        entityId: before.id,
        entityTitle: payload.title,
        reason,
        before: beforeText,
        after: renderConstraintText(payload),
        entityPayload: payload
      })
      return { content: `已暂存项目约束修改（change_id=${change.id}）：${before.title}。尚未写回，需用户确认。` }
    }
  }
}

export function makeStagePlotThreadTool(deps: StageEntitiesToolDeps): Tool {
  return {
    definition: {
      name: 'stage_plot_thread',
      description:
        '暂存剧情线索/伏笔新增、修改或删除，不直接写库。create 需提供 title/description；update/delete 需提供 match_id 或 match_title。',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'update', 'delete'], description: 'create=新增；update=修改；delete=删除已有线索。' },
          match_id: { type: 'string', description: 'update/delete 可选：目标线索 ID。' },
          match_title: { type: 'string', description: 'update/delete 可选：目标线索标题。' },
          title: { type: 'string', description: '线索标题。create 必填；update 可选。' },
          description: { type: 'string', description: '线索描述。create 必填；update 可选。' },
          opened_in_chapter_id: { type: 'string', description: '埋设章节 ID。' },
          closed_in_chapter_id: { type: 'string', description: '收束章节 ID。resolved 时可填。' },
          status: { type: 'string', enum: ['open', 'resolved'], description: '线索状态。' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签数组。' },
          write_mode: WRITE_MODE_SCHEMA,
          reason: { type: 'string', description: '简短说明为什么要新增/修改/删除。' }
        },
        required: ['action', 'reason']
      }
    },
    handler: async (input) => {
      const view = readProjectView(deps)
      if (!view) return { content: '当前项目快照未就绪，无法暂存剧情线索。', isError: true }

      const action = readString(input, 'action')
      const reason = readString(input, 'reason') || '（未提供理由）'
      if (!isKnownAction(action)) {
        return { content: 'action 必须是 create、update 或 delete。', isError: true }
      }

      if (action === 'create') {
        const payload = {
          title: readString(input, 'title'),
          description: readString(input, 'description'),
          openedInChapterId: readString(input, 'opened_in_chapter_id'),
          closedInChapterId: readString(input, 'closed_in_chapter_id'),
          status: readString(input, 'status') || 'open',
          tags: readTags(input.tags)
        }
        if (!payload.title || !payload.description) {
          return { content: 'create 需要提供 title 和 description。', isError: true }
        }
        const change = deps.stagedStore.add({
          sessionId: deps.sessionId,
          turnId: deps.turnId,
          kind: 'plot_thread',
          action: 'create',
          entityTitle: payload.title,
          reason,
          before: '',
          after: renderPlotThreadText(payload),
          entityPayload: payload
        })
        return { content: `已暂存剧情线索新增（change_id=${change.id}）：${payload.title}。尚未写回，需用户确认。` }
      }

      const ref = readString(input, 'match_id') || readString(input, 'match_title')
      const matched = matchOne(
        view.workspace.plotThreads,
        ref,
        (row) => row.title,
        (row) => row.status
      )
      if (!matched.ok) return { content: matched.message, isError: true }

      const before = matched.entity

      if (action === 'delete') {
        const change = deps.stagedStore.add({
          sessionId: deps.sessionId,
          turnId: deps.turnId,
          kind: 'plot_thread',
          action: 'delete',
          entityId: before.id,
          entityTitle: before.title,
          reason,
          before: renderPlotThreadText(before),
          after: ''
        })
        return { content: `已暂存剧情线索删除（change_id=${change.id}）：${before.title}。尚未写回，需用户确认。` }
      }

      const writeMode = readWriteMode(input)
      const payload = {
        title: hasOwn(input, 'title') ? readString(input, 'title') : before.title,
        description: hasOwn(input, 'description')
          ? resolveLongText(writeMode, before.description, readString(input, 'description'))
          : before.description,
        openedInChapterId: hasOwn(input, 'opened_in_chapter_id') ? readString(input, 'opened_in_chapter_id') : before.openedInChapterId,
        closedInChapterId: hasOwn(input, 'closed_in_chapter_id') ? readString(input, 'closed_in_chapter_id') : before.closedInChapterId,
        status: hasOwn(input, 'status') ? readString(input, 'status') : before.status,
        tags: hasOwn(input, 'tags') ? readTags(input.tags) : before.tags
      }
      if (!payload.title || !payload.description) {
        return { content: 'update 后的 title 和 description 不能为空。', isError: true }
      }
      const change = deps.stagedStore.add({
        sessionId: deps.sessionId,
        turnId: deps.turnId,
        kind: 'plot_thread',
        action: 'update',
        entityId: before.id,
        entityTitle: payload.title,
        reason,
        before: renderPlotThreadText(before),
        after: renderPlotThreadText(payload),
        entityPayload: payload
      })
      return { content: `已暂存剧情线索修改（change_id=${change.id}）：${before.title}。尚未写回，需用户确认。` }
    }
  }
}

export function makeStageWorkflowDocumentTool(deps: StageEntitiesToolDeps): Tool {
  return {
    definition: {
      name: 'stage_workflow_document',
      description:
        '暂存创作记忆的新增或修改，不直接写库。适合记录创作计划、项目概况、写作进度、伏笔悬念、素材清单等长期上下文。默认写入当前章节所在分卷；没有当前章节时写入第一个分卷。',
      inputSchema: {
        type: 'object',
        properties: {
          doc_key: {
            type: 'string',
            enum: Object.keys(WORKFLOW_DOCUMENT_TITLES),
            description: '创作记忆键。task_plan=创作计划；findings=灵感与发现；progress=写作进度；current_status=项目概况；novel_setting=世界与设定；character_relationships=人物关系；pending_hooks=伏笔悬念；resource_ledger=素材清单。'
          },
          volume_id: { type: 'string', description: '可选：所属分卷 ID。缺省使用当前章节所在分卷或第一个分卷。' },
          title: { type: 'string', description: '可选：文档标题。缺省使用 doc_key 对应的标准标题。' },
          operation: { type: 'string', enum: ['replace', 'append'], description: 'replace=用 content 替换全文；append=把 append/content 追加到现有正文末尾。默认 replace。' },
          content: { type: 'string', description: 'replace 时的新全文；append 时也可作为追加内容。' },
          append: { type: 'string', description: 'append 时追加到文档末尾的内容。' },
          reason: { type: 'string', description: '简短说明为什么要更新这份创作记忆。' }
        },
        required: ['doc_key', 'reason']
      }
    },
    handler: async (input) => {
      const view = readProjectView(deps)
      if (!view) return { content: '当前项目快照未就绪，无法暂存创作记忆。', isError: true }

      const key = readWorkflowDocumentKey(readString(input, 'doc_key'))
      if (!key) {
        return { content: `doc_key 必须是以下之一：${Object.keys(WORKFLOW_DOCUMENT_TITLES).join(', ')}`, isError: true }
      }

      const requestedVolumeId = readString(input, 'volume_id')
      const volumeId = requestedVolumeId || defaultWorkflowVolumeId(view, deps)
      const volume = view.workspace.outlineVolumes.find((item) => item.id === volumeId)
      if (!volumeId || !volume) {
        return { content: '当前项目没有可写入创作记忆的分卷。请先创建分卷或指定有效 volume_id。', isError: true }
      }

      const existing = (volume.workflowDocuments ?? []).find((doc) => doc.key === key)
      const operation = readString(input, 'operation') === 'append' ? 'append' : 'replace'
      const addition = readString(input, 'append') || readString(input, 'content')
      const replacement = readString(input, 'content')
      const baseContent = existing && !isWorkflowPlaceholderContent(existing.content) ? existing.content : ''
      const content = operation === 'append'
        ? appendWorkflowDocumentContent(baseContent, addition)
        : replacement
      const title = readString(input, 'title') || existing?.title || WORKFLOW_DOCUMENT_TITLES[key]
      const reason = readString(input, 'reason') || '更新创作记忆。'

      if (!content) {
        return { content: operation === 'append' ? 'append 操作需要提供 append 或 content。' : 'replace 操作需要提供 content。', isError: true }
      }

      const payload = {
        key,
        title,
        content,
        volumeId,
        operation
      }
      const action = existing ? 'update' : 'create'
      const entityId = `${deps.projectId}-${volumeId}-${key}`
      const change = deps.stagedStore.add({
        sessionId: deps.sessionId,
        turnId: deps.turnId,
        kind: 'workflow_document',
        action,
        entityId,
        entityTitle: `${volume.title} / ${title}`,
        reason,
        before: existing
          ? renderWorkflowDocumentText({
              title: existing.title,
              key,
              volumeTitle: volume.title,
              content: existing.content
            })
          : '',
        after: renderWorkflowDocumentText({
          title,
          key,
          volumeTitle: volume.title,
          content
        }),
        entityPayload: payload
      })

      return { content: `已暂存创作记忆${action === 'create' ? '新增' : '修改'}（change_id=${change.id}）：${volume.title} / ${title}。尚未写回，需用户确认。` }
    }
  }
}

export function makeStageEntitiesTools(deps: StageEntitiesToolDeps): Tool[] {
  return [
    makeStageWorldviewTool(deps),
    makeStageCharacterTool(deps),
    makeStageOutlineTool(deps),
    makeStageOrganizationTool(deps),
    makeStageConstraintTool(deps),
    makeStagePlotThreadTool(deps),
    makeStageWorkflowDocumentTool(deps)
  ]
}
