# CLINVEXA 阶段 2 交付报告

**阶段：** 多 Agent 医疗主流程  
**交付日期：** 2026-08-04  
**结论：** **Go**  
**下一阶段：** 允许进入阶段 3（Skill 广场）

## 1. 交付范围

本阶段在现有 Hermes Runtime 和 Desktop 上实现 CLINVEXA 的最小多 Agent 医疗主流程，没有引入第二套 Agent Loop、消息队列或微服务。

- 固定 1 个主控 Agent 与 3 个专业 Agent：病历、知识与患者管理、桌面与 HIS。
- 自动意图路由、医生手动切换、Hermes 原生 `delegate_task` 委派和结果汇总。
- Hermes 原生任务中断、失败 Agent 显示、保留已完成结果和按 Agent 重试。
- 录音转写入口、病历事实抽取、病历草稿基础数据、质控、一页摘要和随访草稿。
- 医学知识回答强制显示来源；无来源时返回“依据不足”。
- 工作台直接读取 Hermes 权威消息流，显示 Agent 状态、工具、来源、结果和错误。
- 病历结果保留原始证据、原始单位、异常标记、诊断确定性和人工复核要求。

## 2. 已完成任务

- [x] 配置主控、病历、知识与患者管理、桌面与 HIS 四个 Agent 角色和职责。
- [x] 实现意图路由、子 Agent 委派、结果汇总、中断和失败回退。
- [x] 实现录音转写、事实抽取、病历草稿基础数据、质控、一页摘要和随访草稿。
- [x] 医学知识回答显示检索来源；无来源时明确说明依据不足。
- [x] 工作台展示 Agent 状态、调用工具、来源证据和最终结果。
- [x] 创建并验证 `record-structuring` 医疗 Skill。
- [x] 完成阶段 2 自动化测试、指标复算、类型检查、静态检查和生产构建。

## 3. 主要交付文件

### Python 与医疗流程

- `clinvexa/src/clinvexa/agents.py`
- `clinvexa/src/clinvexa/records.py`
- `clinvexa/tests/test_agent_routing.py`
- `clinvexa/tests/test_record_goldset.py`

### Hermes Skill

- `medical-skills/record-structuring/SKILL.md`
- `medical-skills/record-structuring/agents/openai.yaml`

### Desktop

- `apps/desktop/src/clinvexa/agent-prompt.ts`
- `apps/desktop/src/clinvexa/agent-prompt.test.ts`
- `apps/desktop/src/clinvexa/clinvexa-desktop.tsx`
- `apps/desktop/src/clinvexa/clinvexa-shell.test.tsx`
- `apps/desktop/src/clinvexa/sidebar/index.tsx`
- `apps/desktop/src/clinvexa/workbench/index.tsx`
- `apps/desktop/src/clinvexa/workbench/index.test.tsx`
- `apps/desktop/src/clinvexa/workbench/activity.ts`
- `apps/desktop/src/clinvexa/workbench/activity.test.ts`
- `apps/desktop/src/app/contrib/wiring.tsx`

## 4. 阶段门禁结果

| 通过标准 | 实测结果 | 判定 |
|---|---:|---|
| 200 条混合任务路由正确率不低于 95% | 200/200，100% | 通过 |
| 错误路由可由用户一键切换 | 侧边栏与工作台均可指定固定 Agent | 通过 |
| 关键字段 Precision ≥ 99% | 100% | 通过 |
| 关键字段 Recall ≥ 98% | 100% | 通过 |
| 普通字段 F1 ≥ 95% | 100% | 通过 |
| 金标严重临床错误为 0 | 0 | 通过 |
| 摘要数值和趋势与源数据一致率 100% | 50/50，100% | 通过 |
| 子 Agent 失败不导致主会话崩溃 | 失败角色可见、可重试，已完成结果保留 | 通过 |

金标为本项目自行编制的完全合成、带标签数据。严重临床错误口径至少覆盖：过敏冲突被错误消解、疑似/已排除诊断被升级为确诊、检验数值或单位被改写、用药剂量被补写。

## 5. 验证记录

| 验证项 | 结果 |
|---|---|
| CLINVEXA Python 全量测试 | 52 passed，0 failed |
| CLINVEXA Desktop UI 测试 | 20 passed，0 failed |
| TypeScript 类型检查 | 通过 |
| Ruff | `All checks passed!` |
| `record-structuring` Skill 校验 | `Skill is valid!` |
| Desktop 生产构建 | 通过，产物完整性检查通过 |
| CLINVEXA 旧工作端口语义扫描 | 0 命中 |
| 凭据模式扫描 | 0 命中 |

阶段 2 的 TDD 过程实际观察到并修复了以下回归：工作台尚未接入 Hermes 消息流、CLINVEXA 缺少中断入口、普通字段与数值趋势未建模、摘要丢失诊断确定性、门诊摘要关键词未正确路由。

## 6. 性能数据

以下为当前 Windows 开发机上的确定性本地逻辑微基准，不代表云模型或 N260 推理性能：

- 10,000 次 Agent 路由：0.0788 秒，约 126,884 次/秒。
- 1,000 份带标签合成病历结构化：0.1389 秒，约 7,199 份/秒。
- Desktop 生产构建：40.5 秒，成功。

## 7. 已知限制与遗留风险

- 当前金标是完全合成、格式受控的带标签数据，不能替代真实脱敏临床语料的医学验证。
- 自由文本、OCR、PDF 和录音的语义抽取质量仍取决于已配置模型及医疗 Skill；所有结果继续强制医生复核。
- N260 性能与稳定性、真实或模拟 HIS 流程仍属于阶段 4 最终门禁，未在本阶段声明通过。
- 当前源码目录缺少 `.git` 元数据，生产构建使用占位提交号；正式打包前必须恢复可追溯 Git checkout。
- npm 与 Vite 输出包含上游弃用警告，但本阶段类型检查、测试、构建和产物检查均未失败。

## 8. Go/No-Go 结论

阶段 2 的全部硬性通过标准均有本轮测试和独立指标复算证据，未发现阻止进入下一阶段的缺陷。

**最终结论：Go。允许进入阶段 3，开始 Skill 广场开发。**
