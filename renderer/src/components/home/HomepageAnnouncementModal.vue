<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NModal, NSpin, NTimeline, NTimelineItem } from 'naive-ui'
import {
  LOCAL_ANNOUNCEMENTS as SHARED_LOCAL_ANNOUNCEMENTS,
  normalizeAnnouncements,
  resolveLatestAnnouncementDate,
  type AnnouncementItem
} from '@/features/announcements/announcements'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'loaded', latestDate: string): void
}>()

const currentVersion = computed(() => window.characterArc.version)
const announcements = ref<AnnouncementItem[]>(SHARED_LOCAL_ANNOUNCEMENTS)
const loading = ref(false)
const isRemote = ref(false)
const fetchError = ref(false)

async function fetchRemote(): Promise<void> {
  loading.value = true
  fetchError.value = false
  try {
    const res = await window.characterArc.fetchAnnouncements()
    const nextAnnouncements = res.success ? normalizeAnnouncements(res.data) : []
    if (nextAnnouncements.length) {
      announcements.value = nextAnnouncements
      isRemote.value = true
      emit('loaded', resolveLatestAnnouncementDate(nextAnnouncements))
    } else {
      fetchError.value = true
    }
  } catch {
    fetchError.value = true
  } finally {
    loading.value = false
  }
}

function handleAfterEnter(): void {
  if (!isRemote.value) {
    fetchRemote()
  }
}
</script>

<template>
  <n-modal
    :show="props.show"
    preset="card"
    class="arc-editor-modal"
    title="公告"
    :bordered="false"
    @close="emit('update:show', false)"
    @after-enter="handleAfterEnter"
  >
    <div class="announcement-body">
      <div class="announcement-version">
        当前版本：v{{ currentVersion }}
        <n-spin v-if="loading" :size="14" class="announcement-spin" />
      </div>

      <div v-if="fetchError" class="announcement-error">
        公告拉取失败，当前显示本地公告。
      </div>

      <n-timeline>
        <n-timeline-item
          v-for="(item, index) in announcements"
          :key="index"
          :type="item.type"
          :title="item.title"
          :time="item.date"
        >
          <ul class="announcement-list">
            <li v-for="(line, i) in item.items" :key="i">{{ line }}</li>
          </ul>
        </n-timeline-item>
      </n-timeline>
    </div>

    <template #footer>
      <div class="arc-modal-actions">
        <n-button round strong @click="emit('update:show', false)">关闭</n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.announcement-body {
  min-height: 100px;
  max-height: 60vh;
  overflow-y: auto;
}

.announcement-version {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 18px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
  font-size: 13px;
  font-weight: 600;
}

.announcement-spin {
  margin-left: auto;
}

.announcement-error {
  margin: -6px 0 14px;
  padding: 9px 12px;
  border: 1px solid color-mix(in srgb, var(--arc-danger, #ef4444) 28%, var(--arc-border, #e5e7eb));
  border-radius: 8px;
  background: color-mix(in srgb, var(--arc-danger, #ef4444) 8%, var(--arc-bg-surface, #ffffff));
  color: var(--arc-danger, #ef4444);
  font-size: 13px;
  font-weight: 650;
}

.announcement-list {
  margin: 4px 0 0;
  padding-left: 18px;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.8;
}

.announcement-list li {
  margin-bottom: 2px;
}
</style>
