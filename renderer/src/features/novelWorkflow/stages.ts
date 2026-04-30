import type {
  NovelWorkflowStageId,
  NovelWorkflowStageState,
  NovelWorkflowStageStatus,
  PanelName
} from '@/types/app'

export type NovelWorkflowStageDefinition = {
  id: NovelWorkflowStageId
  title: string
  description: string
  targetPanel: PanelName
  focus: string
  summary: string
  actions: Array<{
    label: string
    panel: PanelName
  }>
}

export const novelWorkflowStageDefinitions: NovelWorkflowStageDefinition[] = [
  {
    id: 'reference',
    title: '选题与参考',
    description: '围绕平台、题材和参考作品做前置判断与提炼，先决定该学什么，不急着直接写正文。',
    targetPanel: 'inspiration',
    focus: '参考书、风格提炼、平台偏好',
    summary: '对应 2.md 中的扫榜、下载参考书、提炼写法和题材判断。',
    actions: [
      { label: '打开灵感模块', panel: 'inspiration' },
      { label: '查看作品概览', panel: 'overview' }
    ]
  },
  {
    id: 'premise',
    title: '故事立项',
    description: '确定故事背景、世界线、主角路线和外挂设定，把这本书的骨架先搭起来。',
    targetPanel: 'world',
    focus: '故事背景、金手指、主角路线',
    summary: '对应 2.md 中的故事背景、体系、主角和外挂设定。',
    actions: [
      { label: '进入世界观设定', panel: 'world' },
      { label: '打开项目设置', panel: 'settings' }
    ]
  },
  {
    id: 'setting',
    title: '设定搭建',
    description: '补角色、势力、关系和关键设定，把后续冲突需要的抓手和人脉盘先立出来。',
    targetPanel: 'characters',
    focus: '角色、关系、势力、关键设定',
    summary: '对应 1.md / 3.md 中的人物构建、关系盘、配角逻辑和设定工作。',
    actions: [
      { label: '进入角色图鉴', panel: 'characters' },
      { label: '进入关系组织', panel: 'relations' }
    ]
  },
  {
    id: 'outline',
    title: '大纲与章节规划',
    description: '把分卷、节点、节奏和章节绑定推顺，再决定正文如何分卷落地。',
    targetPanel: 'outline',
    focus: '分卷、大纲节点、剧情链、章节绑定',
    summary: '对应 1.md 的规划文件逻辑和 2.md 的正文前置规划步骤。',
    actions: [
      { label: '进入剧情大纲', panel: 'outline' },
      { label: '查看章节创作', panel: 'chapters' }
    ]
  },
  {
    id: 'draft',
    title: '正文创作与优化',
    description: '在规划稳定后进入正文创作，再结合分析、去 AI 味和回写动作持续修正。',
    targetPanel: 'chapters',
    focus: '正文、分析、去 AI 味、回写',
    summary: '对应 3.md 中的正文创作、文本优化、人性化和审查流程。',
    actions: [
      { label: '进入章节创作', panel: 'chapters' },
      { label: '进入剧情大纲', panel: 'outline' }
    ]
  }
]

export function createDefaultNovelWorkflowStages(): NovelWorkflowStageState[] {
  return novelWorkflowStageDefinitions.map((stage, index) => ({
    id: stage.id,
    status: index === 0 ? 'doing' : 'todo'
  }))
}

export function normalizeNovelWorkflowStages(
  stages?: NovelWorkflowStageState[] | null
): NovelWorkflowStageState[] {
  const statusMap = new Map((stages ?? []).map((stage) => [stage.id, stage.status]))
  return novelWorkflowStageDefinitions.map((stage, index) => ({
    id: stage.id,
    status: normalizeNovelWorkflowStageStatus(statusMap.get(stage.id), index === 0)
  }))
}

function normalizeNovelWorkflowStageStatus(
  status: string | undefined,
  isFirst: boolean
): NovelWorkflowStageStatus {
  switch (status) {
    case 'todo':
    case 'doing':
    case 'done':
      return status
    default:
      return isFirst ? 'doing' : 'todo'
  }
}
