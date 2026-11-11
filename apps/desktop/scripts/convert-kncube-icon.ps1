param([Parameter(Mandatory=$true)][string]$SourceImage)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assets = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\assets'))
$brand = Join-Path $assets 'brand'
[IO.Directory]::CreateDirectory($brand) | Out-Null
Copy-Item -LiteralPath $SourceImage -Destination (Join-Path $brand 'kncube-source.png') -Force
$source = [Drawing.Image]::FromFile($SourceImage)
try {
    # Exact supplied artwork: format conversion and proportional scaling only.
    # Preserve the supplied artwork and its alpha channel.
    $source.Save((Join-Path $brand 'kncube-source.jpg'),[Drawing.Imaging.ImageFormat]::Jpeg)
    function New-IconBitmap([int]$size) {
        $bitmap = New-Object Drawing.Bitmap($size,$size)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([Drawing.Color]::Transparent)
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $ratio = [Math]::Min($size / $source.Width, $size / $source.Height)
            $width = [int]($source.Width * $ratio)
            $height = [int]($source.Height * $ratio)
            $graphics.DrawImage($source,[int](($size-$width)/2),[int](($size-$height)/2),$width,$height)
        } finally { $graphics.Dispose() }
        return $bitmap
    }
    $large = New-IconBitmap 1024
    try { $large.Save((Join-Path $assets 'icon.png'),[Drawing.Imaging.ImageFormat]::Png) } finally { $large.Dispose() }
    $frames = @()
    foreach ($size in @(16,24,32,48,64,128,256)) {
        $bitmap = New-IconBitmap $size
        $memory = New-Object IO.MemoryStream
        try {
            $bitmap.Save($memory,[Drawing.Imaging.ImageFormat]::Png)
            $frames += [pscustomobject]@{ Size=$size; Bytes=$memory.ToArray() }
        } finally { $bitmap.Dispose(); $memory.Dispose() }
    }
    $stream = [IO.File]::Create((Join-Path $assets 'icon.ico'))
    $writer = New-Object IO.BinaryWriter($stream)
    try {
        $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
        $offset = 6 + 16 * $frames.Count
        foreach ($frame in $frames) {
            $dimension = if ($frame.Size -eq 256) {0} else {$frame.Size}
            $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
            $writer.Write([byte]0); $writer.Write([byte]0)
            $writer.Write([uint16]1); $writer.Write([uint16]32)
            $writer.Write([uint32]$frame.Bytes.Length); $writer.Write([uint32]$offset)
            $offset += $frame.Bytes.Length
        }
        foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
    } finally { $writer.Dispose(); $stream.Dispose() }
} finally { $source.Dispose() }
Get-Item (Join-Path $assets 'icon.ico'),(Join-Path $assets 'icon.png') | Select-Object FullName,Length
