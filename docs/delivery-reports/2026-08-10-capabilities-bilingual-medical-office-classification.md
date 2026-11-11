# CLINVEXA 技能与工具双语及二分类阶段交付报告

交付日期：2026-08-10

## 交付结论

本阶段已达到交付标准。改动已写入唯一源码 A，并已重建、启动唯一软件 A。

- 唯一源码 A：`D:\N260 Hermes+CLINVEXA\hermes-agent-main`
- 唯一软件 A：`D:\N260 Hermes+CLINVEXA\hermes-agent-main\apps\desktop\release\win-unpacked\CLINVEXA.exe`
- CLINVEXA 本地服务端口：`8001`

## 已交付功能

### 1. 技能与工具页面语言切换

- 在“技能与工具”页顶部增加“语言 / Language”选择器。
- 仅提供“简体中文”和“English”两个选项。
- 语言切换复用 CLINVEXA 的持久化界面语言配置，重启软件后仍保留选择。
- 切换后同步更新“技能、工具集、MCP、浏览技能中心”的页签、操作文案和功能简介。
- Skill 与工具的内部调用标识保持不变，避免中文展示影响实际调用。

### 2. 医疗与办公事务二分类

- 页面只提供“医疗”和“办公事务”两个用户分类。
- 默认展示“医疗”，并持久化用户最后选择。
- 26 个临床、病历、患者、医学知识、科研和科室业务 Skill 全部归入“医疗”。
- `skill-creator`、Excel、Word、PDF、PowerPoint 及其他通用能力归入“办公事务”。
- 工具集统一标记为“办公事务”，并提供中英文简洁功能说明。

### 3. 双语功能简介

- 为 26 个医疗 Skill 配置简体中文与英文名称和简介。
- 为 Skill 创建器、常用办公文档能力和常用工具集配置双语名称和简介。
- MCP 与技能中心的动态项目保留产品/服务专有名称，并按选择语言显示简洁用途说明。

## 验收标准与结果

| 验收项 | 成功标准 | 结果 |
| --- | --- | --- |
| 语言选项 | 页面仅显示简体中文、English | 通过 |
| 四入口切换 | 技能、工具集、MCP、技能中心静态文案随语言切换 | 通过 |
| 医疗分类 | 26 个医疗业务 Skill 全部进入“医疗” | 通过 |
| 办公分类 | Skill 创建器与通用办公能力进入“办公事务” | 通过 |
| 功能简介 | 中英文均有简洁用途说明 | 通过 |
| 调用兼容 | Skill 与工具内部标识未被翻译或改写 | 通过 |
| 源码质量 | TypeScript、Electron TypeScript、ESLint 无错误 | 通过 |
| 界面回归 | 分类切换和本地化界面测试通过 | 通过 |
| 打包完整性 | 27 个 Skill、中文语音模型、Computer Use 驱动随包存在 | 通过 |
| 运行闭环 | 最新软件 A 启动，8001 监听，Skill 服务返回 27 个已安装技能 | 通过 |

## 测试记录

- `npx vitest run src/app/skills/capability-localization.test.ts src/app/skills/index.test.tsx`
  - 2 个测试文件通过。
  - 9 项测试通过。
- 最新增量界面用例再次独立运行通过：
  - 语言选择器显示“简体中文”。
  - “技能 / 工具集 / MCP / 浏览技能中心”中文页签正常。
  - “医疗 / 办公事务”切换正确。
- `npx tsc -p . --noEmit`：通过。
- `npx tsc -p tsconfig.electron.json --noEmit`：通过。
- 变更文件 ESLint：通过。
- `npm run build`：通过。
- `node scripts/run-electron-builder.mjs --dir`：通过。
- 打包钩子验证：27 个 CLINVEXA Skill、中文语音模型和 `cua-driver` 均通过。
- 运行接口 `GET http://127.0.0.1:8001/clinvexa/skills`：返回 27 个已安装 Skill。

## 软件 A 当前状态

- 主进程由唯一软件 A 路径启动。
- CLINVEXA 服务已在 `127.0.0.1:8001` 监听。
- 不存在 `win-unpacked.bak` 旧软件回滚入口。
- 软件已保持启动，供用户直接验证本阶段界面效果。
