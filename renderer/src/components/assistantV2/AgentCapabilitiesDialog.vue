<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import {
  BrainCircuit,
  CheckCircle2,
  Network,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Users,
  X
} from 'lucide-vue-next'
import type {
  AgentMemory,
  AgentMemoryKind,
  ControlledMcpServer,
  ControlledMcpTool
} from '@shared/assistant-runtime'

const props = defineProps<{
  visible: boolean
  projectId: string
}>()

const emit = defineEmits<{
  close: []
}>()

const message = useMessage()
type CapabilityTab = 'memory' | 'mcp' | 'delegate'
const activeTab = ref<CapabilityTab>('memory')

const memories = ref<AgentMemory[]>([])
const memoryLoading = ref(false)
const memorySaving = ref(false)
const memoryKind = ref<AgentMemoryKind>('preference')
const memoryContent = ref('')

const servers = ref<ControlledMcpServer[]>([])
const mcpLoading = ref(false)
const testingServerId = ref('')
const showServerForm = ref(false)
const serverSaving = ref(false)
const formServerId = ref('')
const formName = ref('')
const formUrl = ref('')
const formApiKey = ref('')

const memoryKindOptions = [
  { label: '创作偏好', value: 'preference' },
  { label: '纠正教训', value: 'lesson' },
  { label: '项目事实', value: 'fact' },
  { label: '有效方法', value: 'method' }
]
const importanceOptions = [1, 2, 3, 4, 5].map((value) => ({ label: `重要度 ${value}`, value }))
const memoryKindLabel: Record<AgentMemoryKind, string> = {
  preference: '偏好',
  lesson: '教训',
  fact: '事实',
  method: '方法'
}

const enabledToolCount = computed(() =>
  servers.value.reduce((total, server) => total + (server.enabled ? server.allowedTools.length : 0), 0)
)

async function loadMemories(): Promise<void> {
  if (!props.projectId) return
  memoryLoading.value = true
  try {
    memories.value = await window.characterArc.assistant.memoryList({ projectId: props.projectId, limit: 100 })
  } catch (error) {
    message.error(error instanceof Error ? error.message : '加载长期记忆失败')
  } finally {
    memoryLoading.value = false
  }
}

async function createMemory(): Promise<void> {
  const content = memoryContent.value.trim()
  if (!content) {
    message.warning('请填写需要长期记住的内容')
    return
  }
  memorySaving.value = true
  try {
    await window.characterArc.assistant.memoryCreate({
      projectId: props.projectId,
      kind: memoryKind.value,
      content,
      importance: 3
    })
    memoryContent.value = ''
    await loadMemories()
    message.success('已保存到当前项目的长期记忆')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存长期记忆失败')
  } finally {
    memorySaving.value = false
  }
}

async function removeMemory(memory: AgentMemory): Promise<void> {
  if (!window.confirm(`确定删除这条${memoryKindLabel[memory.kind]}记忆吗？`)) return
  try {
    await window.characterArc.assistant.memoryDelete({ id: memory.id, projectId: props.projectId })
    memories.value = memories.value.filter((item) => item.id !== memory.id)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '删除长期记忆失败')
  }
}

async function setMemoryImportance(memory: AgentMemory, value: number): Promise<void> {
  try {
    const updated = await window.characterArc.assistant.memorySetImportance({
      id: memory.id,
      projectId: props.projectId,
      importance: value
    })
    if (updated) memories.value = memories.value.map((item) => item.id === updated.id ? updated : item)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '调整记忆重要度失败')
  }
}

async function loadServers(): Promise<void> {
  if (!props.projectId) return
  mcpLoading.value = true
  try {
    servers.value = await window.characterArc.assistant.mcpServerList({ projectId: props.projectId })
  } catch (error) {
    message.error(error instanceof Error ? error.message : '加载 MCP 连接失败')
  } finally {
    mcpLoading.value = false
  }
}

function openNewServer(): void {
  formServerId.value = ''
  formName.value = ''
  formUrl.value = ''
  formApiKey.value = ''
  showServerForm.value = true
}

