/**
 * resolveTurnExecutionPlan · Phase 2 执行计划解析器
 *
 * 主流程：
 *   1. 从 snapshot 取 appSettings（AI 模型/密钥/base URL）
 *   2. contextBuilder.build(surface, request) → BuildResult
 *   3. assembleContextBlock(result) → markdown 段
 *   4. buildAssistantSystemPrompt(surface, contextBlock) → system prompt
 *   5. 组装工具集：read/search/list（老工具，剥离 edit_chapter）+ stage_chapter_edit（工厂形态）
 *   6. filterToolsBySurface(tools, surface) → 权限过滤
 *   7. 返回 { systemPrompt, tools, settings, maxOutputTokens }
 */

import type { AiTaskName, AiTaskPayload, AppSettings } from '../shared-types'
import type { AssistantSession, SurfaceDefinition, TurnSendRequest } from '@shared/assistant-runtime'
import type { Tool } from '../agent/tools/types'
import { buildSkillIndex } from '../agent/system-prompt'
import { createChapterTools } from '../agent/tools/chapter-tools'
import { createProjectDataTools } from '../agent/tools/project-data-tools'
import { createKnowledgeTools } from '../agent/tools/knowledge-tools'
import { createSkillTools } from '../agent/tools/skill-tools'
import { getAllSkills, getSkillById, resolveTaskSkills, isSkillEnabledForTask } from '../skills'
import type { SkillDefinition, SkillStageId } from '../skills'
import { normalizeSettings, validateSettings } from '../settings'
import { assembleContextBlock, contextBuilder, estimateTokens } from './context-builder'
import { filterToolsBySurface, isToolAllowed, resolveAllowedMatchers } from './permission'
import { buildAssistantSystemPrompt } from './system-prompt'
import { stagedChangesStore } from './staged-changes-store'
import { makeStageChapterEditTool } from './tools/stage-chapter-edit'
import { makeStageChapterCreateTool } from './tools/stage-chapter-create'
import { makeStageEntitiesTools } from './tools/stage-entities'
import { type ToolFactory } from './agent-loop'
import type { ResolveTurnExecutionPlan } from './ipc'
import { getProjectView, type SnapshotAccessor } from './providers/shared'
import { saveRuntimeKnowledgeDocument } from './knowledge-writer'
import { createEvidenceLedger, wrapToolsWithRuntimeBudget } from './evidence-ledger'
import { createRuntimePlan, type AssistantRuntimePlan } from './planner'

/** 大多数主流长上下文模型的保守窗口。实际 provider 若更小，会由压缩层兜底。 */
const DEFAULT_CONTEXT_WINDOW_TOKENS = 128000
/** 输出预算包含 reasoning token，保留足够空间给回答/工具规划，不随 prompt 无限放大。 */
const DEFAULT_MAX_OUTPUT_TOKENS = 32000
const CONTEXT_RESERVE_TOKENS = DEFAULT_MAX_OUTPUT_TOKENS
const LARGE_CONTEXT_BUDGET_TOKENS = DEFAULT_CONTEXT_WINDOW_TOKENS - CONTEXT_RESERVE_TOKENS
const MINIMAL_CONTEXT_BUDGET_TOKENS = 32000
const SELECTION_CONTEXT_BUDGET_TOKENS = 64000

export interface CreateExecutionPlannerDeps {
  snapshot: SnapshotAccessor
  onKnowledgeSaved?: () => Promise<void> | void
}

/**
 * 工厂：注入依赖 → 产出 ResolveTurnExecutionPlan 实例。
 * main entry 拿到实例后传给 registerAssistantIpcHandlers。
 */
