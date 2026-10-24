# B 站投稿工具。-List / -Check 只读取本地项目，不需要登录凭据。
param(
    [switch]$List,
    [switch]$Check,
    [string]$Root
)

$ErrorActionPreference = 'Stop'
$script:ToolDir = $PSScriptRoot
$script:ExePath = Join-Path $ToolDir 'biliup.exe'
$script:CookiePath = Join-Path $ToolDir 'cookies.json'
$script:ScanRoot = if ($Root) { [IO.Path]::GetFullPath($Root) } else { [IO.Path]::GetFullPath((Join-Path $ToolDir '..\..')) }
$script:Exclude = @('.git', '.trash', 'fonts', 'tools')
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$script:Interactive = -not [Console]::IsInputRedirected

function Pause-Exit([int]$Code) {
    if ($script:Interactive) { Read-Host '按回车退出' | Out-Null }
    exit $Code
}

function Test-LocalFileName($Value, [string]$Label, $Issues) {
    if (-not ($Value -is [string]) -or [string]::IsNullOrWhiteSpace($Value) -or
        $Value -match '[/\\]' -or $Value -eq '.' -or $Value -eq '..' -or
        [IO.Path]::IsPathRooted($Value)) {
        $Issues.Add("$Label 必须是项目外层的单个文件名")
        return $false
    }
    return $true
}

function Get-Project([IO.FileInfo]$JsonFile) {
    $issues = New-Object 'System.Collections.Generic.List[string]'
    $folder = $JsonFile.DirectoryName
    $meta = $null
    try { $meta = Get-Content -LiteralPath $JsonFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { $issues.Add("JSON 解析失败：$($_.Exception.Message)") }

    $videoNames = @()
    $videoPaths = @()
    $coverPath = $null
    $copyright = 1
    $source = ''
    $sortTime = $JsonFile.LastWriteTime
    $totalBytes = [long]0

    if ($null -ne $meta) {
        if (-not ($meta.title -is [string]) -or [string]::IsNullOrWhiteSpace($meta.title)) {
            $issues.Add('title 必须是非空字符串')
        } elseif ($meta.title.Length -gt 80) {
            $issues.Add('title 超过 80 个字符')
        }

        $tid = 0
        if (-not [int]::TryParse([string]$meta.tid, [ref]$tid) -or $tid -le 0) {
            $issues.Add('tid 必须是正整数')
        }

        if (-not ($meta.tag -is [string]) -or [string]::IsNullOrWhiteSpace($meta.tag)) {
            $issues.Add('tag 必须是非空字符串')
        } else {
            $tags = @($meta.tag.Split(',') | ForEach-Object { $_.Trim() })
            if ($tags.Count -gt 10 -or @($tags | Where-Object { -not $_ }).Count -gt 0) {
                $issues.Add('tag 应为不超过 10 个非空、英文逗号分隔的标签')
            }
        }

        if ($meta.PSObject.Properties['copyright'] -and $null -ne $meta.copyright) {
            $copyrightValue = 0
            if (-not [int]::TryParse([string]$meta.copyright, [ref]$copyrightValue) -or
                $copyrightValue -notin @(1, 2)) {
                $issues.Add('copyright 只能是 1（自制）或 2（转载）')
            } else { $copyright = $copyrightValue }
        }
        if ($meta.PSObject.Properties['source'] -and $null -ne $meta.source) {
            $source = [string]$meta.source
        }

        if ($meta.PSObject.Properties['videos'] -and $null -ne $meta.videos) {
            if (-not ($meta.videos -is [array])) {
                $issues.Add('videos 必须是文件名数组')
            } else { $videoNames = @($meta.videos) }
        }
        if ($videoNames.Count -eq 0) { $videoNames = @($JsonFile.BaseName + '.mp4') }
        foreach ($name in $videoNames) {
            if (-not (Test-LocalFileName $name '视频' $issues)) { continue }
            if ([IO.Path]::GetExtension($name).ToLowerInvariant() -ne '.mp4') {
                $issues.Add("视频必须是 MP4：$name")
                continue
            }
            $path = Join-Path $folder $name
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
                $issues.Add("视频不存在：$name")
                continue
            }
            $file = Get-Item -LiteralPath $path
            if ($file.Length -eq 0) { $issues.Add("视频是空文件：$name") }
            if ($file.LastWriteTime -gt $sortTime) { $sortTime = $file.LastWriteTime }
            $totalBytes += $file.Length
            $videoPaths += $path
        }

        if ($meta.PSObject.Properties['cover'] -and $null -ne $meta.cover -and
            [string]$meta.cover -ne '') {
            if (Test-LocalFileName $meta.cover '封面' $issues) {
                $coverPath = Join-Path $folder $meta.cover
                if (-not (Test-Path -LiteralPath $coverPath -PathType Leaf)) {
                    $issues.Add("指定的封面不存在：$($meta.cover)")
                    $coverPath = $null
                } elseif ((Get-Item -LiteralPath $coverPath).Length -eq 0) {
                    $issues.Add("指定的封面是空文件：$($meta.cover)")
                }
            }
        } else {
            foreach ($name in @($JsonFile.BaseName + '.jpg', $JsonFile.BaseName + '.png', '封面.jpg')) {
                $path = Join-Path $folder $name
                if (Test-Path -LiteralPath $path -PathType Leaf) { $coverPath = $path; break }
            }
        }
    }

    return [pscustomobject]@{
        Folder = $folder
        Name = $JsonFile.Directory.Name
        Base = $JsonFile.BaseName
        Json = $JsonFile.FullName
        Meta = $meta
        VideoPaths = @($videoPaths)
        CoverPath = $coverPath
        Copyright = $copyright
        Source = $source
        SizeMB = [math]::Round($totalBytes / 1MB)
        Time = $sortTime
        Issues = @($issues.ToArray())
    }
}

