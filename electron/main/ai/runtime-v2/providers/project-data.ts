/**
 * 项目数据类 ContextProvider。
 *
 * 这里放轻量摘要：组织/关系、大纲、线索、约束、灵感、知识、创作记忆、skill index。
 * 长正文仍交给 read_project_data / search_project 精读，避免 system prompt 被撑爆。
 */

import type { ContextBuildRequest, ContextSlice } from '@shared/assistant-runtime'
import type { WorkflowDocumentKey, WorkspaceKnowledgeDocument } from '../../../workspace-types'
import type { ContextProvider } from '../context-builder'
import { getProjectView, makeSlice, type SnapshotAccessor } from './shared'

type KnowledgeWithProject = WorkspaceKnowledgeDocument & { projectId?: string }

function truncate(value: string, max: number): string {
  const text = value.trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function tags(value: string[]): string {
  return value.length ? `｜标签：${value.join(' / ')}` : ''
}

function projectDocuments(accessor: SnapshotAccessor, projectId: string): KnowledgeWithProject[] {
  const docs = accessor.getSnapshot()?.knowledgeDocuments ?? []
  return docs
    .map((doc) => doc as KnowledgeWithProject)
    .filter((doc) => (doc.projectId ?? '') === projectId)
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

const WORKFLOW_DOCUMENT_ORDER: WorkflowDocumentKey[] = [
  'current_status',
  'task_plan',
  'pending_hooks',
  'progress',
  'novel_setting',
  'character_relationships',
  'findings',
  'resource_ledger'
]

function isWorkflowPlaceholder(doc: { key?: string; title: string; content: string }): boolean {
  const content = doc.content.trim()
  if (!content) return true
  if (/待\s*AI\s*生成/.test(content)) return true
  const title = WORKFLOW_DOCUMENT_TITLES[doc.key as WorkflowDocumentKey] ?? doc.title
  const normalized = content
    .replace(/^#+\s*/gm, '')
    .replace(/[-*]\s*/g, '')
    .replace(/\s+/g, '')
  return normalized === title.replace(/\s+/g, '')
}

function currentVolumeId(request: ContextBuildRequest, view: NonNullable<ReturnType<typeof getProjectView>>): string {
  const scopeRef = request.scopeRef ?? ''
  const [kind, ref] = scopeRef.split(':', 2)
  const chapterId = kind === 'chapter'
    ? ref
    : kind === 'selection'
      ? ref?.split('#')[0]
      : ''
  const chapter = chapterId
    ? view.workspace.chapters.find((item) => item.id === chapterId)
    : null
  return chapter?.volumeId || view.workspace.outlineVolumes[0]?.id || ''
}

export function makeOrganizationsProvider(accessor: SnapshotAccessor): ContextProvider {
  return {
    id: 'organizations',
    priority: 52,
    truncationHint:
      '组织/势力资料因预算受限省略。请调用 read_project_data(entity_type="organizations") 或 read_project_data(entity_type="relationships") 精读。',
    async build(request: ContextBuildRequest): Promise<ContextSlice | null> {
      const view = getProjectView(accessor.getSnapshot(), request.projectId)
      if (!view) return null
      const { workspace } = view
      if (!workspace.organizations.length && !workspace.characterRelationships.length && !workspace.organizationMemberships.length) {
        return null
      }

      const orgLines = workspace.organizations.slice(0, 40).map((org) =>
        `- 组织：**${org.name}**（${org.type || '未分类'}）${org.motto ? `｜信条：${org.motto}` : ''}：${truncate(org.description, 800)}`
      )

      const charNames = new Map(workspace.characters.map((c) => [c.id, c.name]))
      const relLines = workspace.characterRelationships.slice(0, 60).map((rel) => {
        const from = charNames.get(rel.fromCharacterId) ?? rel.fromCharacterId
        const to = charNames.get(rel.toCharacterId) ?? rel.toCharacterId
        return `- 关系：${from} → ${to}（${rel.type}，强度 ${rel.intensity}）：${truncate(rel.description, 500)}`
      })

      const orgNames = new Map(workspace.organizations.map((o) => [o.id, o.name]))
      const memberLines = workspace.organizationMemberships.slice(0, 60).map((m) => {
        const character = charNames.get(m.characterId) ?? m.characterId
        const organization = orgNames.get(m.organizationId) ?? m.organizationId
        return `- 归属：${character} → ${organization}${m.role ? `（${m.role}）` : ''}${m.notes ? `：${truncate(m.notes, 400)}` : ''}`
      })

      const lines = [...orgLines, ...relLines, ...memberLines]
      return makeSlice('organizations', 52, '组织、关系与成员归属', lines.join('\n'))
    }
  }
}

export function makeOutlineProvider(accessor: SnapshotAccessor): ContextProvider {
  return {
    id: 'outline',
    priority: 58,
    truncationHint:
      '大纲资料因预算受限省略。请调用 read_project_data(entity_type="outline") 精读。',
    async build(request: ContextBuildRequest): Promise<ContextSlice | null> {
      const view = getProjectView(accessor.getSnapshot(), request.projectId)
      if (!view || !view.workspace.outlineItems.length) return null

      const volumes = new Map(view.workspace.outlineVolumes.map((v) => [v.id, v.title]))
      const lines = view.workspace.outlineItems
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .slice(0, 120)
        .map((item) => {
          const volume = volumes.get(item.volumeId)
          const prefix = volume ? `【${volume}】` : ''
          return `- ${prefix}**${item.title}**（${item.status}，${item.wordTarget || '未定字数'}）：${item.conflict ? `${item.conflict}｜` : ''}${truncate(item.summary, 500)}`
        })

      const remaining = view.workspace.outlineItems.length - lines.length
      if (remaining > 0) {
        lines.push(`（还有 ${remaining} 个大纲节点未展开，可调用 read_project_data(entity_type="outline")。）`)
      }

      return makeSlice('outline', 58, '剧情大纲', lines.join('\n'))
    }
  }
}

export function makePlotThreadsProvider(accessor: SnapshotAccessor): ContextProvider {
  return {
    id: 'plot-threads',
    priority: 48,
    truncationHint:
      '剧情线索因预算受限省略。请调用 read_project_data(entity_type="plot_threads") 精读。',
    async build(request: ContextBuildRequest): Promise<ContextSlice | null> {
      const view = getProjectView(accessor.getSnapshot(), request.projectId)
      if (!view || !view.workspace.plotThreads.length) return null
      const chapterTitles = new Map(view.workspace.chapters.map((c) => [c.id, c.title]))
      const lines = view.workspace.plotThreads.slice(0, 60).map((thread) => {
        const opened = chapterTitles.get(thread.openedInChapterId) ?? thread.openedInChapterId
        const closed = thread.closedInChapterId ? (chapterTitles.get(thread.closedInChapterId) ?? thread.closedInChapterId) : ''
        return `- **${thread.title}**（${thread.status}）${opened ? `｜埋设：${opened}` : ''}${closed ? `｜收束：${closed}` : ''}${tags(thread.tags)}：${truncate(thread.description, 500)}`
      })
      return makeSlice('plot-threads', 48, '剧情线索 / 伏笔', lines.join('\n'))
    }
  }
}

export function makeConstraintsProvider(accessor: SnapshotAccessor): ContextProvider {
  return {
    id: 'constraints',
    priority: 85,
    truncationHint:
      '项目约束因预算受限省略。请调用 read_project_data(entity_type="project_constraints") 精读。',
    async build(request: ContextBuildRequest): Promise<ContextSlice | null> {
      const docs = projectDocuments(accessor, request.projectId)
        .filter((doc) => doc.sourceType === 'canon-fact' && doc.sourceLabel === 'global-constraint')
        .slice(0, 40)
      if (!docs.length) return null

      const lines = docs.map((doc) => {
        const metadata = doc.metadata ?? {}
        const scope = typeof metadata.scope === 'string' ? metadata.scope : 'project'
        const weight = typeof metadata.weight === 'string' ? metadata.weight : ''
        const locked = metadata.locked === true ? '｜锁定' : ''
        return `- **${doc.title}**（${scope}${weight ? ` / ${weight}` : ''}${locked}）：${truncate(doc.content || doc.summary, 1000)}`
      })
      return makeSlice('constraints', 85, '项目级约束', lines.join('\n'))
    }
  }
}

export function makeInspirationProvider(accessor: SnapshotAccessor): ContextProvider {
  return {
    id: 'inspiration',
    priority: 35,
    truncationHint:
      '灵感卡因预算受限省略。请调用 read_project_data(entity_type="inspiration") 精读。',
    async build(request: ContextBuildRequest): Promise<ContextSlice | null> {
      const view = getProjectView(accessor.getSnapshot(), request.projectId)
      if (!view || !view.workspace.inspirationEntries.length) return null
      const lines = view.workspace.inspirationEntries
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .slice(0, 40)
        .map((item) => `- **${item.title}**（${item.type} / ${item.source}）${tags(item.tags)}：${truncate(item.content, 500)}`)
      return makeSlice('inspiration', 35, '灵感卡', lines.join('\n'))
    }
  }
}

export function makeKnowledgeProvider(accessor: SnapshotAccessor): ContextProvider {
  return {
    id: 'knowledge',
    priority: 40,
    truncationHint:
      '项目知识库因预算受限省略。请调用 read_project_data(entity_type="knowledge") 精读。',
    async build(request: ContextBuildRequest): Promise<ContextSlice | null> {
      const docs = projectDocuments(accessor, request.projectId)
        .filter((doc) => !(doc.sourceType === 'canon-fact' && doc.sourceLabel === 'global-constraint'))
        .slice(0, 40)
      if (!docs.length) return null
      const lines = docs.map((doc) =>
        `- **${doc.title}**（${doc.sourceType}${doc.sourceLabel ? ` / ${doc.sourceLabel}` : ''}）：${truncate(doc.summary || doc.content, 500)}`
      )
      return makeSlice('knowledge', 40, '项目知识库', lines.join('\n'))
    }
  }
}

export function makeWorkflowDocumentsProvider(accessor: SnapshotAccessor): ContextProvider {
  return {
    id: 'workflow-documents',
    priority: 62,
    truncationHint:
      '创作记忆因预算受限省略。请调用 read_project_data(entity_type="workflow_documents") 精读。',
    async build(request: ContextBuildRequest): Promise<ContextSlice | null> {
      const view = getProjectView(accessor.getSnapshot(), request.projectId)
      if (!view) return null
      const activeVolumeId = currentVolumeId(request, view)
      const orderIndex = new Map(WORKFLOW_DOCUMENT_ORDER.map((key, index) => [key, index]))
      const volumeDocs = view.workspace.outlineVolumes.flatMap((volume, volumeIndex) =>
        (volume.workflowDocuments ?? []).map((doc) => ({
          key: doc.key,
          title: doc.title,
          volumeTitle: volume.title,
          volumeId: volume.id,
          content: doc.content,
          updatedAt: doc.updatedAt,
          sourceOrder: volumeIndex
        }))
      )
      const projectDocs = (view.workspace.workflowDocuments ?? []).map((doc) => ({
        key: doc.key,
        title: doc.title,
        volumeTitle: '项目',
        volumeId: '',
        content: doc.content,
        updatedAt: doc.updatedAt,
        sourceOrder: 999
      }))
      const docs = [...volumeDocs, ...projectDocs]
        .filter((doc) => !isWorkflowPlaceholder(doc))
        .sort((a, b) => {
          const activeDelta = Number(b.volumeId === activeVolumeId) - Number(a.volumeId === activeVolumeId)
          if (activeDelta !== 0) return activeDelta
          const keyDelta = (orderIndex.get(a.key) ?? 99) - (orderIndex.get(b.key) ?? 99)
          if (keyDelta !== 0) return keyDelta
          return a.sourceOrder - b.sourceOrder
        })
        .slice(0, 24)
      if (!docs.length) return null
      const lines = docs.map((doc) => {
        const title = WORKFLOW_DOCUMENT_TITLES[doc.key] ?? doc.title
        const active = doc.volumeId === activeVolumeId ? '当前分卷 / ' : ''
        return `- **${active}${doc.volumeTitle} / ${title}**${doc.updatedAt ? `（${doc.updatedAt}）` : ''}：${truncate(doc.content, 1000)}`
      })
      lines.push('使用方式：这是项目的长期创作记忆。需要更新计划、状态、进度、伏笔、素材时，优先用 stage_workflow_document 暂存修改。')
      return makeSlice('workflow-documents', 62, '创作记忆', lines.join('\n'))
    }
  }
}

export function makeSkillIndexProvider(accessor: SnapshotAccessor): ContextProvider {
  return {
    id: 'skill-index',
    priority: 30,
    truncationHint:
      '项目 skill 列表因预算受限省略。需要时可调用 skill_list / skill_load。',
    async build(request: ContextBuildRequest): Promise<ContextSlice | null> {
      const view = getProjectView(accessor.getSnapshot(), request.projectId)
      if (!view) return null
      const skills = (view.project.projectSkills ?? []).filter((skill) => skill.enabled !== false).slice(0, 40)
      if (!skills.length) return null
      const lines = skills.map((skill) =>
        `- ${skill.name || skill.id}（${skill.id}）：${truncate(skill.description || '', 300)}`
      )
      return makeSlice('skill-index', 30, '当前项目启用 skills', lines.join('\n'))
    }
  }
}
