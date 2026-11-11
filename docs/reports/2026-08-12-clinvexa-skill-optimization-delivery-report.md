# CLINVEXA Skill 与问诊功能优化交付报告

交付日期：2026-08-12  
唯一源码 A：`D:\N260 Hermes+CLINVEXA\hermes-agent-main`  
唯一软件 A：`D:\N260 Hermes+CLINVEXA\hermes-agent-main\apps\desktop\release\win-unpacked\CLINVEXA.exe`  
本报告对应的安装包已由 0.17.1 最终交付替代；正式入口见 `docs/delivery-reports/2026-08-12-clinvexa-0.17.1-final-delivery-report.md`。

## 本阶段交付

1. 问诊记录生成的病历草稿改为可编辑文本；复制和“交给病历 Agent 深度整理”均使用医生修改后的内容。
2. 病历结构化 Skill 默认把实际分析字段动态写入原文件同目录的 Excel，不预设复杂工作表，不生成 JSON 交付文件。
3. 随访计划 Skill 补齐来源约束、患者边界、时间/方式/观察/复查/触发条件、失败处理和医生复核要求。
4. 内置 CLINVEXA Skill 增加源码摘要同步。软件升级后，已安装的内置 Skill 会从当前打包源码自动刷新；用户自行创建的 Skill 保留不覆盖。
5. 所有内置 Skill 补齐或核验失败处理，Skill 广场继续展示完整医疗办公 Skill 目录。

## 验收结果

- 医疗服务测试：107 项通过。
- CLINVEXA 桌面相关测试：15 个测试文件、46 项通过。
- 问诊草稿编辑专项：2 项通过。
- TypeScript 类型检查：通过。
- Skill 规范校验：27/27 通过。
- Skill 生命周期：27 个内置 Skill 均完成浏览、安装、加载、调用提示、禁用/启用、版本切换和卸载验证。
- 随访计划真实模型调用：通过，阿里云模型返回结构化随访草稿。
- 病历结构化真实模型调用：通过，在来源文件目录生成可打开 Excel；同名 JSON 文件数量为 0。
- 打包资源核验：27 个内置医疗 Skill、中文语音模型和 Computer Use 驱动均已包含。
- 正式安装闭环：Inno Setup 安装退出码 0，安装后源码/Skill 哈希与源码 A 一致。
- 双击启动闭环：`agent_gateway=ready`、`medical_service=ready`、`voice=ready`、`computer_use=ready`。

## 版本与校验

- `record-structuring`：1.2.0
- `followup-plan`：1.2.0
- 安装包大小：2,318,778,137 字节
- 安装包 SHA-256：`671FE8260321638997F6016E7521C51DA57C0BF2E9F74DCF557BF9EA8A1337CF`
- 软件 A SHA-256：`04FBCECF3CFEEE843DF24619B909913A675484C879804B20B8443B53168469D2`

## 交付说明

完整离线资源超过 NSIS 的超大文件内存映射能力，因此最终正式安装包采用项目内置的 Inno Setup 路径生成；中文语音、医疗服务、Skill 和 Computer Use 资源没有裁剪。失败产生的 NSIS 临时归档、旧安装包目录和回滚软件已移入 Windows 回收站，正式 `release` 目录只保留当前 `win-unpacked` 软件 A 和唯一安装包。
