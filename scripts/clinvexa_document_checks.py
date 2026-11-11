"""Execute document engines, rather than accepting import-only checks."""
from pathlib import Path
from tempfile import TemporaryDirectory


def verify_documents() -> list[str]:
    from docx import Document
    from openpyxl import Workbook, load_workbook
    from pypdf import PdfReader
    from pptx import Presentation
    from reportlab.pdfgen import canvas
    import pdfplumber
    import pandas as pd
    from tools.read_extract import extract_document_text
    from clinvexa.deterministic_skills import _read_source

    with TemporaryDirectory(prefix='clinvexa-document-check-') as temporary:
        root = Path(temporary)
        word = root / 'record.docx'
        doc = Document(); doc.add_paragraph('主诉：合成验收病例咳嗽三天'); doc.save(word)
        assert '咳嗽三天' in extract_document_text(str(word))
        sheet = root / 'record.xlsx'
        book = Workbook(); book.active.append(['主诉', '合成验收病例咳嗽三天']); book.save(sheet)
        assert load_workbook(sheet).active['B1'].value == '合成验收病例咳嗽三天'
        assert '咳嗽三天' in extract_document_text(str(sheet))
        assert pd.read_excel(sheet, header=None).iloc[0, 1] == '合成验收病例咳嗽三天'
        pdf = root / 'record.pdf'
        page = canvas.Canvas(str(pdf)); page.drawString(50, 750, 'CLINVEXA-SYNTHETIC-PDF'); page.save()
        assert 'CLINVEXA-SYNTHETIC-PDF' in PdfReader(pdf).pages[0].extract_text()
        assert 'CLINVEXA-SYNTHETIC-PDF' in _read_source(pdf)
        with pdfplumber.open(pdf) as parsed:
            assert 'CLINVEXA-SYNTHETIC-PDF' in parsed.pages[0].extract_text()
        slides = root / 'report.pptx'
        presentation = Presentation(); slide = presentation.slides.add_slide(presentation.slide_layouts[0])
        slide.shapes.title.text = '科室合成验收'; presentation.save(slides)
        assert Presentation(slides).slides[0].shapes.title.text == '科室合成验收'
    return ['docx-create-and-extract', 'xlsx-create-and-extract', 'pandas-read-xlsx',
            'pdf-create-and-parse', 'production-pdf-input', 'pdfplumber-extract', 'pptx-create-and-read']


if __name__ == '__main__':
    import json
    print(json.dumps({'passed': True, 'checks': verify_documents()}))
