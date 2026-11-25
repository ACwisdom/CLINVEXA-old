# 瑞金云桌面现场验收步骤

2026-11-12（北京时间）。目标是 Windows 10 企业版 LTSC x64 Build 17763 的隔离验收账号。此次远端验收尚未执行。aDesk 会话可识别，两次画面采集超时，辅助功能只读到外层窗格。本轮安装包、模型和 OCR 的实际验证范围见 [12](12_P0_HARDENING_REPORT.md)。

## 1. 安装和冷启动

先在瑞金云桌面 PowerShell 确认系统、C 盘可用空间和映射盘。历史映射盘符仅供参考，每次连接重新确认。测试安装需由院方安排隔离账号或测试桌面，现有生产客户端由运维维护。

```powershell
Get-CimInstance Win32_OperatingSystem | Select-Object Caption, BuildNumber, OSArchitecture
Get-PSDrive -PSProvider FileSystem | Select-Object Name, Root, DisplayRoot, Used, Free
if (([IO.Path]::GetPathRoot($env:LOCALAPPDATA)) -ne 'C:\') { throw 'LocalAppData 未落在 C 盘，请由院方运维确认安装位置' }
New-Item -ItemType Directory -Path (Join-Path $env:LOCALAPPDATA 'CLINVEXA-Install') -Force | Out-Null
explorer.exe (Join-Path $env:LOCALAPPDATA 'CLINVEXA-Install')
```

从院方批准的映射盘或传输通道复制本轮完整包及 SHA256 清单到上一步打开的文件夹。用独立可信渠道收到的摘要校验清单。运行前核对 C 盘能同时容纳安装包、解包、应用文件和首次启动展开的 Python、Git、语音资源。出现磁盘不足或安全软件拦截时保留诊断信息，由院方运维处理。

```powershell
$stage = Join-Path $env:LOCALAPPDATA 'CLINVEXA-Install'
$installer = Join-Path $stage 'CLINVEXA-2.0.11-p0-hardening-vdi-win1809-x64.exe'
$actual = (Get-FileHash -LiteralPath $installer -Algorithm SHA256 -ErrorAction Stop).Hash
$expected = (Read-Host '粘贴可信交付清单中的 64 位 SHA256').Trim()
if ($expected -notmatch '^[a-fA-F0-9]{64}$' -or $expected -ne $actual) { throw 'SHA256 不一致，停止安装' }
$setupLog = Join-Path $stage 'clinvexa-p0-setup.log'
& $installer "/LOG=$setupLog"
```

首次打开前确认 8001 无监听。若有监听，只核对 PID 和进程，由其所有者处理端口。安装后可从开始菜单启动，也可用下方隔离启动命令。首次使用时点「打开合同管理」，平时从左侧栏点「合同管理」。首次展开依赖时等安装进度结束，合同页如先显示服务未响应，点「刷新」。本机打包客户端在空目录中首次引导约 3 分 39 秒，17763 的现场用时单独记录。验收前后分别记时间，确认服务由客户端自动启动。

```powershell
$listener = Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue
$listener | Select-Object LocalAddress, LocalPort, OwningProcess
if ($listener) { throw '8001 已被占用，请关闭已确认的测试客户端或由监听进程所有者处理' }
$exe = Join-Path $env:LOCALAPPDATA 'Programs\CLINVEXA\CLINVEXA.exe'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw '未找到已安装的 CLINVEXA' }
$trial = Join-Path $env:LOCALAPPDATA 'CLINVEXA-P0-Acceptance'
$runtime = Join-Path $trial 'runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$policyPath = Join-Path $runtime 'config.yaml'
if (-not (Test-Path -LiteralPath $policyPath)) {
    [IO.File]::WriteAllText($policyPath, @'
contract_preaudit:
  block: [not_reviewed, high_risk_pending, high_risk_confirmed, needs_materials, review_incomplete]
  allow_exception: false
'@, (New-Object System.Text.UTF8Encoding($false)))
}
$env:CLINVEXA_RUNTIME_HOME = $runtime
$env:HERMES_DESKTOP_USER_DATA_DIR = Join-Path $trial 'desktop'
$env:CLINVEXA_CONTRACT_DEMO = '1'
Start-Process -FilePath $exe
```

安装、冷启动、退出重启均使用普通权限。点「合同管理」后确认有「演示工作区」提示。使用以下合成 TXT。

