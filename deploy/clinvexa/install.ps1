param(
    [Parameter(Mandatory = $true)]
    [string]$PythonPath,
    [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
)

$resolvedRoot = (Resolve-Path -LiteralPath $WorkspaceRoot).Path
$CLINVEXAPackage = Join-Path $resolvedRoot "clinvexa"
$desktopRoot = Join-Path $resolvedRoot "apps\desktop"

if (-not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) {
    throw "python executable not found: $PythonPath"
}
if (-not (Test-Path -LiteralPath $CLINVEXAPackage -PathType Container)) {
    throw "clinvexa package not found: $CLINVEXAPackage"
}

& $PythonPath -m pip install $CLINVEXAPackage
if ($LASTEXITCODE -ne 0) {
    throw "clinvexa python installation failed"
}

Push-Location $desktopRoot
try {
    npm run dist:win
    if ($LASTEXITCODE -ne 0) {
        throw "clinvexa desktop packaging failed"
    }
} finally {
    Pop-Location
}
