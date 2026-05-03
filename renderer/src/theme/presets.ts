import type { GlobalThemeOverrides } from 'naive-ui'
import type { ThemeName } from '@/types/app'

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

// 将主题预设转换为 Naive UI 的全局主题覆盖配置
export function createNaiveThemeOverrides(name: ThemeName): GlobalThemeOverrides {
  const preset = getThemePreset(name)

  return {
    common: {
      primaryColor: preset.primary,
      primaryColorHover: preset.primaryHover,
      primaryColorPressed: preset.primaryPressed,
      primaryColorSuppl: preset.primaryHover,
      borderRadius: '6px',
      borderRadiusSmall: '4px',
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif'
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
