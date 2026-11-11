# CLINVEXA 最终版本交付报告

交付日期：2026-08-10  
版本：0.17.0  
源码内容身份：`fcc868daeafa16c5deeb09ca88c422d9904f8910`

## 1. 唯一交付结果

| 交付物 | 唯一路径 | 核验信息 |
|---|---|---|
| 源码 A | `D:\N260 Hermes+CLINVEXA\hermes-agent-main` | 内容身份覆盖桌面端、Agent、医疗层、Skill、工具及安装脚本 |
| 软件 A | `apps\desktop\release\win-unpacked\CLINVEXA.exe` | SHA-256 `F22F87D04118519A2630D8FD14AAF4D7E65E7DF52EAD362C8EC0806CC7FD0F94` |
| 唯一安装包 | `apps\desktop\release\CLINVEXA-0.17.0-win-x64.exe` | 2,318,733,228 字节；SHA-256 `34A454696EFD5F06BACF07BF14E74AED30E0373D3D603AAB261B4231D8B54759` |
| 正式安装入口 | `%LOCALAPPDATA%\Programs\CLINVEXA\CLINVEXA.exe` | 安装资源内容身份与源码 A 完全一致 |

`apps\desktop\release` 已清理为一个 `win-unpacked` 软件 A 目录和一个安装包。旧 NSIS 包、失败安装目录、测试解包目录、备份目录和旧构建缓存均已移除。

## 2. 最终功能范围

- CLINVEXA 产品身份与简体中文默认输出，不因切换模型丢失。
- 自定义 OpenAI-compatible 文本/视觉模型端点；密钥不进入源码和安装包。
- Agent 网关、固定 `127.0.0.1:8001` 医疗服务、中文语音、Computer Use 一键启动与健康恢复。
- 27 个内置 Skill，含病历结构化、病历质控、门诊草稿、随访、宣教、证据检索和 `skill-creator`；源码集中管理并可在 Skill 广场检索调用。
- 多 Agent：主控、病历与文书、知识与患者管理、桌面与 HIS。
- 问诊记录仅在点击后录音，简体中文转写、重点标记、九字段独立草稿；交给病历 Agent 后创建左侧可见新会话再执行深度整理。
- Word/Excel/PDF/图片正确预览；Office/PDF 不再按二进制文本显示乱码。
- Computer Use/HIS RPA：窗口/控件读取、必要时截图分析、输入、结果校验；危险删除和文件外发保持限制。
- 技能与工具支持简体中文/English 介绍及“医疗/办公事务”分类。
- 悬浮球单实例、可拖动、右键退出，不重复遮挡桌面。

## 3. 依赖与升级修复

- 安装包自带 Python 3.11、锁定的 Python 依赖、Node、Playwright Chromium、faster-whisper medium 中文模型和私有 `cua-driver 0.19.2`。
- CLINVEXA 不再复用外部或旧 Hermes Python，除非开发者显式设置兼容开关。
- CUA 驱动安装到 CLINVEXA 私有运行目录，不覆盖被其他应用占用的全局驱动。
- 历史运行时缺少 CUA/中文语音资源时，只增量恢复缺失组件，不重写正在使用的 Python/Node，已验证能够在 Python 被占用时完成修复。
- 构建内容身份包含根安装脚本，源码、软件 A、安装包和正式安装目录可按同一标识核验。

## 4. 闭环测试结果

| 验证项 | 结果 |
|---|---|
| TypeScript 类型检查 | 通过 |
| ESLint（错误级） | 通过 |
| 桌面端 CLINVEXA 聚焦测试 | 27 个测试文件、120 项通过 |
| 后端产品聚焦测试 | 204 项通过、3 项按环境跳过 |
| 简体中文语音配置/转写测试 | 17 项通过 |
| 桌面运行环境测试 | 15 项通过 |
| 安装包静默安装 | 退出码 0 |
| 首次初始化与进入 Agent | 通过 |
| 升级缺失 CUA 的增量修复 | 通过；12.9 秒恢复，Python 未被覆盖 |
| 正式入口服务闭环 | `agent_gateway=ready medical_service=ready voice=ready computer_use=ready` |
| Skill 广场服务 | 8001 正常；27 个 Skill；`record-structuring`、`skill-creator` 存在 |
| 正式入口二次启动 | 通过；未新增初始化日志、未重复安装、服务保持 ready |
| 安装身份一致性 | 源码/软件/已安装资源均为 `fcc868daeafa16c5deeb09ca88c422d9904f8910` |
| 用户提供凭据扫描 | 源码 A 与软件 A 中命中数为 0；仅测试夹具保留虚构密钥样例 |

全量通用 UI 测试套件曾因运行时间超过 15 分钟终止，因此本报告只将与 CLINVEXA 交付范围直接相关、实际完成的 120 项桌面聚焦测试列为通过，不将超时套件误报为通过。

## 5. 交付边界

- 安装包不包含任何用户 API Key、医院账号或患者数据。模型最终推理测试依赖用户在设置中配置有效端点和密钥。
- 医疗输出均为草稿或辅助意见，诊断、处方、医嘱、正式病历和患者发送内容必须由医生复核。
- 当前验收安装包 `Authenticode` 状态为 `NotSigned`。医院/商业正式分发前应使用组织代码签名证书重新签名，避免 SmartScreen 未知发布者提示。
- 当前构建机的 Inno Setup 编译器显示“Non-commercial use only”；正式商业发布前需确认并满足安装器构建工具许可。
- N260 实机硬门槛此前按用户授权豁免；本地模型部署仍须按《医疗智能体平台进驻技术规格》完成型号、驱动、量化和吞吐验收。

## 6. 阶段结论

最终阶段成功标准已满足：唯一源码 A、唯一软件 A、唯一安装包已形成；安装、首次初始化、进入 Agent、服务闭环、升级修复和二次启动均已验证。正式安装后的桌面 CLINVEXA 图标是面向用户的唯一日常入口。
