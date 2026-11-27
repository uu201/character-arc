# Distilled Novel Toolbox — 网文写作技能库

一套面向网络小说作者的**全链路创作知识库**。覆盖从构思、写作、润色到发布的全流程，每个模块包含核心方法论（SKILL.md）和深度参考文档（references/）。

> **v2.0** — `novel-anti-detection` 与 `novel-polishing` 已升级为可执行级去AI腔操作体系。详见 [CHANGELOG](./CHANGELOG.md)。

---

## 用自然语言触发

需要什么，直接说。以下是你可能会说的——每个说法对应一个模块。

### 🛡️ 反AI检测 · novel-anti-detection [v2.0]

> "AI 写的文怎么才能不被检测出来？"
> "平台现在对 AI 写作是什么政策？"
> "怎么设计 AI + 人工混合创作的流程？"
> "AIGC 检测的原理是什么？"
> "AI 文本有哪些特征模式？怎么避免误判人类写作？"

### 👤 人设与群像 · novel-character-design

> "帮我设计一个主角性格。"
> "配角怎么写才不工具人？"
> "反派怎么塑造才更有魅力？"
> "人物关系怎么设计？人物弧光怎么规划？"

### 💰 商业化与平台 · novel-commercialization

> "起点和番茄有什么区别？我应该选哪个？"
> "飞卢的风格是什么样的？"
> "网文怎么变现？签约要注意什么？"
> "付费平台和免费平台的核心区别是什么？"

### ⚠️ 合规与敏感词 · novel-compliance

> "平台审核都查什么？"
> "敏感词怎么规避？"
> "色情/暴力描写到什么程度算违规？"
> "2026 年 AI 写作的法规要求是什么？"

### 💔 情绪与代入感 · novel-emotion

> "怎么让读者有代入感？"
> "催泪/共情的桥段怎么设计？"
> "怎么控制读者的期待感？"
> "AI 写的文没有情绪褶皱，怎么办？"

### 📚 题材与融合 · novel-genres

> "玄幻和仙侠有什么区别？"
> "我想把科幻和修仙融合，能行吗？"
> "悬疑灵异题材的写作模板是什么？"
> "当前市场什么题材最火？"

### 💡 创新与反套路 · novel-innovation

> "套路都用烂了，怎么写出新意？"
> "有没有反套路的写法可以参考？"
> "2026 年网文趋势是什么？"
> "AI 辅助写作有哪些常见陷阱？"

### ✍️ 语言与文风 · novel-language-style

> "怎么确定自己的文风？"
> "叙述视角怎么选择？"
> "怎么写出画面感？"
> "玩梗怎么玩才不生硬？"

### ⏱️ 节奏与结构 · novel-pacing

> "开头怎么写才能抓住人？"
> "断章怎么断才让读者追更？"
> "高潮怎么编排？节奏拖沓怎么办？"
> "黄金三章具体该怎么写？"

### 🔥 爽点与疲劳管理 · novel-pleasure-points

> "爽点怎么设计才够爽？"
> "扮猪吃虎的模板是什么？"
> "装逼打脸的桥段怎么写不腻？"
> "爽点太密会审美疲劳吗？怎么控制密度？"

### 🧹 润色与去AI味 · novel-polishing [v2.0]

> "AI 写的文怎么改才像人写的？"
> "对话太生硬了，怎么润色？"
> "怎么注入个人风格？"
> "有没有具体的润色指令模板？"
> "怎么给 AI 写去 AI 腔的 prompt？评分标准是什么？"

### 🛠️ 工具与工作流 · novel-tools

> "DeepSeek / ChatGPT / Claude 写网文哪个好？"
> "提示词怎么写才有效？"
> "完整的写作工作流是什么？"
> "发布后的数据怎么看？"

### 🌍 世界观与设定 · novel-worldbuilding

> "修仙体系怎么设计？"
> "地图和势力格局怎么规划？"
> "经济体系怎么建？"
> "前后设定矛盾了怎么办？"

---

## 使用流程

### 短篇创作流程（盐言/番茄短篇/故事会）

适用于 8,000–20,000 字的短篇小说。核心是**情绪驱动 + 一个反转撑全文**。

```
情绪定调 → 核心框架 → 分段写作 → 精修打磨
```

