import { spawn } from 'node:child_process'

import type { CopilotFillResult } from '../src/clinvexa/copilot/types'

export interface QuickFillRequest {
  windowId: string
  title: string
  patientId: string
  encounterId: string
  fields: { label: string; text: string }[]
}

export interface FocusedFillRequest {
  windowId: string
  text: string
  label: string
}

// Structured stdin, never string interpolation of patient text into shell code.
// UI Automation ValuePattern only: no mouse exploration, Enter, save or submit.
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$request = [Console]::In.ReadLine() | ConvertFrom-Json
$results = [Collections.Generic.List[object]]::new()
try {
  $root = [Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$request.windowId)
  if ($null -eq $root) { throw '刚刚点击的目标窗口已关闭，请重新点击输入框' }
  $all = $root.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
  $visible = @($all | Where-Object { -not $_.Current.IsOffscreen -and -not $_.Current.IsPassword })
  function Assert-Patient {
    foreach ($identity in @($request.patientId, $request.encounterId)) {
      if ($identity) {
        $found = @($visible | Where-Object { $_.Current.Name.Contains([string]$identity) })
        if ($found.Count -eq 0) { throw '当前页面无法核对患者和就诊标识，请复制后手动粘贴' }
      }
    }
  }
  function Is-Editable($element) {
    return $element.Current.ControlType -eq [Windows.Automation.ControlType]::Edit -or
      $element.Current.ControlType -eq [Windows.Automation.ControlType]::ComboBox
  }
  function Matches-FieldName($name, $label) {
    $value = ([string]$name).Trim()
    return $value -eq $label -or $value.StartsWith([string]$label)
  }
  Assert-Patient
  $prepared = [Collections.Generic.List[object]]::new()
  foreach ($field in $request.fields) {
    $matches = @($visible | Where-Object {
      $name = ([string]$_.Current.Name).Trim()
      $labelName = if ($_.Current.LabeledBy) { ([string]$_.Current.LabeledBy.Current.Name).Trim() } else { '' }
      (Matches-FieldName $name $field.label) -or (Matches-FieldName $labelName $field.label)
    } | Where-Object { Is-Editable $_ })
    if ($matches.Count -eq 0) {
      $labelElements = @($visible | Where-Object {
        -not (Is-Editable $_) -and (Matches-FieldName $_.Current.Name $field.label)
      })
      $nearby = [Collections.Generic.List[object]]::new()
      foreach ($labelElement in $labelElements) {
        $labelRect = $labelElement.Current.BoundingRectangle
        if ($labelRect.IsEmpty) { continue }
        foreach ($candidate in @($visible | Where-Object { Is-Editable $_ })) {
          $rect = $candidate.Current.BoundingRectangle
          $horizontalOverlap = $rect.Right -ge $labelRect.Left -and $rect.Left -le $labelRect.Right
          $verticalDistance = $rect.Top - $labelRect.Bottom
          if (-not $rect.IsEmpty -and $horizontalOverlap -and $verticalDistance -ge -8 -and $verticalDistance -le 150) {
            $nearby.Add(@{ element=$candidate; score=[Math]::Abs($verticalDistance) + [Math]::Abs($rect.Left - $labelRect.Left) * 0.05 })
          }
        }
      }
      $ordered = @($nearby | Sort-Object score)
      if ($ordered.Count -gt 0) { $matches = @($ordered[0].element) }
    }
    if ($matches.Count -ne 1) { throw ('无法唯一定位字段：' + $field.label) }
    $element = $matches[0]
    $pattern = $null
    if (-not $element.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$pattern) -or $pattern.Current.IsReadOnly) {
      throw ('字段不支持直接填写：' + $field.label)
    }
    $prepared.Add(@{ element=$element; pattern=$pattern; field=$field; before=$pattern.Current.Value })
  }
  foreach ($item in $prepared) {
    Assert-Patient
    if ($item.element.Current.IsOffscreen -or $item.pattern.Current.Value -ne $item.before) {
      throw '页面或字段内容已经改变，已停止填写'
    }
    $item.pattern.SetValue([string]$item.field.text)
    $readDeadline = [DateTime]::UtcNow.AddMilliseconds(700)
    while ($item.pattern.Current.Value -ne $item.field.text -and [DateTime]::UtcNow -lt $readDeadline) {
      Start-Sleep -Milliseconds 35
    }
    if ($item.pattern.Current.Value -ne $item.field.text) { throw ('字段回读不一致：' + $item.field.label) }
    $results.Add(@{ label=$item.field.label; status='filled' })
  }
  @{ status='filled'; message='已填写并回读核对。请在原系统确认，尚未提交。'; fields=@($results.ToArray()) } | ConvertTo-Json -Depth 5 -Compress
} catch {
  @{ status='failed'; message=$_.Exception.Message; fields=@($results.ToArray()) } | ConvertTo-Json -Depth 5 -Compress
}
`

// The clinician explicitly chooses the destination by clicking an input first.
// Reactivate only that captured window, replace the focused field, and never send Enter.
const FOCUSED_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadLine() | ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CLINVEXAFocusedInput {
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion U; }
  // INPUT's native union is 32 bytes on x64. Declaring the explicit size keeps
  // Marshal.SizeOf(INPUT) equal to Win32's expected 40 bytes; otherwise
  // SendInput rejects every keystroke with ERROR_INVALID_PARAMETER.
  [StructLayout(LayoutKind.Explicit, Size=32)] public struct InputUnion { [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  const uint KEYEVENTF_KEYUP = 0x0002, KEYEVENTF_UNICODE = 0x0004;
  static INPUT Key(ushort vk, ushort scan, uint flags) { return new INPUT { type=1, U=new InputUnion { ki=new KEYBDINPUT { wVk=vk, wScan=scan, dwFlags=flags } } }; }
  public static bool ReplaceFocusedText(string text) {
    var select = new[] { Key(0x11,0,0), Key(0x41,0,0), Key(0x41,0,KEYEVENTF_KEYUP), Key(0x11,0,KEYEVENTF_KEYUP) };
    if (SendInput((uint)select.Length, select, Marshal.SizeOf(typeof(INPUT))) != select.Length) return false;
    foreach (char value in text) {
      var pair = new[] { Key(0,value,KEYEVENTF_UNICODE), Key(0,value,KEYEVENTF_UNICODE|KEYEVENTF_KEYUP) };
      if (SendInput(2, pair, Marshal.SizeOf(typeof(INPUT))) != 2) return false;
    }
    return true;
  }
}
'@
try {
  $handle = [IntPtr][long]$request.windowId
  if (-not [CLINVEXAFocusedInput]::IsWindow($handle)) { throw '刚刚点击的目标窗口已关闭，请重新点击输入框' }
  [CLINVEXAFocusedInput]::ShowWindow($handle, 9) | Out-Null
  [CLINVEXAFocusedInput]::SetForegroundWindow($handle) | Out-Null
  $deadline = [DateTime]::UtcNow.AddMilliseconds(900)
  while ([CLINVEXAFocusedInput]::GetForegroundWindow() -ne $handle -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 35 }
  if ([CLINVEXAFocusedInput]::GetForegroundWindow() -ne $handle) { throw '无法返回刚刚点击的系统窗口，请再次点击目标输入框' }
  Start-Sleep -Milliseconds 100
  if (-not [CLINVEXAFocusedInput]::ReplaceFocusedText([string]$request.text)) { throw '系统未接受本次键盘输入' }
  @{ status='filled'; message='已输入到刚刚点击的字段。请在原系统核对，尚未保存或提交。'; fields=@(@{ label=$request.label; status='filled' }) } | ConvertTo-Json -Depth 5 -Compress
} catch {
  @{ status='failed'; message=$_.Exception.Message; fields=@() } | ConvertTo-Json -Depth 5 -Compress
}
`

