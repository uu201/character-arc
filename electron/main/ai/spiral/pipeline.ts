import type { AppSettings, AiTaskPayload, AiTaskKnowledgeContext } from '../shared-types'
import type {
  SpiralSeedResult,
  SpiralExpandResult,
  SpiralValidateResult,
  SpiralBootstrapResult,
  SpiralProgressEvent
} from './types'
import { runAiTask } from '../runtime/orchestrator'

export interface SpiralBootstrapInput {
  settings: AppSettings
  projectTitle: string
  projectGenre: string
  projectNovelLength: 'short' | 'long'
  projectPremise: string
  projectId?: string
  projectSkills?: unknown[]
}

export type SpiralProgressCallback = (event: SpiralProgressEvent) => void

const EMPTY_EXPAND: SpiralExpandResult = {
  supportingCharacters: [],
  outlineBeats: [],
  expandedWorldview: []
}

const EMPTY_VALIDATE: SpiralValidateResult = {
  arcValidation: { isComplete: true, gaps: [] },
  plotCausalChain: { isSound: true, breaks: [] },
  settingConsistency: { isConsistent: true, contradictions: [] },
  patches: { characterAdjustments: [], outlineAdjustments: [], worldviewAdditions: [] }
}

export async function runSpiralBootstrap(
  input: SpiralBootstrapInput,
  onProgress?: SpiralProgressCallback,
  signal?: AbortSignal
): Promise<SpiralBootstrapResult> {
  const baseContext: Record<string, unknown> = {
    projectTitle: input.projectTitle,
    projectGenre: input.projectGenre,
    projectNovelLength: input.projectNovelLength,
    projectPremise: input.projectPremise,
    projectId: input.projectId ?? '',
    projectSkills: input.projectSkills ?? []
  }

  // 第一圈必须成功，否则无法继续
  onProgress?.({ phase: 'seed', status: 'running' })
  const seedPayload: AiTaskPayload = {
    task: 'spiral-seed',
    settings: input.settings,
    context: { ...baseContext }
  }
  const seedResponse = await runAiTask(seedPayload, undefined, signal)
  const seed = seedResponse.result as unknown as SpiralSeedResult
  onProgress?.({ phase: 'seed', status: 'done', result: seed })

  if (signal?.aborted) throw new Error('螺旋生成已取消')

  // 第二圈失败时降级：用空 expand 结果，仍可从 seed 创建基础 workspace
  let expand: SpiralExpandResult = EMPTY_EXPAND
  onProgress?.({ phase: 'expand', status: 'running' })
  try {
    const expandPayload: AiTaskPayload = {
      task: 'spiral-expand',
      settings: input.settings,
      context: { ...baseContext, spiralSeedResult: seed }
    }
    const expandResponse = await runAiTask(expandPayload, undefined, signal)
    expand = expandResponse.result as unknown as SpiralExpandResult
    onProgress?.({ phase: 'expand', status: 'done', result: expand })
  } catch (error) {
    if (signal?.aborted) throw new Error('螺旋生成已取消')
    onProgress?.({ phase: 'expand', status: 'error', error: error instanceof Error ? error.message : '展开失败' })
  }

  if (signal?.aborted) throw new Error('螺旋生成已取消')

  // 第三圈失败时降级：跳过校验，不应用 patches
  let validate: SpiralValidateResult = EMPTY_VALIDATE
  onProgress?.({ phase: 'validate', status: 'running' })
  try {
    const validatePayload: AiTaskPayload = {
      task: 'spiral-validate',
      settings: input.settings,
      context: { ...baseContext, spiralSeedResult: seed, spiralExpandResult: expand }
    }
    const validateResponse = await runAiTask(validatePayload, undefined, signal)
    validate = validateResponse.result as unknown as SpiralValidateResult
    onProgress?.({ phase: 'validate', status: 'done', result: validate })
  } catch (error) {
    if (signal?.aborted) throw new Error('螺旋生成已取消')
    onProgress?.({ phase: 'validate', status: 'error', error: error instanceof Error ? error.message : '校验失败' })
  }

  return { seed, expand, validate }
}