export function createExecutionPlanner(
  deps: CreateExecutionPlannerDeps
): ResolveTurnExecutionPlan {
  return async ({ session, surface, request }) => {
    const snapshot = deps.snapshot.getSnapshot()
    const rawSettings = snapshot?.appSettings as AppSettings | undefined
    if (!rawSettings) {
      throw new Error('AppSettings 未就绪，无法启动助手。请先在设置中配置 AI 供应商。')
    }
    // 关键：走一遍旧路径就走的 normalize，负责：
    //   - 自动补 baseUrl 的 /v1 后缀（否则 openai-compatible 打到根路径，中转站会返回 HTML）
    //   - provider 名转小写、temperature/topP 边界化、缺失字段回退默认值
    // 与 validateSettings 一并调用，配置缺失时立即抛错而不是发出去空转。
    const settings = normalizeSettings(rawSettings)
    validateSettings(settings)

    // 1. Planner：先决定本轮是轻量对话、审计、修正还是分批任务。
    const runtimePlan = createRuntimePlan({ surface, request })
    const evidenceLedger = createEvidenceLedger()
    const activeScopeRef = request.scopeRef ?? session.scopeRef

    // 2. Context Router：只注入与本轮 intent 相关的最小上下文，其余靠工具按需读取。
    const routedSurface = {
      ...surface,
      contextProviders: runtimePlan.contextProviders
    }
    const contextBudgetTokens = resolveContextBudgetTokens(routedSurface, runtimePlan.contextMode)
    const contextResult = await contextBuilder.build(routedSurface, {
      surface: routedSurface,
      sessionId: session.id,
      projectId: session.projectId,
      scopeRef: activeScopeRef,
      budgetTokens: contextBudgetTokens
    })
    const contextBlock = assembleContextBlock(contextResult)
    const skillTask = createV2SkillTask({
      session,
      surface,
      request,
      settings,
      snapshot,
      runtimePlan,
      activeScopeRef
    })
    const { projectId, skills: selectedSkills } = await resolveTaskSkills(skillTask)
    const matchedSkillDefs = selectedSkills
      .map((sel) => getSkillById(sel.id, projectId || undefined))
      .filter((skill): skill is SkillDefinition => Boolean(skill))
    const skillPromptBlock = buildV2SkillPromptBlock(matchedSkillDefs, surface)

    // 2. 拼 system prompt
    const systemPrompt = buildAssistantSystemPrompt({
      surface: routedSurface,
      intentHint: request.intentHint,
      contextBlock: [
        `## Runtime v2 分批计划\n\n${runtimePlan.guidance}`,
        skillPromptBlock,
        contextBlock
      ].filter(Boolean).join('\n\n---\n\n')
    })

    // 3. 组装工具集
    //    - 章节读写：read_chapter / list_chapters / search_project（丢弃旧 edit_chapter）
    //    - 项目数据：read_project_data
    //    - 技能：skill_list / skill_load / (skill_run_script 由内置 skill 决定)
    //    - 知识：knowledge_save_document（直接写入项目知识库，并刷新 workspace snapshot）
    //    - 变更暂存：stage_chapter_edit（工厂形态，闭包 turnId/sessionId）
    const currentChapterId = extractCurrentChapterId(activeScopeRef) ?? ''
    const chapterReadTools = createChapterTools({
      currentChapterId,
      useDiffReview: false
    }).filter((t) => t.definition.name !== 'edit_chapter')
    const projectDataTools = createProjectDataTools()

    const knowledgeTools = createKnowledgeTools({
      collectDocument: async (doc) => {
        const id = await saveRuntimeKnowledgeDocument(
          { projectId: session.projectId, draft: doc },
          { onSaved: deps.onKnowledgeSaved }
        )
        return id
      },
      defaultSourceLabel: 'assistant-v2'
    })

    const skillTools = createSkillTools({
      resolveSkill: (id) => getSkillById(id, session.projectId || undefined),
      listSkills: () => getAllSkills(session.projectId || undefined),
      resolveSkillEnabled: (skill) => isSkillEnabledForTask(skillTask, skill.id, projectId),
      // 只允许 builtin skill 跑脚本，跟旧路径一致
      allowScriptExecution: (skill) => skill.scope === 'builtin'
    })

    const toolFactory: ToolFactory = (ctx) => {
      const stageChapterEdit = makeStageChapterEditTool({
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        projectId: ctx.projectId,
        stagedStore: stagedChangesStore,
        currentChapterId
      })
      const stageChapterCreate = makeStageChapterCreateTool({
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        projectId: ctx.projectId,
        stagedStore: stagedChangesStore,
        snapshot: deps.snapshot,
        currentChapterId
      })
      const stageEntityTools = makeStageEntitiesTools({
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        projectId: ctx.projectId,
        currentChapterId,
        stagedStore: stagedChangesStore,
        snapshot: deps.snapshot
      })
      const combined: Tool[] = [
        ...chapterReadTools,
        ...projectDataTools,
        ...knowledgeTools,
        ...skillTools,
        stageChapterEdit,
        stageChapterCreate,
        ...stageEntityTools
      ]
      return wrapToolsWithRuntimeBudget(
        filterToolsBySurface(combined, surface),
        runtimePlan,
        evidenceLedger
      )
    }

    // 4. 输出 token 预算
    const maxOutputTokens = Math.min(
      DEFAULT_MAX_OUTPUT_TOKENS,
      Math.max(estimateTokens(systemPrompt) + 6000, 16000)
    )

    return {
      systemPrompt,
      tools: toolFactory,
      settings,
      maxOutputTokens,
      runtimePlan,
      evidenceLedger
    }
  }
}

function taskForSurface(surface: SurfaceDefinition): AiTaskName {
  return surface.id === 'chapter-panel' || surface.id === 'inline-selection'
    ? 'chapter-assistant'
    : 'global-assistant'
}

function stripSkillFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  if (!match) return content
  return content.slice(match[0].length)
}

