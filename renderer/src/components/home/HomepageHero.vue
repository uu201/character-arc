<script setup lang="ts">
import { Plus, Settings2 } from 'lucide-vue-next'

const emit = defineEmits<{
  (e: 'create'): void
  (e: 'openSettings'): void
}>()
</script>

<template>
  <header class="homepage-hero arc-drag-region">
    <div class="hero-copy">
      <h1>我的作品</h1>
      <p>选择一个项目继续写作，或开始新的作品。</p>
    </div>

    <div class="hero-actions arc-no-drag">
      <button class="secondary-action" @click="emit('openSettings')">
        <Settings2 :size="18" />
        <span>设置</span>
      </button>
      <button class="primary-action" @click="emit('create')">
        <Plus :size="18" />
        <span>新建作品</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.homepage-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
  padding-bottom: 10px;
}

.hero-copy {
  min-width: 0;
}

.hero-copy h1 {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: clamp(28px, 3vw, 36px);
  font-weight: 720;
  letter-spacing: -0.04em;
}

.hero-copy p {
  margin: 8px 0 0;
  color: var(--arc-text-secondary);
  font-size: 14px;
  line-height: 1.65;
}

.hero-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.primary-action,
.secondary-action {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 14px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 650;
  padding: 0 16px;
  transition:
    transform 0.18s cubic-bezier(0.16, 1, 0.3, 1),
    background 0.18s cubic-bezier(0.16, 1, 0.3, 1),
    border-color 0.18s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.primary-action {
  border: none;
  background: var(--arc-primary);
  color: white;
}

.primary-action:hover {
  background: var(--arc-primary-hover);
  box-shadow: 0 10px 20px color-mix(in srgb, var(--arc-primary) 16%, transparent);
}

.secondary-action {
  border: 1px solid var(--arc-border);
  background: color-mix(in srgb, var(--arc-bg-surface) 90%, white);
  color: var(--arc-text-primary);
}

.secondary-action:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 14%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 3%, white);
}

.primary-action:active,
.secondary-action:active {
  transform: scale(0.98);
}

@media (max-width: 720px) {
  .homepage-hero {
    align-items: stretch;
    flex-direction: column;
  }

  .hero-actions {
    width: 100%;
  }

  .hero-actions button {
    flex: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .primary-action,
  .secondary-action {
    transition: none;
  }
}
</style>
