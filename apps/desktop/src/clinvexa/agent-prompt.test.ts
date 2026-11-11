import { describe, expect, it } from 'vitest'

import { buildCLINVEXAAgentPrompt, routeCLINVEXATask } from './agent-prompt'

describe('CLINVEXA Hermes Agent prompt', () => {
  it.each([
    ['结构化这份门诊病历', 'medical_record'],
    ['生成患者随访草稿', 'knowledge_patient'],
    ['分析当前屏幕并打开HIS', 'desktop_his'],
    ['打开计算器', 'desktop_his'],
    ['查看今日办公任务', 'orchestrator']
  ] as const)('routes %s to %s', (input, expected) => {
    expect(routeCLINVEXATask(input)).toBe(expected)
  })

  it('requires the main Agent to use native Hermes delegation and preserve the doctor task', () => {
    const prompt = buildCLINVEXAAgentPrompt('生成病历草稿', 'medical_record')

    expect(prompt).toContain('delegate_task')
    expect(prompt).toContain('medical_record')
    expect(prompt).toContain('生成病历草稿')
    expect(prompt).toContain('医生复核')
    expect(prompt).toContain('不得虚构工具结果')
    expect(prompt).toContain('无论位于哪个磁盘')
    expect(prompt).toContain('不得要求用户先复制到 CLINVEXA 工作区')
  })

  it('requires real and verified computer use for visible HIS tasks', () => {
    const prompt = buildCLINVEXAAgentPrompt('填写当前打开的模拟 HIS', 'desktop_his')

    expect(prompt).not.toContain('必须使用 CLINVEXA 原生 delegate_task')
    expect(prompt).toContain('禁止二次 delegate_task')
    expect(prompt).toContain('必须调用 computer_use')
    expect(prompt).toContain('不得用 browser_*')
    expect(prompt).toContain('当前环境无 computer_use 可调用，未执行任何页面操作')
    expect(prompt).toContain("delivery_mode='foreground'")
    expect(prompt).toContain('bring_to_front=true')
    expect(prompt).toContain('unverifiable 只表示点击落地未被证明')
    expect(prompt).toContain('不得向用户索要‘继续’指令')
    expect(prompt).toContain('草稿已保存')
    expect(prompt).toContain('AX capture 建立基线')
    expect(prompt).toContain('原文证据→HIS字段→拟填值')
    expect(prompt).toContain('优先使用 AX 属性回读')
    expect(prompt).toContain('同一步骤最多进行两次内部恢复')
    expect(prompt).toContain('禁止停下来要求用户再次发送“继续”')
    expect(prompt).toContain('常规六字段任务目标 3 分钟内完成')
    expect(prompt).toContain('患者不一致')
    expect(prompt).toContain('不得每字段都做视觉截图')
  })

  it('uses the generic app-launch fast path and stops once the window is verified', () => {
    const prompt = buildCLINVEXAAgentPrompt('打开桌面的任意办公软件', 'desktop_his')

    expect(prompt).toContain('先 list_apps')
    expect(prompt).toContain('launch_app(app=目标软件)')
    expect(prompt).toContain('随后一次 AX capture')
    expect(prompt).toContain('最多尝试两次')
    expect(prompt).toContain('不得为此使用 SOM/视觉截图')
    expect(prompt).toContain('不得继续操作软件内部功能')
  })
})
