# Changelog

本项目所有显著变更都会记录在此文件中。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [1.0.1] - 2026-05-25

### Changed

- **AI 接口配置**：简化为「OpenAI 兼容协议」和「Anthropic 协议」两种，用户只需选协议、填 URL 和 Key、拉取模型即可
- **Base URL 自动补全**：两种协议均自动拼接 /v1，用户无需手动添加
- **模型拉取**：统一走 OpenAI 兼容的 /v1/models 端点，自动尝试多个候选路径
- **默认模型更新**：Anthropic 默认 claude-sonnet-4-6，OpenAI 默认 gpt-4.1-mini，通义千问默认 qwen3-coder-plus 等

### Fixed

- **Anthropic 中转站连接失败**：修复 Electron 环境下 @ai-sdk/anthropic 非流式请求返回 "Invalid JSON response" 的问题，改为流式聚合
- **Base URL 路径拼接**：修复 @ai-sdk/anthropic 与中转站路径格式不兼容的问题
- **任务超时**：将 AI 任务默认超时从 90 秒调整为 300 秒，避免大模型生成时间较长时误报超时
- **非 Claude 模型兼容**：通过 Anthropic 协议使用 DeepSeek 等非 Claude 模型时，自动回退到文本生成路径

[1.0.1]: https://github.com/zhouyeshan/character-arc/releases/tag/v1.0.1


首个正式版本。详细发布说明见 [docs/release-notes/v1.0.0.md](docs/release-notes/v1.0.0.md)。

### Added

- **项目与资料**：项目中心、新建项目向导（AI 螺旋式生成首批设定与大纲）、知识中心、全局拆书知识库
- **世界观与结构**：世界观/角色/组织/关系管理、Cytoscape 关系图谱、双栏交错时间线剧情大纲、剧情线索
- **章节创作**：VS Code 风格三栏工作区（目录树 + TipTap 编辑器 + AI 侧边栏）、自动保存与历史快照、阅读/专注模式、字数目标、`.txt`/`.docx`/JSON 导出
- **AI 辅助**：润色、续写、改写、节奏调整、摘要、伏笔识别、后续剧情链；章节初稿整章流式生成；AI 对话流式输出与中途停止；Agent Loop 循环思考与工具调用；任务进度面板
- **封面工作台**：番茄/起点/晋江/知乎盐言/七猫/刺猬猫等多平台封面 Prompt 生成与历史版本对比
- **多厂商接入**：DeepSeek（含 reasoning_content）、通义千问、智谱 GLM、Kimi、SiliconFlow、OpenAI、Anthropic、Ollama、New API / One API 网关；Embedding 模型独立配置
- **Skill 系统**：内置 15 个 Skill，frontmatter 元数据驱动，支持项目级独立导入
- **架构**：Electron + Vue 3 + TypeScript，AI 管线基于 Vercel AI SDK，导入参考小说自动建立向量索引
- **UI/UX**：Nord 风格深色 + 暖色调浅色双主题，自定义标题栏（titleBarOverlay）

### Security

- 全部数据保存在本地 SQLite，不上传任何第三方服务

[1.0.0]: https://github.com/zhouyeshan/character-arc/releases/tag/v1.0.0