| 阶段 | 做什么 | 调用的模块 |
|------|--------|-----------|
| **① 情绪定调** | 确定想让读者体验什么情绪（意难平/爽/治愈/细思极恐） | novel-emotion |
| **② 核心框架** | 一句话梗概 + 核心反转 + 情绪曲线 + 人设速写 | novel-innovation, novel-character-design |
| **③ 分段写作** | 开头（300字抓人）→ 铺垫（30%）→ 升级（20%）→ 反转（15%）→ 结尾（10%） | novel-pacing（黄金开篇、断章钩子）, novel-language-style（文风选择） |
| **④ 精修打磨** | 删不推动剧情的对话、检查反转是否合理、确认结尾有余韵 | novel-polishing（去AI味）, novel-pleasure-points（爽点密度检查） |
```

**短篇铁律：**
- 开头 3 句话决定生死，结尾决定传播
- 每句对话必须推进剧情或揭示性格
- 反转前的每个细节都要有用（铺垫或推高情绪）
- 反转后 500 字内收尾，不拖

> 示例：`output/《重生后，我让前夫跪着签离婚协议》` 就是按此流程创作的番茄短篇。

---

### 长篇创作流程（起点/番茄/飞卢长篇）

适用于 50–300 万字的长篇网络小说。核心是**工程化写作 + 爽点密度决定追读率**。

```
选题确认 → 核心设定 → 大纲搭建 → 正文写作 → 质量检查
```

| 阶段 | 做什么 | 调用的模块 |
|------|--------|-----------|
| **① 选题确认** | 匹配自身优势（脑洞/文笔/节奏/经验）与目标平台 | novel-genres（题材选择）, novel-commercialization（平台匹配） |
| **② 核心设定** | 一句话梗概 + 主角人设 + 世界观骨架 + 金手指设计 | novel-character-design, novel-worldbuilding |
| **③ 大纲搭建** | 卷级大纲（全书结构）→ 前 30 章细纲（章级）→ 标注爽点/钩子 | novel-pacing（多幕式结构、高潮编排） |
| **④ 正文写作** | 日更 2 章起步，每章 3000-4000 字，章章有钩子 | novel-pacing（断章钩子）, novel-language-style, novel-emotion, novel-pleasure-points |
| **⑤ 质量检查** | 爽点密度、节奏控制、设定一致性、追读率优化 | novel-worldbuilding（设定一致性）, novel-polishing, novel-tools（数据分析） |
```

**长篇铁律：**
- 日更是底线，质量是上限。稳定日更 4000 字 > 三天打鱼两天晒网
- 每 3,000–5,000 字必须有一个情绪释放节点（爽点）
- 前 30 章不要改大纲——先写够 12 万字再回头调整
- 设定文档必须单独管理，每卷检查一次前后矛盾

---

### 通用创作工作流

无论短篇还是长篇，AI 辅助写作的最佳实践是**混合创作模式**：

```
AI 生成初稿（40-60%）→ 人工改写润色（40-60%）→ 风格统一 → AIGC 检测
```

相关模块：novel-tools（提示词模板）、novel-polishing（去AI味）、novel-anti-detection（防检测）

---

## 模块结构

