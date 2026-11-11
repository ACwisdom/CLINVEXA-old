param(
    [Parameter(Mandatory = $true)]
    [string]$ArchivePath,
    [Parameter(Mandatory = $true)]
    [string]$TargetDir
)

$resolvedArchive = (Resolve-Path -LiteralPath $ArchivePath).Path
New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
$resolvedTarget = (Resolve-Path -LiteralPath $TargetDir).Path
$staging = Join-Path $resolvedTarget (".clinvexa-restore-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $staging | Out-Null
$resolvedStaging = (Resolve-Path -LiteralPath $staging).Path

if (-not $resolvedStaging.StartsWith($resolvedTarget + [IO.Path]::DirectorySeparatorChar)) {
    throw "restore staging escaped target directory"
}

try {
    Expand-Archive -LiteralPath $resolvedArchive -DestinationPath $resolvedStaging
    Copy-Item -Path (Join-Path $resolvedStaging "*") -Destination $resolvedTarget -Recurse -Force
} finally {
    if (Test-Path -LiteralPath $resolvedStaging) {
        Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
    }
}

Write-Output ("restore_target=" + $resolvedTarget)
