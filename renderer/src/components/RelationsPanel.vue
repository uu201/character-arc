<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  Building2,
  Link2,
  Network,
  PencilLine,
  Plus,
  Rows3,
  Search,
  Shield,
  Sparkles,
  Trash2,
  UserRoundCog,
  Users
} from 'lucide-vue-next'
import { NButton, NDynamicTags, NForm, NFormItem, NInput, NModal, NSelect, NSlider, useDialog, useMessage } from 'naive-ui'
import RelationsGraphView from '@/components/RelationsGraphView.vue'
import { buildRelationsGraphData } from '@/features/relations/graph'
import { buildProjectWritingStyleContext } from '@/features/writingStyles/presets'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { CharacterCard, CharacterRelationship, OrganizationEntry, OrganizationMembership } from '@/types/app'
import AiEnhancePreview from './AiEnhancePreview.vue'
import BatchGenerateDialog from './BatchGenerateDialog.vue'
import type { EnhanceFieldDiff } from './AiEnhancePreview.vue'
import { useCatalogBatch } from '@/composables/useCatalogBatch'

const props = defineProps<{
  searchQuery?: string // 全局搜索关键词
}>()

const appStore = useAppStore()
const message = useMessage()
const dialog = useDialog()
const keyword = ref('') // 本面板内的本地搜索关键词
const viewMode = ref<'list' | 'graph'>('list')
const { generateCatalogBatch } = useCatalogBatch()

function buildAiWorldviewContext() {
  return appStore.worldviewEntries.slice(0, 12).map((entry) => ({
    type: entry.type,
    title: entry.title,
    content: entry.content.slice(0, 320)
  }))
}

// --- 角色编辑器状态 ---
const characterEditorVisible = ref(false)
const editingCharacterId = ref<string | null>(null)
const characterForm = reactive({
  name: '',
  role: '',
  description: '',
  tags: [] as string[]
})

// --- 组织编辑器状态 ---
const organizationEditorVisible = ref(false) // 控制组织编辑弹窗的显示
const editingOrganizationId = ref<string | null>(null) // 当前编辑的组织 ID，null 为新建
const organizationForm = reactive({ // 组织编辑表单
  name: '',
  type: '',
  description: '',
  motto: '',
  color: ''
})

// --- 关系编辑器状态 ---
const relationshipEditorVisible = ref(false) // 控制关系编辑弹窗的显示
const editingRelationshipId = ref<string | null>(null) // 当前编辑的关系 ID
const relationshipForm = reactive({ // 关系编辑表单，包含双方角色、类型、描述和张力强度
  fromCharacterId: '',
  toCharacterId: '',
  type: '',
  description: '',
  intensity: 50 // 关系强度，0-100，值越高冲突或羁绊越强
})

// --- 归属编辑器状态 ---
const membershipEditorVisible = ref(false) // 控制归属编辑弹窗的显示
const editingMembershipId = ref<string | null>(null) // 当前编辑的归属 ID
const membershipForm = reactive({ // 成员归属表单：将角色绑定到组织并指定身份
  characterId: '',
  organizationId: '',
  role: '',
  notes: ''
})

// 合并全局搜索和本地搜索关键词
const mergedQuery = computed(() => [props.searchQuery, keyword.value].filter(Boolean).join(' ').trim().toLowerCase())
// 角色选项列表，用于下拉选择器
const characterOptions = computed(() =>
  appStore.characters.map((character) => ({
    label: character.name,
    value: character.id
  }))
)
// 组织选项列表，用于下拉选择器
const organizationOptions = computed(() =>
  appStore.organizations.map((organization) => ({
    label: organization.name,
    value: organization.id
  }))
)
// 角色 ID 到角色对象的映射表，用于快速查找角色名
const characterMap = computed(() => new Map(appStore.characters.map((character) => [character.id, character])))
// 组织 ID 到组织对象的映射表
const organizationMap = computed(() => new Map(appStore.organizations.map((organization) => [organization.id, organization])))
const relationsGraph = computed(() =>
  buildRelationsGraphData({
    characters: appStore.characters,
    organizations: appStore.organizations,
    characterRelationships: appStore.characterRelationships,
    organizationMemberships: appStore.organizationMemberships
  })
)

// 顶部统计卡片数据：组织数量、关系数量、归属数量
const stats = computed(() => [
  {
    key: 'organizations',
    label: '组织势力',
    value: `${appStore.organizations.length}`,
    hint: '可沉淀阵营、机构、帮派',
    icon: Building2
  },
  {
    key: 'relationships',
    label: '人物关系',
    value: `${appStore.characterRelationships.length}`,
    hint: '可服务冲突与情感线编排',
    icon: Link2
  },
  {
    key: 'memberships',
    label: '成员归属',
    value: `${appStore.organizationMemberships.length}`,
    hint: '角色与组织的责任绑定',
    icon: UserRoundCog
  }
])

// 根据搜索关键词过滤组织列表
const filteredOrganizations = computed(() => {
  const query = mergedQuery.value
  if (!query) {
    return appStore.organizations
  }

  return appStore.organizations.filter((organization) =>
    `${organization.name} ${organization.type} ${organization.description} ${organization.motto}`.toLowerCase().includes(query)
  )
})

// 根据搜索关键词过滤关系列表，并附加上双方角色名称以便展示和搜索
const filteredRelationships = computed(() => {
  const query = mergedQuery.value
  const decorated = appStore.characterRelationships.map((relationship) => {
    const fromCharacter = characterMap.value.get(relationship.fromCharacterId)
    const toCharacter = characterMap.value.get(relationship.toCharacterId)

    return {
      ...relationship,
      fromCharacterName: fromCharacter?.name ?? '未绑定角色',
      toCharacterName: toCharacter?.name ?? '未绑定角色'
    }
  })

  if (!query) {
    return decorated
  }

  return decorated.filter((relationship) =>
    `${relationship.type} ${relationship.description} ${relationship.fromCharacterName} ${relationship.toCharacterName}`
      .toLowerCase()
      .includes(query)
  )
})

// 根据搜索关键词过滤归属列表，并附加上角色名和组织名以便展示和搜索
const filteredMemberships = computed(() => {
  const query = mergedQuery.value
  const decorated = appStore.organizationMemberships.map((membership) => {
    const character = characterMap.value.get(membership.characterId)
    const organization = organizationMap.value.get(membership.organizationId)

    return {
      ...membership,
      characterName: character?.name ?? '未绑定角色',
      organizationName: organization?.name ?? '未绑定组织'
    }
  })

  if (!query) {
    return decorated
  }

  return decorated.filter((membership) =>
    `${membership.role} ${membership.notes} ${membership.characterName} ${membership.organizationName}`
      .toLowerCase()
      .includes(query)
  )
})

// 打开组织编辑弹窗，传入组织数据时为编辑模式
function openOrganizationEditor(organization?: OrganizationEntry): void {
  editingOrganizationId.value = organization?.id ?? null
  organizationForm.name = organization?.name ?? ''
  organizationForm.type = organization?.type ?? ''
  organizationForm.description = organization?.description ?? ''
  organizationForm.motto = organization?.motto ?? ''
  organizationForm.color = organization?.color ?? ''
  organizationEditorVisible.value = true
}

