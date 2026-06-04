<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NModal, NSpin, NTimeline, NTimelineItem } from 'naive-ui'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
}>()

type AnnouncementItem = {
  title: string
  date: string
  type: 'success' | 'info' | 'warning' | 'error'
  items: string[]
}

const LOCAL_ANNOUNCEMENTS: AnnouncementItem[] = [
  {
    title: '弧光 v1.7.0 发布',
    date: '2026-06-04',
    type: 'success',
    items: [
      '【新功能】新增项目级全局 AI 助理，可跨世界观、角色、大纲、章节与工作流资料统一提问、检索和整理提案',
      '【新功能】全局助理提案支持 AI 自主选择并调用 skills，并可按需读取项目资料后生成更贴上下文的写回方案',
      '【新功能】标题栏新增 AI 调用日志入口，可查看当前项目的 AI 运行记录、模型、耗时、工具读取次数与资料命中情况',
      '【优化】全局助理改为按需检索模式，搜索结果支持返回 entity_type / entity_id，减少无效上下文灌入',
      '【优化】全局助理工具调用过程可视化，前端会分组展示搜索、读取、产出动作，让 AI 的决策路径更可观察',
      '【优化】世界观 / 人物 / 大纲提案写回后会自动跳转到对应面板，并聚焦刚写回的条目，反馈更直接',
      '【优化】提案流程与章节工具联动更加稳妥：普通提问不会误入提案流程，没有活动章节时也会优先改走项目资料检索'
    ]
  },
  {
    title: '弧光 v1.5.1 发布',
    date: '2026-05-28',
    type: 'success',
    items: [
      '【修复】检查更新始终显示"已是最新版本"，原因是 GitHub Release tag 格式解析异常',
      '【修复】公告远程拉取被 CSP 拦截，已迁移至主进程 IPC 请求',
      '【修复】公告弹窗内容过多时溢出窗口，现已限制高度并支持滚动',
      '【修复】v1.5.0 公告内容不完整，补充全部新功能与优化条目'
    ]
  },
  {
    title: '弧光 v1.5.0 发布',
    date: '2026-05-28',
    type: 'success',
    items: [
      '【新功能】AI 助手支持历史会话保存、加载、删除与继续对话',
      '【新功能】设置页改为 Tab 式多接口配置管理，支持维护多套 AI 接口并切换',
      '【新功能】标题栏新增全局模型切换器，快速切换当前启用的接口配置',
      '【新功能】知识中心支持批量导入参考小说，多选并发处理、进度展示与单本取消',
      '【新功能】首页新增公告弹窗与 GitHub Release 检查更新',
      '【新功能】设置页新增 AI 请求超时时间配置',
      '【新功能】内置 Distilled-Novel-Toolbox 技能包，skills 按来源分组整理',
      '【优化】AI 助手改为”索引摘要 + 按需检索”模式，减少无效上下文灌入',
      '【优化】章节助手支持按模块开关大纲、角色、世界观、剧情线等上下文来源',
      '【优化】设置弹窗改为左侧导航布局，分区更清晰',
      '【优化】Skills 页面改为按分组折叠展示',
      '【优化】主页、大纲、世界观、灵感等模块卡片样式与信息层次优化',
      '【修复】AI 助手历史会话保存后重启丢失的问题',
      '【修复】多套 AI 接口配置重启后只剩一个的问题',
      '【修复】修改”配置名称”后保存按钮无法点击的问题',
      '【修复】macOS 平台标题栏兼容性问题'
    ]
  },
  {
    title: '弧光 v1.0.1 发布',
    date: '2026-05-25',
    type: 'success',
    items: [
      '修复 Anthropic 中转站兼容性问题',
      '简化 AI 接口配置流程',
      '修复 macOS 标题栏兼容性'
    ]
  },
  {
    title: '弧光 v1.0.0 正式发布',
    date: '2026-05-24',
    type: 'info',
    items: [
      'AI 辅助小说创作工作台',
      '世界观 / 人物 / 大纲 / 章节全流程管理',
      '拆书知识库与风格仿写',
      '封面生成工作台'
    ]
  }
]

const currentVersion = computed(() => window.characterArc.version)
const announcements = ref<AnnouncementItem[]>(LOCAL_ANNOUNCEMENTS)
const loading = ref(false)
const isRemote = ref(false)

async function fetchRemote(): Promise<void> {
  loading.value = true
  try {
    const res = await window.characterArc.fetchAnnouncements()
    if (res.success && res.data) {
      announcements.value = res.data as AnnouncementItem[]
      isRemote.value = true
    }
  } catch {
    // 网络失败，保持本地数据
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
