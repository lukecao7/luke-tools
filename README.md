# Buffett Letters Workbench

这个目录现在不只是年报 PDF，也多了一套把股东信整理成「投资案例研究」的基础工具。

## 目标

相比普通的公司介绍页，这套工作流更适合回答下面四类问题：

- 巴菲特是在什么环境里开始买入的
- 他买入时看到的价值锚点是什么
- 之后几年 thesis 是如何被验证的
- 他为什么继续持有，或者为什么退出

## 快速开始

先安装依赖：

```bash
python3 -m pip install -r requirements.txt
```

构建静态站：

```bash
python3 scripts/build_site.py
```

构建结果会输出到 `dist/`，仓库里已经带好了 GitHub Pages workflow：

- `.github/workflows/deploy-pages.yml`

把 PDF 提取为结构化文本：

```bash
python3 scripts/extract_letters.py
```

按公司检索证据：

```bash
python3 scripts/company_evidence.py --company coca-cola --out output/coca_cola_evidence.md
```

## 目录说明

- `docs/casebook_upgrade.md`
  站点应该如何从「知识库」升级为「投资案例库」。
- `scripts/extract_letters.py`
  把 `1977ltr.pdf` 这类文件提取为逐页 JSON 和全文 TXT。
- `scripts/company_evidence.py`
  基于公司别名，从逐页文本里抽出时间线证据和持仓表格行。
- `scripts/build_site.py`
  把 `data/` 里的公司、案例、人物、概念数据编译成可部署的静态站。
- `data/company_aliases.json`
  公司别名配置，后续可以继续补。
- `data/cases/*.json`
  案例页的核心内容。
- `data/companies/*.json`
  公司入口页的数据。
- `data/people/*.json` / `data/concepts/*.json`
  索引页的元数据。
- `output/coca_cola_case.md`
  一份已经写好的增强版样例，展示目标页面应长什么样。

## 当前语料边界

本地 PDF 覆盖 `1977` 到 `2024` 年伯克希尔股东信。像美国运通在 `1964` 年的第一次经典买入，单靠本地语料无法完整复原，需要额外补充早期合伙人信或外部资料。
