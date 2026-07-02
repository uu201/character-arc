<script setup lang="ts">
import { computed, ref } from 'vue'
import { BookOpen, ChevronDown, Edit3, Loader2, Search, List, CheckCircle2, XCircle } from 'lucide-vue-next'
import type { ChapterAiToolCall } from './useChapterAi'

const props = defineProps<{
  toolCall: ChapterAiToolCall
}>()

const expanded = ref(false)

const toolLabel = computed(() => {
  const args = props.toolCall.args

  switch (props.toolCall.toolName) {
    case 'read_chapter': {
      // 尝试从 args 中获取章节信息（如果有的话）
      const chapterId = args.chapter_id || args.chapterId
      // 这里无法直接访问章节标题，先显示基本信息
      return chapterId ? `读取章节` : '读取当前章节'
    }
    case 'edit_chapter':
      return '生成章节修改提案'
    case 'search_project':
      return '搜索项目'
    case 'skill_list':
      return '查看技能清单'
    case 'list_chapters':
      return '章节列表'
    case 'read_project_data': {
      const entityType = args.entity_type || args.entityType
      const typeLabels: Record<string, string> = {
        'characters': '读取角色设定',
        'worldview': '读取世界观',
        'organizations': '读取组织设定',
        'organization_memberships': '读取成员归属',
        'relationships': '读取角色关系',
        'outline': '读取章节大纲',
        'chapters': '读取章节',
        'plotThreads': '读取剧情线索',
        'plot_threads': '读取剧情线索',
        'knowledge': '读取项目知识库',
        'available_deconstructions': '读取公共拆书库',
        'deconstructionLibrary': '读取拆书知识库',
        'deconstruction_library': '读取拆书知识库',
        'reference_works': '读取参考书',
        'workflow_documents': '读取创作记忆',
        'project_constraints': '读取项目约束',
        'style': '读取写作风格'
      }
      return typeLabels[String(entityType)] || '读取项目数据'
    }
    case 'skill_load':
      return args.skill_id ? `加载技能：${args.skill_id}` : '加载写作技能'
    case 'skill_read_reference':
      return args.file_path ? `读取技能文件` : '读取技能参考'
    case 'skill_glob':
      return '浏览技能文件'
    case 'skill_run_script':
      return '执行技能脚本'
    case 'save_knowledge_document':
      return '保存知识文档'
    default:
      return props.toolCall.toolName
  }
})

const toolIcon = computed(() => {
  switch (props.toolCall.toolName) {
    case 'read_chapter': return BookOpen
    case 'edit_chapter': return Edit3
    case 'search_project': return Search
    case 'list_chapters': return List
    default: return Search
  }
})
</script>

<template>
  <div class="tool-card" :class="[toolCall.status, { expanded }]">
    <div class="tool-header" @click="expanded = !expanded">
      <component :is="toolIcon" :size="12" />
      <span class="tool-label">{{ toolLabel }}</span>
      <Loader2 v-if="toolCall.status === 'running'" :size="12" class="spinner" />
      <CheckCircle2 v-else-if="toolCall.status === 'done'" :size="12" class="icon-done" />
      <XCircle v-else-if="toolCall.status === 'error'" :size="12" class="icon-error" />
      <span v-if="toolCall.durationMs" class="tool-duration">{{ (toolCall.durationMs / 1000).toFixed(2) }}s</span>
      <ChevronDown v-if="toolCall.result && toolCall.status !== 'running'" :size="12" class="tool-chevron" />
    </div>
    <div v-if="expanded && toolCall.result && toolCall.status !== 'running'" class="tool-result">
      {{ toolCall.result }}
    </div>
  </div>
</template>

<style scoped>
.tool-card {
  padding: 0;
  border-radius: var(--arc-radius-md, 8px);
  background: var(--arc-bg-weak);
  border: 1px solid var(--arc-border);
  font-size: 12px;
  margin: 4px 0;
  overflow: hidden;
}

.tool-card.error {
  border-color: color-mix(in srgb, #dc2626 30%, var(--arc-border));
  background: color-mix(in srgb, #dc2626 8%, var(--arc-bg-surface));
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  color: var(--arc-text-secondary);
  cursor: pointer;
  user-select: none;
}

.tool-header:hover {
  background: var(--arc-bg-surface-hover);
}

.tool-label {
  font-weight: 500;
  color: var(--arc-text-primary);
}

.spinner {
  animation: spin 1s linear infinite;
  color: var(--arc-primary);
}

.icon-done { color: var(--arc-success, #16a34a); }
.icon-error { color: var(--arc-error, #dc2626); }

.tool-duration {
  margin-left: auto;
  font-size: 10px;
  color: var(--arc-text-hint);
  font-variant-numeric: tabular-nums;
}

.tool-chevron {
  color: var(--arc-text-hint);
  transition: transform 0.2s;
}

.tool-card.expanded .tool-chevron {
  transform: rotate(180deg);
}

.tool-result {
  padding: 8px 12px;
  border-top: 1px solid var(--arc-border);
  color: var(--arc-text-secondary);
  font-size: 11px;
  line-height: 1.5;
  max-height: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  background: var(--arc-bg-surface);
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
