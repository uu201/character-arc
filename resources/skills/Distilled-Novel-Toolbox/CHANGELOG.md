# 更新日志

## v2.0.0 — 2026-06-09

### 重大升级：去AI腔引擎全面重构

将 anti-ai-qiang 的完整体系注入 `novel-anti-detection` 和 `novel-polishing` 两个模块，从"教程式概述"升级为**可直接扔给AI执行的操作级技能**。

#### novel-anti-detection（反AI检测与风控）

- **SKILL.md** — 新增五大AI特征模式检测指南、10项误报防护规则、7类人类写作保护标志、快速检查表
- **references/detection-principles.md** — 注入完整39条规则检测框架 + 特征群判定原则（孤立特征 vs 特征群阈值判定）

#### novel-polishing（润色与去AI味）

- **SKILL.md** — 完整重写，注入声音微调（模仿个人文风）、个性与灵魂（长短交错/表明立场/消除旁观者视角）、39条可执行改写规则（五大类）、五维评分系统（35/50及格线）、初稿→检查→终稿标准流程
- **references/de-ai-techniques.md** — 以39条规则分类详解替换原有内容
- **references/polishing-commands.md** — 新增完整流程指令、声音微调指令、评分评估指令
- **references/before-after-examples.md** — 从3个示例扩展至30个（含端到端完整改写）
- **references/phrases.md** — 新增（禁用词组清单：垫话/黑话/AI高频词/填充词等12类）
- **references/structures.md** — 新增（禁用句式清单：双重对比/虚假施动者/被动语态等12类）
