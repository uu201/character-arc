/**
 * 内置 ContextProvider 集合。
 * 在 Runtime 启动期一次性注册到 contextBuilder。
 */

import type { ContextBuilder } from '../context-builder'
import type { ConversationManager } from '../conversation-manager'
import type { SnapshotAccessor } from './shared'

import { makeProjectBriefProvider } from './project-brief'
import { makeCurrentChapterProvider } from './current-chapter'
import { makeWorldviewProvider } from './worldview'
import { makeCharactersProvider } from './characters'
import { makeRecentMessagesProvider } from './recent-messages'
import {
  makeConstraintsProvider,
  makeInspirationProvider,
  makeKnowledgeProvider,
  makeOrganizationsProvider,
  makeOutlineProvider,
  makePlotThreadsProvider,
  makeSkillIndexProvider,
  makeWorkflowDocumentsProvider
} from './project-data'

export interface RegisterBuiltinProvidersDeps {
  contextBuilder: ContextBuilder
  snapshot: SnapshotAccessor
  getConversation: () => Promise<ConversationManager>
}

export function registerBuiltinProviders(deps: RegisterBuiltinProvidersDeps): void {
  const { contextBuilder, snapshot, getConversation } = deps
  contextBuilder.register(makeProjectBriefProvider(snapshot))
  contextBuilder.register(makeCurrentChapterProvider(snapshot))
  contextBuilder.register(makeRecentMessagesProvider(getConversation))
  contextBuilder.register(makeWorldviewProvider(snapshot))
  contextBuilder.register(makeCharactersProvider(snapshot))
  contextBuilder.register(makeOrganizationsProvider(snapshot))
  contextBuilder.register(makeOutlineProvider(snapshot))
  contextBuilder.register(makePlotThreadsProvider(snapshot))
  contextBuilder.register(makeConstraintsProvider(snapshot))
  contextBuilder.register(makeInspirationProvider(snapshot))
  contextBuilder.register(makeKnowledgeProvider(snapshot))
  contextBuilder.register(makeWorkflowDocumentsProvider(snapshot))
  contextBuilder.register(makeSkillIndexProvider(snapshot))
}

export type { SnapshotAccessor } from './shared'
