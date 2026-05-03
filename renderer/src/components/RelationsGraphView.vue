<script setup lang="ts">
import cytoscape from 'cytoscape'
import type { StylesheetJson } from 'cytoscape'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Building2, Link2, Network, Search, Sparkles, Target, Users } from 'lucide-vue-next'
import {
  buildCharacterOrganizationLabels,
  buildOrganizationMemberIds,
  buildOrganizationNodeId,
  buildRelationsCytoscapeElements,
  buildRelationsGraphFocusState,
  buildRelationsGraphHotspots,
  filterRelationsGraph,
  type RelationsGraphData,
  type RelationsGraphEdge,
  type RelationsGraphFocusMode,
  type RelationsGraphNode
} from '@/features/relations/graph'

const props = defineProps<{
  graph: RelationsGraphData
  query?: string
}>()

const emit = defineEmits<{
  revealInList: [label: string]
  openNode: [payload: { kind: RelationsGraphNode['kind']; entityId: string }]
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const highIntensityOnly = ref(false)
const selectedOrganizationId = ref<string | null>(null)
const organizationSubgraphOnly = ref(true)
const selectedNodeId = ref<string | null>(null)
const focusMode = ref<RelationsGraphFocusMode>('overview')

let cy: cytoscape.Core | null = null
let lastTappedNodeId: string | null = null
let lastTappedAt = 0

const filteredGraph = computed(() =>
  filterRelationsGraph(props.graph, {
    query: props.query ?? '',
    highIntensityOnly: highIntensityOnly.value
  })
)

const selectedNode = computed(
  () => displayGraph.value.nodes.find((node) => node.id === selectedNodeId.value) ?? displayGraph.value.nodes[0] ?? null
)

const organizationOptions = computed(() =>
  props.graph.nodes
    .filter((node) => node.kind === 'organization')
    .map((node) => ({
      entityId: node.entityId,
      label: node.label,
      subtitle: node.subtitle,
      description: node.description,
      accent: node.accent
    }))
)

const selectedOrganization = computed(
  () => organizationOptions.value.find((item) => item.entityId === selectedOrganizationId.value) ?? null
)

const selectedOrganizationMemberIds = computed(() => buildOrganizationMemberIds(props.graph, selectedOrganizationId.value))
const displayGraph = computed(() => {
  if (!selectedOrganizationId.value || !organizationSubgraphOnly.value) {
    return filteredGraph.value
  }

  const memberIds = selectedOrganizationMemberIds.value
  return {
    nodes: filteredGraph.value.nodes.filter((node) => memberIds.has(node.id)),
    edges: filteredGraph.value.edges.filter((edge) => memberIds.has(edge.source) && memberIds.has(edge.target)),
    matchedNodeIds: new Set(
      [...filteredGraph.value.matchedNodeIds].filter((nodeId) => memberIds.has(nodeId))
    )
  }
})
const selectedCharacterOrganizations = computed(() =>
  selectedNode.value ? buildCharacterOrganizationLabels(props.graph, selectedNode.value.id) : []
)

const selectedNodeConnections = computed(() => {
  if (!selectedNode.value) {
    return []
  }

  return displayGraph.value.edges.filter(
    (edge) => edge.source === selectedNode.value?.id || edge.target === selectedNode.value?.id
  )
})

const isOrganizationCampFocus = computed(
  () => focusMode.value === 'camp' && Boolean(selectedOrganizationId.value)
)

const focusState = computed(() => {
  if (isOrganizationCampFocus.value && organizationSubgraphOnly.value) {
    return {
      focusedNodeIds: new Set(displayGraph.value.nodes.map((node) => node.id)),
      focusedEdgeIds: new Set(displayGraph.value.edges.map((edge) => edge.id)),
      memberNodeIds: new Set(displayGraph.value.nodes.map((node) => node.id)),
      internalRelationshipEdgeIds: new Set(displayGraph.value.edges.map((edge) => edge.id))
    }
  }

  if (isOrganizationCampFocus.value && selectedOrganizationId.value) {
    return buildRelationsGraphFocusState(props.graph, buildOrganizationNodeId(selectedOrganizationId.value), 'camp')
  }

  return buildRelationsGraphFocusState(displayGraph.value, selectedNode.value?.id ?? null, focusMode.value)
})

const hotspotNodes = computed(() => buildRelationsGraphHotspots(displayGraph.value))

const selectedNodeConnectionSummary = computed(() => ({
  relationships: selectedNodeConnections.value.filter((edge) => edge.kind === 'relationship').length,
  affiliations: selectedCharacterOrganizations.value.length
}))

const relationshipStrengthSummary = computed(() => {
  if (!selectedNodeConnections.value.length) {
    return {
      strongest: null as RelationsGraphEdge | null,
      average: 0
    }
  }

  const strongest = [...selectedNodeConnections.value].sort((left, right) => right.intensity - left.intensity)[0] ?? null
  const relationshipEdges = selectedNodeConnections.value.filter((edge) => edge.kind === 'relationship')
  const average = relationshipEdges.length
    ? Math.round(relationshipEdges.reduce((sum, edge) => sum + edge.intensity, 0) / relationshipEdges.length)
    : 0

  return {
    strongest,
    average
  }
})

const keyRelationshipCards = computed(() =>
  [...selectedNodeConnections.value]
    .filter((edge) => edge.kind === 'relationship')
    .sort((left, right) => right.intensity - left.intensity)
    .slice(0, 3)
)

const campRelationshipCards = computed(() => {
  if (!selectedCharacterOrganizations.value.length) {
    return []
  }

  const organizationSet = new Set(selectedCharacterOrganizations.value)
  return keyRelationshipCards.value.filter((edge) => {
    const peerId = edge.source === selectedNode.value?.id ? edge.target : edge.source
    const peerOrganizations = buildCharacterOrganizationLabels(props.graph, peerId)
    return peerOrganizations.some((organization) => organizationSet.has(organization))
  })
})

const organizationCampSummary = computed(() => ({
  members: selectedOrganizationMemberIds.value.size,
  internalRelationships: focusState.value.internalRelationshipEdgeIds.size
}))

watch(
  () => displayGraph.value.nodes,
  (nodes) => {
    if (!nodes.length) {
      selectedNodeId.value = null
      return
    }

    if (!selectedNodeId.value || !nodes.some((node) => node.id === selectedNodeId.value)) {
      selectedNodeId.value = nodes[0].id
    }
  },
  { immediate: true }
)

watch(selectedOrganizationId, () => {
  if (!selectedOrganizationId.value) {
    if (focusMode.value === 'camp') {
      focusMode.value = 'overview'
    }
    return
  }

  focusMode.value = 'camp'
  const currentNodeId = selectedNode.value?.id
  if (!currentNodeId || !selectedOrganizationMemberIds.value.has(currentNodeId)) {
    selectedNodeId.value = [...selectedOrganizationMemberIds.value][0] ?? displayGraph.value.nodes[0]?.id ?? null
  }
})

watch(
  [() => displayGraph.value.nodes, () => displayGraph.value.edges],
  async () => {
    await nextTick()
    renderGraph()
  },
  { deep: true }
)

watch(
  [selectedNodeId, focusMode, selectedOrganizationId],
  () => {
    refreshGraphFocus()
  },
  { deep: true }
)

onMounted(async () => {
  await nextTick()
  renderGraph()
})

onBeforeUnmount(() => {
  if (cy) {
    cy.destroy()
    cy = null
  }
})

function toggleHighIntensityOnly(): void {
  highIntensityOnly.value = !highIntensityOnly.value
}

function revealInList(): void {
  if (!selectedNode.value) {
    return
  }

  emit('revealInList', selectedNode.value.label)
}

function selectNode(nodeId: string): void {
  selectedNodeId.value = nodeId
  focusMode.value = selectedOrganizationId.value ? 'camp' : 'chain'
}

function setFocusMode(mode: RelationsGraphFocusMode): void {
  focusMode.value = mode
}

function resolveConnectedNodeLabel(edge: RelationsGraphEdge): string {
  if (!selectedNode.value) {
    return ''
  }

  const peerId = edge.source === selectedNode.value.id ? edge.target : edge.source
  return props.graph.nodes.find((node) => node.id === peerId)?.label ?? '未命名角色'
}

function resolveIntensityLabel(intensity: number): string {
  if (intensity >= 85) {
    return '极强'
  }
  if (intensity >= 70) {
    return '很强'
  }
  if (intensity >= 55) {
    return '中高'
  }
  if (intensity >= 40) {
    return '中等'
  }
  return '偏弱'
}

function renderGraph(): void {
  if (!containerRef.value) {
    return
  }

  const elements = buildRelationsCytoscapeElements(displayGraph.value)
  cy?.destroy()

  cy = cytoscape({
    container: containerRef.value,
    elements,
    layout: resolveLayout(),
    minZoom: 0.45,
    maxZoom: 2.4,
    wheelSensitivity: 0.18,
    boxSelectionEnabled: false,
    autoungrabify: false,
    style: buildStylesheet()
  })

  cy.on('tap', 'node', (event) => {
    const nodeId = String(event.target.id())
    selectNode(nodeId)

    const now = Date.now()
    const graphNode = displayGraph.value.nodes.find((node) => node.id === nodeId)
    if (graphNode && lastTappedNodeId === nodeId && now - lastTappedAt < 320) {
      emit('openNode', {
        kind: 'character',
        entityId: graphNode.entityId
      })
      lastTappedNodeId = null
      lastTappedAt = 0
      return
    }

    lastTappedNodeId = nodeId
    lastTappedAt = now
  })

  applyFocusClasses(false)
}

function refreshGraphFocus(): void {
  if (!cy) {
    return
  }

  if (isOrganizationCampFocus.value) {
    cy.layout(resolveLayout()).run()
    return
  }

  applyFocusClasses(true)
}

function applyFocusClasses(centerSelection: boolean): void {
  if (!cy) {
    return
  }

  cy.nodes().removeClass('selected-node connected-node member-node camp-anchor muted-node')
  cy.edges().removeClass('active-edge muted-edge internal-edge')

  const currentNode = selectedNode.value
  if (!currentNode && !isOrganizationCampFocus.value) {
    cy.fit(cy.elements(), 60)
    return
  }

  const focusNodeIds = focusState.value.focusedNodeIds
  const memberNodeIds = focusState.value.memberNodeIds
  const focusEdgeIds = focusState.value.focusedEdgeIds

  cy.nodes().forEach((node) => {
    const id = node.id()
    if (currentNode && id === currentNode.id) {
      node.addClass('selected-node')
      if (isOrganizationCampFocus.value && memberNodeIds.has(id)) {
        node.addClass('camp-anchor')
      }
      return
    }

    if (focusNodeIds.has(id)) {
      node.addClass('connected-node')
      if (memberNodeIds.has(id)) {
        node.addClass('member-node')
      }
      return
    }

    node.addClass('muted-node')
  })

  cy.edges().forEach((edge) => {
    if (focusEdgeIds.has(edge.id())) {
      edge.addClass('active-edge')
      if (focusState.value.internalRelationshipEdgeIds.has(edge.id())) {
        edge.addClass('internal-edge')
      }
      return
    }

    edge.addClass('muted-edge')
  })

  if (centerSelection && currentNode) {
    const selectedCyNode = cy.getElementById(currentNode.id)
    if (selectedCyNode.nonempty()) {
      cy.animate({
        center: { eles: selectedCyNode },
        zoom: Math.max(cy.zoom(), 0.95),
        duration: 260
      })
    }
  } else {
    cy.fit(cy.elements(), 60)
  }
}

function resolveLayout(): cytoscape.LayoutOptions {
  if (isOrganizationCampFocus.value) {
    const campNodeIds = focusState.value.focusedNodeIds
    const memberNodeIds = focusState.value.memberNodeIds
    const selectedId = selectedNode.value?.id ?? ''

    return {
      name: 'concentric',
      animate: true,
      animationDuration: 320,
      fit: true,
      padding: 88,
      startAngle: -Math.PI / 2,
      sweep: Math.PI * 2,
      equidistant: true,
      minNodeSpacing: 42,
      concentric(node) {
        const nodeId = node.id()
        if (nodeId === selectedId) {
          return 4
        }
        if (memberNodeIds.has(nodeId)) {
          return 3
        }
        if (campNodeIds.has(nodeId)) {
          return 2
        }
        return 1
      },
      levelWidth() {
        return 1
      }
    }
  }

  return {
    name: 'cose',
    animate: true,
    animationDuration: 380,
    fit: true,
    padding: 60,
    nodeRepulsion: 9800,
    idealEdgeLength: () => 122,
    edgeElasticity: 180,
    nestingFactor: 0.9,
    gravity: 0.7,
    randomize: false
  }
}

function buildStylesheet(): StylesheetJson {
  const stylesheet = [
    {
      selector: 'core',
      style: {
        'active-bg-color': '#dbeafe',
        'active-bg-opacity': '0.24',
        'active-bg-size': '20',
        'selection-box-opacity': '0'
      }
    },
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        color: '#0f172a',
        'font-size': '13',
        'font-weight': '700',
        'text-wrap': 'wrap',
        'text-max-width': '120',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': '14',
        'text-background-color': 'data(textBackground)',
        'text-background-opacity': '0.94',
        'text-background-padding': '6',
        'text-background-shape': 'round-rectangle',
        'text-border-opacity': '0',
        'text-outline-width': '0'
      }
    },
    {
      selector: 'node.character',
      style: {
        shape: 'ellipse',
        width: 'data(size)',
        height: 'data(size)',
        'background-color': 'data(accent)',
        'border-width': '2.5',
        'border-color': 'data(borderColor)',
        'shadow-blur': '22',
        'shadow-color': 'data(accent)',
        'shadow-opacity': '0.22',
        'shadow-offset-x': '0',
        'shadow-offset-y': '10',
        'overlay-padding': '8',
        'overlay-opacity': '0'
      }
    },
    {
      selector: 'node.matched',
      style: {
        'underlay-color': 'rgba(59,130,246,0.18)',
        'underlay-opacity': '1',
        'underlay-padding': '10'
      }
    },
    {
      selector: 'node.selected-node',
      style: {
        'border-color': '#1d4ed8',
        'border-width': '4.5',
        'underlay-color': 'rgba(59,130,246,0.2)',
        'underlay-opacity': '1',
        'underlay-padding': '14',
        'shadow-blur': '28',
        'shadow-opacity': '0.34',
        opacity: '1'
      }
    },
    {
      selector: 'node.connected-node',
      style: {
        opacity: '1'
      }
    },
    {
      selector: 'node.member-node',
      style: {
        'border-style': 'dashed',
        'border-color': '#0f766e',
        'border-width': '3',
        'underlay-color': 'rgba(16,185,129,0.12)',
        'underlay-opacity': '1',
        'underlay-padding': '16'
      }
    },
    {
      selector: 'node.camp-anchor',
      style: {
        'underlay-color': 'rgba(14,165,233,0.16)',
        'underlay-opacity': '1',
        'underlay-padding': '22'
      }
    },
    {
      selector: 'node.muted-node',
      style: {
        opacity: '0.14'
      }
    },
    {
      selector: 'edge',
      style: {
        width: 'data(width)',
        opacity: 'data(opacity)',
        'curve-style': 'bezier'
      }
    },
    {
      selector: 'edge.relationship',
      style: {
        'line-color': 'data(color)'
      }
    },
    {
      selector: 'edge.active-edge',
      style: {
        opacity: '1',
        'line-color': 'data(activeColor)'
      }
    },
    {
      selector: 'edge.internal-edge',
      style: {
        width: '5.2',
        opacity: '1',
        'line-color': '#f97316',
        'shadow-blur': '8',
        'shadow-color': 'rgba(249,115,22,0.28)',
        'shadow-opacity': '0.34'
      }
    },
    {
      selector: 'edge.muted-edge',
      style: {
        opacity: '0.05'
      }
    }
  ]

  return stylesheet as unknown as StylesheetJson
}
</script>

