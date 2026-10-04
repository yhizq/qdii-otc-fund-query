"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  compareRows,
  filterRows,
  parseAmountYuan,
  parseQdiiPage,
  summarize,
  validateSourceUrl
} = require("../scripts/lib/qdii");
const { parseArgs, run } = require("../scripts/query-qdii");

const fixture = path.join(__dirname, "fixtures", "sample.html");
const html = fs.readFileSync(fixture, "utf8");

test("parses themes, statuses, channel limits and source links", () => {
  const parsed = parseQdiiPage(html);
  assert.equal(parsed.dataDate, "2026-09-30");
  assert.equal(parsed.rows.length, 5);

  const dual = parsed.rows.find((row) => row.code === "008401");
  assert.equal(dual.theme, "标普500");
  assert.equal(dual.status, "limited");
  assert.equal(dual.agencyLimitYuan, 100);
  assert.equal(dual.directLimitYuan, 1000);
  assert.equal(dual.announcementDate, "2026-09-08");
  assert.equal(dual.fundDetailUrl, "https://anxinletech.com/fund/008401.html");

  const directOnly = parsed.rows.find((row) => row.code === "021000");
  assert.equal(directOnly.generalLimitYuan, null);
  assert.equal(directOnly.directLimitYuan, 200);
  assert.equal(directOnly.agencyLimitYuan, null);
});

test("defaults to available off-exchange rows", () => {
  const parsed = parseQdiiPage(html);
  const results = filterRows(parsed.rows, { codes: [], status: "available", channel: "any", includeExchange: false, sort: "theme" });
  assert.deepEqual(results.map((row) => row.code).sort(), ["008401", "021000", "123456"]);
  const statistics = summarize(parsed.rows);
  assert.equal(statistics.tracked, 5);
  assert.equal(statistics.offExchange, 4);
  assert.equal(statistics.exchange, 1);
});

test("supports code, status, channel and theme filters", () => {
  const rows = parseQdiiPage(html).rows;
  assert.deepEqual(filterRows(rows, { codes: ["006479"], status: "all", channel: "any", includeExchange: false, sort: "theme" }).map((row) => row.code), ["006479"]);
  assert.deepEqual(filterRows(rows, { codes: [], theme: "纳斯达克", status: "limited", channel: "direct", includeExchange: false, sort: "theme" }).map((row) => row.code), ["021000"]);
  assert.deepEqual(filterRows(rows, { codes: [], status: "all", channel: "any", includeExchange: true, sort: "theme" }).map((row) => row.code).sort(), ["006479", "008401", "021000", "123456", "513500"]);
});

test("normalizes Chinese amount units", () => {
  assert.equal(parseAmountYuan("10元"), 10);
  assert.equal(parseAmountYuan("50万元"), 500000);
  assert.equal(parseAmountYuan("2.5亿元"), 250000000);
  assert.equal(parseAmountYuan("正常申购"), null);
});

test("detects snapshot changes", () => {
  const rows = parseQdiiPage(html).rows.filter((row) => row.offExchange);
  const changed = rows.map((row) => row.code === "008401" ? { ...row, limitText: "50元" } : row);
  const changes = compareRows(rows, changed);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].code, "008401");
  assert.deepEqual(changes[0].fields, ["limitText"]);
});

test("only allows the intended HTTPS source host", () => {
  assert.equal(validateSourceUrl("https://anxinletech.com/instrument-qdii.html").hostname, "anxinletech.com");
  assert.throws(() => validateSourceUrl("http://anxinletech.com/instrument-qdii.html"), /HTTPS/);
  assert.throws(() => validateSourceUrl("https://example.com/"), /只允许/);
});

test("CLI arguments drive a local fixture query", async () => {
  const options = parseArgs(["--source-file", fixture, "--code", "008401", "--status", "all", "--format", "json"]);
  const payload = await run(options);
  assert.equal(payload.results.length, 1);
  assert.equal(payload.results[0].directLimitYuan, 1000);
});
