"use strict";
const electron = require("electron");
const node_path = require("node:path");
const promises = require("node:fs/promises");
const node_sqlite = require("node:sqlite");
const node_crypto = require("node:crypto");
function buildTaskPrompt(task) {
  const { context } = task;
  if (task.task === "worldview-entry") {
    return {
      system: "你是小说世界观设定助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 type、title、content。",
      user: `基于以下上下文，为当前小说项目新增一条世界观设定。

项目标题：${String(context.projectTitle ?? "")}
项目题材：${String(context.projectGenre ?? "")}
已有世界观：${JSON.stringify(context.worldviewTitles ?? [])}

要求：
1. 返回一条不与已有条目重复的新设定
2. type 必须是 地理 / 法则 / 物种 / 势力 / 历史 之一
3. title 要简洁
4. content 用中文完整描述，80 到 180 字

返回格式：{"type":"","title":"","content":""}`
    };
  }
  if (task.task === "character-card") {
    return {
      system: "你是小说角色设定助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 name、role、description、tags。",
      user: `基于以下上下文，为当前小说项目生成一名新角色。

项目标题：${String(context.projectTitle ?? "")}
项目题材：${String(context.projectGenre ?? "")}
已有角色：${JSON.stringify(context.characterNames ?? [])}
世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}

要求：
1. 不与已有角色重名
2. role 用短语概括角色定位
3. description 用中文完整描述，80 到 160 字
4. tags 返回 2 到 4 个简短标签数组

返回格式：{"name":"","role":"","description":"","tags":["",""]}`
    };
  }
  if (task.task === "project-bootstrap") {
    return {
      system: "你是小说项目初始化助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 worldviewEntries、outlineItems。",
      user: `请基于以下信息，为小说项目生成首批世界观设定和剧情大纲。

项目标题：${String(context.projectTitle ?? "")}
项目题材：${String(context.projectGenre ?? "")}
目标字数：${String(context.projectWordTarget ?? "")}
核心点子：${String(context.projectPremise ?? "")}

要求：
1. worldviewEntries 返回 3 条设定，每条都包含 type、title、content
2. worldviewEntries 的 type 必须是 地理 / 法则 / 物种 / 势力 / 历史 之一
3. outlineItems 返回 3 条章节大纲，每条都包含 title、wordTarget、conflict、summary
4. wordTarget 使用“预估 xxxx字”格式
5. 所有内容使用中文，紧贴题材和核心点子，不要重复

返回格式：{"worldviewEntries":[{"type":"","title":"","content":""}],"outlineItems":[{"title":"","wordTarget":"","conflict":"","summary":""}]}`
    };
  }
  if (task.task === "chapter-assistant") {
    const worldviewEntries = Array.isArray(context.worldviewEntries) ? context.worldviewEntries.slice(0, 8).map((entry) => `${String(entry.title ?? "")}：${String(entry.content ?? "")}`).join("\n") : "";
    const characters = Array.isArray(context.characters) ? context.characters.slice(0, 8).map((character) => `${String(character.name ?? "")} / ${String(character.role ?? "")}：${String(character.description ?? "")}`).join("\n") : "";
    const outlineItems = Array.isArray(context.outlineItems) ? context.outlineItems.slice(0, 6).map((item) => `${String(item.title ?? "")}：${String(item.summary ?? "")}`).join("\n") : "";
    const relatedChapters = Array.isArray(context.relatedChapters) ? context.relatedChapters.slice(0, 2).map((item, index) => {
      const record = item;
      return `关联章节${index + 1}：${String(record.title ?? "")}
摘要：${String(record.summary ?? "")}
正文预览：${String(record.preview ?? "")}`;
    }).join("\n\n") : "";
    const recentMessages = Array.isArray(context.recentMessages) ? context.recentMessages.slice(-4).map((item) => {
      const record = item;
      const role = String(record.role ?? "") === "assistant" ? "助理" : "用户";
      return `${role}：${String(record.content ?? "")}`;
    }).join("\n") : "";
    const selectedText = String(context.selectedText ?? "").trim();
    const quickAction = String(context.quickAction ?? "自由提问");
    const responseMode = String(context.responseMode ?? "freeform");
    const responseLength = String(context.responseLength ?? "medium");
    const modeInstruction = resolveChapterAssistantModeInstruction(responseMode);
    const lengthInstruction = resolveChapterAssistantLengthInstruction(responseLength);
    const quickActionInstruction = resolveChapterAssistantQuickActionInstruction(quickAction);
    return {
      system: "你是 CharacterArc 的小说创作助理。请基于当前项目和章节上下文，用中文直接输出可供作者使用的正文、润色稿、分析或建议。不要输出 Markdown 标题，不要解释你是 AI，也不要返回 JSON。",
      user: `请处理当前写作请求，并优先给出可直接使用的结果。

项目标题：${String(context.projectTitle ?? "")}
项目题材：${String(context.projectGenre ?? "")}
当前分卷：${String(context.chapterVolumeTitle ?? "")}
当前分卷摘要：${String(context.chapterVolumeSummary ?? "")}
当前章节标题：${String(context.chapterTitle ?? "")}
当前章节摘要：${String(context.chapterSummary ?? "")}
当前章节状态：${String(context.chapterStatus ?? "")}
当前章节预估字数：${String(context.chapterWordTarget ?? "")}
当前章节正文：
${String(context.chapterContent ?? "")}

当前选中文本：
${selectedText || "暂无"}

相邻章节参考：
${relatedChapters || "暂无"}

相关世界观：
${worldviewEntries || "暂无"}

相关角色：
${characters || "暂无"}

相关大纲：
${outlineItems || "暂无"}

最近对话：
${recentMessages || "暂无"}

快捷动作：${quickAction}
输出模式：${responseMode}
输出长度：${responseLength}
用户请求：${String(context.userPrompt ?? "")}

要求：
1. 回答要紧贴当前章节上下文
2. 如果请求是润色、续写、描写，请优先输出可直接插入正文的内容
3. 如果提供了当前选中文本，并且请求与润色、改写、分析有关，请优先只围绕这段文本处理，不要重写整章
4. 如果请求是分析或建议，请给出清晰可执行的建议
5. 避免与最近几条对话重复表达，除非用户明确要求重写
6. 如果是续写，请尽量与相邻章节和当前分卷的情绪、节奏保持连续
7. ${modeInstruction}
8. ${lengthInstruction}
9. ${quickActionInstruction}`
    };
  }
  return {
    system: "你是小说剧情大纲助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 title、wordTarget、conflict、summary。",
    user: `基于以下上下文，为当前小说项目补充一个新的章节大纲节点。

项目标题：${String(context.projectTitle ?? "")}
项目题材：${String(context.projectGenre ?? "")}
当前分卷：${String(context.chapterVolumeTitle ?? "")}
当前分卷摘要：${String(context.chapterVolumeSummary ?? "")}
当前章节标题：${String(context.chapterTitle ?? "")}
当前章节摘要：${String(context.chapterSummary ?? "")}
当前章节预估字数：${String(context.chapterWordTarget ?? "")}
当前章节正文：
${String(context.chapterContent ?? "")}
已有大纲：${JSON.stringify(context.outlineTitles ?? [])}
当前分卷已有节点：${JSON.stringify(context.currentVolumeOutlineItems ?? [])}
世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}
角色参考：${JSON.stringify(context.characters ?? [])}
补充要求：${String(context.userPrompt ?? "")}

要求：
1. title 为新的章节标题，并体现与当前章节的承接关系
2. wordTarget 使用“预估 xxxx字”格式
3. conflict 用一句话概括下一章的核心冲突
4. summary 用中文描述剧情推进，80 到 180 字
5. 与当前分卷目标、已有大纲和当前章节情绪保持连续，不要重复已有节点

返回格式：{"title":"","wordTarget":"","conflict":"","summary":""}`
  };
}
function buildRepairPrompt(task, brokenText) {
  const originalPrompt = buildTaskPrompt(task);
  return {
    system: "你是 JSON 输出修复助手。你只负责把已有回复整理成合法 JSON，不能输出 Markdown、解释或额外文本。",
    user: `请根据原始任务要求，把下面这段回复修正为严格合法的 JSON。

原始系统要求：
${originalPrompt.system}

原始用户要求：
${originalPrompt.user}

模型原始回复：
${brokenText}

要求：
1. 只返回一个合法 JSON 对象
2. 不要补充与任务无关的解释
3. 缺失字段时，根据原始任务要求补齐最合理的内容`
  };
}
function resolveChapterAssistantModeInstruction(mode) {
  switch (mode) {
    case "polish":
      return "当前模式是“润色”。请尽量直接输出可替换原文的润色结果，减少分析。";
    case "continue":
      return "当前模式是“续写”。请紧接现有正文自然续写，保持语气、节奏和剧情方向一致。";
    case "suggest":
      return "当前模式是“剧情建议”。请给出 3 到 5 条具体建议，按可执行性优先排序。";
    case "reference":
      return "当前模式是“设定查阅”。请优先提炼与当前章节最相关的设定、角色和风险点。";
    default:
      return "当前模式是“自由提问”。请根据用户请求选择最合适的回答形式。";
  }
}
function resolveChapterAssistantLengthInstruction(length) {
  switch (length) {
    case "short":
      return "控制在 80 到 180 字，结论优先，避免铺垫过长。";
    case "long":
      return "控制在 350 到 800 字，可以展开完整段落或多条具体建议。";
    case "medium":
    default:
      return "控制在 160 到 360 字，兼顾可读性和可执行性。";
  }
}
function resolveChapterAssistantQuickActionInstruction(quickAction) {
  switch (quickAction) {
    case "章节标题":
      return "如果当前任务是生成章节标题，只输出一个最终标题，不要解释、不要分点、不要加书名号；若与通用长度要求冲突，以本条为准。";
    case "章节摘要":
      return "如果当前任务是生成章节摘要，请输出一段可直接作为本章定位的简洁摘要，不要分点，不要额外说明。";
    case "润色选中":
      return "如果当前任务是润色选中内容，请只输出润色后的最终文本，紧贴当前选中文本，不要解释，不要分点。";
    case "下一章建议":
      return "如果当前任务是下一章建议，请输出 3 条具体方案，每条都要体现推进方向、冲突和悬念。";
    default:
      return "如果快捷动作已经明确输出形态，请优先遵循该动作要求。";
  }
}
const AI_REQUEST_TIMEOUT_MS = 6e4;
function resolveProviderDefaults(provider) {
  switch (provider) {
    case "openai":
      return { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" };
    case "deepseek":
      return { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" };
    case "qwen":
      return { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" };
    case "zhipu":
      return { baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.7" };
    case "moonshot":
      return { baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k2.5" };
    case "siliconflow":
      return { baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-72B-Instruct" };
    case "anthropic":
      return { baseUrl: "https://api.anthropic.com", model: "claude-3-5-sonnet-latest" };
    case "ollama":
      return { baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.2" };
    case "new-api":
    case "one-api":
      return { baseUrl: "http://127.0.0.1:3000/v1", model: "qwen-plus" };
    default:
      return { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" };
  }
}
function normalizeSettings(settings) {
  const provider = settings.provider?.trim().toLowerCase() || "deepseek";
  const defaults = resolveProviderDefaults(provider);
  return {
    provider,
    model: settings.model?.trim() || defaults.model,
    apiKey: settings.apiKey?.trim() || "",
    baseUrl: settings.baseUrl?.trim() || defaults.baseUrl
  };
}
function isLocalBaseUrl(baseUrl) {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(baseUrl.trim());
}
function requiresApiKey(settings) {
  if (settings.provider === "ollama") {
    return false;
  }
  return !isLocalBaseUrl(settings.baseUrl);
}
function validateSettings(settings) {
  if (!settings.model.trim()) {
    throw new Error("请先填写模型名称。");
  }
  if (!settings.baseUrl.trim()) {
    throw new Error("请先填写 Base URL。");
  }
  if (requiresApiKey(settings) && !settings.apiKey.trim()) {
    throw new Error("当前模型供应商需要 API Key，请先在设置页填写。");
  }
}
function resolveMaxTokens(task) {
  switch (task?.task) {
    case "project-bootstrap":
      return 1500;
    case "chapter-assistant":
      switch (String(task.context.responseLength ?? "medium")) {
        case "short":
          return 500;
        case "long":
          return 1400;
        default:
          return 900;
      }
    case "worldview-entry":
    case "character-card":
    case "outline-item":
      return 700;
    default:
      return void 0;
  }
}
async function readErrorMessage(response, fallbackLabel) {
  const fallback = `${fallbackLabel} 请求失败：${response.status} ${response.statusText}`;
  try {
    const data = await response.json();
    const error = data.error ?? data;
    const message = typeof error.message === "string" && error.message || typeof error.error === "string" && error.error || typeof data.message === "string" && data.message;
    return message ? `${fallbackLabel} 请求失败：${message}` : fallback;
  } catch {
    return fallback;
  }
}
async function performAiRequest(url, init, providerLabel) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, providerLabel));
    }
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${providerLabel} 请求超时，请检查网络、代理或模型服务状态。`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
async function requestOpenAiCompatible(settings, prompt, task) {
  const response = await performAiRequest(`${settings.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.8,
      ...resolveMaxTokens(task) ? { max_tokens: resolveMaxTokens(task) } : {},
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user }
      ]
    })
  }, "OpenAI 兼容接口");
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI 返回内容为空");
  }
  return content;
}
async function requestAnthropic(settings, prompt, task) {
  const response = await performAiRequest(`${settings.baseUrl.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: resolveMaxTokens(task) ?? 600,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }]
    })
  }, "Anthropic");
  const data = await response.json();
  const content = data.content?.find((item) => item.type === "text")?.text;
  if (!content) {
    throw new Error("Anthropic 返回内容为空");
  }
  return content;
}
function extractOpenAiCompatibleDelta(payload) {
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : void 0;
  const delta = choice?.delta;
  if (typeof delta?.content === "string") {
    return String(delta.content);
  }
  const contentParts = delta?.content;
  if (Array.isArray(contentParts)) {
    return contentParts.map((part) => {
      const record = part;
      if (typeof record.text === "string") {
        return record.text;
      }
      return typeof record.content === "string" ? record.content : "";
    }).join("");
  }
  return "";
}
function extractAnthropicDelta(eventName, payload) {
  const payloadType = String(payload.type ?? "");
  if (eventName === "content_block_delta" || payloadType === "content_block_delta") {
    const delta = payload.delta;
    return typeof delta?.text === "string" ? delta.text : "";
  }
  return "";
}
async function consumeSseResponse(response, onEvent) {
  if (!response.body) {
    throw new Error("模型响应不支持流式读取。");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex >= 0) {
      const rawEvent = buffer.slice(0, separatorIndex).trim();
      buffer = buffer.slice(separatorIndex + 2);
      if (rawEvent) {
        let eventName = "message";
        const dataLines = [];
        for (const line of rawEvent.split(/\r?\n/)) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim() || eventName;
            continue;
          }
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
        await onEvent(eventName, dataLines.join("\n"));
      }
      separatorIndex = buffer.indexOf("\n\n");
    }
    if (done) {
      const trailingEvent = buffer.trim();
      if (trailingEvent) {
        let eventName = "message";
        const dataLines = [];
        for (const line of trailingEvent.split(/\r?\n/)) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim() || eventName;
            continue;
          }
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
        await onEvent(eventName, dataLines.join("\n"));
      }
      break;
    }
  }
}
async function requestOpenAiCompatibleStream(settings, prompt, handlers, signal, task) {
  const response = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}
    },
    signal,
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.8,
      stream: true,
      ...resolveMaxTokens(task) ? { max_tokens: resolveMaxTokens(task) } : {},
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user }
      ]
    })
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "OpenAI 兼容接口"));
  }
  let content = "";
  await consumeSseResponse(response, (_eventName, data) => {
    if (!data || data === "[DONE]") {
      return;
    }
    const payload = JSON.parse(data);
    const delta = extractOpenAiCompatibleDelta(payload);
    if (!delta) {
      return;
    }
    content += delta;
    handlers.onTextDelta(delta);
  });
  return content;
}
async function requestAnthropicStream(settings, prompt, handlers, signal, task) {
  const response = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01"
    },
    signal,
    body: JSON.stringify({
      model: settings.model,
      stream: true,
      max_tokens: resolveMaxTokens(task) ?? 600,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }]
    })
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Anthropic"));
  }
  let content = "";
  await consumeSseResponse(response, (eventName, data) => {
    if (!data) {
      return;
    }
    const payload = JSON.parse(data);
    const delta = extractAnthropicDelta(eventName, payload);
    if (!delta) {
      return;
    }
    content += delta;
    handlers.onTextDelta(delta);
  });
  return content;
}
async function requestAiText(settings, prompt, task) {
  return settings.provider === "anthropic" ? requestAnthropic(settings, prompt, task) : requestOpenAiCompatible(settings, prompt, task);
}
async function requestAiTextStream(settings, prompt, handlers, signal, task) {
  return settings.provider === "anthropic" ? requestAnthropicStream(settings, prompt, handlers, signal, task) : requestOpenAiCompatibleStream(settings, prompt, handlers, signal, task);
}
function extractJsonObject(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] ?? text;
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  const jsonSlice = firstBrace >= 0 && lastBrace >= 0 ? raw.slice(firstBrace, lastBrace + 1) : raw;
  return JSON.parse(jsonSlice);
}
function isStructuredTask(task) {
  return task.task !== "chapter-assistant";
}
function normalizeAssistantText(text) {
  const cleaned = text.replace(/```[\w-]*\n?/g, "").replace(/```/g, "").trim();
  return {
    content: cleaned
  };
}
function normalizeWorldviewResult(result) {
  const entry = result;
  return {
    type: entry.type?.trim() || "地理",
    title: entry.title?.trim() || "新世界观词条",
    content: entry.content?.trim() || "AI 未返回有效内容"
  };
}
function normalizeCharacterResult(result) {
  const character = result;
  const tags = Array.isArray(character.tags) ? character.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 4) : [];
  return {
    name: character.name?.trim() || "新角色",
    role: character.role?.trim() || "待设定",
    description: character.description?.trim() || "AI 未返回有效角色描述",
    tags: tags.length ? tags : ["待完善"]
  };
}
function normalizeOutlineResult(result) {
  const item = result;
  return {
    title: item.title?.trim() || "第1章：新剧情节点",
    wordTarget: item.wordTarget?.trim() || "预估 3000字",
    conflict: item.conflict?.trim() || "新的冲突正在酝酿。",
    summary: item.summary?.trim() || "AI 未返回有效剧情摘要"
  };
}
function normalizeProjectBootstrapResult(result) {
  const payload = result;
  const worldviewEntries = Array.isArray(payload.worldviewEntries) ? payload.worldviewEntries.slice(0, 3).map((entry) => normalizeWorldviewResult(entry)) : [];
  const outlineItems = Array.isArray(payload.outlineItems) ? payload.outlineItems.slice(0, 3).map((item) => normalizeOutlineResult(item)) : [];
  return {
    worldviewEntries,
    outlineItems
  };
}
function isTaskResultUsable(task, result) {
  if (task.task === "chapter-assistant") {
    return Boolean(result.content?.trim());
  }
  if (task.task === "project-bootstrap") {
    const payload = result;
    return payload.worldviewEntries.length > 0 && payload.outlineItems.length > 0;
  }
  if (task.task === "worldview-entry") {
    const entry = result;
    return Boolean(entry.title.trim() && entry.content.trim());
  }
  if (task.task === "character-card") {
    const character = result;
    return Boolean(character.name.trim() && character.description.trim());
  }
  const outline = result;
  return Boolean(outline.title.trim() && outline.summary.trim());
}
function normalizeTaskResult(task, rawText) {
  if (task.task === "chapter-assistant") {
    return normalizeAssistantText(rawText);
  }
  const parsed = extractJsonObject(rawText);
  switch (task.task) {
    case "worldview-entry":
      return normalizeWorldviewResult(parsed);
    case "character-card":
      return normalizeCharacterResult(parsed);
    case "project-bootstrap":
      return normalizeProjectBootstrapResult(parsed);
    case "outline-item":
    default:
      return normalizeOutlineResult(parsed);
  }
}
async function resolveTaskResult(task, settings, rawText) {
  try {
    const normalized = normalizeTaskResult(task, rawText);
    if (isTaskResultUsable(task, normalized)) {
      return normalized;
    }
  } catch {
  }
  if (!isStructuredTask(task)) {
    return normalizeTaskResult(task, rawText);
  }
  const repairedText = await requestAiText(settings, buildRepairPrompt(task, rawText), task);
  const repairedResult = normalizeTaskResult(task, repairedText);
  if (!isTaskResultUsable(task, repairedResult)) {
    throw new Error("AI 返回的结构化结果不完整，请稍后重试或调整提示词。");
  }
  return repairedResult;
}
async function testAiConnection(rawSettings) {
  const settings = normalizeSettings(rawSettings);
  validateSettings(settings);
  const probePrompt = {
    system: "You are a connectivity probe. Reply with CONNECTED only.",
    user: "Return CONNECTED"
  };
  const text = await requestAiText(settings, probePrompt);
  if (!text.trim()) {
    throw new Error("模型连接成功，但没有返回可读内容。");
  }
  return {
    provider: settings.provider,
    model: settings.model
  };
}
async function generateAiTask(task) {
  const settings = normalizeSettings(task.settings);
  validateSettings(settings);
  const prompt = buildTaskPrompt(task);
  const rawText = await requestAiText(settings, prompt, task);
  return resolveTaskResult(task, settings, rawText);
}
async function streamAiTask(task, handlers, signal) {
  if (task.task !== "chapter-assistant") {
    throw new Error("当前流式输出仅支持章节创作助理。");
  }
  const settings = normalizeSettings(task.settings);
  validateSettings(settings);
  const prompt = buildTaskPrompt(task);
  const rawText = await requestAiTextStream(settings, prompt, handlers, signal, task);
  return normalizeAssistantText(rawText);
}
const APP_DEFAULT_WIDTH = 1480;
const APP_DEFAULT_HEIGHT = 920;
const APP_MIN_WIDTH = 1120;
const APP_MIN_HEIGHT = 720;
const ASSISTANT_WINDOW_WIDTH = 580;
const ASSISTANT_WINDOW_HEIGHT = 820;
const ASSISTANT_WINDOW_MIN_WIDTH = 460;
const ASSISTANT_WINDOW_MIN_HEIGHT = 620;
const WORKSPACE_DB = "workspace.db";
const WORKSPACE_FILE = "workspace.json";
const activeAiStreams = /* @__PURE__ */ new Map();
let mainWindow = null;
let assistantWindow = null;
let latestAssistantContext = {};
let latestAssistantPrompt = null;
function getMainWindowMetrics() {
  const { workAreaSize } = electron.screen.getPrimaryDisplay();
  const compactScreen = workAreaSize.width <= 1366 || workAreaSize.height <= 820;
  const minWidth = Math.min(APP_MIN_WIDTH, workAreaSize.width);
  const minHeight = Math.min(APP_MIN_HEIGHT, workAreaSize.height);
  const width = Math.min(Math.max(Math.round(workAreaSize.width * 0.9), minWidth), APP_DEFAULT_WIDTH);
  const height = Math.min(Math.max(Math.round(workAreaSize.height * 0.9), minHeight), APP_DEFAULT_HEIGHT);
  return {
    width,
    height,
    minWidth,
    minHeight,
    compactScreen
  };
}
function getWindowSearch(kind) {
  return kind === "assistant" ? "?window=assistant" : "";
}
function loadRendererWindow(window, kind) {
  const search = getWindowSearch(kind);
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${search}`);
    if (kind === "main") {
      window.webContents.openDevTools({ mode: "detach" });
    }
    return;
  }
  void window.loadFile(node_path.join(__dirname, "../../dist/index.html"), search ? { search } : void 0);
}
function sendWindowEvent(window, channel, payload) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    return;
  }
  window.webContents.send(channel, payload);
}
function broadcastWindowEvent(channel, payload, exceptWebContentsId) {
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      continue;
    }
    if (exceptWebContentsId && window.webContents.id === exceptWebContentsId) {
      continue;
    }
    window.webContents.send(channel, payload);
  }
}
function emitAssistantWindowVisibility(visible) {
  broadcastWindowEvent("characterarc:assistant-window-visibility", {
    visible
  });
}
function createMainWindow() {
  const { width, height, minWidth, minHeight, compactScreen } = getMainWindowMetrics();
  const window = new electron.BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    // Keep native caption buttons while giving the renderer a compact title-bar area to style around.
    titleBarOverlay: process.platform === "win32" ? {
      color: "#f5f5f7",
      symbolColor: "#1d1d1f",
      height: 28
    } : false,
    backgroundColor: "#f5f5f7",
    show: false,
    webPreferences: {
      preload: node_path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  window.once("ready-to-show", () => {
    if (compactScreen) {
      window.center();
    }
    window.show();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void electron.shell.openExternal(url);
    return { action: "deny" };
  });
  window.on("closed", () => {
    if (assistantWindow && !assistantWindow.isDestroyed()) {
      assistantWindow.close();
    }
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
  loadRendererWindow(window, "main");
  mainWindow = window;
  return window;
}
function createAssistantWindow() {
  if (assistantWindow && !assistantWindow.isDestroyed()) {
    if (assistantWindow.isMinimized()) {
      assistantWindow.restore();
    }
    assistantWindow.show();
    assistantWindow.focus();
    emitAssistantWindowVisibility(true);
    sendWindowEvent(assistantWindow, "characterarc:assistant-context", latestAssistantContext);
    return assistantWindow;
  }
  const parentBounds = mainWindow?.getBounds();
  const assistantX = parentBounds ? parentBounds.x + parentBounds.width - ASSISTANT_WINDOW_WIDTH - 32 : void 0;
  const assistantY = parentBounds ? parentBounds.y + 44 : void 0;
  const window = new electron.BrowserWindow({
    width: ASSISTANT_WINDOW_WIDTH,
    height: ASSISTANT_WINDOW_HEIGHT,
    minWidth: ASSISTANT_WINDOW_MIN_WIDTH,
    minHeight: ASSISTANT_WINDOW_MIN_HEIGHT,
    x: assistantX,
    y: assistantY,
    parent: mainWindow ?? void 0,
    autoHideMenuBar: true,
    title: "AI 创作助理",
    maximizable: false,
    fullscreenable: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    titleBarOverlay: process.platform === "win32" ? {
      color: "#f4f7fb",
      symbolColor: "#1d1d1f",
      height: 28
    } : false,
    backgroundColor: "#f4f7fb",
    show: false,
    webPreferences: {
      preload: node_path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  window.once("ready-to-show", () => {
    window.show();
    window.focus();
    emitAssistantWindowVisibility(true);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void electron.shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.once("did-finish-load", () => {
    sendWindowEvent(window, "characterarc:assistant-context", latestAssistantContext);
    if (latestAssistantPrompt) {
      sendWindowEvent(window, "characterarc:assistant-prompt", latestAssistantPrompt);
    }
  });
  window.on("closed", () => {
    if (assistantWindow === window) {
      assistantWindow = null;
    }
    emitAssistantWindowVisibility(false);
  });
  loadRendererWindow(window, "assistant");
  assistantWindow = window;
  return window;
}
function getWorkspaceDirPath() {
  return node_path.join(electron.app.getPath("userData"), "data");
}
function getWorkspaceFilePath() {
  return node_path.join(getWorkspaceDirPath(), WORKSPACE_FILE);
}
function getWorkspaceDbPath() {
  return node_path.join(getWorkspaceDirPath(), WORKSPACE_DB);
}
let workspaceDb = null;
async function ensureWorkspaceDir() {
  await promises.mkdir(getWorkspaceDirPath(), { recursive: true });
}
async function ensureWorkspaceDb() {
  if (workspaceDb) {
    return workspaceDb;
  }
  await ensureWorkspaceDir();
  workspaceDb = new node_sqlite.DatabaseSync(getWorkspaceDbPath());
  workspaceDb.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      genre TEXT NOT NULL,
      word_count TEXT NOT NULL,
      last_edited TEXT NOT NULL,
      cover TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS worldview_entries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      description TEXT NOT NULL,
      avatar TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS outline_volumes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      word_target TEXT NOT NULL,
      summary TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS outline_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      volume_id TEXT NOT NULL,
      title TEXT NOT NULL,
      word_target TEXT NOT NULL,
      conflict TEXT NOT NULL,
      summary TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
      FOREIGN KEY (volume_id) REFERENCES outline_volumes (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      volume_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      word_target TEXT NOT NULL,
      content TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
      FOREIGN KEY (volume_id) REFERENCES outline_volumes (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS chapter_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      word_target TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
      FOREIGN KEY (chapter_id) REFERENCES chapters (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ai_messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      theme TEXT NOT NULL,
      selected_project_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      api_key TEXT NOT NULL,
      base_url TEXT NOT NULL,
      auto_save_interval TEXT NOT NULL,
      ui_scale REAL NOT NULL DEFAULT 1
    ) STRICT;
  `);
  ensureAppSettingsColumns(workspaceDb);
  ensureChapterColumns(workspaceDb);
  ensureProjectScopedColumns(workspaceDb);
  ensureVolumeColumns(workspaceDb);
  await migrateLegacyWorkspaceFile(workspaceDb);
  return workspaceDb;
}
function ensureAppSettingsColumns(db) {
  const columns = db.prepare(`PRAGMA table_info('app_settings')`).all();
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("model")) {
    db.exec(`ALTER TABLE app_settings ADD COLUMN model TEXT NOT NULL DEFAULT 'deepseek-chat';`);
  }
  if (!columnNames.has("ui_scale")) {
    db.exec(`ALTER TABLE app_settings ADD COLUMN ui_scale REAL NOT NULL DEFAULT 1;`);
  }
}
function ensureChapterColumns(db) {
  const columns = db.prepare(`PRAGMA table_info('chapters')`).all();
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("summary")) {
    db.exec(`ALTER TABLE chapters ADD COLUMN summary TEXT NOT NULL DEFAULT '待补充章节摘要';`);
  }
  if (!columnNames.has("status")) {
    db.exec(`ALTER TABLE chapters ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';`);
  }
  if (!columnNames.has("word_target")) {
    db.exec(`ALTER TABLE chapters ADD COLUMN word_target TEXT NOT NULL DEFAULT '预估 3000字';`);
  }
}
function ensureProjectScopedColumns(db) {
  const defaultProjectId = db.prepare(`SELECT selected_project_id AS projectId FROM app_settings WHERE id = 1`).get()?.projectId || db.prepare(`SELECT id FROM projects ORDER BY rowid ASC LIMIT 1`).get()?.id || "project-1";
  const projectScopedTables = ["worldview_entries", "characters", "outline_volumes", "outline_items", "chapters", "chapter_versions", "ai_messages"];
  for (const tableName of projectScopedTables) {
    const columns = db.prepare(`PRAGMA table_info('${tableName}')`).all();
    const columnNames = new Set(columns.map((column) => column.name));
    if (!columnNames.has("project_id")) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN project_id TEXT NOT NULL DEFAULT '${defaultProjectId}';`);
    }
  }
}
function ensureVolumeColumns(db) {
  const defaultVolumeId = "volume-legacy-default";
  for (const tableName of ["outline_items", "chapters"]) {
    const columns = db.prepare(`PRAGMA table_info('${tableName}')`).all();
    const columnNames = new Set(columns.map((column) => column.name));
    if (!columnNames.has("volume_id")) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN volume_id TEXT NOT NULL DEFAULT '${defaultVolumeId}';`);
    }
  }
}
async function migrateLegacyWorkspaceFile(db) {
  const hasProject = db.prepare("SELECT id FROM projects LIMIT 1").get();
  if (hasProject) {
    return;
  }
  try {
    const legacyRaw = await promises.readFile(getWorkspaceFilePath(), "utf-8");
    const legacyPayload = JSON.parse(legacyRaw);
    writeWorkspaceSnapshot(db, normalizeWorkspacePayload(legacyPayload));
  } catch {
  }
}
function normalizeAppSettings(settings) {
  const uiScale = settings?.uiScale !== void 0 && Number.isFinite(settings.uiScale) ? Math.min(1.75, Math.max(0.75, settings.uiScale)) : 1;
  return {
    provider: settings?.provider || "deepseek",
    model: settings?.model || "deepseek-chat",
    apiKey: settings?.apiKey || "sk-1234567890abcdef",
    baseUrl: settings?.baseUrl || "https://api.deepseek.com/v1",
    autoSaveInterval: settings?.autoSaveInterval || "5m",
    uiScale
  };
}
function createFallbackVolume(title = "故事开端", volumeId = "volume-legacy-default") {
  return {
    id: volumeId,
    title,
    wordTarget: "目标 5万字",
    summary: "用于承载当前项目的默认分卷。"
  };
}
function normalizeWorkspacePayload(payload) {
  if ("workspaces" in payload && payload.workspaces) {
    return {
      ...payload,
      appSettings: normalizeAppSettings(payload.appSettings)
    };
  }
  const legacyPayload = payload;
  const projects = legacyPayload.projects?.length ? legacyPayload.projects : [];
  const selectedProjectId = legacyPayload.selectedProjectId || projects[0]?.id || "project-1";
  const workspaces = Object.fromEntries(
    projects.map((project) => [
      project.id,
      {
        outlineVolumes: project.id === selectedProjectId ? legacyPayload.outlineVolumes?.length ? legacyPayload.outlineVolumes : [createFallbackVolume()] : [],
        worldviewEntries: project.id === selectedProjectId ? legacyPayload.worldviewEntries ?? [] : [],
        characters: project.id === selectedProjectId ? legacyPayload.characters ?? [] : [],
        outlineItems: project.id === selectedProjectId ? (legacyPayload.outlineItems ?? []).map((item) => ({
          ...item,
          volumeId: item.volumeId || legacyPayload.outlineVolumes?.[0]?.id || "volume-legacy-default"
        })) : [],
        chapters: project.id === selectedProjectId ? (legacyPayload.chapters ?? []).map((chapter) => ({
          ...chapter,
          volumeId: chapter.volumeId || legacyPayload.outlineVolumes?.[0]?.id || "volume-legacy-default"
        })) : [],
        chapterVersions: project.id === selectedProjectId ? legacyPayload.chapterVersions ?? [] : [],
        messages: project.id === selectedProjectId ? legacyPayload.messages ?? [] : []
      }
    ])
  );
  return {
    theme: legacyPayload.theme,
    selectedProjectId,
    projects,
    workspaces,
    appSettings: normalizeAppSettings(legacyPayload.appSettings)
  };
}
function readWorkspaceSnapshot(db) {
  const projects = db.prepare(`
    SELECT id, title, genre, word_count AS wordCount, last_edited AS lastEdited, cover
    FROM projects
    ORDER BY rowid ASC
  `).all();
  if (projects.length === 0) {
    return null;
  }
  const worldviewEntries = db.prepare(`
    SELECT project_id AS projectId, id, type, title, content
    FROM worldview_entries
    ORDER BY project_id ASC, sort_order ASC
  `).all();
  const characters = db.prepare(`
    SELECT project_id AS projectId, id, name, role, description, avatar, tags_json AS tagsJson
    FROM characters
    ORDER BY project_id ASC, rowid ASC
  `).all().map((row) => ({
    projectId: row.projectId,
    id: row.id,
    name: row.name,
    role: row.role,
    description: row.description,
    avatar: row.avatar,
    tags: JSON.parse(row.tagsJson)
  }));
  const outlineVolumes = db.prepare(`
    SELECT project_id AS projectId, id, title, word_target AS wordTarget, summary
    FROM outline_volumes
    ORDER BY project_id ASC, sort_order ASC
  `).all();
  const outlineItems = db.prepare(`
    SELECT project_id AS projectId, volume_id AS volumeId, id, title, word_target AS wordTarget, conflict, summary
    FROM outline_items
    ORDER BY project_id ASC, sort_order ASC
  `).all();
  const chapters = db.prepare(`
    SELECT project_id AS projectId, volume_id AS volumeId, id, title, summary, status, word_target AS wordTarget, content
    FROM chapters
    ORDER BY project_id ASC, sort_order ASC
  `).all();
  const chapterVersions = db.prepare(`
    SELECT project_id AS projectId, id, chapter_id AS chapterId, title, summary, status, word_target AS wordTarget, content, created_at AS createdAt
    FROM chapter_versions
    ORDER BY project_id ASC, created_at DESC, rowid DESC
  `).all();
  const messages = db.prepare(`
    SELECT project_id AS projectId, id, role, content
    FROM ai_messages
    ORDER BY project_id ASC, sort_order ASC
  `).all();
  const settings = db.prepare(`
    SELECT theme, selected_project_id AS selectedProjectId, provider, api_key AS apiKey, base_url AS baseUrl, auto_save_interval AS autoSaveInterval
    , model, ui_scale AS uiScale
    FROM app_settings
    WHERE id = 1
  `).get();
  if (!settings) {
    return null;
  }
  const workspaces = Object.fromEntries(
    projects.map((project) => [
      project.id,
      {
        worldviewEntries: worldviewEntries.filter((entry) => entry.projectId === project.id).map(({ projectId: _projectId, ...entry }) => entry),
        characters: characters.filter((character) => character.projectId === project.id).map(({ projectId: _projectId, ...character }) => character),
        outlineVolumes: outlineVolumes.filter((volume) => volume.projectId === project.id).map(({ projectId: _projectId, ...volume }) => volume),
        outlineItems: outlineItems.filter((item) => item.projectId === project.id).map(({ projectId: _projectId, ...item }) => item),
        chapters: chapters.filter((chapter) => chapter.projectId === project.id).map(({ projectId: _projectId, ...chapter }) => chapter),
        chapterVersions: chapterVersions.filter((version) => version.projectId === project.id).map(({ projectId: _projectId, ...version }) => version),
        messages: messages.filter((message) => message.projectId === project.id).map(({ projectId: _projectId, ...message }) => message)
      }
    ])
  );
  return {
    theme: settings.theme,
    selectedProjectId: settings.selectedProjectId,
    projects,
    workspaces,
    appSettings: {
      ...normalizeAppSettings({
        provider: settings.provider,
        model: settings.model,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        autoSaveInterval: settings.autoSaveInterval,
        uiScale: settings.uiScale
      })
    }
  };
}
function writeWorkspaceSnapshot(db, payload) {
  db.exec("BEGIN");
  try {
    db.exec(`
      DELETE FROM projects;
      DELETE FROM worldview_entries;
      DELETE FROM characters;
      DELETE FROM outline_volumes;
      DELETE FROM outline_items;
      DELETE FROM chapter_versions;
      DELETE FROM chapters;
      DELETE FROM ai_messages;
      DELETE FROM app_settings;
    `);
    const insertProject = db.prepare(`
      INSERT INTO projects (id, title, genre, word_count, last_edited, cover)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const project of payload.projects) {
      insertProject.run(project.id, project.title, project.genre, project.wordCount, project.lastEdited, project.cover);
    }
    const insertWorldview = db.prepare(`
      INSERT INTO worldview_entries (id, project_id, type, title, content, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertCharacter = db.prepare(`
      INSERT INTO characters (id, project_id, name, role, description, avatar, tags_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertOutlineVolume = db.prepare(`
      INSERT INTO outline_volumes (id, project_id, title, word_target, summary, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertOutline = db.prepare(`
      INSERT INTO outline_items (id, project_id, volume_id, title, word_target, conflict, summary, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertChapter = db.prepare(`
      INSERT INTO chapters (id, project_id, volume_id, title, summary, status, word_target, content, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertChapterVersion = db.prepare(`
      INSERT INTO chapter_versions (id, project_id, chapter_id, title, summary, status, word_target, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMessage = db.prepare(`
      INSERT INTO ai_messages (id, project_id, role, content, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const project of payload.projects) {
      const workspace = payload.workspaces[project.id] ?? {
        worldviewEntries: [],
        characters: [],
        outlineVolumes: [],
        outlineItems: [],
        chapters: [],
        chapterVersions: [],
        messages: []
      };
      workspace.worldviewEntries.forEach((entry, index) => {
        insertWorldview.run(entry.id, project.id, entry.type, entry.title, entry.content, index);
      });
      workspace.characters.forEach((character) => {
        insertCharacter.run(
          character.id,
          project.id,
          character.name,
          character.role,
          character.description,
          character.avatar,
          JSON.stringify(character.tags)
        );
      });
      workspace.outlineVolumes.forEach((volume, index) => {
        insertOutlineVolume.run(volume.id, project.id, volume.title, volume.wordTarget, volume.summary, index);
      });
      workspace.outlineItems.forEach((item, index) => {
        insertOutline.run(item.id, project.id, item.volumeId, item.title, item.wordTarget, item.conflict, item.summary, index);
      });
      workspace.chapters.forEach((chapter, index) => {
        insertChapter.run(
          chapter.id,
          project.id,
          chapter.volumeId,
          chapter.title,
          chapter.summary,
          chapter.status,
          chapter.wordTarget,
          chapter.content,
          index
        );
      });
      workspace.chapterVersions.forEach((version) => {
        insertChapterVersion.run(
          version.id,
          project.id,
          version.chapterId,
          version.title,
          version.summary,
          version.status,
          version.wordTarget,
          version.content,
          version.createdAt
        );
      });
      workspace.messages.forEach((message, index) => {
        insertMessage.run(message.id, project.id, message.role, message.content, index);
      });
    }
    db.prepare(`
      INSERT INTO app_settings (id, theme, selected_project_id, provider, model, api_key, base_url, auto_save_interval, ui_scale)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.theme,
      payload.selectedProjectId,
      normalizeAppSettings(payload.appSettings).provider,
      normalizeAppSettings(payload.appSettings).model,
      normalizeAppSettings(payload.appSettings).apiKey,
      normalizeAppSettings(payload.appSettings).baseUrl,
      normalizeAppSettings(payload.appSettings).autoSaveInterval,
      normalizeAppSettings(payload.appSettings).uiScale
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function validateImportedWorkspace(payload) {
  if (!payload || typeof payload !== "object") {
    return { valid: false, message: "导入文件不是有效的项目对象。" };
  }
  const data = payload;
  if (!data.project || typeof data.project !== "object") {
    return { valid: false, message: "缺少 project 字段，无法识别项目基础信息。" };
  }
  const project = data.project;
  if (typeof project.title !== "string" || !project.title.trim()) {
    return { valid: false, message: "project.title 缺失或为空。" };
  }
  const collectionChecks = [
    ["worldviewEntries", data.worldviewEntries],
    ["characters", data.characters],
    ["outlineVolumes", data.outlineVolumes],
    ["outlineItems", data.outlineItems],
    ["chapters", data.chapters],
    ["chapterVersions", data.chapterVersions]
  ];
  for (const [field, value] of collectionChecks) {
    if (value !== void 0 && !Array.isArray(value)) {
      return { valid: false, message: `${field} 必须是数组格式。` };
    }
  }
  if (Array.isArray(data.outlineVolumes)) {
    const invalidVolume = data.outlineVolumes.find((item) => {
      if (!item || typeof item !== "object") return true;
      const volume = item;
      return typeof volume.title !== "string" || volume.wordTarget !== void 0 && typeof volume.wordTarget !== "string" || volume.summary !== void 0 && typeof volume.summary !== "string";
    });
    if (invalidVolume) {
      return { valid: false, message: "outlineVolumes 中存在字段缺失或格式错误的分卷项。" };
    }
  }
  if (Array.isArray(data.outlineItems)) {
    const invalidOutlineItem = data.outlineItems.find((item) => {
      if (!item || typeof item !== "object") return true;
      const outlineItem = item;
      return typeof outlineItem.title !== "string" || outlineItem.volumeId !== void 0 && typeof outlineItem.volumeId !== "string" || outlineItem.wordTarget !== void 0 && typeof outlineItem.wordTarget !== "string" || outlineItem.conflict !== void 0 && typeof outlineItem.conflict !== "string" || outlineItem.summary !== void 0 && typeof outlineItem.summary !== "string";
    });
    if (invalidOutlineItem) {
      return { valid: false, message: "outlineItems 中存在字段缺失或格式错误的大纲节点。" };
    }
  }
  if (Array.isArray(data.chapters)) {
    const invalidChapter = data.chapters.find((item) => {
      if (!item || typeof item !== "object") return true;
      const chapter = item;
      return typeof chapter.title !== "string" || typeof chapter.content !== "string" || chapter.volumeId !== void 0 && typeof chapter.volumeId !== "string" || chapter.summary !== void 0 && typeof chapter.summary !== "string" || chapter.status !== void 0 && typeof chapter.status !== "string" || chapter.wordTarget !== void 0 && typeof chapter.wordTarget !== "string";
    });
    if (invalidChapter) {
      return { valid: false, message: "chapters 中存在字段缺失或格式错误的章节项。" };
    }
  }
  if (Array.isArray(data.chapterVersions)) {
    const invalidVersion = data.chapterVersions.find((item) => {
      if (!item || typeof item !== "object") return true;
      const version = item;
      return typeof version.chapterId !== "string" || typeof version.title !== "string" || typeof version.content !== "string" || typeof version.createdAt !== "string" || version.summary !== void 0 && typeof version.summary !== "string" || version.status !== void 0 && typeof version.status !== "string" || version.wordTarget !== void 0 && typeof version.wordTarget !== "string";
    });
    if (invalidVersion) {
      return { valid: false, message: "chapterVersions 中存在字段缺失或格式错误的版本项。" };
    }
  }
  return { valid: true };
}
function resolveImageMime(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}
electron.ipcMain.handle("characterarc:export-json", async (_event, payload) => {
  const window = electron.BrowserWindow.getFocusedWindow();
  if (!window) {
    return { success: false, canceled: true };
  }
  const request = payload && typeof payload === "object" && "data" in payload ? payload : {
    data: payload
  };
  const result = await electron.dialog.showSaveDialog(window, {
    title: request.title ?? "导出项目数据",
    defaultPath: request.defaultPath ?? "characterarc-export.json",
    filters: [
      { name: "JSON 文件", extensions: ["json"] }
    ]
  });
  if (result.canceled || !result.filePath) {
    return { success: false, canceled: true };
  }
  await promises.writeFile(result.filePath, JSON.stringify(request.data, null, 2), "utf-8");
  return {
    success: true,
    canceled: false,
    filePath: result.filePath
  };
});
electron.ipcMain.handle("characterarc:export-text", async (_event, payload) => {
  const window = electron.BrowserWindow.getFocusedWindow();
  if (!window) {
    return { success: false, canceled: true };
  }
  const request = payload && typeof payload === "object" && "data" in payload ? payload : {
    data: payload
  };
  const result = await electron.dialog.showSaveDialog(window, {
    title: request.title ?? "导出章节文本",
    defaultPath: request.defaultPath ?? "characterarc-export.txt",
    filters: [
      { name: "文本文档", extensions: ["txt"] }
    ]
  });
  if (result.canceled || !result.filePath) {
    return { success: false, canceled: true };
  }
  const data = request.data;
  const volumeTitleMap = new Map((data.outlineVolumes ?? []).map((volume) => [volume.id ?? "", volume.title?.trim() || "未命名分卷"]));
  let activeVolumeId = "";
  const text = [
    data.project?.title ? `# ${data.project.title}` : "# CharacterArc 导出",
    "",
    ...(data.chapters ?? []).flatMap((chapter, index) => {
      const shouldPrintVolume = chapter.volumeId && chapter.volumeId !== activeVolumeId;
      if (chapter.volumeId) {
        activeVolumeId = chapter.volumeId;
      }
      return [
        ...shouldPrintVolume ? [`## ${volumeTitleMap.get(chapter.volumeId ?? "") || "未命名分卷"}`, ""] : [],
        `第${index + 1}章 ${chapter.title ?? "未命名章节"}`,
        "",
        chapter.content?.trim() || "（暂无正文内容）",
        "",
        "".padEnd(48, "-"),
        ""
      ];
    })
  ].join("\n");
  await promises.writeFile(result.filePath, text, "utf-8");
  return {
    success: true,
    canceled: false,
    filePath: result.filePath
  };
});
electron.ipcMain.handle("characterarc:import-json", async () => {
  const window = electron.BrowserWindow.getFocusedWindow();
  if (!window) {
    return { success: false, canceled: true };
  }
  const result = await electron.dialog.showOpenDialog(window, {
    title: "导入项目 JSON",
    properties: ["openFile"],
    filters: [
      { name: "JSON 文件", extensions: ["json"] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }
  const raw = await promises.readFile(result.filePaths[0], "utf-8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      success: false,
      canceled: false,
      error: "文件不是有效的 JSON 格式。"
    };
  }
  const validation = validateImportedWorkspace(parsed);
  if (!validation.valid) {
    return {
      success: false,
      canceled: false,
      error: validation.message
    };
  }
  return {
    success: true,
    canceled: false,
    payload: parsed
  };
});
electron.ipcMain.handle("characterarc:pick-cover-image", async () => {
  const window = electron.BrowserWindow.getFocusedWindow();
  if (!window) {
    return { success: false, canceled: true };
  }
  const result = await electron.dialog.showOpenDialog(window, {
    title: "选择项目封面",
    properties: ["openFile"],
    filters: [
      { name: "图片文件", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }
  const filePath = result.filePaths[0];
  const bytes = await promises.readFile(filePath);
  const mime = resolveImageMime(filePath);
  return {
    success: true,
    canceled: false,
    filePath,
    dataUrl: `data:${mime};base64,${bytes.toString("base64")}`
  };
});
electron.ipcMain.handle("characterarc:ai-generate", async (_event, payload) => {
  try {
    const result = await generateAiTask(payload);
    return {
      success: true,
      result
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "AI 调用失败"
    };
  }
});
electron.ipcMain.handle("characterarc:ai-stream-start", async (event, payload) => {
  try {
    const streamId = `stream-${node_crypto.randomUUID()}`;
    const controller = new AbortController();
    activeAiStreams.set(streamId, controller);
    let streamedContent = "";
    void (async () => {
      try {
        const result = await streamAiTask(
          payload,
          {
            onTextDelta: (delta) => {
              streamedContent += delta;
              if (!event.sender.isDestroyed()) {
                event.sender.send("characterarc:ai-stream-event", {
                  streamId,
                  type: "chunk",
                  delta
                });
              }
            }
          },
          controller.signal
        );
        if (!event.sender.isDestroyed()) {
          event.sender.send("characterarc:ai-stream-event", {
            streamId,
            type: "done",
            content: result.content
          });
        }
      } catch (error) {
        if (!event.sender.isDestroyed()) {
          event.sender.send(
            "characterarc:ai-stream-event",
            controller.signal.aborted ? {
              streamId,
              type: "canceled",
              content: streamedContent
            } : {
              streamId,
              type: "error",
              error: error instanceof Error ? error.message : "AI 流式调用失败"
            }
          );
        }
      } finally {
        activeAiStreams.delete(streamId);
      }
    })();
    return {
      success: true,
      result: {
        streamId
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "AI 流式调用启动失败"
    };
  }
});
electron.ipcMain.handle("characterarc:ai-stream-stop", async (_event, streamId) => {
  const key = typeof streamId === "string" ? streamId : "";
  const controller = activeAiStreams.get(key);
  if (!controller) {
    return {
      success: false,
      error: "当前没有可停止的生成任务"
    };
  }
  controller.abort();
  return {
    success: true
  };
});
electron.ipcMain.handle("characterarc:ai-test-connection", async (_event, settings) => {
  try {
    const result = await testAiConnection(settings);
    return {
      success: true,
      result
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "AI 连接测试失败"
    };
  }
});
electron.ipcMain.handle("characterarc:assistant-window-open", async () => {
  try {
    createAssistantWindow();
    return {
      success: true,
      visible: true
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "AI 助手窗口打开失败"
    };
  }
});
electron.ipcMain.handle("characterarc:assistant-window-close", async () => {
  try {
    if (assistantWindow && !assistantWindow.isDestroyed()) {
      assistantWindow.close();
    } else {
      emitAssistantWindowVisibility(false);
    }
    return {
      success: true,
      visible: false
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "AI 助手窗口关闭失败"
    };
  }
});
electron.ipcMain.handle("characterarc:assistant-window-state", () => ({
  success: true,
  visible: Boolean(assistantWindow && !assistantWindow.isDestroyed())
}));
electron.ipcMain.handle("characterarc:assistant-context-publish", (_event, payload) => {
  latestAssistantContext = payload && typeof payload === "object" ? payload : {};
  sendWindowEvent(assistantWindow, "characterarc:assistant-context", latestAssistantContext);
  return {
    success: true
  };
});
electron.ipcMain.handle("characterarc:assistant-context-get", () => ({
  success: true,
  payload: latestAssistantContext
}));
electron.ipcMain.handle("characterarc:assistant-prompt-publish", (_event, payload) => {
  latestAssistantPrompt = payload && typeof payload === "object" ? payload : null;
  sendWindowEvent(assistantWindow, "characterarc:assistant-prompt", latestAssistantPrompt);
  return {
    success: true
  };
});
electron.ipcMain.handle("characterarc:assistant-prompt-get", () => ({
  success: true,
  payload: latestAssistantPrompt
}));
electron.ipcMain.handle("characterarc:assistant-prompt-clear", (_event, promptId) => {
  if (typeof promptId === "string" && latestAssistantPrompt?.id === promptId) {
    latestAssistantPrompt = null;
  }
  return {
    success: true
  };
});
electron.ipcMain.handle("characterarc:workspace-sync-publish", (event, payload) => {
  broadcastWindowEvent("characterarc:workspace-sync-event", payload, event.sender.id);
  return {
    success: true
  };
});
electron.ipcMain.handle("characterarc:assistant-command-publish", (_event, payload) => {
  sendWindowEvent(mainWindow, "characterarc:assistant-command", payload);
  return {
    success: true
  };
});
electron.ipcMain.handle("characterarc:load-workspace", async () => {
  try {
    const db = await ensureWorkspaceDb();
    const workspace = readWorkspaceSnapshot(db);
    if (!workspace) {
      return {
        success: false,
        payload: null
      };
    }
    return {
      success: true,
      payload: workspace
    };
  } catch (error) {
    return {
      success: false,
      payload: null,
      error: error instanceof Error ? error.message : "Unknown workspace load error"
    };
  }
});
electron.ipcMain.handle("characterarc:get-zoom-factor", () => {
  const window = electron.BrowserWindow.getFocusedWindow() ?? electron.BrowserWindow.getAllWindows()[0];
  if (!window) {
    return {
      success: false,
      error: "No active window"
    };
  }
  return {
    success: true,
    factor: window.webContents.getZoomFactor()
  };
});
electron.ipcMain.handle("characterarc:set-zoom-factor", (_event, factor) => {
  const window = electron.BrowserWindow.getFocusedWindow() ?? electron.BrowserWindow.getAllWindows()[0];
  if (!window) {
    return {
      success: false,
      error: "No active window"
    };
  }
  const numericFactor = typeof factor === "number" ? factor : Number(factor);
  const nextFactor = Number.isFinite(numericFactor) ? Math.min(1.75, Math.max(0.75, numericFactor)) : 1;
  window.webContents.setZoomFactor(nextFactor);
  return {
    success: true,
    factor: nextFactor
  };
});
electron.ipcMain.handle("characterarc:save-workspace", async (_event, payload) => {
  try {
    const db = await ensureWorkspaceDb();
    writeWorkspaceSnapshot(db, normalizeWorkspacePayload(payload));
    return {
      success: true
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown workspace save error"
    };
  }
});
electron.app.whenReady().then(() => {
  createMainWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
