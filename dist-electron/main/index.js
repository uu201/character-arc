"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const electron = require("electron");
const node_path = require("node:path");
const promises = require("node:fs/promises");
const node_fs = require("node:fs");
const node_sqlite = require("node:sqlite");
const node_crypto = require("node:crypto");
const DEFAULT_STRATEGY = {
  storyFocus: "先锁定主角最明确的欲望、最现实的阻力和最有辨识度的切入场景。",
  worldviewBias: "世界观只保留最支撑剧情推进的 3 条骨架信息，避免泛泛堆设定。",
  conflictStyle: "冲突要尽快落到人物选择、利益碰撞或情绪压力上，不写空泛口号。",
  outlineShape: "三条大纲要形成起势、升级、钩子收束的连续推进。",
  toneConstraints: "语言保持中文网文可读性，重视画面感、目标感和悬念。"
};
const GENRE_STRATEGIES = {
  科幻: {
    storyFocus: "优先明确核心科技设定、社会秩序变化，以及主角如何被卷入其中。",
    worldviewBias: "多写技术规则、资源分配、城市生态或文明断层，不写空洞名词。",
    conflictStyle: "冲突以技术代价、认知差异、制度压迫或生存抉择为主。",
    outlineShape: "先抛异常，再暴露系统性问题，最后给出更大阴影或实验真相。",
    toneConstraints: "兼顾冷感想象与人性压力，避免纯说明书式设定堆砌。"
  },
  奇幻: {
    storyFocus: "先确定主角进入异世界秩序后的生存目标和力量诱因。",
    worldviewBias: "多写地域风貌、超凡规则、族群差异和古老禁忌。",
    conflictStyle: "冲突以试炼、阵营纷争、宿命牵引和代价交换为主。",
    outlineShape: "以异象或事件开局，逐步引出更大的势力棋局。",
    toneConstraints: "要有冒险感和奇观感，但核心仍围绕人物选择。"
  },
  仙侠: {
    storyFocus: "明确主角求生、求道或逆袭的起点，以及最初资源缺口。",
    worldviewBias: "多写修行法则、门派秩序、资源层级和因果代价。",
    conflictStyle: "冲突强调实力差、资源争夺、师门规训和心性考验。",
    outlineShape: "先立弱势困局，再给机缘入口，随后迅速出现同阶或上位压制。",
    toneConstraints: "要有修行进阶感，但避免流水账式升级。"
  },
  都市: {
    storyFocus: "先锁定主角在现实秩序中的身份处境、核心欲望和现实压力。",
    worldviewBias: "世界观聚焦行业生态、阶层差异、城市空间和社会规则。",
    conflictStyle: "冲突应贴近利益、关系、舆论、职场或家庭压力。",
    outlineShape: "先给现实难题，再出现破局契机，最后埋下更高层压力。",
    toneConstraints: "保持现实质感，少悬浮，少空喊逆袭。"
  },
  悬疑: {
    storyFocus: "优先明确案件、谜团或异常事件与主角的直接关系。",
    worldviewBias: "世界观服务线索链和真相反差，不做无关扩展。",
    conflictStyle: "冲突以信息差、误导、时间压力和信任崩塌为主。",
    outlineShape: "三条大纲应形成发现异常、深入调查、反转钩子。",
    toneConstraints: "保持克制和压迫感，避免一上来透光全部底牌。"
  },
  历史: {
    storyFocus: "明确时代背景下主角最现实的立身难题与行动目标。",
    worldviewBias: "多写制度、地缘、人情秩序和时代风貌。",
    conflictStyle: "冲突围绕身份、立场、家族、政局或生存资源展开。",
    outlineShape: "先通过具体事件落地时代，再逐步拉出更大局势。",
    toneConstraints: "有时代气息，但不要写成资料摘抄。"
  },
  言情: {
    storyFocus: "主线必须同时包含情感牵引和现实处境，不能只剩恋爱对白。",
    worldviewBias: "世界观聚焦人物关系场、家庭/职场/身份差异和情感禁区。",
    conflictStyle: "冲突以误解、拉扯、身份阻碍、旧伤或价值观冲突为主。",
    outlineShape: "先制造吸引与不对位，再升级拉扯，最后留下情感钩子。",
    toneConstraints: "情绪要细腻，但不能空转，要有事件推动。"
  },
  恐怖: {
    storyFocus: "先确定恐惧源、规则漏洞和主角无法回避的处境。",
    worldviewBias: "世界观围绕禁忌空间、污染规则、传闻与异常机制展开。",
    conflictStyle: "冲突强调未知、压迫、认知崩裂和生存倒计时。",
    outlineShape: "由异样进入，快速触发规则，再以更大恐惧收束。",
    toneConstraints: "氛围优先，少解释过满，让危险感持续存在。"
  },
  校园: {
    storyFocus: "主角目标要和成长、友情、竞争或情感困境直接绑定。",
    worldviewBias: "多写班级生态、社团秩序、家庭影响和青春场景。",
    conflictStyle: "冲突围绕自我认同、成绩、关系变化和青春压力。",
    outlineShape: "先建立校园日常，再打破平衡，最后抛出下一轮情绪冲突。",
    toneConstraints: "要有青春现场感，避免成人化说教。"
  },
  轻小说: {
    storyFocus: "先明确高概念设定和主角的鲜明反应机制。",
    worldviewBias: "世界观突出设定梗、阵营趣味和可持续展开的规则。",
    conflictStyle: "冲突强调设定差异、人物互动火花和轻快推进。",
    outlineShape: "开局即给设定亮点，中段放大反差，尾部抛新梗。",
    toneConstraints: "节奏轻快、画面明确，但不能失去故事主线。"
  },
  末世: {
    storyFocus: "明确灾变机制、主角第一生存目标和最紧缺资源。",
    worldviewBias: "多写生存秩序、资源系统、据点生态和人性失衡。",
    conflictStyle: "冲突以生存竞争、信任危机、规则崩坏和环境威胁为主。",
    outlineShape: "先给危机现场，再建立临时秩序，随后撕开更大灾难面。",
    toneConstraints: "压迫感要足，但不能只剩喊杀和堆惨。"
  },
  游戏竞技: {
    storyFocus: "主角的竞技目标、团队位置和关键短板要尽快明确。",
    worldviewBias: "世界观聚焦赛事体系、版本规则、队伍关系和职业生态。",
    conflictStyle: "冲突应围绕比赛、磨合、舆论、操作差距和心态波动。",
    outlineShape: "先给竞技舞台，再暴露团队问题，最后抛关键对局钩子。",
    toneConstraints: "专业术语要能落地，别写成空热血。"
  },
  古言: {
    storyFocus: "先确定主角在礼法和家族结构中的处境与目标。",
    worldviewBias: "多写门第、婚配、家宅秩序、朝局投影和女性生存空间。",
    conflictStyle: "冲突围绕身份、婚姻、家族利益和情感压抑展开。",
    outlineShape: "以具体礼俗场景切入，再引出人物博弈与后续风波。",
    toneConstraints: "情绪细致，但必须有局势推动。"
  },
  现言: {
    storyFocus: "优先明确人物现实处境、关系拉扯和情感缺口。",
    worldviewBias: "世界观聚焦都市生活、职业关系、家庭创伤和情感边界。",
    conflictStyle: "冲突以误会、暧昧、回避、责任和现实条件不对位为主。",
    outlineShape: "先相遇或重逢，再制造现实阻碍，最后留下情绪悬念。",
    toneConstraints: "既要有甜虐张力，也要有现实质感。"
  },
  豪门: {
    storyFocus: "主角与权势、婚约、资源或名誉的绑定关系要先讲清。",
    worldviewBias: "多写家族规则、利益交换、舆论面子和阶层压迫。",
    conflictStyle: "冲突以控制、误判、权力失衡和感情博弈为主。",
    outlineShape: "先给身份压力，再放大利益冲突，尾部补一记感情钩子。",
    toneConstraints: "要华丽但不浮夸，人物算盘必须在线。"
  },
  穿越: {
    storyFocus: "先明确穿越后的身份、最大信息差和第一生存目标。",
    worldviewBias: "世界观重点在新旧认知冲突、时代规则和身份落差。",
    conflictStyle: "冲突以适应、隐藏、利用知识差和改变命运为主。",
    outlineShape: "先落地新身份，再触发旧知识与新规则的碰撞。",
    toneConstraints: "别只靠金手指顺推，要让代价和阻力存在。"
  },
  宫斗: {
    storyFocus: "优先明确主角在权力结构中的位置、弱点和想要守住的东西。",
    worldviewBias: "多写规制、宠势、信息流和后宫/内廷秩序。",
    conflictStyle: "冲突以算计、试探、站队和失势风险为主。",
    outlineShape: "先用礼制场景落位人物，再迅速抛出明暗对抗。",
    toneConstraints: "狠而稳，避免嘴上聪明、行为空心。"
  },
  种田: {
    storyFocus: "明确主角想过上什么日子，以及必须解决的现实问题。",
    worldviewBias: "多写土地、手艺、邻里关系、家计和稳步经营。",
    conflictStyle: "冲突围绕资源不足、亲族摩擦、外部压榨和生活改善展开。",
    outlineShape: "先立贫困或困局，再给改善抓手，最后埋下下一轮生活挑战。",
    toneConstraints: "温度和细节要足，但不能没事发生。"
  },
  双男主: {
    storyFocus: "两位核心人物的互补与对抗关系必须从开局就成立。",
    worldviewBias: "世界观服务关系推进、身份束缚和情绪张力。",
    conflictStyle: "冲突以立场差、误会、吸引、试探和共同危险为主。",
    outlineShape: "先建立碰撞，再形成绑定，尾部留关系升级空间。",
    toneConstraints: "情绪拉扯要准，避免只剩标签化互动。"
  },
  玄幻: {
    storyFocus: "主角的成长野心、力量门槛和最先要跨过的阶层障碍要明确。",
    worldviewBias: "多写体系等级、势力地图、资源争夺和血脉/体质差异。",
    conflictStyle: "冲突重在强弱秩序、机缘争抢和尊严压迫。",
    outlineShape: "弱势开局、机缘破口、势力注意，节节推进。",
    toneConstraints: "爽点可以有，但要靠铺垫而不是硬送。"
  },
  武侠: {
    storyFocus: "先明确人物立场、江湖身份和必须出手的理由。",
    worldviewBias: "世界观聚焦门派恩怨、江湖规矩、地域风貌和名望体系。",
    conflictStyle: "冲突以恩怨、义利、承诺、仇杀和师承牵引为主。",
    outlineShape: "从一件江湖事切入，逐步牵出更深旧账或势力冲突。",
    toneConstraints: "要有侠气和烟火气，别写成纯战斗说明。"
  },
  官场: {
    storyFocus: "主角的职位处境、上升目标和当前风险必须清楚。",
    worldviewBias: "多写制度链条、人情网络、资源分配和话语边界。",
    conflictStyle: "冲突以站队、博弈、责任甩锅和利益平衡为主。",
    outlineShape: "先给具体事务，再显露权力结构，最后抛更大考验。",
    toneConstraints: "克制、锋利，少喊口号，多写局中人算计。"
  },
  商战: {
    storyFocus: "先确定主角要抢什么市场、资金或位置，以及短板在哪里。",
    worldviewBias: "世界观聚焦行业格局、资本压力、谈判桌和资源链。",
    conflictStyle: "冲突围绕竞争、收购、背刺、现金流和舆论展开。",
    outlineShape: "先给交易或机会，再暴露阻击，尾部留更大盘面。",
    toneConstraints: "专业感要有，但核心还是人和利益。"
  },
  港综: {
    storyFocus: "主角必须和港岛秩序、灰白边界或经典人物网络产生实质绑定。",
    worldviewBias: "多写社团、警队、地盘、生意链和时代城市气味。",
    conflictStyle: "冲突以地盘、人情、规矩、身份切换和黑白博弈为主。",
    outlineShape: "先用一场够港味的事件立住人，再把主角推入更大局。",
    toneConstraints: "节奏利落，人物要有算盘，别只复述经典桥段。"
  },
  谍战: {
    storyFocus: "优先明确人物身份层、任务目标和暴露代价。",
    worldviewBias: "多写潜伏环境、情报链、身份伪装和时代高压。",
    conflictStyle: "冲突以试探、误导、追查、牺牲和信任危机为主。",
    outlineShape: "先给任务，再埋风险，最后让危险逼近。",
    toneConstraints: "紧绷、克制，避免角色一张嘴就透底。"
  },
  军事: {
    storyFocus: "主角所在体系、任务目标和战场/行动限制要先明确。",
    worldviewBias: "世界观聚焦指挥链、战术环境、补给与组织协同。",
    conflictStyle: "冲突以任务压力、地形条件、牺牲决策和团队协作为主。",
    outlineShape: "先给任务压顶，再暴露难点，最后收在更难的下一步。",
    toneConstraints: "强调执行感和代价感，避免纯口号式燃。"
  },
  同人: {
    storyFocus: "主角切入原作世界的独特位置和对原有剧情的改变潜力必须明确。",
    worldviewBias: "世界观优先沿用原作核心规则，再补足主角的新变量。",
    conflictStyle: "冲突围绕熟悉角色、原有事件偏转和新旧命运冲撞展开。",
    outlineShape: "先借熟悉场景落地，再快速偏转剧情期待。",
    toneConstraints: "要有原作识别度，但不能只是照着走流程。"
  }
};
const LENGTH_ADJUSTMENTS = {
  long: {
    outline: "三条大纲可偏向长线铺垫：先立局、再升级、最后抛出更大的局势或人物关系钩子。",
    world: "世界观允许保留一条更偏长期伏笔的设定，为后续扩展留口。",
    pacing: "节奏可以舒展，但每条都必须给读者明确的新信息或新压力。"
  },
  short: {
    outline: "三条大纲必须更聚焦单线冲突，尽快推进到核心矛盾，不做宽散铺陈。",
    world: "世界观只保留最关键、最直接影响故事的设定。",
    pacing: "节奏更紧，尽量让每条大纲都带来明确事件推动或情绪拐点。"
  }
};
function normalizeGenreLabel(input) {
  return String(input ?? "").trim();
}
function resolveProjectBootstrapPromptParts(context) {
  const genreLabel = normalizeGenreLabel(context.projectGenre) || "未指定";
  const novelLength = context.projectNovelLength === "short" ? "short" : "long";
  const lengthLabel = novelLength === "short" ? "短篇" : "长篇";
  const strategy = GENRE_STRATEGIES[genreLabel] ?? DEFAULT_STRATEGY;
  const lengthAdjustment = LENGTH_ADJUSTMENTS[novelLength];
  const customGenreLine = GENRE_STRATEGIES[genreLabel] ? "" : `- 自定义题材处理：把“${genreLabel}”视为作品主导题材，所有设定和大纲都必须围绕它展开，而不是退回通用套路。
`;
  return {
    genreLabel,
    lengthLabel,
    strategyBlock: [
      `- 题材聚焦：${strategy.storyFocus}`,
      `- 世界观偏向：${strategy.worldviewBias}`,
      `- 冲突设计：${strategy.conflictStyle}`,
      `- 大纲组织：${strategy.outlineShape}`,
      `- 语气边界：${strategy.toneConstraints}`,
      `- ${lengthLabel}节奏：${lengthAdjustment.pacing}`,
      `- ${lengthLabel}大纲要求：${lengthAdjustment.outline}`,
      `- ${lengthLabel}设定要求：${lengthAdjustment.world}`,
      customGenreLine.trimEnd()
    ].filter(Boolean).join("\n")
  };
}
const PROMPT_CAPABILITY_DEFINITIONS = {
  workflow: {
    label: "小说流程与项目文件",
    systemNote: "可以读写 task_plan、findings、progress、current_status、novel_setting、character_relationships、pending_hooks、resource_ledger 这些流程文件。",
    userRule: "流程文件是当前项目的工作记忆，应该延续已有内容，不要凭空另起一套口径。"
  },
  worldview: {
    label: "世界观设定",
    systemNote: "可以引用世界背景、规则、势力、历史等设定条目。设定吃书禁止：前文已写明的设定，后文不能矛盾覆盖；若必须修改，要明确说明覆盖了哪些旧设定。不要整段讲百科——设定必须在场景里落地。",
    userRule: "世界观内容必须服务当前项目，不能把未锁定设定写成正式事实。设定融入剧情，不要大段复制粘贴背景介绍。"
  },
  characters: {
    label: "角色图鉴",
    systemNote: '可以使用角色姓名、定位、描述、标签等角色信息。角色行为必须由过往经历+当前利益+性格底色共同驱动，严禁反派降智或主角圣母。配角不能是工具人，必须有算盘、恐惧、筹码、误判与反扑。人设防崩：任何反常行为必须用前文铺垫解释，不能靠"突然顿悟"或"心软"搪塞。人设前后矛盾：角色不能突然做出与性格矛盾的选择，成长必须在逻辑合理范畴内。主角成功无代价：成功最好伴随不可逆的代价，表层爽点里层成本。',
    userRule: "角色行为和新增角色必须尽量嵌入现有角色网络，避免孤立路人。反派和配角必须基于其已知信息和利益行动，不能为了推剧情而降智。人设不能前后矛盾，不能前面是大女主后面是大圣母。"
  },
  relations: {
    label: "关系与组织",
    systemNote: "可以使用组织、角色关系、成员归属、阵营立场等结构化关系信息。配角不能是工具人，必须有算盘、恐惧、筹码、误判与反扑。冲突必须由利益驱动，不能是心软或圣母。角色关系的改变必须有事件驱动和铺垫，不能跨越式发展。严禁无理由的爱/恨——所有关系的改变必须有事件驱动和铺垫。关系发展突兀——情感和关系必须有递进过程，不能通过标签化互动强行推进。",
    userRule: "如果关系、组织或归属会影响冲突、措辞或行动，优先把这些因素纳入输出。冲突必须由利益驱动，配角必须有反扑，不能站着等死。关系变化必须有因果，不能凭空产生。"
  },
  inspiration: {
    label: "灵感模块",
    systemNote: "可以读取灵感卡片，把标题灵感、开篇钩子、场景火花、剧情转折等转成可执行内容。",
    userRule: "灵感必须落到当前项目的桥段、设定或冲突上，不要输出空泛点子。"
  },
  outline: {
    label: "大纲规划",
    systemNote: "可以使用分卷、大纲节点、冲突、摘要和章节绑定状态。不同章节类型应使用不同推进方式：布局章重试探与利益交换，事件章重行动与资源兑现，过渡章重状态变化与后续钩子，回收章优先回应旧伏笔再打开新问题。",
    userRule: "大纲内容必须连续推进，不能生成与现有分卷方向脱节的散点。每段推进应带来至少一项新信息、态度变化或利益变化，避免空转。"
  },
  chapters: {
    label: "章节编辑器",
    systemNote: "可以使用当前章节标题、摘要、状态、正文、相邻章节和选中文本。续写或改写前必须确认最近章节中的人物状态、已公开情报、已动用资源和未回收伏笔，确保因果连续。改写边界：润色只改表达不改事实，改写可改叙述但保留核心事实，重写可重构场景但不改主设定，续写只向前推进不反改前文。禁止流水账——每一行字都要推动剧情或塑造人物。禁止文青病——不要在紧张推进时突然感慨人生。禁止历史课件式开头——用场面、动作、感官切入。",
    userRule: "涉及正文时优先输出可直接插入、替换或回写章节的结果，而不是泛泛解释。续写必须紧接现有正文自然推进，保持语气、节奏和剧情方向一致。禁止连续空话和同义反复，每段应带来新信息、态度变化或利益变化。"
  },
  analysis: {
    label: "章节分析",
    systemNote: "可以围绕节奏、张力、连续性、风险和修正动作输出分析。审查维度包括：人物OOC、时间线断裂、利益链不成立、配角工具人化、爽点虚化、台词失真、语言重复、设定冲突、信息越界、伏笔失管、词汇疲劳、设定吃书、数据通胀、战力崩坏、流水账、文青病、关系发展突兀、人设前后矛盾。优先修根因，不做表面润色。",
    userRule: '分析时要指出具体问题和可执行修法，不要只给空泛评价。按"问题→证据→最小修法"输出，涉及数值跳变或信息越界时一并给出修订方案。'
  },
  "writing-style": {
    label: "写作风格",
    systemNote: "可以读取项目默认风格名称和风格提示词。",
    userRule: "风格要作为约束参与生成，但不能盖过当前任务本身。"
  },
  "project-skills": {
    label: "项目级 skills",
    systemNote: "可以吸收当前项目启用的 skills 内容和阶段规则。",
    userRule: "只有在当前任务相关时才引用 skills，且优先延续其约束而不是照抄措辞。"
  },
  versioning: {
    label: "版本与回写",
    systemNote: "可以结合章节版本、恢复、正文插入、替换选区、设为标题或摘要这些能力思考输出形式。",
    userRule: "输出应尽量适配软件现有回写方式，方便直接落到章节、标题或摘要。"
  },
  "import-export": {
    label: "导入导出",
    systemNote: "项目支持结构化导入导出和模块级数据迁移。",
    userRule: "涉及迁移、补档或流程文件生成时，要保持字段结构稳定、便于后续保存和导出。"
  },
  settings: {
    label: "设置与模型配置",
    systemNote: "项目具有模型设置、主题和自动保存等配置能力。",
    userRule: "不要假设存在未实现的远程协作、社区、云同步或插件市场能力。"
  }
};
const PROMPT_TASK_PROFILES = {
  "worldview-entry": {
    label: "世界观生成",
    defaultCapabilities: ["settings", "worldview", "writing-style"]
  },
  "character-card": {
    label: "角色生成",
    defaultCapabilities: ["settings", "characters", "relations", "worldview", "writing-style"]
  },
  "outline-item": {
    label: "单节点大纲生成",
    defaultCapabilities: ["settings", "outline", "worldview", "characters", "writing-style"]
  },
  "outline-batch": {
    label: "批量大纲生成",
    defaultCapabilities: ["settings", "outline", "worldview", "characters", "relations", "writing-style", "project-skills"]
  },
  "outline-chain": {
    label: "后续剧情链规划",
    defaultCapabilities: ["settings", "outline", "chapters", "worldview", "characters", "relations", "writing-style", "project-skills"]
  },
  "reference-style-chunk": {
    label: "参考作品分块分析",
    defaultCapabilities: ["settings", "analysis", "writing-style", "outline", "import-export"]
  },
  "reference-style-analysis": {
    label: "参考作品仿写分析",
    defaultCapabilities: ["settings", "analysis", "writing-style", "outline", "import-export"]
  },
  "workflow-documents": {
    label: "流程文件生成",
    defaultCapabilities: ["settings", "workflow", "import-export"]
  },
  "chapter-assistant": {
    label: "章节创作助理",
    defaultCapabilities: ["settings", "chapters", "worldview", "characters", "relations", "outline", "inspiration", "writing-style", "project-skills", "versioning"]
  },
  "chapter-first-draft": {
    label: "章节初稿生成",
    defaultCapabilities: ["settings", "chapters", "worldview", "characters", "relations", "outline", "inspiration", "writing-style", "project-skills", "versioning"]
  },
  "project-bootstrap": {
    label: "项目初始化",
    defaultCapabilities: ["settings", "worldview", "outline", "characters", "writing-style"]
  },
  "chapter-analysis": {
    label: "章节分析",
    defaultCapabilities: ["settings", "chapters", "analysis", "worldview", "characters", "relations", "outline", "versioning"]
  },
  "inspiration-pack": {
    label: "灵感卡片生成",
    defaultCapabilities: ["settings", "inspiration", "chapters", "worldview", "characters", "relations", "outline", "writing-style"]
  },
  "chapter-summarize": {
    label: "章节摘要生成",
    defaultCapabilities: ["settings", "chapters", "analysis"]
  },
  "plot-thread-detect": {
    label: "章节伏笔识别",
    defaultCapabilities: ["settings", "chapters", "analysis"]
  }
};
function buildCapabilityPromptContext(task) {
  const taskProfile = resolvePromptTaskProfile(task.task);
  const activeCapabilities = resolvePromptCapabilities(task);
  const capabilityLines = activeCapabilities.map((id) => {
    const definition = PROMPT_CAPABILITY_DEFINITIONS[id];
    return `- ${definition.label}：${definition.systemNote}`;
  });
  const ruleLines = activeCapabilities.map((id) => {
    const definition = PROMPT_CAPABILITY_DEFINITIONS[id];
    return `- ${definition.label}：${definition.userRule}`;
  });
  return {
    system: [
      "你正在 CharacterArc 当前已实现的功能范围内工作。",
      "不要把“/小说流程”或“/小说流程2”当成固定模板来源；它们只能作为参考样式，真正的输出必须按当前任务和当前可用模块适配。",
      `本次任务类型：${task.task}。`,
      `本次任务功能定位：${taskProfile.label}。`,
      "本次任务相关的已实现功能模块：",
      ...capabilityLines
    ].join("\n"),
    user: ["当前任务必须遵守以下功能适配规则：", ...ruleLines].join("\n")
  };
}
function resolvePromptTaskProfile(taskName) {
  return PROMPT_TASK_PROFILES[taskName];
}
function resolvePromptCapabilities(task) {
  const taskProfile = resolvePromptTaskProfile(task.task);
  const capabilityIds = new Set(taskProfile.defaultCapabilities);
  const context = task.context ?? {};
  if (hasWorkflowContext(context)) {
    capabilityIds.add("workflow");
  }
  if (hasWorldviewContext(context)) {
    capabilityIds.add("worldview");
  }
  if (hasCharacterContext(context)) {
    capabilityIds.add("characters");
  }
  if (hasRelationsContext(context)) {
    capabilityIds.add("relations");
  }
  if (hasInspirationContext(context)) {
    capabilityIds.add("inspiration");
  }
  if (hasOutlineContext(context)) {
    capabilityIds.add("outline");
  }
  if (hasChapterContext(context)) {
    capabilityIds.add("chapters");
  }
  if (hasWritingStyleContext(context)) {
    capabilityIds.add("writing-style");
  }
  if (Array.isArray(context.projectSkills) && context.projectSkills.length > 0) {
    capabilityIds.add("project-skills");
  }
  if (task.task === "workflow-documents") {
    addWorkflowStageCapabilities(capabilityIds, String(context.stageId ?? "reference"));
  }
  return Array.from(capabilityIds);
}
function resolveChapterAssistantModeInstruction(mode) {
  switch (mode) {
    case "polish":
      return '当前模式是"润色"。请尽量直接输出可替换原文的润色结果，减少分析。';
    case "continue":
      return '当前模式是"续写"。请紧接现有正文自然续写，保持语气、节奏和剧情方向一致。';
    case "suggest":
      return '当前模式是"剧情建议"。请给出 3 到 5 条具体建议，按可执行性优先排序。';
    case "reference":
      return '当前模式是"设定查阅"。请优先提炼与当前章节最相关的设定、角色和风险点。';
    default:
      return '当前模式是"自由提问"。请根据用户请求选择最合适的回答形式。';
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
    case "关系冲突":
      return "如果当前任务是关系冲突，请输出 3 条关系驱动冲突方案，每条都明确人物关系、阵营立场和可触发场景。";
    case "阵营视角":
      return "如果当前任务是阵营视角，请优先输出可直接替换或插入正文的最终文本，突出组织立场、身份认同和冲突措辞。";
    default:
      return "如果快捷动作已经明确输出形态，请优先遵循该动作要求。";
  }
}
function addWorkflowStageCapabilities(capabilityIds, stageId) {
  switch (stageId) {
    case "reference":
      capabilityIds.add("workflow");
      capabilityIds.add("inspiration");
      break;
    case "premise":
      capabilityIds.add("workflow");
      capabilityIds.add("worldview");
      capabilityIds.add("writing-style");
      break;
    case "setting":
      capabilityIds.add("workflow");
      capabilityIds.add("worldview");
      capabilityIds.add("characters");
      capabilityIds.add("relations");
      break;
    case "outline":
      capabilityIds.add("workflow");
      capabilityIds.add("outline");
      capabilityIds.add("chapters");
      break;
    case "draft":
      capabilityIds.add("workflow");
      capabilityIds.add("chapters");
      capabilityIds.add("analysis");
      capabilityIds.add("inspiration");
      capabilityIds.add("versioning");
      break;
    default:
      capabilityIds.add("workflow");
      break;
  }
}
function hasWorkflowContext(context) {
  return Array.isArray(context.workflowDocuments) || Array.isArray(context.requestedDocuments) || typeof context.stageId === "string";
}
function hasWorldviewContext(context) {
  return Array.isArray(context.worldviewEntries) || Array.isArray(context.worldviewTitles);
}
function hasCharacterContext(context) {
  return Array.isArray(context.characters) || Array.isArray(context.characterNames);
}
function hasRelationsContext(context) {
  return Array.isArray(context.organizations) || Array.isArray(context.characterRelationships) || Array.isArray(context.organizationMemberships);
}
function hasInspirationContext(context) {
  return Array.isArray(context.inspirationEntries) || Array.isArray(context.existingInspirationTitles);
}
function hasOutlineContext(context) {
  return Array.isArray(context.outlineItems) || Array.isArray(context.currentVolumeOutlineItems) || Array.isArray(context.outlineTitles) || typeof context.currentOutlineItem === "object";
}
function hasChapterContext(context) {
  return typeof context.chapterContent === "string" || typeof context.chapterTitle === "string" || Array.isArray(context.relatedChapters);
}
function hasWritingStyleContext(context) {
  return Boolean(String(context.writingStyleLabel ?? "").trim() || String(context.writingStylePrompt ?? "").trim());
}
function buildTaskPrompt(task) {
  const { context } = task;
  const writingStyleInstruction = resolveWritingStyleInstruction(context);
  const projectSkills = formatProjectSkills(context.projectSkills);
  const wrapPrompt = (prompt) => {
    const capabilityPrompt = buildCapabilityPromptContext(task);
    return {
      system: `${capabilityPrompt.system}

${prompt.system}`,
      user: `${capabilityPrompt.user}

${prompt.user}`
    };
  };
  if (task.task === "worldview-entry") {
    return wrapPrompt({
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
5. ${writingStyleInstruction}

返回格式：{"type":"","title":"","content":""}`
    });
  }
  if (task.task === "character-card") {
    const organizations = formatOrganizations(context.organizations);
    const relationships = formatCharacterRelationships(context.characterRelationships, context.characters);
    const memberships = formatOrganizationMemberships(context.organizationMemberships, context.organizations, context.characters);
    return wrapPrompt({
      system: "你是小说角色设定助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 name、role、description、tags。",
      user: `基于以下上下文，为当前小说项目生成一名新角色。

项目标题：${String(context.projectTitle ?? "")}
项目题材：${String(context.projectGenre ?? "")}
已有角色：${JSON.stringify(context.characterNames ?? [])}
世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}

已有组织：
${organizations || "暂无"}

已有角色关系：
${relationships || "暂无"}

已有成员归属：
${memberships || "暂无"}

要求：
1. 不与已有角色重名
2. role 用短语概括角色定位
3. 新角色要尽量能自然嵌入现有关系网络或组织结构，避免像孤立路人
4. description 用中文完整描述，80 到 160 字，尽量体现其立场、关系张力或潜在冲突
5. tags 返回 2 到 4 个简短标签数组
6. ${writingStyleInstruction}

返回格式：{"name":"","role":"","description":"","tags":["",""]}`
    });
  }
  if (task.task === "project-bootstrap") {
    const { genreLabel, lengthLabel, strategyBlock } = resolveProjectBootstrapPromptParts(context);
    return wrapPrompt({
      system: "你是小说项目初始化助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 worldviewEntries、outlineItems。",
      user: `请基于以下信息，为小说项目生成首批世界观设定和剧情大纲。

项目标题：${String(context.projectTitle ?? "")}
项目题材：${genreLabel}
作品长度：${lengthLabel}
小说简介：${String(context.projectPremise ?? "")}

题材与长度策略：
${strategyBlock}

要求：
1. worldviewEntries 返回 3 条设定，每条都包含 type、title、content
2. worldviewEntries 的 type 必须是 地理 / 法则 / 物种 / 势力 / 历史 之一
3. outlineItems 返回 3 条章节大纲，每条都包含 title、wordTarget、conflict、summary
4. wordTarget 使用"预估 xxxx字"格式，并与${lengthLabel}节奏相匹配
5. 所有内容使用中文，必须紧贴题材、长度和小说简介，不要写成通用模板
6. 三条世界观设定之间要能互相支撑，三条大纲之间要形成连续推进
7. 如果简介里已经给出了主角目标、关系或异常事件，要优先围绕它展开，而不是另起炉灶
8. ${writingStyleInstruction}

返回格式：{"worldviewEntries":[{"type":"","title":"","content":""}],"outlineItems":[{"title":"","wordTarget":"","conflict":"","summary":""}]}`
    });
  }
  if (task.task === "reference-style-chunk") {
    return wrapPrompt({
      system: "你是小说拆书分块分析助手。请只返回 JSON 对象，不要返回 Markdown，不要解释。字段必须包含 overview、sentenceStyle、dialogueRatio、pacingControl、emotionExpression、plotFunction、styleRules。",
      user: `请分析下面这个参考作品分块，提炼它在局部层面的风格和桥段作用。

当前项目标题：${String(context.projectTitle ?? "")}
当前项目题材：${String(context.projectGenre ?? "")}
当前目标平台：${String(context.projectPlatform ?? "")}
参考作品标题：${String(context.sourceTitle ?? "")}
分块标签：${String(context.chunkLabel ?? "")}
分块顺序：${String(context.chunkIndex ?? "")} / ${String(context.chunkTotal ?? "")}
分块字数：${String(context.chunkCharacterCount ?? "")}
分块局部统计：${JSON.stringify(context.chunkMetrics ?? [])}
分块关键词：${JSON.stringify(context.chunkKeywords ?? [])}
分块正文：
${String(context.chunkText ?? "")}

要求：
1. 只分析这一块，不要假装知道整本书全貌
2. overview 用 1 到 2 句话概括这一块在文风和桥段上的局部特征
3. sentenceStyle 必须明确句式长短、描述密度或叙述颗粒度
4. dialogueRatio 必须明确对白占比倾向及其在这一块里的作用
5. pacingControl 必须说明这一块是快推、蓄压、回收还是过渡，以及怎么做到的
6. emotionExpression 必须指出情绪靠什么细节外化
7. plotFunction 必须说明这一块承担的桥段功能，比如开篇钩子、冲突升级、关系试探、结果兑现、余波过渡等
8. styleRules 返回 2 到 4 条局部可复用规则，仍然必须去具体化，不能包含专有名词和桥段细节照搬
9. 不要长篇复述剧情，不要输出版权敏感的连续原文

返回格式：{"overview":"","sentenceStyle":"","dialogueRatio":"","pacingControl":"","emotionExpression":"","plotFunction":"","styleRules":["",""]}`
    });
  }
  if (task.task === "reference-style-analysis") {
    return wrapPrompt({
      system: "你是小说拆书分析助手。请只返回 JSON 对象，不要返回 Markdown，不要解释。字段必须包含 overview、sentenceStyle、dialogueRatio、pacingControl、emotionExpression、narrativePerspective、styleRules、plotOutline、reusableStylePrompt、avoidRules。",
      user: `请基于以下参考作品的全局统计和分块分析结果，汇总出一套可以复用于后续原创写作的仿写规则。

当前项目标题：${String(context.projectTitle ?? "")}
当前项目题材：${String(context.projectGenre ?? "")}
当前目标平台：${String(context.projectPlatform ?? "")}
参考作品标题：${String(context.sourceTitle ?? "")}
参考文件类型：${String(context.sourceFileType ?? "")}
参考作品估计字数：${String(context.sourceCharacterCount ?? "")}
参考作品章节估计：${String(context.sourceChapterCount ?? "")}
全局统计：${JSON.stringify(context.styleMetrics ?? [])}
全局关键词：${JSON.stringify(context.topKeywords ?? [])}
开篇摘录：
${String(context.sourceExcerpt ?? "")}

全书抽样：
${String(context.analysisSample ?? "")}

分块分析结果：
${String(context.chunkSummaries ?? "")}

要求：
1. 目标不是复述剧情，而是汇总出跨分块稳定成立的风格骨架
2. 优先相信多个分块重复出现的共性，不要被单个桥段带偏
3. sentenceStyle 必须明确句式简洁度、长短句分布、描写密度或叙述颗粒度
4. dialogueRatio 必须明确对白比例倾向，以及对白在推进剧情中的职责
5. pacingControl 必须明确该作品如何在不同桥段里控节奏、如何分配冲突和反馈
6. emotionExpression 必须明确情绪是靠什么外化的，不要空泛说"有感染力"
7. narrativePerspective 必须说明视角稳定性、镜头距离或场景组织方式
8. styleRules 返回 4 到 6 条可执行风格规则，不能包含具体人名、地名、外挂、组织名或桥段专有设定
9. plotOutline 用 120 到 220 字概括故事骨架，但必须抽象到可迁移层，不要把原剧情直接压缩复写
10. reusableStylePrompt 写成可直接放进后续章节生成的风格模板，强调文笔、对白、节奏、情绪表达和去 AI 味约束，180 到 320 字
11. avoidRules 返回 3 到 5 条主动避险规则，提醒后续创作不要照搬原作的专有名词、关系网和桥段顺序
12. 全部内容必须用简体中文，严格去具体化，不能输出版权敏感的连续原文，也不能鼓励照抄

返回格式：{"overview":"","sentenceStyle":"","dialogueRatio":"","pacingControl":"","emotionExpression":"","narrativePerspective":"","styleRules":["",""],"plotOutline":"","reusableStylePrompt":"","avoidRules":["",""]}`
    });
  }
  if (task.task === "workflow-documents") {
    const stageId = String(context.stageId ?? "reference");
    const stageLabel = String(context.stageLabel ?? "选题与参考");
    const requestedDocuments = Array.isArray(context.requestedDocuments) ? JSON.stringify(context.requestedDocuments) : "[]";
    return wrapPrompt({
      system: "你是小说项目流程文件生成助手。请只返回 JSON 对象，不要返回 Markdown 代码块，不要解释。只生成本阶段要求的流程文件字段，字段值必须是 markdown 文本字符串。",
      user: `请基于以下项目信息，只为当前阶段生成对应的流程文件内容。

项目标题：${String(context.projectTitle ?? "")}
项目题材：${String(context.projectGenre ?? "")}
项目目标平台：${String(context.projectPlatform ?? "未指定")}
项目当前阶段 ID：${stageId}
项目当前阶段：${stageLabel}
本阶段要求生成的文件：${requestedDocuments}
当前世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}
当前角色参考：${JSON.stringify(context.characters ?? [])}
当前关系参考：${JSON.stringify(context.characterRelationships ?? [])}
当前大纲参考：${JSON.stringify(context.outlineItems ?? [])}
当前章节参考：${JSON.stringify(context.chapters ?? [])}
当前已有流程文件：${JSON.stringify(context.workflowDocuments ?? [])}
当前项目启用 skills：
${projectSkills || "暂无"}
补充要求：${String(context.userPrompt ?? "")}

要求：
1. 只生成 requestedDocuments 里列出的字段，不要额外输出其他字段
2. 每个字段都必须贴当前小说项目，不要写成通用教程模板
3. 如果当前已有流程文件里已经存在有效内容，要优先延续和整合，而不是完全重写成另一套口径
4. 如果当前项目启用了 skills，优先吸收其中与当前阶段相关的规则和口径
5. task_plan 重点写当前阶段接下来要推进的任务
6. findings 重点写当前已锁定的关键信息、设定、事实和风险
7. progress 重点写当前阶段真实进度与下一步
8. current_status 重点写当前主角、当前卷章、当前主线和即时矛盾
9. novel_setting 重点写题材、世界线、文风边界、主角路线和外挂设定
10. character_relationships 重点写当前人物、势力和关系骨架
11. pending_hooks 重点写当前阶段已埋或待埋的钩子
12. resource_ledger 重点写当前已到账 / 未到账的资源与风险
13. 所有字段内容都用简体中文 markdown 写法，但放在 JSON 字符串里返回
14. 不要输出空壳模板，要生成可直接继续编辑的第一版内容

返回示例：{"task_plan":"","findings":""}`
    });
  }
  if (task.task === "chapter-analysis") {
    const worldviewEntries = Array.isArray(context.worldviewEntries) ? context.worldviewEntries.slice(0, 8).map((entry) => `${String(entry.title ?? "")}：${String(entry.content ?? "")}`).join("\n") : "";
    const characters = Array.isArray(context.characters) ? context.characters.slice(0, 8).map((character) => `${String(character.name ?? "")} / ${String(character.role ?? "")}：${String(character.description ?? "")}`).join("\n") : "";
    const organizations = formatOrganizations(context.organizations);
    const relationships = formatCharacterRelationships(context.characterRelationships, context.characters);
    const memberships = formatOrganizationMemberships(context.organizationMemberships, context.organizations, context.characters);
    Array.isArray(context.inspirationEntries) ? context.inspirationEntries.slice(0, 6).map((entry) => {
      const record = entry;
      const tags = Array.isArray(record.tags) ? record.tags.map((tag) => String(tag)).join("、") : "";
      return `${String(record.type ?? "")} / ${String(record.title ?? "")}：${String(record.content ?? "")}${tags ? `（标签：${tags}）` : ""}`;
    }).join("\n") : "";
    const outlineItems = Array.isArray(context.outlineItems) ? context.outlineItems.slice(0, 6).map((item) => `${String(item.title ?? "")}：${String(item.summary ?? "")}`).join("\n") : "";
    return wrapPrompt({
      system: "你是小说章节分析助手。请只返回 JSON 对象，不要返回 Markdown，不要解释。字段必须包含 overview、pacing、tension、continuity、highlights、risks、revisionActions。",
      user: `请分析当前章节的写作质量与可优化点。

项目标题：${String(context.projectTitle ?? "")}
项目题材：${String(context.projectGenre ?? "")}
当前分卷：${String(context.chapterVolumeTitle ?? "")}
当前分卷摘要：${String(context.chapterVolumeSummary ?? "")}
当前章节标题：${String(context.chapterTitle ?? "")}
当前章节摘要：${String(context.chapterSummary ?? "")}
当前章节状态：${String(context.chapterStatus ?? "")}
当前章节预估字数：${String(context.chapterWordTarget ?? "")}
当前章节实际字数：${String(context.chapterWordCount ?? "")}
当前章节正文：
${String(context.chapterContent ?? "")}

相关世界观：
${worldviewEntries || "暂无"}

相关角色：
${characters || "暂无"}

相关组织：
${organizations || "暂无"}

角色关系：
${relationships || "暂无"}

成员归属：
${memberships || "暂无"}

相关大纲：
${outlineItems || "暂无"}

要求：
1. overview 用 1 到 2 句话概括当前章节完成度、情绪和主要问题
2. pacing / tension / continuity 都用一句中文短评，既要判断也要说明原因
3. highlights 返回 2 到 4 条，强调当前章节已经做得好的地方
4. risks 返回 2 到 4 条，指出节奏、逻辑、人物一致性、设定引用、关系张力、阵营立场或信息密度方面的风险
5. revisionActions 返回 3 到 5 条，必须是作者可以立刻执行的修改动作，尽量具体
6. 如果人物关系、阵营动机或组织归属没有被有效利用，也要明确指出
7. 输出务必紧贴当前正文，不要给空泛写作建议

返回格式：{"overview":"","pacing":"","tension":"","continuity":"","highlights":["",""],"risks":["",""],"revisionActions":["","",""]}`
    });
  }
  if (task.task === "outline-batch") {
    return wrapPrompt({
      system: "你是小说分卷大纲规划助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 entries，entries 中每项都必须包含 title、wordTarget、conflict、summary。",
      user: `请基于以下上下文，为当前分卷连续补充 3 到 5 个新的剧情大纲节点。

项目标题：${String(context.projectTitle ?? "")}
项目题材：${String(context.projectGenre ?? "")}
当前分卷：${String(context.chapterVolumeTitle ?? "")}
当前分卷摘要：${String(context.chapterVolumeSummary ?? "")}
当前分卷目标字数：${String(context.chapterVolumeWordTarget ?? "")}
当前分卷已有节点：${JSON.stringify(context.currentVolumeOutlineItems ?? [])}
全局已有大纲标题：${JSON.stringify(context.outlineTitles ?? [])}
世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}
角色参考：${JSON.stringify(context.characters ?? [])}
当前项目启用 skills：
${projectSkills || "暂无"}
补充要求：${String(context.userPrompt ?? "")}

要求：
1. entries 返回 3 到 5 条新节点，按顺序推进，不要重复已有节点
2. 每条都必须包含 title、wordTarget、conflict、summary
3. title 要体现章节推进关系，避免空泛命名
4. wordTarget 使用"预估 xxxx字"格式
5. conflict 用一句话概括该节点最核心的矛盾或压力
6. summary 用中文描述剧情推进，80 到 180 字
7. 各节点之间要形成连续节奏，不能像互相无关的散点
8. 如果当前项目启用了 skills，优先吸收其中与大纲阶段相关的规则和限制
9. 如果当前分卷已有节点偏少，优先补桥接节点；如果已有节点较多，优先补冲突升级和转折节点
10. 必须保持与当前分卷摘要、已有角色关系和世界观一致
11. ${writingStyleInstruction}

返回格式：{"entries":[{"title":"","wordTarget":"","conflict":"","summary":""}]}`
    });
  }
  if (task.task === "outline-chain") {
    return wrapPrompt({
      system: "你是小说剧情链规划助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 entries，entries 中每项都必须包含 title、wordTarget、conflict、summary。",
      user: `请基于以下上下文，为当前章节之后连续规划 2 到 4 个后续剧情大纲节点。

项目标题：${String(context.projectTitle ?? "")}
项目题材：${String(context.projectGenre ?? "")}
当前分卷：${String(context.chapterVolumeTitle ?? "")}
当前分卷摘要：${String(context.chapterVolumeSummary ?? "")}
当前章节标题：${String(context.chapterTitle ?? "")}
当前章节摘要：${String(context.chapterSummary ?? "")}
当前章节状态：${String(context.chapterStatus ?? "")}
当前章节正文：
${String(context.chapterContent ?? "")}
当前关联大纲节点：${JSON.stringify(context.currentOutlineItem ?? {})}
当前分卷已有节点：${JSON.stringify(context.currentVolumeOutlineItems ?? [])}
世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}
角色参考：${JSON.stringify(context.characters ?? [])}
当前项目启用 skills：
${projectSkills || "暂无"}
补充要求：${String(context.userPrompt ?? "")}

