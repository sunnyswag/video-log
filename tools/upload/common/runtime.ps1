# Windows PowerShell 5.1 / PowerShell 7: preserve quotes, newlines and trailing backslashes.
function ConvertTo-NativeArgument([string]$Value) {
    if ($Value.IndexOf([char]0) -ge 0) { throw '命令参数不能包含 NUL 字符。' }
    $escaped = [regex]::Replace($Value, '(\\*)"', '${1}${1}\"')
    return '"' + [regex]::Replace($escaped, '(\\+)$', '${1}${1}') + '"'
}

function Invoke-UploadTool($Plan, [string[]]$Arguments, [switch]$CaptureOutput, [switch]$CaptureError) {
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $Plan.Exe
    $start.Arguments = (($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' ')
    $start.WorkingDirectory = $Plan.WorkingDirectory
    $start.UseShellExecute = $false
    if ($CaptureOutput) {
        # sph sends its final JSON to stdout and live progress to inherited stderr.
        $start.RedirectStandardOutput = $true
        $start.StandardOutputEncoding = [Text.Encoding]::UTF8
    }
    if ($CaptureError) {
        $start.RedirectStandardError = $true
        $start.StandardErrorEncoding = [Text.Encoding]::UTF8
    }
    foreach ($key in $Plan.Environment.Keys) { $start.EnvironmentVariables[$key] = $Plan.Environment[$key] }
    $process = [Diagnostics.Process]::Start($start)
    try {
        if ($CaptureOutput) { $output = $process.StandardOutput.ReadToEndAsync() }
        if ($CaptureError) { $errorOutput = $process.StandardError.ReadToEndAsync() }
        $process.WaitForExit()
        if ($CaptureOutput -or $CaptureError) {
            return [pscustomobject]@{
                ExitCode = $process.ExitCode
                Output = $(if ($CaptureOutput) { $output.GetAwaiter().GetResult() } else { '' })
                ErrorOutput = $(if ($CaptureError) { $errorOutput.GetAwaiter().GetResult() } else { '' })
            }
        }
        return $process.ExitCode
    }
    finally { $process.Dispose() }
}

function Show-UploadPlan($Plan) {
    Write-Host "[$($Plan.Platform)] $($Plan.Title)" -ForegroundColor Cyan
    Write-Host (('& ' + "'" + $Plan.Exe.Replace("'", "''") + "' ") + (($Plan.Arguments | ForEach-Object { "'" + ([string]$_).Replace("'", "''") + "'" }) -join ' '))
}

function Assert-ToolReady($Plan) {
    if (-not (Test-Path -LiteralPath $Plan.Exe -PathType Leaf)) {
        throw "找不到 $($Plan.Platform) 程序：$($Plan.Exe)。请参阅 tools/upload/Readme.md。"
    }
}

function Get-PlatformSession($Plan) {
    if (-not (Test-Path -LiteralPath $Plan.CredentialPath -PathType $Plan.CredentialType)) { return 'NeedsLogin' }
    if ($Plan.Platform -eq 'bilibili') { return Get-BilibiliSession $Plan }
    return Get-SphSession $Plan
}

function Invoke-PlatformLogin($Plan) {
    if ($Plan.Platform -eq 'bilibili') {
        Write-Host '[bilibili] 请在登录菜单中选择“扫码登录”，使用 B 站 App 扫码并确认。' -ForegroundColor Yellow
        $loginArgs = @('-u', $Plan.CredentialPath, 'login')
    } else {
        Write-Host "[sph] 请在专用浏览器中用微信扫码（账号：$($Plan.Account)），等待工具返回。" -ForegroundColor Yellow
        $loginArgs = @('login', '--account', $Plan.Account)
    }
    $code = Invoke-UploadTool $Plan $loginArgs
    if ($code -ne 0) { throw "$($Plan.Platform) 登录未完成（退出码 $code）；本次未开始上传。" }
}

function Ensure-UploadSessions([object[]]$Plans, [bool]$AllowLogin) {
    foreach ($plan in $Plans) { Assert-ToolReady $plan }
    foreach ($plan in $Plans) {
        Write-Host "[$($plan.Platform)] 检查登录状态 ..."
        $status = Get-PlatformSession $plan
        if ($status -eq 'NeedsLogin') {
            if (-not $AllowLogin) {
                throw "$($plan.Platform) 尚未登录或登录已过期；本次未开始上传。请双击 upload_video.bat 完成登录后上传，或运行 upload.ps1 -Login -Platforms $($plan.Platform)$(if ($plan.Platform -eq 'sph') { ' -Account ' + $plan.Account })。"
            }
            Write-Host "[$($plan.Platform)] 尚未登录或登录已过期，先完成登录。" -ForegroundColor Yellow
            Invoke-PlatformLogin $plan
            Write-Host "[$($plan.Platform)] 重新检查登录状态 ..."
            $status = Get-PlatformSession $plan
        }
        if ($status -ne 'Ready') { throw "$($plan.Platform) 登录后仍未通过验证；本次未开始上传，请重新运行登录。" }
        Write-Host "[$($plan.Platform)] 登录有效。" -ForegroundColor Green
    }
}

function Invoke-PlatformUpload($Plan) {
    if ($Plan.Platform -eq 'sph') { return Invoke-SphUpload $Plan }
    $code = Invoke-UploadTool $Plan $Plan.Arguments
    return [pscustomobject]@{
        ExitCode = $code; Success = ($code -eq 0); ErrorCode = ''; Stage = ''
        Message = $(if ($code -eq 0) { '上传工具返回成功，审核状态请到平台确认。' } else { '上传工具返回失败；重试前请确认平台是否已收到稿件。' })
    }
}
