# CharacterArc AI 管线架构优化方案

## 现状分析

### 当前架构的核心问题

1. **无状态调用** — 每次 AI 调用都是独立的，不知道前文发生了什么
2. **检索太粗糙** — 纯关键词 token 重叠评分，无语义理解能力
3. **无质量闭环** — 生成即结束，没有自动一致性检查
4. **Skill 只是文本注入** — 告诉 AI "怎么写"，但不告诉它"当前世界是什么状态"

### 当前技术栈

| 组件 | 现状 |
|------|------|
| 存储 | SQLite (`workspace.db`)，18张表 |
| 知识检索 | `knowledge-retrieval.ts`，token 重叠评分，top 5 |
| AI 管线 | 单次调用 / Agent Loop（仅 outline-batch、reference-deep-analyze） |
| 状态管理 | Pinia 全量内存 → debounce 写回 SQLite |
| 向量搜索 | 无 |

---

## 目标架构：B + A + C 混合

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户操作层                                 │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                    执行层（A：状态流水线）                         │
│                                                                  │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐    │
│  │ 风格指纹  │ → │ 融合指南  │ → │ 叙事蓝图  │ → │ 章节执行  │←┐ │
│  └──────────┘   └──────────┘   └──────────┘   └────┬─────┘  │ │
│                                                      │        │ │
│                                              state_delta      │ │
│                                                      │        │ │
│                                                      ▼        │ │
│                                               ┌──────────┐   │ │
│                                               │ 续写循环  │───┘ │
│                                               └──────────┘     │
└──────────────────────────────┬──────────────────────────────────┘
                               │ 读/写
┌──────────────────────────────▼──────────────────────────────────┐
│                    底座层（B：混合状态库）                         │
│                                                                  │
│  ┌─────────────────────────┐   ┌─────────────────────────────┐ │
│  │   结构化状态（SQLite）    │   │   向量索引（本地 Embedding）  │ │
│  │                          │   │                              │ │
│  │  • characters_state      │   │  • 前文章节片段 embedding    │ │
│  │  • foreshadowing_ledger  │   │  • 风格样本 embedding        │ │
│  │  • relationships         │   │  • 知识文档 embedding        │ │
│  │  • timeline              │   │  • 细纲/beat embedding       │ │
│  │  • world_rules           │   │                              │ │
│  │  • power_levels          │   │  检索方式：cosine similarity │ │
│  │                          │   │  模型：bge-small-zh / API    │ │
│  │  检索方式：精确查询       │   │                              │ │
│  └─────────────────────────┘   └─────────────────────────────┘ │
└──────────────────────────────┬──────────────────────────────────┘
                               │ 定期触发
┌──────────────────────────────▼──────────────────────────────────┐
│                    质控层（C：审核 Agent）                        │
│                                                                  │
│  ┌──────────────────┐   ┌──────────────────────────────────┐   │
│  │ 写后即时轻检      │   │ 定期深度审计（每 50 章）          │   │
│  │ （规则引擎，无LLM）│   │ （LLM 驱动）                     │   │
│  │                   │   │                                   │   │
│  │ • 角色位置一致性   │   │ • 伏笔积压检查                   │   │
│  │ • 物品持有验证     │   │ • 角色出场频率                   │   │
│  │ • 时间线连续性     │   │ • 主题偏离检测                   │   │
│  │ • 世界规则违反     │   │ • 节奏疲劳诊断                   │   │
│  │                   │   │ • 设定矛盾扫描                   │   │
│  └──────────────────┘   └──────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 第一阶段：结构化状态库（SQLite 扩展）

### 新增表结构

在现有 `workspace.db` 中新增以下表：

