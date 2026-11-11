# CLINVEXA 阶段 0 交付报告

**报告日期：** 2026-08-04  
**阶段：** Hermes 能力基线与运行验证  
**状态：** 已完成  
**门禁决定：** **Go（云端/合成替代范围）**

阶段 0 已完成源码基线、工具能力同步、三子 Agent 百轮调度验证、Windows 基线修复、云端/N260 共用压测工具及 20 份纯合成功能样例。用户批准以阿里云百炼和合成样例作为当前调试替代，并将 N260 与真实 HIS 验收顺延至阶段 4。`qwen3.5-27b` 在明确输出契约后连续两轮达到 20/20 请求和 20/20 功能断言通过，阶段 0 记录临时 Go，允许进入阶段 1。

## 已交付功能

1. CLINVEXA 工具清单从 Hermes 会话实际解析后的工具定义生成，不增加工具白名单。
2. 已加载工具按原 Hermes 调度器执行；未加载工具统一返回“当前环境无该工具可调用”，不会调用后端或虚构结果。
3. 三子 Agent 并发调度百轮验证，覆盖 Hermes 原生线程池、结果聚合和输入顺序恢复。
4. 云端/N260 共用执行器支持病历草稿、多 Agent 和 ASR 三类用例、时长循环、三并发、请求失败、功能断言和病历草稿 P95。
5. HIS 目标环境登记、手工复现路径及通过标准已固化。
6. 修复 Hermes Skills 在 Windows 返回反斜杠路径导致的跨平台契约失败。
7. 20 份纯合成样例覆盖病历结构化、质控、患者摘要、知识依据、多 Agent 路由和 ASR 不可用契约。

## 已完成任务

- [x] 记录官方 upstream、tag/commit、版本与依赖锁差异。
- [x] 验证 Runtime/Gateway、Desktop、Memory、Skills、子 Agent 和工具调用关键路径。
- [x] 实现工具清单与不存在工具的稳定反馈。
- [x] 完成 100 轮 × 3 子 Agent 的受控稳定性验证。
- [x] 完成云端/N260 20 样例输入契约与压测执行器。
- [x] 编制 20 份纯合成样例及确定性功能断言。
- [x] 完成 HIS RPA 目标环境和手工复现文档。
- [x] 使用百炼实际开放模型完成两轮 20/20 云端功能测试。
- [ ] 阶段 4：在 N260 双卡工作站连续运行 2 小时。
- [ ] 阶段 4：在真实 HIS 或获批模拟 HIS 完成 RPA 验收。

## 源码基线结论

当前源码目录没有 `.git` 元数据，不能证明为完整、未修改的官方检出。抽样归一化比较显示，核心与 Desktop 多个文件对齐官方 `v2026.8.3`/commit `3c27eb6234bf91b8ceee9e9071591b31e9b148cb`，但 `pyproject.toml` 和 `uv.lock` 仍保留 0.19.1 元数据。因此本项目将其登记为“混合快照”，不把它表述为干净的官方发布版本。详细证据见 `docs/clinvexa/upstream-baseline.md`。

## 测试与结果

| 验证项 | 结果 |
|---|---:|
| CLINVEXA 工具清单与不存在工具契约 | 24 passed，0 failed |
| 三子 Agent 连续 100 轮 | 1 passed；300/300 子任务完成 |
| 基准输入、断言与指标计算契约 | 10 passed，0 failed |
| 20 份纯合成数据集完整性、覆盖、直接标识模式和全流程执行 | 4 passed，0 failed |
| Hermes Memory、Skills、delegate 回归 | 133 passed，0 failed |
| Gateway 定向契约 | 5 passed，0 failed |
| Desktop TypeScript typecheck | passed |
| Desktop pet/quick-entry UI | 27 passed，0 failed |
| 完整 Gateway 504 项文件 | 180 秒内未完成；未计为通过 |
| N260 两小时真实压测 | 未执行：当前机器为 NVIDIA MX350 2 GiB，不是 N260 |
| HIS 手工复现 | 未执行：目标环境资料未提供 |
| 百炼模型发现 | replacement credential passed；选择 `qwen3.5-27b` |
| 云端首轮基线 | 20/20 请求；2/20 原断言；P95 7.266 秒；保留为字段漂移与补造问题证据 |
| 云端修正后第 1 轮 | 20/20 请求；20/20 断言；P95 11.765 秒 |
| 云端修正后第 2 轮（temperature=0） | 20/20 请求；20/20 断言；P95 13.656 秒 |

测试均通过仓库规定的 `scripts/run_tests.sh` 或 Desktop 原生 npm/Vitest 命令执行。Python 环境按锁定版本补装了 Windows 必需依赖 `concurrent-log-handler==0.9.29`。JavaScript 依赖使用符合项目 engine 约束的临时 npm 11.17.0 安装。

## 验收门禁

| 硬性标准 | 状态 | 证据 |
|---|---|---|
| 已加载工具受控清单调用成功率 100% | 通过 | 5/5 注册可用工具成功调用，禁用工具未进入清单 |
| 20 个不存在工具均显示约定文案，无伪造结果 | 通过 | 20/20 参数化测试通过，后端调度次数为 0 |
| 三子 Agent 连续运行 100 次，无死锁、无丢失 | 通过 | 100/100 轮，300/300 子任务完成 |
| 20 份纯合成样例完成数据契约与覆盖检查 | 通过 | 20/20；13 项测试通过；无手机号或身份证号模式 |
| 百炼完成 20/20 请求且所有功能断言通过 | 通过 | 连续两轮均为 20/20 请求、20/20 断言、0 请求失败 |
| N260 两小时稳定性与本地 P95 | 顺延 | 用户批准移至阶段 4，不表述为已通过 |
| 真实或模拟 HIS RPA 验收 | 顺延 | 用户批准移至阶段 4；真实环境继续优先 |
| 阶段报告完整并记录 Go | 通过 | 当前决定为云端/合成替代范围内 Go |

## 变更文件

- `clinvexa/src/clinvexa/tool_inventory.py`
- `clinvexa/tests/test_tool_inventory.py`
- `clinvexa/tests/test_delegation_smoke.py`
- `clinvexa/tests/test_n260_benchmark.py`
- `clinvexa/tests/test_synthetic_case_set.py`
- `benchmarks/n260/run_benchmark.py`
- `benchmarks/n260/README.md`
- `benchmarks/n260/clinvexa-synthetic-cases.jsonl`
- `tools/skills_tool.py`
- `docs/clinvexa/upstream-baseline.md`
- `docs/clinvexa/his-rpa-target.md`
- `docs/plans/2026-08-04-clinvexa-stage-0-substitution.md`
- `task_plan.md`、`findings.md`、`progress.md`

## 未解决项与进入 Go 所需输入

当前阶段 0 无未解决阻断项。N260、真实 ASR 和真实/模拟 HIS 不阻断阶段 1，但仍保留为阶段 4 最终交付门禁。云端结果只证明 OpenAI-compatible 模型功能契约，不代表 N260 性能或生产 HIS 通过。

## 其他基线观察

- Desktop 依赖安装的 npm 审计报告包含 1 个上游高危告警，当前没有运行会自动修改锁文件的 `npm audit fix`。
- 完整 Gateway 单文件回归在当前机器上超过 180 秒，应在 CI 或性能更高的验收机补跑，但它不替代 N260 和 HIS 两项硬门禁。
