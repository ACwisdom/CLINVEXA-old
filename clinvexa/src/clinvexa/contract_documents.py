"""Version comparisons and printable copies of business contracts."""

from __future__ import annotations

from difflib import SequenceMatcher
from html import escape
from io import BytesIO

from clinvexa.contracts import LOCKED_HEADER, ContractDraft, ContractRecord, procurement_route


def draft_lines(draft: ContractDraft) -> list[str]:
    return [
        f"合同名称：{draft.title}",
        f"合同相对方：{draft.counterparty}",
        f"项目编号：{draft.project_number}",
        f"合同金额（元）：{draft.amount if draft.amount is not None else '待填写'}",
        f"前置程序：{procurement_route(draft)}",
        f"前置依据：{draft.procurement_reference}",
        f"履行开始：{draft.starts_on or '待填写'}",
        f"履行结束：{draft.ends_on or '待填写'}",
        "",
        *draft.body.splitlines(),
    ]


def compare_lines(before: list[str], after: list[str]) -> list[dict[str, object]]:
    """Return changed blocks with one-based line positions on both sides."""
    return [
        {"before_line": a + 1, "after_line": c + 1, "before": before[a:b], "after": after[c:d]}
        for tag, a, b, c, d in SequenceMatcher(None, before, after).get_opcodes()
        if tag != "equal"
    ]


def contract_pdf(record: ContractRecord, watermark: str | None) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    font = "STSong-Light"
    pdfmetrics.registerFont(UnicodeCIDFont(font))
    title = ParagraphStyle("ContractTitle", fontName=font, fontSize=18, leading=26, alignment=1, wordWrap="CJK")
    body = ParagraphStyle("ContractBody", fontName=font, fontSize=11, leading=17, wordWrap="CJK", spaceAfter=4)
    stream = BytesIO()
    document = SimpleDocTemplate(stream, pagesize=A4, title=record.draft.title, author="CLINVEXA")
    items = [
        Paragraph(escape(record.draft.title), title), Spacer(1, 12),
        Paragraph(escape(f"合同编号：{record.id}　版本：{record.revision}"), body),
        Paragraph(escape(LOCKED_HEADER), body),
    ]
    if record.oa_request_id:
        items.append(Paragraph(escape(f"OA 流程：{record.oa_request_id}"), body))
    items.extend(Paragraph(escape(line), body) if line.strip() else Spacer(1, 8) for line in draft_lines(record.draft)[1:])

    def decorate(canvas, doc):
        canvas.saveState()
        canvas.setFont(font, 10)
        canvas.drawCentredString(A4[0] / 2, 34, f"第 {doc.page} 页")
        if watermark:
            canvas.translate(A4[0] / 2, A4[1] / 2)
            canvas.rotate(36)
            canvas.setFillColor(colors.HexColor("#D9DFE5"))
            canvas.setFont(font, 44)
            canvas.drawCentredString(0, 0, watermark)
        canvas.restoreState()

    document.build(items, onFirstPage=decorate, onLaterPages=decorate)
    return stream.getvalue()
