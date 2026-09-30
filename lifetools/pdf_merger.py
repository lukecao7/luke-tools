#!/usr/bin/env python3
"""
PDF Merger - 将多个 PDF 合并成一个，并为每个原始 PDF 添加书签
用法: python pdf_merger.py <输入目录> [输出文件名]
"""

import os
import re
import sys
from pathlib import Path
from PyPDF2 import PdfReader, PdfWriter


def extract_year(filename: str) -> str:
    """从文件名中提取年份"""
    match = re.search(r'(\d{4})', filename)
    return match.group(1) if match else filename


def merge_pdfs(input_dir: Path, output_file: Path) -> bool:
    """合并目录下所有 PDF 文件，并添加书签"""
    
    # 获取所有 PDF 文件并排序
    pdf_files = sorted(input_dir.glob("*.pdf"))
    
    if not pdf_files:
        print("❌ 未找到任何 PDF 文件")
        return False
    
    print(f"📚 找到 {len(pdf_files)} 个 PDF 文件")
    print("-" * 50)
    
    writer = PdfWriter()
    current_page = 0
    
    for pdf_file in pdf_files:
        try:
            print(f"  📄 处理: {pdf_file.name}")
            reader = PdfReader(pdf_file)
            
            # 添加书签（使用年份或文件名）
            year = extract_year(pdf_file.stem)
            bookmark_title = f"{year} 年致股东信"
            
            # 在当前页位置添加书签
            writer.add_outline_item(bookmark_title, current_page)
            
            # 添加所有页面
            for page in reader.pages:
                writer.add_page(page)
            
            current_page += len(reader.pages)
            
        except Exception as e:
            print(f"  ⚠️ 处理失败 ({pdf_file.name}): {e}")
            continue
    
    # 写入输出文件
    try:
        with open(output_file, 'wb') as f:
            writer.write(f)
        print("-" * 50)
        print(f"✨ 合并完成！共 {current_page} 页")
        print(f"📁 输出文件: {output_file.absolute()}")
        return True
    except Exception as e:
        print(f"❌ 写入文件失败: {e}")
        return False


def main():
    if len(sys.argv) < 2:
        print("用法: python pdf_merger.py <输入目录> [输出文件名]")
        print("示例: python pdf_merger.py ./Buffet_Letters buffett_letters_all.pdf")
        print("\n功能: 将目录下所有 PDF 合并成一个文件，并为每个 PDF 添加书签")
        sys.exit(1)
    
    input_dir = Path(sys.argv[1])
    
    if not input_dir.exists():
        print(f"❌ 目录不存在: {input_dir}")
        sys.exit(1)
    
    if not input_dir.is_dir():
        print(f"❌ 不是目录: {input_dir}")
        sys.exit(1)
    
    # 默认输出文件名
    default_output = input_dir.parent / f"{input_dir.name}_merged.pdf"
    output_file = Path(sys.argv[2]) if len(sys.argv) > 2 else default_output
    
    # 确保输出文件有 .pdf 扩展名
    if not output_file.suffix.lower() == '.pdf':
        output_file = output_file.with_suffix('.pdf')
    
    print(f"🔗 PDF 合并工具")
    print(f"📂 输入目录: {input_dir.absolute()}")
    print(f"📄 输出文件: {output_file.absolute()}")
    print("-" * 50)
    
    success = merge_pdfs(input_dir, output_file)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
