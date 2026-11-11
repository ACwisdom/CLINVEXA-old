param(
    [Parameter(Mandatory = $true)]
    [string]$SourceDir,
    [Parameter(Mandatory = $true)]
    [string]$ArchivePath
)

$resolvedSource = (Resolve-Path -LiteralPath $SourceDir).Path
$archiveParent = Split-Path -Parent $ArchivePath
if (-not $archiveParent) {
    throw "archive parent is required"
}
New-Item -ItemType Directory -Path $archiveParent -Force | Out-Null
$resolvedArchiveParent = (Resolve-Path -LiteralPath $archiveParent).Path
$resolvedArchive = Join-Path $resolvedArchiveParent (Split-Path -Leaf $ArchivePath)

Compress-Archive -Path (Join-Path $resolvedSource "*") -DestinationPath $resolvedArchive -CompressionLevel Optimal -Force
Write-Output ("backup_archive=" + $resolvedArchive)
