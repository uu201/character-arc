"use strict";
const electron = require("electron");
const node_path = require("node:path");
const promises = require("node:fs/promises");
const node_sqlite = require("node:sqlite");
function resolveProviderDefaults(provider) {
  switch (provider) {
    case "openai":
      return { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" };
    case "deepseek":
      return { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" };
    case "anthropic":
      return { baseUrl: "https://api.anthropic.com", model: "claude-3-5-sonnet-latest" };
    case "ollama":
      return { baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.2" };
    default:
      return { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" };
  }
}
function normalizeSettings(settings) {
  const defaults = resolveProviderDefaults(settings.provider);
  return {
    provider: settings.provider,
    model: settings.model?.trim() || defaults.model,
    apiKey: settings.apiKey?.trim() || "",
    baseUrl: settings.baseUrl?.trim() || defaults.baseUrl
  };
}
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
    return {
      system: "你是 CharacterArc 的小说创作助理。请基于当前项目和章节上下文，用中文直接输出可供作者使用的正文、润色稿、分析或建议。不要输出 Markdown 标题，不要解释你是 AI，也不要返回 JSON。",
      user: `请处理当前写作请求，并优先给出可直接使用的结果。

项目标题：${String(context.projectTitle ?? "")}
项目题材：${String(context.projectGenre ?? "")}
当前章节标题：${String(context.chapterTitle ?? "")}
当前章节摘要：${String(context.chapterSummary ?? "")}
当前章节状态：${String(context.chapterStatus ?? "")}
当前章节预估字数：${String(context.chapterWordTarget ?? "")}
当前章节正文：
${String(context.chapterContent ?? "")}

相关世界观：
${worldviewEntries || "暂无"}

相关角色：
${characters || "暂无"}

相关大纲：
${outlineItems || "暂无"}

快捷动作：${String(context.quickAction ?? "自由提问")}
用户请求：${String(context.userPrompt ?? "")}

要求：
1. 回答要紧贴当前章节上下文
2. 如果请求是润色、续写、描写，请优先输出可直接插入正文的内容
3. 如果请求是分析或建议，请给出清晰可执行的建议
4. 控制篇幅，默认输出 120 到 400 字，除非用户明确要求更长`
    };
  }
  return {
    system: "你是小说剧情大纲助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 title、wordTarget、conflict、summary。",
    user: `基于以下上下文，为当前小说项目补充一个新的章节大纲节点。

项目标题：${String(context.projectTitle ?? "")}
项目题材：${String(context.projectGenre ?? "")}
已有大纲：${JSON.stringify(context.outlineTitles ?? [])}
世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}

要求：
1. title 为新的章节标题
2. wordTarget 使用“预估 xxxx字”格式
3. conflict 用一句话概括核心冲突
4. summary 用中文描述剧情推进，80 到 180 字

返回格式：{"title":"","wordTarget":"","conflict":"","summary":""}`
  };
}
function extractJsonObject(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] ?? text;
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  const jsonSlice = firstBrace >= 0 && lastBrace >= 0 ? raw.slice(firstBrace, lastBrace + 1) : raw;
  return JSON.parse(jsonSlice);
}
function normalizeAssistantText(text) {
  const cleaned = text.replace(/```[\w-]*\n?/g, "").replace(/```/g, "").trim();
  return {
    content: cleaned
  };
}
async function requestOpenAiCompatible(settings, prompt) {
  const response = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.8,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user }
      ]
    })
  });
  if (!response.ok) {
    throw new Error(`AI 请求失败：${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI 返回内容为空");
  }
  return content;
}
async function requestAnthropic(settings, prompt) {
  const response = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 600,
      system: prompt.system,
      messages: [
        { role: "user", content: prompt.user }
      ]
    })
  });
  if (!response.ok) {
    throw new Error(`Anthropic 请求失败：${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  const content = data.content?.find((item) => item.type === "text")?.text;
  if (!content) {
    throw new Error("Anthropic 返回内容为空");
  }
  return content;
}
async function generateAiTask(task) {
  const settings = normalizeSettings(task.settings);
  const prompt = buildTaskPrompt(task);
  let rawText = "";
  if (settings.provider === "anthropic") {
    rawText = await requestAnthropic(settings, prompt);
  } else {
    rawText = await requestOpenAiCompatible(settings, prompt);
  }
  if (task.task === "chapter-assistant") {
    return normalizeAssistantText(rawText);
  }
  return extractJsonObject(rawText);
}
const APP_DEFAULT_WIDTH = 1480;
const APP_DEFAULT_HEIGHT = 920;
const APP_MIN_WIDTH = 1120;
const APP_MIN_HEIGHT = 720;
const WORKSPACE_DB = "workspace.db";
const WORKSPACE_FILE = "workspace.json";
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
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    void window.loadFile(node_path.join(__dirname, "../../dist/index.html"));
  }
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
      auto_save_interval TEXT NOT NULL
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
    return payload;
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
    appSettings: legacyPayload.appSettings
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
    , model
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
      provider: settings.provider,
      model: settings.model,
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      autoSaveInterval: settings.autoSaveInterval
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
      INSERT INTO app_settings (id, theme, selected_project_id, provider, model, api_key, base_url, auto_save_interval)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.theme,
      payload.selectedProjectId,
      payload.appSettings.provider,
      payload.appSettings.model,
      payload.appSettings.apiKey,
      payload.appSettings.baseUrl,
      payload.appSettings.autoSaveInterval
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