```powershell
$trial = Join-Path $env:LOCALAPPDATA 'CLINVEXA-P0-Acceptance'
New-Item -ItemType Directory -Path $trial -Force | Out-Null
$sample = Join-Path $trial '合成服务合同.txt'
[IO.File]::WriteAllText($sample, @'
甲方：示例医院
乙方：示例服务商
合同类型：服务合同
金额方向：支出
是否确定金额：是
资金来源：合成预算
合同金额：12500元
付款：验收后支付全款。
违约：按约承担责任。
争议：双方协商处理。
'@, (New-Object System.Text.UTF8Encoding($false)))
explorer.exe $trial
```

1. 新建业务合同，输入名称「瑞金 P0 合成验收」，导入上述 TXT。确认服务合同、示例医院、示例服务商、支出、确定金额和合成预算。取消招采适用，填写「合成免招采依据」。
2. 卡片金额设为 12000，保存草稿，点「预审准入演练」。预期提示尚未预审并阻断。创建规则审查任务，展开正文金额不一致引文，核对第 7 行。再次演练，预期显示未复核高风险。
3. 对金额发现依次演练「补充材料」和「确认问题」，每次填写合成备注并保存。预期分别出现需补材料和已确认高风险。生成并保存报告，导出 CSV。核对任务号、合同版本、页段位置、状态、复核留痕及导出的 CSV。
4. 把卡片金额改为 12500，保存，重新创建规则任务，点「预审准入演练」。预期准入通过。规则模式的模型未运行提示可保留。
5. 完全退出客户端，确认原服务释放 8001，再从同一隔离路径启动。重开台账、历史任务和旧报告，核对旧报告仍显示保存时的金额与人工决定。

## 2. 院内模型联调

由院方从「开发关键信息 / 院内模型.txt」核对获准端点，再确认模型名、专用测试密钥、传输保护和合成数据权限。命令在瑞金云桌面执行。关闭规则演示客户端并等待 8001 释放。模型测试使用另一隔离目录和普通合同模式，整个操作只点「创建规则与模型审查任务」。

```powershell
$exe = Join-Path $env:LOCALAPPDATA 'Programs\CLINVEXA\CLINVEXA.exe'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw '未找到已安装的 CLINVEXA' }
if (Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue) { throw '请先退出测试客户端并确认 8001 已释放' }
$endpoint = [Uri](Read-Host '输入院方批准的模型 URL，带 /v1 或完整 /chat/completions')
if (-not $endpoint.IsAbsoluteUri -or $endpoint.Scheme -notin @('https','http') -or $endpoint.UserInfo -or $endpoint.Query -or $endpoint.Fragment) { throw '地址格式无效' }
$reachable = Test-NetConnection -ComputerName $endpoint.DnsSafeHost -Port $endpoint.Port -InformationLevel Quiet -WarningAction SilentlyContinue
[pscustomobject]@{ Transport = $endpoint.Scheme; Port = $endpoint.Port; TcpReachable = $reachable }
if (-not $reachable) { throw '云桌面到模型端口 TCP 不通' }
$env:CLINVEXA_RUNTIME_HOME = Join-Path $env:LOCALAPPDATA 'CLINVEXA-P0-Model\runtime'
$env:HERMES_DESKTOP_USER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'CLINVEXA-P0-Model\desktop'
$env:CLINVEXA_CONTRACT_DEMO = '0'
$env:CLINVEXA_CONTRACT_MODEL_URL = $endpoint.AbsoluteUri
$env:CLINVEXA_CONTRACT_MODEL_NAME = (Read-Host '输入院方批准的模型名').Trim()
$secret = Read-Host '输入试点专用模型密钥' -AsSecureString
$keyPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
    $env:CLINVEXA_CONTRACT_MODEL_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPtr)
    Start-Process -FilePath $exe
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPtr)
    Remove-Item Env:CLINVEXA_CONTRACT_MODEL_KEY -ErrorAction SilentlyContinue
}
```

导入同一合成合同并保存。创建规则与模型任务，保存报告和 CSV。记录实际模型版本、模型状态、请求耗时、合成发现及其证据。将引文与任务快照逐字核对，确认页或行位置。TCP 成功只表示端口可达。收到 401/403 时由模型服务方核查授权，收到超时、格式无效或引文校验失败时核对规则结果仍可打开。模型验收以真实完成状态和合成输出为依据，模型零发现可单独记录。

## 3. OCR 与数据保护

用 Windows PowerShell 读取 OCR 和 PDF 能力。语言包与组件是否存在只作预检，通过院方批准的引擎对扫描页实测后才能验收。

