# CLINVEXA 阶段 1 交付报告

**阶段：** Desktop、屏幕监听与 Memory  
**日期：** 2026-08-04  
**结论：** Go

## 1. 交付功能

- 基于 Hermes Desktop 增加常驻 CLINVEXA 悬浮球、右侧任务栏和主工作台共享任务入口。
- 增加 Windows 前台窗口事件监听；仅在窗口身份变化时截图，不进行持续高帧率录屏。
- 悬浮球和侧边栏显示监听中、处理中、已暂停和失败状态；`Ctrl+Shift+L` 可全局暂停或恢复监听。
- 增加文字、语音、文件、截图和当前屏幕五类输入；不可用能力统一显示 `当前环境无该工具可调用`。
- 语音输入复用 Hermes 现有转写回调；麦克风授权失败时恢复为可用状态，不产生未处理异常。
- 患者资料、医生偏好和任务记录复用 Hermes `MemoryStore`，提供保存、查看、搜索和删除接口。
- 增加只保留最新窗口的 Python 屏幕上下文服务，不新增数据库或消息队列。
- CLINVEXA 工作端口统一为 `8001`；同时更新本地模型引导和 Memory Provider 示例，避免继续引导用户使用旧端口。

## 2. 已完成任务

- [x] 复核 Hermes pet overlay、quick-entry、主工作台、Gateway 和 Memory 扩展点。
- [x] 实现最小悬浮球和侧边栏，并复用 Hermes 视觉变量及提交链路。
- [x] 实现事件触发的前台窗口监听、截图、状态广播和暂停快捷键。
- [x] 实现 CLINVEXA Memory 保存、查看、搜索和删除能力。
- [x] 实现五类输入的明确可用/不可用状态。
- [x] 完成 200 次窗口切换、暂停、Memory、任务去重、输入、端口和构建验证。

## 3. 主要变更文件

- `apps/desktop/electron/clinvexa.ts`
- `apps/desktop/electron/clinvexa.test.ts`
- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/preload.ts`
- `apps/desktop/src/clinvexa/clinvexa-desktop.tsx`
- `apps/desktop/src/clinvexa/clinvexa-shell.test.tsx`
- `apps/desktop/src/clinvexa/floating-ball/index.tsx`
- `apps/desktop/src/clinvexa/floating-ball/overlay-root.tsx`
- `apps/desktop/src/clinvexa/sidebar/index.tsx`
- `apps/desktop/src/clinvexa/screen-monitor/state.ts`
- `apps/desktop/src/clinvexa/input-state.ts`
- `apps/desktop/src/clinvexa/task-state.ts`
- `clinvexa/src/clinvexa/memory.py`
- `clinvexa/src/clinvexa/screen.py`
- `benchmarks/n260/run_benchmark.py`

## 4. 自动化验证结果

| 验证项 | 结果 | 证据 |
|---|---:|---|
| Windows 前台窗口控制切换 | 200/200 正确 | 每次上下文延迟 40 ms，要求不超过 3 秒 |
| 暂停监听 | 通过 | 暂停调用后立即拒绝新截图，要求不超过 1 秒 |
| Hermes Memory 合成记录 | 20/20 精确命中 | 命中率 100%，并验证查看和删除 |
| 三界面任务状态 | 通过 | 同一关联 ID 从悬浮球、侧边栏、工作台提交后仅保留 1 个任务 |
| 五类输入状态 | 通过 | 文字、语音、文件、截图、当前屏幕均有明确状态 |
| Desktop 定向回归 | 34/34 通过 | 6 个测试文件，0 失败 |
| CLINVEXA Python 回归 | 43/43 通过 | 官方隔离测试脚本，6 个文件，0 失败 |
| Python 静态检查 | 通过 | Ruff `All checks passed!` |
| Desktop 类型检查 | 通过 | renderer、Electron、E2E 三套 TypeScript 配置均通过 |
| Desktop 生产构建 | 通过 | Vite 构建、Electron 主进程/预加载打包、原生依赖暂存全部成功 |
| 旧工作端口扫描 | 0 处 | CLINVEXA、benchmark、docs、Desktop 和 scripts 范围内无旧工作端口引用 |

## 5. 验收闸门

| 通过标准 | 结论 |
|---|---|
| 3 秒内更新屏幕上下文，200 次识别成功率不低于 98% | 通过：200/200，100% |
| 监听状态始终可见，暂停后 1 秒内停止新增截图 | 通过：状态组件常驻，暂停立即生效 |
| 20 组 Memory 数据检索命中率不低于 95%，支持查看、搜索、删除 | 通过：20/20，100% |
| 悬浮球、侧边栏、工作台状态同步，无重复任务或卡死 | 通过：共享存储去重测试通过 |
| 五类输入均有明确接受或不可用状态 | 通过 |
| 阶段交付报告完成并记录 Go | 通过 |

## 6. 已知限制与后续事项

- 200 次窗口切换使用受控 Windows 前台窗口事件，不代表真实 HIS 页面识别验收；真实或模拟 HIS 的 200 次综合流程仍属于阶段 4。
- 屏幕理解通过截图路径进入 Hermes 现有视觉/工具链；临床 OCR 字段精度将在阶段 2 的病历金标集验证。
- 当前源码包没有 `.git` 元数据，生产构建使用占位 commit 标记；该问题已在阶段 0 基线报告记录，不影响本阶段功能构建。
- 仓库中第三方工具说明、协议示例、测试夹具和时间/字符阈值不属于 CLINVEXA 工作端口，未进行破坏性替换。

## 7. Go / No-Go

阶段 1 的全部硬性验收标准均有自动化证据并通过，结论为 **Go**。阶段 2“多 Agent 医疗主流程”可以开始；阶段 3 和阶段 4 继续受各自前置闸门约束。
