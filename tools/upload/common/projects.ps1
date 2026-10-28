function Get-Field($Object, [string]$Name, $Default = $null) {
    if ($null -ne $Object -and $Object.PSObject.Properties[$Name]) { return ,$Object.$Name }
    return ,$Default
}

function Resolve-ProjectFile($Project, $Name, [string]$Label, [string[]]$Extensions) {
    if (-not ($Name -is [string]) -or [string]::IsNullOrWhiteSpace($Name) -or
        $Name -match '[/\\]' -or $Name -in @('.', '..') -or
        $Name.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0 -or [IO.Path]::IsPathRooted($Name)) {
        $Project.Issues.Add("$Label 必须是项目外层的单个文件名")
        return $null
    }
    if ($Extensions -and [IO.Path]::GetExtension($Name).ToLowerInvariant() -notin $Extensions) {
        $Project.Issues.Add("$Label 的格式应为 $($Extensions -join '/')：$Name")
        return $null
    }
    $path = Join-Path $Project.Folder $Name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        $Project.Issues.Add("$Label 不存在：$Name")
        return $null
    }
    $file = Get-Item -LiteralPath $path
    if ($file.Length -eq 0) { $Project.Issues.Add("$Label 是空文件：$Name") }
    if ($file.LastWriteTime -gt $Project.Time) { $Project.Time = $file.LastWriteTime }
    return $path
}

function Get-VideoNames($Project) {
    $names = Get-Field $Project.Meta 'videos'
    if ($null -ne $names -and -not ($names -is [array])) {
        $Project.Issues.Add('videos 必须是文件名数组')
        return
    }
    if (@($names).Count -eq 0 -or $null -eq $names) { return ($Project.Base + '.mp4') }
    return $names
}

function Get-SharedCover($Project) {
    $name = Get-Field $Project.Meta 'cover'
    if ($null -ne $name -and $name -cne '') { return Resolve-ProjectFile $Project $name 'cover' @('.jpg', '.jpeg', '.png') }
    foreach ($candidate in @(($Project.Base + '.jpg'), ($Project.Base + '.png'), '封面.jpg')) {
        if (Test-Path -LiteralPath (Join-Path $Project.Folder $candidate) -PathType Leaf) {
            return Resolve-ProjectFile $Project $candidate '封面' @('.jpg', '.jpeg', '.png')
        }
    }
    return $null
}

function Get-Project([IO.FileInfo]$JsonFile) {
    $p = [pscustomobject]@{
        Folder = $JsonFile.DirectoryName; Name = $JsonFile.Directory.Name
        Base = $JsonFile.BaseName; Json = $JsonFile.FullName; Meta = $null
        Time = $JsonFile.LastWriteTime; SizeMB = 0; Plans = @()
        Issues = (New-Object 'System.Collections.Generic.List[string]')
        Warnings = (New-Object 'System.Collections.Generic.List[string]')
    }
    try {
        $p.Meta = Get-Content -LiteralPath $p.Json -Raw -Encoding UTF8 | ConvertFrom-Json
        if (-not ($p.Meta -is [pscustomobject])) { throw '投稿 JSON 顶层必须是对象' }
        if (-not ($p.Meta.title -is [string]) -or [string]::IsNullOrWhiteSpace($p.Meta.title)) { throw 'title 必须是非空字符串' }
        if ($p.Meta.PSObject.Properties['desc'] -and -not ($p.Meta.desc -is [string])) { throw 'desc 必须是字符串' }
        foreach ($platform in $script:SelectedPlatforms) {
            $p.Plans += if ($platform -eq 'bilibili') { New-BilibiliPlan $p } else { New-SphPlan $p }
        }
        $paths = @($p.Plans | ForEach-Object { $_.VideoPaths } | Select-Object -Unique)
        $bytes = [long]0
        foreach ($path in $paths) { if ($path) { $bytes += (Get-Item -LiteralPath $path).Length } }
        $p.SizeMB = [math]::Round($bytes / 1MB)
    } catch { $p.Issues.Add($_.Exception.Message) }
    return $p
}

function Get-Projects {
    $found = @()
    foreach ($dir in (Get-ChildItem -LiteralPath $script:ScanRoot -Directory)) {
        if ($dir.Name -in @('.git', '.trash', 'fonts', 'tools', 'work')) { continue }
        foreach ($json in (Get-ChildItem -LiteralPath $dir.FullName -File -Filter '*.json')) { $found += Get-Project $json }
    }
    return @($found | Sort-Object Time -Descending)
}

function Find-Project([string]$Value) {
    $path = if ([IO.Path]::IsPathRooted($Value)) { $Value } else { Join-Path $script:ScanRoot $Value }
    if (Test-Path -LiteralPath $path -PathType Container) {
        $files = @(Get-ChildItem -LiteralPath $path -File -Filter '*.json')
        if ($files.Count -ne 1) { throw '项目目录必须恰好有一个投稿 JSON；有多个时请用 -Project 指定具体 JSON 文件。' }
        return Get-Project $files[0]
    }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or [IO.Path]::GetExtension($path) -ne '.json') { throw "找不到投稿项目或 JSON：$path" }
    return Get-Project (Get-Item -LiteralPath $path)
}