要求：
1. entries 返回 2 到 4 个后续节点，必须严格体现“当前章节之后”的连续推进
2. 每条都必须包含 title、wordTarget、conflict、summary
3. 第一条要紧贴当前章节收束后的直接后果或下一步动作
4. 后续条目之间要形成递进，至少包含一次冲突升级或转折
5. wordTarget 使用"预估 xxxx字"格式
6. summary 用中文描述剧情推进，80 到 180 字
7. 如果当前项目启用了 skills，优先吸收其中与大纲续推相关的规则和写法限制
8. 不要重复当前分卷中已有节点标题和主要推进
9. 必须保持与当前角色关系、组织立场和世界观一致
10. ${writingStyleInstruction}

返回格式：{"entries":[{"title":"","wordTarget":"","conflict":"","summary":""}]}`
    });
  }
  if (task.task === "inspiration-pack") {
    const worldviewEntries = Array.isArray(context.worldviewEntries) ? context.worldviewEntries.slice(0, 8).map((entry) => `${String(entry.title ?? "")}：${String(entry.content ?? "")}`).join("\n") : "";
    const characters = Array.isArray(context.characters) ? context.characters.slice(0, 8).map((character) => `${String(character.name ?? "")} / ${String(character.role ?? "")}：${String(character.description ?? "")}`).join("\n") : "";
    const organizations = formatOrganizations(context.organizations);
    const relationships = formatCharacterRelationships(context.characterRelationships, context.characters);
    const memberships = formatOrganizationMemberships(context.organizationMemberships, context.organizations, context.characters);
    Array.isArray(context.inspirationEntries) ? context.inspirationEntries.slice(0, 6).map((entry) => {
      const record = entry;
      const tags = Array.isArray(record.tags) ? record.tags.map((tag) => String(tag)).join("、") : "";
      return `${String(record.type ?? "")} / ${String(record.title ?? "")}：${String(record.content ?? "")}${tags ? `（标签：${tags}）` : ""}`;
    }).join("\n") : "";
    const outlineItems = Array.isArray(context.outlineItems) ? context.outlineItems.slice(0, 6).map((item) => `${String(item.title ?? "")}：${String(item.summary ?? "")}`).join("\n") : "";
    const existingInspirationTitles = Array.isArray(context.existingInspirationTitles) ? JSON.stringify(context.existingInspirationTitles) : "[]";
    return wrapPrompt({
      system: "你是小说灵感生成助手。请只返回 JSON 对象，不要返回 Markdown，不要解释。字段必须包含 entries，entries 中每一项都必须包含 type、title、content、tags。",
      user: `请围绕当前小说项目生成一组可直接保存的灵感卡片。

