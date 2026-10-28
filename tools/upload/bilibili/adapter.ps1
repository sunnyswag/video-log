function New-BilibiliTool {
    $dir = Join-Path $script:ToolDir 'bilibili'
    return [pscustomobject]@{
        Platform = 'bilibili'; Exe = (Join-Path $dir 'biliup.exe'); WorkingDirectory = $dir
        CredentialPath = (Join-Path $dir 'cookies.json'); CredentialType = 'Leaf'
        Environment = @{}; Title = ''; Arguments = @(); VideoPaths = @()
    }
}

function New-BilibiliPlan($Project) {
    $meta = $Project.Meta
    $plan = New-BilibiliTool
    $plan.Title = $meta.title
    if ($meta.title.Length -gt 80) { $Project.Issues.Add('[bilibili] title 超过 80 个字符') }
    $tid = 0
    if (-not [int]::TryParse([string]$meta.tid, [ref]$tid) -or $tid -le 0) { $Project.Issues.Add('[bilibili] tid 必须是正整数') }
    $tag = Get-Field $meta 'tag' ''
    if (-not ($tag -is [string]) -or [string]::IsNullOrWhiteSpace($tag)) {
        $Project.Issues.Add('[bilibili] tag 必须是非空字符串')
    } else {
        $tags = @($tag.Split(',') | ForEach-Object { $_.Trim() })
        if ($tags.Count -gt 10 -or @($tags | Where-Object { -not $_ }).Count -gt 0) { $Project.Issues.Add('[bilibili] tag 应为不超过 10 个非空、英文逗号分隔的标签') }
    }
    $copyright = 0
    $value = Get-Field $meta 'copyright' 1
    if (-not [int]::TryParse([string]$value, [ref]$copyright) -or $copyright -notin @(1, 2)) { $Project.Issues.Add('[bilibili] copyright 只能是 1 或 2') }
    $source = Get-Field $meta 'source' ''
    if ($copyright -eq 2 -and [string]::IsNullOrWhiteSpace([string]$source)) { $Project.Issues.Add('[bilibili] 转载必须填写 source') }
    $plan.VideoPaths = @(foreach ($name in (Get-VideoNames $Project)) { Resolve-ProjectFile $Project $name '[bilibili] 视频' @('.mp4') })
    $cover = Get-SharedCover $Project
    $plan.Arguments = @('-u', $plan.CredentialPath, 'upload', '--copyright', [string]$copyright,
        '--tid', [string]$tid, '--title', $meta.title, '--tag', [string]$tag)
    if ($meta.desc) { $plan.Arguments += @('--desc', $meta.desc) }
    if ($copyright -eq 2 -and $source) { $plan.Arguments += @('--source', [string]$source) }
    if ($cover) { $plan.Arguments += @('--cover', $cover) }
    $plan.Arguments += $plan.VideoPaths
    return $plan
}
