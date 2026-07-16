<script setup lang="ts">
import { Clock4, MoreHorizontal } from 'lucide-vue-next'
import type { DropdownOption } from 'naive-ui'
import { NDropdown } from 'naive-ui'
import { isImageCover, resolveCoverStyle } from '@/features/cover/display'
import { formatProjectEditedAt } from '@/features/projects/lastEdited'
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
      <div v-if="isImageCover(project.cover)" class="card-cover" :style="resolveCoverStyle(project.cover)"></div>
      <div v-else class="card-cover card-cover--empty">
        <span class="card-cover-placeholder">暂无封面</span>
      </div>
      <div class="card-copy">
        <h3>{{ project.title }}</h3>
        <div class="card-tags">
          <span class="card-tag">{{ project.genre }}</span>
          <span class="card-tag">{{ resolveNovelLengthLabel(project.novelLength) }}</span>
        </div>
        <p class="card-meta">最近编辑：{{ formatProjectEditedAt(project.lastEdited) }}</p>
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
  padding: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.03);
  animation: card-enter 0.32s cubic-bezier(0.16, 1, 0.3, 1) both;
  transition:
    border-color 0.24s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.24s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.24s cubic-bezier(0.16, 1, 0.3, 1);
}

.homepage-project-card:hover {
  border-color: var(--arc-border-strong);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.06), 0 12px 28px rgba(0, 0, 0, 0.06);
  transform: translateY(-2px);
}

.homepage-project-card:active {
  transform: translateY(-1px) scale(0.995);
}

.card-main {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.card-cover {
  display: flex;
  width: 68px;
  height: 96px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  flex-shrink: 0;
  box-shadow:
    0 2px 4px rgba(0, 0, 0, 0.08),
    0 6px 14px rgba(0, 0, 0, 0.1);
  transition: transform 0.32s cubic-bezier(0.16, 1, 0.3, 1);
}

.card-cover-placeholder {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 600;
  user-select: none;
}

.card-cover--empty {
  border: 1.5px dashed var(--arc-border-strong);
  background: var(--arc-bg-weak);
  box-shadow: none;
}

.homepage-project-card:hover .card-cover {
  transform: scale(1.04) rotate(-1deg);
}

.card-copy {
  min-width: 0;
  flex: 1;
}

.card-copy h3 {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 16.5px;
  font-weight: 680;
  letter-spacing: -0.015em;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.2s;
}

.homepage-project-card:hover .card-copy h3 {
  color: var(--arc-primary);
}

.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.card-tag {
  display: inline-flex;
  align-items: center;
  padding: 2.5px 9px;
  border-radius: 999px;
  background: var(--arc-bg-surface-hover);
  color: var(--arc-text-secondary);
  font-size: 11px;
  font-weight: 680;
  letter-spacing: 0.01em;
}

.card-meta {
  margin: 8px 0 0;
  color: var(--arc-text-hint);
  font-size: 12.5px;
  line-height: 1.5;
}

.card-menu {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--arc-bg-surface) 92%, transparent);
  color: var(--arc-text-hint);
  cursor: pointer;
  opacity: 0;
  transform: translateY(-2px);
  transition:
    opacity 0.2s,
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    background 0.15s,
    color 0.15s;
}

.homepage-project-card:hover .card-menu {
  opacity: 1;
  transform: translateY(0);
}

.card-menu:hover {
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  border-color: var(--arc-border-strong);
}

.card-footer {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--arc-bg-surface-hover);
  color: var(--arc-text-hint);
  font-size: 12px;
  font-weight: 520;
  font-variant-numeric: tabular-nums;
}

@keyframes card-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
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