项目标题：${String(context.projectTitle ?? "")}
项目题材：${String(context.projectGenre ?? "")}
当前章节标题：${String(context.chapterTitle ?? "")}
当前章节摘要：${String(context.chapterSummary ?? "")}
当前章节正文：
${String(context.chapterContent ?? "")}

灵感焦点：${String(context.focusType ?? "场景火花")}
已有灵感标题：${existingInspirationTitles}

相关世界观：
${worldviewEntries || "暂无"}

相关角色：
${characters || "暂无"}

相关组织：
${organizations || "暂无"}

角色关系：
${relationships || "暂无"}

成员归属：
${memberships || "暂无"}

相关大纲：
${outlineItems || "暂无"}

要求：
1. entries 返回 4 条灵感卡片，每条都必须紧贴"灵感焦点"
2. type 必须从以下类型中选一个：标题灵感、开篇钩子、场景火花、剧情转折、设定补完、人物动机
3. title 要短而明确，避免与已有灵感标题重复
4. content 用中文写成 60 到 140 字的可执行灵感描述，强调可落地场景、冲突、情绪或推进方式
5. 当关系、组织或阵营立场明显可用时，优先让灵感围绕这些张力展开
6. tags 返回 2 到 4 个简短标签，方便后续筛选
7. 不要空泛鸡汤，不要写成长篇大纲，要像作者工作台里的"灵感卡片"
8. ${writingStyleInstruction}

返回格式：{"entries":[{"type":"","title":"","content":"","tags":["",""]}]}`
    });
  }
  if (task.task === "chapter-assistant") {
    const worldviewEntries = Array.isArray(context.worldviewEntries) ? context.worldviewEntries.slice(0, 8).map((entry) => `${String(entry.title ?? "")}：${String(entry.content ?? "")}`).join("\n") : "";
    const characters = Array.isArray(context.characters) ? context.characters.slice(0, 8).map((character) => `${String(character.name ?? "")} / ${String(character.role ?? "")}：${String(character.description ?? "")}`).join("\n") : "";
    const organizations = formatOrganizations(context.organizations);
    const relationships = formatCharacterRelationships(context.characterRelationships, context.characters);
    const memberships = formatOrganizationMemberships(context.organizationMemberships, context.organizations, context.characters);
    const inspirationEntries = Array.isArray(context.inspirationEntries) ? context.inspirationEntries.slice(0, 6).map((entry) => {
      const record = entry;
      const tags = Array.isArray(record.tags) ? record.tags.map((tag) => String(tag)).join("、") : "";
      return `${String(record.type ?? "")} / ${String(record.title ?? "")}：${String(record.content ?? "")}${tags ? `（标签：${tags}）` : ""}`;
    }).join("\n") : "";
    const outlineItems = Array.isArray(context.outlineItems) ? context.outlineItems.slice(0, 6).map((item) => `${String(item.title ?? "")}：${String(item.summary ?? "")}`).join("\n") : "";
    const relatedChapters = Array.isArray(context.relatedChapters) ? context.relatedChapters.slice(0, 2).map((item, index) => {
      const record = item;
      return `关联章节${index + 1}：${String(record.title ?? "")}
摘要：${String(record.summary ?? "")}
正文预览：${String(record.preview ?? "")}`;
    }).join("\n\n") : "";
    const volumeChapterSummaries = Array.isArray(context.volumeChapterSummaries) ? context.volumeChapterSummaries.map((item, index) => {
      const record = item;
      return `第${index + 1}节：${String(record.title ?? "")}
  摘要：${String(record.summary ?? "") || "暂无摘要"}`;
    }).join("\n\n") : "";
    const novelOpenerSummary = context.novelOpenerSummary ? (() => {
      const record = context.novelOpenerSummary;
      return `标题：${String(record.title ?? "")}
