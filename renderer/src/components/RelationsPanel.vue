<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  Building2,
  Link2,
  Network,
  PencilLine,
  Plus,
  Search,
  Shield,
  Trash2,
  UserRoundCog,
  Users
} from 'lucide-vue-next'
import { NButton, NForm, NFormItem, NInput, NModal, NSelect, NSlider, useDialog, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import type { CharacterRelationship, OrganizationEntry, OrganizationMembership } from '@/types/app'

const props = defineProps<{
  searchQuery?: string // 全局搜索关键词
}>()

const appStore = useAppStore()
const message = useMessage()
const dialog = useDialog()
const keyword = ref('') // 本面板内的本地搜索关键词

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
        <p>现在就能服务角色设定和章节冲突推进，后续接关系图、阵营时间线或 AI 上下文时也不需要重做数据模型。</p>
      </div>
    </div>

    <div class="panel-grid">
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
              <div class="entity-badge" :style="{ background: organization.color }"></div>
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
      :show="organizationEditorVisible"
      preset="card"
      class="arc-editor-modal"
      :title="editingOrganizationId ? '编辑组织' : '新建组织'"
      :bordered="false"
      @close="organizationEditorVisible = false"
    >
      <n-form label-placement="top">
        <n-form-item label="组织名称">
          <n-input v-model:value="organizationForm.name" placeholder="例如：夜枭会 / 帝都学院 / 第七码头工会" />
        </n-form-item>
        <n-form-item label="组织类型">
          <n-input v-model:value="organizationForm.type" placeholder="例如：地下据点 / 宫廷势力 / 商会联盟" />
        </n-form-item>
        <n-form-item label="组织说明">
          <n-input
            v-model:value="organizationForm.description"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 7 }"
            placeholder="补充组织掌控资源、核心利益和故事作用..."
          />
        </n-form-item>
        <n-form-item label="口号或精神标识">
          <n-input v-model:value="organizationForm.motto" placeholder="例如：活下来，比体面更重要。" />
        </n-form-item>
        <n-form-item label="卡片背景">
          <n-input
            v-model:value="organizationForm.color"
            placeholder="支持颜色或渐变，例如：linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)"
          />
        </n-form-item>
      </n-form>

      <template #footer>
        <div class="arc-modal-actions">
          <n-button round strong @click="organizationEditorVisible = false">取消</n-button>
          <n-button type="primary" round strong @click="submitOrganization">
            {{ editingOrganizationId ? '保存修改' : '创建组织' }}
          </n-button>
        </div>
      </template>
    </n-modal>

    <n-modal
      :show="relationshipEditorVisible"
      preset="card"
      class="arc-editor-modal"
      :title="editingRelationshipId ? '编辑关系' : '新建关系'"
      :bordered="false"
      @close="relationshipEditorVisible = false"
    >
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
        <n-form-item label="关系描述">
          <n-input
            v-model:value="relationshipForm.description"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 7 }"
            placeholder="补充两人冲突来源、情感张力或合作方式..."
          />
        </n-form-item>
        <n-form-item label="关系强度">
          <div class="slider-block">
            <n-slider v-model:value="relationshipForm.intensity" :step="1" :min="0" :max="100" />
            <span>{{ relationshipForm.intensity }}</span>
          </div>
        </n-form-item>
      </n-form>

      <template #footer>
        <div class="arc-modal-actions">
          <n-button round strong @click="relationshipEditorVisible = false">取消</n-button>
          <n-button type="primary" round strong @click="submitRelationship">
            {{ editingRelationshipId ? '保存修改' : '创建关系' }}
          </n-button>
        </div>
      </template>
    </n-modal>

    <n-modal
      :show="membershipEditorVisible"
      preset="card"
      class="arc-editor-modal"
      :title="editingMembershipId ? '编辑归属' : '新建归属'"
      :bordered="false"
      @close="membershipEditorVisible = false"
    >
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
        <n-form-item label="归属备注">
          <n-input
            v-model:value="membershipForm.notes"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 7 }"
            placeholder="补充该角色在组织里的权限、职责、风险与站位..."
          />
        </n-form-item>
      </n-form>

      <template #footer>
        <div class="arc-modal-actions">
          <n-button round strong @click="membershipEditorVisible = false">取消</n-button>
          <n-button type="primary" round strong @click="submitMembership">
            {{ editingMembershipId ? '保存修改' : '创建归属' }}
          </n-button>
        </div>
      </template>
    </n-modal>
  </section>
</template>

<style scoped>
.relations-panel {
  max-width: 1240px;
  margin: 0 auto;
  min-width: 0;
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
  background: color-mix(in srgb, var(--arc-primary) 10%, white);
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

.search-input {
  display: inline-flex;
  width: clamp(220px, 24vw, 300px);
  align-items: center;
  gap: 8px;
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: var(--arc-text-hint);
  padding: 10px 14px;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background 0.18s ease;
}

.search-input:focus-within {
  border-color: color-mix(in srgb, var(--arc-primary) 26%, white);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--arc-primary) 10%, transparent);
  background: white;
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
  border: 1px solid rgba(226, 232, 240, 0.88);
  border-radius: 24px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.96));
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
  background: color-mix(in srgb, var(--arc-primary) 12%, white);
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
  border: 1px solid rgba(191, 219, 254, 0.8);
  border-radius: 24px;
  background:
    radial-gradient(circle at right top, rgba(219, 234, 254, 0.78), transparent 36%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(246, 250, 255, 0.98));
  color: #1e3a8a;
  padding: 16px 18px;
}

.tip-card strong {
  display: block;
  margin-bottom: 6px;
  color: #0f172a;
  font-size: 14px;
}

.tip-card p {
  margin: 0;
  color: #475569;
  font-size: 13px;
  line-height: 1.7;
}

.panel-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.module-card {
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.96);
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
  background: color-mix(in srgb, var(--arc-primary) 10%, white);
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
  border: 1px solid rgba(226, 232, 240, 0.84);
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.96));
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
  border: 1px solid rgba(255, 255, 255, 0.88);
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
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 12px;
  background: white;
  color: var(--arc-text-secondary);
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    color 0.16s ease,
    background 0.16s ease;
}

.icon-button:hover {
  border-color: color-mix(in srgb, var(--arc-primary) 18%, white);
  color: var(--arc-primary);
}

.icon-button.danger:hover {
  border-color: rgba(252, 165, 165, 0.86);
  color: #dc2626;
  background: rgba(254, 242, 242, 0.92);
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
  background: color-mix(in srgb, var(--arc-primary) 10%, white);
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
  background: rgba(226, 232, 240, 0.9);
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
  border: 1px dashed rgba(203, 213, 225, 0.92);
  border-radius: 24px;
  background: rgba(248, 250, 252, 0.78);
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
