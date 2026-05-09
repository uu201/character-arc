export interface ImageProviderPreset {
  label: string
  value: string
  model: string
  baseUrl: string
  hint: string
}

export const imageProviderPresets: ImageProviderPreset[] = [
  {
    label: 'GPT-Image-2 (OpenAI)',
    value: 'gpt-image-openai',
    model: 'gpt-image-1',
    baseUrl: 'https://api.openai.com/v1',
    hint: 'OpenAI 官方图片生成接口，支持 gpt-image-1。需要 OpenAI API Key。'
  },
  {
    label: 'GPT-Image-2 (云雾 AI)',
    value: 'gpt-image-yunwu',
    model: 'gpt-image-1',
    baseUrl: 'https://yunwu.ai/v1',
    hint: '云雾 AI 中转，兼容 OpenAI 格式。适合国内用户使用 GPT-Image 系列模型。'
  },
  {
    label: 'FLUX.1 (SiliconFlow)',
    value: 'flux-siliconflow',
    model: 'black-forest-labs/FLUX.1-schnell',
    baseUrl: 'https://api.siliconflow.cn/v1',
    hint: 'SiliconFlow 提供的 FLUX.1 系列模型。模型示例：FLUX.1-schnell / FLUX.1-dev。'
  },
  {
    label: 'Doubao Seedream 3.0 (火山引擎)',
    value: 'doubao-seedream',
    model: 'doubao-seedream-3.0',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    hint: '字节跳动火山引擎旗下的 Seedream 图片生成模型。'
  },
  {
    label: 'Kolors (快手可图)',
    value: 'kolors-siliconflow',
    model: 'Kwai-Kolors/Kolors',
    baseUrl: 'https://api.siliconflow.cn/v1',
    hint: 'SiliconFlow 提供的快手 Kolors 可图模型，适合生成高质量中文风格封面。'
  },
  {
    label: '通用 OpenAI 兼容接口',
    value: 'custom-openai-compatible',
    model: '',
    baseUrl: '',
    hint: '自定义 OpenAI 兼容的图片生成接口，请手动填写模型名和 Base URL。'
  }
]

export const imageProviderOptions = imageProviderPresets.map(({ label, value }) => ({ label, value }))

export function getImageProviderPreset(value: string): ImageProviderPreset {
  return imageProviderPresets.find((item) => item.value === value) ?? imageProviderPresets[imageProviderPresets.length - 1]
}

export function resolveImageProviderDefaults(value: string): { model: string; baseUrl: string } {
  const preset = getImageProviderPreset(value)
  return {
    model: preset.model,
    baseUrl: preset.baseUrl
  }
}