function openCharacterEditor(character?: CharacterCard): void {
  editingCharacterId.value = character?.id ?? null
  characterForm.name = character?.name ?? ''
  characterForm.role = character?.role ?? ''
  characterForm.description = character?.description ?? ''
  characterForm.tags = character?.tags.map((tag) => tag.label) ?? []
  characterEditorVisible.value = true
}

function submitCharacter(): void {
  if (!characterForm.name.trim() || !characterForm.description.trim()) {
    message.warning('请完整填写角色名称和角色简介')
    return
  }

  if (editingCharacterId.value) {
    appStore.updateCharacter(editingCharacterId.value, {
      name: characterForm.name,
      role: characterForm.role,
      description: characterForm.description,
      tags: characterForm.tags.map((label) => ({ label }))
    })
    message.success('角色信息已更新')
  } else {
    appStore.createCharacter({
      name: characterForm.name,
      role: characterForm.role,
      description: characterForm.description,
      tags: characterForm.tags.map((label) => ({ label }))
    })
    message.success('已新增角色')
  }

  characterEditorVisible.value = false
}

// 提交组织表单：校验必填项后调用 store 保存
function submitOrganization(): void {
  if (!organizationForm.name.trim() || !organizationForm.description.trim()) {
    message.warning('请先填写组织名称和组织说明')
    return
  }

  if (editingOrganizationId.value) {
    appStore.updateOrganization(editingOrganizationId.value, { ...organizationForm })
    message.success('组织信息已更新')
  } else {
    appStore.createOrganization({ ...organizationForm })
    message.success('已新增组织')
  }

  organizationEditorVisible.value = false
}

// 删除组织前弹出二次确认对话框，同时清理该组织下的成员归属
function confirmDeleteOrganization(organization: OrganizationEntry): void {
  dialog.warning({
    title: '确认删除组织',
    content: `确定要删除“${organization.name}”吗？该组织下的成员归属也会一起清理。`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.deleteOrganization(organization.id)
      message.success('组织已删除')
    }
  })
}

// 打开关系编辑弹窗，默认选中第一个和第二个角色作为关系双方
function openRelationshipEditor(relationship?: CharacterRelationship): void {
  editingRelationshipId.value = relationship?.id ?? null
  relationshipForm.fromCharacterId = relationship?.fromCharacterId ?? appStore.characters[0]?.id ?? ''
  relationshipForm.toCharacterId =
    relationship?.toCharacterId ??
    appStore.characters.find((character) => character.id !== relationshipForm.fromCharacterId)?.id ??
    appStore.characters[0]?.id ??
    ''
  relationshipForm.type = relationship?.type ?? ''
  relationshipForm.description = relationship?.description ?? ''
  relationshipForm.intensity = relationship?.intensity ?? 50
  relationshipEditorVisible.value = true
}

// 提交关系表单：校验双方角色不同且必填项已填写
function submitRelationship(): void {
  if (!relationshipForm.fromCharacterId || !relationshipForm.toCharacterId) {
    message.warning('请先为关系选择双方角色')
    return
  }

  if (relationshipForm.fromCharacterId === relationshipForm.toCharacterId) {
    message.warning('关系双方不能是同一角色')
    return
  }

  if (!relationshipForm.type.trim() || !relationshipForm.description.trim()) {
    message.warning('请补充关系类型和关系描述')
    return
  }

  if (editingRelationshipId.value) {
    appStore.updateCharacterRelationship(editingRelationshipId.value, { ...relationshipForm })
    message.success('角色关系已更新')
  } else {
    appStore.createCharacterRelationship({ ...relationshipForm })
    message.success('已新增角色关系')
  }

  relationshipEditorVisible.value = false
}

// 删除关系前弹出二次确认对话框
function confirmDeleteRelationship(relationship: { id: string; fromCharacterName: string; toCharacterName: string }): void {
  dialog.warning({
    title: '确认删除关系',
    content: `确定要删除“${relationship.fromCharacterName} - ${relationship.toCharacterName}”这条关系吗？`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.deleteCharacterRelationship(relationship.id)
      message.success('角色关系已删除')
    }
  })
}

// 打开归属编辑弹窗，将角色和组织默认选为列表第一项
function openMembershipEditor(membership?: OrganizationMembership): void {
  editingMembershipId.value = membership?.id ?? null
  membershipForm.characterId = membership?.characterId ?? appStore.characters[0]?.id ?? ''
  membershipForm.organizationId = membership?.organizationId ?? appStore.organizations[0]?.id ?? ''
  membershipForm.role = membership?.role ?? ''
  membershipForm.notes = membership?.notes ?? ''
  membershipEditorVisible.value = true
}

// 提交归属表单：校验角色、组织和身份已填写
function submitMembership(): void {
  if (!membershipForm.characterId || !membershipForm.organizationId) {
    message.warning('请先选择角色和组织')
    return
  }

  if (!membershipForm.role.trim()) {
    message.warning('请填写组织身份')
    return
  }

  if (editingMembershipId.value) {
    appStore.updateOrganizationMembership(editingMembershipId.value, { ...membershipForm })
    message.success('归属关系已更新')
  } else {
    appStore.createOrganizationMembership({ ...membershipForm })
    message.success('已新增成员归属')
  }

  membershipEditorVisible.value = false
}

// 删除归属前弹出二次确认对话框
function confirmDeleteMembership(membership: { id: string; characterName: string; organizationName: string }): void {
  dialog.warning({
    title: '确认删除归属',
    content: `确定要移除“${membership.characterName} - ${membership.organizationName}”这条归属吗？`,
    positiveText: '确认删除',
    negativeText: '取消',
    autoFocus: false,
    closable: false,
    onPositiveClick: () => {
      appStore.deleteOrganizationMembership(membership.id)
      message.success('成员归属已删除')
    }
  })
}

function setViewMode(mode: 'list' | 'graph'): void {
  viewMode.value = mode
}

function revealNodeInList(label: string): void {
  viewMode.value = 'list'
  keyword.value = label
}

function openGraphNodeEditor(payload: { kind: 'character' | 'organization'; entityId: string }): void {
  if (payload.kind === 'character') {
    const character = appStore.characters.find((item) => item.id === payload.entityId)
    if (character) {
      openCharacterEditor(character)
    }
    return
  }

  const organization = appStore.organizations.find((item) => item.id === payload.entityId)
  if (organization) {
    openOrganizationEditor(organization)
  }
}

const writingStyle = computed(() => buildProjectWritingStyleContext(appStore.currentProject))

/** 组织头像颜色池 */
const ORG_PALETTE = [
  '#4f46e5', '#7c3aed', '#c026d3', '#db2777', '#e11d48',
  '#dc2626', '#ea580c', '#b45309', '#0d9488', '#0891b2',
  '#2563eb', '#475569', '#6d28d9', '#be185d', '#0369a1',
]

