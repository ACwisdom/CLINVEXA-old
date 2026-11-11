param(
    [string]$VerifiedRuntime = "$env:LOCALAPPDATA\Temp\clinvexa-install-verification-u6KVfY\runtime",
    [string]$Output = (Join-Path (Split-Path $PSScriptRoot -Parent) "assets\offline\windows-x64.tar.gz"),
    [string]$RuntimeExtrasOutput = (Join-Path (Split-Path $PSScriptRoot -Parent) "assets\offline\clinvexa-runtime-extras.tar")
)

$ErrorActionPreference = "Stop"
$sourceRoot = Join-Path $VerifiedRuntime "hermes-agent"
$uvBin = Join-Path $VerifiedRuntime "bin"
$python = Join-Path $env:APPDATA "uv\python"
$uvCache = Join-Path $env:LOCALAPPDATA "uv\cache"
$node = Join-Path $env:ProgramFiles "nodejs"
$nodeModules = Join-Path $sourceRoot "node_modules"
$playwright = Join-Path $env:LOCALAPPDATA "ms-playwright"
$sttModels = Join-Path $VerifiedRuntime "models\faster-whisper"
$cuaDriver = (Get-Command cua-driver.exe -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1).Source
if (-not $cuaDriver) {
    $cuaDriver = Join-Path $env:LOCALAPPDATA "Programs\Cua\cua-driver\bin\cua-driver.exe"
}

foreach ($required in @($uvBin, $python, $uvCache, $node, $nodeModules, $playwright, $sttModels, $cuaDriver)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Required offline dependency source is missing: $required"
    }
}

$rg = (Get-Command rg.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$ffmpeg = (Get-Command ffmpeg.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$ffprobe = Join-Path (Split-Path $ffmpeg -Parent) "ffprobe.exe"
if (-not (Test-Path -LiteralPath $ffprobe)) { throw "ffprobe.exe was not found next to ffmpeg.exe" }

$tempRoot = Join-Path $env:TEMP ("clinvexa-offline-deps-" + [Guid]::NewGuid().ToString("N"))
$tempBin = Join-Path $tempRoot "bin"
$sttWheelhouse = Join-Path $tempRoot "voice-wheelhouse"
New-Item -ItemType Directory -Path $tempBin -Force | Out-Null
New-Item -ItemType Directory -Path $sttWheelhouse -Force | Out-Null
Copy-Item -Path (Join-Path $uvBin "*") -Destination $tempBin -Force
Copy-Item -LiteralPath $rg -Destination (Join-Path $tempBin "rg.exe") -Force
Copy-Item -LiteralPath $ffmpeg -Destination (Join-Path $tempBin "ffmpeg.exe") -Force
Copy-Item -LiteralPath $ffprobe -Destination (Join-Path $tempBin "ffprobe.exe") -Force
$tempCuaDriver = Join-Path $tempRoot "cua-driver\bin"
New-Item -ItemType Directory -Path $tempCuaDriver -Force | Out-Null
Copy-Item -LiteralPath $cuaDriver -Destination (Join-Path $tempCuaDriver "cua-driver.exe") -Force

$outputDirectory = Split-Path $Output -Parent
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output -Force }
if (Test-Path -LiteralPath $RuntimeExtrasOutput) { Remove-Item -LiteralPath $RuntimeExtrasOutput -Force }

$tar = (Get-Command tar.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$pipCommand = Get-Command pip.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
$pipPython = Join-Path (Split-Path $pipCommand.Source -Parent) "..\python.exe"
if (-not (Test-Path -LiteralPath $pipPython)) { throw "A build-time Python with pip is required: $pipPython" }
$exclude = @(
    "--exclude=node_modules/hermes-tui",
    "--exclude=node_modules/web",
    "--exclude=node_modules/@hermes/bootstrap-installer",
    "--exclude=node_modules/@hermes/ink",
    "--exclude=node_modules/@hermes/root-tests",
    "--exclude=node_modules/@hermes/shared"
)

try {
    # Keep Chinese STT installation deterministic on a brand-new offline PC.
    # The uv cache is an implementation detail and may not retain wheels for
    # packages already installed in the release workstation's venv.  Ship an
    # explicit wheelhouse instead and make install.ps1 consume it directly.
    & $pipPython -m pip download --only-binary=:all: --platform win_amd64 `
        --python-version 311 --implementation cp --abi cp311 --dest $sttWheelhouse `
        "faster-whisper==1.2.1" "sounddevice==0.5.5" "numpy==2.4.3"
    if ($LASTEXITCODE -ne 0) { throw "CLINVEXA voice wheelhouse download failed (exit $LASTEXITCODE)" }

    # Broken/stale Windows workspace junctions can make bsdtar return an error
    # even when they are excluded.  Remove only these generated links from the
    # staging source; install.ps1 recreates valid links after extraction.
    foreach ($workspaceLink in @(
        "hermes-tui", "web", "@hermes\bootstrap-installer", "@hermes\ink", `
        "@hermes\root-tests", "@hermes\shared"
    )) {
        $linkPath = Join-Path $nodeModules $workspaceLink
        if (Test-Path -LiteralPath $linkPath) {
            Remove-Item -LiteralPath $linkPath -Force -Recurse -ErrorAction SilentlyContinue
        }
    }

    & $tar -czf $Output @exclude `
        -C $tempRoot bin `
        -C $tempRoot voice-wheelhouse `
        -C (Split-Path $python -Parent) (Split-Path $python -Leaf) `
        -C (Split-Path $uvCache -Parent) (Split-Path $uvCache -Leaf) `
        -C (Split-Path $node -Parent) (Split-Path $node -Leaf) `
        -C $sourceRoot node_modules `
        -C (Split-Path $playwright -Parent) (Split-Path $playwright -Leaf)
    if ($LASTEXITCODE -ne 0) { throw "tar.exe failed with exit code $LASTEXITCODE" }
    if (-not (Test-Path -LiteralPath $Output) -or (Get-Item -LiteralPath $Output).Length -eq 0) {
        throw "CLINVEXA offline dependency archive is empty"
    }

    # Keep the large pre-trained voice model in an uncompressed companion tar.
    # It contains only a few already-dense model files, so gzip saves little
    # while adding many minutes to every release build.
    & $tar -cf $RuntimeExtrasOutput `
        -C $tempRoot cua-driver `
        -C (Split-Path $sttModels -Parent) (Split-Path $sttModels -Leaf)
    if ($LASTEXITCODE -ne 0) { throw "runtime extras tar.exe failed with exit code $LASTEXITCODE" }
} finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}

$file = Get-Item -LiteralPath $Output
$hash = (Get-FileHash -LiteralPath $Output -Algorithm SHA256).Hash
Write-Host "Created: $($file.FullName)"
Write-Host ("Size: {0:N1} MB" -f ($file.Length / 1MB))
Write-Host "SHA256: $hash"
$extrasFile = Get-Item -LiteralPath $RuntimeExtrasOutput
$extrasHash = (Get-FileHash -LiteralPath $RuntimeExtrasOutput -Algorithm SHA256).Hash
Write-Host "Created: $($extrasFile.FullName)"
Write-Host ("Size: {0:N1} MB" -f ($extrasFile.Length / 1MB))
Write-Host "SHA256: $extrasHash"