<template>
  <section class="graph-shell">
    <div class="graph-toolbar">
      <div class="graph-toolbar-copy">
        <span class="graph-kicker">Character Network</span>
        <h3>角色关系主图</h3>
        <p>这张图默认只回答一件事：谁和谁有关系。组织与归属不再抢主视图，而是作为辅助筛选条件存在。</p>
      </div>
      <div class="graph-toolbar-metrics">
        <div class="metric-pill">
          <strong>{{ displayGraph.nodes.length }}</strong>
          <span>关系角色</span>
        </div>
        <div class="metric-pill">
          <strong>{{ displayGraph.edges.length }}</strong>
          <span>关系连线</span>
        </div>
      </div>
    </div>

    <div class="filter-row">
      <button class="filter-chip active static" type="button">
        <Link2 :size="14" />
        <span>角色关系主图</span>
      </button>
      <button class="filter-chip accent" :class="{ active: highIntensityOnly }" @click="toggleHighIntensityOnly">
        <Sparkles :size="14" />
        <span>高强度关系</span>
      </button>
      <div v-if="query?.trim()" class="query-pill">
        <Search :size="14" />
        <span>{{ query }}</span>
      </div>
    </div>

    <div class="organization-focus-row">
      <div class="organization-focus-copy">
        <span class="organization-focus-kicker">阵营筛选</span>
        <p>组织不再占据主图中心。它们只作为观察镜头，用来查看某个阵营的成员分布，以及成员之间是否存在高张力联系。</p>
      </div>
      <div class="organization-chip-group">
        <button
          class="organization-chip"
          :class="{ active: !selectedOrganizationId }"
          type="button"
          @click="selectedOrganizationId = null"
        >
          全部角色
        </button>
        <button
          v-for="organization in organizationOptions"
          :key="organization.entityId"
          class="organization-chip"
          :class="{ active: selectedOrganizationId === organization.entityId }"
          type="button"
          @click="selectedOrganizationId = organization.entityId"
        >
          <span class="organization-chip-dot" :style="{ background: organization.accent }"></span>
          <span>{{ organization.label }}</span>
        </button>
      </div>
      <button
        class="subgraph-toggle"
        :class="{ active: organizationSubgraphOnly }"
        :disabled="!selectedOrganizationId"
        type="button"
        @click="organizationSubgraphOnly = !organizationSubgraphOnly"
      >
        {{ organizationSubgraphOnly ? '纯子图模式' : '全图高亮模式' }}
      </button>
    </div>

    <div class="focus-row">
      <div class="focus-mode-group">
        <button class="focus-mode-button" :class="{ active: focusMode === 'overview' }" @click="setFocusMode('overview')">
          <Target :size="14" />
          <span>总览</span>
        </button>
        <button class="focus-mode-button" :class="{ active: focusMode === 'chain' }" @click="setFocusMode('chain')">
          <Users :size="14" />
          <span>角色关系链</span>
        </button>
        <button
          class="focus-mode-button"
          :class="{ active: focusMode === 'camp' }"
          :disabled="!selectedOrganizationId"
          @click="setFocusMode('camp')"
        >
          <Building2 :size="14" />
          <span>组织成员网络</span>
        </button>
      </div>

      <div class="hotspot-row">
        <span class="hotspot-label">关系热点</span>
        <button
          v-for="node in hotspotNodes"
          :key="node.id"
          class="hotspot-chip"
          :class="{ active: selectedNode?.id === node.id }"
          @click="selectNode(node.id)"
        >
          <span>{{ node.label }}</span>
          <strong>{{ node.degree }}</strong>
        </button>
      </div>
    </div>

    <div v-if="displayGraph.nodes.length > 0" class="graph-body">
      <div class="graph-stage">
        <div ref="containerRef" class="graph-canvas"></div>

        <div class="graph-legend">
          <div class="legend-item">
            <span class="legend-dot character"></span>
            <span>角色节点</span>
          </div>
          <div class="legend-item">
            <span class="legend-line relationship"></span>
            <span>普通关系</span>
          </div>
          <div class="legend-item">
            <span class="legend-line internal"></span>
            <span>阵营内高亮关系</span>
          </div>
        </div>
      </div>

      <aside class="detail-card">
        <template v-if="selectedNode">
          <div class="detail-card-top">
            <div class="detail-badge" :style="{ background: `${selectedNode.accent}1c`, color: selectedNode.accent }">角色档案</div>
            <button class="detail-action" @click="revealInList">回到列表定位</button>
          </div>

          <div class="profile-hero">
            <div class="profile-avatar" :style="{ background: selectedNode.accent }">
              <span>{{ selectedNode.label.slice(0, 1) }}</span>
            </div>
            <div class="profile-copy">
              <h4>{{ selectedNode.label }}</h4>
              <p class="detail-subtitle">{{ selectedNode.subtitle || '待补充角色定位' }}</p>
              <p class="detail-description">{{ selectedNode.description || '暂时还没有补充更多说明。' }}</p>
            </div>
          </div>

          <div class="dossier-grid">
            <article class="dossier-card primary">
              <span class="dossier-label">关系概况</span>
              <strong>{{ selectedNodeConnectionSummary.relationships }} 条</strong>
              <small>当前已录入的直接角色关系</small>
            </article>
            <article class="dossier-card">
              <span class="dossier-label">平均张力</span>
              <strong>{{ relationshipStrengthSummary.average || '--' }}</strong>
              <small>{{ relationshipStrengthSummary.average ? `${resolveIntensityLabel(relationshipStrengthSummary.average)}关系密度` : '暂无可计算样本' }}</small>
            </article>
            <article class="dossier-card">
              <span class="dossier-label">所属阵营</span>
              <strong>{{ selectedNodeConnectionSummary.affiliations || '--' }}</strong>
              <small>{{ selectedNodeConnectionSummary.affiliations ? '已绑定组织背景' : '暂未绑定组织' }}</small>
            </article>
          </div>

          <section v-if="selectedCharacterOrganizations.length > 0" class="archive-section">
            <div class="archive-section-head">
              <span class="archive-section-kicker">Affiliations</span>
              <strong>所属阵营</strong>
            </div>
            <div class="affiliation-chips">
              <span v-for="organizationLabel in selectedCharacterOrganizations" :key="organizationLabel" class="affiliation-chip">
                {{ organizationLabel }}
              </span>
            </div>
          </section>

          <section v-if="relationshipStrengthSummary.strongest" class="archive-section">
            <div class="archive-section-head">
              <span class="archive-section-kicker">Signature Link</span>
              <strong>最强关系对象</strong>
            </div>
            <article class="signature-card">
              <div class="signature-head">
                <span class="connection-type">{{ relationshipStrengthSummary.strongest.label }}</span>
                <span class="connection-peer">{{ resolveConnectedNodeLabel(relationshipStrengthSummary.strongest) }}</span>
              </div>
              <div class="signature-meta">
                <span>张力强度 {{ relationshipStrengthSummary.strongest.intensity }}</span>
                <strong>{{ resolveIntensityLabel(relationshipStrengthSummary.strongest.intensity) }}</strong>
              </div>
              <p>{{ relationshipStrengthSummary.strongest.description || '暂未补充这条关系的更多说明。' }}</p>
            </article>
          </section>

          <section v-if="isOrganizationCampFocus && selectedOrganization" class="archive-section">
            <div class="archive-section-head">
              <span class="archive-section-kicker">Camp View</span>
              <strong>当前阵营观察</strong>
            </div>
            <div class="camp-summary-grid">
              <article class="camp-summary-card">
                <strong>{{ selectedOrganization.label }}</strong>
                <span>{{ selectedOrganization.subtitle }}</span>
              </article>
              <article class="camp-summary-card">
                <strong>{{ organizationCampSummary.members }}</strong>
                <span>成员角色</span>
              </article>
              <article class="camp-summary-card">
                <strong>{{ organizationCampSummary.internalRelationships }}</strong>
                <span>内部关系</span>
              </article>
            </div>
          </section>

          <section v-if="campRelationshipCards.length > 0" class="archive-section">
            <div class="archive-section-head">
              <span class="archive-section-kicker">Same Camp</span>
              <strong>同阵营重点关系</strong>
            </div>
            <div class="relation-card-list">
              <article v-for="edge in campRelationshipCards" :key="edge.id" class="connection-card compact">
                <div class="connection-head">
                  <span class="connection-type">{{ edge.label }}</span>
                  <span class="connection-peer">{{ resolveConnectedNodeLabel(edge) }}</span>
                </div>
                <div class="signature-meta compact">
                  <span>强度 {{ edge.intensity }}</span>
                  <strong>{{ resolveIntensityLabel(edge.intensity) }}</strong>
                </div>
                <p>{{ edge.description || '暂未补充说明。' }}</p>
              </article>
            </div>
          </section>

          <div class="focus-summary">
            <span>{{ focusMode === 'overview' ? '当前模式：总览' : focusMode === 'chain' ? '当前模式：角色关系链' : '当前模式：组织成员网络' }}</span>
          </div>

          <section class="archive-section detail-connection-block">
            <div class="archive-section-head">
              <span class="archive-section-kicker">Key Links</span>
              <strong>重点关系对象</strong>
            </div>
            <div v-if="selectedNodeConnections.length > 0" class="detail-connection-list arc-scrollbar">
              <article v-for="edge in keyRelationshipCards.length ? keyRelationshipCards : selectedNodeConnections" :key="edge.id" class="connection-card">
                <div class="connection-head">
                  <span class="connection-type">{{ edge.label }}</span>
                  <span class="connection-peer">{{ resolveConnectedNodeLabel(edge) }}</span>
                </div>
                <div class="signature-meta compact">
                  <span>强度 {{ edge.intensity }}</span>
                  <strong>{{ resolveIntensityLabel(edge.intensity) }}</strong>
                </div>
                <p>{{ edge.description || '暂未补充这条关系的更多说明。' }}</p>
              </article>
            </div>
            <div v-else class="connection-empty">当前角色还没有录入直接关系。</div>
          </section>
        </template>
      </aside>
    </div>

    <div v-else class="graph-empty-state">
      <Network :size="20" />
      <strong>当前筛选下没有可展示的角色关系</strong>
      <p>可以清空搜索词，或者关闭“高强度关系”筛选后再查看整体角色网络。</p>
    </div>
  </section>
