import type { Tool, ToolHandlerResult } from '../agent/tools/types'
import type { AssistantRuntimePlan } from './planner'

export interface EvidenceSource {
  tool: string
  args: Record<string, unknown>
  preview: string
  ok: boolean
}

export interface EvidenceLedgerSnapshot {
  sources: EvidenceSource[]
  readCalls: number
  searchCalls: number
  stageCalls: number
  budgetExhausted: boolean
  notes: string[]
}

export class EvidenceLedger {
  private readonly sources: EvidenceSource[] = []
  private readonly notes: string[] = []
  readCalls = 0
  searchCalls = 0
  stageCalls = 0
  budgetExhausted = false

  recordToolResult(
    tool: string,
    args: Record<string, unknown>,
    result: ToolHandlerResult
  ): void {
    this.sources.push({
      tool,
      args,
      preview: normalizePreview(result.content),
      ok: result.isError !== true
    })
  }

  markBudgetExhausted(note: string): void {
    this.budgetExhausted = true
    this.notes.push(note)
  }

  snapshot(): EvidenceLedgerSnapshot {
    return {
      sources: this.sources.slice(-20),
      readCalls: this.readCalls,
      searchCalls: this.searchCalls,
      stageCalls: this.stageCalls,
      budgetExhausted: this.budgetExhausted,
      notes: this.notes.slice(-10)
    }
  }
}

export function createEvidenceLedger(): EvidenceLedger {
  return new EvidenceLedger()
}

export function wrapToolsWithRuntimeBudget(
  tools: Tool[],
  plan: AssistantRuntimePlan,
  ledger: EvidenceLedger
): Tool[] {
  return tools.map((tool) => ({
    ...tool,
    handler: async (input, ctx) => {
      const args = normalizeArgs(input)
      const kind = classifyTool(tool.definition.name)
      if (kind === 'read') {
        ledger.readCalls += 1
        if (ledger.readCalls > plan.maxReadToolCalls) {
          return stopForBudget(ledger, `本批读取次数已达上限（${plan.maxReadToolCalls} 次）。请基于已有证据给出阶段结论，并说明下一批需要继续读取什么。`)
        }
      } else if (kind === 'search') {
        ledger.searchCalls += 1
        if (ledger.searchCalls > plan.maxSearchToolCalls) {
          return stopForBudget(ledger, `本批搜索次数已达上限（${plan.maxSearchToolCalls} 次）。请停止搜索并整理阶段结论。`)
        }
      } else if (kind === 'stage') {
        ledger.stageCalls += 1
        if (ledger.stageCalls > plan.maxStageChanges) {
          return stopForBudget(ledger, `本批暂存变更数量已达上限（${plan.maxStageChanges} 项）。请先让用户审阅当前批次。`)
        }
      }

      const nextArgs = coerceLightweightArgs(tool.definition.name, args, plan)
      const result = await tool.handler(nextArgs, ctx)
      ledger.recordToolResult(tool.definition.name, nextArgs, result)
      return result
    }
  }))
}

function normalizeArgs(input: Record<string, unknown>): Record<string, unknown> {
  return input && typeof input === 'object' ? { ...input } : {}
}

function classifyTool(name: string): 'read' | 'search' | 'stage' | 'other' {
  if (name === 'search_project') return 'search'
  if (name.startsWith('stage_')) return 'stage'
  if (name.startsWith('read_') || name.startsWith('list_')) return 'read'
  return 'other'
}

function coerceLightweightArgs(
  toolName: string,
  args: Record<string, unknown>,
  plan: AssistantRuntimePlan
): Record<string, unknown> {
  const next = { ...args }
  if (toolName === 'search_project') {
    const max = typeof next.max_results === 'number' ? next.max_results : plan.defaultReadLimit
    next.max_results = Math.max(1, Math.min(Math.floor(max), plan.defaultReadLimit))
  }
  if (toolName === 'read_project_data') {
    const hasPreciseTarget = Boolean(String(next.entity_id ?? '').trim() || String(next.doc_key ?? '').trim())
    const entityType = String(next.entity_type ?? '').trim()
    if (!hasPreciseTarget || !plan.allowFullProjectModuleRead) {
      if (next.summary_only !== false || !hasPreciseTarget) next.summary_only = true
      if (typeof next.limit !== 'number' && entityType !== 'outline') next.limit = plan.defaultReadLimit
    }
  }
  if (toolName === 'read_chapter') {
    if (next.include_content !== true || !plan.allowFullChapterRead) {
      next.include_content = false
    }
  }
  return next
}

function stopForBudget(ledger: EvidenceLedger, note: string): ToolHandlerResult {
  ledger.markBudgetExhausted(note)
  return { content: note }
}

function normalizePreview(content: string): string {
  const flat = String(content ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > 320 ? `${flat.slice(0, 317)}...` : flat
}
