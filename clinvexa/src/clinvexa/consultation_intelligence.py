"""Stream evidence-bound draft fields, separately from clinical suggestions."""
from __future__ import annotations

import json
import re
from typing import Iterator

FIELDS = {
    "chief_complaint": "主诉", "present_illness": "现病史", "past_history": "既往史",
    "allergy_history": "过敏史", "medication_history": "用药史",
    "examination_summary": "检查检验信息", "preliminary_assessment": "初步判断",
    "treatment_plan": "处置建议", "followup_plan": "随访计划",
}

def normalized(text: str) -> str:
    return re.sub(r"[\s，。！？、；：,.!?;:]+", "", text)

def validated_item(item: object, transcript: str, sources: dict[str, str] | None = None) -> dict | None:
    if not isinstance(item, dict):
        return None
    kind = item.get("type")
    evidence = str(item.get("evidence") or "").strip()
    ids = item.get("evidence_ids")
    referenced = (sources is not None and isinstance(ids, list) and 0 < len(ids) <= 8
                  and all(isinstance(key, str) and key in sources for key in ids))
    if referenced:
        evidence = "\n".join(sources[key] for key in dict.fromkeys(ids))
    # Quoted evidence must really occur in the transcript. Model-generated
    # diagnoses never become recorded facts simply by being plausible.
    if not evidence or len(evidence) > 1500 or (not referenced and normalized(evidence) not in normalized(transcript)):
        return None
    if kind == "field" and item.get("key") in FIELDS:
        value = str(item.get("value") or "").strip()
        if value and len(value) <= 2000:
            return {"type": kind, "key": item["key"], "value": value, "evidence": evidence}
    if kind == "utterance" and item.get("role") in {"医生", "患者", "家属", "待确认"}:
        return {"type": kind, "role": item["role"], "text": evidence,
                "evidence": evidence, "inferred": True}
    if kind == "suggestion":
        title, reason = str(item.get("title") or "").strip(), str(item.get("reason") or "").strip()
        if title and reason and len(title) <= 120 and len(reason) <= 1000:
            return {"type": kind, "title": title, "reason": reason, "evidence": evidence,
                    "requires_human_review": True, "source": "AI 待核对建议"}
    return None

def stream_analysis(transcript: str) -> Iterator[dict]:
    from agent.auxiliary_client import call_llm
    from hermes_cli.config import load_config
    config = load_config().get("model", {})
    if not isinstance(config, dict):
        config = {"default": config}
    # Resolve quotations ourselves: models often normalize numbers while quoting,
    # silently invalidating otherwise useful fields. IDs cannot invent source text.
    text = transcript[-18000:]
    spans = [part[start:start + 60] for part in re.findall(r"[^。！？!?；;\n]+[。！？!?；;\n]*", text)
             for start in range(0, len(part), 60)]
    sources = {f"s{i}": span for i, span in enumerate(spans)}
    prompt = (
        "你是医生问诊助理。输入是可能无标点、方言、错字、医患角色不明的语音转写。"
        "仅返回逐行独立 JSON (NDJSON)，每行立即输出，不要思维链、说明或代码围栏。"
        "先从医患问答中提取明确事实，每个有内容的字段单独一行："
        '{"type":"field","key":"字段名","value":"简体中文病历措辞","evidence_ids":["s0"]}。'
        "字段名及含义：" + json.dumps(FIELDS, ensure_ascii=False) + "。"
        "主诉必须包含已知持续时间。医生的问题不能当成患者的症状；紧接的问题与回答结合理解；严守否定、数值、时间及不确定性。"
        "主诉只写核心症状及已知时长，病程、伴随症状、体温写入现病史。不要将整段转写重复填入不同字段。"
        "既往无与未提及不同。无法辨别的词保留原文并注明待核对，不猜数值或病史。"
        "输入是连续语音转写分块，分块仅供引用定位，不代表换人或句子结束。事实依据通过evidence_ids引用所在原文块的id，不要自行重写引用。"
        "有明确症状时必须整理现病史；听不清、疑似矛盾的内容在字段内注明待核对，不得因此丢弃其他已明确的病情。"
        "没有依据的字段跳过。初步判断、处置建议、随访计划只记录对话已说出的内容。"
        "随后单独给至多3条与现有症状相关的检查建议或必要追问，每条一行："
        '{"type":"suggestion","title":"建议检查或待追问事项","reason":"简短说明目的、适用条件、还需核实什么",'
        '"evidence_ids":["s0"]}。'
        "建议不代表医嘱，不自动确诊，不无差别罗列检查，不编造指南引用。"
        "资料不足以提出检查时明确建议先补问哪些信息。"
        "最后根据语义拆分问答并推断对话角色，最多12条，逐行输出："
        '{"type":"utterance","role":"医生/患者/家属/待确认之一","evidence":"该角色说出的连续原文"}。'
        "询问症状、给出诊疗建议通常为医生，自述不适通常为患者，转述亲属病情可能为家属。"
        "这是语义角色推断而非声纹身份确认；简短或歧义回答无法结合上下文判断则标待确认。"
        "不要根据输入统一的说话人待确认标签放弃分析。所有内容尽量精简。"
    )
    extra = {"enable_thinking": False} if "aliyuncs.com" in str(config.get("base_url", "")) else {}
    stream = call_llm(provider=config.get("provider") or "auto", model=config.get("default"),
                      base_url=config.get("base_url"), messages=[{"role": "system", "content": prompt},
                      {"role": "user", "content": json.dumps(sources, ensure_ascii=False)}],
                      temperature=0, max_tokens=4200, timeout=35, stream=True,
                      extra_body=extra, reasoning_config={"enabled": False})
    from hermes_cli.clinvexa_streaming import VisibleContent
    visible = VisibleContent()
    decoder = json.JSONDecoder()
    buffer, total = "", 0
    try:
        # Some compatibility adapters return a complete message even for stream=True.
        chunks = [stream] if hasattr(stream, "choices") else stream
        for chunk in chunks:
            choices = getattr(chunk, "choices", None)
            if not choices:
                continue
            delta = getattr(choices[0], "delta", None) or getattr(choices[0], "message", None)
            text = getattr(delta, "content", None)
            if not isinstance(text, str):
                continue
            buffer += visible.feed(text)
            total += len(text)
            if total > 24000:
                raise ValueError("analysis output exceeds limit")
            # Accept formatted JSON, fenced NDJSON and adjacent objects, while
            # waiting for incomplete objects rather than discarding their lines.
            while "{" in buffer:
                buffer = buffer[buffer.index("{"):]
                try:
                    raw, end = decoder.raw_decode(buffer)
                except ValueError:
                    break
                buffer = buffer[end:]
                item = validated_item(raw, transcript, sources)
                if item:
                    yield item
    finally:
        if hasattr(stream, "close"):
            stream.close()