```sql
-- 角色实时状态（每章更新）
CREATE TABLE story_character_state (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  chapter_index INTEGER NOT NULL,        -- 状态对应的章节
  location TEXT DEFAULT '',               -- 当前位置
  physical_state TEXT DEFAULT '正常',     -- 物理状态
  mental_state TEXT DEFAULT '',           -- 心理状态
  arc_stage TEXT DEFAULT '',              -- 成长阶段
  power_level TEXT DEFAULT '',            -- 能力等级
  knowledge_json TEXT DEFAULT '[]',       -- 已知信息 JSON array
  inventory_json TEXT DEFAULT '[]',       -- 持有物品 JSON array
  goals_json TEXT DEFAULT '[]',           -- 当前目标 JSON array
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, character_id, chapter_index)
);

-- 伏笔登记簿
CREATE TABLE story_foreshadowing (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  foreshadowing_id TEXT NOT NULL,         -- 如 fsd_001
  type TEXT NOT NULL,                     -- 明线/暗线/元伏笔
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active/advanced/resolved/abandoned
  planted_chapter INTEGER NOT NULL,
  planted_method TEXT DEFAULT '',
  payoff_chapter INTEGER,                 -- 预定揭示章节
  resolved_chapter INTEGER,               -- 实际揭示章节
  clues_json TEXT DEFAULT '[]',           -- [{chapter, clue, method}]
  connections_json TEXT DEFAULT '[]',     -- 关联伏笔 ID
  updated_at TEXT NOT NULL
);

-- 关系网络
CREATE TABLE story_relationships (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,          -- 如 rel_001
  participant_a TEXT NOT NULL,            -- character_id
  participant_b TEXT NOT NULL,
  current_status TEXT NOT NULL,
  tension_points_json TEXT DEFAULT '[]',
  trajectory TEXT DEFAULT '',             -- 预定发展方向
  last_interaction_chapter INTEGER,
  updated_at TEXT NOT NULL
);

-- 时间线
CREATE TABLE story_timeline (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  chapter_index INTEGER NOT NULL,
  story_date TEXT DEFAULT '',             -- 故事内时间
  events_json TEXT DEFAULT '[]',          -- 本章发生的事件
  world_state_changes_json TEXT DEFAULT '[]',
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, chapter_index)
);

-- 世界规则
CREATE TABLE story_world_rules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  rule_content TEXT NOT NULL,
  established_chapter INTEGER NOT NULL,
  exceptions_json TEXT DEFAULT '[]',
  must_comply BOOLEAN DEFAULT 1,
  updated_at TEXT NOT NULL
);

-- 倒计时/悬念时钟
CREATE TABLE story_countdown_clocks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  clock_id TEXT NOT NULL,
  event_description TEXT NOT NULL,
  deadline_chapter INTEGER,               -- 截止章节
  status TEXT DEFAULT 'active',           -- active/expired/resolved
  urgency TEXT DEFAULT 'medium',
  updated_at TEXT NOT NULL
);
```

### 状态读写 API

```typescript
// electron/main/story-state-store.ts

interface StoryStateStore {
  // 写入（章节生成后调用）
  applyStateDelta(projectId: string, chapterIndex: number, delta: StateDelta): void

  // 读取（章节生成前调用）
  getActiveCharacterStates(projectId: string, characterIds: string[]): CharacterState[]
  getActiveForeshadowing(projectId: string, options?: { limit?: number }): Foreshadowing[]
  getRelationships(projectId: string, characterIds: string[]): Relationship[]
  getRecentTimeline(projectId: string, lastN: number): TimelineEntry[]
  getWorldRules(projectId: string): WorldRule[]
  getActiveClocks(projectId: string): CountdownClock[]

  // 查询
  getForeshadowingHealth(projectId: string): ForeshadowingHealthReport
  getCharacterAbsence(projectId: string, thresholdChapters: number): AbsentCharacter[]
}
```

### StateDelta 结构（LLM 输出 → 程序解析 → 写入数据库）

```typescript
interface StateDelta {
  characters_updated: Array<{
    character_id: string
    changes: {
      location?: { from: string; to: string }
      physical_state?: string
      mental_state?: string
      arc_progression?: string
      inventory_delta?: { added: string[]; removed: string[] }
      new_knowledge?: string[]
      goals_update?: { completed: string[]; added: string[] }
    }
  }>
  relationships_delta: Array<{
    relationship_id: string
    status_change?: { from: string; to: string; pivot_event: string }
    new_tension_points?: string[]
  }>
  foreshadowing_delta: {
    planted: Array<{ id: string; type: string; description: string; method: string; payoff_chapter?: number }>
    advanced: Array<{ id: string; clue: string; method: string }>
    resolved: Array<{ id: string; method: string; impact: string }>
  }
  timeline: {
    story_time_elapsed: string
    current_story_date: string
    events: string[]
  }
}
```

