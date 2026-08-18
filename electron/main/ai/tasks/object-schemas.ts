import { z } from 'zod'
import type { AiTaskName } from '../shared-types'

const stringField = z.string()
const stringList = z.array(z.string())
const recordField = z.record(z.string(), z.unknown())

const worldviewEntrySchema = z.object({
  type: stringField,
  title: stringField,
  content: stringField
})

const outlineItemSchema = z.object({
  title: stringField,
  wordTarget: stringField,
  conflict: stringField,
  summary: stringField,
  relatedCharacterIds: stringList.optional(),
  relatedOrganizationIds: stringList.optional(),
  relatedWorldviewIds: stringList.optional()
})

const taskObjectSchemas: Partial<Record<AiTaskName, z.ZodTypeAny>> = {
  'ranking-idea-combinations': z.object({
    directions: z.array(z.object({
      id: stringField,
      name: stringField,
      rationale: stringField,
      readerPromise: stringField,
      risk: stringField,
      combinations: z.array(z.object({
        id: stringField,
        title: stringField,
        genre: stringField,
        premise: stringField,
        hook: stringField,
        protagonist: stringField,
        world: stringField,
        conflict: stringField,
        innovation: stringField,
        tags: stringList
      }))
    }))
  }),
  'premise-enhance': z.object({
    premise: stringField
  }),
  'assistant-intent': z.object({
    intent: z.enum(['chat', 'proposal']),
    reason: stringField
  }),
  'assistant-action-proposal': z.object({
    commandType: z.enum([
      'insert-into-chapter',
      'update-chapter-title',
      'update-chapter-summary',
      'create-outline-item',
      'append-workflow-document-entry',
      'update-workflow-document',
      'save-knowledge-document'
    ]),
    target: z.enum([
      'chapter-content',
      'chapter-title',
      'chapter-summary',
      'outline-item',
      'workflow-document',
      'knowledge-document'
    ]),
    reason: stringField,
    title: stringField,
    summary: stringField,
    before: stringField.optional(),
    after: stringField.optional(),
    destructive: z.boolean(),
    requiresConfirmation: z.boolean(),
    payload: recordField
  }),
  'global-assistant-proposal': z.object({
    summary: stringField,
    constraintCreates: z.array(z.object({
      title: stringField,
      content: stringField,
      scope: stringField,
      weight: z.enum(['core', 'important', 'supporting']).optional(),
      locked: z.boolean().optional(),
      reason: stringField,
      keywords: stringList
    })),
    worldviewCreates: z.array(worldviewEntrySchema),
    worldviewUpdates: z.array(z.object({
      matchTitle: stringField,
      reason: stringField,
      type: stringField.optional(),
      title: stringField.optional(),
      content: stringField.optional()
    })),
    characterCreates: z.array(z.object({
      name: stringField,
      role: stringField,
      description: stringField,
      tags: stringList
    })),
    characterUpdates: z.array(z.object({
      matchName: stringField,
      reason: stringField,
      name: stringField.optional(),
      role: stringField.optional(),
      description: stringField.optional(),
      tags: stringList.optional()
    })),
    organizationCreates: z.array(z.object({
      name: stringField,
      type: stringField,
      description: stringField,
      motto: stringField.optional()
    })),
    organizationUpdates: z.array(z.object({
      matchName: stringField,
      reason: stringField,
      name: stringField.optional(),
      type: stringField.optional(),
      description: stringField.optional(),
      motto: stringField.optional()
    })),
    outlineCreates: z.array(outlineItemSchema.extend({ volumeId: stringField })),
    outlineUpdates: z.array(z.object({
      matchTitle: stringField,
      reason: stringField,
      title: stringField.optional(),
      wordTarget: stringField.optional(),
      conflict: stringField.optional(),
      summary: stringField.optional(),
      volumeId: stringField.optional(),
      relatedCharacterIds: stringList.optional(),
      relatedOrganizationIds: stringList.optional(),
      relatedWorldviewIds: stringList.optional()
    })),
    notes: stringList
  }),
  'chapter-audit': z.object({
    audit: z.object({
      pass: z.boolean(),
      wordCount: z.number(),
      issues: z.array(z.object({
        severity: z.enum(['critical', 'warning', 'hint']),
        category: stringField,
        ref: stringField,
        hint: stringField
      }))
    })
  }),
  'chapter-memo': z.object({
    memo: z.object({
      currentTask: stringField,
      readerExpectation: stringField,
      payoffs: stringList,
      holds: stringList,
      transitionFunctions: stringField,
      decisionChecks: stringList,
      endingChanges: stringList,
      doNotDo: stringList,
      emotionArc: stringField
    })
  }),
  'chapter-session-note': z.object({
    sessionNote: z.object({
      craftDecisions: stringField,
      effectiveReferences: stringField,
      nextChapterAdvice: stringField
    })
  }),
  'chapter-scene-plan': z.object({
    scenes: z.array(z.object({
      focus: stringField
    }))
  }),
  'chapter-analysis': z.object({
    overview: stringField,
    pacing: stringField,
    tension: stringField,
    continuity: stringField,
    highlights: stringList,
    risks: stringList,
    revisionActions: stringList
  }),
  'worldview-entry': worldviewEntrySchema,
  'character-card': z.object({
    name: stringField,
    role: stringField,
    description: stringField,
    tags: stringList
  }),
  'outline-item': outlineItemSchema,
  'outline-batch': z.object({
    entries: z.array(outlineItemSchema)
  }),
  'outline-chain': z.object({
    entries: z.array(outlineItemSchema)
  }),
  'project-bootstrap': z.object({
    worldviewEntries: z.array(worldviewEntrySchema),
    outlineItems: z.array(outlineItemSchema)
  }),
  'inspiration-pack': z.object({
    entries: z.array(z.object({
      type: stringField,
      title: stringField,
      content: stringField,
      tags: stringList
    }))
  }),
  'plot-thread-detect': z.object({
    entries: z.array(z.object({
      title: stringField,
      description: stringField,
      tags: stringList
    }))
  }),
  'workflow-documents': z.object({
    task_plan: stringField.optional(),
    findings: stringField.optional(),
    progress: stringField.optional(),
    current_status: stringField.optional(),
    novel_setting: stringField.optional(),
    character_relationships: stringField.optional(),
    pending_hooks: stringField.optional(),
    resource_ledger: stringField.optional()
  }),
  'continuation-import-chunk': z.object({
    entries: z.array(z.object({
      chapterId: stringField,
      title: stringField,
      summary: stringField,
      characters: z.array(z.object({ name: stringField, role: stringField })),
      hooks: stringList,
      worldFacts: z.array(z.object({ type: stringField, title: stringField, content: stringField })),
      organizations: z.array(z.object({
        name: stringField,
        type: stringField,
        description: stringField,
        members: stringList
      })),
      relationships: z.array(z.object({
        fromCharacter: stringField,
        toCharacter: stringField,
        type: stringField,
        description: stringField
      }))
    }))
  }),
  'continuation-import-aggregate': z.object({
    bookSummary: stringField,
    continuationStatus: stringField,
    pendingHooks: stringList,
    characters: z.array(z.object({
      name: stringField,
      role: stringField,
      description: stringField,
      tags: stringList
    })),
    worldviewEntries: z.array(z.object({
      type: stringField,
      title: stringField,
      content: stringField
    })),
    organizations: z.array(z.object({
      name: stringField,
      type: stringField,
      description: stringField,
      motto: stringField,
      members: z.array(z.object({ name: stringField, role: stringField, notes: stringField }))
    })),
    relationships: z.array(z.object({
      fromCharacter: stringField,
      toCharacter: stringField,
      type: stringField,
      description: stringField,
      intensity: z.number()
    })),
    volumeSummaries: z.array(z.object({ title: stringField, summary: stringField }))
  }),
  'reference-style-analysis': z.object({
    overview: stringField,
    sentenceStyle: stringField,
    dialogueRatio: stringField,
    pacingControl: stringField,
    emotionExpression: stringField,
    narrativePerspective: stringField,
    styleRules: stringList,
    plotOutline: stringField,
    reusableStylePrompt: stringField,
    avoidRules: stringList
  }),
  'reference-style-chunk': z.object({
    overview: stringField,
    sentenceStyle: stringField,
    dialogueRatio: stringField,
    pacingControl: stringField,
    emotionExpression: stringField,
    plotFunction: stringField,
    hookDesign: stringField,
    informationRelease: stringField,
    characterShift: stringField,
    tensionCurve: stringField,
    styleRules: stringList
  }),
  'spiral-seed': z.object({
    protagonist: z.object({
      name: stringField,
      tags: stringList,
      coreDesire: stringField,
      coreFlaw: stringField,
      innerConflict: stringField
    }),
    mainArc: z.object({
      premise: stringField,
      centralQuestion: stringField,
      endingDirection: stringField
    }),
    worldRules: z.array(worldviewEntrySchema)
  }),
  'spiral-expand': z.object({
    supportingCharacters: z.array(z.object({
      name: stringField,
      role: stringField,
      tags: stringList,
      relationToProtagonist: stringField,
      motivation: stringField
    })),
    organizations: z.array(z.object({
      name: stringField,
      type: stringField,
      description: stringField,
      motto: stringField,
      members: z.array(z.object({
        characterName: stringField,
        role: stringField,
        notes: stringField
      }))
    })),
    relationships: z.array(z.object({
      fromCharacter: stringField,
      toCharacter: stringField,
      type: stringField,
      description: stringField,
      intensity: z.number().min(0).max(100)
    })),
    outlineBeats: z.array(z.object({
      title: stringField,
      conflict: stringField,
      characterDriven: stringField,
      summary: stringField,
      wordTarget: stringField,
      relatedCharacters: stringList,
      relatedOrganizations: stringList,
      relatedWorldview: stringList
    })),
    expandedWorldview: z.array(worldviewEntrySchema)
  }),
  'spiral-characters': z.object({
    supportingCharacters: z.array(z.object({
      name: stringField,
      role: stringField,
      tags: stringList.min(3).max(5),
      relationToProtagonist: stringField,
      motivation: stringField
    })).min(6).max(8)
  }),
  'spiral-organizations': z.object({
    organizations: z.array(z.object({
      name: stringField,
      type: stringField,
      description: stringField,
      motto: stringField,
      members: z.array(z.object({
        characterName: stringField,
        role: stringField,
        notes: stringField
      })).min(2).max(8)
    })).min(3).max(5)
  }),
  'spiral-relationships': z.object({
    relationships: z.array(z.object({
      fromCharacter: stringField,
      toCharacter: stringField,
      type: stringField,
      description: stringField,
      intensity: z.number().min(0).max(100)
    })).min(8).max(12)
  }),
  'spiral-worldview-expand': z.object({
    expandedWorldview: z.array(worldviewEntrySchema).min(4).max(6)
  }),
  'spiral-outline': z.object({
    outlineBeats: z.array(z.object({
      title: stringField,
      conflict: stringField,
      characterDriven: stringField,
      summary: stringField,
      wordTarget: stringField,
      relatedCharacters: stringList,
      relatedOrganizations: stringList,
      relatedWorldview: stringList
    }))
  }),
  'spiral-validate': z.object({
    arcValidation: z.object({
      isComplete: z.boolean(),
      gaps: stringList
    }),
    plotCausalChain: z.object({
      isSound: z.boolean(),
      breaks: stringList
    }),
    settingConsistency: z.object({
      isConsistent: z.boolean(),
      contradictions: stringList
    }),
    patches: z.object({
      characterAdjustments: z.array(z.object({
        name: stringField,
        field: stringField,
        before: stringField,
        after: stringField
      })).optional(),
      outlineAdjustments: z.array(z.object({
        title: stringField,
        field: stringField,
        before: stringField,
        after: stringField
      })).optional(),
      worldviewAdditions: z.array(worldviewEntrySchema).optional()
    })
  }),
  'character-enhance': z.object({
    name: stringField,
    role: stringField,
    description: stringField,
    tags: stringList
  }),
  'worldview-enhance': worldviewEntrySchema,
  'outline-enhance': z.object({
    title: stringField,
    wordTarget: stringField.optional(),
    conflict: stringField.optional(),
    summary: stringField
  }),
  'relation-enhance': z.object({
    name: stringField.optional(),
    type: stringField.optional(),
    description: stringField.optional(),
    motto: stringField.optional(),
    role: stringField.optional(),
    notes: stringField.optional(),
    intensity: z.number().optional()
  }),
  'catalog-batch': z.object({
    entries: z.array(z.object({
      targetIndex: z.number().optional(),
      name: stringField.optional(),
      type: stringField.optional(),
      title: stringField.optional(),
      content: stringField.optional(),
      description: stringField.optional(),
      motto: stringField.optional(),
      role: stringField.optional(),
      notes: stringField.optional(),
      organizationName: stringField.optional(),
      intensity: z.number().optional(),
      tags: z.array(z.union([stringField, z.object({ label: stringField })])).optional()
    }))
  })
}

export function getStructuredTaskSchema(name: AiTaskName): z.ZodTypeAny | undefined {
  return taskObjectSchemas[name]
}