```powershell
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]::AvailableRecognizerLanguages |
    Select-Object -ExpandProperty LanguageTag
[Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType=WindowsRuntime].FullName
Get-Command tesseract.exe,pdftoppm.exe -ErrorAction SilentlyContinue | Select-Object Name
```

OCR 验收样本包括混合 PDF、无文本层 PDF、超时、识别错误、超出页数预算和异项目文件。核对原件 SHA256、1 起始 PDF 页码、引文 Unicode 偏移、OCR 待核验标签及跨项目保护。2234 先核对招标首页和中标页，再对 422 页响应件按已批准的页预算和分批方案测试。通过标注集确认项目编号、金额和相对方的准确率。正式数据试点需先完成 [14](14_HOSPITAL_DELIVERY_BLOCKERS.md) 的身份、存储、导出及审计验收。

## 4. 失败诊断与回传

```powershell
$stage = Join-Path $env:LOCALAPPDATA 'CLINVEXA-Install'
$diag = Join-Path $stage ('P0-diagnostics-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $diag -Force | Out-Null
$exe = Join-Path $env:LOCALAPPDATA 'Programs\CLINVEXA\CLINVEXA.exe'
$voiceManifest = Join-Path (Split-Path $exe -Parent) 'resources\clinvexa-dependencies\clinvexa-live-voice\manifest.json'
$appVersion = (Get-Item -LiteralPath $exe -ErrorAction SilentlyContinue).VersionInfo.ProductVersion
$health = $null
try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8001/clinvexa/health' -TimeoutSec 3 } catch {}
$httpCode = try {
    (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8001/clinvexa/contracts' -TimeoutSec 3).StatusCode
} catch {
    if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 'unreachable' }
}
@(
    (Get-Date -Format o)
    (Get-CimInstance Win32_OperatingSystem | Select-Object Caption,BuildNumber,OSArchitecture | Format-List | Out-String)
    (Get-PSDrive -Name C | Select-Object Used,Free | Format-List | Out-String)
    ('CLINVEXA version: ' + $appVersion + ' / voice manifest: ' + (Test-Path -LiteralPath $voiceManifest))
    (Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,OwningProcess | Format-Table | Out-String)
    ('Health: ' + $health.status + ' / contract capability: ' + $health.business_contracts)
    ('Unauthenticated contract HTTP: ' + $httpCode)
) | Set-Content -LiteralPath (Join-Path $diag 'status.txt') -Encoding UTF8
$logRoots = @(
    (Join-Path $env:LOCALAPPDATA 'CLINVEXA-P0-Acceptance\runtime\logs'),
    (Join-Path $env:LOCALAPPDATA 'CLINVEXA-P0-Model\runtime\logs')
)
$logNames = @('desktop.log','gui.log','errors.log')
foreach ($root in $logRoots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $trialName = Split-Path (Split-Path $root -Parent) -Parent | Split-Path -Leaf
    foreach ($logName in $logNames) {
        $log = Join-Path $root $logName
        if (Test-Path -LiteralPath $log -PathType Leaf) {
            Get-Content -LiteralPath $log -Encoding UTF8 -Tail 150 |
                Set-Content -LiteralPath (Join-Path $diag "$trialName-$logName") -Encoding UTF8
        }
    }
    $bootstrap = Get-ChildItem -LiteralPath $root -File -Filter 'bootstrap-*.log' |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($bootstrap) {
        Get-Content -LiteralPath $bootstrap.FullName -Encoding UTF8 -Tail 150 |
            Set-Content -LiteralPath (Join-Path $diag "$trialName-bootstrap.log") -Encoding UTF8
    }
}
$setupLog = Join-Path $stage 'clinvexa-p0-setup.log'
if (Test-Path -LiteralPath $setupLog) { Copy-Item -LiteralPath $setupLog -Destination $diag }
explorer.exe $diag
```

正常应为 127.0.0.1 监听、健康状态 `ok`、合同能力 `2`、裸合同请求 HTTP 401。8001 已有其他进程时核对进程、退出隔离客户端，排除冲突后重新打开。查看桌面日志中 `clinvexa-service` 的启动、退出及重试记录和 `clinvexa-voice` 的资源校验记录。回传前人工检查日志和截图，剔除认证头、密钥、内网地址、人员信息和合同内容。仅通过院方批准的通道传输审核后的诊断、合成报告、任务号和测试结果。SQLite、临时文件、合同原件、配置文件和未审查的日志保留在院内。

## 本轮远程部署尝试记录（2026-11-12）

