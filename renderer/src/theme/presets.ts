import type { GlobalThemeOverrides } from 'naive-ui'
import type { DarkModeStyle, ThemeName } from '@/types/app'

// 主题预设结构定义
export interface ThemePreset {
  name: ThemeName        // 主题标识名
  label: string          // 主题显示名称
  primary: string        // 主色调
  primaryHover: string   // 主色调悬停态
  primaryPressed: string // 主色调按下态
  darkPrimary: string        // 深色模式主色调
  darkPrimaryHover: string   // 深色模式悬停态
  darkPrimaryPressed: string // 深色模式按下态
  softBackground: string // 柔和背景色（用于标签、徽章等浅色区域）
}

// 内置主题预设列表
export const themePresets: ThemePreset[] = [
  {
    name: 'ocean',
    label: '海蓝',
    primary: '#0066cc',
    primaryHover: '#0b76e8',
    primaryPressed: '#0058b0',
    darkPrimary: '#347fc7',
    darkPrimaryHover: '#438ed7',
    darkPrimaryPressed: '#286baa',
    softBackground: '#ebf3fa'
  },
  {
    name: 'jade',
    label: '玉绿',
    primary: '#0f8b6d',
    primaryHover: '#14a17f',
    primaryPressed: '#0d755c',
    darkPrimary: '#238b73',
    darkPrimaryHover: '#2d9d83',
    darkPrimaryPressed: '#1b735f',
    softBackground: '#e9f7f2'
  },
  {
    name: 'amber',
    label: '琥珀',
    primary: '#d97706',
    primaryHover: '#ea8b1a',
    primaryPressed: '#bc6604',
    darkPrimary: '#b87520',
    darkPrimaryHover: '#ca8428',
    darkPrimaryPressed: '#965d17',
    softBackground: '#fff3df'
  },
  {
    name: 'rose',
    label: '玫红',
    primary: '#c43d6b',
    primaryHover: '#db4a7a',
    primaryPressed: '#aa355d',
    darkPrimary: '#b65376',
    darkPrimaryHover: '#ca6287',
    darkPrimaryPressed: '#98415f',
    softBackground: '#fdeef4'
  }
]

// 根据主题名查找预设，未找到时回退到第一个预设
export function getThemePreset(name: ThemeName): ThemePreset {
  return themePresets.find((preset) => preset.name === name) ?? themePresets[0]
}

export interface DarkModePreset {
  name: DarkModeStyle
  label: string
  description: string
  bgBody: string
  bgWeak: string
  bgSurface: string
  bgSurfaceHover: string
  bgSidebar: string
  sidebarBorder: string
  textPrimary: string
  textSecondary: string
  textHint: string
  border: string
  borderStrong: string
  shadowSm: string
  shadowMd: string
  shadowLg: string
  bgMix: string
  primarySoftBase: string
}

export const darkModePresets: DarkModePreset[] = [
  {
    name: 'nord',
    label: '深夜中性',
    description: '中性炭灰背景配合清晰的内容层级，减少偏蓝与泛灰，适合长时间写作。',
    bgBody: '#111315',
    bgWeak: '#181b1f',
    bgSurface: '#1e2227',
    bgSurfaceHover: '#272c33',
    bgSidebar: '#15181c',
    sidebarBorder: '#2a2f36',
    textPrimary: '#f1f3f5',
    textSecondary: '#b8bec7',
    textHint: '#7f8894',
    border: '#30353d',
    borderStrong: '#424953',
    shadowSm: '0 1px 3px rgba(0, 0, 0, 0.3)',
    shadowMd: '0 8px 24px rgba(0, 0, 0, 0.34)',
    shadowLg: '0 18px 48px rgba(0, 0, 0, 0.4)',
    bgMix: '#191c20',
    primarySoftBase: '#20252b'
  }
]

export function getDarkModePreset(name: DarkModeStyle): DarkModePreset {
  return darkModePresets.find((preset) => preset.name === name) ?? darkModePresets[0]
}

// 将主题预设转换为 Naive UI 的全局主题覆盖配置
export function createNaiveThemeOverrides(
  name: ThemeName,
  darkMode: boolean = false,
  darkStyle: DarkModeStyle = 'nord'
): GlobalThemeOverrides {
  const preset = getThemePreset(name)
  const dark = getDarkModePreset(darkStyle)
  const primary = darkMode ? preset.darkPrimary : preset.primary
  const primaryHover = darkMode ? preset.darkPrimaryHover : preset.primaryHover
  const primaryPressed = darkMode ? preset.darkPrimaryPressed : preset.primaryPressed

  const darkCommon: GlobalThemeOverrides['common'] = darkMode
    ? {
        bodyColor: dark.bgBody,
        cardColor: dark.bgSurface,
        modalColor: dark.bgSurface,
        popoverColor: dark.bgSurface,
        tableColor: dark.bgSurface,
        tableHeaderColor: dark.bgWeak,
        inputColor: dark.bgWeak,
        inputColorDisabled: dark.bgWeak,
        actionColor: dark.bgSurfaceHover,
        hoverColor: dark.bgSurfaceHover,
        pressedColor: dark.bgSurfaceHover,
        tagColor: dark.bgSurfaceHover,
        borderColor: dark.border,
        dividerColor: dark.border,
        textColorBase: dark.textPrimary,
        textColor1: dark.textPrimary,
        textColor2: dark.textSecondary,
        textColor3: dark.textHint,
        placeholderColor: dark.textHint,
        iconColor: dark.textSecondary,
        closeIconColor: dark.textSecondary
      }
    : {}

  return {
    common: {
      primaryColor: primary,
      primaryColorHover: primaryHover,
      primaryColorPressed: primaryPressed,
      primaryColorSuppl: primaryHover,
      borderRadius: '6px',
      borderRadiusSmall: '4px',
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif',
      ...darkCommon
    },
    Button: {
      borderRadiusMedium: '6px',
      borderRadiusSmall: '6px',
      borderRadiusLarge: '8px',
      paddingMedium: '0 14px',
      fontWeight: '600'
    },
    Input: {
      borderRadius: '6px'
    },
    Select: {
      peers: {
        InternalSelection: {
          borderRadius: '6px'
        }
      }
    },
    Card: {
      borderRadius: '10px'
    },
    Modal: {
      borderRadius: '10px'
    },
    Dialog: {
      borderRadius: '10px'
    }
  }
}