</template>

<style scoped>
.graph-shell {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.graph-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
  padding: 4px 2px 0;
}

.graph-kicker {
  display: inline-flex;
  margin-bottom: 8px;
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.graph-toolbar-copy h3 {
  margin: 0 0 8px;
  color: var(--arc-text-primary);
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.graph-toolbar-copy p {
  max-width: 44rem;
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.75;
}

.graph-toolbar-metrics {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.metric-pill {
  display: flex;
  min-width: 110px;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  padding: 13px 15px;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.035);
}

.metric-pill strong {
  color: var(--arc-text-primary);
  font-size: 20px;
  font-weight: 700;
  line-height: 1;
}

.metric-pill span {
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.filter-chip,
.query-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  padding: 9px 14px;
}

.filter-chip {
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  cursor: pointer;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease,
    background 0.18s ease;
}

.filter-chip.static {
  cursor: default;
}

.filter-chip:hover:not(.static) {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--arc-primary) 20%, var(--arc-border));
  color: var(--arc-primary);
}

.filter-chip.active {
  border-color: color-mix(in srgb, var(--arc-primary) 20%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 12%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

.filter-chip.accent.active {
  border-color: rgba(249, 115, 22, 0.3);
  background: color-mix(in srgb, #fb923c 12%, var(--arc-bg-mix));
  color: #c2410c;
}

.query-pill {
  border: 1px solid color-mix(in srgb, var(--arc-primary) 28%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

.organization-focus-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  padding: 14px 16px;
}

.organization-focus-copy {
  max-width: 34rem;
}

.organization-focus-kicker {
  display: inline-flex;
  margin-bottom: 6px;
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.organization-focus-copy p {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.75;
}

.organization-chip-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.organization-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font-size: 12px;
  font-weight: 700;
  padding: 8px 12px;
  cursor: pointer;
  transition:
    transform 0.16s ease,
    border-color 0.16s ease,
    background 0.16s ease,
    color 0.16s ease;
}

.organization-chip:hover {
  transform: translateY(-1px);
}

.organization-chip.active {
  border-color: color-mix(in srgb, var(--arc-primary) 22%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

.organization-chip-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.subgraph-toggle {
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font-size: 12px;
  font-weight: 700;
  padding: 8px 12px;
  cursor: pointer;
  transition:
    transform 0.16s ease,
    border-color 0.16s ease,
    background 0.16s ease,
    color 0.16s ease;
}

.subgraph-toggle:hover:not(:disabled) {
  transform: translateY(-1px);
}

.subgraph-toggle.active {
  border-color: rgba(16, 185, 129, 0.24);
  background: color-mix(in srgb, #10b981 10%, var(--arc-bg-mix));
  color: #0f766e;
}

.subgraph-toggle:disabled {
  opacity: 0.46;
  cursor: not-allowed;
}

.focus-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}

.focus-mode-group,
.hotspot-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.focus-mode-button,
.hotspot-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.focus-mode-button {
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  padding: 8px 12px;
  cursor: pointer;
  transition:
    transform 0.16s ease,
    border-color 0.16s ease,
    background 0.16s ease,
    color 0.16s ease;
}

.focus-mode-button:hover:not(:disabled) {
  transform: translateY(-1px);
}

.focus-mode-button:disabled {
  opacity: 0.44;
  cursor: not-allowed;
}

.focus-mode-button.active {
  border-color: color-mix(in srgb, var(--arc-primary) 22%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

.hotspot-label {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.hotspot-chip {
  border: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  padding: 8px 10px;
  cursor: pointer;
  transition:
    transform 0.16s ease,
    border-color 0.16s ease,
    background 0.16s ease,
    color 0.16s ease;
}

.hotspot-chip:hover {
  transform: translateY(-1px);
}

.hotspot-chip strong {
  color: var(--arc-text-primary);
  font-size: 11px;
  font-weight: 800;
}

.hotspot-chip.active {
  border-color: color-mix(in srgb, var(--arc-primary) 20%, var(--arc-border));
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-mix));
  color: var(--arc-primary);
}

.graph-body {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(280px, 0.72fr);
  gap: 16px;
}

.graph-stage,
.detail-card {
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  box-shadow: 0 18px 34px rgba(15, 23, 42, 0.05);
}

.graph-stage {
  overflow: hidden;
  padding: 18px;
  background: var(--arc-bg-surface);
}

.graph-canvas {
  width: 100%;
  height: 660px;
  border-radius: 10px;
  background: var(--arc-bg-body);
  box-shadow: inset 0 0 0 1px var(--arc-border);
}

.graph-legend {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  padding: 12px 4px 0;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.legend-dot {
  width: 12px;
  height: 12px;
  border-radius: 999px;
}

.legend-dot.character {
  background: #2563eb;
}

.legend-line {
  width: 22px;
  height: 2px;
  border-radius: 999px;
}

.legend-line.relationship {
  background: rgba(37, 99, 235, 0.56);
}

.legend-line.internal {
  background: linear-gradient(90deg, #fb923c 0%, #f97316 100%);
}

.detail-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  background: var(--arc-bg-surface);
}

.detail-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.detail-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  padding: 7px 10px;
}

.detail-action {
  border: 1px solid var(--arc-border);
  border-radius: 999px;
  background: var(--arc-bg-surface);
  color: var(--arc-text-secondary);
  font-size: 12px;
  font-weight: 700;
  padding: 8px 12px;
  cursor: pointer;
  transition:
    transform 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease,
    background 0.16s ease;
}

.detail-action:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--arc-primary) 22%, var(--arc-border));
  color: var(--arc-primary);
  background: color-mix(in srgb, var(--arc-primary) 8%, var(--arc-bg-mix));
}

.detail-card h4 {
  margin: 0;
  color: var(--arc-text-primary);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.profile-hero {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 14px;
  align-items: flex-start;
}

.profile-avatar {
  display: flex;
  width: 72px;
  height: 72px;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: white;
  box-shadow: 0 14px 26px rgba(15, 23, 42, 0.12);
}

.profile-avatar span {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.04em;
}

.profile-copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-subtitle {
  margin: -10px 0 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
}

.detail-description {
  margin: 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.75;
}

.affiliation-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.archive-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.archive-section-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.archive-section-kicker {
  color: var(--arc-text-hint);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.archive-section-head strong {
  color: var(--arc-text-primary);
  font-size: 14px;
  font-weight: 700;
}

.affiliation-label {
  color: var(--arc-text-hint);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.affiliation-chips {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.affiliation-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
  font-size: 11px;
  font-weight: 700;
  padding: 6px 10px;
}

.dossier-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.dossier-card {
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  padding: 14px;
}

.dossier-card.primary {
  background: color-mix(in srgb, var(--arc-primary) 5%, var(--arc-bg-surface));
}

.dossier-label {
  display: inline-flex;
  margin-bottom: 8px;
  color: var(--arc-text-hint);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.dossier-card strong {
  display: block;
  color: var(--arc-text-primary);
  font-size: 20px;
  font-weight: 700;
}

.dossier-card small {
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.camp-summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.camp-summary-card {
  border: 1px solid color-mix(in srgb, var(--arc-primary) 28%, var(--arc-border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--arc-primary) 6%, var(--arc-bg-surface));
  padding: 14px;
}

.camp-summary-card strong {
  display: block;
  color: var(--arc-text-primary);
  font-size: 20px;
  font-weight: 700;
}

.camp-summary-card span {
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.signature-card {
  border: 1px solid color-mix(in srgb, var(--arc-primary) 28%, var(--arc-border));
  border-radius: 10px;
  background: color-mix(in srgb, var(--arc-primary) 4%, var(--arc-bg-surface));
  padding: 14px;
}

.signature-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.signature-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
  color: var(--arc-text-hint);
  font-size: 12px;
}

.signature-meta strong {
  color: var(--arc-text-primary);
  font-size: 12px;
  font-weight: 800;
}

.signature-meta.compact {
  margin-top: 8px;
}

.signature-card p {
  margin: 10px 0 0;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.75;
}

.focus-summary {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
  font-size: 12px;
  font-weight: 700;
  padding: 8px 12px;
}

.detail-connection-block {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 12px;
}

.detail-connection-block > strong {
  color: var(--arc-text-primary);
  font-size: 13px;
}

.detail-connection-list {
  display: flex;
  max-height: 300px;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  padding-right: 4px;
}

.relation-card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.connection-card {
  border: 1px solid var(--arc-border);
  border-radius: 8px;
  background: var(--arc-bg-surface);
  padding: 12px 13px;
  transition:
    transform 0.16s ease,
    border-color 0.16s ease,
    box-shadow 0.16s ease;
}

.connection-card:hover {
  transform: translateY(-1px);
  border-color: rgba(59, 130, 246, 0.18);
  box-shadow: 0 10px 18px rgba(15, 23, 42, 0.04);
}

.connection-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.connection-type {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--arc-primary) 12%, var(--arc-bg-mix));
  color: var(--arc-primary);
  font-size: 11px;
  font-weight: 800;
  padding: 5px 8px;
}

.connection-peer {
  color: var(--arc-text-primary);
  font-size: 12px;
  font-weight: 700;
}

.connection-card p {
  margin: 10px 0 0;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.7;
}

.connection-card.compact p {
  margin-top: 8px;
}

.connection-empty,
.graph-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px dashed var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-weak);
  color: var(--arc-text-secondary);
  text-align: center;
  padding: 26px;
}

.connection-empty {
  min-height: 110px;
}

.graph-empty-state strong {
  color: var(--arc-text-primary);
  font-size: 15px;
}

.graph-empty-state p {
  max-width: 28rem;
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
}

@media (max-width: 1180px) {
  .graph-body {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .graph-canvas {
    height: 540px;
  }

  .dossier-grid,
  .camp-summary-grid {
    grid-template-columns: 1fr;
  }

  .profile-hero {
    grid-template-columns: 1fr;
  }
}
</style>
