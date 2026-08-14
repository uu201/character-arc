<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { NButton, NForm, NFormItem, NInput, NModal, NSelect, useMessage } from 'naive-ui'
import type { SelectOption } from 'naive-ui'
import { DEFAULT_CHAPTER_WORD_TARGET, normalizeChapterWordTarget } from '@/features/chapters/wordTarget'
import { formatVolumeLabel } from '@/features/workspace/outlineVolumes'
import { getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { useAppStore } from '@/stores/app'
import type { ChapterDraft } from '@/types/app'

const props = defineProps<{
  show: boolean
  chapter: ChapterDraft | null
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
}>()

const appStore = useAppStore()
const message = useMessage()
const isSubmitting = ref(false)

const form = reactive({
  outlineItemId: '',
  volumeId: '',
  title: '',
  summary: '',
  status: 'draft' as ChapterDraft['status'],
  wordTarget: ''
})

const statusOptions: SelectOption[] = [
  { label: '草稿中', value: 'draft' },
  { label: '待检查', value: 'review' },
  { label: '待润色', value: 'polish' },
  { label: '已定稿', value: 'final' }
]

const volumeOptions = computed<SelectOption[]>(() =>
  appStore.outlineVolumes.map((volume, index) => ({
    label: formatVolumeLabel(volume, index, 'formal'),
    value: volume.id
  }))
)

const outlineBindingOptions = computed<SelectOption[]>(() => {
  const currentChapterId = props.chapter?.id
  const targetVolumeId = form.volumeId || props.chapter?.volumeId || ''
  const items = appStore.outlineItems.filter((item) => !targetVolumeId || item.volumeId === targetVolumeId)
  return [
    { label: '不绑定大纲节点', value: '' },
    ...items.map((item) => {
      const linkedCount = appStore.chapters.filter((c) => c.outlineItemId === item.id && c.id !== currentChapterId).length
      return {
        label: linkedCount > 0 ? `${item.title} · 已关联 ${linkedCount} 章，可继续绑定` : item.title,
        value: item.id
      }
    })
  ]
})

watch(
  () => [props.show, props.chapter?.id] as const,
  ([show]) => {
    if (!show || !props.chapter) return
    form.volumeId = props.chapter.volumeId
    form.outlineItemId = props.chapter.outlineItemId
    form.title = props.chapter.title
    form.summary = props.chapter.summary
    form.status = props.chapter.status
    form.wordTarget = normalizeChapterWordTarget(props.chapter.wordTarget)
  },
  { immediate: true }
)

function handleWordTargetInput(value: string): void {
  form.wordTarget = value.replace(/\D/g, '').slice(0, 6)
}

function close(): void {
  if (isSubmitting.value) return
  emit('update:show', false)
}

function handleShowUpdate(value: boolean): void {
  if (!isSubmitting.value) emit('update:show', value)
}

async function submit(): Promise<void> {
  if (!props.chapter || isSubmitting.value) return
  if (!form.volumeId) {
    message.warning('请选择所属分卷')
    return
  }
  if (!form.title.trim()) {
    message.warning('请填写章节标题')
    return
  }
  if (!form.wordTarget.trim()) {
    form.wordTarget = DEFAULT_CHAPTER_WORD_TARGET
  }
  isSubmitting.value = true
  try {
    const chapterId = props.chapter.id
    appStore.updateChapter(chapterId, {
      outlineItemId: form.outlineItemId,
      volumeId: form.volumeId,
      title: form.title,
      summary: form.summary,
      status: form.status,
      wordTarget: normalizeChapterWordTarget(form.wordTarget)
    })

    await appStore.persistWorkspace()
    if (appStore.persistenceError) {
      message.error(`章节信息保存失败：${appStore.persistenceError}`)
      return
    }

    const shouldSyncState = form.status === 'final'
    const chapter = appStore.chapters.find((item) => item.id === chapterId)
    const chapterText = getPlainTextFromEditorContent(chapter?.content ?? '').trim()

    emit('update:show', false)
    message.success(shouldSyncState ? '章节已定稿，正文和章节信息已保存。' : '章节信息已保存。')

    if (!shouldSyncState) return
    if (chapterText.length < 50) {
      message.warning('正文内容过短，暂未生成世界状态。')
      return
    }
    void appStore.startChapterStateSync([chapterId]).catch((error) => {
      message.error(`故事状态同步启动失败：${error instanceof Error ? error.message : '未知错误'}`)
    })
  } catch (error) {
    message.error(`章节信息保存失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="编辑章节信息"
    :style="{ width: 'min(560px, 92vw)' }"
    :bordered="false"
    :closable="!isSubmitting"
    :mask-closable="!isSubmitting"
    @update:show="handleShowUpdate"
  >
    <n-form label-placement="top">
      <n-form-item label="所属分卷">
        <n-select v-model:value="form.volumeId" :options="volumeOptions" placeholder="选择这一章所在的分卷" />
      </n-form-item>
      <n-form-item label="绑定大纲节点">
        <n-select
          v-model:value="form.outlineItemId"
          :options="outlineBindingOptions"
          placeholder="可手动绑定或解绑当前章节对应的大纲节点"
        />
      </n-form-item>
      <n-form-item label="章节标题">
        <n-input v-model:value="form.title" placeholder="例如：第4章：夜城回响" />
      </n-form-item>
      <n-form-item label="章节摘要">
        <n-input
          v-model:value="form.summary"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 5 }"
          placeholder="用 1 到 2 句话概括这一章的核心事件和推进点..."
        />
      </n-form-item>
      <n-form-item label="章节状态">
        <n-select v-model:value="form.status" :options="statusOptions" />
      </n-form-item>
      <n-form-item label="预估字数">
        <n-input
          :value="form.wordTarget"
          inputmode="numeric"
          placeholder="例如：3000"
          @update:value="handleWordTargetInput"
        />
      </n-form-item>
    </n-form>

    <template #footer>
      <div class="actions">
        <n-button round strong :disabled="isSubmitting" @click="close">取消</n-button>
        <n-button type="primary" round strong :loading="isSubmitting" @click="submit">保存修改</n-button>
      </div>
    </template>
  </n-modal>

</template>

<style scoped>
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

</style>
