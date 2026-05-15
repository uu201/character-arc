<script setup lang="ts">
import { NEmpty } from 'naive-ui'
import type { DropdownOption } from 'naive-ui'
import type { ProjectSummary } from '@/types/app'
import HomepageProjectCard from './HomepageProjectCard.vue'

defineProps<{
  projects: ProjectSummary[]
  menuOptions: DropdownOption[]
}>()

const emit = defineEmits<{
  (e: 'open', projectId: string): void
  (e: 'menuSelect', action: string | number, projectId: string): void
}>()
</script>

<template>
  <section class="project-collection">
    <div v-if="!projects.length" class="homepage-empty-state">
      <n-empty description="还没有作品">
        <template #extra>
          <p class="empty-hint">先创建一个项目，然后从这里继续写作。</p>
        </template>
      </n-empty>
    </div>

    <div v-else class="project-grid">
      <HomepageProjectCard
        v-for="(project, index) in projects"
        :key="project.id"
        :project="project"
        :menu-options="menuOptions"
        :animation-delay="`${index * 35}ms`"
        @open="emit('open', $event)"
        @menu-select="(action, projectId) => emit('menuSelect', action, projectId)"
      />
    </div>
  </section>
</template>

<style scoped>
.project-collection {
  min-width: 0;
}

.homepage-empty-state {
  display: flex;
  min-height: 280px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--arc-border);
  border-radius: 12px;
  background: var(--arc-bg-surface);
  margin: 10px 0;
}

.empty-hint {
  color: var(--arc-text-secondary);
  font-size: 13px;
  margin: 0;
}

.project-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

@media (max-width: 820px) {
  .project-grid {
    grid-template-columns: 1fr;
  }
}
</style>
