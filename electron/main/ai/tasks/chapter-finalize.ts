import type { AiTaskResult, ChapterFinalizationResult } from '../shared-types'
import {
  normalizeFinalizationPreview,
  summarizePreviewForDisplay,
  validateFinalizationPreview
} from '../chapter-finalization'
import type { PromptBuildInput, TaskHandler } from './base'
import { extractJsonObject } from './base'

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2)
  } catch {
    return 'null'
  }
}

function optionalBlock(title: string, value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : formatJson(value)
  return text ? `\n\n## ${title}\n${text}` : ''
}

const handler: TaskHandler = {
  name: 'chapter-finalize',
  outputType: 'json',
  defaultCapabilities: ['settings', 'chapters', 'analysis', 'worldview', 'characters', 'relations', 'outline', 'project-skills'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble, knowledgeBlock, skillsBlock } = input
    const userGuidance = String(context.userGuidance ?? '').trim()
    const previousPreview = context.previousPreview

    return {
      system: `${capabilityPreamble.system}

你是长篇小说章节归档助手。你的任务不是改写正文，而是在用户确认一章已经完成前，生成一份可审阅的归档预览。预览通过后，系统会把它写入章节摘要和故事状态库。

请遵守：
1. 只根据本章正文和可用项目上下文提取已经发生的事实，不要替后续剧情下结论。
2. 如果某项状态不确定，可以放入 warnings，不要强行写入 stateDelta。
3. nextChapterBridge 应该描述下一章必须承接的状态、压力或悬念，不要写成营销式预告。
4. 如果用户提供了“重新生成预览”的调整意见，要优先修正预览；如果没有意见，也要生成一版完整预览。
5. 只返回 JSON，不要 Markdown，不要额外解释。

返回格式：
{
  "chapterSummary": "80-180 字，客观概括本章已发生事实",
  "stateDelta": {
    "characters_updated": [
      {
        "character_id": "角色名或稳定标识",
        "changes": {
          "location": {"from": "", "to": ""},
          "physical_state": "",
          "mental_state": "",
          "arc_progression": "",
          "power_level": "",
          "inventory_delta": {"added": [], "removed": []},
          "new_knowledge": [],
          "goals_update": {"completed": [], "added": []}
        }
      }
    ],
    "relationships_delta": [
      {
        "relationship_id": "关系标识",
        "participants": ["角色A", "角色B"],
        "status_change": {"from": "", "to": "", "pivot_event": ""},
        "new_tension_points": []
      }
    ],
    "foreshadowing_delta": {
      "planted": [{"id": "", "type": "", "description": "", "method": "", "payoff_chapter": null}],
      "advanced": [{"id": "", "clue": "", "method": ""}],
      "resolved": [{"id": "", "method": "", "impact": ""}]
    },
    "timeline": {
      "story_time_elapsed": "",
      "current_story_date": "",
      "events": [],
      "world_state_changes": []
    }
  },
  "nextChapterBridge": "下一章需要接住的状态、压力、动作或悬念",
  "warnings": []
}`,
      user: `${capabilityPreamble.user}

请为当前章节生成“确认归档”预览。

项目：${String(context.projectTitle ?? '')}
章节标题：${String(context.chapterTitle ?? '')}
当前章节摘要：${String(context.chapterSummary ?? '')}
章节序号：${String(context.chapterIndex ?? '')}

${userGuidance ? `## 用户用于重新生成预览的调整意见\n${userGuidance}\n` : '## 用户用于重新生成预览的调整意见\n（无，直接重新生成一版预览）\n'}

## 当前章节正文
${String(context.chapterContent ?? '')}
${optionalBlock('相邻章节摘要', context.nearbyChapters)}
${optionalBlock('当前故事状态', context.storyState)}
${optionalBlock('上一版归档预览', previousPreview)}
${knowledgeBlock ? `\n\n## 检索到的项目记忆\n${knowledgeBlock}` : ''}
${skillsBlock ? `\n\n## 可参考的项目 skills\n${skillsBlock}` : ''}

请返回严格 JSON。`
    }
  },
  normalize(raw: string): AiTaskResult {
    return normalizeFinalizationPreview(extractJsonObject(raw)) as ChapterFinalizationResult
  },
  validate(result: AiTaskResult): boolean {
    return validateFinalizationPreview(result as ChapterFinalizationResult)
  },
  describeValidationErrors(result: AiTaskResult): string[] {
    const preview = result as ChapterFinalizationResult
    if (validateFinalizationPreview(preview)) return []
    return [
      '归档预览至少需要包含章节摘要、下一章承接或可写入的故事状态更新。',
      `当前预览内容：${summarizePreviewForDisplay(preview) || '空'}`
    ]
  },
  resolveMaxTokens(): number {
    return 3000
  },
  maxSkills: 6
}

export default handler
