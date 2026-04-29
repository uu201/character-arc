import type { ProjectSummary } from '@/types/app'

export type WritingStylePreset = {
  id: string
  label: string
  description: string
  prompt: string
  accent: string
}

export const defaultWritingStylePresetId = 'cinematic-cool'

export const writingStylePresets: WritingStylePreset[] = [
  {
    id: 'cinematic-cool',
    label: '冷峻电影感',
    description: '镜头感强，画面冷白克制，适合科幻、悬疑和都市夜景。',
    prompt:
      '整体写作风格偏冷峻电影感。句子干净克制，画面构图清晰，细节以光线、动作、材质和环境声推进，不要过度抒情。情绪表达以内敛张力为主。',
    accent: 'linear-gradient(135deg, #dbeafe, #e0f2fe)'
  },
  {
    id: 'lyrical-poetic',
    label: '诗性抒情',
    description: '意象更浓，情绪更细，适合成长、情感和奇幻氛围场景。',
    prompt:
      '整体写作风格偏诗性抒情。允许使用更柔和的意象、节奏和感官描写，重视情绪递进与回味，但仍要保证剧情信息清晰，不要空泛堆词。',
    accent: 'linear-gradient(135deg, #fce7f3, #ede9fe)'
  },
  {
    id: 'suspense-pressure',
    label: '悬疑压迫感',
    description: '更强调不安、迟疑和信息落差，适合追踪、潜伏与危机章节。',
    prompt:
      '整体写作风格偏悬疑压迫感。优先制造不确定性、风险感和节奏收束，句子可适度短促，细节围绕异常、停顿、误差和危险信号展开。',
    accent: 'linear-gradient(135deg, #e2e8f0, #cbd5e1)'
  },
  {
    id: 'fast-paced-webnovel',
    label: '爽文推进',
    description: '节奏更快、信息更直给，适合升级、反击和强推进情节。',
    prompt:
      '整体写作风格偏网文爽感推进。信息传达要直接，冲突要尽快落地，段落节奏明快，强调动作、反馈和结果，不要在同一情绪里停留过久。',
    accent: 'linear-gradient(135deg, #d1fae5, #dcfce7)'
  },
  {
    id: 'youthful-light',
    label: '轻快少年感',
    description: '语气更轻盈，角色互动更活，适合校园、冒险和群像对话。',
    prompt:
      '整体写作风格偏轻快少年感。对话和互动要自然有弹性，情绪更鲜活，允许适度幽默和轻松呼吸感，但不要削弱关键冲突的力度。',
    accent: 'linear-gradient(135deg, #fef3c7, #fde68a)'
  },
  {
    id: 'realist-restraint',
    label: '克制现实向',
    description: '语言朴实、观察细密，适合现实题材和心理变化描写。',
    prompt:
      '整体写作风格偏克制现实向。语言应当自然、准确、不过分修饰，重视人物行为逻辑和心理波动的细微变化，让情绪从行动和细节里显现。',
    accent: 'linear-gradient(135deg, #f3f4f6, #e5e7eb)'
  }
]

export function resolveWritingStylePreset(presetId?: string | null): WritingStylePreset {
  return writingStylePresets.find((preset) => preset.id === presetId) ?? writingStylePresets[0]
}

export function buildProjectWritingStyleContext(project?: Pick<ProjectSummary, 'writingStylePresetId' | 'writingStylePrompt'> | null): {
  presetId: string
  label: string
  description: string
  prompt: string
  accent: string
} {
  const preset = resolveWritingStylePreset(project?.writingStylePresetId)
  const customPrompt = project?.writingStylePrompt?.trim() || ''

  return {
    presetId: preset.id,
    label: preset.label,
    description: preset.description,
    prompt: [preset.prompt, customPrompt].filter(Boolean).join('\n'),
    accent: preset.accent
  }
}