摘要：${String(record.summary ?? "") || "暂无摘要"}`;
    })() : "";
    const openPlotThreads = Array.isArray(context.plotThreads) ? context.plotThreads.filter((t) => t.status === "open").map((t) => {
      const record = t;
      return `- ${String(record.title ?? "")}：${String(record.description ?? "")}`;
    }).join("\n") : "";
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
    return wrapPrompt({
      system: `你是 CharacterArc 的小说创作助理，同时扮演资深编辑与角色构建专家。请基于当前项目和章节上下文，用中文直接输出可供作者使用的正文、润色稿、分析或建议。不要输出 Markdown 标题，不要解释你是 AI，也不要返回 JSON。

【连贯性铁律】
新内容必须与前文完美衔接，禁止自相矛盾、时间线断裂和利益链断裂。前文埋下的资源、人脉、交易、仇怨，后文必须按因果兑现。拒绝机械降神——解决问题必须在已写内容中有迹可循，不能临时发明设定填坑。

【创作原则】
- Show, don't tell。用动作、物件、感官、价格、制度摩擦说话，少喊口号，少用空泛判断制造气氛。
- 场景压力：每个场景至少推进一项（信息、地位、资源、伤亡、仇恨、关系），小冲突尽快兑现反馈，不要把爽点无限后置。
- 章节类型识别：先判断本章更接近布局章（交易/试探/威慑）、事件章（行动/冲突/兑现）、过渡章（状态变化/余波/钩子）还是回收章（回应旧伏笔），再选择对应写法，不要用同一种模板写所有章节。
- 收益落地：本章收益必须落到具体资源、地位变化、信息获取或伏笔回收，不能只写抽象的"更强了""暴涨""难以估量"。

【动机校验】
动笔前自问：此刻利益最大化的选择是什么？冲突是谁先动手、为什么非做不可？配角/反派是否有明确诉求、恐惧和反制，而不是站着等死？反派是否基于其已知信息行动，而非不可能知道的信息？本段推进靠的是前文铺垫，还是凭空掉设定？任何一个问题答不上来，先补动机链再写。

【改写边界】
润色：只改表达、节奏和段落呼吸，不改事实与剧情结论。改写：可改叙述顺序、画面、力度，但保留核心事实与人物动机。重写：可重构场景推进和冲突组织，但不改主设定和大事件结果。续写：只在现有文本之后向前推进，不反改前文。用户指令与边界冲突时，以用户要求为准。

【去AI味约束】
- 句式多样化：长短句交替，避免连续重复相同句式、相同主语开头。
- 词汇控制：多用动词和名词，少堆形容词和高级词汇；对"冷笑""蝼蚁""轰然炸裂""倒吸一口凉气""瞳孔骤缩""满场死寂"等高疲劳词保持克制，同章同一高识别词默认只出现1次。
- 群像反应具体化：不要一律写成"全场震惊"或"众人倒吸凉气"，改写成1-2个具体角色的身体反应、判断偏差或利益震荡。
- 反派与配角的狠话必须贴合身份、地域与处境，不要复制通用口号。
- 避免过于完美或机械的逻辑结构，保留人物的非理性冲动和情感瑕疵。
- 合理分段，每段聚焦1个核心信息点，段落长度适中，适合手机阅读。

【禁止的失败模式】
- 无铺垫强行让已退场角色回归（假死/分身/复活必须以前文铺垫为前提）
- 为了推剧情让角色突然仁慈、犯蠢、讲武德
- 反派像木桩一样排队送死，或基于其不可能知道的信息行动
- 用大段设定说明替代战斗、压迫和收益兑现
- 没有铺垫突然塞入新体系、新地图、新外挂解决问题
- 配角工具人化——配角必须有自己的算盘、恐惧、筹码、误判与反扑
- 用模糊词掩盖跳变与降智（如"暴涨""海量""难以估量"跳过结算）
- 完成大剧情节点后忘记更新伏笔状态，导致逃敌、宝物或耳语无故消失
- 流水账——每一行字都要推动剧情或塑造人物，拒绝无效情节堆砌
- 连续空话、同义反复和模板化狠话——每段应带来新信息、态度变化或利益变化，避免空转
- 数据通胀和战力崩坏——同层级增量不得无说明跨越数量级，收益必须有可追溯的锚点
- 设定吃书——前文已写明的设定，后文不能矛盾覆盖；若必须修改，要明确说明覆盖了哪些旧设定
- 无理由的爱/恨——所有关系的改变必须有事件驱动和铺垫，不能跨越式发展
- 把所有章节都写成主角无敌碾压模板——不同章节类型使用不同压迫方式
- 文青病——不要在紧张推进时突然感慨人生、抒情独白，该推进就推进
- 历史课件式开头——用场面、动作、感官切入，不要用大段背景介绍开场
- 主角成功无代价——成功最好伴随不可逆的代价，表层爽点里层成本
- 人设前后矛盾——角色不能突然做出与性格矛盾的选择，成长必须在逻辑合理范畴内
- 关系发展突兀——情感和关系必须有递进过程，不能通过标签化互动强行推进

【质量审查框架】
审查时按"问题→证据→最小修法"输出，优先修根因，不做表面润色。审查维度包括：设定冲突、人物OOC、爽点缺失、节奏拖沓、配角降智、敌方信息越界、战力崩坏、伏笔失管、语言机械、词汇疲劳、利益链不成立、台词失真。`,
      user: `请处理当前写作请求，并优先给出可直接使用的结果。

项目标题：${String(context.projectTitle ?? "")}
项目题材：${String(context.projectGenre ?? "")}
当前项目默认风格：${String(context.writingStyleLabel ?? "未指定")}
风格要求：${String(context.writingStylePrompt ?? "暂无")}
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

相邻章节参考（含正文预览）：
${relatedChapters || "暂无"}

本卷章节概览（摘要，供情节衔接参考）：
${volumeChapterSummaries || "暂无"}

全书开篇（世界与角色基调参照）：
${novelOpenerSummary || "暂无"}

未收伏笔 / 活跃剧情线：
${openPlotThreads || "暂无（请注意：若有遗漏伏笔，请不要引入与已有伏笔矛盾的设定）"}

相关世界观：
${worldviewEntries || "暂无"}

相关角色：
${characters || "暂无"}

相关组织：
${organizations || "暂无"}

角色关系：
${relationships || "暂无"}

成员归属：
${memberships || "暂无"}

当前可用灵感：
${inspirationEntries || "暂无"}

相关大纲：
${outlineItems || "暂无"}

最近对话：
${recentMessages || "暂无"}

当前项目启用 skills：
${projectSkills || "暂无"}

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
7. 若当前可用灵感不为空，可优先借用其中最贴合的一条，把它自然落到正文、桥段或冲突推进中
8. 如果角色关系、组织立场或成员归属会影响人物行为、冲突走向或措辞，请优先把这些因素写进结果
9. 如果当前项目启用了 skills，优先吸收其中与正文创作、优化、审查相关的规则与口径
10. 必须遵循当前项目默认风格；若用户请求与风格冲突，以用户请求优先，但尽量保留风格骨架
11. 续写或改写前确认最近章节中的人物状态、已公开情报和未回收伏笔，确保因果连续，不凭空引入未铺垫的设定或资源
12. 如果"未收伏笔 / 活跃剧情线"不为空，本次内容不得与这些线索相矛盾；若本章计划收尾某条线，请在正文中给出明确收束情节
13. 先识别当前章节类型（布局章/事件章/过渡章/回收章），再选择对应写法，不要用同一种模板写所有章节
14. 配角和反派必须有反扑、误判和自己的算盘，不能工具人化或为了推剧情而降智
15. 去AI味：句式长短交替，避免重复句式和相同主语开头；对高疲劳词保持克制，同章同一高识别词默认只出现1次；群像反应不要一律"全场震惊"，改写成具体角色的身体反应或利益震荡
16. 收益必须落到具体资源、地位变化、信息获取或伏笔回收，不能只写抽象提升
17. ${modeInstruction}
18. ${lengthInstruction}
19. ${quickActionInstruction}`
    });
  }
  if (task.task === "chapter-first-draft") {
    const worldviewEntries = Array.isArray(context.worldviewEntries) ? context.worldviewEntries.slice(0, 8).map((entry) => `${String(entry.title ?? "")}：${String(entry.content ?? "")}`).join("\n") : "";
    const characters = Array.isArray(context.characters) ? context.characters.slice(0, 10).map((character) => `${String(character.name ?? "")} / ${String(character.role ?? "")}：${String(character.description ?? "")}`).join("\n") : "";
    const organizations = formatOrganizations(context.organizations);
    const relationships = formatCharacterRelationships(context.characterRelationships, context.characters);
    const memberships = formatOrganizationMemberships(context.organizationMemberships, context.organizations, context.characters);
    const inspirationEntries = Array.isArray(context.inspirationEntries) ? context.inspirationEntries.slice(0, 6).map((entry) => {
      const record = entry;
      const tags = Array.isArray(record.tags) ? record.tags.map((tag) => String(tag)).join("、") : "";
      return `${String(record.type ?? "")} / ${String(record.title ?? "")}：${String(record.content ?? "")}${tags ? `（标签：${tags}）` : ""}`;
    }).join("\n") : "";
    const outlineItems = Array.isArray(context.outlineItems) ? context.outlineItems.slice(0, 8).map((item) => `${String(item.title ?? "")}：${String(item.summary ?? "")}`).join("\n") : "";
    const relatedChapters = Array.isArray(context.relatedChapters) ? context.relatedChapters.slice(0, 2).map((item, index) => {
      const record = item;
      return `关联章节${index + 1}：${String(record.title ?? "")}
摘要：${String(record.summary ?? "")}
正文预览：${String(record.preview ?? "")}`;
    }).join("\n\n") : "";
    const volumeChapterSummaries = Array.isArray(context.volumeChapterSummaries) ? context.volumeChapterSummaries.map((item, index) => {
      const record = item;
      return `第${index + 1}节：${String(record.title ?? "")}
  摘要：${String(record.summary ?? "") || "暂无摘要"}`;
    }).join("\n\n") : "";
    const novelOpenerSummaryDraft = context.novelOpenerSummary ? (() => {
      const record = context.novelOpenerSummary;
      return `标题：${String(record.title ?? "")}
摘要：${String(record.summary ?? "") || "暂无摘要"}`;
    })() : "";
    const openPlotThreadsDraft = Array.isArray(context.plotThreads) ? context.plotThreads.filter((t) => t.status === "open").map((t) => {
      const record = t;
      return `- ${String(record.title ?? "")}：${String(record.description ?? "")}`;
    }).join("\n") : "";
    const chapterContent = String(context.chapterContent ?? "").trim();
    const chapterHasExistingContent = Boolean(context.chapterHasExistingContent);
    const targetWordCount = String(context.targetWordCount ?? context.chapterWordTarget ?? "").trim();
    const writingStyleLabel = String(context.writingStyleLabel ?? "未指定");
    const writingStylePrompt = String(context.writingStylePrompt ?? "暂无");
    return wrapPrompt({
      system: `你是 CharacterArc 的章节初稿生成器。你的唯一任务，是基于项目设定、当前分卷目标、章节标题/摘要/大纲与角色关系，直接生成“这一章”的第一版正文草稿。只输出正文，不要解释，不要返回 JSON，不要写提示语，不要自我说明。

【任务边界】
- 这是“章节初稿生成”，不是润色，不是续写建议，不是分析。
- 如果当前章节正文为空，就按“从零起稿”处理，禁止假装承接不存在的前文。
- 如果当前章节正文不为空，也不要把任务理解成“续写”；你要重写并产出一版完整初稿，而不是在旧文后面往下接。
- 输出结果会直接覆盖当前章节全部内容，所以正文必须是完整可读的一章，不要输出提纲、注释、分点说明或“以下是初稿”。

【初稿写作目标】
- 先识别本章更接近哪类章节：布局章、事件章、过渡章、回收章，再决定写法。
- 章节必须有明确开场、推进和收束，不要写成散段拼贴。
- 开场直接入场景、动作、压力或利益交换，不要历史课件式开头，不要长段背景介绍。
- 每个主要段落都要推进至少一项：信息、关系、利益、风险、地位、资源、伏笔回收。
- 角色行为必须基于利益、恐惧、误判、立场和当前已知信息，不能为了推进剧情降智。
- 收益要落到具体资源、情报、关系变化、地位变化或钩子回收，不能写抽象提升。

【字数与完成度】
- 目标字数尽量贴近 ${targetWordCount || "当前章节预估字数"}，允许上下浮动约 10%。
- 不要为了凑字数灌水；宁可密度更高，也不要流水账。
- 如果目标字数较高，优先扩展冲突过程、人物互动、反馈兑现与余波，而不是堆背景说明。

【文风与质量约束】
- 项目默认风格：${writingStyleLabel}
- 风格要求：${writingStylePrompt}
- Show, don't tell。用动作、物件、感官、代价、价格、制度摩擦说话。
- 去AI味：句式长短交替，避免同一句式和同一主语反复起头；少堆高级词和空泛判断。
- 群像反应要具体，不要写成“全场震惊”模板。
- 配角和反派必须有自己的算盘、误判和反扑，不是木桩。
- 禁止机械降神，禁止无铺垫新设定救场，禁止文青病，禁止空话。

【连贯性规则】
- 你必须尊重当前分卷目标、章节摘要、相关大纲、世界观和人物关系。
- 可以参考相邻章节摘要与预览来保持整卷连续性，但不要把这次任务写成“上一章之后的补几段”。
- 如果当前上下文说明本章尚未写正文，就不要引用“本章前文已经发生了什么”这类不存在内容。

【输出要求】
- 只输出最终正文。
- 不要标题前缀，不要“第X章”编号，不要注释，不要小结，不要分析。`,
      user: `请为当前小说项目生成本章初稿。

项目标题：${String(context.projectTitle ?? "")}
项目题材：${String(context.projectGenre ?? "")}
当前分卷：${String(context.chapterVolumeTitle ?? "")}
当前分卷摘要：${String(context.chapterVolumeSummary ?? "")}
当前章节标题：${String(context.chapterTitle ?? "")}
当前章节摘要：${String(context.chapterSummary ?? "")}
当前章节状态：${String(context.chapterStatus ?? "")}
当前章节预估字数：${String(context.chapterWordTarget ?? "")}
目标字数：${targetWordCount || String(context.chapterWordTarget ?? "")}
当前章节是否已有正文：${chapterHasExistingContent ? "有，但本次要整章重写" : "没有，本次从零起稿"}
当前章节现有正文（如为空则代表从零起稿）：
${chapterContent || "【空】"}

相邻章节参考（含正文预览）：
${relatedChapters || "暂无"}

本卷章节概览（摘要，供情节衔接参考）：
${volumeChapterSummaries || "暂无"}

全书开篇（世界与角色基调参照）：
${novelOpenerSummaryDraft || "暂无"}

未收伏笔 / 活跃剧情线：
${openPlotThreadsDraft || "暂无（请注意：若有遗漏伏笔，请不要引入与已有伏笔矛盾的设定）"}

相关世界观：
${worldviewEntries || "暂无"}

相关角色：
${characters || "暂无"}

相关组织：
${organizations || "暂无"}

角色关系：
${relationships || "暂无"}

成员归属：
${memberships || "暂无"}

可用灵感：
${inspirationEntries || "暂无"}

相关大纲：
${outlineItems || "暂无"}

当前项目启用 skills：
${projectSkills || "暂无"}

补充要求：
${String(context.userPrompt ?? "")}

硬要求：
1. 生成的是”完整初稿”，不是续写，不是建议，不是分析。
2. 成稿直接覆盖当前章节全部内容，所以必须完整可读。
3. 如果当前正文为空，按从零起稿处理，不得虚构”上文已经写过”的内容。
4. 强贴当前章节标题、章节摘要、分卷目标和大纲，不要跑偏到别的章节。
5. 字数尽量贴近目标字数，允许上下浮动 10%。
6. 如果”未收伏笔 / 活跃剧情线”不为空，本章内容不得与这些线索相矛盾；若本章计划收尾某条线，请在正文中给出明确的收束情节。
7. 优先写出可继续改稿的第一版正文，不要解释。`
    });
  }
  if (task.task === "chapter-summarize") {
    return wrapPrompt({
      system: "你是小说章节摘要助手。请按照指定的四维格式输出纯文本摘要，不要输出 Markdown、JSON 或额外解释。",
      user: `请为以下章节生成一段结构化摘要，供后续章节创作时快速了解本章关键信息。

章节标题：${String(context.chapterTitle ?? "")}
章节正文：
${String(context.chapterContent ?? "")}

要求：
1. 严格按以下四维格式输出，每一维单独一行开头：
   核心事件：
   信息增量：
   状态变化：
   留存悬念：
2. 每一维用 1 到 2 句话描述，总字数控制在 80 到 150 字之间
3. 核心事件：本章推进的主要情节（发生了什么）
4. 信息增量：读者或人物获知的新信息（知道了什么）
5. 状态变化：人物、势力、资源的具体变化（改变了什么）
6. 留存悬念：埋下但未解的伏笔或疑问（留下了什么）
7. 不要输出"摘要："前缀，直接从"核心事件："开始
8. 只输出摘要正文，不要解释`
    });
  }
  if (task.task === "plot-thread-detect") {
    const existingThreads = Array.isArray(context.existingThreads) ? context.existingThreads : [];
    const existingList = existingThreads.length ? existingThreads.map((t) => `- ${String(t)}`).join("\n") : "（暂无）";
    return wrapPrompt({
      system: "你是专业小说编辑，擅长识别正文中的伏笔、未解悬念和潜在剧情线索。请只返回 JSON 对象，不要返回 Markdown 或多余文字。字段必须包含 entries 数组。",
      user: `请分析以下章节正文，识别其中明确埋下或潜在的伏笔与悬念，生成候选剧情线索列表。

