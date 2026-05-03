<script setup lang="ts">
import { Clock4, MoreHorizontal } from 'lucide-vue-next'
import type { DropdownOption } from 'naive-ui'
import { NDropdown } from 'naive-ui'
import { resolveNovelLengthLabel } from '@/features/wizard/projectGenres'
import type { ProjectSummary } from '@/types/app'

const props = defineProps<{
  project: ProjectSummary
  menuOptions: DropdownOption[]
  featured?: boolean
  animationDelay?: string
}>()

const emit = defineEmits<{
  (e: 'open', projectId: string): void
  (e: 'menuSelect', action: string | number, projectId: string): void
}>()
</script>

<template>
  <article
    class="homepage-project-card"
    :style="animationDelay ? { animationDelay } : undefined"
    @click="emit('open', project.id)"
  >
    <div class="card-main">
      <div class="card-copy">
        <h3>{{ project.title }}</h3>
        <p class="card-meta">{{ project.genre }} · {{ resolveNovelLengthLabel(project.novelLength) }} · {{ project.lastEdited }}</p>
      </div>

      <n-dropdown
        trigger="click"
        :options="menuOptions"
        placement="bottom-end"
        size="large"
        @select="(key) => emit('menuSelect', key, project.id)"
      >
        <button class="card-menu" @click.stop>
          <MoreHorizontal :size="18" />
        </button>
      </n-dropdown>
    </div>

    <div class="card-footer">
      <span><Clock4 :size="14" />{{ project.wordCount }}</span>
    </div>
  </article>
</template>

<style scoped>
.homepage-project-card {
  display: flex;
  min-height: 116px;
  flex-direction: column;
  justify-content: space-between;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  cursor: pointer;
  padding: 18px;
  animation: card-enter 0.2s cubic-bezier(0.16, 1, 0.3, 1) both;
  transition:
    border-color 0.18s cubic-bezier(0.16, 1, 0.3, 1),
    background 0.18s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.homepage-project-card:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 16%, var(--arc-border));
  background: var(--arc-bg-surface);
  transform: translateY(-1px);
}

.homepage-project-card:active {
  transform: scale(0.995);
}

.card-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.card-copy {
  min-width: 0;
}

.card-copy h3 {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 18px;
  font-weight: 680;
  letter-spacing: -0.02em;
}

.card-meta,
.card-footer {
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.card-meta {
  margin: 8px 0 0;
}

.card-menu {
  display: inline-flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  color: var(--arc-text-hint);
  cursor: pointer;
  transition:
    background 0.18s cubic-bezier(0.16, 1, 0.3, 1),
    color 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.card-menu:hover {
  background: color-mix(in srgb, var(--arc-primary) 5%, var(--arc-bg-mix));
  color: var(--arc-text-primary);
}

.card-footer {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
}

@keyframes card-enter {
  from {
    opacity: 0;
    transform: translateY(3px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .homepage-project-card,
  .card-menu {
    animation: none;
    transition: none;
  }
}
</style>