function orgNameHash(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return Math.abs(h)
}

function orgBadgeColor(org: { name: string; color?: string }): string {
  return org.color?.trim() || ORG_PALETTE[orgNameHash(org.name) % ORG_PALETTE.length]
}

/** 浅色底 + 原色文字，保证对比度 */
function orgBadgeBgLight(bg: string): string {
  const hex = bg.replace('#', '')
  if (hex.length < 6) return 'rgba(241,245,249,0.95)'
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return `rgba(${r},${g},${b},0.12)`
}

function orgInitial(name: string): string {
  const ch = name.trim()[0]
  return ch ? ch.toUpperCase() : '?'
}

const AI_GEN_ORG_KEY = 'catalog-batch:organization'
const AI_GEN_REL_KEY = 'catalog-batch:relationship'
const AI_GEN_MEM_KEY = 'catalog-batch:membership'
const isGeneratingOrg = computed(() => appStore.isAiTaskRunning(AI_GEN_ORG_KEY))
const isGeneratingRel = computed(() => appStore.isAiTaskRunning(AI_GEN_REL_KEY))
const isGeneratingMem = computed(() => appStore.isAiTaskRunning(AI_GEN_MEM_KEY))
const organizationBatchVisible = ref(false)
const organizationBatchProgress = ref(0)
const relationshipBatchVisible = ref(false)
const relationshipBatchProgress = ref(0)
const relationshipBatchForm = reactive({
  mainCharacterId: '',
  targetCharacterIds: [] as string[],
  direction: 'main-to-others' as 'main-to-others' | 'others-to-main',
  prompt: ''
})
const directionOptions = [
  { label: '主角色 → 多个角色', value: 'main-to-others' },
  { label: '多个角色 → 主角色', value: 'others-to-main' }
]
const relationshipTargetOptions = computed(() =>
  characterOptions.value.filter((option) => option.value !== relationshipBatchForm.mainCharacterId)
)

