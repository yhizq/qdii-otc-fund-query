# qdii-otc-fund-query

一个用于查询中国境内场外 QDII 基金申购状态、单日限额、渠道差异和公告来源的 Agent Skill。

数据范围跟随 [安鑫乐量化实验室 QDII 额度日报](https://anxinletech.com/instrument-qdii.html) 动态更新，不硬编码基金代码或主题。默认排除场内 ETF，仅整理公开信息，不提供基金推荐、收益预测或投资建议。

## 能做什么

- 按六位代码、基金名称、市场主题查询。
- 筛选正常申购、限额申购、暂停申购或全部状态。
- 保留代销/基金公司直销差异、公告日期和原文链接。
- 输出 Markdown、JSON 或 CSV。
- 显式保存快照并比较状态、额度和公告变化。
- 无第三方运行时依赖；Node.js 22+ 可直接运行。

## 安装

把完整目录放入支持 Agent Skills 的技能目录，或直接克隆仓库。Codex 中可放到 `~/.codex/skills/qdii-otc-fund-query`。

验证（任选其一）：

```bash
npm test
node tests/query.test.js
node scripts/query-qdii.js --help
```

## 使用

```bash
# 单只基金
node scripts/query-qdii.js --code 008971

# 可申购的纳斯达克100场外 QDII
node scripts/query-qdii.js --theme 纳斯达克100 --status available --sort limit-desc

# 标普500暂停申购清单
node scripts/query-qdii.js --theme 标普500 --status suspended

# 查页面明确列出的直销差异
node scripts/query-qdii.js --channel direct

# 全量 JSON / CSV
node scripts/query-qdii.js --status all --format json
node scripts/query-qdii.js --status all --format csv
```

查询默认只读。需要变化比较时显式保存快照：

```bash
node scripts/query-qdii.js --status all --save snapshots/previous.json
node scripts/query-qdii.js --status all --compare snapshots/previous.json
```

## 输出字段与限制

详见 [references/data-source.md](references/data-source.md)。页面未明确的渠道金额保持为空，不猜测为 0、无限额或不可买。最终状态以用户实际销售渠道和基金公司公告为准。

## 参考设计

本项目独立实现，设计时参考了以下公开项目和讨论中的范围、验证与权限边界：

- [QDII-fund-scout 创作帖及评论](https://forum.trae.cn/t/topic/19843)
- [Yui-cx/qdii-limit-monitor-skill](https://github.com/Yui-cx/qdii-limit-monitor-skill)
- [aiten2/qdii-purchase-limits](https://github.com/aiten2/qdii-purchase-limits)

## License

MIT
