function New-SphTool([string]$AccountName = 'default') {
    if ($AccountName -notmatch '^[A-Za-z0-9_-]+$') { throw 'sph 账号名只能包含英文字母、数字、下划线和短横线' }
    $dir = Join-Path $script:ToolDir 'sph'
    $state = Join-Path $dir 'state'
    return [pscustomobject]@{
        Platform = 'sph'; Exe = (Join-Path $dir 'sph.exe'); WorkingDirectory = $dir
        CredentialPath = (Join-Path $state "accounts\$AccountName\profile"); CredentialType = 'Container'
        Environment = @{ SPH_CONFIG_DIR = $state }; Account = $AccountName
        Title = ''; Arguments = @(); VideoPaths = @()
    }
}

function New-SphPlan($Project) {
    $meta = $Project.Meta
    $options = Get-Field $meta 'sph' ([pscustomobject]@{})
    if (-not ($options -is [pscustomobject])) { throw 'sph 必须是 JSON 对象' }
    $allowed = @('title', 'desc', 'tag', 'video', 'cover', 'cover_landscape', 'account', 'collection', 'at', 'ai_mark')
    foreach ($prop in $options.PSObject.Properties) {
        if ($prop.Name -notin $allowed) { $Project.Issues.Add("未知 sph 字段：$($prop.Name)") }
        elseif ($prop.Name -eq 'ai_mark') {
            if (-not ($prop.Value -is [bool])) { $Project.Issues.Add('sph.ai_mark 必须是 true 或 false') }
        } elseif (-not ($prop.Value -is [string])) { $Project.Issues.Add("sph.$($prop.Name) 必须是字符串") }
    }
    $accountName = if ($script:AccountOverride) { $script:AccountOverride } else { Get-Field $options 'account' 'default' }
    $plan = New-SphTool $accountName
    $title = Get-Field $options 'title' $meta.title
    $titleInfo = New-Object System.Globalization.StringInfo ([string]$title)
    if (-not $options.PSObject.Properties['title'] -and $titleInfo.LengthInTextElements -gt 16) {
        $title = $titleInfo.SubstringByTextElements(0, 16).TrimEnd()
        $Project.Warnings.Add("[sph] 使用原标题前 16 个字符：$title；可在 JSON 的 sph.title 中自定义。")
    } elseif ([string]::IsNullOrWhiteSpace([string]$title) -or $titleInfo.LengthInTextElements -gt 16) {
        $Project.Issues.Add('[sph] 短标题不能为空或超过 16 个字符')
    }
    $plan.Title = [string]$title
    # The full shared title remains in the description when adapting a long title.
    $defaultDesc = [string](Get-Field $meta 'desc' '')
    if ($title -cne $meta.title) { $defaultDesc = ($meta.title + "`n" + $defaultDesc).TrimEnd() }
    $description = Get-Field $options 'desc' $defaultDesc
    $tag = Get-Field $options 'tag' (Get-Field $meta 'tag' '')
    if (-not ($tag -is [string])) { $Project.Issues.Add('[sph] tag 必须是字符串') }
    $tags = @(([string]$tag).Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if (([string]$description).Length + (($tags | ForEach-Object { ' #' + $_ }) -join '').Length -gt 1000) { $Project.Issues.Add('[sph] 简介与话题合计超过 1000 个字符，请填写较短的 sph.desc / sph.tag') }
    if ($options.PSObject.Properties['video']) {
        $videoName = $options.video
    } else {
        $names = @(Get-VideoNames $Project)
        if ($names.Count -ne 1) { $Project.Issues.Add('[sph] 不支持 B 站多 P；请用 sph.video 指定单个视频或合并成片'); $videoName = $null }
        else { $videoName = $names[0] }
    }
    $video = if ($null -ne $videoName) { Resolve-ProjectFile $Project $videoName '[sph] 视频' @('.mp4') } else { $null }
    $plan.VideoPaths = @($video | Where-Object { $_ })
    $plan.Arguments = @('publish', [string]$video, '--title', [string]$title, '--account', $plan.Account)
    if ($description) { $plan.Arguments += @('--description', [string]$description) }
    if ($tags.Count -gt 0) { $plan.Arguments += @('--tags', ($tags -join ',')) }

    $explicitCover = $options.PSObject.Properties['cover'] -or $options.PSObject.Properties['cover_landscape']
    foreach ($pair in @(@('cover', '--cover'), @('cover_landscape', '--cover-landscape'))) {
        if ($options.PSObject.Properties[$pair[0]] -and $options.($pair[0])) {
            $cover = Resolve-ProjectFile $Project $options.($pair[0]) ('sph.' + $pair[0]) @('.jpg', '.jpeg', '.png')
            if ($cover) { $plan.Arguments += @($pair[1], $cover) }
        }
    }
    if (-not $explicitCover) {
        $cover = Get-SharedCover $Project
        if ($cover) {
            Add-Type -AssemblyName System.Drawing
            $picture = [Drawing.Image]::FromFile($cover)
            try { $flag = if ($picture.Width -ge $picture.Height) { '--cover-landscape' } else { '--cover' } }
            finally { $picture.Dispose() }
            $plan.Arguments += @($flag, $cover)
        }
    }
    foreach ($name in @('collection', 'at')) {
        $value = Get-Field $options $name ''
        if ($value) { $plan.Arguments += @(('--' + $name), $value) }
    }
    if ($options.at) {
        $scheduled = [datetime]::MinValue
        if (-not [datetime]::TryParseExact($options.at, 'yyyy-MM-dd HH:mm', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$scheduled) -or $scheduled -le (Get-Date)) {
            $Project.Issues.Add('[sph] at 必须是未来的本地时间，格式 yyyy-MM-dd HH:mm')
        }
    }
    if ($options.ai_mark -eq $true) { $plan.Arguments += '--ai-mark' }
    return $plan
}
