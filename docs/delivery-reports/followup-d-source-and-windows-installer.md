# CLINVEXA 源码归一与 Windows 安装包交付报告

**交付日期：** 2026-08-06  
**范围：** Follow-up D  
**结论：** **Go（可安装内测版）**

## 1. 交付功能

- 将 `hermes-agent-main` 确认为唯一生效的 CLINVEXA 源码目录，启动与打包均从该目录生成。
- Windows 安装包内置当前 CLINVEXA 运行时源码，不再在首次安装时下载旧的外部通用运行时。
- 首次部署通过安装包内的 `scripts/install.ps1` 将运行时同步到用户目录，并保留后续生成的虚拟环境与依赖目录。
- 内置运行时包含医疗办公后端、病历与 RPA、Skills、中文语音转写和 CLINVEXA 身份 Prompt。
- 安装包排除 `node_modules`、`venv`、测试、旧 `release`、缓存、Git 元数据和 Desktop 开发源码。
- EXE 产品名、公司名、版权和版本统一为 CLINVEXA / 0.17.0；安装引导、版权面板和唤醒词不再显示旧产品身份。
- 仅保留当前 NSIS EXE、MSI、更新 blockmap 和当前 `win-unpacked` 验证目录；过期 `win-unpacked.bak` 已删除。

## 2. 主要变更文件

- `deploy/clinvexa/electron-builder.cjs`
- `deploy/clinvexa/runtime-bundle.json`
- `scripts/install.ps1`
- `apps/desktop/electron/main.ts`
- `apps/desktop/scripts/test-desktop.mjs`
- `apps/desktop/scripts/set-exe-identity.mjs`
- `apps/desktop/scripts/after-pack.mjs`
- `apps/desktop/package.json`
- `apps/desktop/e2e/launch-packaged-app.spec.ts`
- `apps/desktop/src/app/chat/composer/controls.tsx`
- `apps/desktop/src/app/session/hooks/use-prompt-actions/slash.ts`

## 3. 验收结果

| 验收项 | 结果 |
|---|---|
| 唯一源码目录检查 | 通过，仅 `hermes-agent-main` 为源码目录 |
| TypeScript 类型检查 | 通过 |
| Electron 打包链路专项测试 | 15/15 通过 |
| 唤醒词与快捷命令 UI 专项测试 | 109/109 通过 |
| 当前源码生产构建 | 通过，`dist` 完整性检查通过 |
| 安装包结构检查 | 通过，内置运行时 3273 个文件、61.57 MB |
| 内置运行时本地部署模拟 | 通过，repository stage 成功且关键文件完整 |
| 打包二进制 E2E | 4/4 通过 |
| 可见旧品牌完整文案扫描 | 0 个命中 |
| 端口 | `127.0.0.1:8001` 正常监听 |

## 4. 最终安装包

### NSIS EXE

- 文件：`apps/desktop/release/CLINVEXA-0.17.0-win-x64.exe`
- 大小：138,940,509 字节（132.50 MB）
- 生成时间：2026-08-06 22:31:19
- SHA-256：`E373EF91A150844FD6402C6771A0AA2E6FB181C531CE536E33890F22B3C50E6B`

### MSI

- 文件：`apps/desktop/release/CLINVEXA-0.17.0-win-x64.msi`
- 大小：150,496,008 字节（143.52 MB）
- 生成时间：2026-08-06 22:29:48
- SHA-256：`5428883C54090320007C2C11AEDD2DB82166A36988E7072528806F2681DB7D5E`

## 5. 使用与限制

- 一般用户优先使用 NSIS EXE；MSI 适合需要 MSI 部署流程的环境。
- 安装后首次启动会自动准备 Python 环境和依赖，当前不是完全离线安装，首次使用需要可访问依赖源的网络。
- 两个安装包当前均未配置 Authenticode 证书，Windows 可能显示“未知发布者”。这不阻止安装，但正式公开分发前应使用产品方代码签名证书重新签名。
- 本轮完成了打包二进制启动测试与安装包内置运行时部署模拟；尚未在一台全新第三方 Windows 设备上执行从零安装验收。

## 6. 阶段判定

Follow-up D 的源码归一、内置运行时、Windows 双安装包、打包后启动、首次运行时部署和唯一产物门槛均有本轮证据，判定 **Go（可安装内测版）**。公开分发版本仍应补充可信代码签名与全新设备安装验收。
