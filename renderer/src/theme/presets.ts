import type { GlobalThemeOverrides } from 'naive-ui'
import type { ThemeName } from '@/types/app'

export interface ThemePreset {
  name: ThemeName
  label: string
  primary: string
  primaryHover: string
  primaryPressed: string
  softBackground: string
}

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

export function getThemePreset(name: ThemeName): ThemePreset {
  return themePresets.find((preset) => preset.name === name) ?? themePresets[0]
}

export function createNaiveThemeOverrides(name: ThemeName): GlobalThemeOverrides {
  const preset = getThemePreset(name)

  return {
    common: {
      primaryColor: preset.primary,
      primaryColorHover: preset.primaryHover,
      primaryColorPressed: preset.primaryPressed,
      primaryColorSuppl: preset.primaryHover,
      borderRadius: '6px',
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif'
    },
    Button: {
      borderRadiusMedium: '6px',
      paddingMedium: '0 16px',
      fontWeight: '500'
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
    Modal: {
      borderRadius: '8px'
    }
  }
}
