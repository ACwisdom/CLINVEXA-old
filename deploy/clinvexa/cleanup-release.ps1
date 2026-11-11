param(
    [Parameter(Mandatory = $true)]
    [string]$Version
)

$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $workspaceRoot "apps\desktop\release"))
$obsoleteNames = @(
    "clinvexa-$Version-x64.nsis.7z",
    "CLINVEXA-$Version-win-x64.__uninstaller.exe",
    "CLINVEXA-$Version-win-x64.msi"
)

foreach ($name in $obsoleteNames) {
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot $name))
    if (-not $candidate.StartsWith($releaseRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean an artifact outside the release directory: $candidate"
    }
    if (Test-Path -LiteralPath $candidate) {
        Remove-Item -LiteralPath $candidate -Force
        Write-Host "Removed obsolete release artifact: $candidate"
    }
}