---

## 第二阶段：向量索引（语义检索）

### 技术选型

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **sqlite-vec** | 与现有 SQLite 无缝集成，零额外依赖 | 功能较基础 | 首选 |
| hnswlib-node | 性能好，纯本地 | 额外依赖，需要单独管理索引文件 | 备选 |
| lancedb | 功能丰富 | 体积大，Electron 打包复杂 | 不推荐 |

### Embedding 模型选型

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **调用用户已配置的 AI API** | 零额外配置，质量高 | 依赖网络，有成本 | 首选 |
| 本地 ONNX (bge-small-zh) | 离线可用，免费 | 打包体积+50MB，首次加载慢 | 备选 |

### 向量化内容

| 内容类型 | 触发时机 | 用途 |
|----------|----------|------|
| 章节片段（每章拆 3-5 段） | 章节保存时 | 写新章节时检索相关前文 |
| 角色描写片段 | 角色出场时提取 | 保持角色描写一致性 |
| 伏笔上下文 | 伏笔植入/推进时 | 回收伏笔时找到原始语境 |
| 知识文档 | 文档创建/更新时 | 替代当前的 token 重叠检索 |

### 新增表

```sql
-- 向量索引表（配合 sqlite-vec 扩展）
CREATE TABLE story_embeddings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_type TEXT NOT NULL,    -- chapter_segment/character_desc/foreshadowing_ctx/knowledge
  source_id TEXT NOT NULL,      -- 关联的原始记录 ID
  chapter_index INTEGER,        -- 所属章节（可选）
  text_content TEXT NOT NULL,   -- 原始文本（用于展示）
  embedding BLOB NOT NULL,      -- float32 向量
  created_at TEXT NOT NULL
);

-- sqlite-vec 虚拟表（用于 ANN 搜索）
CREATE VIRTUAL TABLE story_embeddings_vec USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[512]          -- 维度取决于模型
);
```

### 检索流程改造

```typescript
// electron/main/knowledge-retrieval-v2.ts

async function retrieveContextForChapter(
  projectId: string,
  chapterOutline: ChapterOutline
): Promise<RetrievalResult> {

  // 1. 精确查询：从结构化状态库拉取
  const involvedCharacters = extractCharacterIds(chapterOutline)
  const characterStates = storyStateStore.getActiveCharacterStates(projectId, involvedCharacters)
  const relationships = storyStateStore.getRelationships(projectId, involvedCharacters)
  const activeForeshadowing = storyStateStore.getActiveForeshadowing(projectId, { limit: 20 })
  const recentTimeline = storyStateStore.getRecentTimeline(projectId, 5)
  const worldRules = storyStateStore.getWorldRules(projectId)
  const clocks = storyStateStore.getActiveClocks(projectId)

  // 2. 语义查询：从向量库拉取相关前文
  const queryText = buildQueryFromOutline(chapterOutline)
  const queryEmbedding = await embedText(queryText)
  const relevantSegments = await vectorSearch(projectId, queryEmbedding, {
    sourceTypes: ['chapter_segment', 'foreshadowing_ctx'],
    topK: 8,
    minScore: 0.72
  })

  // 3. 组装上下文
  return {
    structuredState: formatStructuredState({
      characterStates, relationships, activeForeshadowing,
      recentTimeline, worldRules, clocks
    }),
    relevantPriorText: formatRelevantSegments(relevantSegments),
    totalTokenEstimate: estimateTokens(...)
  }
}
```

---

## 第三阶段：状态流水线（执行层改造）

### 章节生成流程改造

```
当前流程：
  buildPrompt() → requestAI() → normalize() → 返回结果

改造后流程：
  retrieveContext() → buildPrompt(含状态) → requestAI() → normalize()
       → extractStateDelta() → validateDelta() → applyDelta() → embedChapter()
       → runLightCheck() → 返回结果
```

### Task Handler 改造点

`chapter-first-draft` 的 prompt 中注入结构化状态：