章节标题：${String(context.chapterTitle ?? "")}

正文内容：
${String(context.chapterContent ?? "")}

已有线索（请勿重复）：
${existingList}

要求：
1. 只识别正文中真实存在的伏笔或悬念，不要凭空捏造
2. 每条线索给出简洁标题（≤20字）、详细描述（≤80字）和 1-3 个关联标签（角色名/地点/主题）
3. 最多返回 6 条，去掉与已有线索重复的内容
4. 按重要程度从高到低排列

返回格式：{"entries":[{"title":"","description":"","tags":[]}]}`
    });
  }
  return wrapPrompt({
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
2. wordTarget 使用"预估 xxxx字"格式
3. conflict 用一句话概括下一章的核心冲突
4. summary 用中文描述剧情推进，80 到 180 字
5. 与当前分卷目标、已有大纲和当前章节情绪保持连续，不要重复已有节点
6. ${writingStyleInstruction}

返回格式：{"title":"","wordTarget":"","conflict":"","summary":""}`
  });
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
function formatOrganizations(source) {
  return Array.isArray(source) ? source.slice(0, 6).map((entry) => {
    const record = entry;
    return `${String(record.name ?? "")} / ${String(record.type ?? "")}：${String(record.description ?? "")}${record.motto ? `（信条：${String(record.motto)}）` : ""}`;
  }).join("\n") : "";
}
function formatCharacterRelationships(source, charactersSource) {
  if (!Array.isArray(source)) {
    return "";
  }
  const characterNameMap = new Map(
    Array.isArray(charactersSource) ? charactersSource.map((character) => {
      const record = character;
      return [String(record.id ?? ""), String(record.name ?? "")];
    }) : []
  );
  return source.slice(0, 8).map((entry) => {
    const record = entry;
    const fromName = characterNameMap.get(String(record.fromCharacterId ?? "")) || String(record.fromCharacterId ?? "");
    const toName = characterNameMap.get(String(record.toCharacterId ?? "")) || String(record.toCharacterId ?? "");
    return `${fromName} -> ${toName} / ${String(record.type ?? "")}：${String(record.description ?? "")}（强度 ${String(record.intensity ?? "")}）`;
  }).join("\n");
}
function formatOrganizationMemberships(membershipsSource, organizationsSource, charactersSource) {
  if (!Array.isArray(membershipsSource)) {
    return "";
  }
  const organizationNameMap = new Map(
    Array.isArray(organizationsSource) ? organizationsSource.map((organization) => {
      const record = organization;
      return [String(record.id ?? ""), String(record.name ?? "")];
    }) : []
  );
  const characterNameMap = new Map(
    Array.isArray(charactersSource) ? charactersSource.map((character) => {
      const record = character;
      return [String(record.id ?? ""), String(record.name ?? "")];
    }) : []
  );
  return membershipsSource.slice(0, 8).map((entry) => {
    const record = entry;
    const characterName = characterNameMap.get(String(record.characterId ?? "")) || String(record.characterId ?? "");
    const organizationName = organizationNameMap.get(String(record.organizationId ?? "")) || String(record.organizationId ?? "");
    return `${characterName} 属于 ${organizationName} / 身份：${String(record.role ?? "")}${record.notes ? ` / 备注：${String(record.notes)}` : ""}`;
  }).join("\n");
}
function formatProjectSkills(source) {
  if (!Array.isArray(source)) {
    return "";
  }
  return source.slice(0, 4).map((entry, index) => {
    const record = entry;
    const name = String(record.name ?? `Skill ${index + 1}`);
    const description = String(record.description ?? "").trim();
    const content = String(record.content ?? "").trim().slice(0, 1200);
    return `Skill ${index + 1}：${name}
说明：${description || "暂无说明"}
内容摘录：
${content || "暂无内容"}`;
  }).join("\n\n");
}
function resolveWritingStyleInstruction(context) {
  const label = String(context.writingStyleLabel ?? "").trim();
  const prompt = String(context.writingStylePrompt ?? "").trim();
  if (!label && !prompt) {
    return "若当前项目未指定写作风格，则使用最贴合作品题材的自然表达。";
  }
  if (label && prompt) {
    return `当前项目默认写作风格为"${label}"。请在输出中遵循以下风格要求：${prompt}`;
  }
  if (label) {
    return `当前项目默认写作风格为"${label}"，请让输出保持这一风格的一致性。`;
  }
  return `请在输出中遵循以下写作风格要求：${prompt}`;
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
    case "chapter-analysis":
    case "reference-style-chunk":
    case "reference-style-analysis":
    case "inspiration-pack":
    case "plot-thread-detect":
    case "outline-batch":
    case "outline-chain":
    case "workflow-documents":
      return 1200;
    case "chapter-first-draft":
      return 2200;
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
const FETCH_MODELS_TIMEOUT_MS = 15e3;
const KNOWN_COMPAT_SUFFIXES = [
  "/api/claudecode",
  "/api/anthropic",
  "/apps/anthropic",
  "/api/coding",
  "/claudecode",
  "/anthropic",
  "/step_plan",
  "/coding",
  "/claude"
];
function stripCompatSuffix(baseUrl) {
  for (const suffix of KNOWN_COMPAT_SUFFIXES) {
    if (baseUrl.endsWith(suffix)) {
      return baseUrl.slice(0, baseUrl.length - suffix.length);
    }
  }
  return null;
}
function buildModelsUrlCandidates(baseUrl) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) return [];
  const candidates = [];
  if (trimmed.endsWith("/v1")) {
    candidates.push(`${trimmed}/models`);
  } else {
    candidates.push(`${trimmed}/v1/models`);
  }
  const stripped = stripCompatSuffix(trimmed);
  if (stripped) {
    const root = stripped.replace(/\/+$/, "");
    if (root.includes("://") && root.length > root.indexOf("://") + 3) {
      candidates.push(`${root}/v1/models`);
      candidates.push(`${root}/models`);
    }
  }
  return [...new Set(candidates)];
}
async function fetchModelsOpenAiCompatible(baseUrl, apiKey) {
  const candidates = buildModelsUrlCandidates(baseUrl);
  if (candidates.length === 0) {
    throw new Error("Base URL 为空，无法获取模型列表。");
  }
  let lastError = null;
  for (const url of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_MODELS_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          ...apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
        },
        signal: controller.signal
      });
      if (response.status === 404 || response.status === 405) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      const models = (data.data ?? []).map((m) => ({
        id: m.id,
        ownedBy: m.owned_by ?? null
      }));
      models.sort((a, b) => a.id.localeCompare(b.id));
      return models;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("获取模型列表超时，请检查网络或代理设置。");
      }
      if (lastError !== null) continue;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`所有候选端点均返回 ${lastError ?? "错误"}，该供应商可能未开放模型列表接口。`);
}
async function fetchModelsAnthropic(baseUrl, apiKey) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  const url = `${trimmed}/v1/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_MODELS_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Anthropic 模型列表请求失败：HTTP ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const models = (data.data ?? []).map((m) => ({
      id: m.id,
      ownedBy: m.owned_by ?? null
    }));
    models.sort((a, b) => a.id.localeCompare(b.id));
    return models;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("获取 Anthropic 模型列表超时，请检查网络或代理设置。");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
async function fetchModels(settings) {
  const normalized = normalizeSettings(settings);
  if (!normalized.baseUrl.trim()) {
    throw new Error("请先填写 Base URL。");
  }
  if (normalized.provider === "anthropic") {
    if (!normalized.apiKey.trim()) {
      throw new Error("Anthropic 供应商需要 API Key 才能获取模型列表。");
    }
    return fetchModelsAnthropic(normalized.baseUrl, normalized.apiKey);
  }
  return fetchModelsOpenAiCompatible(normalized.baseUrl, normalized.apiKey);
}
async function requestAiText(settings, prompt, task) {
  return settings.provider === "anthropic" ? requestAnthropic(settings, prompt, task) : requestOpenAiCompatible(settings, prompt, task);
}
async function requestAiTextStream(settings, prompt, handlers, signal, task) {
  return settings.provider === "anthropic" ? requestAnthropicStream(settings, prompt, handlers, signal, task) : requestOpenAiCompatibleStream(settings, prompt, handlers, signal, task);
}
const AI_PROMPT_LOG_DIR = node_path.join(process.cwd(), ".logs");
const AI_PROMPT_LOG_FILE = node_path.join(AI_PROMPT_LOG_DIR, "ai-prompts.log");
async function writePromptLogFile(content) {
  try {
    await promises.mkdir(AI_PROMPT_LOG_DIR, { recursive: true });
    await promises.appendFile(AI_PROMPT_LOG_FILE, `${content}
`, "utf8");
  } catch (error) {
    console.error("[ai] failed to write prompt log file:", error);
  }
}
function logPrompt(label, settings, prompt, task) {
  const taskLabel = task?.task ?? "unknown";
  const provider = settings.provider || "unknown";
  const model = settings.model || "unknown";
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const content = [
    "",
    `===== AI 提示词 ${label} =====`,
    `时间: ${timestamp}`,
    `任务: ${taskLabel}`,
    `提供者: ${provider}`,
    `模型: ${model}`,
    "--- SYSTEM ---",
    prompt.system || "",
    "--- USER ---",
    prompt.user || "",
    `===== END AI 提示词 ${label} =====`
  ].join("\n");
  console.log(`[ai] prompt logged: ${label} | task=${taskLabel} | provider=${provider} | model=${model} | file=${AI_PROMPT_LOG_FILE}`);
  void writePromptLogFile(content);
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
  return task.task !== "chapter-assistant" && task.task !== "chapter-first-draft" && task.task !== "chapter-summarize";
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
function normalizeOutlineBatchResult(result) {
  const payload = result;
  const entries = Array.isArray(payload.entries) ? payload.entries.slice(0, 5).map((entry) => normalizeOutlineResult(entry)) : [];
  return {
    entries
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
function normalizeWorkflowDocumentsResult(result) {
  const payload = result;
  const normalizeText = (value, fallback) => String(value ?? "").trim() || fallback;
  return {
    task_plan: normalizeText(payload.task_plan, "# 任务计划\n\n- 待补充。"),
    findings: normalizeText(payload.findings, "# 发现记录\n\n- 待补充。"),
    progress: normalizeText(payload.progress, "# 进度记录\n\n- 待补充。"),
    current_status: normalizeText(payload.current_status, "# 当前状态卡\n\n- 待补充。"),
    novel_setting: normalizeText(payload.novel_setting, "# 小说设定\n\n- 待补充。"),
    character_relationships: normalizeText(payload.character_relationships, "# 人物关系盘\n\n- 待补充。"),
    pending_hooks: normalizeText(payload.pending_hooks, "# 待回收钩子\n\n- 待补充。"),
    resource_ledger: normalizeText(payload.resource_ledger, "# 资源账本\n\n- 待补充。")
  };
}
function normalizeChapterAnalysisResult(result) {
  const payload = result;
  const toList = (value, fallback) => {
    if (!Array.isArray(value)) {
      return fallback;
    }
    const normalized = value.map((item) => String(item).trim()).filter(Boolean).slice(0, 5);
    return normalized.length ? normalized : fallback;
  };
  return {
    overview: payload.overview?.trim() || "这一章已经形成基础场景与推进，但还需要进一步打磨节奏和信息聚焦。",
    pacing: payload.pacing?.trim() || "节奏判断暂不稳定，建议重新检查铺垫与推进的比例。",
    tension: payload.tension?.trim() || "张力表达仍有提升空间，需要强化冲突触发点和情绪落点。",
    continuity: payload.continuity?.trim() || "连续性基本成立，但还需要核对角色动机、设定引用和上下章衔接。",
    highlights: toList(payload.highlights, ["章节已经建立了基本情境，可以继续沿当前方向深化。"]),
    risks: toList(payload.risks, ["当前分析未提取到明确风险，建议人工复核逻辑与节奏。"]),
    revisionActions: toList(payload.revisionActions, ["先挑一段关键正文，按冲突、节奏和画面感三个维度逐句重写。"])
  };
}
function normalizeReferenceStyleAnalysisResult(result) {
  const payload = result;
  const toList = (value, fallback) => {
    if (!Array.isArray(value)) {
      return fallback;
    }
    const normalized = value.map((item) => String(item).trim()).filter(Boolean).slice(0, 6);
    return normalized.length ? normalized : fallback;
  };
  return {
    overview: payload.overview?.trim() || "该参考作品的风格重在稳定推进、明确反馈和鲜明的场景驱动。",
    sentenceStyle: payload.sentenceStyle?.trim() || "句式偏直给，叙述密度中等，以动作和结果优先。",
    dialogueRatio: payload.dialogueRatio?.trim() || "对白占比适中，主要承担推进信息和制造张力。",
    pacingControl: payload.pacingControl?.trim() || "节奏以短回合冲突推进，尽量避免长时间停滞解释。",
    emotionExpression: payload.emotionExpression?.trim() || "情绪表达偏外显，通过动作、停顿和措辞变化落地。",
    narrativePerspective: payload.narrativePerspective?.trim() || "叙事视角相对稳定，画面切换服务冲突与反馈。",
    styleRules: toList(payload.styleRules, ["保持句子干净直接，每段都要有信息推进或关系变化。"]),
    plotOutline: payload.plotOutline?.trim() || "故事骨架围绕主角目标、外部压迫和持续兑现的阶段收益展开。",
    reusableStylePrompt: payload.reusableStylePrompt?.trim() || "用简洁句式、较高对白驱动和快反馈节奏写作，少做空泛描写，多让冲突在场景里直接落地。",
    avoidRules: toList(payload.avoidRules, ["不要照搬原作的人名、专有设定、组织结构和具体桥段顺序。"])
  };
}
function normalizeReferenceStyleChunkResult(result) {
  const payload = result;
  const toList = (value, fallback) => {
    if (!Array.isArray(value)) {
      return fallback;
    }
    const normalized = value.map((item) => String(item).trim()).filter(Boolean).slice(0, 4);
    return normalized.length ? normalized : fallback;
  };
  return {
    overview: payload.overview?.trim() || "这一段以稳定推进和局部反馈为主，能代表原作的一部分风格倾向。",
    sentenceStyle: payload.sentenceStyle?.trim() || "句式偏直接，叙述重点落在动作与结果。",
    dialogueRatio: payload.dialogueRatio?.trim() || "对白承担推进信息和制造对抗的职责。",
    pacingControl: payload.pacingControl?.trim() || "节奏以短回合推进，少停留在纯说明。",
    emotionExpression: payload.emotionExpression?.trim() || "情绪通过动作、停顿和人物反应外化。",
    plotFunction: payload.plotFunction?.trim() || "该段桥段主要承担冲突抬升或信息兑现。",
    styleRules: toList(payload.styleRules, ["保持信息推进和场景反馈同步，不做空转描写。"])
  };
}
function normalizeInspirationResult(result) {
  const entry = result;
  const tags = Array.isArray(entry.tags) ? entry.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 4) : [];
  return {
    type: entry.type?.trim() || "场景火花",
    title: entry.title?.trim() || "新的灵感切口",
    content: entry.content?.trim() || "AI 未返回有效灵感内容",
    tags: tags.length ? tags : ["待扩写", "灵感"]
  };
}
function normalizeInspirationPackResult(result) {
  const payload = result;
  const entries = Array.isArray(payload.entries) ? payload.entries.slice(0, 6).map((entry) => normalizeInspirationResult(entry)) : [];
  return {
    entries
  };
}
function normalizePlotThreadDetectResult(result) {
  const payload = result;
  const entries = Array.isArray(payload.entries) ? payload.entries.slice(0, 6).map((entry) => {
    const e = entry;
    const tags = Array.isArray(e.tags) ? e.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 3) : [];
    return {
      title: e.title?.trim() || "未命名伏笔",
      description: e.description?.trim() || "暂无描述",
      tags
    };
  }) : [];
  return { entries };
}
function isTaskResultUsable(task, result) {
  if (task.task === "chapter-assistant" || task.task === "chapter-first-draft") {
    return Boolean(result.content?.trim());
  }
  if (task.task === "project-bootstrap") {
    const payload = result;
    return payload.worldviewEntries.length > 0 && payload.outlineItems.length > 0;
  }
  if (task.task === "chapter-analysis") {
    const analysis = result;
    return Boolean(
      analysis.overview.trim() && analysis.pacing.trim() && analysis.tension.trim() && analysis.continuity.trim() && analysis.highlights.length > 0 && analysis.risks.length > 0 && analysis.revisionActions.length > 0
    );
  }
  if (task.task === "reference-style-analysis") {
    const analysis = result;
    return Boolean(
      analysis.overview.trim() && analysis.sentenceStyle.trim() && analysis.dialogueRatio.trim() && analysis.pacingControl.trim() && analysis.emotionExpression.trim() && analysis.narrativePerspective.trim() && analysis.styleRules.length > 0 && analysis.plotOutline.trim() && analysis.reusableStylePrompt.trim() && analysis.avoidRules.length > 0
    );
  }
  if (task.task === "reference-style-chunk") {
    const analysis = result;
    return Boolean(
      analysis.overview.trim() && analysis.sentenceStyle.trim() && analysis.dialogueRatio.trim() && analysis.pacingControl.trim() && analysis.emotionExpression.trim() && analysis.plotFunction.trim() && analysis.styleRules.length > 0
    );
  }
  if (task.task === "inspiration-pack") {
    const payload = result;
    return payload.entries.length > 0;
  }
  if (task.task === "plot-thread-detect") {
    const payload = result;
    return payload.entries.length > 0;
  }
  if (task.task === "outline-batch" || task.task === "outline-chain") {
    const payload = result;
    return payload.entries.length > 0;
  }
  if (task.task === "workflow-documents") {
    const payload = result;
    return Boolean(
      payload.task_plan.trim() && payload.findings.trim() && payload.progress.trim() && payload.current_status.trim() && payload.novel_setting.trim() && payload.character_relationships.trim() && payload.pending_hooks.trim() && payload.resource_ledger.trim()
    );
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
  if (task.task === "chapter-assistant" || task.task === "chapter-first-draft" || task.task === "chapter-summarize") {
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
    case "workflow-documents":
      return normalizeWorkflowDocumentsResult(parsed);
    case "outline-batch":
    case "outline-chain":
      return normalizeOutlineBatchResult(parsed);
    case "chapter-analysis":
      return normalizeChapterAnalysisResult(parsed);
    case "reference-style-chunk":
      return normalizeReferenceStyleChunkResult(parsed);
    case "reference-style-analysis":
      return normalizeReferenceStyleAnalysisResult(parsed);
    case "inspiration-pack":
      return normalizeInspirationPackResult(parsed);
    case "plot-thread-detect":
      return normalizePlotThreadDetectResult(parsed);
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
  const repairPrompt = buildRepairPrompt(task, rawText);
  logPrompt("REPAIR", settings, repairPrompt, task);
  const repairedText = await requestAiText(settings, repairPrompt, task);
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
  logPrompt("TEST", settings, probePrompt);
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
  logPrompt("REQUEST", settings, prompt, task);
  const rawText = await requestAiText(settings, prompt, task);
  return resolveTaskResult(task, settings, rawText);
}
async function streamAiTask(task, handlers, signal) {
  if (task.task !== "chapter-assistant" && task.task !== "chapter-first-draft") {
    throw new Error("当前流式输出仅支持章节创作助理和章节初稿生成。");
  }
  const settings = normalizeSettings(task.settings);
  validateSettings(settings);
  const prompt = buildTaskPrompt(task);
  logPrompt("STREAM", settings, prompt, task);
  const rawText = await requestAiTextStream(settings, prompt, handlers, signal, task);
  return normalizeAssistantText(rawText);
}
let jiebaRuntimePromise = null;
const CHAPTER_HEADING_RE = /^(第[0-9零一二三四五六七八九十百千万两]+[章节回卷部集][^\n]{0,40})$/gm;
const MAX_ANALYSIS_CHUNKS = 12;
const MAX_CHUNK_CHAR_COUNT = 6e3;
const CHUNK_KEYWORD_LIMIT = 8;
const STOP_WORDS = /* @__PURE__ */ new Set([
  "一个",
  "一种",
  "一些",
  "没有",
  "他们",
  "自己",
  "这个",
  "那个",
  "这里",
  "那里",
  "我们",
  "你们",
  "不是",
  "然后",
  "已经",
  "可以",
  "因为",
  "所以",
  "而且",
  "只是",
  "还是",
  "如果",
  "但是",
  "开始",
  "时候",
  "东西",
  "什么",
  "怎么",
  "一个人",
  "一下",
  "出来",
  "进去",
  "之后",
  "之前",
  "起来",
  "下来",
  "现在",
  "真的",
  "有些",
  "这种",
  "那种"
]);
async function getJiebaRuntime() {
  if (!jiebaRuntimePromise) {
    jiebaRuntimePromise = (async () => {
      const [{ Jieba, TfIdf }, { dict, idf }] = await Promise.all([
        import("@node-rs/jieba"),
        import("@node-rs/jieba/dict")
      ]);
      return {
        jieba: Jieba.withDict(dict),
        tfidf: TfIdf.withDict(idf)
      };
    })();
  }
  return jiebaRuntimePromise;
}
function resolveFileType(filePath) {
  const extension = node_path.extname(filePath).toLowerCase();
  if (extension === ".docx") {
    return "docx";
  }
  if (extension === ".md" || extension === ".markdown") {
    return "md";
  }
  return "txt";
}
function normalizeNovelText(rawText) {
  return rawText.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
async function readNovelText(filePath, fileType) {
  if (fileType === "docx") {
    const mammoth = await Promise.resolve().then(() => require("./index-DksbR5ML.js")).then((n) => n.index);
    const result = await mammoth.extractRawText({ path: filePath });
    return normalizeNovelText(result.value);
  }
  const buffer = await promises.readFile(filePath);
  return normalizeNovelText(buffer.toString("utf-8"));
}
function splitParagraphs(text) {
  return text.split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean);
}
function splitChapters(text) {
  const matches = Array.from(text.matchAll(CHAPTER_HEADING_RE));
  if (matches.length >= 3) {
    return matches.map((match, index) => {
      const start = match.index ?? 0;
      const end = matches[index + 1]?.index ?? text.length;
      return text.slice(start, end).trim();
    }).filter(Boolean);
  }
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length === 0) {
    return [];
  }
  const chunks = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if ((current + "\n\n" + paragraph).length > 2600 && current.trim()) {
      chunks.push(current.trim());
      current = paragraph;
      continue;
    }
    current = current ? `${current}

