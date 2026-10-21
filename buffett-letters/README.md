# Buffett Letters Workbench

这个目录现在既保留了原始年报 PDF，也带了一套站点构建脚本。

## 目标

当前默认部署模式是先完整镜像参考站，再在此基础上讨论怎么做增强版研究页。

如果后续回到增强研究模式，本地也保留了对应脚本和数据结构。

相比普通的公司介绍页，增强模式更适合回答下面四类问题：

- 巴菲特是在什么环境里开始买入的
- 他买入时看到的价值锚点是什么
- 之后几年 thesis 是如何被验证的
- 他为什么继续持有，或者为什么退出

## 快速开始

先安装依赖：

```bash
python3 -m pip install -r requirements.txt
```

构建当前默认站点镜像：

```bash
python3 scripts/mirror_reference_site.py
```

构建结果会输出到 `dist/`，子目录内保留了独立项目使用的 GitHub Pages workflow；在工具合集仓库中不会自动触发：

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
- `scripts/mirror_reference_site.py`
  把公开参考站按原始目录结构镜像到 `dist/`，优先保持页面内容和跳链一致。
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

## 已有合并文件

`exports/letters-merged.pdf` 是整理前已有的股东信合并文件。原始年度 PDF 仍保留在本目录，合并文件单独存放，避免再次合并时重复计入。
