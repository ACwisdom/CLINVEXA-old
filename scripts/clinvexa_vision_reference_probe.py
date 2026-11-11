"""Evaluate a stricter reference-only transport without changing shipped code."""
import json
import runpy
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from hermes_cli import clinvexa_copilot as copilot

original = copilot._analyze_model
async def reference_request(messages, fields, preview, **kwargs):
    if fields:
        messages = [dict(message) for message in messages]
        messages[0]['content'] += '\n本次存在 verbatimFields：它是只读输入，禁止在输出JSON中回显。对于其同名字段，items 项只写 title、ref 两个键；禁止重写 text/quote/evidence/facts。示例：{"title":"主诉","ref":"v0"}。其他字段仍须完整生成。'
        messages[1]['content'] = [dict(piece) for piece in messages[1]['content']]
        context = json.loads(messages[1]['content'][0]['text'])
        context['verbatimFields'] = {key: {'title': item['title']} for key, item in fields.items()}
        messages[1]['content'][0]['text'] = json.dumps(context, ensure_ascii=False)
    return await original(messages, fields, preview, **kwargs)
copilot._analyze_model = reference_request
runpy.run_path(str(Path(__file__).with_name('clinvexa_vision_acceptance.py')), run_name='__main__')
