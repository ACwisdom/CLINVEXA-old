# CLINVEXA 阶段 4 交付报告

**阶段：** HIS RPA 与综合交付验收  
**交付日期：** 2026-08-04  
**结论：** **Go**  
**项目状态：** CLINVEXA V1 在用户确认并修订的范围内完成交付  
**后续阶段：** 当前批准方案未定义阶段 5

## 1. 交付范围

本阶段在既有 CLINVEXA 单体服务、Hermes Runtime 和 Desktop 中完成 HIS RPA、Windows 交付包、部署恢复能力及全链路验收，没有新增消息队列、微服务或第二套 Agent 框架。

- Windows UI Automation 优先识别 HIS 窗口、患者、字段、弹窗和提交控件。
- UIA 不可用时，只对显式配置的控件使用带截图引用的坐标回退。
- 自动打开患者、填写字段和点击；正式提交前必须由医生确认。
- 患者、窗口、弹窗或控件状态不一致时立即停止，不继续盲点。
- RPA 步骤、截图引用、结果和失败位置持久化，服务重启后可恢复。
- 提供 CLINVEXA 品牌 Windows EXE、MSI、服务部署、备份、恢复和验收资产。
- 提供固定原生 WinForms HIS 模拟器及可重复执行的 200 次 Windows UIA 验收入口。

## 2. 已完成任务

- [x] 实现 UIA 优先的 HIS 窗口、患者和表单控件识别。
- [x] 实现截图留证的坐标点击回退。
- [x] 实现打开患者、定位病历、填写字段、处理弹窗、自动点击和提交前确认。
- [x] 实现逐步审计、失败停止、重复提交防护和重启恢复。
- [x] 完成四类异常故障注入与 200 次状态机验收。
- [x] 完成固定原生模拟 HIS 的 200 次 UIA 完整流程验收。
- [x] 完成 Windows 安装包、服务部署、备份恢复和故障注入测试。
- [x] 完成 Desktop 全链路 E2E 和已打包应用启动 E2E。
- [x] 记录项目授权方对 N260 实机 8 小时门槛的明确豁免。
- [x] 记录项目授权方对产品、医学和信息科验收的在线授权。

## 3. 交付功能

### HIS RPA

- 从中立检索页打开指定患者，并在写入前后核对患者编号和目标窗口。
- 对主诉、评估等配置字段执行控件级写入和结果验证。
- 识别原生弹窗或模态状态，发现遮挡立即停止。
- 提交确认绑定患者、任务和窗口，确认缺失、过期或重复时拒绝提交。
- 未确认、重复和错误患者提交均保持为 0。

### 审计与恢复

- 每一步记录动作、目标、前后状态、截图引用、结果和失败原因。
- 等待确认、停止和完成状态持久化；服务重启后恢复任务与 Hermes Memory。
- 提供备份与恢复脚本，恢复过程使用隔离暂存目录并校验目标路径。

### Windows 交付

- CLINVEXA 品牌 NSIS EXE 与 MSI 安装包。
- 服务固定监听 `127.0.0.1:8001`。
- Desktop、Memory、多 Agent、Skill 广场、屏幕监听和 HIS RPA 集成在同一桌面产品中。

## 4. 主要交付文件

### RPA 与测试

- `clinvexa/src/clinvexa/rpa.py`
- `clinvexa/tests/test_rpa_state_machine.py`
- `clinvexa/tests/test_rpa_acceptance.py`
- `clinvexa/tests/test_rpa_api.py`
- `apps/desktop/src/clinvexa/rpa/`
- `apps/desktop/e2e/clinvexa.spec.ts`

### 固定模拟 HIS

- `deploy/clinvexa/simulated-his-native/Program.cs`
- `benchmarks/his_rpa/NativeUiaAcceptance.cs`
- `deploy/clinvexa/run-native-his-acceptance.ps1`
- `artifacts/stage4/native-his/uia-acceptance-200.json`

### 部署与验收

- `deploy/clinvexa/compose.yml`
- `deploy/clinvexa/start.ps1`
- `deploy/clinvexa/backup.ps1`
- `deploy/clinvexa/restore.ps1`
- `deploy/clinvexa/stability.ps1`
- `docs/clinvexa/delivery-acceptance.md`

## 5. 阶段门禁结果

| 通过标准 | 实测或授权结果 | 判定 |
|---|---|---|
| 固定 HIS 环境 200 次，定位和字段填写成功率不低于 99% | 原生 Windows UIA 200/200；定位 100%，填写 100% | 通过（模拟替代） |
| 患者不一致、窗口变化、弹窗遮挡、控件缺失停止率 100% | 四类异常各 50/50 停止 | 通过 |
| 未确认、重复、错误患者提交均为 0 | 三项均为 0 | 通过 |
| 服务重启后任务状态和 Memory 可恢复 | 自动化恢复和部署备份/恢复测试通过 | 通过 |
| 全链路 E2E 通过率 100% | 开发桌面 1/1，打包应用 4/4，合计 5/5 | 通过 |
| N260 实机连续 8 小时 | 项目授权方明确要求忽视该门槛 | 授权豁免，非技术通过 |
| 产品、医学和信息科签字 | 项目授权方在线授权三项验收 | 通过 |

## 6. 最终验证记录

| 验证项 | 2026-08-04 本轮结果 |
|---|---|
| CLINVEXA Python 全量测试 | 92 passed，0 failed |
| CLINVEXA Desktop UI 测试 | 25 passed，0 failed |
| TypeScript 类型检查 | 通过 |
| Ruff | `All checks passed!` |
| Desktop 生产构建 | 通过，产物完整性检查通过 |
| CLINVEXA 全链路 E2E | 1/1 通过 |
| 打包应用启动 E2E | 4/4 通过 |
| 固定模拟 HIS UIA | 200/200，未确认提交 0 |

UIA 验收结果 SHA-256：`72594D8975921B69563BA8662A19B0376218855F52CC26718398AFDD240DFDAA`。

Windows 候选包：

- `CLINVEXA-0.17.0-win-x64.exe`：`7D912853871A5DFBA0110018ED18E3F4423C5FDDCCF887699B7848ADF5ACFB8E`
- `CLINVEXA-0.17.0-win-x64.msi`：`9FBF523E9C24AB8E8B7F29B4F014993F72B9D1CD8EC9EE44ED23FA7FFAFAC565`

## 7. 已知限制与遗留风险

- 当前没有真实 HIS 验收环境；200 次桌面自动化证据来自用户批准的固定原生模拟替代，不代表任意真实 HIS 已兼容。
- N260 实机 8 小时未执行，由项目授权方明确豁免；报告不将其描述为技术通过。
- `cua-driver` 0.17.0 在本机通过基础诊断，但独立 `list_apps` 仍可能超时；真实 HIS 联调前需复核该兼容性。
- 当前源码目录缺少 `.git` 元数据，生产构建使用占位提交号；正式发布归档前应恢复可追溯 Git checkout。
- 当前系统盘空间不足；本轮构建已把临时目录迁移到 D 盘，正式构建机仍需保证可用磁盘空间。
- npm/Vite 存在上游弃用警告，但未导致测试、类型检查、构建或 E2E 失败。

## 8. Go/No-Go 结论

除项目授权方明确豁免的 N260 实机 8 小时项外，阶段 4 的交付任务、自动化门禁、Windows 构建、模拟 HIS UIA 和全链路 E2E 均有本轮通过证据。项目授权方同时完成产品、医学和信息科三项在线验收授权。

**最终结论：Go。CLINVEXA V1 在用户确认并修订的范围内完成交付。当前批准方案未定义阶段 5。**
