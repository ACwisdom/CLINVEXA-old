param(
    [Parameter(Mandatory = $true)]
    [string]$PythonPath,
    [Parameter(Mandatory = $true)]
    [string]$RpaConfigPath
)

$resolvedPython = (Resolve-Path -LiteralPath $PythonPath).Path
$resolvedConfig = (Resolve-Path -LiteralPath $RpaConfigPath).Path
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$clinvexaSrc = Join-Path $projectRoot "clinvexa\src"
$env:CLINVEXA_RPA_CONFIG = $resolvedConfig
$env:PYTHONPATH = ($clinvexaSrc, $projectRoot, $env:PYTHONPATH | Where-Object { $_ }) -join [System.IO.Path]::PathSeparator

$process = Start-Process -FilePath $resolvedPython -ArgumentList "-m", "clinvexa.main" -WorkingDirectory $projectRoot -PassThru -WindowStyle Hidden
Write-Output ("clinvexa_pid=" + $process.Id)
Write-Output "clinvexa_url=http://127.0.0.1:8001"
