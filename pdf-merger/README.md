# PDF Merger · PDF 合并

将一个目录中的 PDF 按文件名排序，合并成一份 PDF，并为每份原始文档添加书签。适合整理年度股东信等成套材料；目录中另附一个网页 PDF 下载脚本。

## 安装

进入本目录后安装依赖：

```bash
python3 -m pip install -r requirements.txt
```

## 合并 PDF

```bash
python3 pdf_merger.py ../buffett-letters ./merged.pdf
```

第一个参数是输入目录，第二个参数是输出文件名。已有的股东信合并文件保存在 `../buffett-letters/exports/letters-merged.pdf`。

## 辅助下载

下载网页中的 PDF：

```bash
python3 pdf_downloader.py https://example.com/documents ./pdf_downloads
```

需要把 HTML 页面转换为 PDF 时，另外安装 Playwright 和 Chromium：

```bash
python3 -m pip install playwright
python3 -m playwright install chromium
```

下载内容、临时调试页和在本目录生成的 PDF 默认不提交到 Git。
