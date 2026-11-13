import json, os, sys, zipfile

MAX_TEXT = 200000
MAX_ARCHIVE = 60 * 1024 * 1024

def fail(message):
    print(json.dumps({'error': message}, ensure_ascii=False))
    sys.exit(1)

def extract(path):
    ext = os.path.splitext(path)[1].lower()
    parts = []
    length = 0
    def add(value):
        nonlocal length
        value = str(value or '').strip()
        if value:
            length += len(value) + 1
            if length > MAX_TEXT:
                raise ValueError('提取文本超过 200000 字符，请拆分文件后再添加')
            parts.append(value)
    if ext in ('.docx', '.xlsx', '.pptx'):
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > 10000 or sum(e.file_size for e in entries) > MAX_ARCHIVE:
                raise ValueError('文档解压后过大，无法安全提取')
    if ext == '.pdf':
        from pypdf import PdfReader
        reader = PdfReader(path)
        if reader.is_encrypted:
            raise ValueError('暂不支持加密 PDF')
        if len(reader.pages) > 100:
            raise ValueError('PDF 超过 100 页，请拆分后再添加')
        for index, page in enumerate(reader.pages, 1):
            text = page.extract_text() or ''
            if text.strip(): add(f'[第 {index} 页]\n{text}')
    elif ext == '.docx':
        from docx import Document
        doc = Document(path)
        for para in doc.paragraphs: add(para.text)
        for table in doc.tables:
            for row in table.rows: add(' | '.join(cell.text for cell in row.cells))
    elif ext == '.xlsx':
        from openpyxl import load_workbook
        book = load_workbook(path, read_only=True, data_only=True)
        try:
            if len(book.worksheets) > 50: raise ValueError('工作表超过 50 个，请拆分文件')
            cells = 0
            for sheet in book.worksheets:
                add(f'[工作表：{sheet.title}]')
                for row in sheet.iter_rows(values_only=True):
                    cells += len(row)
                    if cells > 200000: raise ValueError('单元格数量过多，请拆分文件')
                    add(' | '.join('' if cell is None else str(cell) for cell in row).rstrip(' |'))
        finally:
            book.close()
    elif ext == '.pptx':
        from pptx import Presentation
        pres = Presentation(path)
        if len(pres.slides) > 200: raise ValueError('幻灯片超过 200 页，请拆分文件')
        for index, slide in enumerate(pres.slides, 1):
            add(f'[第 {index} 张幻灯片]')
            for shape in slide.shapes:
                if shape.has_text_frame: add(shape.text_frame.text)
                if shape.has_table:
                    for row in shape.table.rows: add(' | '.join(cell.text for cell in row.cells))
    else:
        raise ValueError('不支持的文档类型')
    result='\n'.join(parts)
    if not result.strip(): raise ValueError('没有提取到文本；扫描件和图片暂不支持 OCR')
    return result

try:
    print(json.dumps({'text':extract(sys.argv[1])}, ensure_ascii=False))
except ImportError:
    fail('缺少文档解析组件，请先检查 Codex 工作区依赖')
except Exception as exc:
    fail(str(exc)[:300] or '文档解析失败')
