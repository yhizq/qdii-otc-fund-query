#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  SOURCE_URL,
  assertDataset,
  compareRows,
  daysOld,
  fetchSource,
  filterRows,
  parseQdiiPage,
  summarize
} = require("./lib/qdii");

const HELP = `场外 QDII 基金申购查询

用法：
  node scripts/query-qdii.js [选项]

筛选：
  --code CODE[,CODE]       六位基金代码，可重复
  --name TEXT              基金名称模糊匹配
  --theme TEXT             主题模糊匹配，如 纳斯达克100、标普500、日本股市
  --status VALUE           available|open|limited|suspended|unknown|all
                           默认 available
  --channel VALUE          any|agency|direct，默认 any
  --include-exchange       包含场内交易份额；默认仅场外
  --sort VALUE             theme|name|limit-desc|limit-asc，默认 theme

输出与来源：
  --format VALUE           markdown|json|csv，默认 markdown
  --source-url URL         数据源，默认 ${SOURCE_URL}
  --source-file FILE       从本地 HTML 读取，便于离线复核
  --max-age-days N         超过 N 天标记为过期，默认 7
  --timeout-ms N           请求超时，默认 20000
  --save FILE              显式保存本次结构化快照
  --compare FILE           与旧快照比较
  --help                   显示帮助

查询默认只读，不保存状态。
`;

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} 缺少参数`);
  return value;
}

function parseArgs(argv) {
  const options = {
    codes: [],
    name: "",
    theme: "",
    status: "available",
    channel: "any",
    includeExchange: false,
    sort: "theme",
    format: "markdown",
    sourceUrl: SOURCE_URL,
    sourceFile: null,
    maxAgeDays: 7,
    timeoutMs: 20000,
    saveFile: null,
    compareFile: null,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--code") options.codes.push(...requireValue(argv, index++, item).split(","));
    else if (item === "--name") options.name = requireValue(argv, index++, item);
    else if (item === "--theme") options.theme = requireValue(argv, index++, item);
    else if (item === "--status") options.status = requireValue(argv, index++, item);
    else if (item === "--channel") options.channel = requireValue(argv, index++, item);
    else if (item === "--sort") options.sort = requireValue(argv, index++, item);
    else if (item === "--format") options.format = requireValue(argv, index++, item);
    else if (item === "--source-url") options.sourceUrl = requireValue(argv, index++, item);
    else if (item === "--source-file") options.sourceFile = path.resolve(requireValue(argv, index++, item));
    else if (item === "--max-age-days") options.maxAgeDays = Number(requireValue(argv, index++, item));
    else if (item === "--timeout-ms") options.timeoutMs = Number(requireValue(argv, index++, item));
    else if (item === "--save") options.saveFile = path.resolve(requireValue(argv, index++, item));
    else if (item === "--compare") options.compareFile = path.resolve(requireValue(argv, index++, item));
    else if (item === "--include-exchange") options.includeExchange = true;
    else if (item === "--help" || item === "-h") options.help = true;
    else throw new Error(`未知参数：${item}`);
  }
  options.codes = [...new Set(options.codes.map((code) => code.trim()).filter(Boolean))];
  if (options.codes.some((code) => !/^\d{6}$/.test(code))) throw new Error("--code 必须是六位数字，可用逗号分隔");
  if (!["available", "open", "limited", "suspended", "unknown", "all"].includes(options.status)) throw new Error("--status 参数无效");
  if (!["any", "agency", "direct"].includes(options.channel)) throw new Error("--channel 参数无效");
  if (!["theme", "name", "limit-desc", "limit-asc"].includes(options.sort)) throw new Error("--sort 参数无效");
  if (!["markdown", "json", "csv"].includes(options.format)) throw new Error("--format 参数无效");
  if (!Number.isInteger(options.maxAgeDays) || options.maxAgeDays < 0 || options.maxAgeDays > 365) throw new Error("--max-age-days 必须是 0-365 的整数");
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 120000) throw new Error("--timeout-ms 必须是 1000-120000 的整数");
  return options;
}

function md(value) {
  return String(value ?? "—").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderMarkdown(payload) {
  const lines = [
    `# 场外 QDII 基金申购查询`,
    "",
    `数据日期：${payload.dataDate}；查询时间：${payload.queriedAt}`,
    `来源：[QDII额度日报](${payload.sourceUrl})`,
    `范围：跟踪 ${payload.statistics.tracked} 只，其中场外 ${payload.statistics.offExchange} 只、场内 ${payload.statistics.exchange} 只；本次匹配 ${payload.results.length} 只。`
  ];
  if (payload.stale) lines.push(``, `> ⚠ 数据距查询日 ${payload.ageDays} 天，超过 ${payload.maxAgeDays} 天阈值，不能视为当日实时状态。`);
  if (!payload.results.length) {
    lines.push("", "没有符合条件的记录。");
  } else {
    lines.push("", "| 主题 | 基金 | 代码 | 状态 | 页面限额 | 渠道说明 | 公告 |", "|---|---|---:|---|---:|---|---|");
    for (const row of payload.results) {
      const notice = row.announcementUrl ? `[${md(row.announcementText)}](${row.announcementUrl})` : md(row.announcementText);
      lines.push(`| ${md(row.theme)} | ${md(row.name)} | ${row.code} | ${md(row.statusText)} | ${md(row.limitText)} | ${md(row.channelNote)} | ${notice} |`);
    }
  }
  if (payload.changes.length) {
    lines.push("", "## 与旧快照相比");
    for (const change of payload.changes) {
      if (change.type === "added") lines.push(`- 新增：${change.name}（${change.code}）`);
      else if (change.type === "removed") lines.push(`- 消失：${change.name}（${change.code}）`);
      else lines.push(`- 变化：${change.name}（${change.code}）— ${change.fields.join("、")}`);
    }
  }
  lines.push("", "仅整理公开信息，不构成投资建议；最终申购状态和额度以实际销售渠道及基金公司公告为准。");
  return `${lines.join("\n")}\n`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function renderCsv(payload) {
  const headers = ["data_date", "theme", "name", "code", "status", "status_text", "limit_text", "general_limit_yuan", "agency_limit_yuan", "direct_limit_yuan", "channel_note", "announcement_date", "announcement_url", "fund_detail_url"];
  const rows = payload.results.map((row) => [payload.dataDate, row.theme, row.name, row.code, row.status, row.statusText, row.limitText, row.generalLimitYuan, row.agencyLimitYuan, row.directLimitYuan, row.channelNote, row.announcementDate, row.announcementUrl, row.fundDetailUrl]);
  return `${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function loadPrevious(file) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.results)) return parsed.results;
  if (Array.isArray(parsed.rows)) return parsed.rows;
  throw new Error("比较文件不包含 results 或 rows 数组");
}

async function run(options) {
  const html = options.sourceFile
    ? fs.readFileSync(options.sourceFile, "utf8")
    : await fetchSource(options.sourceUrl, options.timeoutMs);
  const parsed = parseQdiiPage(html, options.sourceUrl);
  assertDataset(parsed, options.sourceFile ? 1 : 50);
  const results = filterRows(parsed.rows, options);
  const ageDays = daysOld(parsed.dataDate);
  const changes = options.compareFile ? compareRows(loadPrevious(options.compareFile), results) : [];
  const payload = {
    schemaVersion: 1,
    queriedAt: new Date().toISOString(),
    dataDate: parsed.dataDate,
    sourceUrl: options.sourceUrl,
    sourceFile: options.sourceFile,
    ageDays,
    maxAgeDays: options.maxAgeDays,
    stale: ageDays !== null && ageDays > options.maxAgeDays,
    filters: {
      codes: options.codes,
      name: options.name,
      theme: options.theme,
      status: options.status,
      channel: options.channel,
      includeExchange: options.includeExchange,
      sort: options.sort
    },
    statistics: summarize(parsed.rows),
    results,
    changes
  };
  if (options.saveFile) {
    fs.mkdirSync(path.dirname(options.saveFile), { recursive: true });
    fs.writeFileSync(options.saveFile, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
  return payload;
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const payload = await run(options);
  if (options.format === "json") process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else if (options.format === "csv") process.stdout.write(renderCsv(payload));
  else process.stdout.write(renderMarkdown(payload));
  return payload.results.length ? 0 : 2;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    console.error(`查询失败：${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { HELP, main, parseArgs, renderCsv, renderMarkdown, run };
