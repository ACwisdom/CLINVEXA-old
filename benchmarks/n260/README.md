# N260 阶段 0 压测

本目录的执行器用于收集 CLINVEXA 阶段 0 云端功能调试和最终 N260 验收证据。当前随附 `clinvexa-synthetic-cases.jsonl`，其中 20 份用例均为专门编写的纯合成内容，不来自患者病历，也不代表真实临床分布。

## 样例契约

输入为 UTF-8 JSONL，必须恰好包含 20 个唯一 `case_id`，且每条记录必须包含 `synthetic: true`、`source_provenance: fully_synthetic` 和非空 `expected` 断言。支持三类任务：

- `medical_record_draft`：必须提供 OpenAI 格式的非空 `messages`。
- `multi_agent`：必须提供能让 Hermes 主 Agent 调度三个专业 Agent 的非空 `messages`。
- `asr`：必须提供相对 JSONL 文件所在目录的 `audio_path`，且音频文件必须存在。

`expected` 支持必须出现、禁止出现和必须为 JSON 对象三类确定性断言。请求成功但断言失败仍判定为功能失败。

聊天样例格式：

```json
{"case_id":"deidentified-01","kind":"medical_record_draft","messages":[{"role":"user","content":"<脱敏病历内容>"}]}
```

ASR 样例格式：

```json
{"case_id":"deidentified-20","kind":"asr","audio_path":"audio/deidentified-20.wav"}
```

不得在 `case_id`、提示词、文件名或音频中保留真实姓名、身份证号、手机号、住址、住院号等直接身份标识。真实脱敏样例如果在最终阶段加入，仍须单独取得数据授权。

## 阿里云百炼功能调试

Key 只放在当前终端进程环境，禁止写入仓库文件或命令行参数：

```powershell
$env:DASHSCOPE_API_KEY = '<在本机终端输入有效Key>'
E:\anaconda\python.exe benchmarks\n260\run_benchmark.py `
  --cases benchmarks\n260\clinvexa-synthetic-cases.jsonl `
  --base-url https://ws-0t6ttlu1tjs0keb5.cn-beijing.maas.aliyuncs.com/compatible-mode/v1 `
  --chat-model <工作空间实际开放模型> `
  --duration-seconds 1 `
  --concurrency 3 `
  --output artifacts\stage-0-cloud-result.json
Remove-Item Env:DASHSCOPE_API_KEY
```

必须先通过 `/models` 获取工作空间实际模型名，不猜测模型名称。当前合成集通过多 Agent 提示测试 ASR 不可用时的产品契约；真实音频转写在具备 ASR 模型后使用 `kind: asr` 和 `--asr-model` 单独验收。

## 执行

在 N260 双卡工作站启动 Hermes/OpenAI-compatible 服务与 ASR 服务后运行：

```powershell
E:\anaconda\python.exe benchmarks\n260\run_benchmark.py `
  --cases D:\acceptance\clinvexa-cases.jsonl `
  --base-url http://127.0.0.1:8001 `
  --chat-model <本地模型名称> `
  --asr-model <ASR模型名称> `
  --duration-seconds 7200 `
  --concurrency 3 `
  --output D:\acceptance\stage-0-n260-result.json
```

退出码为 0 表示执行器可测量的门禁均通过：达到指定时长、请求零失败、所有功能断言通过、病历草稿 P95 不超过 20 秒。云端调试结果不等同于 N260 硬件验收；最终仍须保存 N260 监控截图或日志，以证明期间没有 OOM、进程重启或设备故障。

## 正式证据

阶段报告需附：

1. 原始 20 个 `case_id` 的脱敏与授权确认，不附患者身份信息。
2. 执行器输出的 JSON 文件。
3. 推理服务、Hermes、ASR 的启动参数与版本。
4. 两小时设备监控日志以及开始、结束时间。
5. 所有失败请求的原始错误日志；存在失败时门禁不通过。
