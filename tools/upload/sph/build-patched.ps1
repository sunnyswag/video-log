# Rebuild the local compatibility fix from pinned upstream source; no account access.
[CmdletBinding()]
param([string]$Cargo = 'cargo', [switch]$Force, [switch]$Test, [string]$Chrome)
$ErrorActionPreference = 'Stop'
$target = Join-Path $PSScriptRoot 'sph.exe'
if ((Test-Path -LiteralPath $target) -and -not $Force) { throw 'sph.exe 已存在；替换时加 -Force。原程序会备份到 state/bin/。' }
$cargoPath = (Get-Command $Cargo -ErrorAction Stop).Source
$gitPath = (Get-Command git -ErrorAction Stop).Source
if ($Test -and (-not $Chrome -or -not (Test-Path -LiteralPath $Chrome -PathType Leaf))) { throw '-Test 需通过 -Chrome 指定本机 Chrome/Edge 程序。' }
$temp = Join-Path ([IO.Path]::GetTempPath()) ('video-log-sph-build-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
$oldChrome = $env:SPH_CHROME
$oldLto = $env:CARGO_PROFILE_RELEASE_LTO
$oldUnits = $env:CARGO_PROFILE_RELEASE_CODEGEN_UNITS
$oldVersion = $env:SPH_VERSION
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $zip = Join-Path $temp 'source.zip'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/LcpMarvel/sph/archive/refs/tags/v2.1.3.zip' -OutFile $zip
    $expected = '0463b3c775098cd61cfd60cb9578af449eb1f1cfd2094f045fb14cfddfa3bdb1'
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw '上游源码 SHA256 不匹配，已停止。' }
    Expand-Archive -LiteralPath $zip -DestinationPath $temp
    $source = Join-Path $temp 'sph-2.1.3'
    & $gitPath -C $source init --quiet
    if ($LASTEXITCODE -ne 0) { throw '临时源码目录初始化失败' }
    & $gitPath -C $source apply (Join-Path $PSScriptRoot 'patches\v2.1.3-direct-cover.patch')
    if ($LASTEXITCODE -ne 0) { throw '源码补丁应用失败' }
    $env:CARGO_PROFILE_RELEASE_LTO = 'false'
    $env:CARGO_PROFILE_RELEASE_CODEGEN_UNITS = '16'
    $env:SPH_VERSION = '2.1.3+video-log.1'
    $manifest = Join-Path $source 'Cargo.toml'
    & $cargoPath build --manifest-path $manifest --release --locked --jobs 2
    if ($LASTEXITCODE -ne 0) { throw '编译失败，原 sph.exe 未替换。' }
    if ($Test) {
        $env:SPH_CHROME = $Chrome
        & $cargoPath test --manifest-path $manifest --release --locked --jobs 2 e2e_publish_landscape -- --test-threads=1
        if ($LASTEXITCODE -ne 0) { throw '封面流程测试失败，原 sph.exe 未替换。' }
    }
    $built = Join-Path $source 'target\release\sph.exe'
    $version = & $built version
    if ($LASTEXITCODE -ne 0 -or ($version -join "`n") -notmatch '2\.1\.3\+video-log\.1') { throw '构建产物启动或版本验证失败，原 sph.exe 未替换。' }
    if (Test-Path -LiteralPath $target) {
        $backups = Join-Path $PSScriptRoot 'state\bin'
        New-Item -ItemType Directory -Force -Path $backups | Out-Null
        Copy-Item -LiteralPath $target -Destination (Join-Path $backups ((Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-sph.exe'))
    }
    Copy-Item -LiteralPath $built -Destination $target -Force
    Write-Output $version
} finally {
    $env:SPH_CHROME = $oldChrome
    $env:CARGO_PROFILE_RELEASE_LTO = $oldLto
    $env:CARGO_PROFILE_RELEASE_CODEGEN_UNITS = $oldUnits
    $env:SPH_VERSION = $oldVersion
    $resolved = [IO.Path]::GetFullPath($temp)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -like 'video-log-sph-build-*') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