function openEditServer(server: ControlledMcpServer): void {
  formServerId.value = server.id
  formName.value = server.name
  formUrl.value = server.url
  formApiKey.value = ''
  showServerForm.value = true
}

async function saveServer(): Promise<void> {
  if (!formName.value.trim() || !formUrl.value.trim()) {
    message.warning('请填写服务器名称和 URL')
    return
  }
  serverSaving.value = true
  try {
    const payload: {
      id?: string
      projectId: string
      name: string
      url: string
      apiKey?: string
    } = {
      projectId: props.projectId,
      name: formName.value.trim(),
      url: formUrl.value.trim()
    }
    if (formServerId.value) payload.id = formServerId.value
    if (formApiKey.value.trim()) payload.apiKey = formApiKey.value.trim()
    await window.characterArc.assistant.mcpServerSave(payload)
    showServerForm.value = false
    await loadServers()
    message.success('MCP 连接已保存；测试并选择工具后才能启用')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存 MCP 连接失败')
  } finally {
    serverSaving.value = false
  }
}

async function testServer(server: ControlledMcpServer): Promise<void> {
  testingServerId.value = server.id
  try {
    const result = await window.characterArc.assistant.mcpServerTest({
      id: server.id,
      projectId: props.projectId
    })
    result.ok ? message.success(result.message) : message.error(result.message)
    await loadServers()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '测试 MCP 连接失败')
  } finally {
    testingServerId.value = ''
  }
}

async function setToolAllowed(server: ControlledMcpServer, tool: ControlledMcpTool, checked: boolean): Promise<void> {
  const next = checked
    ? Array.from(new Set([...server.allowedTools, tool.name]))
    : server.allowedTools.filter((name) => name !== tool.name)
  try {
    await window.characterArc.assistant.mcpServerSetAllowedTools({
      id: server.id,
      projectId: props.projectId,
      tools: next
    })
    await loadServers()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '更新 MCP 工具白名单失败')
  }
}

async function setServerEnabled(server: ControlledMcpServer, enabled: boolean): Promise<void> {
  try {
    await window.characterArc.assistant.mcpServerSetEnabled({
      id: server.id,
      projectId: props.projectId,
      enabled
    })
    await loadServers()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '切换 MCP 连接失败')
  }
}

async function removeServer(server: ControlledMcpServer): Promise<void> {
  if (!window.confirm(`确定删除 MCP 连接“${server.name}”吗？`)) return
  try {
    await window.characterArc.assistant.mcpServerDelete({ id: server.id, projectId: props.projectId })
    await loadServers()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '删除 MCP 连接失败')
  }
}

watch(() => props.visible, (visible) => {
  if (!visible) return
  void Promise.all([loadMemories(), loadServers()])
})
</script>

