"""Execute the shipped Skill contract using a fresh installed Python (-I)."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--home', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
home = args.home.resolve()
source = home / 'hermes-agent'
assert Path(sys.executable).is_relative_to(source)
assert Path(sys.prefix).resolve() == source / 'venv'
assert Path(sys.base_prefix).resolve().is_relative_to(home), 'System Python must not supply the runtime'
import clinvexa.deterministic_skills as module
assert Path(module.__file__).resolve() == source / 'clinvexa/src/clinvexa/deterministic_skills.py'
from clinvexa.skills import CLINVEXASkillPlaza
from openpyxl import load_workbook
import openpyxl
assert Path(openpyxl.__file__).resolve().is_relative_to(home)

os.environ['HERMES_HOME'] = str(home)
work = args.output.parent / '中文 技能文件验收'
work.mkdir(exist_ok=True)
sample = work / '合成病历.txt'
sample.write_text('患者姓名：安装验收\n主诉：咳嗽3天。\n现病史：干咳，伴低热。\n过敏史：青霉素过敏。\n处置建议：待医生确认。\n随访计划：一周后门诊复诊。\n随访时间：一周后\n随访方式：门诊复诊\n', encoding='utf-8')
plaza = CLINVEXASkillPlaza.from_catalog(source / 'skills/clinvexa/catalog.json', home / 'skills')
catalog = plaza.browse()
assert catalog
existing = {skill.name: skill for skill in plaza.list_installed()}
for skill in catalog:
    installed = existing.get(skill.name) or plaza.install(skill.name)
    assert installed.enabled and (installed.path / 'SKILL.md').is_file()
    assert plaza.build_invocation(skill.name, '处理合成资料').startswith('$' + skill.name + '\n')

executions = []
for name in ('record-structuring', 'outpatient-note-draft', 'followup-plan'):
    installed = next(item for item in plaza.list_installed() if item.name == name)
    for mode, entry in [('module', ['-m', 'clinvexa.deterministic_skills', name]),
                        ('wrapper', [str(installed.path / 'scripts/run.py')])]:
        output = work / (name + '-' + mode + ('.xlsx' if name == 'record-structuring' else '.txt'))
        result = subprocess.run([sys.executable, '-I', *entry, '--source', str(sample), '--output', str(output)],
                                cwd=work, capture_output=True, encoding='utf-8', errors='replace', timeout=60)
        assert result.returncode == 0, result.stderr
        assert output.is_file() and output.stat().st_size
        if name == 'record-structuring':
            workbook = load_workbook(output, read_only=True)
            assert len(workbook.worksheets) == 1
            rows = list(workbook.active.values)
            assert len(rows) == 2 and '安装验收' in str(rows) and '咳嗽3天' in str(rows)
            workbook.close()
        else:
            text = output.read_text(encoding='utf-8')
            assert ('咳嗽3天' if name == 'outpatient-note-draft' else '一周后') in text
        executions.append({'skill': name, 'entry': mode, 'output': str(output), 'passed': True})
formats = work / '多格式输入'
formats.mkdir(exist_ok=True)
lines = sample.read_text(encoding='utf-8').splitlines()
from docx import Document
document = Document()
for line in lines:
    document.add_paragraph(line)
document.save(formats / '病例.docx')
book = openpyxl.Workbook()
for line in lines:
    book.active.append([line])
book.save(formats / '病例.xlsx')
book.close()
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
pdf = canvas.Canvas(str(formats / '病例.pdf'))
pdf.setFont('STSong-Light', 12)
for index, line in enumerate(lines):
    pdf.drawString(40, 780 - 24 * index, line)
pdf.save()
batch = work / '多格式批量汇总.xlsx'
result = subprocess.run([sys.executable, '-I', '-m', 'clinvexa.deterministic_skills', 'record-structuring',
                         '--source', str(formats), '--output', str(batch)], cwd=work,
                        capture_output=True, encoding='utf-8', errors='replace', timeout=60)
assert result.returncode == 0, result.stderr
book = load_workbook(batch, read_only=True)
rows = list(book.active.values)
assert len(rows) == 4 and all('安装验收' in str(row) and '咳嗽3天' in str(row) for row in rows[1:])
book.close()
args.output.write_text(json.dumps({'passed': True, 'python': sys.executable, 'basePython': sys.base_prefix,
                                  'pythonVersion': sys.version, 'ownedPython': True, 'module': module.__file__,
                                  'catalogSkills': len(catalog), 'executions': executions,
                                  'batchFormats': ['docx', 'xlsx', 'pdf'], 'batchRows': 3}, ensure_ascii=False, indent=2), encoding='utf-8')
print('PACKAGED_SKILLS_PASSED', len(catalog), len(executions))
