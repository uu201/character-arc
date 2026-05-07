# CharacterArc 第一阶段进度与后续计划

- 版本：`v0.3`
- 日期：`2026-05-07`
- 适用范围：CharacterArc 当前分支的第一阶段开发
- 当前目标：收口“知识上下文底座 + AI 运行可观察性”第一阶段，并为下一阶段做明确分界

---

## 0. 2026-05-07 补记

1. 助手面板的轻量运行记录列表已补齐，不再作为第一阶段待办。
2. 下一步实际开发目标调整为：`知识库中心页面 + 知识去重/冲突检测`。

---

## 一、这份计划替代什么

这份文件用于替代此前偏“总规划”或“流程重构预案”的旧计划文档，改为反映**当前实际代码进度**的执行计划。

当前不再继续讨论“大而全的一次性改造”，而是按已经确定的阶段边界推进：

1. 项目级知识文档
2. 本地规则检索
3. AI 运行记录 / 可观察性

未进入本阶段的能力，继续后置，不混做。

---

## 二、第一阶段范围确认

### 本阶段已纳入

1. 项目级 `knowledgeDocuments` 持久化
2. 参考资料导入后生成知识文档
3. 基于规则的本地知识召回
4. 章节助理 / 章节初稿的检索增强
5. `aiRuns` 运行记录结构
6. AI 助手面板中的最小可观察性展示

### 本阶段明确不做

1. embedding / 向量检索 / rerank
2. 项目记忆自动抽取
3. 连续性 / 吃书校验
4. 章节评审流水线
5. 结构化学习资产
6. Skill 资产系统升级
7. 独立知识库中心页面

---

## 三、当前实际完成情况

## 3.1 已完成的底座能力

### 1. 工作区数据结构已补齐

已完成：

- `KnowledgeDocument`
- `AiRunKnowledgeItem`
- `AiRunRecord`
- `ProjectWorkspaceData` 扩展

涉及文件：

- [renderer/src/types/app.ts](../renderer/src/types/app.ts)
- [renderer/src/features/workspace/projectWorkspace.ts](../renderer/src/features/workspace/projectWorkspace.ts)
- [renderer/src/features/workspace/storeHelpers.ts](../renderer/src/features/workspace/storeHelpers.ts)

### 2. SQLite 持久化闭环已完成

已完成：

- `knowledge_documents` 表
- `ai_runs` 表
- 工作区快照读写接线
- normalize / serialize 链路接线

涉及文件：

- [electron/main/index.ts](../electron/main/index.ts)
- [renderer/src/stores/app.ts](../renderer/src/stores/app.ts)

### 3. 参考资料导入 → 知识文档生成已完成

已完成：

- 复用参考作品分析链
- 导入成功后生成 `knowledgeDocuments`
- 写回当前项目 workspace

涉及文件：

- [electron/main/referenceAnalysis.ts](../electron/main/referenceAnalysis.ts)
- [electron/main/index.ts](../electron/main/index.ts)
- [renderer/src/components/NovelWorkflowPanel.vue](../renderer/src/components/NovelWorkflowPanel.vue)

### 4. 检索增强主链路已完成

已完成：

- main 进程本地规则检索
- 仅对 `chapter-assistant` / `chapter-first-draft` 生效
- prompt 注入“检索到的参考知识”区块

涉及文件：

- [electron/main/index.ts](../electron/main/index.ts)
- [electron/main/ai.ts](../electron/main/ai.ts)
- [electron/main/aiPrompts.ts](../electron/main/aiPrompts.ts)

### 5. AI 运行记录链路已完成

已完成：

- AI 成功 / 失败 / 取消状态生成 meta
- main 进程广播 ai-run event
- renderer store 接收并写入 `aiRuns`
- 助手面板显示最近一次运行状态、模型、耗时、命中知识

涉及文件：

- [electron/main/ai.ts](../electron/main/ai.ts)
- [electron/main/index.ts](../electron/main/index.ts)
- [electron/preload/index.ts](../electron/preload/index.ts)
- [renderer/src/env.d.ts](../renderer/src/env.d.ts)
- [renderer/src/stores/app.ts](../renderer/src/stores/app.ts)
- [renderer/src/components/AiAssistantPanel.vue](../renderer/src/components/AiAssistantPanel.vue)
- [renderer/src/components/AiAssistantPanel.css](../renderer/src/components/AiAssistantPanel.css)

### 6. 构建检查已通过

已验证：

- `npm run build`

说明：

- 当前代码已通过 `vue-tsc --noEmit` 和构建流程。

---

## 四、当前阶段还没收口的部分

这些不再算“大功能未做”，而是第一阶段的验收与修边：

### 1. 手动联调验证

必须补做：

1. 导入一份参考资料
2. 确认 `knowledgeDocuments` 已生成
3. 在章节助理中发起一次明显相关的提问
4. 确认 AI 助手面板出现命中的知识片段
5. 再测试章节初稿生成链路
6. 测试失败 / 中断时 `aiRuns` 状态是否正确

### 2. 持久化回归验证

必须补做：

1. 保存工作区
2. 重启应用
3. 检查 `knowledgeDocuments` 未丢失
4. 检查 `aiRuns` 未丢失

### 3. UI 细节校正

可按实际结果决定是否继续微调：

- 命中知识片段的展示密度
- 长 snippet 的截断方式
- 无命中时的提示文案
- 助手面板在深色模式下的可读性复检

---

## 五、建议的下一步执行顺序

### Step 1：先做联调验收

只验证，不扩功能。

目标：

- 证明“导入 → 入库 → 检索 → 注入 prompt → 事件记录 → UI 展示”整条链可用。

### Step 2：修第一轮联调暴露的问题

只修真实问题，例如：

- 检索命中率偏差
- 命中条数过多或过少
- 持久化遗漏
- UI 显示异常

### Step 3：决定是否补一个轻量运行记录列表

这是**可选的第一阶段补充项**。

可以做：

- 最近 10 次 AI 运行记录
- 只显示任务、状态、时间、命中知识数

如果不做，也不影响第一阶段闭环。

---

## 六、第一阶段完成标准

满足以下条件即可认为第一阶段完成：

1. 参考资料导入后能稳定生成知识文档
2. 章节助理能稳定召回并使用知识文档
3. 章节初稿链路能稳定召回并使用知识文档
4. AI 成功 / 失败 / 取消都能留下运行记录
5. 助手面板能看到最近一次运行的最小可观察性信息
6. 重启应用后 `knowledgeDocuments` / `aiRuns` 不丢失
7. 构建检查持续通过

---

## 七、第二阶段候选方向（现在先不做）

第一阶段收口后，再从下面几项里选一条继续：

### 方向 A：项目记忆层

目标：

- 从章节、设定、流程文档中沉淀项目事实
- 区分“长期设定”和“阶段性事实”

### 方向 B：连续性 / 吃书校验

目标：

- 在章节生成后做角色、设定、时间线一致性检查

### 方向 C：章节评审流水线

目标：

- 把“初稿 → 分析 → 修订建议”做成可追踪链路

### 方向 D：知识库升级

目标：

- 从规则检索升级到 FTS / embedding / rerank

### 方向 E：知识库中心页面

目标：

- 独立浏览、筛选、去重和核对项目知识文档
- 处理完全重复内容与同名冲突内容
- 为后续项目记忆层打好治理入口

---

## 八、当前结论

当前分支最重要的事情已经不是继续铺新能力，而是：

**把第一阶段做实、做稳、做可验证。**

只要联调和持久化回归通过，这一阶段就可以收口，再决定是否进入“项目记忆”还是“连续性校验”。