function runPowerShellFill(script: string, request: object, timeoutMessage: string): Promise<CopilotFillResult> {
  return new Promise(resolve => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
    let stdout = ''
    let finished = false

    const finish = (value: CopilotFillResult) => {
      if (finished) {return}
      finished = true
      clearTimeout(timer)
      resolve(value)
    }

    const timer = setTimeout(() => {
      child.kill()
      finish({ status: 'failed', message: timeoutMessage, fields: [] })
    }, 10_000)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {stdout += chunk})
    child.stderr.on('data', () => {})
    child.on('error', () => finish({ status: 'failed', message: '本地快捷填写暂不可用，请复制后粘贴', fields: [] }))
    child.on('close', () => {
      try {finish(JSON.parse(stdout.trim()))}
      catch {finish({ status: 'failed', message: '未收到填写结果，请检查原页面后使用复制', fields: [] })}
    })
    child.stdin.on('error', () => {})
    child.stdin.end(`${JSON.stringify(request)}\n`)
  })
}

export function runCLINVEXAFocusedFill(request: FocusedFillRequest, platform = process.platform): Promise<CopilotFillResult> {
  if (platform !== 'win32') {return Promise.resolve({ status:'failed', message:'当前系统请使用复制粘贴', fields:[] })}

  if (!/^\d+$/.test(request.windowId) || !request.text || request.text.length > 5000) {
    return Promise.resolve({ status:'failed', message:'快捷填写内容无效，请复制后粘贴', fields:[] })
  }

  return runPowerShellFill(FOCUSED_SCRIPT, request, '填写已到 10 秒上限，请检查原页面后使用复制')
}

export function runCLINVEXAQuickFill(request: QuickFillRequest, platform = process.platform): Promise<CopilotFillResult> {
  if (platform !== 'win32') {return Promise.resolve({ status: 'failed', message: '当前系统请使用复制粘贴', fields: [] })}

  if (!/^\d+$/.test(request.windowId) || request.fields.length < 1 || request.fields.length > 5
      || request.fields.some(field => !field.label || !field.text || field.text.length > 5000)
      || new Set(request.fields.map(field => field.label)).size !== request.fields.length) {
    return Promise.resolve({ status: 'failed', message: '请最多选择 5 个具有不同明确目标的字段；检查搜索框请逐项填入', fields: [] })
  }

  return runPowerShellFill(SCRIPT, request, '填写已到 10 秒上限。请检查原页面是否部分写入，再使用复制。')
}