```typescript
buildPrompt(input: PromptBuildInput) {
  const { context, capabilityPreamble, skillsBlock } = input
  const storyState = context.storyState as RetrievalResult  // 新增

  return {
    system: `${capabilityPreamble.system}...`,
    user: `...
## 当前世界状态（精确数据，必须遵守）

${storyState.structuredState}

## 相关前文片段（语义检索结果，供参考）

${storyState.relevantPriorText}

## 本章细纲

${context.outline}

## 输出要求

1. 正文内容（Markdown）
2. 状态变更报告（YAML，以 state_delta: 开头）
   必须报告：角色位置变化、物品增减、新获知信息、伏笔植入/推进/回收、时间推进
`
  }
}
```

### StateDelta 提取与验证

```typescript
// electron/main/ai/state-delta-extractor.ts

function extractAndValidateStateDelta(
  aiOutput: string,
  currentState: RetrievalResult
): { delta: StateDelta; warnings: string[] } {

  // 1. 从 AI 输出中提取 YAML 部分
  const yamlBlock = extractYamlBlock(aiOutput, 'state_delta')
  const delta = parseStateDelta(yamlBlock)

  // 2. 交叉验证
  const warnings: string[] = []

  // 检查：正文提到角色使用物品，但 delta 没报告 inventory 变化
  const mentionedItems = scanForItemUsage(aiOutput)
  for (const item of mentionedItems) {
    if (!delta.characters_updated.some(c =>
      c.changes.inventory_delta?.removed?.includes(item)
    )) {
      warnings.push(`正文提到使用「${item}」但 state_delta 未报告物品消耗`)
    }
  }

  // 检查：角色在 currentState 中标记为"昏迷"但正文中有对话
  for (const char of delta.characters_updated) {
    const current = currentState.characterStates.find(c => c.id === char.character_id)
    if (current?.physical_state?.includes('昏迷') && !char.changes.physical_state) {
      warnings.push(`角色 ${char.character_id} 当前状态为昏迷，但未报告状态恢复`)
    }
  }

  return { delta, warnings }
}
```

---

## 第四阶段：审核 Agent（质量控制）

### 写后即时轻检（规则引擎，不调用 LLM）

```typescript
// electron/main/ai/audit/light-check.ts

interface LightCheckResult {
  passed: boolean
  violations: Array<{
    type: 'location_mismatch' | 'item_not_owned' | 'timeline_break' | 'rule_violation'
    severity: 'error' | 'warning'
    message: string
    evidence: string
  }>
}

function runLightCheck(
  chapterContent: string,
  stateBefore: RetrievalResult,
  stateDelta: StateDelta
): LightCheckResult {
  const violations = []

  // 1. 角色位置一致性
  // 如果正文提到角色A在地点X，但状态库显示A在地点Y且 delta 没有位移记录
  // → 标记 location_mismatch

  // 2. 物品持有验证
  // 如果正文中角色使用了某物品，但 inventory 中没有该物品
  // → 标记 item_not_owned

  // 3. 时间线连续性
  // 如果上章结尾是"清晨"，本章开头是"三天后"但 delta 只报告了几小时
  // → 标记 timeline_break

  // 4. 世界规则违反
  // 如果世界规则说"禁地无法传送"，但正文出现传送行为
  // → 标记 rule_violation

  return { passed: violations.length === 0, violations }
}
```

### 定期深度审计（LLM 驱动，每 50 章触发）

```typescript
// electron/main/ai/audit/deep-audit.ts

interface DeepAuditReport {
  foreshadowing_health: {
    total_active: number
    overdue: Array<{ id: string; planted_chapter: number; expected_payoff: number }>
    density_warning: boolean  // 未解伏笔 > 当前章节数/5
  }
  character_absence: Array<{
    character_id: string
    last_seen_chapter: number
    chapters_absent: number
  }>
  pacing_assessment: {
    monotony_detected: boolean  // 连续30章紧张度无变化
    suggested_relief_point: number | null
  }
  theme_drift: {
    core_themes: string[]
    last_touched_chapter: Record<string, number>
    neglected_themes: string[]  // 超过100章未触及
  }
  consistency_issues: string[]  // LLM 发现的设定矛盾
}
```

