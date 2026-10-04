"use strict";

const SOURCE_URL = "https://anxinletech.com/instrument-qdii.html";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function decodeEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  };
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1].toLowerCase() === "x";
      const codePoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return Object.prototype.hasOwnProperty.call(named, entity.toLowerCase())
      ? named[entity.toLowerCase()]
      : match;
  });
}

function cleanText(html) {
  return decodeEntities(String(html || "")
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<script\b[^]*?<\/script>/gi, " ")
    .replace(/<style\b[^]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "；")
    .replace(/<[^>]+>/g, " "))
    .replace(/[\u00a0\s]+/g, " ")
    .replace(/\s*；\s*/g, "；")
    .trim();
}

function absoluteUrl(href, baseUrl = SOURCE_URL) {
  if (!href) return null;
  try {
    return new URL(decodeEntities(href), baseUrl).toString();
  } catch {
    return null;
  }
}

function firstAnchor(html, baseUrl = SOURCE_URL) {
  const match = String(html || "").match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([^]*?)<\/a>/i);
  if (!match) return { href: null, text: cleanText(html) };
  return { href: absoluteUrl(match[1], baseUrl), text: cleanText(match[2]) };
}

function parseAmountYuan(text) {
  const match = String(text || "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(亿元|万元|万|元)/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  if (match[2] === "亿元") return value * 100000000;
  if (match[2] === "万元" || match[2] === "万") return value * 10000;
  return value;
}

function labeledAmount(text, label) {
  const match = String(text || "").replace(/,/g, "").match(new RegExp(`${label}[^0-9]{0,24}(\\d+(?:\\.\\d+)?)\\s*(亿元|万元|万|元)`));
  return match ? parseAmountYuan(`${match[1]}${match[2]}`) : null;
}

function normalizeStatus(statusText) {
  if (/场内交易/.test(statusText)) return "exchange";
  if (/暂停申购|暂停购买/.test(statusText)) return "suspended";
  if (/不限额开放|正常申购|开放申购/.test(statusText)) return "open";
  if (/限额申购|限大额|限购/.test(statusText)) return "limited";
  return "unknown";
}

function parseLimits(limitText, channelNote, status) {
  const combined = `${limitText}；${channelNote}`;
  let agency = labeledAmount(combined, "(?:代销|第三方平台)");
  let direct = labeledAmount(combined, "(?:直销|官网|官方APP|基金公司APP)");
  let general = agency === null && direct === null && status === "limited" ? parseAmountYuan(limitText) : null;

  if (general !== null && /代销无此额度|仅[^；。]{0,30}直销/.test(channelNote)) {
    direct = direct ?? general;
    general = null;
  }
  if (general !== null && /仅[^；。]{0,30}代销/.test(channelNote)) {
    agency = agency ?? general;
    general = null;
  }
  return { agencyLimitYuan: agency, directLimitYuan: direct, generalLimitYuan: general };
}

function parseFundRow(rowHtml, theme, baseUrl) {
  const cells = [...String(rowHtml).matchAll(/<td\b[^>]*>([^]*?)<\/td>/gi)].map((match) => match[1]);
  if (cells.length < 5) return null;
  const fundAnchor = firstAnchor(cells[0], baseUrl);
  const firstCellText = cleanText(cells[0]);
  const codeMatch = firstCellText.match(/[（(](\d{6})[）)]/);
  if (!codeMatch) return null;

  const statusText = cleanText(cells[1]);
  const status = normalizeStatus(statusText);
  const limitText = cleanText(cells[2]);
  const channelNote = cleanText(cells[3]);
  const notice = firstAnchor(cells[4], baseUrl);
  const noticeDateMatch = notice.text.match(/(20\d{2}-\d{2}-\d{2})/);
  const limits = parseLimits(limitText, channelNote, status);

  return {
    theme,
    name: fundAnchor.text.replace(/[（(]\d{6}[）)]\s*$/, "").trim(),
    code: codeMatch[1],
    status,
    statusText,
    limitText,
    generalLimitYuan: limits.generalLimitYuan,
    agencyLimitYuan: limits.agencyLimitYuan,
    directLimitYuan: limits.directLimitYuan,
    channelNote,
    announcementText: notice.text,
    announcementDate: noticeDateMatch ? noticeDateMatch[1] : null,
    announcementUrl: notice.href,
    fundDetailUrl: fundAnchor.href,
    offExchange: status !== "exchange",
    verification: [
      /公告直核/.test(statusText) ? "公告直核" : null,
      /人工核实/.test(statusText) ? "人工核实" : null,
      /双源一致/.test(statusText) ? "双源一致" : null
    ].filter(Boolean)
  };
}

function extractDataBlock(html) {
  const match = String(html || "").match(/<!--DATA:QDII-->([^]*?)<!--\/DATA:QDII-->/i);
  return match ? match[1] : String(html || "");
}

function parseQdiiPage(html, baseUrl = SOURCE_URL) {
  const block = extractDataBlock(html);
  const dateMatch = block.match(/最新一期\s*[·・]\s*(20\d{2}-\d{2}-\d{2})/) ||
    block.match(/当日速览\s*[·・]\s*(20\d{2}-\d{2}-\d{2})/);
  const rows = [];
  const sectionPattern = /<h3\b[^>]*>((?:(?!<\/h3>)[^])*)<\/h3>(?:(?!<h3\b)[^])*?<table\b[^>]*class=["'][^"']*\breadout\b[^"']*["'][^>]*>([^]*?)<\/table>/gi;
  for (const section of block.matchAll(sectionPattern)) {
    const theme = cleanText(section[1]).replace(/\s*共\s*\d+\s*只\s*$/, "").trim();
    for (const rowMatch of section[2].matchAll(/<tr\b[^>]*>([^]*?)<\/tr>/gi)) {
      const row = parseFundRow(rowMatch[1], theme, baseUrl);
      if (row) rows.push(row);
    }
  }
  return { dataDate: dateMatch ? dateMatch[1] : null, rows };
}

function assertDataset(parsed, minimumRows = 1) {
  if (!parsed.dataDate) throw new Error("无法识别数据日期，页面结构可能已经变化");
  if (parsed.rows.length < minimumRows) {
    throw new Error(`只解析到 ${parsed.rows.length} 条记录，低于完整性阈值 ${minimumRows}`);
  }
  const duplicates = parsed.rows.map((row) => row.code).filter((code, index, values) => values.indexOf(code) !== index);
  if (duplicates.length) throw new Error(`发现重复基金代码：${[...new Set(duplicates)].join("、")}`);
}

function statusMatches(status, wanted) {
  if (wanted === "all") return true;
  if (wanted === "available") return status === "open" || status === "limited";
  return status === wanted;
}

function searchable(value) {
  return String(value || "").toLocaleLowerCase("zh-CN");
}

function filterRows(rows, options) {
  const codes = new Set(options.codes || []);
  const name = searchable(options.name);
  const theme = searchable(options.theme);
  let result = rows.filter((row) => options.includeExchange || row.offExchange);
  if (codes.size) result = result.filter((row) => codes.has(row.code));
  if (name) result = result.filter((row) => searchable(`${row.name} ${row.code}`).includes(name));
  if (theme) result = result.filter((row) => searchable(row.theme).includes(theme));
  result = result.filter((row) => statusMatches(row.status, options.status || "available"));
  if (options.channel === "direct") {
    result = result.filter((row) => row.directLimitYuan !== null || /直销/.test(row.channelNote));
  } else if (options.channel === "agency") {
    result = result.filter((row) => row.agencyLimitYuan !== null || !/代销无此额度/.test(row.channelNote));
  }

  const limitValue = (row) => {
    if (row.status === "open") return Number.POSITIVE_INFINITY;
    return Math.max(row.directLimitYuan ?? -1, row.agencyLimitYuan ?? -1, row.generalLimitYuan ?? -1);
  };
  if (options.sort === "limit-desc") result.sort((a, b) => limitValue(b) - limitValue(a) || a.code.localeCompare(b.code));
  else if (options.sort === "limit-asc") result.sort((a, b) => limitValue(a) - limitValue(b) || a.code.localeCompare(b.code));
  else if (options.sort === "name") result.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  else result.sort((a, b) => a.theme.localeCompare(b.theme, "zh-CN") || a.code.localeCompare(b.code));
  return result;
}

function summarize(rows) {
  const offExchange = rows.filter((row) => row.offExchange);
  const byStatus = {};
  const byTheme = {};
  for (const row of offExchange) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    byTheme[row.theme] ||= { total: 0, open: 0, limited: 0, suspended: 0, unknown: 0 };
    byTheme[row.theme].total += 1;
    byTheme[row.theme][row.status] = (byTheme[row.theme][row.status] || 0) + 1;
  }
  return {
    tracked: rows.length,
    offExchange: offExchange.length,
    exchange: rows.length - offExchange.length,
    byStatus,
    byTheme
  };
}

function daysOld(dataDate, now = new Date()) {
  const parsed = new Date(`${dataDate}T00:00:00+08:00`);
  if (Number.isNaN(parsed.valueOf())) return null;
  return Math.max(0, Math.floor((now.valueOf() - parsed.valueOf()) / 86400000));
}

function comparable(row) {
  return {
    status: row.status,
    limitText: row.limitText,
    channelNote: row.channelNote,
    announcementDate: row.announcementDate
  };
}

function compareRows(previousRows, currentRows) {
  const previous = new Map((previousRows || []).map((row) => [row.code, row]));
  const current = new Map((currentRows || []).map((row) => [row.code, row]));
  const changes = [];
  for (const [code, row] of current) {
    if (!previous.has(code)) {
      changes.push({ type: "added", code, name: row.name, current: comparable(row) });
      continue;
    }
    const before = comparable(previous.get(code));
    const after = comparable(row);
    const fields = Object.keys(after).filter((key) => before[key] !== after[key]);
    if (fields.length) changes.push({ type: "changed", code, name: row.name, fields, previous: before, current: after });
  }
  for (const [code, row] of previous) {
    if (!current.has(code)) changes.push({ type: "removed", code, name: row.name, previous: comparable(row) });
  }
  return changes;
}

function validateSourceUrl(value) {
  const target = new URL(value);
  if (target.protocol !== "https:") throw new Error("数据源只允许 HTTPS");
  if (target.username || target.password) throw new Error("数据源地址不得包含认证信息");
  if (target.hostname !== "anxinletech.com" && !target.hostname.endsWith(".anxinletech.com")) {
    throw new Error("数据源域名只允许 anxinletech.com");
  }
  return target;
}

async function fetchSource(url = SOURCE_URL, timeoutMs = 20000) {
  validateSourceUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: controller.signal,
      headers: { "user-agent": "qdii-otc-fund-query/1.0 (+public-data-query)" }
    });
    if (!response.ok) throw new Error(`数据源返回 HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new Error("数据源响应超过大小限制");
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("数据源响应超过大小限制");
    return text;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("数据源请求超时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  SOURCE_URL,
  assertDataset,
  cleanText,
  compareRows,
  daysOld,
  fetchSource,
  filterRows,
  normalizeStatus,
  parseAmountYuan,
  parseQdiiPage,
  summarize,
  validateSourceUrl
};