${paragraph}` : paragraph;
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }
  return chunks;
}
function clipText(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength).trim()}……`;
}
function buildAnalysisSample(chapters, text) {
  const sourceSections = chapters.length >= 3 ? [chapters[0], chapters[Math.floor(chapters.length / 2)], chapters[chapters.length - 1]] : [
    text.slice(0, 2200),
    text.slice(Math.max(0, Math.floor(text.length / 2) - 1100), Math.max(0, Math.floor(text.length / 2) - 1100) + 2200),
    text.slice(Math.max(0, text.length - 2200))
  ];
  return sourceSections.map((section, index) => {
    const label = index === 0 ? "开篇样本" : index === 1 ? "中段样本" : "后段样本";
    return `【${label}】
${clipText(section.trim(), 2200)}`;
  }).join("\n\n");
}
function computeMetrics(text, chapters) {
  const plainText = text.replace(/\s+/g, "");
  const characterCount = plainText.length;
  const paragraphs = splitParagraphs(text);
  const sentences = text.split(/[。！？!?；;]+/).map((sentence) => sentence.replace(/\s+/g, "").trim()).filter(Boolean);
  const dialogueParagraphCount = paragraphs.filter((paragraph) => /[“”「」『』"']/u.test(paragraph)).length;
  const shortSentenceCount = sentences.filter((sentence) => sentence.length <= 18).length;
  const emotionMarkCount = (text.match(/[!?！？]/g) ?? []).length;
  const avgSentenceLength = sentences.length ? plainText.length / sentences.length : 0;
  const dialogueParagraphRatio = paragraphs.length ? dialogueParagraphCount / paragraphs.length : 0;
  const shortSentenceRatio = sentences.length ? shortSentenceCount / sentences.length : 0;
  const emotionMarksPerThousand = characterCount ? emotionMarkCount / characterCount * 1e3 : 0;
  return [
    { label: "总字数", value: `${characterCount.toLocaleString("zh-CN")} 字` },
    { label: "章节估计", value: `${Math.max(chapters.length, 1)} 段/章` },
    { label: "平均句长", value: `${avgSentenceLength.toFixed(1)} 字/句` },
    { label: "对白段落占比", value: `${(dialogueParagraphRatio * 100).toFixed(0)}%` },
    { label: "短句比例", value: `${(shortSentenceRatio * 100).toFixed(0)}%` },
    { label: "情绪标点密度", value: `每千字 ${emotionMarksPerThousand.toFixed(1)} 个` }
  ];
}
async function extractKeywords(text, limit = 10) {
  const { jieba, tfidf } = await getJiebaRuntime();
  const keywords = tfidf.extractKeywords(jieba, clipText(text, 36e3), Math.max(limit * 2, 18));
  return keywords.map((entry) => entry.keyword.trim()).filter((keyword) => keyword.length >= 2 && !STOP_WORDS.has(keyword)).slice(0, limit);
}
function mergeSectionsIntoChunks(sections) {
  if (sections.length === 0) {
    return [];
  }
  const merged = [];
  let current = "";
  for (const section of sections) {
    if (section.length > MAX_CHUNK_CHAR_COUNT) {
      if (current.trim()) {
        merged.push(current.trim());
        current = "";
      }
      for (let index = 0; index < section.length; index += MAX_CHUNK_CHAR_COUNT) {
        const slice = section.slice(index, index + MAX_CHUNK_CHAR_COUNT).trim();
        if (slice) {
          merged.push(slice);
        }
      }
      continue;
    }
    const candidate = current ? `${current}

${section}` : section;
    if (candidate.length > MAX_CHUNK_CHAR_COUNT && current.trim()) {
      merged.push(current.trim());
      current = section;
      continue;
    }
    current = candidate;
  }
  if (current.trim()) {
    merged.push(current.trim());
  }
  return merged;
}
function pickRepresentativeChunkIndexes(total) {
  if (total <= MAX_ANALYSIS_CHUNKS) {
    return Array.from({ length: total }, (_, index) => index);
  }
  const indexes = /* @__PURE__ */ new Set([0, total - 1, Math.floor(total / 2)]);
  const step = (total - 1) / (MAX_ANALYSIS_CHUNKS - 1);
  for (let index = 0; index < MAX_ANALYSIS_CHUNKS; index += 1) {
    indexes.add(Math.round(index * step));
  }
  return Array.from(indexes).sort((left, right) => left - right).slice(0, MAX_ANALYSIS_CHUNKS);
}
function buildChunkLabel(index, total) {
  if (index === 0) {
    return "开篇段";
  }
  if (index === total - 1) {
    return "收束段";
  }
  const ratio = total <= 1 ? 0 : index / (total - 1);
  if (ratio < 0.34) {
    return "前段";
  }
  if (ratio > 0.66) {
    return "后段";
  }
  return "中段";
}
async function buildAnalysisChunks(chapters) {
  const mergedChunks = mergeSectionsIntoChunks(chapters);
  const selectedIndexes = pickRepresentativeChunkIndexes(mergedChunks.length);
  return Promise.all(selectedIndexes.map(async (chunkIndex, order) => {
    const text = mergedChunks[chunkIndex];
    const plainText = text.replace(/\s+/g, "");
    const label = `${buildChunkLabel(chunkIndex, mergedChunks.length)} ${chunkIndex + 1}/${mergedChunks.length}`;
    return {
      id: `chunk-${chunkIndex + 1}`,
      label,
      order,
      text,
      characterCount: plainText.length,
      topKeywords: await extractKeywords(text, CHUNK_KEYWORD_LIMIT),
      metrics: computeMetrics(text, [text])
    };
  }));
}
async function extractReferenceNovelContext(filePath) {
  const fileType = resolveFileType(filePath);
  const fileName = node_path.basename(filePath);
  const title = node_path.basename(filePath, node_path.extname(filePath)).trim() || "未命名参考作品";
  const text = await readNovelText(filePath, fileType);
  if (!text.trim()) {
    throw new Error("导入的文件没有可用正文，请确认文件内容不是空白。");
  }
  const chapters = splitChapters(text);
  const excerpt = clipText(chapters[0] ?? text, 800);
  const [topKeywords, analysisChunks] = await Promise.all([
    extractKeywords(text),
    buildAnalysisChunks(chapters)
  ]);
  return {
    title,
    fileName,
    fileType,
    excerpt,
    analysisSample: buildAnalysisSample(chapters, text),
    characterCount: text.replace(/\s+/g, "").length,
    chapterCount: Math.max(chapters.length, 1),
    topKeywords,
    metrics: computeMetrics(text, chapters),
    analysisChunks
  };
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
function resolveWindowIconPath() {
  const packagedIconPath = node_path.join(process.resourcesPath, "icon.png");
  if (node_fs.existsSync(packagedIconPath)) {
    return packagedIconPath;
  }
  const localIconPath = node_path.join(process.cwd(), "resources/icon.png");
  if (node_fs.existsSync(localIconPath)) {
    return localIconPath;
  }
  return void 0;
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
  const rendererHtml = node_path.join(__dirname, "../../out/renderer/index.html");
  console.log("[renderer] loadFile →", rendererHtml);
  void window.loadFile(rendererHtml, search ? { search } : void 0);
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
  const windowIcon = resolveWindowIconPath();
  const window = new electron.BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    icon: windowIcon,
    autoHideMenuBar: true,
    title: `弧光 v${electron.app.getVersion()}`,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    // Keep native caption buttons while giving the renderer a compact title-bar area to style around.
    titleBarOverlay: process.platform === "win32" ? {
      color: "#f5f5f7",
      symbolColor: "#1d1d1f"
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
  const windowIcon = resolveWindowIconPath();
  const window = new electron.BrowserWindow({
    width: ASSISTANT_WINDOW_WIDTH,
    height: ASSISTANT_WINDOW_HEIGHT,
    minWidth: ASSISTANT_WINDOW_MIN_WIDTH,
    minHeight: ASSISTANT_WINDOW_MIN_HEIGHT,
    icon: windowIcon,
    x: assistantX,
    y: assistantY,
    parent: mainWindow ?? void 0,
    autoHideMenuBar: true,
    title: `character-arc v${electron.app.getVersion()} - AI 创作助理`,
    maximizable: false,
    fullscreenable: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    titleBarOverlay: process.platform === "win32" ? {
      color: "#f4f7fb",
      symbolColor: "#1d1d1f"
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
function getProjectSkillsDirPath() {
  return node_path.join(process.cwd(), ".project-skills");
}
async function readProjectSkillsFromDisk() {
  const root = getProjectSkillsDirPath();
  const entries = await promises.readdir(root, { withFileTypes: true });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillPath = node_path.join(root, entry.name, "SKILL.md");
    try {
      const content = await promises.readFile(skillPath, "utf-8");
      const nameMatch = content.match(/^name:\s*(.+)$/m);
      const descriptionMatch = content.match(/^description:\s*(.+)$/m);
      skills.push({
        id: entry.name,
        name: nameMatch?.[1]?.trim() || entry.name,
        path: `.project-skills/${entry.name}`,
        description: descriptionMatch?.[1]?.trim() || "",
        enabled: true
      });
    } catch {
    }
  }
  return skills;
}
async function readProjectSkillContextsFromDisk() {
  const root = getProjectSkillsDirPath();
  const entries = await promises.readdir(root, { withFileTypes: true });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillPath = node_path.join(root, entry.name, "SKILL.md");
    try {
      const content = await promises.readFile(skillPath, "utf-8");
      const nameMatch = content.match(/^name:\s*(.+)$/m);
      const descriptionMatch = content.match(/^description:\s*(.+)$/m);
      skills.push({
        id: entry.name,
        name: nameMatch?.[1]?.trim() || entry.name,
        description: descriptionMatch?.[1]?.trim() || "",
        content
      });
    } catch {
    }
  }
  return skills;
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
      novel_length TEXT NOT NULL DEFAULT 'long',
      word_count TEXT NOT NULL,
      last_edited TEXT NOT NULL,
      cover TEXT NOT NULL,
      target_platform TEXT NOT NULL DEFAULT '',
      reference_works_json TEXT NOT NULL DEFAULT '[]',
      writing_style_preset_id TEXT NOT NULL DEFAULT 'cinematic-cool',
      writing_style_prompt TEXT NOT NULL DEFAULT '',
      novel_workflow_stages_json TEXT NOT NULL DEFAULT '[]',
      project_skills_json TEXT NOT NULL DEFAULT '[]',
      chapter_assistant_templates_json TEXT NOT NULL DEFAULT '[]'
    ) STRICT;

    CREATE TABLE IF NOT EXISTS worldview_entries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      motto TEXT NOT NULL,
      color TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS character_relationships (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      from_character_id TEXT NOT NULL,
      to_character_id TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      intensity INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS organization_memberships (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      role TEXT NOT NULL,
      notes TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS inspiration_entries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      source TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS workflow_documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      volume_id TEXT NOT NULL DEFAULT 'volume-legacy-default',
      doc_key TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
      FOREIGN KEY (volume_id) REFERENCES outline_volumes (id) ON DELETE CASCADE
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
  const worldviewColumns = workspaceDb.prepare(`PRAGMA table_info(worldview_entries)`).all();
  const worldviewColumnNames = new Set(worldviewColumns.map((column) => column.name));
  if (!worldviewColumnNames.has("created_at")) {
    workspaceDb.exec(`ALTER TABLE worldview_entries ADD COLUMN created_at TEXT NOT NULL DEFAULT '';`);
  }
  if (!worldviewColumnNames.has("updated_at")) {
    workspaceDb.exec(`ALTER TABLE worldview_entries ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';`);
  }
  workspaceDb.exec(`
    UPDATE worldview_entries
    SET created_at = COALESCE(NULLIF(created_at, ''), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at = COALESCE(NULLIF(updated_at, ''), created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    WHERE created_at = '' OR updated_at = '';
  `);
  ensureAppSettingsColumns(workspaceDb);
  ensureChapterColumns(workspaceDb);
  ensureProjectColumns(workspaceDb);
  ensureProjectScopedColumns(workspaceDb);
  ensureVolumeColumns(workspaceDb);
  ensureWorkflowDocumentColumns(workspaceDb);
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
  if (!columnNames.has("outline_item_id")) {
    db.exec(`ALTER TABLE chapters ADD COLUMN outline_item_id TEXT NOT NULL DEFAULT '';`);
  }
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
  const projectScopedTables = ["worldview_entries", "characters", "organizations", "character_relationships", "organization_memberships", "inspiration_entries", "outline_volumes", "outline_items", "chapters", "chapter_versions", "ai_messages"];
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
  const outlineColumns = db.prepare(`PRAGMA table_info('outline_items')`).all();
  const outlineColumnNames = new Set(outlineColumns.map((column) => column.name));
  if (!outlineColumnNames.has("status")) {
    db.exec(`ALTER TABLE outline_items ADD COLUMN status TEXT NOT NULL DEFAULT 'planned';`);
  }
}
function ensureWorkflowDocumentColumns(db) {
  const columns = db.prepare(`PRAGMA table_info('workflow_documents')`).all();
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("project_id")) {
    const defaultProjectId = db.prepare(`SELECT selected_project_id AS projectId FROM app_settings WHERE id = 1`).get()?.projectId || db.prepare(`SELECT id FROM projects ORDER BY rowid ASC LIMIT 1`).get()?.id || "project-1";
    db.exec(`ALTER TABLE workflow_documents ADD COLUMN project_id TEXT NOT NULL DEFAULT '${defaultProjectId}';`);
  }
  if (!columnNames.has("volume_id")) {
    db.exec(`ALTER TABLE workflow_documents ADD COLUMN volume_id TEXT NOT NULL DEFAULT '';`);
  }
  db.exec(`
    UPDATE workflow_documents
    SET volume_id = COALESCE(
      (
        SELECT id
        FROM outline_volumes
        WHERE outline_volumes.project_id = workflow_documents.project_id
        ORDER BY sort_order ASC, rowid ASC
        LIMIT 1
      ),
      'volume-legacy-default'
    )
    WHERE COALESCE(volume_id, '') = '';
  `);
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
function ensureProjectColumns(db) {
  const columns = db.prepare(`PRAGMA table_info('projects')`).all();
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("novel_length")) {
    db.exec(`ALTER TABLE projects ADD COLUMN novel_length TEXT NOT NULL DEFAULT 'long';`);
  }
  if (!columnNames.has("writing_style_preset_id")) {
    db.exec(`ALTER TABLE projects ADD COLUMN writing_style_preset_id TEXT NOT NULL DEFAULT 'cinematic-cool';`);
  }
  if (!columnNames.has("writing_style_prompt")) {
    db.exec(`ALTER TABLE projects ADD COLUMN writing_style_prompt TEXT NOT NULL DEFAULT '';`);
  }
  if (!columnNames.has("chapter_assistant_templates_json")) {
    db.exec(`ALTER TABLE projects ADD COLUMN chapter_assistant_templates_json TEXT NOT NULL DEFAULT '[]';`);
  }
  if (!columnNames.has("novel_workflow_stages_json")) {
    db.exec(`ALTER TABLE projects ADD COLUMN novel_workflow_stages_json TEXT NOT NULL DEFAULT '[]';`);
  }
  if (!columnNames.has("project_skills_json")) {
    db.exec(`ALTER TABLE projects ADD COLUMN project_skills_json TEXT NOT NULL DEFAULT '[]';`);
  }
  if (!columnNames.has("target_platform")) {
    db.exec(`ALTER TABLE projects ADD COLUMN target_platform TEXT NOT NULL DEFAULT '';`);
  }
  if (!columnNames.has("reference_works_json")) {
    db.exec(`ALTER TABLE projects ADD COLUMN reference_works_json TEXT NOT NULL DEFAULT '[]';`);
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
function normalizeProjectRecord(project) {
  return {
    id: project.id,
    title: project.title || "未命名作品",
    genre: project.genre || "未分类",
    novelLength: project.novelLength === "short" ? "short" : "long",
    wordCount: project.wordCount || "待统计",
    lastEdited: project.lastEdited || "刚刚更新",
    cover: project.cover || "linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)",
    targetPlatform: project.targetPlatform || "",
    referenceWorks: Array.isArray(project.referenceWorks) ? project.referenceWorks : [],
    writingStylePresetId: project.writingStylePresetId || "cinematic-cool",
    writingStylePrompt: project.writingStylePrompt || "",
    novelWorkflowStages: Array.isArray(project.novelWorkflowStages) ? project.novelWorkflowStages : [],
    projectSkills: Array.isArray(project.projectSkills) ? project.projectSkills : [],
    chapterAssistantTemplates: Array.isArray(project.chapterAssistantTemplates) ? project.chapterAssistantTemplates : []
  };
}
function buildImportedReferenceStylePrompt(title, analysis) {
  return [
    `以下规则来自参考作品《${title}》的拆书结果，已做去具体化处理，只借鉴文笔和结构骨架，不复用专有设定：`,
    analysis.reusableStylePrompt,
    `补充校准：句式 ${analysis.sentenceStyle}；对白 ${analysis.dialogueRatio}；节奏 ${analysis.pacingControl}；情绪 ${analysis.emotionExpression}；视角 ${analysis.narrativePerspective}。`
  ].join("\n");
}
function buildImportedReferenceFindingsMarkdown(title, analysis, metrics, keywords) {
  const metricLines = metrics.map((metric) => `- ${metric.label}：${metric.value}`).join("\n");
  const styleRuleLines = analysis.styleRules.map((rule) => `- ${rule}`).join("\n");
  const avoidRuleLines = analysis.avoidRules.map((rule) => `- ${rule}`).join("\n");
  return [
    `- 参考作品：${title}`,
    `- 风格总述：${analysis.overview}`,
    ...keywords.length ? [`- 关键词：${keywords.join("、")}`] : [],
    "",
    "### 局部统计",
    metricLines,
    "",
    "### 可复用风格规则",
    styleRuleLines,
    "",
    "### 去具体化剧情骨架",
    analysis.plotOutline,
    "",
    "### 避免照搬",
    avoidRuleLines
  ].join("\n");
}
function emitReferenceImportProgress(window, payload) {
  if (window.isDestroyed()) {
    return;
  }
  window.webContents.send("characterarc:reference-import-progress", payload);
}
function formatReferenceChunkSummaries(chunkResults) {
  return chunkResults.map(({ label, characterCount, result }, index) => [
    `【分块 ${index + 1}｜${label}｜约 ${characterCount} 字】`,
    `局部概括：${result.overview}`,
    `句式：${result.sentenceStyle}`,
    `对白：${result.dialogueRatio}`,
    `节奏：${result.pacingControl}`,
    `情绪：${result.emotionExpression}`,
    `桥段功能：${result.plotFunction}`,
    `局部规则：${result.styleRules.join("；")}`
  ].join("\n")).join("\n\n");
}
function normalizeWorkspacePayload(payload) {
  if ("workspaces" in payload && payload.workspaces) {
    return {
      ...payload,
      projects: payload.projects.map((project) => normalizeProjectRecord(project)),
      appSettings: normalizeAppSettings(payload.appSettings)
    };
  }
  const legacyPayload = payload;
  const normalizedTimestamp = (/* @__PURE__ */ new Date()).toISOString();
  const projects = legacyPayload.projects?.length ? legacyPayload.projects.map((project) => normalizeProjectRecord(project)) : [];
  const selectedProjectId = legacyPayload.selectedProjectId || projects[0]?.id || "project-1";
  const workspaces = Object.fromEntries(
    projects.map((project) => [
      project.id,
      {
        outlineVolumes: project.id === selectedProjectId ? legacyPayload.outlineVolumes?.length ? legacyPayload.outlineVolumes : [createFallbackVolume()] : [],
        worldviewEntries: project.id === selectedProjectId ? (legacyPayload.worldviewEntries ?? []).map((entry, index) => ({
          ...entry,
          sortOrder: entry.sortOrder ?? index,
          createdAt: entry.createdAt || normalizedTimestamp,
          updatedAt: entry.updatedAt || entry.createdAt || normalizedTimestamp
        })) : [],
        characters: project.id === selectedProjectId ? legacyPayload.characters ?? [] : [],
        organizations: project.id === selectedProjectId ? (legacyPayload.organizations ?? []).map((entry, index) => ({
          ...entry,
          sortOrder: entry.sortOrder ?? index,
          createdAt: entry.createdAt || normalizedTimestamp,
          updatedAt: entry.updatedAt || entry.createdAt || normalizedTimestamp
        })) : [],
        characterRelationships: project.id === selectedProjectId ? (legacyPayload.characterRelationships ?? []).map((entry) => ({
          ...entry,
          intensity: Number.isFinite(entry.intensity) ? Math.min(100, Math.max(0, entry.intensity ?? 50)) : 50,
          createdAt: entry.createdAt || normalizedTimestamp,
          updatedAt: entry.updatedAt || entry.createdAt || normalizedTimestamp
        })) : [],
        organizationMemberships: project.id === selectedProjectId ? (legacyPayload.organizationMemberships ?? []).map((entry) => ({
          ...entry,
          notes: entry.notes ?? "",
          createdAt: entry.createdAt || normalizedTimestamp,
          updatedAt: entry.updatedAt || entry.createdAt || normalizedTimestamp
        })) : [],
        inspirationEntries: project.id === selectedProjectId ? (legacyPayload.inspirationEntries ?? []).map((entry, index) => ({
          ...entry,
          tags: Array.isArray(entry.tags) ? entry.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
          source: entry.source === "manual" ? "manual" : "ai",
          sortOrder: entry.sortOrder ?? index,
          createdAt: entry.createdAt || normalizedTimestamp,
          updatedAt: entry.updatedAt || entry.createdAt || normalizedTimestamp
        })) : [],
        outlineItems: project.id === selectedProjectId ? (legacyPayload.outlineItems ?? []).map((item, index) => ({
          ...item,
          volumeId: item.volumeId || legacyPayload.outlineVolumes?.[0]?.id || "volume-legacy-default",
          status: item.status || "planned",
          sortOrder: item.sortOrder ?? index
        })) : [],
        chapters: project.id === selectedProjectId ? (legacyPayload.chapters ?? []).map((chapter) => ({
          ...chapter,
          outlineItemId: chapter.outlineItemId || "",
          volumeId: chapter.volumeId || legacyPayload.outlineVolumes?.[0]?.id || "volume-legacy-default"
        })) : [],
        chapterVersions: project.id === selectedProjectId ? legacyPayload.chapterVersions ?? [] : [],
        messages: project.id === selectedProjectId ? legacyPayload.messages ?? [] : [],
        workflowDocuments: []
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
  const projectRows = db.prepare(`
    SELECT id, title, genre, novel_length AS novelLength, word_count AS wordCount, last_edited AS lastEdited, cover,
      target_platform AS targetPlatform,
      reference_works_json AS referenceWorksJson,
      writing_style_preset_id AS writingStylePresetId,
      writing_style_prompt AS writingStylePrompt,
      novel_workflow_stages_json AS novelWorkflowStagesJson,
      project_skills_json AS projectSkillsJson,
      chapter_assistant_templates_json AS chapterAssistantTemplatesJson
    FROM projects
    ORDER BY rowid ASC
  `).all();
  const projects = projectRows.map(
    (project) => normalizeProjectRecord({
      ...project,
      novelWorkflowStages: (() => {
        try {
          return JSON.parse(project.novelWorkflowStagesJson || "[]");
        } catch {
          return [];
        }
      })(),
      referenceWorks: (() => {
        try {
          return JSON.parse(project.referenceWorksJson || "[]");
        } catch {
          return [];
        }
      })(),
      projectSkills: (() => {
        try {
          return JSON.parse(project.projectSkillsJson || "[]");
        } catch {
          return [];
        }
      })(),
      chapterAssistantTemplates: (() => {
        try {
          return JSON.parse(project.chapterAssistantTemplatesJson || "[]");
        } catch {
          return [];
        }
      })()
    })
  );
  if (projects.length === 0) {
    return null;
  }
  const worldviewEntries = db.prepare(`
    SELECT project_id AS projectId, id, type, title, content, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
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
  const organizations = db.prepare(`
    SELECT project_id AS projectId, id, name, type, description, motto, color, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
    FROM organizations
    ORDER BY project_id ASC, sort_order ASC
  `).all();
  const characterRelationships = db.prepare(`
    SELECT project_id AS projectId, id, from_character_id AS fromCharacterId, to_character_id AS toCharacterId, type, description, intensity, created_at AS createdAt, updated_at AS updatedAt
    FROM character_relationships
    ORDER BY project_id ASC, rowid ASC
  `).all();
  const organizationMemberships = db.prepare(`
    SELECT project_id AS projectId, id, character_id AS characterId, organization_id AS organizationId, role, notes, created_at AS createdAt, updated_at AS updatedAt
    FROM organization_memberships
    ORDER BY project_id ASC, rowid ASC
  `).all();
  const inspirationEntries = db.prepare(`
    SELECT project_id AS projectId, id, type, title, content, tags_json AS tagsJson, source, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt
    FROM inspiration_entries
    ORDER BY project_id ASC, sort_order ASC
  `).all().map((row) => ({
    projectId: row.projectId,
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    tags: JSON.parse(row.tagsJson),
    source: row.source === "manual" ? "manual" : "ai",
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }));
  const outlineVolumes = db.prepare(`
    SELECT project_id AS projectId, id, title, word_target AS wordTarget, summary
    FROM outline_volumes
    ORDER BY project_id ASC, sort_order ASC
  `).all().map((row) => ({
    projectId: row.projectId,
    id: row.id,
    title: row.title,
    wordTarget: row.wordTarget,
    summary: row.summary
  }));
  const outlineItems = db.prepare(`
    SELECT project_id AS projectId, volume_id AS volumeId, id, title, word_target AS wordTarget, conflict, summary, status, sort_order AS sortOrder
    FROM outline_items
    ORDER BY project_id ASC, sort_order ASC
  `).all();
  const chapters = db.prepare(`
    SELECT project_id AS projectId, volume_id AS volumeId, outline_item_id AS outlineItemId, id, title, summary, status, word_target AS wordTarget, content
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
  const workflowDocuments = db.prepare(`
    SELECT project_id AS projectId, volume_id AS volumeId, doc_key AS docKey, title, content, updated_at AS updatedAt
    FROM workflow_documents
    ORDER BY project_id ASC, volume_id ASC, sort_order ASC
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
        organizations: organizations.filter((entry) => entry.projectId === project.id).map(({ projectId: _projectId, ...entry }) => entry),
        characterRelationships: characterRelationships.filter((entry) => entry.projectId === project.id).map(({ projectId: _projectId, ...entry }) => entry),
        organizationMemberships: organizationMemberships.filter((entry) => entry.projectId === project.id).map(({ projectId: _projectId, ...entry }) => entry),
        inspirationEntries: inspirationEntries.filter((entry) => entry.projectId === project.id).map(({ projectId: _projectId, ...entry }) => entry),
        outlineVolumes: outlineVolumes.filter((volume) => volume.projectId === project.id).map(({ projectId: _projectId, ...volume }) => ({
          ...volume,
          workflowDocuments: workflowDocuments.filter((document) => document.projectId === project.id && document.volumeId === volume.id).map(({ projectId: _docProjectId, volumeId: _docVolumeId, docKey: _docKey, ...document }) => ({
            ...document,
            key: _docKey
          }))
        })),
        outlineItems: outlineItems.filter((item) => item.projectId === project.id).map(({ projectId: _projectId, ...item }) => item),
        chapters: chapters.filter((chapter) => chapter.projectId === project.id).map(({ projectId: _projectId, ...chapter }) => chapter),
        chapterVersions: chapterVersions.filter((version) => version.projectId === project.id).map(({ projectId: _projectId, ...version }) => version),
        messages: messages.filter((message) => message.projectId === project.id).map(({ projectId: _projectId, ...message }) => message),
        workflowDocuments: []
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
      DELETE FROM organizations;
      DELETE FROM character_relationships;
      DELETE FROM organization_memberships;
      DELETE FROM inspiration_entries;
      DELETE FROM outline_volumes;
      DELETE FROM outline_items;
      DELETE FROM chapter_versions;
      DELETE FROM chapters;
      DELETE FROM ai_messages;
      DELETE FROM workflow_documents;
      DELETE FROM app_settings;
    `);
    const insertProject = db.prepare(`
      INSERT INTO projects (id, title, genre, novel_length, word_count, last_edited, cover, target_platform, reference_works_json, writing_style_preset_id, writing_style_prompt, novel_workflow_stages_json, project_skills_json, chapter_assistant_templates_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const project of payload.projects) {
      insertProject.run(
        project.id,
        project.title,
        project.genre,
        project.novelLength,
        project.wordCount,
        project.lastEdited,
        project.cover,
        project.targetPlatform,
        JSON.stringify(project.referenceWorks ?? []),
        project.writingStylePresetId,
        project.writingStylePrompt,
        JSON.stringify(project.novelWorkflowStages ?? []),
        JSON.stringify(project.projectSkills ?? []),
        JSON.stringify(project.chapterAssistantTemplates ?? [])
      );
    }
    const insertWorldview = db.prepare(`
      INSERT INTO worldview_entries (id, project_id, type, title, content, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertCharacter = db.prepare(`
      INSERT INTO characters (id, project_id, name, role, description, avatar, tags_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertOrganization = db.prepare(`
      INSERT INTO organizations (id, project_id, name, type, description, motto, color, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertCharacterRelationship = db.prepare(`
      INSERT INTO character_relationships (id, project_id, from_character_id, to_character_id, type, description, intensity, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertOrganizationMembership = db.prepare(`
      INSERT INTO organization_memberships (id, project_id, character_id, organization_id, role, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertInspiration = db.prepare(`
      INSERT INTO inspiration_entries (id, project_id, type, title, content, tags_json, source, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertOutlineVolume = db.prepare(`
      INSERT INTO outline_volumes (id, project_id, title, word_target, summary, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertOutline = db.prepare(`
      INSERT INTO outline_items (id, project_id, volume_id, title, word_target, conflict, summary, status, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertChapter = db.prepare(`
      INSERT INTO chapters (id, project_id, volume_id, outline_item_id, title, summary, status, word_target, content, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertChapterVersion = db.prepare(`
      INSERT INTO chapter_versions (id, project_id, chapter_id, title, summary, status, word_target, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMessage = db.prepare(`
      INSERT INTO ai_messages (id, project_id, role, content, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertWorkflowDocument = db.prepare(`
      INSERT INTO workflow_documents (id, project_id, volume_id, doc_key, title, content, updated_at, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const project of payload.projects) {
      const workspace = payload.workspaces[project.id] ?? {
        worldviewEntries: [],
        characters: [],
        organizations: [],
        characterRelationships: [],
        organizationMemberships: [],
        inspirationEntries: [],
        outlineVolumes: [],
        outlineItems: [],
        chapters: [],
        chapterVersions: [],
        messages: [],
        workflowDocuments: []
      };
      workspace.worldviewEntries.forEach((entry, index) => {
        insertWorldview.run(
          entry.id,
          project.id,
          entry.type,
          entry.title,
          entry.content,
          entry.sortOrder ?? index,
          entry.createdAt,
          entry.updatedAt
        );
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
      workspace.organizations.forEach((organization, index) => {
        insertOrganization.run(
          organization.id,
          project.id,
          organization.name,
          organization.type,
          organization.description,
          organization.motto,
          organization.color,
          organization.sortOrder ?? index,
          organization.createdAt,
          organization.updatedAt
        );
      });
      workspace.characterRelationships.forEach((relationship) => {
        insertCharacterRelationship.run(
          relationship.id,
          project.id,
          relationship.fromCharacterId,
          relationship.toCharacterId,
          relationship.type,
          relationship.description,
          relationship.intensity,
          relationship.createdAt,
          relationship.updatedAt
        );
      });
      workspace.organizationMemberships.forEach((membership) => {
        insertOrganizationMembership.run(
          membership.id,
          project.id,
          membership.characterId,
          membership.organizationId,
          membership.role,
          membership.notes,
          membership.createdAt,
          membership.updatedAt
        );
      });
      workspace.inspirationEntries.forEach((entry, index) => {
        insertInspiration.run(
          entry.id,
          project.id,
          entry.type,
          entry.title,
          entry.content,
          JSON.stringify(entry.tags),
          entry.source,
          entry.sortOrder ?? index,
          entry.createdAt,
          entry.updatedAt
        );
      });
      workspace.outlineVolumes.forEach((volume, index) => {
        insertOutlineVolume.run(volume.id, project.id, volume.title, volume.wordTarget, volume.summary, index);
      });
      workspace.outlineItems.forEach((item, index) => {
        insertOutline.run(
          item.id,
          project.id,
          item.volumeId,
          item.title,
          item.wordTarget,
          item.conflict,
          item.summary,
          item.status,
          item.sortOrder ?? index
        );
      });
      workspace.chapters.forEach((chapter, index) => {
        insertChapter.run(
          chapter.id,
          project.id,
          chapter.volumeId,
          chapter.outlineItemId,
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
      const volumeWorkflowSources = workspace.outlineVolumes.flatMap(
        (volume) => (volume.workflowDocuments ?? []).map((document, index) => ({
          volumeId: volume.id,
          document,
          sortOrder: index
        }))
      ) || [];
      const fallbackWorkflowSources = volumeWorkflowSources.length === 0 && workspace.outlineVolumes[0] ? workspace.workflowDocuments.map((document, index) => ({
        volumeId: workspace.outlineVolumes[0].id,
        document,
        sortOrder: index
      })) : [];
      (volumeWorkflowSources.length > 0 ? volumeWorkflowSources : fallbackWorkflowSources).forEach(
        ({ volumeId, document, sortOrder }) => {
          insertWorkflowDocument.run(
            `${project.id}-${volumeId}-${document.key}`,
            project.id,
            volumeId,
            document.key,
            document.title,
            document.content,
            document.updatedAt,
            sortOrder
          );
        }
      );
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
const EXPORT_COMPATIBILITY_NOTE = "2.x 导出文件可直接导入当前版本；1.x 旧导出会按兼容模式解析，并默认按完整项目导入。";
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
    ["organizations", data.organizations],
    ["characterRelationships", data.characterRelationships],
    ["organizationMemberships", data.organizationMemberships],
    ["inspirationEntries", data.inspirationEntries],
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
  if (Array.isArray(data.worldviewEntries)) {
    const invalidWorldview = data.worldviewEntries.find((item) => {
      if (!item || typeof item !== "object") return true;
      const worldview = item;
      return typeof worldview.type !== "string" || typeof worldview.title !== "string" || typeof worldview.content !== "string" || worldview.sortOrder !== void 0 && typeof worldview.sortOrder !== "number" || worldview.createdAt !== void 0 && typeof worldview.createdAt !== "string" || worldview.updatedAt !== void 0 && typeof worldview.updatedAt !== "string";
    });
    if (invalidWorldview) {
      return { valid: false, message: "worldviewEntries 中存在字段缺失或格式错误的设定条目。" };
    }
  }
  if (Array.isArray(data.inspirationEntries)) {
    const invalidInspiration = data.inspirationEntries.find((item) => {
      if (!item || typeof item !== "object") return true;
      const inspiration = item;
      return typeof inspiration.type !== "string" || typeof inspiration.title !== "string" || typeof inspiration.content !== "string" || !Array.isArray(inspiration.tags) || inspiration.source !== void 0 && inspiration.source !== "ai" && inspiration.source !== "manual" || inspiration.sortOrder !== void 0 && typeof inspiration.sortOrder !== "number" || inspiration.createdAt !== void 0 && typeof inspiration.createdAt !== "string" || inspiration.updatedAt !== void 0 && typeof inspiration.updatedAt !== "string";
    });
    if (invalidInspiration) {
      return { valid: false, message: "inspirationEntries 中存在字段缺失或格式错误的灵感条目。" };
    }
  }
  if (Array.isArray(data.organizations)) {
    const invalidOrganization = data.organizations.find((item) => {
      if (!item || typeof item !== "object") return true;
      const organization = item;
      return typeof organization.name !== "string" || typeof organization.type !== "string" || typeof organization.description !== "string" || typeof organization.motto !== "string" || typeof organization.color !== "string" || organization.sortOrder !== void 0 && typeof organization.sortOrder !== "number" || organization.createdAt !== void 0 && typeof organization.createdAt !== "string" || organization.updatedAt !== void 0 && typeof organization.updatedAt !== "string";
    });
    if (invalidOrganization) {
      return { valid: false, message: "organizations 中存在字段缺失或格式错误的组织条目。" };
    }
  }
  if (Array.isArray(data.characterRelationships)) {
    const invalidRelationship = data.characterRelationships.find((item) => {
      if (!item || typeof item !== "object") return true;
      const relationship = item;
      return typeof relationship.fromCharacterId !== "string" || typeof relationship.toCharacterId !== "string" || typeof relationship.type !== "string" || typeof relationship.description !== "string" || relationship.intensity !== void 0 && typeof relationship.intensity !== "number" || relationship.createdAt !== void 0 && typeof relationship.createdAt !== "string" || relationship.updatedAt !== void 0 && typeof relationship.updatedAt !== "string";
    });
    if (invalidRelationship) {
      return { valid: false, message: "characterRelationships 中存在字段缺失或格式错误的关系条目。" };
    }
  }
  if (Array.isArray(data.organizationMemberships)) {
    const invalidMembership = data.organizationMemberships.find((item) => {
      if (!item || typeof item !== "object") return true;
      const membership = item;
      return typeof membership.characterId !== "string" || typeof membership.organizationId !== "string" || typeof membership.role !== "string" || membership.notes !== void 0 && typeof membership.notes !== "string" || membership.createdAt !== void 0 && typeof membership.createdAt !== "string" || membership.updatedAt !== void 0 && typeof membership.updatedAt !== "string";
    });
    if (invalidMembership) {
      return { valid: false, message: "organizationMemberships 中存在字段缺失或格式错误的成员归属条目。" };
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
      return typeof outlineItem.title !== "string" || outlineItem.volumeId !== void 0 && typeof outlineItem.volumeId !== "string" || outlineItem.wordTarget !== void 0 && typeof outlineItem.wordTarget !== "string" || outlineItem.conflict !== void 0 && typeof outlineItem.conflict !== "string" || outlineItem.summary !== void 0 && typeof outlineItem.summary !== "string" || outlineItem.status !== void 0 && typeof outlineItem.status !== "string" || outlineItem.sortOrder !== void 0 && typeof outlineItem.sortOrder !== "number";
    });
    if (invalidOutlineItem) {
      return { valid: false, message: "outlineItems 中存在字段缺失或格式错误的大纲节点。" };
    }
  }
  if (Array.isArray(data.chapters)) {
    const invalidChapter = data.chapters.find((item) => {
      if (!item || typeof item !== "object") return true;
      const chapter = item;
      return typeof chapter.title !== "string" || typeof chapter.content !== "string" || chapter.outlineItemId !== void 0 && typeof chapter.outlineItemId !== "string" || chapter.volumeId !== void 0 && typeof chapter.volumeId !== "string" || chapter.summary !== void 0 && typeof chapter.summary !== "string" || chapter.status !== void 0 && typeof chapter.status !== "string" || chapter.wordTarget !== void 0 && typeof chapter.wordTarget !== "string";
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
function validateImportedPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { valid: false, message: "导入文件不是有效的 JSON 对象。" };
  }
  const data = payload;
  if (data.app === "CharacterArc" && typeof data.schemaVersion === "string" && typeof data.moduleType === "string" && data.data && typeof data.data === "object") {
    const moduleType = data.moduleType;
    const normalizedPayload = data.data;
    const validation = validateImportedWorkspace({
      project: normalizedPayload.project ?? { title: "导入模块" },
      ...normalizedPayload
    });
    if (!validation.valid) {
      return validation;
    }
    return {
      valid: true,
      payload: normalizedPayload,
      meta: {
        schemaVersion: data.schemaVersion,
        moduleType,
        compatibilityNote: typeof data.compatibilityNote === "string" && data.compatibilityNote.trim() ? data.compatibilityNote : EXPORT_COMPATIBILITY_NOTE,
        isLegacy: false
      }
    };
  }
  const legacyValidation = validateImportedWorkspace(data);
  if (!legacyValidation.valid) {
    return legacyValidation;
  }
  return {
    valid: true,
    payload: data,
    meta: {
      schemaVersion: "1.0",
      moduleType: "project",
      compatibilityNote: "这是旧版 1.x 导出文件，系统已按兼容模式识别为完整项目导入。",
      isLegacy: true
    }
  };
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
  const validation = validateImportedPayload(parsed);
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
    payload: validation.payload,
    meta: validation.meta
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
electron.ipcMain.handle("characterarc:import-reference-novel-analysis", async (_event, payload) => {
  const window = electron.BrowserWindow.getFocusedWindow();
  if (!window) {
    return { success: false, canceled: true };
  }
  const result = await electron.dialog.showOpenDialog(window, {
    title: "导入参考小说",
    properties: ["openFile"],
    filters: [
      { name: "小说文本", extensions: ["txt", "md", "docx"] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }
  try {
    const request = payload ?? {};
    emitReferenceImportProgress(window, {
      phase: "extracting",
      message: "正在读取小说正文并提取基础统计...",
      current: 0,
      total: 1,
      percent: 8
    });
    const localContext = await extractReferenceNovelContext(result.filePaths[0]);
    const resolvedTitle = request.preferredTitle?.trim() || localContext.title;
    const resolvedSource = request.preferredSource?.trim() || localContext.fileType.toUpperCase();
    emitReferenceImportProgress(window, {
      phase: "chunking",
      message: `已拆出 ${localContext.analysisChunks.length} 个分析分块，准备逐块提炼风格...`,
      current: 0,
      total: Math.max(localContext.analysisChunks.length, 1),
      percent: 16,
      sourceTitle: resolvedTitle
    });
    const chunkResults = [];
    for (const [index, chunk] of localContext.analysisChunks.entries()) {
      emitReferenceImportProgress(window, {
        phase: "chunk-analysis",
        message: `正在分析第 ${index + 1} / ${localContext.analysisChunks.length} 个分块：${chunk.label}`,
        current: index + 1,
        total: localContext.analysisChunks.length,
        percent: Math.min(82, 16 + Math.round((index + 1) / Math.max(localContext.analysisChunks.length, 1) * 58)),
        sourceTitle: resolvedTitle
      });
      chunkResults.push({
        label: chunk.label,
        characterCount: chunk.characterCount,
        result: await generateAiTask({
          task: "reference-style-chunk",
          settings: request.settings,
          context: {
            projectTitle: request.projectTitle ?? "",
            projectGenre: request.projectGenre ?? "",
            projectPlatform: request.projectPlatform ?? "",
            sourceTitle: resolvedTitle,
            chunkLabel: chunk.label,
            chunkIndex: index + 1,
            chunkTotal: localContext.analysisChunks.length,
            chunkCharacterCount: chunk.characterCount,
            chunkMetrics: chunk.metrics,
            chunkKeywords: chunk.topKeywords,
            chunkText: chunk.text
          }
        })
      });
    }
    emitReferenceImportProgress(window, {
      phase: "aggregating",
      message: "正在汇总所有分块结论，生成可复用仿写模板...",
      current: chunkResults.length,
      total: chunkResults.length,
      percent: 90,
      sourceTitle: resolvedTitle
    });
    const analysis = await generateAiTask({
      task: "reference-style-analysis",
      settings: request.settings,
      context: {
        projectTitle: request.projectTitle ?? "",
        projectGenre: request.projectGenre ?? "",
        projectPlatform: request.projectPlatform ?? "",
        sourceTitle: resolvedTitle,
        sourceFileType: localContext.fileType,
        sourceCharacterCount: localContext.characterCount,
        sourceChapterCount: localContext.chapterCount,
        styleMetrics: localContext.metrics,
        topKeywords: localContext.topKeywords,
        sourceExcerpt: localContext.excerpt,
        analysisSample: localContext.analysisSample,
        chunkSummaries: formatReferenceChunkSummaries(chunkResults)
      }
    });
    const importedAt = (/* @__PURE__ */ new Date()).toISOString();
    emitReferenceImportProgress(window, {
      phase: "saving",
      message: "正在整理结果并回填到项目风格规则与流程文件...",
      current: 1,
      total: 1,
      percent: 96,
      sourceTitle: resolvedTitle
    });
    const referenceWork = {
      id: `ref-${Date.now()}`,
      title: resolvedTitle,
      source: resolvedSource,
      notes: analysis.overview,
      fileName: localContext.fileName,
      analysis: {
        createdAt: importedAt,
        fileName: localContext.fileName,
        fileType: localContext.fileType,
        characterCount: localContext.characterCount,
        chapterCount: localContext.chapterCount,
        excerpt: localContext.excerpt,
        topKeywords: localContext.topKeywords,
        metrics: [
          ...localContext.metrics,
          { label: "分析分块数", value: `${localContext.analysisChunks.length} 块` }
        ],
        overview: analysis.overview,
        sentenceStyle: analysis.sentenceStyle,
        dialogueRatio: analysis.dialogueRatio,
        pacingControl: analysis.pacingControl,
        emotionExpression: analysis.emotionExpression,
        narrativePerspective: analysis.narrativePerspective,
        styleRules: analysis.styleRules,
        plotOutline: analysis.plotOutline,
        reusableStylePrompt: analysis.reusableStylePrompt,
        avoidRules: analysis.avoidRules
      }
    };
    emitReferenceImportProgress(window, {
      phase: "done",
      message: `《${resolvedTitle}》拆书完成，结果已回填到项目风格规则、参考档案和 findings。`,
      current: 1,
      total: 1,
      percent: 100,
      sourceTitle: resolvedTitle
    });
    return {
      success: true,
      canceled: false,
      result: {
        referenceWork,
        suggestedWritingStylePrompt: buildImportedReferenceStylePrompt(resolvedTitle, analysis),
        findingsMarkdown: buildImportedReferenceFindingsMarkdown(
          resolvedTitle,
          analysis,
          localContext.metrics,
          localContext.topKeywords
        )
      }
    };
  } catch (error) {
    return {
      success: false,
      canceled: false,
      error: error instanceof Error ? error.message : "参考作品拆书失败"
    };
  }
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
electron.ipcMain.handle("characterarc:ai-fetch-models", async (_event, settings) => {
  try {
    const result = await fetchModels(settings);
    return {
      success: true,
      result
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "获取模型列表失败"
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
electron.ipcMain.handle("characterarc:project-skills-scan", async () => {
  try {
    const skills = await readProjectSkillsFromDisk();
    return {
      success: true,
      skills
    };
  } catch {
    return {
      success: true,
      skills: []
    };
  }
});
electron.ipcMain.handle("characterarc:project-skills-context", async () => {
  try {
    const skills = await readProjectSkillContextsFromDisk();
    return {
      success: true,
      skills
    };
  } catch {
    return {
      success: true,
      skills: []
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
    console.error("[workspace] loadWorkspace failed:", error);
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
electron.ipcMain.handle("characterarc:set-titlebar-overlay", (_event, options) => {
  if (process.platform !== "win32" || !mainWindow) return;
  mainWindow.setTitleBarOverlay(options);
});
electron.ipcMain.handle("characterarc:save-workspace", async (_event, payload) => {
  try {
    const db = await ensureWorkspaceDb();
    writeWorkspaceSnapshot(db, normalizeWorkspacePayload(payload));
    return {
      success: true
    };
  } catch (error) {
    console.error("[workspace] saveWorkspace failed:", error);
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
