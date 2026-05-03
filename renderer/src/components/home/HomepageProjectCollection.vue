<script setup lang="ts">
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
    <div v-if="!projects.length" class="arc-empty-state homepage-empty-state">
      <strong>还没有作品</strong>
      <p>先创建一个项目，然后从这里继续写作。</p>
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
  min-height: 180px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 0;
  border-style: solid;
  border-radius: 10px;
  background: var(--arc-bg-surface);
}

.homepage-empty-state strong {
  color: var(--arc-text-primary);
  font-size: 17px;
}

.homepage-empty-state p {
  margin: 0;
  color: var(--arc-text-secondary);
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