<template>
  <n-modal
    :show="visible"
    :mask-closable="true"
    :close-on-esc="true"
    @update:show="(show: boolean) => { if (!show) emit('close') }"
  >
    <n-card class="capability-dialog" :bordered="false" role="dialog" aria-modal="true">
      <template #header>
        <div class="dialog-heading">
          <span class="heading-icon"><BrainCircuit :size="18" /></span>
          <div><strong>智能体能力</strong><span>当前项目专用 · 受控权限</span></div>
        </div>
      </template>
      <template #header-extra>
        <button type="button" class="icon-button" title="关闭" aria-label="关闭" @click="emit('close')"><X :size="17" /></button>
      </template>

      <nav class="capability-tabs" aria-label="智能体能力分类">
        <button type="button" :class="{ active: activeTab === 'memory' }" @click="activeTab = 'memory'">
          <Sparkles :size="15" />长期记忆 <span>{{ memories.length }}</span>
        </button>
        <button type="button" :class="{ active: activeTab === 'mcp' }" @click="activeTab = 'mcp'">
          <Network :size="15" />MCP 工具 <span>{{ enabledToolCount }}</span>
        </button>
        <button type="button" :class="{ active: activeTab === 'delegate' }" @click="activeTab = 'delegate'">
          <Users :size="15" />子智能体
        </button>
      </nav>

      <section v-if="activeTab === 'memory'" class="capability-pane">
        <div class="pane-intro">
          <div><strong>项目级长期记忆</strong><p>后续对话会自动召回。模型只有在你明确说“记住”时才能自行添加，你随时可以调整或删除。</p></div>
        </div>
        <div class="memory-form">
          <n-select v-model:value="memoryKind" :options="memoryKindOptions" style="width: 132px" />
          <n-input v-model:value="memoryContent" maxlength="1200" placeholder="例如：主角处理危机时保持克制，不用网络热梗。" @keyup.enter="createMemory" />
          <n-button type="primary" :loading="memorySaving" @click="createMemory"><template #icon><Plus :size="14" /></template>添加</n-button>
        </div>
        <div v-if="memoryLoading" class="empty-state">正在加载长期记忆…</div>
        <div v-else-if="!memories.length" class="empty-state">还没有长期记忆。</div>
        <div v-else class="memory-list">
          <article v-for="memory in memories" :key="memory.id" class="memory-card">
            <div class="memory-copy"><span :class="['memory-kind', memory.kind]">{{ memoryKindLabel[memory.kind] }}</span><p>{{ memory.content }}</p></div>
            <div class="memory-actions">
              <n-select :value="memory.importance" :options="importanceOptions" size="small" style="width: 112px" @update:value="(value: number) => setMemoryImportance(memory, value)" />
              <button type="button" class="icon-button danger" title="删除记忆" aria-label="删除记忆" @click="removeMemory(memory)"><Trash2 :size="15" /></button>
            </div>
          </article>
        </div>
      </section>

      <section v-else-if="activeTab === 'mcp'" class="capability-pane">
        <div class="pane-intro pane-intro--actions">
          <div><strong>白名单 HTTP MCP</strong><p>只支持 HTTPS 或本机 HTTP。服务器保存后默认禁用，必须测试连接并逐个选择工具。</p></div>
          <n-button type="primary" ghost @click="openNewServer"><template #icon><Plus :size="14" /></template>添加连接</n-button>
        </div>

        <div v-if="showServerForm" class="server-form">
          <n-input v-model:value="formName" placeholder="服务器名称" />
          <n-input v-model:value="formUrl" placeholder="https://example.com/mcp 或 http://127.0.0.1:3000/mcp" />
          <n-input v-model:value="formApiKey" type="password" show-password-on="click" :placeholder="formServerId ? 'API Key（留空则保留原值）' : 'API Key（可选）'" />
          <div class="server-form-actions"><n-button @click="showServerForm = false">取消</n-button><n-button type="primary" :loading="serverSaving" @click="saveServer">保存</n-button></div>
        </div>

        <div v-if="mcpLoading" class="empty-state">正在加载 MCP 连接…</div>
        <div v-else-if="!servers.length" class="empty-state">尚未配置 MCP。可以接入你信任的榜单、知识库或检索服务。</div>
        <div v-else class="server-list">
          <article v-for="server in servers" :key="server.id" class="server-card">
            <header>
              <div class="server-title"><Network :size="16" /><div><strong>{{ server.name }}</strong><span>{{ server.url }}</span></div></div>
              <div class="server-actions">
                <n-switch :value="server.enabled" :disabled="!server.allowedTools.length" @update:value="(value: boolean) => setServerEnabled(server, value)" />
                <button type="button" class="icon-button" title="编辑连接" aria-label="编辑连接" @click="openEditServer(server)"><RefreshCw :size="14" /></button>
                <button type="button" class="icon-button danger" title="删除连接" aria-label="删除连接" @click="removeServer(server)"><Trash2 :size="14" /></button>
              </div>
            </header>
            <div class="server-status">
              <span v-if="server.lastConnectedAt" class="status-ok"><CheckCircle2 :size="13" />已验证</span>
              <span v-if="server.lastError" class="status-error">{{ server.lastError }}</span>
              <n-button size="small" :loading="testingServerId === server.id" @click="testServer(server)">测试并发现工具</n-button>
            </div>
            <div v-if="server.discoveredTools.length" class="tool-list">
              <label v-for="tool in server.discoveredTools" :key="tool.name" class="tool-row">
                <n-checkbox :checked="server.allowedTools.includes(tool.name)" @update:checked="(checked: boolean) => setToolAllowed(server, tool, checked)" />
                <span><strong>{{ tool.name }}</strong><em>{{ tool.description || '无工具说明' }}</em></span>
              </label>
            </div>
          </article>
        </div>
      </section>

      <section v-else class="capability-pane">
        <div class="pane-intro"><div><strong>只读小说子智能体</strong><p>主智能体在处理可拆分的大任务时，可把最多 3 个独立部分并行分析，再统一核对汇总。</p></div></div>
        <div class="delegate-grid">
          <article><span>01</span><strong>没有项目权限</strong><p>不能调用工具、修改数据或形成长期记忆。</p></article>
          <article><span>02</span><strong>只读指定材料</strong><p>只能看到主智能体已经读取并明确提供的片段。</p></article>
          <article><span>03</span><strong>限制并发与成本</strong><p>最多 3 个任务、同时运行 2 个，简单任务不会委派。</p></article>
        </div>
        <div class="delegate-example"><strong>适合：</strong>并行核对三个人物设定、分别分析多个章节、从多个榜单维度提炼信号。<br /><strong>不适合：</strong>单段润色、简单问答、任何直接写库操作。</div>
      </section>
    </n-card>
  </n-modal>
