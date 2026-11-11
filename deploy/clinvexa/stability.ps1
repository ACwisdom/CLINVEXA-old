param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId,
    [double]$DurationHours = 8,
    [int]$IntervalSeconds = 30,
    [string]$OutputPath = "clinvexa-stability.json"
)

$startedAt = [DateTime]::UtcNow
$deadline = $startedAt.AddHours($DurationHours)
$samples = 0
$maxWorkingSetMb = 0
$failure = $null

while ([DateTime]::UtcNow -lt $deadline) {
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($null -eq $process) {
        $failure = "clinvexa process exited"
        break
    }

    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8001/clinvexa/skills" -TimeoutSec 10
        if ($response.StatusCode -ne 200) {
            $failure = "clinvexa health request failed"
            break
        }
    }
    catch {
        $failure = "clinvexa health request failed"
        break
    }

    $workingSetMb = [math]::Round($process.WorkingSet64 / 1MB, 2)
    $maxWorkingSetMb = [math]::Max($maxWorkingSetMb, $workingSetMb)
    $samples += 1
    Start-Sleep -Seconds $IntervalSeconds
}

$result = [ordered]@{
    duration_hours = [math]::Round(([DateTime]::UtcNow - $startedAt).TotalHours, 4)
    failure = $failure
    finished_at_utc = [DateTime]::UtcNow.ToString("o")
    max_working_set_mb = $maxWorkingSetMb
    passed = $null -eq $failure -and [DateTime]::UtcNow -ge $deadline
    process_id = $ProcessId
    samples = $samples
    started_at_utc = $startedAt.ToString("o")
}

$result | ConvertTo-Json | Set-Content -LiteralPath $OutputPath -Encoding UTF8
$result | ConvertTo-Json -Compress
if (-not $result.passed) {
    exit 1
}
