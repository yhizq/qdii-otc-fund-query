---
name: qdii-otc-fund-query
description: Query current purchase status, daily limits, direct-versus-agency channel notes, themes, and announcement links for off-exchange Chinese QDII funds covered by the QDII quota daily reference page. Use when users ask which covered OTC QDII funds can be bought, how much can be subscribed, whether a fund is suspended, or want results filtered by code, name, market theme, status, or channel. Do not use for fund recommendations, return forecasts, NAV estimates, or exchange-traded ETF premiums.
license: MIT
metadata:
  version: "1.0.0"
---

# 场外 QDII 基金查询

用本 Skill 自带脚本查询最新公开数据。不要凭模型记忆补全申购状态、额度、渠道或公告日期。

## 执行查询

在 Skill 根目录运行：

```bash
node scripts/query-qdii.js [选项]
```

按用户意图选择最窄的查询：

```bash
# 单只基金；代码可重复或用逗号分隔
node scripts/query-qdii.js --code 008971

# 名称或主题模糊匹配
node scripts/query-qdii.js --name 纳斯达克 --status available
node scripts/query-qdii.js --theme 标普500 --status limited --sort limit-desc

# 暂停申购明细、直销差异、完整结构化数据
node scripts/query-qdii.js --status suspended
node scripts/query-qdii.js --channel direct
node scripts/query-qdii.js --status all --format json
```

默认范围只含人民币场外份额，并只列“正常申购”或“限额申购”。只有用户明确询问场内份额时才添加 `--include-exchange`。只有用户明确要求全部状态时才用 `--status all`。

更多参数见 `node scripts/query-qdii.js --help`。

## 回答规则

- 以脚本本次输出为事实基础，保留数据日期和源页面链接。
- 区分“页面公布限额”“代销口径”“基金公司直销口径”；字段为空表示页面未明确，不得推断为不限额或不可买。
- “场内交易”不是场外申购，不得混入默认结果。
- 公告链接是核验线索；用户实际提交时仍以其销售平台和基金公司当日规则为准。
- 数据日期超过脚本允许的新鲜度时，明确转述过期警告，不把旧数据称为“今天”。
- 只整理公开信息，不推荐基金、不预测收益、不输出买卖指令。

## 快照比较

查询默认不写状态。用户明确要求保存或比较时再使用：

```bash
node scripts/query-qdii.js --status all --save snapshots/latest.json
node scripts/query-qdii.js --status all --compare snapshots/previous.json
```

需要理解字段、状态与来源边界时，读取 [references/data-source.md](references/data-source.md)。