```
Distilled-Novel-Toolbox/
├── novel-anti-detection/         # 反AI检测与风控（v2升级：39条规则+特征群判定）
│   ├── SKILL.md
│   └── references/
│       ├── bypass-strategies.md
│       ├── detection-principles.md
│       ├── index.md
│       ├── mixed-creation-mode.md
│       └── platform-policies.md
├── novel-character-design/       # 人设与群像工程
│   ├── SKILL.md
│   └── references/
│       ├── antagonist-templates.md
│       ├── character-arc.md
│       ├── index.md
│       ├── protagonist-tags.md
│       ├── relationship-patterns.md
│       └── supporting-roles.md
├── novel-commercialization/      # 商业化与平台特化
│   ├── SKILL.md
│   └── references/
│       ├── fanqie-style.md
│       ├── feilu-style.md
│       ├── index.md
│       ├── jinjiang-style.md
│       ├── monetization-design.md
│       ├── new-media-style.md
│       └── qidian-style.md
├── novel-compliance/             # 敏感词规避与合规
│   ├── SKILL.md
│   └── references/
│       ├── content-review-flow.md
│       ├── index.md
│       ├── legal-compliance.md
│       ├── platform-rules.md
│       └── sensitive-words-db.md
├── novel-emotion/                # 情绪与代入感设计
│   ├── SKILL.md
│   └── references/
│       ├── emotion-curve.md
│       ├── empathy-triggers.md
│       ├── expectation-management.md
│       ├── immersion-techniques.md
│       └── index.md
├── novel-genres/                 # 题材与子类融合引擎
│   ├── SKILL.md
│   └── references/
│       ├── apocalypse-survival.md
│       ├── eastern-fantasy.md
│       ├── fanfiction-derivative.md
│       ├── farming-building.md
│       ├── gaming-esports.md
│       ├── genre-fusion-matrix.md
│       ├── historical.md
│       ├── index.md
│       ├── mystery-horror.md
│       ├── romance.md
│       ├── sci-fi.md
│       ├── system-transmigration.md
│       └── urban-fiction.md
├── novel-innovation/             # 创新、反套路与融合
│   ├── SKILL.md
│   └── references/
│       ├── ai-writing-pitfalls.md
│       ├── anti-cliche-library.md
│       ├── genre-fusion-compatibility.md
│       ├── index.md
│       └── meme-implantation.md
├── novel-language-style/         # 语言与文风光谱
│   ├── SKILL.md
│   └── references/
│       ├── cinematography.md
│       ├── index.md
│       ├── meme-system.md
│       ├── narrative-perspective.md
│       ├── rhetoric-techniques.md
│       └── style-spectrum.md
├── novel-pacing/                 # 节奏与结构工程
│   ├── SKILL.md
│   └── references/
│       ├── climax-orchestration.md
│       ├── golden-opening.md
│       ├── hook-techniques.md
│       ├── index.md
│       ├── multi-act-structure.md
│       └── word-count-rhythm.md
├── novel-pleasure-points/        # 爽点模式大全与疲劳管理
│   ├── SKILL.md
│   └── references/
│       ├── disguise-power.md
│       ├── face-slapping.md
│       ├── harem-romance.md
│       ├── index.md
│       ├── intelligence-crushing.md
│       ├── misunderstanding-stream.md
│       ├── pleasure-fatigue-management.md
│       ├── revenge-abuse.md
│       ├── sign-in-system.md
│       └── steady-flow.md
├── novel-polishing/              # 润色与去AI味（v2升级：39条规则+评分+流程）
│   ├── SKILL.md
│   └── references/
│       ├── before-after-examples.md
│       ├── de-ai-techniques.md
│       ├── index.md
│       ├── phrases.md
│       ├── polishing-commands.md
│       ├── structures.md
│       └── style-enhancement.md
├── novel-tools/                  # 创作工具与生产流程
│   ├── SKILL.md
│   └── references/
│       ├── ai-writing-tools.md
│       ├── index.md
│       ├── prompt-templates.md
│       ├── publishing-analytics.md
│       └── workflow-design.md
├── novel-worldbuilding/          # 世界观与设定体系
│   ├── SKILL.md
│   └── references/
│       ├── economy-society.md
│       ├── index.md
│       ├── map-expansion.md
│       ├── power-systems.md
│       └── rule-consistency.md
├── output/                       # 示例作品输出
│   └── 重生后我让前夫跪着签离婚协议.md
├── .gitignore
└── README.md
```

每个模块的组成：

```
novel-xxx/
├── SKILL.md          # = 先读这个。包含用途、触发场景、核心方法论、自查清单
└── references/       # = 深度展开。每个子主题一份独立文档
    ├── index.md
    ├── xxx.md
    └── ...
```

每个 `SKILL.md` 末尾附有 **Checklist**，可作为写作自查清单直接使用。

---

## 适用人群

| 如果是 | 可以从这里开始 |
|--------|---------------|
| 第一次写网文的新手 | 从头通读，每个模块的 SKILL.md 就是入门指引 |
| 遇到瓶颈的进阶写手 | 按需加载——节奏拖沓？看 novel-pacing。角色扁平？看 novel-character-design |
| 用 AI 辅助写作的作者 | 优先看 novel-polishing（v2：39条规则+评分系统+端到端流程）和 novel-anti-detection（v2：特征群检测+误报防护） |
| 准备签约/换平台的作者 | 直接看 novel-commercialization，对比各平台风格和收入模型 |

---

## 示例输出

`output/` 目录包含使用本知识库创作的完整作品：

- **《重生后，我让前夫跪着签离婚协议》** —— 番茄风格 · 都市重生虐渣 · ~1 万字

---

## 致谢

感谢真诚、友善、团结、专业的 [LinuxDo 社区](https://linux.do/latest)，让我学到很多 AI 相关的知识和玩法。

> LinuxDo — 学 AI，上 L 站

## 许可

MIT