深度审计的触发方式：
- 自动：每写完 50 章触发一次
- 手动：用户在知识中心点击"一致性审计"按钮
- 输出：生成一份审计报告存入 knowledge_documents，供后续写作参考

---

## 实施路线图

### Phase 1（2-3周）：结构化状态库

**目标**：让 AI 写章节时能读到精确的世界状态

| 步骤 | 工作内容 | 改动范围 |
|------|----------|----------|
| 1.1 | 新增 SQLite 表 + 迁移逻辑 | workspace-store.ts |
| 1.2 | 实现 StoryStateStore API | 新文件 story-state-store.ts |
| 1.3 | 改造 chapter-first-draft prompt，注入状态 | tasks/chapter-first-draft.ts |
| 1.4 | 实现 StateDelta 提取器 | 新文件 state-delta-extractor.ts |
| 1.5 | 章节生成后自动 applyDelta | runtime/orchestrator.ts |
| 1.6 | 前端：状态面板 UI（查看/手动修正） | 新组件 StoryStatePanel.vue |

### Phase 2（2-3周）：向量索引

**目标**：语义检索替代关键词匹配

| 步骤 | 工作内容 | 改动范围 |
|------|----------|----------|
| 2.1 | 集成 sqlite-vec 或选定向量方案 | 依赖 + workspace-store.ts |
| 2.2 | 实现 embedding 调用（复用用户 AI API） | 新文件 embedding-service.ts |
| 2.3 | 章节保存时自动分段 + embedding | 章节保存流程 |
| 2.4 | 改造 knowledge-retrieval.ts → v2 混合检索 | knowledge-retrieval.ts |
| 2.5 | 知识文档创建时自动 embedding | knowledge-tools.ts |

### Phase 3（1-2周）：写后轻检

**目标**：自动发现明显的一致性错误

| 步骤 | 工作内容 | 改动范围 |
|------|----------|----------|
| 3.1 | 实现规则引擎 light-check | 新文件 audit/light-check.ts |
| 3.2 | 集成到章节生成流程末尾 | orchestrator.ts |
| 3.3 | 前端：违规提示 UI | 章节编辑器组件 |
| 3.4 | 用户可选择"自动修复"（调用 chapter-repair） | 交互流程 |

### Phase 4（1-2周）：深度审计

**目标**：定期全局一致性检查

| 步骤 | 工作内容 | 改动范围 |
|------|----------|----------|
| 4.1 | 实现深度审计 Agent task | 新 task handler |
| 4.2 | 审计报告生成 + 存入知识库 | knowledge-tools.ts |
| 4.3 | 前端：审计触发按钮 + 报告展示 | KnowledgeCenterPanel.vue |
| 4.4 | 自动触发逻辑（每 50 章） | orchestrator.ts |

---

## 风险与缓解

| 风险 | 影响 | 缓解方案 |
|------|------|----------|
| StateDelta 提取不准确 | 状态库漂移 | 交叉验证 + 用户确认机制 + 手动修正 UI |
| Embedding API 调用成本 | 用户费用增加 | 本地缓存 + 增量更新 + 可选关闭 |
| sqlite-vec 与 Electron 打包兼容性 | 构建失败 | 备选方案：纯 JS 实现的 hnswlib |
| 状态注入导致 prompt 过长 | token 超限 | 动态裁剪：只注入涉及角色的状态 |
| 轻检误报率高 | 用户烦躁 | 初期只报 error 级别，warning 静默记录 |

---

## 关键设计决策

1. **状态的 source of truth 是数据库，不是 LLM 记忆** — LM 只负责"读状态 → 写正文 → 报告变更"
2. **向量索引是补充，不是替代** — 精确查询走 SQL，模糊查询走向量，两者合并注入
3. **轻检不用 LLM** — 规则引擎即时执行，零成本，零延迟
4. **深度审计低频触发** — 每 50 章一次，成本可控
5. **所有新功能可选关闭** — 用户可以退回到纯 skill 注入模式，不强制升级
6. **增量实施** — 每个 Phase 独立可用，不需要全部完成才能获得收益
