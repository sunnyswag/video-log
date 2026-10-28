# Fixed, reviewed release. Downloads are kept out of the repository.
[CmdletBinding()]
param([switch]$Force)
$ErrorActionPreference = 'Stop'
$version = 'v2.1.3'
$architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'amd64' }
$expected = if ($architecture -eq 'arm64') { 'a2f9bb09e756ebb2dbfc1a1c4b4b850546d5cc8666c3b20423dd876e9ba383dd' } else { 'b9ce49f27c1b9b6c845fff567af212f92c528eab0e4e408e429d0348ac84a650' }
$target = Join-Path $PSScriptRoot 'sph.exe'
if ((Test-Path -LiteralPath $target) -and -not $Force) { throw 'sph.exe 已存在。确认需要替换后加 -Force；登录资料不受影响。' }
$temp = Join-Path ([IO.Path]::GetTempPath()) ('video-log-sph-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $zip = Join-Path $temp 'sph.zip'
    Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/LcpMarvel/sph/releases/download/$version/sph-windows-$architecture.zip" -OutFile $zip
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'SHA256 校验失败，未安装。' }
    $expanded = Join-Path $temp 'expanded'
    Expand-Archive -LiteralPath $zip -DestinationPath $expanded
    $exe = @(Get-ChildItem -LiteralPath $expanded -Recurse -File -Filter 'sph*.exe')
    if ($exe.Count -ne 1) { throw '压缩包中的 sph 程序数量异常。' }
    Copy-Item -LiteralPath $exe[0].FullName -Destination $target -Force
    Write-Host "已安装 sph $version（$architecture）：$target"
} finally {
    $resolvedTemp = [IO.Path]::GetFullPath($temp)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolvedTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolvedTemp -Leaf) -like 'video-log-sph-*') {
        Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
    }
}