function Get-Projects {
    $found = New-Object 'System.Collections.Generic.List[object]'
    foreach ($dir in (Get-ChildItem -LiteralPath $script:ScanRoot -Directory)) {
        if ($script:Exclude -contains $dir.Name) { continue }
        foreach ($json in (Get-ChildItem -LiteralPath $dir.FullName -File -Filter '*.json')) {
            $found.Add((Get-Project $json))
        }
    }
    return @($found | Sort-Object Time -Descending)
}

function Show-Projects($Items) {
    Write-Host ("找到 {0} 个投稿项目：" -f $Items.Count)
    for ($i = 0; $i -lt $Items.Count; $i++) {
        $p = $Items[$i]
        $state = if ($p.Issues.Count -eq 0) { '就绪' } else { '检查失败' }
        Write-Host (" [{0}] {1}  |  {2}  |  {3} MB  |  {4:yyyy-MM-dd HH:mm}  |  {5}" -f
            $i, $p.Name, $state, $p.SizeMB, $p.Time, $p.Base)
        if ($p.Issues.Count -gt 0) {
            foreach ($issue in $p.Issues) { Write-Host "      - $issue" -ForegroundColor Yellow }
        }
    }
}

function Select-Project($Items) {
    $index = 0
    $top = 0
    $pageSize = [Math]::Min($Items.Count, 15)
    if ($script:Interactive) { [Console]::Clear() }
    Write-Host '=============== 选择要上传的视频 ===============' -ForegroundColor Cyan
    $listTop = [Console]::CursorTop
    $cursorWasVisible = $true
    try { $cursorWasVisible = [Console]::CursorVisible; [Console]::CursorVisible = $false } catch {}
    try {
        while ($true) {
            [Console]::SetCursorPosition(0, $listTop)
            $width = [Math]::Max(40, [Console]::WindowWidth - 2)
            for ($row = 0; $row -lt $pageSize; $row++) {
                $i = $top + $row
                $p = $Items[$i]
                $marker = if ($i -eq $index) { [char]0x25B6 } else { ' ' }
                $state = if ($p.Issues.Count -eq 0) { '' } else { ' [检查失败]' }
                $line = " $marker $($p.Name)$state  |  $($p.SizeMB) MB  |  $($p.Time.ToString('yyyy-MM-dd HH:mm'))"
                if ($line.Length -ge $width) { $line = $line.Substring(0, $width - 1) }
                $color = if ($i -eq $index) { 'Cyan' } else { 'Gray' }
                Write-Host $line.PadRight($width) -ForegroundColor $color
            }
            $hint = '  ↑/↓ 移动    Enter 确认    Esc/Q 退出'
            if ($Items.Count -gt $pageSize) { $hint += "    $($index + 1)/$($Items.Count)" }
            if ($hint.Length -ge $width) { $hint = $hint.Substring(0, $width - 1) }
            Write-Host $hint.PadRight($width) -ForegroundColor DarkGray
            $key = [Console]::ReadKey($true)
            if ($key.Key -eq [ConsoleKey]::UpArrow) { $index = ($index - 1 + $Items.Count) % $Items.Count }
            elseif ($key.Key -eq [ConsoleKey]::DownArrow) { $index = ($index + 1) % $Items.Count }
            elseif ($key.Key -eq [ConsoleKey]::Enter) { return $Items[$index] }
            elseif ($key.Key -eq [ConsoleKey]::Escape -or $key.KeyChar -eq 'q' -or $key.KeyChar -eq 'Q') { return $null }
            if ($index -lt $top) { $top = $index }
            if ($index -ge $top + $pageSize) { $top = $index - $pageSize + 1 }
        }
    } finally {
        try { [Console]::CursorVisible = $cursorWasVisible } catch {}
    }
}

if (-not (Test-Path -LiteralPath $script:ScanRoot -PathType Container)) {
    Write-Host "[错误] 项目目录不存在：$script:ScanRoot" -ForegroundColor Red
    exit 1
}
Write-Host "扫描 $script:ScanRoot 下的视频项目 ..."
$projects = @(Get-Projects)

