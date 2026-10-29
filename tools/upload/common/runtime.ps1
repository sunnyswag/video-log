# Windows PowerShell 5.1 / PowerShell 7: preserve quotes, newlines and trailing backslashes.
function ConvertTo-NativeArgument([string]$Value) {
    if ($Value.IndexOf([char]0) -ge 0) { throw '命令参数不能包含 NUL 字符。' }
    $escaped = [regex]::Replace($Value, '(\\*)"', '${1}${1}\"')
    return '"' + [regex]::Replace($escaped, '(\\+)$', '${1}${1}') + '"'
}

function Invoke-UploadTool($Plan, [string[]]$Arguments, [switch]$CaptureOutput) {
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
    foreach ($key in $Plan.Environment.Keys) { $start.EnvironmentVariables[$key] = $Plan.Environment[$key] }
    $process = [Diagnostics.Process]::Start($start)
    try {
        if ($CaptureOutput) { $output = $process.StandardOutput.ReadToEndAsync() }
        $process.WaitForExit()
        if ($CaptureOutput) {
            return [pscustomobject]@{ ExitCode = $process.ExitCode; Output = $output.GetAwaiter().GetResult() }
        }
        return $process.ExitCode
    }
    finally { $process.Dispose() }
}

function Show-UploadPlan($Plan) {
    Write-Host "[$($Plan.Platform)] $($Plan.Title)" -ForegroundColor Cyan
    Write-Host (('& ' + "'" + $Plan.Exe.Replace("'", "''") + "' ") + (($Plan.Arguments | ForEach-Object { "'" + ([string]$_).Replace("'", "''") + "'" }) -join ' '))
}

function Assert-ToolReady($Plan, [switch]$ForLogin) {
    if (-not (Test-Path -LiteralPath $Plan.Exe -PathType Leaf)) {
        throw "找不到 $($Plan.Platform) 程序：$($Plan.Exe)。请参阅 tools/upload/使用说明.md。"
    }
    if (-not $ForLogin -and -not (Test-Path -LiteralPath $Plan.CredentialPath -PathType $Plan.CredentialType)) {
        throw "$($Plan.Platform) 尚未登录。请运行 upload.ps1 -Login -Platforms $($Plan.Platform)$(if ($Plan.Platform -eq 'sph') { ' -Account ' + $Plan.Account })。"
    }
}

function Invoke-PlatformUpload($Plan) {
    if ($Plan.Platform -eq 'sph') { return Invoke-SphUpload $Plan }
    if ($Plan.Platform -eq 'bilibili') {
        Write-Host '[bilibili] 刷新登录凭据 ...'
        $code = Invoke-UploadTool $Plan @('--rust-log', 'error', '-u', $Plan.CredentialPath, 'renew')
        if ($code -ne 0) { throw "biliup renew 失败（退出码 $code），未开始 B 站上传；请重新登录。" }
    }
    $code = Invoke-UploadTool $Plan $Plan.Arguments
    return [pscustomobject]@{
        ExitCode = $code; Success = ($code -eq 0); ErrorCode = ''; Stage = ''
        Message = $(if ($code -eq 0) { '上传工具返回成功，审核状态请到平台确认。' } else { '上传工具返回失败；重试前请确认平台是否已收到稿件。' })
    }
}
