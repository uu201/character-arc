#!/usr/bin/env node
/**
 * 黑岩短篇书库列表采集脚本
 *
 * ⚠️ 前置条件（必须）：
 *   1. 启动 Chrome CDP 环境
 *   2. 在 Chrome 中手动登录 https://manage.zhangwenpindu.cn
 *      登录后会生成 Admin-Token cookie，脚本需要它调用后端 API
 *      未登录 → 脚本报错「未检测到 Admin-Token」
 *
 * 采集策略：从 Cookie 提取 Bearer token，调用 ms.zhangwenpindu.cn 后端 API
 * 获取结构化 JSON 数据（书名、作者、字数、分类、标签等）。
 *
 * 用法：
 *   node heiyan-booklist-scraper.js --pages 5              # 采集前5页（每页20条）
 *   node heiyan-booklist-scraper.js --pages 3 --channel male   # 仅男频
 *   node heiyan-booklist-scraper.js --pages 2 --detail         # 含逐本详情（标签等）
 */

const fs = require("fs");
const path = require("path");
const { ab, sleep, evalJSON, safeStr, getArg } = require("./cdp-utils");

const BOOKLIST_URL = "https://manage.zhangwenpindu.cn/books/booklist";
const API_BASE = "https://ms.zhangwenpindu.cn";
const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// API 调用
// ---------------------------------------------------------------------------

/** 从 Cookie 中提取 Admin-Token */
function getToken(port) {
  const js =
    "JSON.stringify((()=>{" +
    "var m=document.cookie.match(/Admin-Token=([^;]+)/);" +
    "return m?m[1]:''" +
    "})())";
  return evalJSON(port, js) || "";
}

/** 调用后端 API 获取书籍列表 */
function fetchBookList(port, token, pageNum) {
  const t = safeStr(token);
  const js =
    "fetch(" + safeStr(API_BASE + "/manage/book/list") + "," +
    "{method:'POST'," +
    "headers:{" +
    "'Content-Type':'application/x-www-form-urlencoded'," +
    "'Authorization':'Bearer '+" + t +
    "}," +
    "body:new URLSearchParams({pageNum:" + safeStr(pageNum) + ",pageSize:" + safeStr(PAGE_SIZE) + ",language:'zh_TW'})" +
    "}).then(function(r){return r.json()})";
  return evalJSON(port, js);
}