async function handleGenerateOrganization(payload: { count: number; prompt: string; types: string[] }): Promise<void> {
  if (isGeneratingOrg.value) return

  try {
    organizationBatchProgress.value = 0
    const entries = await generateCatalogBatch({
      mode: 'organization',
      count: payload.count,
      label: '批量生成组织',
      panel: 'relations',
      kind: 'character',
      keyField: 'name',
      existingKeys: appStore.organizations.map((organization) => organization.name),
      onProgress: (completed, total) => { organizationBatchProgress.value = Math.round(completed / total * 100) },
      context: {
        projectTitle: appStore.currentProject?.title,
        projectGenre: appStore.currentProject?.genre,
        userPrompt: payload.prompt,
        worldviewEntries: buildAiWorldviewContext(),
        writingStyleLabel: writingStyle.value.label,
        writingStylePrompt: writingStyle.value.prompt,
        organizations: appStore.organizations,
        characterRelationships: appStore.characterRelationships,
        organizationMemberships: appStore.organizationMemberships,
        characters: appStore.characters.map((c) => ({ id: c.id, name: c.name, role: c.role, description: c.description }))
      }
    })
    entries.forEach((s) => appStore.createOrganization({
      name: String(s.name ?? '新组织'),
      type: String(s.type ?? '中立势力'),
      description: String(s.description ?? ''),
      motto: String(s.motto ?? ''),
      color: ''
    }))
    organizationBatchVisible.value = false
    message.success(`已生成 ${entries.length} 个组织`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 生成组织失败，请检查模型配置')
  }
}

function openRelationshipBatch(): void {
  const mainId = relationshipBatchForm.mainCharacterId || appStore.characters[0]?.id || ''
  relationshipBatchForm.mainCharacterId = mainId
  relationshipBatchForm.targetCharacterIds = appStore.characters.filter((character) => character.id !== mainId).map((character) => character.id)
  relationshipBatchForm.prompt = ''
  relationshipBatchProgress.value = 0
  relationshipBatchVisible.value = true
}

async function handleGenerateRelationship(): Promise<void> {
  if (isGeneratingRel.value || relationshipBatchForm.targetCharacterIds.length === 0) return

  const main = characterMap.value.get(relationshipBatchForm.mainCharacterId)
  if (!main) return
  const targets = relationshipBatchForm.targetCharacterIds
    .filter((id) => id !== relationshipBatchForm.mainCharacterId)
    .map((id, targetIndex) => ({ targetIndex, character: characterMap.value.get(id) }))
    .filter((item): item is { targetIndex: number; character: CharacterCard } => Boolean(item.character))

  try {
    relationshipBatchProgress.value = 0
    const entries = await generateCatalogBatch({
      mode: 'relationship',
      count: targets.length,
      label: '批量生成关系',
      panel: 'relations',
      kind: 'character',
      onProgress: (completed, total) => { relationshipBatchProgress.value = Math.round(completed / total * 100) },
      context: {
        projectTitle: appStore.currentProject?.title,
        projectGenre: appStore.currentProject?.genre,
        userPrompt: relationshipBatchForm.prompt,
        relationshipDirection: relationshipBatchForm.direction,
        mainCharacter: main,
        targets: targets.map(({ targetIndex, character }) => ({ targetIndex, character })),
        worldviewEntries: buildAiWorldviewContext(),
        writingStyleLabel: writingStyle.value.label,
        writingStylePrompt: writingStyle.value.prompt,
        organizations: appStore.organizations,
        characterRelationships: appStore.characterRelationships,
        organizationMemberships: appStore.organizationMemberships,
        characters: appStore.characters
      }
    })

    const existingPairs = new Set(appStore.characterRelationships.map((relationship) => `${relationship.fromCharacterId}:${relationship.toCharacterId}`))
    let created = 0
    entries.forEach((s, index) => {
      const target = targets.find((item) => item.targetIndex === Number(s.targetIndex ?? index))?.character
      if (!target) return
      const fromCharacterId = relationshipBatchForm.direction === 'main-to-others' ? main.id : target.id
      const toCharacterId = relationshipBatchForm.direction === 'main-to-others' ? target.id : main.id
      if (existingPairs.has(`${fromCharacterId}:${toCharacterId}`)) return
      appStore.createCharacterRelationship({
        fromCharacterId,
        toCharacterId,
        type: String(s.type ?? '待设定'),
        description: String(s.description ?? ''),
        intensity: Math.max(0, Math.min(100, Number(s.intensity) || 50))
      })
      created += 1
    })
    relationshipBatchVisible.value = false
    message.success(`已生成 ${created} 条角色关系`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 生成关系失败，请检查模型配置')
  }
}

async function handleGenerateMembership(): Promise<void> {
  if (isGeneratingMem.value || appStore.characters.length === 0 || appStore.organizations.length === 0) return
  const assignedIds = new Set(appStore.organizationMemberships.map((membership) => membership.characterId))
  const targets = appStore.characters
    .filter((character) => !assignedIds.has(character.id))
    .map((character, targetIndex) => ({ targetIndex, character }))
  if (targets.length === 0) {
    message.info('所有角色都已经有组织归属')
    return
  }

  try {
    const entries = await generateCatalogBatch({
      mode: 'membership',
      count: targets.length,
      label: '自动补全角色归属',
      panel: 'relations',
      kind: 'character',
      context: {
        projectTitle: appStore.currentProject?.title,
        projectGenre: appStore.currentProject?.genre,
        targets,
        worldviewEntries: buildAiWorldviewContext(),
        writingStyleLabel: writingStyle.value.label,
        writingStylePrompt: writingStyle.value.prompt,
        organizations: appStore.organizations,
        organizationMemberships: appStore.organizationMemberships,
        characters: appStore.characters
      }
    })
    entries.forEach((s, index) => {
      const target = targets.find((item) => item.targetIndex === Number(s.targetIndex ?? index))
      if (!target) return
      const organizationName = String(s.organizationName ?? '').trim().toLowerCase()
      const organization = appStore.organizations.find((item) => item.name.trim().toLowerCase() === organizationName)
        ?? appStore.organizations[target.targetIndex % appStore.organizations.length]
      appStore.createOrganizationMembership({
        characterId: target.character.id,
        organizationId: organization.id,
        role: String(s.role ?? '成员'),
        notes: String(s.notes ?? '')
      })
    })
    message.success(`已为 ${entries.length} 个未归属角色补全组织归属`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 生成归属失败，请检查模型配置')
  }
}

const ENHANCE_ORG_KEY = 'relation-enhance-org'
const ENHANCE_REL_KEY = 'relation-enhance-rel'
const ENHANCE_MEM_KEY = 'relation-enhance-mem'
const enhanceOrgLoading = computed(() => appStore.isAiTaskRunning(ENHANCE_ORG_KEY))
const enhanceRelLoading = computed(() => appStore.isAiTaskRunning(ENHANCE_REL_KEY))
const enhanceMemLoading = computed(() => appStore.isAiTaskRunning(ENHANCE_MEM_KEY))
const enhanceOrgVisible = ref(false)
const enhanceRelVisible = ref(false)
const enhanceMemVisible = ref(false)
const enhanceOrgFields = ref<EnhanceFieldDiff[]>([])
const enhanceRelFields = ref<EnhanceFieldDiff[]>([])
const enhanceMemFields = ref<EnhanceFieldDiff[]>([])

async function handleAiEnhanceOrg(): Promise<void> {
  if (enhanceOrgLoading.value) return

  try {
    const result = await appStore.runTrackedAiTask(
      { key: ENHANCE_ORG_KEY, kind: 'character', label: 'AI 补充组织', description: '正在根据上下文补充组织信息', panel: 'relations' },
      () =>
        window.characterArc.generateAi(toIpcPayload({
          task: 'relation-enhance',
          settings: appStore.appSettings,
          context: {
            mode: 'organization',
            currentForm: { name: organizationForm.name, type: organizationForm.type, description: organizationForm.description, motto: organizationForm.motto },
            projectTitle: appStore.currentProject?.title,
            projectGenre: appStore.currentProject?.genre,
            worldviewEntries: buildAiWorldviewContext(),
            writingStyleLabel: writingStyle.value.label,
            writingStylePrompt: writingStyle.value.prompt,
            characterNames: appStore.characters.map((c) => c.name),
            worldviewTitles: appStore.worldviewEntries.map((e) => e.title),
            organizations: appStore.organizations,
            characterRelationships: appStore.characterRelationships,
            organizationMemberships: appStore.organizationMemberships,
            characters: appStore.characters.map((c) => ({ id: c.id, name: c.name, role: c.role, description: c.description }))
          }
        }))
    )

    if (!result.success || !result.result) throw new Error(result.error ?? 'AI 补充失败')
    const s = result.result as Record<string, unknown>

    enhanceOrgFields.value = [
      { key: 'name', label: '组织名称', type: 'text', original: organizationForm.name, suggested: String(s.name ?? ''), changed: String(s.name ?? '') !== organizationForm.name && Boolean(String(s.name ?? '').trim()) },
      { key: 'type', label: '组织类型', type: 'text', original: organizationForm.type, suggested: String(s.type ?? ''), changed: String(s.type ?? '') !== organizationForm.type && Boolean(String(s.type ?? '').trim()) },
      { key: 'description', label: '组织说明', type: 'textarea', original: organizationForm.description, suggested: String(s.description ?? ''), changed: String(s.description ?? '') !== organizationForm.description && Boolean(String(s.description ?? '').trim()) },
      { key: 'motto', label: '口号/精神标识', type: 'text', original: organizationForm.motto, suggested: String(s.motto ?? ''), changed: String(s.motto ?? '') !== organizationForm.motto && Boolean(String(s.motto ?? '').trim()) }
    ]
    enhanceOrgVisible.value = true
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 补充失败，请检查模型配置')
  }
}

function handleEnhanceOrgApply(accepted: Record<string, string | string[]>): void {
  if (accepted.name != null) organizationForm.name = accepted.name as string
  if (accepted.type != null) organizationForm.type = accepted.type as string
  if (accepted.description != null) organizationForm.description = accepted.description as string
  if (accepted.motto != null) organizationForm.motto = accepted.motto as string
  enhanceOrgVisible.value = false
}

async function handleAiEnhanceRel(): Promise<void> {
  if (enhanceRelLoading.value) return

  const fromChar = characterMap.value.get(relationshipForm.fromCharacterId)
  const toChar = characterMap.value.get(relationshipForm.toCharacterId)

  try {
    const result = await appStore.runTrackedAiTask(
      { key: ENHANCE_REL_KEY, kind: 'character', label: 'AI 补充关系', description: '正在根据上下文补充角色关系', panel: 'relations' },
      () =>
        window.characterArc.generateAi(toIpcPayload({
          task: 'relation-enhance',
          settings: appStore.appSettings,
          context: {
            mode: 'relationship',
            currentForm: { type: relationshipForm.type, description: relationshipForm.description, intensity: relationshipForm.intensity },
            fromCharacterName: fromChar?.name ?? '',
            fromCharacterDescription: fromChar?.description ?? '',
            toCharacterName: toChar?.name ?? '',
            toCharacterDescription: toChar?.description ?? '',
            projectTitle: appStore.currentProject?.title,
            projectGenre: appStore.currentProject?.genre,
            worldviewEntries: buildAiWorldviewContext(),
            writingStyleLabel: writingStyle.value.label,
            writingStylePrompt: writingStyle.value.prompt,
            organizations: appStore.organizations,
            characterRelationships: appStore.characterRelationships,
            organizationMemberships: appStore.organizationMemberships,
            characters: appStore.characters.map((c) => ({ id: c.id, name: c.name, role: c.role, description: c.description }))
          }
        }))
    )

    if (!result.success || !result.result) throw new Error(result.error ?? 'AI 补充失败')
    const s = result.result as Record<string, unknown>
    const suggestedIntensity = String(s.intensity != null ? Math.round(Number(s.intensity)) : relationshipForm.intensity)

    enhanceRelFields.value = [
      { key: 'type', label: '关系类型', type: 'text', original: relationshipForm.type, suggested: String(s.type ?? ''), changed: String(s.type ?? '') !== relationshipForm.type && Boolean(String(s.type ?? '').trim()) },
      { key: 'description', label: '关系描述', type: 'textarea', original: relationshipForm.description, suggested: String(s.description ?? ''), changed: String(s.description ?? '') !== relationshipForm.description && Boolean(String(s.description ?? '').trim()) },
      { key: 'intensity', label: '关系强度', type: 'text', original: String(relationshipForm.intensity), suggested: suggestedIntensity, changed: suggestedIntensity !== String(relationshipForm.intensity) }
    ]
    enhanceRelVisible.value = true
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 补充失败，请检查模型配置')
  }
}

function handleEnhanceRelApply(accepted: Record<string, string | string[]>): void {
  if (accepted.type != null) relationshipForm.type = accepted.type as string
  if (accepted.description != null) relationshipForm.description = accepted.description as string
  if (accepted.intensity != null) relationshipForm.intensity = Math.max(0, Math.min(100, Number(accepted.intensity) || 50))
  enhanceRelVisible.value = false
}

async function handleAiEnhanceMem(): Promise<void> {
  if (enhanceMemLoading.value) return

  const char = characterMap.value.get(membershipForm.characterId)
  const org = organizationMap.value.get(membershipForm.organizationId)

  try {
    const result = await appStore.runTrackedAiTask(
      { key: ENHANCE_MEM_KEY, kind: 'character', label: 'AI 补充归属', description: '正在根据上下文补充成员归属信息', panel: 'relations' },
      () =>
        window.characterArc.generateAi(toIpcPayload({
          task: 'relation-enhance',
          settings: appStore.appSettings,
          context: {
            mode: 'membership',
            currentForm: { role: membershipForm.role, notes: membershipForm.notes },
            characterName: char?.name ?? '',
            characterDescription: char?.description ?? '',
            organizationName: org?.name ?? '',
            organizationDescription: org?.description ?? '',
            projectTitle: appStore.currentProject?.title,
            projectGenre: appStore.currentProject?.genre,
            worldviewEntries: buildAiWorldviewContext(),
            writingStyleLabel: writingStyle.value.label,
            writingStylePrompt: writingStyle.value.prompt,
            organizations: appStore.organizations,
            organizationMemberships: appStore.organizationMemberships,
            characters: appStore.characters.map((c) => ({ id: c.id, name: c.name, role: c.role, description: c.description }))
          }
        }))
    )

    if (!result.success || !result.result) throw new Error(result.error ?? 'AI 补充失败')
    const s = result.result as Record<string, unknown>

    enhanceMemFields.value = [
      { key: 'role', label: '组织身份', type: 'text', original: membershipForm.role, suggested: String(s.role ?? ''), changed: String(s.role ?? '') !== membershipForm.role && Boolean(String(s.role ?? '').trim()) },
      { key: 'notes', label: '归属备注', type: 'textarea', original: membershipForm.notes, suggested: String(s.notes ?? ''), changed: String(s.notes ?? '') !== membershipForm.notes && Boolean(String(s.notes ?? '').trim()) }
    ]
    enhanceMemVisible.value = true
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 补充失败，请检查模型配置')
  }
}

function handleEnhanceMemApply(accepted: Record<string, string | string[]>): void {
  if (accepted.role != null) membershipForm.role = accepted.role as string
  if (accepted.notes != null) membershipForm.notes = accepted.notes as string
  enhanceMemVisible.value = false
}
</script>

<template>
  <section class="relations-panel">
    <div class="section-head">
      <div>
        <div class="section-badge">
          <Network :size="15" />
          <span>关系组织工作台</span>
        </div>
        <h2>关系与组织模块</h2>
        <p>把角色关系、阵营势力和成员归属收拢到一个地方维护，后续可直接扩展成关系图谱。</p>
      </div>
      <div class="head-tools">
        <div class="search-input">
          <Search :size="16" />
          <input v-model="keyword" type="text" placeholder="搜索组织、关系或成员归属..." />
        </div>
        <div class="view-switch" role="tablist" aria-label="关系视图切换">
          <button class="view-switch-button" :class="{ active: viewMode === 'list' }" @click="setViewMode('list')">
            <Rows3 :size="15" />
            <span>列表视图</span>
          </button>
          <button class="view-switch-button" :class="{ active: viewMode === 'graph' }" @click="setViewMode('graph')">
            <Network :size="15" />
            <span>图谱视图</span>
          </button>
        </div>
        <n-button strong secondary round :disabled="isGeneratingOrg" @click="organizationBatchVisible = true">
          <template #icon>
            <Sparkles :size="16" />
          </template>
          {{ isGeneratingOrg ? '生成中...' : 'AI 生成组织' }}
        </n-button>
        <n-button strong secondary round :disabled="appStore.characters.length < 2 || isGeneratingRel" @click="openRelationshipBatch">
          <template #icon>
            <Sparkles :size="16" />
          </template>
          {{ isGeneratingRel ? '生成中...' : 'AI 生成关系' }}
        </n-button>
        <n-button strong secondary round :disabled="appStore.characters.length === 0 || appStore.organizations.length === 0 || isGeneratingMem" @click="handleGenerateMembership">
          <template #icon>
            <Sparkles :size="16" />
          </template>
          {{ isGeneratingMem ? '生成中...' : '补全全部归属' }}
        </n-button>
        <n-button strong secondary round @click="openOrganizationEditor()">
          <template #icon>
            <Building2 :size="16" />
          </template>
          新建组织
        </n-button>
        <n-button strong secondary round :disabled="appStore.characters.length < 2" @click="openRelationshipEditor()">
          <template #icon>
            <Link2 :size="16" />
          </template>
          新建关系
        </n-button>
        <n-button
          type="primary"
          strong
          round
          :disabled="appStore.characters.length === 0 || appStore.organizations.length === 0"
          @click="openMembershipEditor()"
        >
          <template #icon>
            <Plus :size="16" />
          </template>
          新建归属
        </n-button>
      </div>
    </div>

    <div class="stats-grid">
      <article v-for="card in stats" :key="card.key" class="stat-card">
        <div class="stat-icon">
          <component :is="card.icon" :size="18" />
        </div>
        <div class="stat-copy">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
          <small>{{ card.hint }}</small>
        </div>
      </article>
    </div>

    <div class="tip-card">
      <Shield :size="18" />
      <div>
        <strong>结构已经按“组织 / 关系 / 归属”拆分</strong>
        <p>
          现在就能服务角色设定和章节冲突推进，图谱视图也直接复用了这套数据结构，后续接阵营时间线或 AI
          分析能力时不需要重做模型。
        </p>
      </div>
    </div>

    <RelationsGraphView
      v-if="viewMode === 'graph'"
      :graph="relationsGraph"
      :query="mergedQuery"
      @reveal-in-list="revealNodeInList"
      @open-node="openGraphNodeEditor"
    />

    <div v-else class="panel-grid">
      <section class="module-card">
        <div class="module-head">
          <div>
            <span class="module-kicker">Organizations</span>
            <h3>组织势力</h3>
          </div>
          <span class="module-count">{{ filteredOrganizations.length }}</span>
        </div>

        <div v-if="filteredOrganizations.length > 0" class="card-list">
          <article v-for="organization in filteredOrganizations" :key="organization.id" class="entity-card">
            <div class="entity-card-top">
              <div class="entity-badge" :style="{ background: orgBadgeBgLight(orgBadgeColor(organization)), color: orgBadgeColor(organization) }">{{ orgInitial(organization.name) }}</div>
              <div class="entity-head-copy">
                <h4>{{ organization.name }}</h4>
                <span>{{ organization.type }}</span>
              </div>
              <div class="entity-actions">
                <button class="icon-button" @click="openOrganizationEditor(organization)">
                  <PencilLine :size="15" />
                </button>
                <button class="icon-button danger" @click="confirmDeleteOrganization(organization)">
                  <Trash2 :size="15" />
                </button>
              </div>
            </div>
            <p>{{ organization.description }}</p>
            <div class="entity-footer">
              <span>口号：{{ organization.motto }}</span>
            </div>
          </article>
        </div>
        <div v-else class="empty-card">
          <Building2 :size="18" />
          <strong>还没有组织势力</strong>
          <p>先把帮派、学院、王朝或企业势力录进来，后面角色归属才会更清晰。</p>
        </div>
      </section>

      <section class="module-card">
        <div class="module-head">
          <div>
            <span class="module-kicker">Relationships</span>
            <h3>人物关系</h3>
          </div>
          <span class="module-count">{{ filteredRelationships.length }}</span>
        </div>

        <div v-if="filteredRelationships.length > 0" class="card-list">
          <article v-for="relationship in filteredRelationships" :key="relationship.id" class="entity-card">
            <div class="entity-card-top">
              <div class="link-pair">
                <span>{{ relationship.fromCharacterName }}</span>
                <Link2 :size="14" />
                <span>{{ relationship.toCharacterName }}</span>
              </div>
              <div class="entity-actions">
                <button class="icon-button" @click="openRelationshipEditor(relationship)">
                  <PencilLine :size="15" />
                </button>
                <button class="icon-button danger" @click="confirmDeleteRelationship(relationship)">
                  <Trash2 :size="15" />
                </button>
              </div>
            </div>
            <div class="relationship-type">{{ relationship.type }}</div>
            <p>{{ relationship.description }}</p>
            <div class="intensity-row">
              <span>张力强度</span>
              <strong>{{ relationship.intensity }}</strong>
            </div>
            <div class="intensity-bar">
              <span :style="{ width: `${relationship.intensity}%` }"></span>
            </div>
          </article>
        </div>
        <div v-else class="empty-card">
          <Users :size="18" />
          <strong>还没有人物关系</strong>
          <p>至少准备两名角色后，就可以把盟友、敌对、暧昧、利用等关系沉淀下来。</p>
        </div>
      </section>

      <section class="module-card wide">
        <div class="module-head">
          <div>
            <span class="module-kicker">Memberships</span>
            <h3>成员归属</h3>
          </div>
          <span class="module-count">{{ filteredMemberships.length }}</span>
        </div>

        <div v-if="filteredMemberships.length > 0" class="membership-list">
          <article v-for="membership in filteredMemberships" :key="membership.id" class="membership-card">
            <div class="membership-main">
              <div class="membership-copy">
                <strong>{{ membership.characterName }}</strong>
                <span>{{ membership.organizationName }}</span>
              </div>
              <div class="membership-role">{{ membership.role }}</div>
            </div>
            <p>{{ membership.notes }}</p>
            <div class="entity-actions end">
              <button class="icon-button" @click="openMembershipEditor(membership)">
                <PencilLine :size="15" />
              </button>
              <button class="icon-button danger" @click="confirmDeleteMembership(membership)">
                <Trash2 :size="15" />
              </button>
            </div>
          </article>
        </div>
        <div v-else class="empty-card">
          <UserRoundCog :size="18" />
          <strong>还没有成员归属</strong>
          <p>先创建组织和角色，然后把人物挂到势力下面，章节中的职责与立场会更稳定。</p>
        </div>
      </section>
    </div>

    <n-modal
      :show="characterEditorVisible"
      preset="card"
      class="arc-editor-modal"
      :title="editingCharacterId ? '编辑角色' : '新建角色'"
      :bordered="false"
      @close="characterEditorVisible = false"
    >
      <n-form label-placement="top">
        <n-form-item label="角色名称">
          <n-input v-model:value="characterForm.name" placeholder="例如：林渡 / 宴川 / 白砚" />
        </n-form-item>
        <n-form-item label="角色定位">
          <n-input v-model:value="characterForm.role" placeholder="例如：情报中间人 / 家族继承人 / 小队领袖" />
        </n-form-item>
        <n-form-item label="角色简介">
          <n-input
            v-model:value="characterForm.description"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 7 }"
            placeholder="补充人物动机、关系张力、过往经历和当前立场..."
          />
        </n-form-item>
        <n-form-item label="角色标签">
          <n-dynamic-tags v-model:value="characterForm.tags" />
        </n-form-item>
      </n-form>

      <template #footer>
        <div class="arc-modal-actions">
          <n-button round strong @click="characterEditorVisible = false">取消</n-button>
          <n-button type="primary" round strong @click="submitCharacter">
            {{ editingCharacterId ? '保存修改' : '创建角色' }}
          </n-button>
        </div>
      </template>
    </n-modal>

    <BatchGenerateDialog
      :show="organizationBatchVisible"
      title="批量生成组织"
      description="生成多个可直接进入关系图谱的组织，并自动跳过重名结果。"
      item-label="组织"
      :loading="isGeneratingOrg"
      :progress="organizationBatchProgress"
      @close="organizationBatchVisible = false"
      @submit="handleGenerateOrganization"
    />

    <n-modal
      :show="relationshipBatchVisible"
      preset="card"
      class="batch-relation-modal"
      title="批量生成角色关系"
      :bordered="false"
      :mask-closable="!isGeneratingRel"
      :closable="!isGeneratingRel"
      @close="relationshipBatchVisible = false"
    >
      <n-form label-placement="top">
        <n-form-item label="主角色">
          <n-select v-model:value="relationshipBatchForm.mainCharacterId" :options="characterOptions" />
        </n-form-item>
        <n-form-item label="对应角色（可多选）">
          <n-select
            v-model:value="relationshipBatchForm.targetCharacterIds"
            multiple
            filterable
            :options="relationshipTargetOptions"
            placeholder="选择一个或多个角色"
          />
        </n-form-item>
        <n-form-item label="关系方向">
          <n-select v-model:value="relationshipBatchForm.direction" :options="directionOptions" />
        </n-form-item>
        <n-form-item label="补充要求（可选）">
          <n-input
            v-model:value="relationshipBatchForm.prompt"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 5 }"
            placeholder="例如：关系以利益冲突为主，减少情感线"
          />
        </n-form-item>
      </n-form>
      <p v-if="isGeneratingRel" class="relation-batch-progress">正在生成：{{ relationshipBatchProgress }}%</p>
      <template #footer>
        <div class="relation-batch-footer">
          <n-button :disabled="isGeneratingRel" @click="relationshipBatchVisible = false">取消</n-button>
          <n-button
            type="primary"
            :loading="isGeneratingRel"
            :disabled="relationshipBatchForm.targetCharacterIds.length === 0"
            @click="handleGenerateRelationship"
          >
            <template #icon><Sparkles :size="16" /></template>
            生成 {{ relationshipBatchForm.targetCharacterIds.length }} 条关系
          </n-button>
        </div>
      </template>
    </n-modal>

    <n-modal
      :show="organizationEditorVisible"
      preset="card"
      class="arc-editor-modal-wide"
      :title="editingOrganizationId ? '编辑组织' : '新建组织'"
      :bordered="false"
      @close="organizationEditorVisible = false"
    >
      <div class="arc-split-body">
        <div class="arc-split-left">
          <n-form label-placement="top">
            <n-form-item label="组织名称">
              <n-input v-model:value="organizationForm.name" placeholder="例如：夜枭会 / 帝都学院 / 第七码头工会" />
            </n-form-item>
            <n-form-item label="组织类型">
              <n-input v-model:value="organizationForm.type" placeholder="例如：地下据点 / 宫廷势力 / 商会联盟" />
            </n-form-item>
            <n-form-item label="口号或精神标识">
              <n-input v-model:value="organizationForm.motto" placeholder="例如：活下来，比体面更重要。" />
            </n-form-item>
          </n-form>
        </div>
        <div class="arc-split-right">
          <div class="arc-split-right-header">组织说明</div>
          <div class="arc-split-right-body">
            <n-input
              v-model:value="organizationForm.description"
              type="textarea"
              placeholder="补充组织掌控资源、核心利益和故事作用..."
              :show-count="true"
            />
          </div>
        </div>
      </div>
      <div class="arc-modal-footer">
        <div class="arc-modal-footer-left">
          <span>{{ organizationForm.description.length }} 字</span>
        </div>
        <div class="arc-modal-footer-right">
          <n-button round strong @click="organizationEditorVisible = false">取消</n-button>
          <n-button round strong :loading="enhanceOrgLoading" @click="handleAiEnhanceOrg">
            <template #icon><Sparkles :size="14" /></template>
            AI 补充
          </n-button>
          <n-button type="primary" round strong @click="submitOrganization">
            {{ editingOrganizationId ? '保存修改' : '创建组织' }}
          </n-button>
        </div>
      </div>

      <template #footer>
        <span />
      </template>
    </n-modal>

    <AiEnhancePreview
      :show="enhanceOrgVisible"
      :fields="enhanceOrgFields"
      :loading="enhanceOrgLoading"
      @apply="handleEnhanceOrgApply"
      @close="enhanceOrgVisible = false"
    />

    <n-modal
      :show="relationshipEditorVisible"
      preset="card"
      class="arc-editor-modal-wide"
      :title="editingRelationshipId ? '编辑关系' : '新建关系'"
      :bordered="false"
      @close="relationshipEditorVisible = false"
    >
      <div class="arc-split-body">
        <div class="arc-split-left">
          <n-form label-placement="top">
            <div class="form-grid">
              <n-form-item label="角色 A">
                <n-select v-model:value="relationshipForm.fromCharacterId" :options="characterOptions" />
              </n-form-item>
              <n-form-item label="角色 B">
                <n-select v-model:value="relationshipForm.toCharacterId" :options="characterOptions" />
              </n-form-item>
            </div>
            <n-form-item label="关系类型">
              <n-input v-model:value="relationshipForm.type" placeholder="例如：盟友 / 利用 / 师徒 / 竞争 / 暧昧" />
            </n-form-item>
            <n-form-item label="关系强度">
              <div class="slider-block">
                <n-slider v-model:value="relationshipForm.intensity" :step="1" :min="0" :max="100" />
                <span>{{ relationshipForm.intensity }}</span>
              </div>
            </n-form-item>
          </n-form>
        </div>
        <div class="arc-split-right">
          <div class="arc-split-right-header">关系描述</div>
          <div class="arc-split-right-body">
            <n-input
              v-model:value="relationshipForm.description"
              type="textarea"
              placeholder="补充两人冲突来源、情感张力或合作方式..."
              :show-count="true"
            />
          </div>
        </div>
      </div>
      <div class="arc-modal-footer">
        <div class="arc-modal-footer-left">
          <span>{{ relationshipForm.description.length }} 字</span>
        </div>
        <div class="arc-modal-footer-right">
          <n-button round strong @click="relationshipEditorVisible = false">取消</n-button>
          <n-button round strong :loading="enhanceRelLoading" @click="handleAiEnhanceRel">
            <template #icon><Sparkles :size="14" /></template>
            AI 补充
          </n-button>
          <n-button type="primary" round strong @click="submitRelationship">
            {{ editingRelationshipId ? '保存修改' : '创建关系' }}
          </n-button>
        </div>
      </div>

      <template #footer>
        <span />
      </template>
    </n-modal>

    <AiEnhancePreview
      :show="enhanceRelVisible"
      :fields="enhanceRelFields"
      :loading="enhanceRelLoading"
      @apply="handleEnhanceRelApply"
      @close="enhanceRelVisible = false"
    />

    <n-modal
      :show="membershipEditorVisible"
      preset="card"
      class="arc-editor-modal-wide"
      :title="editingMembershipId ? '编辑归属' : '新建归属'"
      :bordered="false"
      @close="membershipEditorVisible = false"
    >
      <div class="arc-split-body">
        <div class="arc-split-left">
          <n-form label-placement="top">
            <div class="form-grid">
              <n-form-item label="角色">
                <n-select v-model:value="membershipForm.characterId" :options="characterOptions" />
              </n-form-item>
              <n-form-item label="组织">
                <n-select v-model:value="membershipForm.organizationId" :options="organizationOptions" />
              </n-form-item>
            </div>
            <n-form-item label="组织身份">
              <n-input v-model:value="membershipForm.role" placeholder="例如：联络人 / 二把手 / 外围成员 / 导师" />
            </n-form-item>
          </n-form>
        </div>
        <div class="arc-split-right">
          <div class="arc-split-right-header">归属备注</div>
          <div class="arc-split-right-body">
            <n-input
              v-model:value="membershipForm.notes"
              type="textarea"
              placeholder="补充该角色在组织里的权限、职责、风险与站位..."
              :show-count="true"
            />
          </div>
        </div>
      </div>
      <div class="arc-modal-footer">
        <div class="arc-modal-footer-left">
          <span>{{ membershipForm.notes.length }} 字</span>
        </div>
        <div class="arc-modal-footer-right">
          <n-button round strong @click="membershipEditorVisible = false">取消</n-button>
          <n-button round strong :loading="enhanceMemLoading" @click="handleAiEnhanceMem">
            <template #icon><Sparkles :size="14" /></template>
            AI 补充
          </n-button>
          <n-button type="primary" round strong @click="submitMembership">
            {{ editingMembershipId ? '保存修改' : '创建归属' }}
          </n-button>
        </div>
      </div>

      <template #footer>
        <span />
      </template>
    </n-modal>

    <AiEnhancePreview
      :show="enhanceMemVisible"
      :fields="enhanceMemFields"
      :loading="enhanceMemLoading"
      @apply="handleEnhanceMemApply"
      @close="enhanceMemVisible = false"
    />
  </section>
</template>

<style scoped>
.relations-panel {
  max-width: 1240px;
  margin: 0 auto;
  min-width: 0;
}

.relation-batch-progress {
  margin: 0;
  color: var(--arc-text-muted);
  font-size: 12px;
}

.relation-batch-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.section-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.section-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-mix));
  color: var(--arc-primary);
  font-size: 12px;
  font-weight: 700;
  padding: 8px 12px;
  margin-bottom: 14px;
}

