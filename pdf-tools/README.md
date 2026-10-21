# PDF 小工具

这里保留两个独立脚本：`pdf_downloader.py` 下载网页中的 PDF，并可将 HTML 页面转换为 PDF；`pdf_merger.py` 按文件名排序合并目录中的 PDF，并为每份文件添加书签。

先进入本目录，安装依赖：

```bash
python3 -m pip install -r requirements.txt
```

下载 PDF：

```bash
python3 pdf_downloader.py https://example.com/documents ./pdf_downloads
```

需要把 HTML 页面转换为 PDF 时，另外安装 Playwright 和 Chromium：

```bash
python3 -m pip install playwright
python3 -m playwright install chromium
```

合并股东信 PDF：

```bash
python3 pdf_merger.py ../buffett-letters ./merged.pdf
```

下载内容、临时调试页和在本目录生成的 PDF 默认不提交到 Git。已有的股东信合并文件保存在 `../buffett-letters/exports/letters-merged.pdf`。