</template>

<style scoped>
.capability-dialog { width: min(920px, calc(100vw - 36px)); max-height: min(760px, calc(100vh - 36px)); }
.capability-dialog :deep(.n-card__content) { display: flex; flex-direction: column; min-height: 520px; overflow: hidden; padding-top: 0; }
.dialog-heading { display: flex; align-items: center; gap: 10px; }
.heading-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; color: var(--arc-primary); background: color-mix(in srgb, var(--arc-primary) 12%, transparent); }
.dialog-heading > div { display: flex; flex-direction: column; gap: 2px; }
.dialog-heading strong { color: var(--arc-text-primary); font-size: 16px; }
.dialog-heading span { color: var(--arc-text-hint); font-size: 11px; }
.icon-button { display: inline-grid; place-items: center; width: 34px; height: 34px; border: 0; border-radius: 8px; background: transparent; color: var(--arc-text-secondary); cursor: pointer; transition: background-color .18s ease, color .18s ease; }
.icon-button:hover { background: var(--arc-bg-surface-hover); color: var(--arc-text-primary); }
.icon-button.danger:hover { color: var(--arc-danger); }
.icon-button:focus-visible, .capability-tabs button:focus-visible, .tool-row:focus-within { outline: 2px solid var(--arc-primary); outline-offset: 2px; }
.capability-tabs { display: flex; gap: 6px; padding: 12px 0; border-bottom: 1px solid var(--arc-border); }
.capability-tabs button { display: inline-flex; align-items: center; gap: 7px; min-height: 38px; padding: 0 14px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: var(--arc-text-secondary); cursor: pointer; transition: background-color .18s ease, border-color .18s ease, color .18s ease; }
.capability-tabs button:hover { background: var(--arc-bg-surface-hover); }
.capability-tabs button.active { color: var(--arc-primary); border-color: color-mix(in srgb, var(--arc-primary) 28%, var(--arc-border)); background: color-mix(in srgb, var(--arc-primary) 9%, transparent); }
.capability-tabs button span { min-width: 18px; padding: 1px 5px; border-radius: 999px; background: var(--arc-bg-weak); font-size: 10px; }
.capability-pane { flex: 1; min-height: 0; padding: 18px 2px 4px; overflow-y: auto; }
.pane-intro { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 16px; }
.pane-intro--actions { align-items: center; }
.pane-intro strong { color: var(--arc-text-primary); font-size: 15px; }
.pane-intro p { margin: 5px 0 0; color: var(--arc-text-secondary); font-size: 12px; line-height: 1.6; }
.memory-form { display: grid; grid-template-columns: 132px minmax(0, 1fr) auto; gap: 8px; margin-bottom: 14px; }
.empty-state { padding: 48px 16px; border: 1px dashed var(--arc-border); border-radius: 10px; color: var(--arc-text-hint); text-align: center; }
.memory-list, .server-list { display: flex; flex-direction: column; gap: 9px; }
.memory-card { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 13px 14px; border: 1px solid var(--arc-border); border-radius: 10px; background: var(--arc-bg-surface); }
.memory-copy { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
.memory-copy p { margin: 0; color: var(--arc-text-primary); font-size: 13px; line-height: 1.6; }
.memory-kind { flex: 0 0 auto; margin-top: 2px; padding: 2px 7px; border-radius: 999px; color: var(--arc-primary); background: color-mix(in srgb, var(--arc-primary) 10%, transparent); font-size: 10px; }
.memory-kind.lesson { color: #d97706; background: rgba(217, 119, 6, .1); }
.memory-kind.fact { color: #0284c7; background: rgba(2, 132, 199, .1); }
.memory-kind.method { color: #7c3aed; background: rgba(124, 58, 237, .1); }
.memory-actions, .server-actions, .server-status, .server-form-actions { display: flex; align-items: center; gap: 7px; }
.server-form { display: grid; gap: 9px; margin-bottom: 14px; padding: 14px; border: 1px solid var(--arc-border); border-radius: 10px; background: var(--arc-bg-weak); }
.server-form-actions { justify-content: flex-end; }
.server-card { padding: 14px; border: 1px solid var(--arc-border); border-radius: 10px; background: var(--arc-bg-surface); }
.server-card > header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.server-title { display: flex; align-items: center; gap: 9px; min-width: 0; color: var(--arc-primary); }
.server-title > div { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.server-title strong { color: var(--arc-text-primary); }
.server-title span { overflow: hidden; color: var(--arc-text-hint); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.server-status { justify-content: space-between; margin-top: 10px; }
.status-ok { display: inline-flex; align-items: center; gap: 4px; color: #059669; font-size: 11px; }
.status-error { max-width: 560px; color: var(--arc-danger); font-size: 11px; }
.tool-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--arc-border); }
.tool-row { display: flex; align-items: flex-start; gap: 8px; padding: 8px; border-radius: 8px; background: var(--arc-bg-weak); cursor: pointer; }
.tool-row > span { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.tool-row strong { color: var(--arc-text-primary); font-size: 12px; overflow-wrap: anywhere; }
.tool-row em { color: var(--arc-text-hint); font-size: 10px; font-style: normal; line-height: 1.45; }
.delegate-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.delegate-grid article { min-height: 150px; padding: 18px; border: 1px solid var(--arc-border); border-radius: 12px; background: var(--arc-bg-surface); }
.delegate-grid article > span { display: block; margin-bottom: 18px; color: var(--arc-primary); font-size: 22px; font-weight: 800; opacity: .55; }
.delegate-grid strong { color: var(--arc-text-primary); }
.delegate-grid p { margin: 8px 0 0; color: var(--arc-text-secondary); font-size: 12px; line-height: 1.65; }
.delegate-example { margin-top: 14px; padding: 14px 16px; border-radius: 10px; background: var(--arc-bg-weak); color: var(--arc-text-secondary); font-size: 12px; line-height: 1.8; }
.delegate-example strong { color: var(--arc-text-primary); }
@media (max-width: 760px) {
  .memory-form { grid-template-columns: 1fr; }
  .tool-list, .delegate-grid { grid-template-columns: 1fr; }
  .memory-card, .server-card > header, .pane-intro--actions { align-items: flex-start; flex-direction: column; }
  .memory-actions, .server-actions { width: 100%; justify-content: flex-end; }
}
</style>
