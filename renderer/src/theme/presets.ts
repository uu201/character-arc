import type { GlobalThemeOverrides } from 'naive-ui'
import type { DarkModeStyle, ThemeName } from '@/types/app'

// 主题预设结构定义
export interface ThemePreset {
  name: ThemeName        // 主题标识名
  label: string          // 主题显示名称
  primary: string        // 主色调
  primaryHover: string   // 主色调悬停态
  primaryPressed: string // 主色调按下态
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
    softBackground: '#ebf3fa'
  },
  {
    name: 'jade',
    label: '玉绿',
    primary: '#0f8b6d',
    primaryHover: '#14a17f',
    primaryPressed: '#0d755c',
    softBackground: '#e9f7f2'
  },
  {
    name: 'amber',
    label: '琥珀',
    primary: '#d97706',
    primaryHover: '#ea8b1a',
    primaryPressed: '#bc6604',
    softBackground: '#fff3df'
  },
  {
    name: 'rose',
    label: '玫红',
    primary: '#c43d6b',
    primaryHover: '#db4a7a',
    primaryPressed: '#aa355d',
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
    name: 'standard',
    label: '中性暗灰',
    description: '默认深色风格，柔和中性灰背景，长时间写作不刺眼。',
    bgBody: '#0c0c0e',
    bgWeak: '#111115',
    bgSurface: '#18181b',
    bgSurfaceHover: '#27272a',
    bgSidebar: '#111115',
    sidebarBorder: '#27272a',
    textPrimary: '#f4f4f5',
    textSecondary: '#a1a1aa',
    textHint: '#71717a',
    border: '#27272a',
    borderStrong: '#3f3f46',
    shadowSm: '0 1px 3px rgba(0, 0, 0, 0.36)',
    shadowMd: '0 4px 12px rgba(0, 0, 0, 0.5)',
    shadowLg: '0 8px 24px rgba(0, 0, 0, 0.6)',
    bgMix: '#18181b',
    primarySoftBase: '#18181b'
  },
  {
    name: 'nord',
    label: 'Nord 北欧',
    description: '冷静克制的北欧蓝灰，界面干净、层次柔和。',
    bgBody: '#2e3440',
    bgWeak: '#343a48',
    bgSurface: '#3b4252',
    bgSurfaceHover: '#434c5e',
    bgSidebar: '#343a48',
    sidebarBorder: '#4c566a',
    textPrimary: '#eceff4',
    textSecondary: '#d8dee9',
    textHint: '#9aa3b1',
    border: '#4c566a',
    borderStrong: '#5e6b83',
    shadowSm: '0 1px 3px rgba(17, 20, 28, 0.46)',
    shadowMd: '0 6px 18px rgba(17, 20, 28, 0.56)',
    shadowLg: '0 14px 36px rgba(17, 20, 28, 0.66)',
    bgMix: '#3b4252',
    primarySoftBase: '#3b4252'
  }
]

export function getDarkModePreset(name: DarkModeStyle): DarkModePreset {
  return darkModePresets.find((preset) => preset.name === name) ?? darkModePresets[0]
}

// 将主题预设转换为 Naive UI 的全局主题覆盖配置
export function createNaiveThemeOverrides(
  name: ThemeName,
  darkMode: boolean = false,
  darkStyle: DarkModeStyle = 'standard'
): GlobalThemeOverrides {
  const preset = getThemePreset(name)
  const dark = getDarkModePreset(darkStyle)

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
      primaryColor: preset.primary,
      primaryColorHover: preset.primaryHover,
      primaryColorPressed: preset.primaryPressed,
      primaryColorSuppl: preset.primaryHover,
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
