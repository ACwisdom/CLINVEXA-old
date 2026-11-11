param(
    [switch]$SkipBuild
)

$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$desktopRoot = Join-Path $workspaceRoot "apps\desktop"
$cacheRoot = Join-Path (Split-Path -Parent $workspaceRoot) ".clinvexa-build-cache"
$builderConfig = Join-Path $PSScriptRoot "electron-builder.cjs"

$env:npm_config_cache = Join-Path $cacheRoot "npm"
$env:ELECTRON_CACHE = Join-Path $cacheRoot "electron"
$env:ELECTRON_BUILDER_CACHE = Join-Path $cacheRoot "electron-builder"

Push-Location $desktopRoot
try {
    if (-not $SkipBuild) {
        npm run build
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
    }

    # First build the one canonical unpacked Software A.  The complete offline
    # runtime includes the Chinese ASR model and exceeds NSIS' mmap limit, so
    # the supported single-file installer is produced with Inno Setup 6.
    npm run builder -- --dir --config $builderConfig
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    node (Join-Path $desktopRoot "scripts\build-inno-installer.mjs")
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    $releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $desktopRoot "release"))
    $version = (Get-Content -LiteralPath (Join-Path $desktopRoot "package.json") -Raw | ConvertFrom-Json).version
    $installer = Join-Path $releaseRoot "CLINVEXA-$version-win-x64.exe"
    if (-not (Test-Path -LiteralPath $installer)) {
        throw "Canonical CLINVEXA installer was not generated: $installer"
    }

    # Remove only same-version NSIS intermediates inside the verified release
    # directory. They are not supported delivery artifacts and would create a
    # second, potentially stale, software entrance.
    $obsoleteNames = @(
        "clinvexa-$version-x64.nsis.7z",
        "CLINVEXA-$version-win-x64.__uninstaller.exe",
        "CLINVEXA-$version-win-x64.msi"
    )
    foreach ($name in $obsoleteNames) {
        $candidate = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot $name))
        if (-not $candidate.StartsWith($releaseRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to clean an artifact outside the release directory: $candidate"
        }
        if (Test-Path -LiteralPath $candidate) {
            Remove-Item -LiteralPath $candidate -Force
        }
    }

    $hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
    $hashFile = Join-Path $releaseRoot "CLINVEXA-$version-SHA256.txt"
    Set-Content -LiteralPath $hashFile -Encoding ascii -Value "$hash  CLINVEXA-$version-win-x64.exe"
    Write-Host "Canonical installer: $installer"
    Write-Host "SHA256: $hash"
    exit 0
}
finally {
    Pop-Location
}
