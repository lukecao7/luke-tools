#!/usr/bin/env python3
"""
PDF Downloader - 从网页下载所有 PDF 文件，并将 HTML 页面转换为 PDF
用法: python pdf_downloader.py <网址> [输出目录]
"""

import os
import re
import sys
import gzip
import zlib
import requests
from urllib.parse import urljoin, urlparse, unquote
from bs4 import BeautifulSoup
from pathlib import Path

# 尝试导入 Playwright
try:
    from playwright.sync_api import sync_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False


def decompress_content(response: requests.Response) -> str:
    """解压缩响应内容"""
    return response.text


def get_links(url: str) -> tuple[list[str], list[str]]:
    """从网页中提取所有 PDF 和 HTML 链接"""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }
    
    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()
    
    html_text = decompress_content(response)
    soup = BeautifulSoup(html_text, 'html.parser')
    
    pdf_links = []
    html_links = []
    
    for link in soup.find_all('a', href=True):
        href = link['href']
        full_url = urljoin(url, href)
        
        if href.startswith('#') or href.startswith('mailto:'):
            continue
        
        if href.lower().endswith('.pdf'):
            if full_url not in pdf_links:
                pdf_links.append(full_url)
        elif href.lower().endswith(('.html', '.htm')):
            base_domain = urlparse(url).netloc
            link_domain = urlparse(full_url).netloc
            if base_domain == link_domain and full_url not in html_links:
                # 排除主页面本身
                if full_url != url:
                    html_links.append(full_url)
    
    # 正则匹配 PDF 链接
    href_pattern = re.compile(r'href=["\']([^"\']*\.pdf)["\']', re.IGNORECASE)
    for match in href_pattern.findall(html_text):
        full_url = urljoin(url, match)
        if full_url not in pdf_links:
            pdf_links.append(full_url)
    
    return pdf_links, html_links


def download_pdf(url: str, output_dir: Path) -> bool:
    """下载单个 PDF 文件"""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    }
    
    try:
        response = requests.get(url, headers=headers, timeout=60, stream=True)
        response.raise_for_status()
        
        parsed_url = urlparse(url)
        filename = unquote(os.path.basename(parsed_url.path))
        
        if not filename:
            filename = f"document_{hash(url) % 10000}.pdf"
        
        if not filename.lower().endswith('.pdf'):
            filename += '.pdf'
        
        filepath = output_dir / filename
        
        counter = 1
        original_filepath = filepath
        while filepath.exists():
            stem = original_filepath.stem
            filepath = output_dir / f"{stem}_{counter}.pdf"
            counter += 1
        
        with open(filepath, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        print(f"  ✅ 已下载: {filename}")
        return True
        
    except Exception as e:
        print(f"  ❌ 下载失败 ({url}): {e}")
        return False


def html_to_pdf(url: str, output_dir: Path, browser) -> bool:
    """使用 Playwright 将 HTML 页面转换为 PDF"""
    try:
        parsed_url = urlparse(url)
        filename = unquote(os.path.basename(parsed_url.path))
        
        if not filename:
            filename = f"page_{hash(url) % 10000}.html"
        
        # 将 .html/.htm 扩展名改为 ltr.pdf (保持与 PDF 文件命名一致)
        stem = Path(filename).stem
        pdf_filename = f"{stem}ltr.pdf"
        
        filepath = output_dir / pdf_filename
        
        counter = 1
        original_filepath = filepath
        while filepath.exists():
            filepath = output_dir / f"{stem}ltr_{counter}.pdf"
            counter += 1
        
        # 使用 Playwright 转换
        page = browser.new_page()
        page.goto(url, wait_until='networkidle')
        page.pdf(path=str(filepath), format='A4', margin={'top': '1cm', 'bottom': '1cm', 'left': '1cm', 'right': '1cm'})
        page.close()
        
        print(f"  ✅ 已转换: {pdf_filename}")
        return True
        
    except Exception as e:
        print(f"  ❌ 转换失败 ({url}): {e}")
        return False


def main():
    if len(sys.argv) < 2:
        print("用法: python pdf_downloader.py <网址> [输出目录]")
        print("示例: python pdf_downloader.py https://example.com/documents ./downloads")
        print("\n功能: 下载网页上的所有 PDF 文件，并将 HTML 链接转换为 PDF")
        sys.exit(1)
    
    url = sys.argv[1]
    output_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("./pdf_downloads")
    
    output_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"🔍 正在扫描网页: {url}")
    print(f"📁 下载目录: {output_dir.absolute()}")
    print("-" * 50)
    
    try:
        pdf_links, html_links = get_links(url)
    except Exception as e:
        print(f"❌ 无法访问网页: {e}")
        sys.exit(1)
    
    total_pdf = len(pdf_links)
    total_html = len(html_links)
    
    if total_pdf == 0 and total_html == 0:
        print("⚠️  未找到任何 PDF 或 HTML 链接")
        sys.exit(0)
    
    print(f"📄 找到 {total_pdf} 个 PDF 文件")
    print(f"🌐 找到 {total_html} 个 HTML 页面 (将转换为 PDF)")
    print("-" * 50)
    
    success_count = 0
    total = total_pdf + total_html
    
    # 下载 PDF 文件
    for i, pdf_url in enumerate(pdf_links, 1):
        print(f"[{i}/{total}] 下载 PDF...")
        if download_pdf(pdf_url, output_dir):
            success_count += 1
    
    # 转换 HTML 页面为 PDF
    if html_links:
        if not PLAYWRIGHT_AVAILABLE:
            print("⚠️ 需要安装 playwright 来转换 HTML: pip install playwright && playwright install chromium")
        else:
            print("\n🌐 正在启动浏览器进行 HTML 转换...")
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                for i, html_url in enumerate(html_links, total_pdf + 1):
                    print(f"[{i}/{total}] 转换 HTML 到 PDF...")
                    if html_to_pdf(html_url, output_dir, browser):
                        success_count += 1
                browser.close()
    
    print("-" * 50)
    print(f"✨ 完成! 成功处理 {success_count}/{total} 个文件")
    print(f"📂 文件保存在: {output_dir.absolute()}")


if __name__ == "__main__":
    main()
