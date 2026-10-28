<#
.SYNOPSIS
统一投稿入口：默认发布至 Bilibili 和微信视频号。
.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File tools/upload/upload.ps1 -Project 2026-10-16-32bit-ms-timer -Yes
.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File tools/upload/upload.ps1 -Project 2026-10-16-32bit-ms-timer -DryRun
#>
[CmdletBinding()]
param(
    [string]$Project,
    [Alias('Platform')][string]$Platforms = 'bilibili,sph',
    [switch]$List, [switch]$Check, [switch]$DryRun, [switch]$Yes, [switch]$Login,
    [string]$Account, [string]$Root
)
$ErrorActionPreference = 'Stop'
$script:ToolDir = $PSScriptRoot
$script:ScanRoot = if ($Root) { [IO.Path]::GetFullPath($Root) } else { [IO.Path]::GetFullPath((Join-Path $ToolDir '..\..')) }
$script:Interactive = -not [Console]::IsInputRedirected
$script:AccountOverride = $Account
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false } catch {}
foreach ($file in @('common/runtime.ps1', 'common/projects.ps1', 'common/console.ps1', 'bilibili/adapter.ps1', 'sph/adapter.ps1')) { . (Join-Path $ToolDir $file) }

try {
    $script:SelectedPlatforms = @($Platforms.ToLowerInvariant().Split(',') | ForEach-Object {
        $name = $_.Trim()
        if ($name -eq 'channels') { $name = 'sph' }
        if ($name -notin @('bilibili', 'sph')) { throw "未知平台：$name；使用 bilibili,sph 或单个平台。" }
        $name
    } | Select-Object -Unique)
    if (@($List, $Check, $DryRun, $Login | Where-Object { $_ }).Count -gt 1) { throw '-List、-Check、-DryRun、-Login 不能同时使用。' }
    if ($Yes -and ($List -or $Check -or $DryRun -or $Login)) { throw '-Yes 只用于实际上传，不能与只读模式或 -Login 混用。' }
    if ($Login) {
        if ($Project) { throw '-Login 不接受 -Project。用 -Account 选择视频号账号。' }
        $plans = @(foreach ($platform in $script:SelectedPlatforms) {
            if ($platform -eq 'bilibili') { New-BilibiliTool } else { New-SphTool $(if ($Account) { $Account } else { 'default' }) }
        })
        foreach ($plan in $plans) { Assert-ToolReady $plan -ForLogin }
        foreach ($plan in $plans) {
            $loginArgs = if ($plan.Platform -eq 'bilibili') { @('-u', $plan.CredentialPath, 'login') } else { @('login', '--account', $plan.Account) }
            $code = Invoke-UploadTool $plan $loginArgs
            if ($code -ne 0) { throw "$($plan.Platform) 登录失败（退出码 $code）" }
        }
        exit 0
    }
    if ($Yes -and -not $Project) { throw '-Yes 必须同时指定 -Project，避免自动选择错误的视频。' }
    if (-not (Test-Path -LiteralPath $script:ScanRoot -PathType Container)) { throw "项目根目录不存在：$script:ScanRoot" }
    # Choose platforms before building plans: unchecked platforms must not block validation.
    if ($script:Interactive -and -not ($List -or $Check -or $DryRun -or $Yes) -and -not $PSBoundParameters.ContainsKey('Platforms')) {
        $script:SelectedPlatforms = @(Select-UploadPlatforms)
        if ($script:SelectedPlatforms.Count -eq 0) { Write-Host '已取消。'; exit 0 }
    }
    $projects = if ($Project) { @(Find-Project $Project) } else { @(Get-Projects) }
    if ($projects.Count -eq 0) { throw '未找到投稿项目。项目外层需要投稿 JSON 和成片。' }
    if ($List -or $Check) {
        Show-Projects $projects
        foreach ($p in $projects) { foreach ($warning in $p.Warnings) { Write-Host "$($p.Name): $warning" -ForegroundColor Yellow } }
        if ($Check -and @($projects | Where-Object { $_.Issues.Count -gt 0 }).Count -gt 0) { exit 1 }
        if ($Check) { Write-Host '本地预检通过；此检查不验证登录、网络和平台审核。' }
        exit 0
    }
    if ($Project) { $selected = $projects[0] }
    elseif ($script:Interactive) { $selected = Select-Project $projects }
    else { throw '非交互调用请指定 -Project；预览用 -DryRun，实际发布用 -Yes。' }
    if ($null -eq $selected) { Write-Host '已取消。'; exit 0 }
    if ($selected.Issues.Count -gt 0) { throw ($selected.Issues -join "`n") }
    Write-Host "项目：$($selected.Name) / $($selected.Base)"
    $platformLabels = @($script:SelectedPlatforms | ForEach-Object { if ($_ -eq 'sph') { '微信视频号' } else { 'Bilibili' } })
    Write-Host "上传平台：$($platformLabels -join '、')" -ForegroundColor Cyan
    foreach ($warning in $selected.Warnings) { Write-Host $warning -ForegroundColor Yellow }
    foreach ($plan in $selected.Plans) { Show-UploadPlan $plan }
    if ($DryRun) { Write-Host '本地预览完成：没有启动上传程序、浏览器或网络请求。'; exit 0 }
    # Validate ALL tools before submitting anything to either platform.
    foreach ($plan in $selected.Plans) { Assert-ToolReady $plan }
    if (-not $Yes) {
        if (-not $script:Interactive) { throw '非交互实际发布需要 -Yes；只预览请用 -DryRun。' }
        if ((Read-Host '核对以上各平台信息后，输入 YES 上传；其他输入取消') -cne 'YES') { Write-Host '已取消。'; exit 0 }
    }
    $runDir = Join-Path $selected.Folder 'work\upload'
    New-Item -ItemType Directory -Force -Path $runDir | Out-Null
    $reportPath = Join-Path $runDir ((Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 6) + '.json')
    $results = @(foreach ($plan in $selected.Plans) {
        [pscustomobject]@{ platform = $plan.Platform; status = 'pending'; exit_code = $null; message = '' }
    })
    $report = [ordered]@{ started_at = (Get-Date).ToString('o'); project = $selected.Json; results = $results }
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding UTF8
    for ($i = 0; $i -lt $selected.Plans.Count; $i++) {
        $plan = $selected.Plans[$i]
        $result = $results[$i]
        $result.status = 'running'
        $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding UTF8
        try {
            Write-Host "[$($plan.Platform)] 开始上传 ..." -ForegroundColor Cyan
            $result.exit_code = Invoke-PlatformUpload $plan
            $result.status = if ($result.exit_code -eq 0) { 'submitted' } else { 'failed' }
            $result.message = if ($result.exit_code -eq 0) { '上传工具返回成功，审核状态请到平台确认。' } else { '上传工具返回失败；重试前请确认平台是否已收到稿件。' }
        } catch { $result.status = 'failed'; $result.exit_code = 1; $result.message = $_.Exception.Message }
        $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding UTF8
    }
    Write-Host ''
    foreach ($result in $results) { Write-Host "[$($result.platform)] $($result.status) / $($result.exit_code)：$($result.message)" }
    Write-Host "本次结果：$reportPath"
    if ('bilibili' -in $script:SelectedPlatforms -and (Test-Path -LiteralPath (Join-Path $selected.Folder ($selected.Base + '.srt')) -PathType Leaf)) {
        Write-Host '检测到 SRT 字幕，请到 B 站创作中心手动上传。'
    }
    $failed = @($results | Where-Object { $_.status -ne 'submitted' })
    if ($failed.Count -gt 0) {
        Write-Host "确认平台状态后，只重试失败平台：-Platforms $(($failed | ForEach-Object { $_.platform }) -join ',')。重复运行双平台命令会再次投稿。" -ForegroundColor Yellow
        exit 1
    }
    exit 0
} catch { Write-Host "[错误] $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
