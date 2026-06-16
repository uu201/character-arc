---
name: cross-book-recall
description: 多对标跨书召回
sync-source: skills/story-long-write/references/cross-book-recall.md
---

# 跨书召回

## 触发
项目根 `拆文库/` ≥2 本启用。主对标书取 `设定/题材定位.md`「主对标书」字段，缺失则用字典序第一本并提示用户补。

## 三道防线
1. 副对标 `文风.md` 不读
2. 角色/剧情/设定 模块只主对标 + 1 本同题材副对标
3. narrative-writer 输入只主对标

## 跨题材判断
读副对标 `设定/题材定位.md`「题材类型」：
- 同题材：全阶段召回
- 弱相关：仅设定/大纲，每本 ≤1 条
- 不相关：跳过

## 阶段消费
表中数字为每本副对标召回上限。`—` 行表示该文体无此阶段，整行忽略。

| 阶段 | 长篇产出 | 短篇产出 | 同题材 | 弱相关 |
|------|---------|---------|-------|-------|
| 设定 | `拆文报告.md` | `拆文报告.md` + `情节节点.md` | ≤2 | ≤1 |
| 大纲 | `章节/*_摘要.md` + `剧情/*.md` | `情节节点.md` + `写作手法.md` | ≤3 | ≤1 |
| 模块 | `角色/` + `剧情/` + `设定/` | — | 1 本 | 0 |
| 正文 | `文风.md` + 原文 | `写作手法.md` + 原文 | 0 | 0 |

## 拆文字段 → 写作参考
读 `_meta.json.structure_counts` 时，按此表回查对应写作 reference：

| 拆文字段 | 含义 | 写作参考 |
|---------|------|---------|
| `beats` | 结构段（开端/发展/高潮/结局） | `genre-catalog.md` 题材结构 |
| `hooks` | 钩子数 | `hooks-chapter.md` / `hooks-suspense.md` / `opening-design.md` |
| `setup_clues` | 反转铺垫线索 | `reversal-toolkit.md` |
| `character_archetypes` | 反差人物 | `character-design-methods.md` 三层标签反差 |
| `reusable_structures` | 可复用手法 | `genre-writing-formulas.md` / `writing-craft.md` |
| `reversal_type` | 反转类型（7 枚举） | `reversal-toolkit.md` 对应骨架 |
