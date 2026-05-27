<script setup lang="ts">
import { Clock4, MoreHorizontal } from 'lucide-vue-next'
import type { DropdownOption } from 'naive-ui'
import { NDropdown } from 'naive-ui'
import { isImageCover, resolveCoverStyle } from '@/features/cover/display'
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
        <p class="card-meta">最近编辑：{{ project.lastEdited }}</p>
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

.card-cover {
  display: flex;
  width: 62px;
  height: 86px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  flex-shrink: 0;
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.1),
    0 2px 4px -1px rgba(0, 0, 0, 0.06),
    0 10px 20px -5px rgba(15, 23, 42, 0.15);
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.card-cover-placeholder {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 600;
  user-select: none;
}

.card-cover--empty {
  border: 1px dashed var(--arc-border);
  background: var(--arc-bg-weak);
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
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.3;
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
  padding: 2px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-weak));
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.card-meta,
.card-footer {
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.card-meta {
  margin: 10px 0 0;
  opacity: 0.8;
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
