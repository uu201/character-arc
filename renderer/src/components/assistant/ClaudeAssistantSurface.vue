<script setup lang="ts">
import { ref } from 'vue'
import AssistantTopBar from './AssistantTopBar.vue'
import AssistantInlineContextSections from './AssistantInlineContextSections.vue'
import AssistantProposalCard from './AssistantProposalCard.vue'
import AssistantConversationPane from './AssistantConversationPane.vue'
import AssistantComposer from './AssistantComposer.vue'
import { useAssistantSession } from '@/features/assistant/useAssistantSession'

const messagesViewport = ref<HTMLElement | null>(null)

const session = useAssistantSession(messagesViewport)
</script>

<template>
  <section class="claude-assistant-surface">
    <AssistantTopBar
      :project-title="session.currentProject.value?.title ?? '未命名项目'"
      :chapter-title="session.currentChapter.value?.title ?? '未命名章节'"
    />

    <AssistantProposalCard
      v-if="session.activeAgentProposal.value"
      :proposal="session.activeAgentProposal.value"
      :confirmation-state="session.agentConfirmationState.value"
      :execution-step="session.agentExecutionStep.value"
      @approve="session.handleApproveProposal"
      @reject="session.handleRejectProposal"
      @clear="session.handleClearProposal"
    />

    <AssistantInlineContextSections
      v-if="session.latestAiRun.value"
      :quick-actions="session.quickActions.value"
      :selected-excerpt="session.selectedExcerpt.value"
      :recent-ai-runs="session.recentAiRunsDisplay.value"
      :latest-ai-run="session.latestAiRun.value"
      :latest-ai-run-knowledge="session.latestAiRunKnowledge.value"
      :latest-ai-run-status-text="session.latestAiRunStatusText.value"
      :is-responding="session.isResponding.value"
      @quick-action="session.handleQuickAction"
    />

    <div ref="messagesViewport" class="claude-assistant-surface__body">
      <AssistantConversationPane
        :messages="session.appStore.messages"
        :is-responding="session.isResponding.value"
        :streaming-reply="session.streamingReply.value"
        :render-markdown="session.renderMarkdown"
        @insert="(content) => session.handleInsert(content, 'cursor')"
        @more-action="session.handleMoreAction"
      />
    </div>

    <AssistantComposer
      v-model:draft="session.draft.value"
      v-model:response-mode="session.responseMode.value"
      v-model:response-length="session.responseLength.value"
      :is-responding="session.isResponding.value"
      :is-stopping="session.isStopping.value"
      :can-regenerate="Boolean(session.lastUserPrompt.value)"
      :has-selection="session.hasSelection.value"
      :selected-excerpt="session.selectedExcerpt.value"
      :quick-actions="session.quickActions.value"
      :recent-ai-runs="session.recentAiRunsDisplay.value"
      :latest-ai-run="session.latestAiRun.value"
      :latest-ai-run-knowledge="session.latestAiRunKnowledge.value"
      :latest-ai-run-status-text="session.latestAiRunStatusText.value"
      @keydown="session.handleComposerKeydown"
      @regenerate="session.handleRegenerate"
      @quick-action="session.handleQuickAction"
      @submit="session.sendPrompt"
      @stop="session.handleStopResponse"
    />
  </section>
</template>