function hasSkillToolAccess(surface: SurfaceDefinition): boolean {
  const matchers = resolveAllowedMatchers(surface)
  return isToolAllowed('skill_load', matchers)
}

function buildV2SkillPromptBlock(
  skills: SkillDefinition[],
  surface: SurfaceDefinition
): string {
  if (!skills.length) return ''

  const requiredSkills = skills.filter((skill) => skill.manifest.required)
  const optionalSkills = skills.filter((skill) => !skill.manifest.required)
  const sections: string[] = []

  if (requiredSkills.length > 0) {
    sections.push([
      '## 强制生效的 SKILLS（已直接注入，无需调用 skill_load）',
      '',
      ...requiredSkills.map((skill) => {
        const body = stripSkillFrontmatter(skill.content).trim().slice(0, 2000)
        return `### ${skill.name}\n${body}`
      })
    ].join('\n'))
  }

  if (optionalSkills.length > 0 && hasSkillToolAccess(surface)) {
    sections.push(buildSkillIndex(optionalSkills))
  }

  return sections.filter(Boolean).join('\n\n')
}

function createV2SkillTask(params: {
  session: AssistantSession
  surface: SurfaceDefinition
  request: TurnSendRequest
  settings: AppSettings
  snapshot: ReturnType<SnapshotAccessor['getSnapshot']>
  runtimePlan: AssistantRuntimePlan
  activeScopeRef?: string
}): AiTaskPayload {
  const view = getProjectView(params.snapshot, params.session.projectId)
  const project = view?.project
  const workspace = view?.workspace
  const chapterId = extractCurrentChapterId(params.activeScopeRef)
  const chapter = chapterId
    ? workspace?.chapters.find((item) => item.id === chapterId)
    : undefined
  const outlineItem = chapter?.outlineItemId
    ? workspace?.outlineItems.find((item) => item.id === chapter.outlineItemId)
    : undefined

  return {
    task: taskForSurface(params.surface),
    settings: params.settings,
    context: {
      projectId: params.session.projectId,
      projectTitle: project?.title ?? '',
      projectGenre: project?.genre ?? '',
      projectNovelLength: project?.novelLength ?? '',
      projectSkills: project?.projectSkills ?? [],
      userPrompt: params.request.userMessage,
      originalUserPrompt: params.request.userMessage,
      quickAction: params.request.intentHint ?? '',
      stageId: resolveSkillStage(params.runtimePlan, params.surface, params.request.userMessage),
      chapterId: chapter?.id ?? '',
      chapterTitle: chapter?.title ?? '',
      chapterSummary: chapter?.summary ?? '',
      currentOutlineSummary: outlineItem?.summary ?? '',
      currentOutlineConflict: outlineItem?.conflict ?? '',
      focusType: params.request.attachments?.map((item) => item.kind).join(',') ?? ''
    }
  }
}

function resolveSkillStage(
  runtimePlan: AssistantRuntimePlan,
  surface: SurfaceDefinition,
  userMessage: string
): SkillStageId | undefined {
  const text = userMessage.replace(/\s+/g, '')
  if (/(拆书|参考书|对标|风格分析|参考分析)/.test(text)) return 'reference'
  if (/(大纲|剧情节点|分卷|卷纲)/.test(text)) return 'outline'
  if (surface.scope === 'chapter' || surface.scope === 'selection') return 'draft'
  if (/(正文|章节|润色|改写|续写|扩写|初稿)/.test(text)) return 'draft'
  if (/(简介|立意|卖点|题材|开书|项目初始化)/.test(text)) return 'premise'
  if (runtimePlan.intent === 'entity-edit' || runtimePlan.intent === 'ingest' || runtimePlan.intent === 'correct') {
    return 'setting'
  }
  return undefined
}

function resolveContextBudgetTokens(
  surface: { id: string; scope: string },
  contextMode: 'minimal' | 'targeted' | 'chapter'
): number {
  if (contextMode === 'minimal') return MINIMAL_CONTEXT_BUDGET_TOKENS
  if (contextMode === 'chapter') return LARGE_CONTEXT_BUDGET_TOKENS
  if (surface.id === 'global-page' || surface.id === 'global-panel' || surface.scope === 'project') {
    return LARGE_CONTEXT_BUDGET_TOKENS
  }
  if (surface.id === 'chapter-panel' || surface.scope === 'chapter') {
    return LARGE_CONTEXT_BUDGET_TOKENS
  }
  return SELECTION_CONTEXT_BUDGET_TOKENS
}

function extractCurrentChapterId(scopeRef: string | undefined): string | null {
  if (!scopeRef) return null
  const [kind, ref] = scopeRef.split(':', 2)
  if (!ref) return null
  if (kind === 'chapter') return ref
  if (kind === 'selection') return ref.split('#')[0] ?? null
  return null
}
