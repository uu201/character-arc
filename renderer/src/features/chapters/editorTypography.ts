import type { EditorFont } from '@/types/app'

export interface EditorFontOption {
  id: EditorFont
  label: string
  shortLabel: string
  description: string
  fontFamily: string
}

export const DEFAULT_EDITOR_FONT: EditorFont = 'clear-mono'

export const editorFontOptions: readonly EditorFontOption[] = [
  {
    id: 'clear-mono',
    label: '标点清晰',
    shortLabel: '清晰',
    description: '弯引号方向清楚，中文保持现代黑体',
    fontFamily: 'Georgia, "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'
  },
  {
    id: 'modern-sans',
    label: '现代黑体',
    shortLabel: '黑体',
    description: '字形简洁，适合长时间屏幕阅读',
    fontFamily: '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif'
  },
  {
    id: 'classic-serif',
    label: '经典宋体',
    shortLabel: '宋体',
    description: '接近传统书稿的正文观感',
    fontFamily: 'SimSun, "Noto Serif CJK SC", "Source Han Serif SC", Georgia, serif'
  },
  {
    id: 'relaxed-kai',
    label: '舒展楷体',
    shortLabel: '楷体',
    description: '笔画舒展，适合沉浸式写作',
    fontFamily: 'KaiTi, STKaiti, serif'
  },
  {
    id: 'system',
    label: '系统默认',
    shortLabel: '默认',
    description: '跟随应用界面字体',
    fontFamily: 'inherit'
  }
] as const

export function isEditorFont(value: unknown): value is EditorFont {
  return editorFontOptions.some((option) => option.id === value)
}

export function getEditorFontOption(value: unknown): EditorFontOption {
  return editorFontOptions.find((option) => option.id === value) ?? editorFontOptions[0]
}
