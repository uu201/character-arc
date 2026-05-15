export interface SpiralProtagonist {
  name: string
  coreDesire: string
  coreFlaw: string
  innerConflict: string
}

export interface SpiralMainArc {
  premise: string
  centralQuestion: string
  endingDirection: string
}

export interface SpiralWorldRule {
  type: string
  title: string
  content: string
}

export interface SpiralSeedResult {
  protagonist: SpiralProtagonist
  mainArc: SpiralMainArc
  worldRules: SpiralWorldRule[]
}

export interface SpiralSupportingCharacter {
  name: string
  role: string
  relationToProtagonist: string
  motivation: string
}

export interface SpiralOutlineBeat {
  title: string
  conflict: string
  characterDriven: string
  summary: string
  wordTarget: string
}

export interface SpiralExpandResult {
  supportingCharacters: SpiralSupportingCharacter[]
  outlineBeats: SpiralOutlineBeat[]
  expandedWorldview: SpiralWorldRule[]
}

export interface SpiralValidateResult {
  arcValidation: {
    isComplete: boolean
    gaps: string[]
  }
  plotCausalChain: {
    isSound: boolean
    breaks: string[]
  }
  settingConsistency: {
    isConsistent: boolean
    contradictions: string[]
  }
  patches: {
    characterAdjustments?: Array<{ name: string; field: string; before: string; after: string }>
    outlineAdjustments?: Array<{ title: string; field: string; before: string; after: string }>
    worldviewAdditions?: SpiralWorldRule[]
  }
}

export interface SpiralBootstrapResult {
  seed: SpiralSeedResult
  expand: SpiralExpandResult
  validate: SpiralValidateResult
}

export type SpiralPhase = 'seed' | 'expand' | 'validate'

export interface SpiralProgressEvent {
  phase: SpiralPhase
  status: 'running' | 'done' | 'error'
  result?: SpiralSeedResult | SpiralExpandResult | SpiralValidateResult
  error?: string
}
