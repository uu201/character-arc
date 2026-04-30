import type { WorkflowDocument, WorkflowDocumentKey } from '@/types/app'
import type { NovelWorkflowStageId } from '@/types/app'

const workflowDocumentDefinitions: Array<{
  key: WorkflowDocumentKey
  title: string
  defaultContent: string
}> = [
  {
    key: 'task_plan',
    title: 'task_plan.md',
    defaultContent: '# 任务计划\n\n- 待 AI 生成本项目的任务计划骨架。\n'
  },
  {
    key: 'findings',
    title: 'findings.md',
    defaultContent: '# 发现记录\n\n- 待 AI 生成本项目的关键发现与事实记录。\n'
  },
  {
    key: 'progress',
    title: 'progress.md',
    defaultContent: '# 进度记录\n\n- 待 AI 生成本项目的阶段进度骨架。\n'
  },
  {
    key: 'current_status',
    title: 'current_status.md',
    defaultContent: '# 当前状态卡\n\n- 待 AI 生成本项目的当前状态卡。\n'
  },
  {
    key: 'novel_setting',
    title: 'novel_setting.md',
    defaultContent: '# 小说设定\n\n- 待 AI 生成本项目的设定总表。\n'
  },
  {
    key: 'character_relationships',
    title: 'character_relationships.md',
    defaultContent: '# 人物关系盘\n\n- 待 AI 生成本项目的人物关系盘。\n'
  },
  {
    key: 'pending_hooks',
    title: 'pending_hooks.md',
    defaultContent: '# 待回收钩子\n\n- 待 AI 生成本项目的伏笔与钩子记录。\n'
  },
  {
    key: 'resource_ledger',
    title: 'resource_ledger.md',
    defaultContent: '# 资源账本\n\n- 待 AI 生成本项目的资源账本骨架。\n'
  }
]

export function createDefaultWorkflowDocuments(): WorkflowDocument[] {
  const now = new Date().toISOString()
  return workflowDocumentDefinitions.map((definition) => ({
    key: definition.key,
    title: definition.title,
    content: definition.defaultContent,
    updatedAt: now
  }))
}

export function normalizeWorkflowDocuments(documents?: WorkflowDocument[] | null): WorkflowDocument[] {
  const sourceMap = new Map((documents ?? []).map((document) => [document.key, document]))
  return workflowDocumentDefinitions.map((definition) => {
    const document = sourceMap.get(definition.key)
    return {
      key: definition.key,
      title: definition.title,
      content: document?.content?.trim() ? document.content : definition.defaultContent,
      updatedAt: document?.updatedAt || new Date().toISOString()
    }
  })
}

export const workflowStageDocumentMap: Record<NovelWorkflowStageId, WorkflowDocumentKey[]> = {
  reference: ['task_plan', 'findings'],
  premise: ['current_status', 'novel_setting'],
  setting: ['novel_setting', 'character_relationships', 'findings'],
  outline: ['task_plan', 'pending_hooks'],
  draft: ['progress', 'resource_ledger']
}