if ($List -or $Check) {
    Show-Projects $projects
    if ($Check) {
        if ($projects.Count -eq 0) { Write-Host '[错误] 没有可检查的投稿项目'; exit 1 }
        if (@($projects | Where-Object { $_.Issues.Count -gt 0 }).Count -gt 0) { exit 1 }
        Write-Host '所有投稿项目的本地预检均通过。字幕上传和稿件状态仍需在创作中心确认。'
    }
    exit 0
}

if ($projects.Count -eq 0) {
    Write-Host '未找到投稿项目。项目外层需要投稿 JSON 和相应的视频文件。' -ForegroundColor Yellow
    Pause-Exit 1
}

if ($script:Interactive) {
    $sel = Select-Project $projects
} else {
    $sel = $projects[0]
    Write-Host '[非交互模式] 自动预览最近修改的项目，不执行上传。'
}
if ($null -eq $sel) { Write-Host '已取消。'; Pause-Exit 0 }
if ($sel.Issues.Count -gt 0) {
    Write-Host "[错误] $($sel.Json) 未通过预检：" -ForegroundColor Red
    foreach ($issue in $sel.Issues) { Write-Host " - $issue" -ForegroundColor Yellow }
    Pause-Exit 1
}

$meta = $sel.Meta
Write-Host ''
Write-Host '================ 即将投稿 ================' -ForegroundColor Cyan
Write-Host "项目文件夹：$($sel.Folder)"
Write-Host "视频：$($sel.VideoPaths -join '  ;  ')（共 $($sel.SizeMB) MB，$($sel.VideoPaths.Count) 个分P）"
Write-Host "标题：$($meta.title)"
Write-Host "分区：$($meta.tid)"
Write-Host "标签：$($meta.tag)"
Write-Host "类型：$(if ($sel.Copyright -eq 2) { "转载（来源：$($sel.Source)）" } else { '自制' })"
if ($sel.CoverPath) { Write-Host "封面：$($sel.CoverPath)" } else { Write-Host '封面：（未找到，不设置封面）' }
Write-Host '简介：'
if ($meta.PSObject.Properties['desc'] -and $meta.desc) {
    ([string]$meta.desc) -split "`r?`n" | ForEach-Object { Write-Host "  $_" }
} else { Write-Host '  （无）' }
Write-Host '==========================================' -ForegroundColor Cyan

if (-not $script:Interactive) { exit 0 }
if (-not (Test-Path -LiteralPath $script:ExePath -PathType Leaf)) {
    Write-Host "[错误] 找不到 biliup.exe：$script:ExePath" -ForegroundColor Red
    Pause-Exit 1
}
if (-not (Test-Path -LiteralPath $script:CookiePath -PathType Leaf)) {
    Write-Host "[错误] 找不到 cookies.json。请在 $script:ToolDir 运行 .\biliup.exe login。" -ForegroundColor Red
    Pause-Exit 1
}
$answer = Read-Host '核对无误后输入 YES 开始上传；其他输入取消'
if ($answer -cne 'YES') { Write-Host '已取消。'; Pause-Exit 0 }

Set-Location -LiteralPath $script:ToolDir
Write-Host '刷新登录凭据 ...'
& $script:ExePath --rust-log error -u $script:CookiePath renew 2>&1 | ForEach-Object { Write-Host "  $_" }
if ($LASTEXITCODE -ne 0) {
    Write-Host '[错误] 登录凭据已失效。请运行 .\biliup.exe login 重新扫码。' -ForegroundColor Red
    Pause-Exit 1
}

$uploadArgs = @('-u', $script:CookiePath, 'upload',
    '--copyright', [string]$sel.Copyright,
    '--tid', [string]$meta.tid,
    '--title', [string]$meta.title,
    '--tag', [string]$meta.tag)
if ($meta.PSObject.Properties['desc'] -and $meta.desc) { $uploadArgs += @('--desc', [string]$meta.desc) }
if ($sel.Copyright -eq 2 -and $sel.Source) { $uploadArgs += @('--source', $sel.Source) }
if ($sel.CoverPath) { $uploadArgs += @('--cover', $sel.CoverPath) }
$uploadArgs += $sel.VideoPaths

Write-Host '开始上传 ...'
& $script:ExePath @uploadArgs
$exitCode = $LASTEXITCODE
Write-Host ''
if ($exitCode -eq 0) {
    Write-Host '上传命令已结束。请到 B 站创作中心确认稿件状态：https://member.bilibili.com/platform/upload-manager/article' -ForegroundColor Green
} else { Write-Host "[提示] biliup 退出码 $exitCode，请检查上方日志。" -ForegroundColor Yellow }
$srt = Join-Path $sel.Folder ($sel.Base + '.srt')
if (Test-Path -LiteralPath $srt -PathType Leaf) {
    Write-Host "检测到字幕 $($sel.Base).srt：请到创作中心手动上传。"
}
Pause-Exit $exitCode