.section-head h2 {
  margin: 0 0 10px;
  font-size: clamp(30px, 3.4vw, 40px);
  font-weight: 700;
  letter-spacing: -0.04em;
  color: var(--arc-text-primary);
}

.section-head p {
  max-width: 48rem;
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 14px;
  line-height: 1.75;
}

.head-tools {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.view-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  background: var(--arc-bg-surface);
  padding: 4px;
}

.view-switch-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--arc-text-secondary);
  font-size: 12px;
  font-weight: 700;
  padding: 8px 12px;
  cursor: pointer;
  transition:
    color 0.16s ease,
    background 0.16s ease,
    transform 0.16s ease;
}

.view-switch-button:hover {
  color: var(--arc-primary);
  transform: translateY(-1px);
}

.view-switch-button.active {
  background: color-mix(in srgb, var(--arc-primary) 12%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

.search-input {
  display: inline-flex;
  width: clamp(220px, 24vw, 300px);
  align-items: center;
  gap: 8px;
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-hint);
  padding: 10px 14px;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background 0.18s ease;
}

.search-input:focus-within {
  border-color: color-mix(in srgb, var(--arc-primary) 26%, var(--arc-bg-mix));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--arc-primary) 10%, transparent);
  background: var(--arc-bg-surface);
}

.search-input input {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--arc-text-primary);
  outline: none;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}