用户明确授权部署生产。aDesk RemoteApp 窗口进程可见，窗口标题「独享桌面 - [院外厂商-202209]」。激活窗口后两次 `get_window_state` 画面采集均返回 `window capture timed out: timed out waiting on channel`；中间重新枚举窗口仍只返回同一窗口，重试后错误不变。远程 OS、远端 C 盘空间、已安装版本和应用控制策略均未能读取。本次没有传输或运行安装包，也未接触真实合同、审批、远端数据库或配置。

本机准备交付的完整安装包位于开发机 `D:\C\CLINVEXA-source-2.0.10\handoff\p0-hardening\CLINVEXA-2.0.11-p0-hardening-vdi-win1809-x64.exe`，大小 3,795,022,682 字节，SHA256 `30BE279EB77B8B28CD4FAAEF4E1CA9EFBEAA451862DFA0F6BB9C0DB40D16FFE6`，Authenticode 为 `NotSigned`。开发机 C 盘剩余 18.07 GiB，仅为本机观测，不得代替远端容量检查。由于签名及云桌面控制通道均未确认，本轮部署状态为未完成；现场验收须由院方人员在可操作的隔离桌面继续，完整步骤和命令见本文件前文。

## 云桌面传输与校验（仅暂存，不自动安装）

本段可在获准的瑞金云桌面 PowerShell 中整段粘贴。先通过院方批准的 aDesk 文件传输功能把完整 EXE 放入云桌面 `Downloads`，或令本地映射盘能访问 `D:\C\CLINVEXA-source-2.0.10\handoff\p0-hardening`。脚本会自动检查 Downloads 及映射盘的常见路径，固定核对本次 SHA256，在 C 盘 `%LOCALAPPDATA%\CLINVEXA-Install-P0-20261112` 暂存并复核；若源文件找不到、C 盘余量不足、摘要不符或目标已存在不同文件则停止。它不会启动安装器。

```powershell
$ErrorActionPreference = 'Stop'
$expected = '30BE279EB77B8B28CD4FAAEF4E1CA9EFBEAA451862DFA0F6BB9C0DB40D16FFE6'
$name = 'CLINVEXA-2.0.11-p0-hardening-vdi-win1809-x64.exe'
$suffixes = @("C\CLINVEXA-source-2.0.10\handoff\p0-hardening\$name", "CLINVEXA-source-2.0.10\handoff\p0-hardening\$name")
$candidates = @((Join-Path $env:USERPROFILE "Downloads\$name"))
foreach ($drive in Get-PSDrive -PSProvider FileSystem) { foreach ($suffix in $suffixes) { $candidates += Join-Path $drive.Root $suffix } }
$source = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $source) { Get-PSDrive -PSProvider FileSystem | Select-Object Name,Root,DisplayRoot; throw '找不到安装包。请先用院方批准的 aDesk 文件传输将 EXE 放入 Downloads 或可访问的映射盘，再完整重试本段。' }
$sourceItem = Get-Item -LiteralPath $source
$sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
if ($sourceHash -ne $expected) { throw "源文件 SHA256 不符，已停止：$sourceHash" }
$stage = Join-Path $env:LOCALAPPDATA 'CLINVEXA-Install-P0-20261112'
if ([IO.Path]::GetPathRoot($stage) -ne 'C:\') { throw "暂存目录不在 C 盘，已停止：$stage" }
$free = [IO.DriveInfo]::new('C:\').AvailableFreeSpace
$required = [int64]$sourceItem.Length + 10GB
if ($free -lt $required) { throw "C 盘空间不足；当前可用 $([math]::Round($free/1GB,2)) GiB，暂存和安装前需至少预留 $([math]::Round($required/1GB,2)) GiB。" }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
$destination = Join-Path $stage $name
if (Test-Path -LiteralPath $destination -PathType Leaf) { if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $expected) { throw "目标已有不同文件，拒绝覆盖：$destination" } } else { Copy-Item -LiteralPath $source -Destination $destination }
$finalHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
if ($finalHash -ne $expected) { throw "暂存后 SHA256 不符：$finalHash" }
[pscustomobject]@{Source=$source;Destination=$destination;Bytes=(Get-Item -LiteralPath $destination).Length;SHA256=$finalHash;Signature=(Get-AuthenticodeSignature -LiteralPath $destination).Status;CFreeGiB=[math]::Round(([IO.DriveInfo]::new('C:\').AvailableFreeSpace)/1GB,2);Action='已暂存并校验，未安装'} | Format-List
```

当前包未签名。此命令只负责传输暂存和校验；不得绕过瑞金桌面应用控制。院方确认签名或应用控制放行后，再由授权现场人员依本文件第 1 节安装并记录日志。