/** 调用后端 API 获取书籍详情（标签等） */
function fetchBookDetail(port, token, bookId) {
  const t = safeStr(token);
  const js =
    "fetch(" + safeStr(API_BASE + "/manage/book/" + encodeURIComponent(bookId)) + "," +
    "{headers:{'Authorization':'Bearer '+" + t + "}}" +
    ").then(function(r){return r.json()})";
  return evalJSON(port, js);
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const PORT = parseInt(getArg(args, "--port") || "9222", 10);
const OUTDIR = getArg(args, "--outdir") || ".";
const PAGES = parseInt(getArg(args, "--pages") || "5", 10);
const CHANNEL = getArg(args, "--channel") || "all";
const DETAIL = args.includes("--detail");

function buildAndSave(allBooks, total, filtered, filepath) {
  const now = new Date().toISOString();
  const maleBooks = filtered.filter((b) => b.classifyStr === "男频");
  const femaleBooks = filtered.filter((b) => b.classifyStr === "女频");
  const otherBooks = filtered.filter(
    (b) => b.classifyStr !== "男频" && b.classifyStr !== "女频"
  );

  const groups = [
    { label: "男频", books: maleBooks },
    { label: "女频", books: femaleBooks },
  ];
  if (otherBooks.length) {
    groups.push({ label: "其他", books: otherBooks });
  }

  const lines = [
    `# 黑岩 · 书库列表`,
    "",
    `- 来源：${BOOKLIST_URL}`,
    `- 抓取时间：${now}`,
    `- 总条目：${total}`,
    `- 已采集：${filtered.length} 条（${PAGES} 页）`,
    DETAIL ? "- 含详情（标签、简介）" : "- 列表模式（加 --detail 获取标签和简介）",
    "",
    "---",
    "",
  ];

  for (const g of groups) {
    if (!g.books.length) continue;
    lines.push(`## ${g.label}短篇 — ${g.books.length} 本`, "");

    for (let i = 0; i < g.books.length; i++) {
      try {
        const b = g.books[i];
        lines.push(`### #${i + 1} ${b.name}`);
        const meta = [
          b.userName,
          b.classifyStr + "/" + b.typeDesc,
          b.words ? b.words.toLocaleString() + "字" : "",
          b.price ? b.price + "钻" : "",
          b.open ? "公开" : "未公开",
        ].filter(Boolean).join(" · ");
        if (meta) lines.push(`*${meta}*`);

        if (b.createTime) lines.push(`**创建：** ${b.createTime}`);
        if (b.updateTime) lines.push(`**更新：** ${b.updateTime}`);

        if (b.tags && b.tags.length) {
          lines.push(`**标签：** ${b.tags.join("、")}`);
        }

        if (b.description) {
          lines.push("");
          lines.push(`> ${b.description.substring(0, 200)}${b.description.length > 200 ? "..." : ""}`);
        }

        lines.push("");
      } catch (bookErr) {
        console.error(`[heiyan] ${g.label} 第${i + 1}条处理出错: ${bookErr.message}`);
        lines.push("");
      }
    }

    lines.push("---", "");
  }

  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.writeFileSync(filepath, lines.join("\n"), "utf-8");
  console.log(`  ✓ 已保存: ${filepath}`);
}

function main() {
  console.log("\n→ 采集 黑岩书库列表（API 模式）...");
  console.log(`  计划采集: ${PAGES} 页（每页 ${PAGE_SIZE} 条）`);

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `黑岩书库列表_${date}.md`;
  const filepath = path.join(OUTDIR, filename);

  // 先导航到管理后台获取 token
  let token;
  try {
    ab(PORT, "open", BOOKLIST_URL);
    sleep(3000);
    token = getToken(PORT);
  } catch (err) {
    console.error(`[heiyan] 页面加载或 token 提取出错: ${err.message}`);
    return;
  }

  if (!token) {
    console.log("  ✗ 未检测到 Admin-Token");
    console.log("  → 请先在 Chrome 中打开 https://manage.zhangwenpindu.cn 并登录");
    console.log("  → 登录后重新运行本脚本");
    return;
  }
  console.log("  ✓ 获取到认证 token");

  // 分页采集
  const allBooks = [];
  let total = 0;

  for (let p = 1; p <= PAGES; p++) {
    try {
      sleep(800);
      const resp = fetchBookList(PORT, token, p);

      if (!resp || resp.code === 401) {
        console.log(`  ⚠ 第${p}页认证失败，请重新登录`);
        break;
      }

      const rows = resp?.data?.rows;
      if (!rows || !rows.length) {
        console.log(`  第${p}页无数据，停止`);
        break;
      }

      if (p === 1) {
        total = parseInt(resp.data.total) || 0;
        console.log(`  总条目: ${total}`);
      }

      allBooks.push(...rows);
      console.log(`  第${p}页: ${rows.length} 条 (累计 ${allBooks.length})`);
    } catch (pageErr) {
      console.error(`[heiyan] 第${p}页采集出错，跳过: ${pageErr.message}`);
      if (allBooks.length > 0) {
        console.log(`  已采集 ${allBooks.length} 条，继续处理已有数据`);
      }
      break;
    }
  }

  if (!allBooks.length) {
    console.error("[heiyan] 采集失败：页面结构可能已变（选择器没匹配到数据），请检查榜单URL或更新选择器");
    return;
  }

  // 频道筛选
  let filtered = allBooks;
  if (CHANNEL === "male") {
    filtered = allBooks.filter((b) => b.classifyStr === "男频");
  } else if (CHANNEL === "female") {
    filtered = allBooks.filter((b) => b.classifyStr === "女频");
  }

  // 可选：逐本获取详情（标签等）
  if (DETAIL && filtered.length) {
    console.log(`  获取 ${filtered.length} 本详情...`);
    for (let i = 0; i < filtered.length; i++) {
      try {
        sleep(500);
        const detail = fetchBookDetail(PORT, token, filtered[i].id);
        if (detail?.data) {
          filtered[i].tags = detail.data.tags || [];
          filtered[i].description = detail.data.description || "";
          filtered[i].chapterCount = detail.data.chapterCount || 0;
        }
        if ((i + 1) % 10 === 0) {
          console.log(`    已获取 ${i + 1}/${filtered.length}`);
        }
      } catch (detailErr) {
        console.error(`[heiyan] 第${i + 1}本详情获取出错，跳过: ${detailErr.message}`);
      }
    }
    console.log("  ✓ 详情获取完成");
  }

  buildAndSave(allBooks, total, filtered, filepath);
}

try {
  main();
} catch (e) {
  console.error(`黑岩采集失败: ${e && e.message ? e.message : e}`);
  process.exit(1);
}