.stat-card {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  padding: 16px 18px;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.03);
}

.stat-icon {
  display: inline-flex;
  width: 38px;
  height: 38px;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background: color-mix(in srgb, var(--arc-primary) 12%, var(--arc-bg-mix));
  color: var(--arc-primary);
  flex-shrink: 0;
}

.stat-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-copy span {
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.stat-copy strong {
  color: var(--arc-text-primary);
  font-size: 26px;
  font-weight: 700;
  line-height: 1;
}

.stat-copy small {
  color: var(--arc-text-hint);
  font-size: 11px;
  line-height: 1.6;
}

.tip-card {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 18px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 16%, var(--arc-border));
  border-radius: 10px;
  background: color-mix(in srgb, var(--arc-primary) 6%, var(--arc-bg-surface));
  color: var(--arc-text-primary);
  padding: 16px 18px;
}

.tip-card strong {
  display: block;
  margin-bottom: 6px;
  color: var(--arc-text-primary);
  font-size: 14px;
}

.tip-card p {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.panel-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.module-card {
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  padding: 20px;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.03);
}

.module-card.wide {
  grid-column: 1 / -1;
}

.module-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.module-kicker {
  display: inline-flex;
  margin-bottom: 8px;
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.module-head h3 {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.module-count {
  display: inline-flex;
  min-width: 34px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-mix));
  color: var(--arc-primary);
  font-size: 12px;
  font-weight: 800;
  padding: 8px 10px;
}

