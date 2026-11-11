---
name: record-structuring
description: Structure, summarize, or quality-check medical records, clinical notes, transcripts, HIS exports, laboratory results, screenshots, PDF, Word, Excel, JSON, or text. Use for 病历结构化、病历草稿、文书质控、问诊转写整理、患者摘要、证据提取和病历缺项或冲突检查。
---

# 病历结构化

将输入转换为可追溯、供医生复核的结构化病历。只整理原始材料中明确存在的事实，不作诊断、处方、医嘱或治疗决策。

## 执行流程

1. 本 Skill 只能通过固定入口 `scripts/run.py` 执行。禁止 Agent 自行分析、生成临时脚本、调用模型补写内容或更改交付格式。
2. 固定脚本确认来源编号、文书类型和可读取内容；无法判断文书类型时标记 `unknown_medical_document`。
2. 拆分患者、就诊和文书边界；身份不明确时不要自动合并。
3. 提取主诉、现病史、既往史、家族史、过敏史、查体、检查、诊断、用药、计划和随访。
4. 为关键字段保留原始文本和来源编号。
5. 标准化时同时保留原始值；单位不明确时不要补写。
6. 检查缺项、重复、时间矛盾、过敏冲突、诊断确定性和药物剂量单位。
7. 输出结构化结果、质量问题和人工复核队列。
9. 固定脚本直接生成一个 `.xlsx` 交付文件；不得等待用户再次提出“转成 Excel”。
10. 单个文件或整个文件夹的全部结构化结果必须汇总进同一个 Excel 文件、同一个工作表；每份病历占一行。禁止拆成多个 Excel、CSV 或 JSON 文件。

## 状态规则

严格区分：

- `present`：原文明确存在。
- `absent`：原文明确否认。
- `not_mentioned`：原文未提及，不能改写成 `absent`。
- `suspected`：考虑、疑似、可能、待排或待查。
- `ruled_out`：排除或明确不支持。
- `unclear`：内容含糊、OCR 不可靠或无法确定。
- `conflict`：多个来源相互矛盾；保留双方证据，不选择真值。
- `not_applicable`：字段对当前对象不适用。

识别信息主体。家属疾病只进入家族史；既往用药不自动视为当前用药；检查结果不自动转成诊断。

## 默认 Excel 交付

点击 Skill 广场“运行”后，CLINVEXA 本地服务直接执行以下固定入口，不经过模型端点：

```powershell
python "$env:HERMES_HOME\skills\clinvexa\record-structuring\scripts\run.py" --source "D:\资料\门诊病历.docx"
```

- `--source` 可直接传入一个文件、多个文件或一个文件夹；文件夹会递归收集支持的医疗文档。
- 脚本按固定字段与明确标签做保守提取，未找到的事实写 `原文未涉及，待医生补充`；不调用模型推断。
- 一个任务只生成一个工作簿和一个“病历结构化结果”工作表。
- 成功后必须向用户返回 Excel 的完整绝对路径，并确认文件可打开、恰有一个汇总工作表且结果行数与成功分析的病例数一致。
- 附件路径同样是有效来源路径；不得因其位于 `.hermes/desktop-attachments` 而要求用户复制文件或再次指定保存位置。
- Excel 生成失败时明确返回失败原因，不得退回输出 `.json` 文件冒充成功。

每个关键字段同时输出状态与来源证据。诊断、检查和数值只保留原始文字；不由脚本转换成新的临床结论。

## 失败处理

文件不可读、内容为空、OCR 过低、表格错位、患者边界不明或身份冲突时不要静默继续。返回：

```json
{
  "status": "partial | failed | needs_review",
  "error_code": "",
  "error_message": "",
  "processed_sections": [],
  "unprocessed_sections": [],
  "recommended_action": ""
}
```

## 输出约束

- 不编造患者身份、时间、诊断、药品、检查、单位、来源或随访项目。
- OCR 模糊值降低置信度并进入人工复核，不自行纠正关键数字或药名。
- 冲突只报告，不自动修正原始病历。
- 所有结果均设置 `requires_human_review: true`。
- 默认交付物必须是单个 `.xlsx`；不得额外保存 CSV、XLS 或 JSON 交付文件。
- 任务没有生成成功且通过验证的 Excel 文件时，不得宣称 Skill 已完成。
- 结尾附上：`本结果仅用于信息辅助和人工审核，不作为临床诊断、处方或治疗决策依据。`
