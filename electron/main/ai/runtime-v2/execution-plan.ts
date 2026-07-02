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

import type { AppSettings } from '../shared-types'
import type { Tool } from '../agent/tools/types'
import { createChapterTools } from '../agent/tools/chapter-tools'
import { createProjectDataTools } from '../agent/tools/project-data-tools'
import { createKnowledgeTools } from '../agent/tools/knowledge-tools'
import { createSkillTools } from '../agent/tools/skill-tools'
import { getAllSkills, getSkillById } from '../skills'
import { normalizeSettings, validateSettings } from '../settings'
import { assembleContextBlock, contextBuilder, estimateTokens } from './context-builder'
import { filterToolsBySurface } from './permission'
import { buildAssistantSystemPrompt } from './system-prompt'
import { stagedChangesStore } from './staged-changes-store'
import { makeStageChapterEditTool } from './tools/stage-chapter-edit'
import { makeStageEntitiesTools } from './tools/stage-entities'
import { type ToolFactory } from './agent-loop'
import type { ResolveTurnExecutionPlan } from './ipc'
import type { SnapshotAccessor } from './providers/shared'
import { saveRuntimeKnowledgeDocument } from './knowledge-writer'

/** 输出预算的下限。推理模型会把 reasoning 也算进 maxOutputTokens，不能太紧。 */
const DEFAULT_MAX_OUTPUT_TOKENS = 16000
const GLOBAL_CONTEXT_BUDGET_TOKENS = 24000
const CHAPTER_CONTEXT_BUDGET_TOKENS = 12000
const SELECTION_CONTEXT_BUDGET_TOKENS = 6000

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

    // 1. 构建上下文
    const contextBudgetTokens = resolveContextBudgetTokens(surface)
    const contextResult = await contextBuilder.build(surface, {
      surface,
      sessionId: session.id,
      projectId: session.projectId,
      scopeRef: session.scopeRef,
      budgetTokens: contextBudgetTokens
    })
    const contextBlock = assembleContextBlock(contextResult)

    // 2. 拼 system prompt
    const systemPrompt = buildAssistantSystemPrompt({
      surface,
      intentHint: request.intentHint,
      contextBlock
    })

    // 3. 组装工具集
    //    - 章节读写：read_chapter / list_chapters / search_project（丢弃旧 edit_chapter）
    //    - 项目数据：read_project_data
    //    - 技能：skill_list / skill_load / (skill_run_script 由内置 skill 决定)
    //    - 知识：knowledge_save_document（直接写入项目知识库，并刷新 workspace snapshot）
    //    - 变更暂存：stage_chapter_edit（工厂形态，闭包 turnId/sessionId）
    const currentChapterId = extractCurrentChapterId(session.scopeRef) ?? ''
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
      // v0.1 简化：只要 skill 自身启用就允许
      resolveSkillEnabled: (skill) => skill.enabled !== false,
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
        ...stageEntityTools
      ]
      return filterToolsBySurface(combined, surface)
    }

    // 4. 输出 token 预算
    const maxOutputTokens = Math.max(
      estimateTokens(systemPrompt) + 6000,
      DEFAULT_MAX_OUTPUT_TOKENS
    )

    return {
      systemPrompt,
      tools: toolFactory,
      settings,
      maxOutputTokens
    }
  }
}

function resolveContextBudgetTokens(surface: { id: string; scope: string }): number {
  if (surface.id === 'global-page' || surface.id === 'global-panel' || surface.scope === 'project') {
    return GLOBAL_CONTEXT_BUDGET_TOKENS
  }
  if (surface.id === 'chapter-panel' || surface.scope === 'chapter') {
    return CHAPTER_CONTEXT_BUDGET_TOKENS
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