.card-list,
.membership-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.entity-card,
.membership-card {
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  padding: 16px;
}

.entity-card-top,
.membership-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.entity-badge {
  width: 40px;
  height: 40px;
  border-radius: 14px;
  flex-shrink: 0;
  border: 1px solid var(--arc-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.02em;
  user-select: none;
}

.entity-head-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 4px;
}

.entity-head-copy h4,
.membership-copy strong {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 16px;
  font-weight: 700;
}

.entity-head-copy span,
.membership-copy span {
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.entity-card p,
.membership-card p {
  margin: 12px 0 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.entity-footer {
  display: flex;
  margin-top: 12px;
  color: var(--arc-text-hint);
  font-size: 12px;
}

.entity-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.entity-actions.end {
  margin-top: 14px;
  justify-content: flex-end;
}

.icon-button {
  display: inline-flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--arc-border);
  border-radius: 12px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    color 0.16s ease,
    background 0.16s ease;
}

.icon-button:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 18%, var(--arc-border));
  color: var(--arc-primary);
}

.icon-button.danger:hover {
  border-color: color-mix(in srgb, var(--arc-danger) 40%, var(--arc-border));
  color: var(--arc-danger);
  background: color-mix(in srgb, var(--arc-danger) 10%, var(--arc-bg-surface));
}

