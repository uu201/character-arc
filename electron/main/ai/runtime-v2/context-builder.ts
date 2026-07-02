/**
 * ContextBuilder
 *
 * Surface-aware 上下文构建。取代旧的 `buildGlobalAssistantContext` +
 * `buildChapterAssistantContext` 两套硬编码。
 *
 * 关键机制：
 *  1. Provider 注册制：每个数据源实现 `ContextProvider`，按 id 挂载
 *  2. Surface 声明所需的 provider 集合（未声明则用全部适用者）
 *  3. 按 `priority` 降序调用 `build`，累积 token 预算
 *  4. 超预算的 provider 被 **降级为占位 slice**（保留 heading + 一行提示），
 *     并明确告诉模型"可通过 read_ / search_ 系列工具补齐"——学 Claude CLI 的做法
 *  5. 最终 `assembleContextBlock` 拼装成 markdown 段落，注入 system prompt
 */

import type {
  ContextBuildRequest,
  ContextProviderId,
  ContextSlice,
  SurfaceDefinition
} from '@shared/assistant-runtime'

/**
 * Provider 抽象。id 可以是内置枚举，也可以是第三方扩展的自由字符串。
 */
export interface ContextProvider {
  id: ContextProviderId | string
  /** 越大越先构建、越优先保留。 */
  priority: number
  /**
   * 决定是否对当前 Surface 生效。例如 `current-chapter` 只在 `scope !== 'project'` 时生效。
   * 缺省 = 所有 Surface 都生效。
   */
  isApplicable?(surface: SurfaceDefinition): boolean
  /** 构建 slice。返回 null 表示暂无内容（如章节未选中）。 */
  build(request: ContextBuildRequest): Promise<ContextSlice | null>
  /**
   * 被超预算裁剪时的占位文案（body 内容）。
   * 需要提示模型可以通过哪个工具补齐。缺省用泛型话术。
   */
  truncationHint?: string
}

// ============================================================================
// Token 估算
// ============================================================================

/**
 * 混合中英文场景的粗略 token 估算。用于预算裁剪，宁可高估防爆预算。
 *
 * 经验值（Claude/GPT tokenizer）：
 *   - 中文 / 日文 / 韩文汉字：1 字 ≈ 0.6~1 token → 保守取 0.7
 *   - 拉丁字符 + 空格 + 标点：≈ 4 chars/token → 0.25 tokens/char
 *
 * 无需精确，量级正确即可（预算裁剪本身是保守策略）。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjkMatches = text.match(/[぀-ヿ㐀-䶿一-鿿가-힯ｦ-ﾟ]/g)
  const cjkCount = cjkMatches ? cjkMatches.length : 0
  const nonCjkCount = text.length - cjkCount
  return Math.ceil(cjkCount * 0.7 + nonCjkCount * 0.25)
}

// ============================================================================
// ContextBuilder
// ============================================================================

/** 构建结果，供上层拼装 prompt 与 UI 展示。 */
export interface BuildResult {
  /** 最终参与 prompt 的 slice 列表（含 truncated 占位）。 */
  slices: ContextSlice[]
  /** 总 token 消耗（含占位说明本身的开销）。 */
  usedTokens: number
  /** 因预算不足而降级为占位的 provider id 列表。 */
  truncatedProviderIds: string[]
}

const DEFAULT_TRUNCATION_HINT =
  '内容较多，此处省略。若需了解详情，可调用相应工具（read_project_data / search_project / read_chapter）主动查询。'

/**
 * 构建器主类。整个 Runtime 一个单例即可；provider 在启动阶段注册完毕。
 */
export class ContextBuilder {
  private readonly providers = new Map<string, ContextProvider>()

  /** 注册 provider。id 冲突时后注册者覆盖前者。 */
  register(provider: ContextProvider): void {
    this.providers.set(provider.id, provider)
  }

  unregister(id: string): void {
    this.providers.delete(id)
  }

  has(id: string): boolean {
    return this.providers.has(id)
  }

  /** 调试/UI 用：列出全部已注册 provider id。 */
  listProviderIds(): string[] {
    return Array.from(this.providers.keys())
  }

  /**
   * 决定当前 Surface 要用哪些 provider。
   *   1. Surface 显式声明 contextProviders → 只取声明的
   *   2. 否则取全部已注册者
   *   3. 用 isApplicable(surface) 再过滤一层
   *   4. 按 priority 降序排序
   */
  private resolveApplicable(surface: SurfaceDefinition): ContextProvider[] {
    const candidates: ContextProvider[] = []
    if (surface.contextProviders && surface.contextProviders.length > 0) {
      for (const id of surface.contextProviders) {
        const p = this.providers.get(id)
        if (p) candidates.push(p)
      }
    } else {
      candidates.push(...this.providers.values())
    }
    return candidates
      .filter((p) => (p.isApplicable ? p.isApplicable(surface) : true))
      .sort((a, b) => b.priority - a.priority)
  }

  /**
   * 主流程：按优先级构建、按预算裁剪。
   * 高优先级 provider 完整保留；剩余预算不足以容纳某 provider 时降级为占位。
   */
  async build(
    surface: SurfaceDefinition,
    request: ContextBuildRequest
  ): Promise<BuildResult> {
    const applicable = this.resolveApplicable(surface)
    const slices: ContextSlice[] = []
    const truncatedProviderIds: string[] = []
    let remaining = request.budgetTokens

    for (const provider of applicable) {
      let slice: ContextSlice | null
      try {
        slice = await provider.build(request)
      } catch (e) {
        // 单个 provider 失败不影响其余
        console.error(`[ContextBuilder] provider "${provider.id}" build failed:`, e)
        continue
      }
      if (!slice) continue

      // 首选完整保留
      if (slice.estimatedTokens <= remaining) {
        slices.push(slice)
        remaining -= slice.estimatedTokens
        continue
      }

      // 超预算：降级为占位 slice
      const hint = provider.truncationHint ?? DEFAULT_TRUNCATION_HINT
      const placeholder: ContextSlice = {
        providerId: slice.providerId,
        priority: slice.priority,
        heading: slice.heading,
        body: hint,
        estimatedTokens: estimateTokens(hint),
        truncated: true
      }
      if (placeholder.estimatedTokens <= remaining) {
        slices.push(placeholder)
        remaining -= placeholder.estimatedTokens
        truncatedProviderIds.push(String(slice.providerId))
      } else {
        // 连占位都塞不下：直接舍弃并记录
        truncatedProviderIds.push(String(slice.providerId))
      }
    }

    return {
      slices,
      usedTokens: request.budgetTokens - remaining,
      truncatedProviderIds
    }
  }
}

/** 单例，Runtime 全局共享；provider 在启动阶段一次性注册。 */
export const contextBuilder = new ContextBuilder()

// ============================================================================
// Prompt 拼装
// ============================================================================

/**
 * 把 slice 列表拼成一段可注入 system prompt 的 markdown。
 *
 * 每个 slice 一节：
 *   ## <heading>
 *   <body>
 * ---
 *
 * 若整体裁剪信息不为空，尾部追加一段说明，指导模型主动调工具补齐。
 */
export function assembleContextBlock(result: BuildResult): string {
  const sections = result.slices.map((s) => `## ${s.heading}\n\n${s.body}`)
  let out = sections.join('\n\n---\n\n')

  if (result.truncatedProviderIds.length > 0) {
    out +=
      '\n\n---\n\n' +
      `> 上下文预算受限，以下模块已省略：${result.truncatedProviderIds.join(', ')}。` +
      '若与用户需求相关，请主动调用 read_project_data / search_project / read_chapter 等工具查询。'
  }

  return out
}
