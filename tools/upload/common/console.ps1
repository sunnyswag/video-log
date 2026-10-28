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

function Select-UploadPlatforms([scriptblock]$ReadKey = { [Console]::ReadKey($true) }) {
    $items = @(
        [pscustomobject]@{ Id = 'bilibili'; Label = 'Bilibili'; Selected = $true },
        [pscustomobject]@{ Id = 'sph'; Label = '微信视频号'; Selected = $true }
    )
    $index = 0
    $hint = ''
    $canDraw = -not [Console]::IsOutputRedirected
    while ($true) {
        if ($canDraw) {
            try { [Console]::Clear() } catch { $canDraw = $false }
        }
        Write-Host '=============== 选择上传平台 ===============' -ForegroundColor Cyan
        Write-Host '默认已勾选两个平台，可用空格取消或恢复勾选。'
        Write-Host ''
        for ($i = 0; $i -lt $items.Count; $i++) {
            $marker = if ($i -eq $index) { '>' } else { ' ' }
            $check = if ($items[$i].Selected) { 'x' } else { ' ' }
            $color = if ($i -eq $index) { 'Cyan' } else { 'Gray' }
            Write-Host " $marker [$check] $($items[$i].Label)" -ForegroundColor $color
        }
        Write-Host ''
        Write-Host '  ↑/↓ 移动    空格 勾选/取消    Enter 确认    Esc/Q 退出' -ForegroundColor DarkGray
        if ($hint) { Write-Host $hint -ForegroundColor Yellow }
        $key = & $ReadKey
        $hint = ''
        switch ($key.Key) {
            ([ConsoleKey]::UpArrow) { $index = ($index - 1 + $items.Count) % $items.Count }
            ([ConsoleKey]::DownArrow) { $index = ($index + 1) % $items.Count }
            ([ConsoleKey]::Spacebar) { $items[$index].Selected = -not $items[$index].Selected }
            ([ConsoleKey]::Enter) {
                $chosen = @($items | Where-Object { $_.Selected } | ForEach-Object { $_.Id })
                if ($chosen.Count -gt 0) { return $chosen }
                $hint = '至少勾选一个平台；若不上传请按 Esc 退出。'
            }
            ([ConsoleKey]::Escape) { return }
            ([ConsoleKey]::Q) { return }
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