.link-pair {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--arc-text-primary);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
}

.relationship-type {
  display: inline-flex;
  margin-top: 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 10%, var(--arc-bg-mix));
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 800;
  padding: 6px 10px;
}

.intensity-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  color: var(--arc-text-hint);
  font-size: 12px;
}

.intensity-row strong {
  color: var(--arc-text-primary);
  font-size: 13px;
}

.intensity-bar {
  width: 100%;
  height: 8px;
  margin-top: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--arc-border);
}

.intensity-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #93c5fd 0%, #2563eb 100%);
}

.membership-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.membership-role {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: rgba(241, 245, 249, 0.96);
  color: var(--arc-text-secondary);
  font-size: 12px;
  font-weight: 700;
  padding: 8px 12px;
}

.empty-card {
  display: flex;
  min-height: 220px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 1px dashed var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
  text-align: center;
  padding: 24px;
}

.empty-card strong {
  color: var(--arc-text-primary);
  font-size: 15px;
}

.empty-card p {
  max-width: 26rem;
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.slider-block {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.slider-block span {
  min-width: 28px;
  color: var(--arc-text-primary);
  font-size: 13px;
  font-weight: 700;
  text-align: right;
}

@media (max-width: 1180px) {
  .panel-grid,
  .stats-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .head-tools {
    justify-content: flex-start;
  }

  .search-input {
    width: 100%;
  }
}

@media (max-width: 760px) {
  .form-grid {
    grid-template-columns: 1fr;
  }

  .entity-card-top,
  .membership-main {
    align-items: flex-start;
    flex-direction: column;
  }

  .entity-actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>

<style>
.batch-relation-modal {
  width: min(560px, calc(100vw - 32px));
}
</style>
