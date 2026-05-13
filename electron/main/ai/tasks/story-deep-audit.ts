import type { TaskHandler, PromptBuildInput } from './base'
import { normalizeAssistantText } from './base'
import type { AiTaskResult, ChapterAssistantResult } from '../shared-types'

const handler: TaskHandler = {
  name: 'story-deep-audit',
  outputType: 'text',
  defaultCapabilities: ['settings', 'chapters', 'analysis', 'worldview', 'characters', 'relations', 'outline', 'project-skills'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble, skillsBlock } = input

    const storyStateBlock = String(context.storyStateBlock ?? '').trim()
    const projectTitle = String(context.projectTitle ?? '').trim() || '当前项目'
    const currentChapter = Number(context.currentChapterIndex ?? 0)

    return {
      system: `${capabilityPreamble.system}

你是一个**长篇小说一致性审计专家**。你的任务是对当前项目进行全面的一致性检查，发现潜在问题并生成审计报告。

## 审计维度

1. **伏笔健康度** — 未解伏笔是否积压过多？是否有超期未回收的伏笔？
2. **角色出场频率** — 主要角色是否长期消失（>50章无戏份）？
3. **节奏评估** — 是否存在连续30章以上紧张度无变化的区间？
4. **主题偏离** — 核心主题是否超过100章未被触及？
5. **设定矛盾** — 是否存在前后矛盾的世界观设定？
6. **关系僵化** — 是否有关系长期无互动变成"僵尸关系"？
7. **时间线连贯** — 故事内时间是否有跳跃或矛盾？

## 输出格式

输出一份结构化的中文审计报告，使用以下格式：

### 审计概要
- 当前进度、总体健康度评级（优/良/中/差）

### 伏笔健康度
- 活跃伏笔数、超期伏笔列表、密度是否合理

### 角色活跃度
- 长期消失的角色列表、建议回归时机

### 节奏评估
- 是否存在节奏疲劳区间、建议调整

### 关系网络
- 僵尸关系列表、建议激活方式

### 设定一致性
- 发现的矛盾点（如有）

### 改进建议
- 按优先级排列的具体行动建议

${skillsBlock ? `\n## 项目启用 skills\n${skillsBlock}` : ''}`,
      user: `${capabilityPreamble.user}

## 审计上下文

项目：${projectTitle}
当前进度：第 ${currentChapter} 章

## 当前世界状态（来自结构化状态库）

${storyStateBlock || '（状态库为空，可能是新项目或尚未开始写作。请基于可用的章节和大纲信息进行审计。）'}

## 审计指令

请基于以上世界状态数据，执行全面一致性审计。如果状态库数据不足，请明确指出哪些维度无法评估，并给出建议（如"建议先生成几章以积累状态数据"）。`
    }
  },
  normalize(raw: string): AiTaskResult {
    return normalizeAssistantText(raw) as AiTaskResult
  },
  validate(result: AiTaskResult): boolean {
    return Boolean((result as ChapterAssistantResult).content?.trim())
  },
  resolveMaxTokens(): number {
    return 4000
  }
}
export default handler
