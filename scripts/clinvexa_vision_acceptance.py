"""Opt-in live regression gate: synthetic records, complete fields, <10s.

Run with the installed Python and --runtime-home pointing at its profile.
Never captures a user's screen or changes their configuration/results.
"""
import argparse
import asyncio
import base64
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import time

FIELDS = {
    "主诉": "右上腹阵发性疼痛3天，伴发热、恶心及呕吐1天。",
    "现病史": "3天前进食油腻食物后出现右上腹阵发性疼痛，每次持续10至20分钟，间歇期未完全缓解，可向右肩背部放射，进食后加重。昨天夜间体温最高39.0摄氏度，伴恶心、呕吐2次，呕吐物为胃内容物，无咖啡色液体。否认胸痛、气促、黑便、呕血及尿痛。今晨仍腹痛，饮水减少。",
    "既往史": "5年前发现高血压，平时血压130至145/80至90mmHg，否认糖尿病和冠心病，无腹部手术史，无类似疼痛发作史。",
    "过敏史": "青霉素过敏，既往使用后出现全身皮疹，无呼吸困难；其他药物及食物过敏史不详。",
    "用药史": "氨氯地平5mg每日一次口服，最近一次今天早晨；昨晚自行口服对乙酰氨基酚0.5g一次，未服抗菌药。",
    "辅助检查": "腹部彩超提示胆囊多发结石，大者8mm，胆总管未见扩张。白细胞12.8乘10的9次方/L，中性粒细胞85%，CRP68mg/L，血红蛋白135g/L，血小板210乘10的9次方/L。",
}
SHORT_FIELDS = {
    "主诉": "咳嗽2天。", "现病史": "干咳2天，无发热，无胸痛。",
    "既往史": "否认高血压。", "过敏史": "青霉素过敏。",
    "用药史": "未服药。", "辅助检查": "体温36.5℃，血氧98%。",
}


def screenshot(fields, blank=False):
    from PIL import Image, ImageDraw, ImageFont
    picture = Image.new('RGB', (1500, 1000), 'white')
    draw = ImageDraw.Draw(picture)
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 28)
    lines = ['合成验收页面（无真实患者）', '患者编号：TEST-001    就诊号：TEST-V1']
    for label, text in fields.items():
        value = f'{label}：' + ('' if blank else text)
        lines.extend(value[i:i+44] for i in range(0, len(value), 44))
    for index, line in enumerate(lines):
        draw.text((30, 25 + index * 45), line, font=font, fill='black')
    stream = io.BytesIO()
    picture.save(stream, 'JPEG', quality=90)
    return 'data:image/jpeg;base64,' + base64.b64encode(stream.getvalue()).decode()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--runtime-home', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--vision-model', default='')
    parser.add_argument('--runs', type=int, default=3)
    parser.add_argument('--budget-ms', type=int, default=9000, help='Reserve 1s for desktop capture/debounce/render')
    args = parser.parse_args()
    import yaml
    from dotenv import dotenv_values
    settings = yaml.safe_load((args.runtime_home / 'config.yaml').read_text(encoding='utf-8'))
    home = Path(tempfile.mkdtemp(prefix='clinvexa-vision-acceptance-'))
    vision = settings.setdefault('auxiliary', {}).setdefault('vision', {})
    if args.vision_model:
        vision['model'] = args.vision_model
    settings['stt'] = {'enabled': False}
    (home / 'config.yaml').write_text(yaml.safe_dump(settings, allow_unicode=True), encoding='utf-8')
    for key, value in dotenv_values(args.runtime_home / '.env').items():
        if value:
            os.environ[key] = value
    os.environ['HERMES_HOME'] = str(home)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from hermes_cli import clinvexa_copilot as copilot
    from agent.auxiliary_client import resolve_vision_provider_client
    report = {'synthetic': True, 'visionModel': vision.get('model'), 'budgetMs': args.budget_ms, 'runs': []}
    original_model = copilot._model
    captured = {}
    async def capture_model(*args, **kwargs):
        value = await original_model(*args, **kwargs)
        captured['raw'] = str(value)
        return value
    copilot._model = capture_model

    async def run():
        # Same sync SDK prewarm as the desktop startup; no billed model call.
        started = time.monotonic()
        await asyncio.to_thread(resolve_vision_provider_client, async_mode=False)
        report['startupWarmupMs'] = round((time.monotonic() - started) * 1000)
        for mode in ('source_fields', 'screen_only', 'long_screen'):
            fields = SHORT_FIELDS if mode == 'screen_only' else FIELDS
            picture = screenshot(fields, blank=mode == 'source_fields')
            for index in range(args.runs):
                started = time.monotonic()
                row = {'case': mode, 'run': index + 1}
                captured.clear()
                try:
                    result = await copilot.analyze_screen(copilot.ScreenRequest(
                        frameId=f'{mode}-{index}', windowId='synthetic', title='合成验收病历',
                        processName='synthetic', capturedAt=int(time.time()*1000), imageDataUrl=picture,
                        sourceText=''.join(f'{key}：{value}' for key, value in fields.items()) if mode == 'source_fields' else '',
                        question='将所有有资料的字段整理为可填写病历，完整保留原文时间、剂量、单位和否定信息。'))
                    actual = {item['title']: item['text'] for item in result['suggestions'] if item['kind'] == 'field'}
                    missing = [key for key in fields if not actual.get(key)]
                    changed = [key for key in fields if actual.get(key) != fields[key]]
                    row.update(result=result, missingFields=missing, changedFields=changed,
                               complete=not missing and not changed and result['patientId']=='TEST-001' and result['encounterId']=='TEST-V1')
                except Exception as exc:
                    row.update(complete=False, error=getattr(exc, 'detail', type(exc).__name__))
                    row['syntheticRaw'] = captured.get('raw', '')
                    cause = exc.__cause__
                    row['cause'] = type(cause).__name__
                    if hasattr(cause, 'errors'):
                        row['validation'] = cause.errors(include_input=False, include_context=False)
                row['elapsedMs'] = round((time.monotonic()-started)*1000)
                row['passed'] = row['complete'] and row['elapsedMs'] < args.budget_ms
                report['runs'].append(row)
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
                print(json.dumps({k:v for k,v in row.items() if k!='result'}, ensure_ascii=False), flush=True)
    asyncio.run(run())
    return 0 if all(row['passed'] for row in report['runs']) else 1


if __name__ == '__main__':
    raise SystemExit(main())
