"""Deterministic document parsing and evidence coordinates for contract reviews."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping
from pathlib import Path
from typing import Protocol
from uuid import uuid4
from zipfile import ZipFile

from clinvexa.contracts import MAX_TEXT
from clinvexa.deterministic_skills import DeterministicSkillError, read_source_text

PARSER_VERSION = "1"
OCR_PAGE_LIMIT = 24


class ContractOcr(Protocol):
    """Recognize only the requested 1-based PDF pages, with a bounded execution time."""

    def __call__(self, source: Path, pages: tuple[int, ...]) -> Mapping[int, str]:
        """Return page text. Omit pages that failed or were below the engine's quality threshold."""


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def text_document(kind: str, name: str, text: str, *, reliability: str) -> dict:
    return {
        "id": f"{kind}-snapshot", "kind": kind, "name": name,
        "sha256": sha256(text.encode("utf-8")), "hash_basis": "text",
        "parser_version": PARSER_VERSION, "status": "complete", "diagnostics": [],
        "reliability": reliability, "text": text, "segments": segments(enumerate(text.split("\n"), 1), "line"),
    }


def segments(parts, coordinate: str) -> list[dict]:
    result = []
    offset = 0
    for number, text in parts:
        if text:
            result.append({"anchor": f"{coordinate}:{number}", coordinate: number, "start": offset, "end": offset + len(text)})
        offset += len(text) + 1
    return result


def parse_document(path: Path, name: str, kind: str, data: bytes, ocr: ContractOcr | None = None) -> dict:
    doc = {
        "id": str(uuid4()), "kind": kind, "name": name, "sha256": sha256(data),
        "hash_basis": "file", "parser_version": PARSER_VERSION, "status": "failed",
        "diagnostics": [], "reliability": "source", "text": "", "segments": [],
    }
    diagnostics = doc["diagnostics"]
    recognized = set()
    if not data or (path.suffix == ".txt" and not data.strip()):
        doc["status"] = "empty"
        diagnostics.append("文件为空或仅包含空白")
        return doc
    try:
        if path.suffix == ".pdf":
            from pypdf import PdfReader

            reader = PdfReader(path)
            if reader.is_encrypted:
                diagnostics.append("PDF 已加密，请上传可直接读取的版本")
                return doc
            parts = []
            missing = []
            length = 0
            for number, page in enumerate(reader.pages, 1):
                value = (page.extract_text() or "").strip()
                length += len(value) + 1
                if length > MAX_TEXT + 1:
                    break
                parts.append(value)
                if not value:
                    missing.append(number)
            if length > MAX_TEXT + 1:
                diagnostics.append("正文超过 20 万字，请分段上传")
                return doc
            if missing and ocr is not None:
                requested = tuple(missing[:OCR_PAGE_LIMIT])
                try:
                    response = ocr(path, requested)
                    results = {page: response[page].strip() for page in requested
                               if isinstance(response.get(page), str) and response[page].strip()}
                    if length + sum(map(len, results.values())) > MAX_TEXT + 1:
                        diagnostics.append("OCR 文本超过处理上限，保留原有可读页")
                    else:
                        for page, value in results.items():
                            parts[page - 1] = value
                            recognized.add(page)
                except Exception:
                    diagnostics.append("OCR 处理失败，保留原有可读页")
                if recognized:
                    doc.update(parser_version="1+ocr", reliability="ocr_unverified")
                    diagnostics.append(f"{len(recognized)} 页来自 OCR，需与原件人工核验")
                    missing = [page for page in missing if page not in recognized]
            if missing:
                preview = "、".join(map(str, missing[:12]))
                diagnostics.append(f"{len(missing)} 页未提取到文本（页码 {preview}），扫描页需 OCR")
            coordinate = "page"
        elif path.suffix == ".docx":
            from tools.read_extract import extract_docx_paragraphs

            with ZipFile(path) as archive:
                if archive.getinfo("word/document.xml").file_size > 16 * 1024 * 1024:
                    diagnostics.append("DOCX 正文结构过大，请分段上传")
                    return doc
            parts = extract_docx_paragraphs(str(path))
            coordinate = "paragraph"
        else:
            parts = read_source_text(path).split("\n")
            coordinate = "line"
    except ImportError:
        diagnostics.append("文档读取组件不可用")
        return doc
    except DeterministicSkillError:
        diagnostics.append("无法读取 TXT，请检查编码并确认文件包含文本")
        return doc
    except Exception:
        diagnostics.append("无法解析文档，请确认文件格式和完整性")
        return doc

    text = "\n".join(parts)
    if not text.strip():
        doc["status"] = "ocr_required" if path.suffix == ".pdf" and diagnostics else "empty"
        if not diagnostics:
            diagnostics.append("文档没有可提取的正文")
        return doc
    if len(text) > MAX_TEXT:
        diagnostics.append("正文超过 20 万字，请分段上传")
        return doc
    doc.update(
        text=text, segments=segments(enumerate(parts, 1), coordinate),
        status="partial" if diagnostics else "complete",
    )
    if recognized:
        for segment in doc["segments"]:
            segment["reliability"] = "ocr_unverified" if segment["page"] in recognized else "source"
    return doc


def evidence(doc: dict, segment: dict, start: int, end: int) -> dict:
    """Use zero-based Unicode code point offsets into the immutable normalized text."""
    return {
        "document_id": doc["id"], "document_name": doc["name"], "sha256": doc["sha256"],
        "reliability": segment.get("reliability", doc["reliability"]), "anchor": segment["anchor"],
        "start": start, "end": end, "quote": doc["text"][start:end],
    }


def canonical(text: str) -> str:
    # Keep line separators internal to the text so edited lines do not inherit source anchors.
    return re.sub(r"\r\n?", "\n", text).strip()
