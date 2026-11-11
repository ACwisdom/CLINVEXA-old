param(
    [ValidateRange(1, 10000)]
    [int]$Iterations = 200,
    [string]$OutputPath = "artifacts/stage4/native-his/uia-acceptance-200.json"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$artifactDirectory = Join-Path $repositoryRoot "artifacts/stage4/native-his"
$buildTempDirectory = Join-Path $repositoryRoot ".runtime/tmp/native-his-build"
$simulatorSource = Join-Path $PSScriptRoot "simulated-his-native/Program.cs"
$acceptanceSource = Join-Path $repositoryRoot "benchmarks/his_rpa/NativeUiaAcceptance.cs"
$simulator = Join-Path $artifactDirectory "CLINVEXASimulatedHis.exe"
$acceptance = Join-Path $artifactDirectory "NativeUiaAcceptance.exe"
$windowsDirectory = Split-Path -Parent ([System.Environment]::SystemDirectory)
$compiler = Join-Path $windowsDirectory "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
$uiaClient = Join-Path $windowsDirectory "Microsoft.NET/assembly/GAC_MSIL/UIAutomationClient/v4.0_4.0.0.0__31bf3856ad364e35/UIAutomationClient.dll"
$uiaTypes = Join-Path $windowsDirectory "Microsoft.NET/assembly/GAC_MSIL/UIAutomationTypes/v4.0_4.0.0.0__31bf3856ad364e35/UIAutomationTypes.dll"

foreach ($requiredPath in @($compiler, $simulatorSource, $acceptanceSource, $uiaClient, $uiaTypes)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "required Windows UIA build input not found: $requiredPath"
    }
}

New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $buildTempDirectory -Force | Out-Null
$env:TEMP = $buildTempDirectory
$env:TMP = $buildTempDirectory

$quotedSimulatorSource = '"' + $simulatorSource + '"'
$simulatorOutput = '/out:"' + $simulator + '"'
& $compiler /nologo /target:winexe $simulatorOutput /r:System.Windows.Forms.dll /r:System.Drawing.dll $quotedSimulatorSource
if ($LASTEXITCODE -ne 0) {
    throw "simulated HIS compilation failed: $LASTEXITCODE"
}

$quotedAcceptanceSource = '"' + $acceptanceSource + '"'
$acceptanceOutput = '/out:"' + $acceptance + '"'
$uiaClientReference = '/r:"' + $uiaClient + '"'
$uiaTypesReference = '/r:"' + $uiaTypes + '"'
& $compiler /nologo /target:exe $acceptanceOutput $uiaClientReference $uiaTypesReference $quotedAcceptanceSource
if ($LASTEXITCODE -ne 0) {
    throw "UIA acceptance runner compilation failed: $LASTEXITCODE"
}

$resolvedOutput = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath
} else {
    Join-Path $repositoryRoot $OutputPath
}
$resolvedOutputDirectory = Split-Path -Parent $resolvedOutput
New-Item -ItemType Directory -Path $resolvedOutputDirectory -Force | Out-Null

& $acceptance $simulator $Iterations $resolvedOutput
if ($LASTEXITCODE -ne 0) {
    throw "native HIS UIA acceptance failed: $LASTEXITCODE"
}

[ordered]@{
    acceptance_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedOutput).Hash
    evidence = $resolvedOutput
    iterations = $Iterations
    simulator_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $simulator).Hash
} | ConvertTo-Json -Compress
