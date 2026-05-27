# 诊断报告 Schema

## 问题分类体系

### 类别1：风格偏移 (style_violations)

| 子类 | 严重性 | 检测方法 |
|------|--------|----------|
| POV视角越界 | critical | 检查是否出现当前POV角色不可知的信息 |
| 句式比例失衡 | major | 统计长/中/短句占比与指纹对比 |
| 对话占比异常 | major | 统计对话字数/总字数 |
| 签名词汇缺失 | minor | 检查指纹高频词是否出现 |
| 禁用词汇出现 | major | 扫描黑名单词汇 |
| 开场/结尾模式错误 | major | 对比指纹定义的模式 |

### 类别2：剧情一致性 (plot_consistency_issues)

| 子类 | 严重性 | 检测方法 |
|------|--------|----------|
| 时间线矛盾 | critical | 对比前后章时间标记 |
| 设定冲突 | critical | 对比 established_rules |
| 道具凭空出现 | major | 对比 inventory |
| 地理错误 | minor | 对比地图/位置设定 |

### 类别3：角色一致性 (character_ooc_issues)

| 子类 | 严重性 | 检测方法 |
|------|--------|----------|
| 性格OOC | major | 对比角色档案性格设定 |
| 对话风格不符 | major | 对比 voice_matrix |
| 能力超限 | critical | 对比 power_level |

### 类别4：AI写作痕迹 (ai_artifacts)

| 子类 | 严重性 | 典型表现 |
|------|--------|----------|
| 说明文腔调 | major | "值得注意的是"/"首先其次最后" |
| 机械转场 | minor | "与此同时"/"另一边" |
| 过度阐释 | major | 行为后立即解释动机 |
| 情绪贴标签 | major | "他很愤怒"/"她感到恐惧" |

### 类别5：文学质量 (literary_quality_issues)

| 子类 | 严重性 | 检测方法 |
|------|--------|----------|
| 节奏单调 | minor | 句式长度变化幅度 |
| 感官描写缺失 | minor | 感官类型覆盖度 |
| 对话千篇一律 | minor | 对话标签多样性 |
| 意象重复 | minor | 同一词汇出现频次 |

## 严重性判定标准

- **critical**: 破坏叙事逻辑/世界观/角色核心，必须立即修复
- **major**: 影响阅读体验/风格一致性，应当修复
- **minor**: 可优化但不影响理解，建议修复

## 重写强度判定

- **complete_rewrite**: critical≥3 或 major≥5
- **partial_rewrite**: critical 1-2 或 major 3-4
- **polish_only**: 仅 minor 问题
