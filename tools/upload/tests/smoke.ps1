# Integration tests use fake native executables. No network or real publishing.
$ErrorActionPreference = 'Stop'
$temp = Join-Path ([IO.Path]::GetTempPath()) ('video-log-upload-test-' + [guid]::NewGuid().ToString('N'))
$uploadSource = Split-Path $PSScriptRoot -Parent
$testRoot = Join-Path $temp 'repo with spaces'
$testTool = Join-Path $testRoot 'tools\upload'
$caseDir = Join-Path $testRoot '2026-10-27-test'
$json = Join-Path $caseDir 'demo.json'
$entry = Join-Path $testTool 'upload.ps1'
$record = Join-Path $temp 'calls.jsonl'
$oldRecord = $env:UPLOAD_TEST_RECORD
$oldFailure = $env:UPLOAD_TEST_FAILURE
$env:UPLOAD_TEST_RECORD = $record
$env:UPLOAD_TEST_FAILURE = ''
$passed = 0

function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Save-Meta($Value) { $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $json -Encoding UTF8 }
function Reset-Calls { if (Test-Path -LiteralPath $record) { Remove-Item -LiteralPath $record } }
function Read-Calls { if (Test-Path -LiteralPath $record) { Get-Content -LiteralPath $record -Encoding UTF8 | ForEach-Object { $_ | ConvertFrom-Json } } }
function Read-Uploads { Read-Calls | Where-Object { $_.argv -contains 'upload' -or $_.argv -contains 'publish' } }
function Run-Entry([string[]]$Options, [int]$Expected = 0) {
    $savedPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $text = @(& powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $entry @Options 2>&1)
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $savedPreference }
    Assert ($code -eq $Expected) ("Expected exit $Expected, got $code : " + ($text -join "`n"))
    return ($text -join "`n")
}
function Passed([string]$Name) { $script:passed++; Write-Host "PASS $Name" }
function Latest-Result {
    $file = Get-ChildItem -LiteralPath (Join-Path $caseDir 'work\upload') -Filter '*.json' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    return Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
}
function Argument-Value($Call, [string]$Flag) { return $Call.argv[[array]::IndexOf($Call.argv, $Flag) + 1] }

try {
    # Drive the actual keyboard menu without opening a console or invoking an uploader.
    . (Join-Path $uploadSource 'common\console.ps1')
    function Select-WithKeys([ConsoleKey[]]$Keys) {
        $queue = New-Object 'System.Collections.Generic.Queue[ConsoleKey]'
        foreach ($key in $Keys) { $queue.Enqueue($key) }
        $readKey = {
            if ($queue.Count -eq 0) { throw 'Platform menu consumed unexpected input' }
            [pscustomobject]@{ Key = $queue.Dequeue() }
        }.GetNewClosure()
        return @(Select-UploadPlatforms -ReadKey $readKey 6>$null)
    }
    Assert (((Select-WithKeys @('Enter')) -join ',') -eq 'bilibili,sph') 'Default menu must select both platforms'
    Assert (((Select-WithKeys @('Spacebar', 'Enter')) -join ',') -eq 'sph') 'Unchecking Bilibili must leave only sph'
    Assert (((Select-WithKeys @('DownArrow', 'Spacebar', 'Enter')) -join ',') -eq 'bilibili') 'Unchecking sph must leave only Bilibili'
    Assert (((Select-WithKeys @('Spacebar', 'Spacebar', 'Enter')) -join ',') -eq 'bilibili,sph') 'Space must restore a selection'
    Assert (((Select-WithKeys @('Spacebar', 'DownArrow', 'Spacebar', 'Enter', 'UpArrow', 'Spacebar', 'Enter')) -join ',') -eq 'bilibili') 'Empty selection must wait for correction'
    Assert (@(Select-WithKeys @('Escape')).Count -eq 0) 'Escape must cancel the menu'
    Assert (@(Select-WithKeys @('Q')).Count -eq 0) 'Q must cancel the menu'
    Passed 'platform checkboxes default to both, support deselection, reject empty selection and cancel'

    New-Item -ItemType Directory -Force -Path $testTool, $caseDir | Out-Null
    # Copy source only: never copy real Cookie files, browser profiles or executables.
    foreach ($name in @('upload.ps1', 'common', 'bilibili', 'sph')) {
        $source = Join-Path $uploadSource $name
        if ($name -eq 'upload.ps1') { Copy-Item -LiteralPath $source -Destination $testTool }
        else {
            $dest = Join-Path $testTool $name
            New-Item -ItemType Directory -Force -Path $dest | Out-Null
            Get-ChildItem -LiteralPath $source -File -Filter '*.ps1' | Copy-Item -Destination $dest
        }
    }
    $fake = Join-Path $temp 'fake.exe'
    Add-Type -OutputAssembly $fake -OutputType ConsoleApplication -ReferencedAssemblies 'System.Web.Extensions.dll' -TypeDefinition @'
using System;
using System.IO;
using System.Collections.Generic;
using System.Web.Script.Serialization;
class UploadTestProcess {
    static int Main(string[] args) {
        string platform = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory).Name;
        var data = new Dictionary<string, object> {
            {"platform", platform}, {"argv", args}, {"cwd", Environment.CurrentDirectory},
            {"state", Environment.GetEnvironmentVariable("SPH_CONFIG_DIR")}
        };
        File.AppendAllText(Environment.GetEnvironmentVariable("UPLOAD_TEST_RECORD"),
            new JavaScriptSerializer().Serialize(data) + "\n", new System.Text.UTF8Encoding(false));
        Console.Error.WriteLine("mock progress on stderr");
        string failure = Environment.GetEnvironmentVariable("UPLOAD_TEST_FAILURE");
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string expired = Path.Combine(baseDir, "expired");
        if (Array.IndexOf(args, "login") >= 0) {
            if (failure == "cancel-" + platform) return 9;
            if (failure != "sticky-" + platform && File.Exists(expired)) File.Delete(expired);
            if (platform == "bilibili") File.WriteAllText(args[Array.IndexOf(args, "-u") + 1], "{}");
            else Directory.CreateDirectory(Path.Combine(Environment.GetEnvironmentVariable("SPH_CONFIG_DIR"), "accounts", args[Array.IndexOf(args, "--account") + 1], "profile"));
            return 0;
        }
        if (Array.IndexOf(args, "list") >= 0) {
            if (failure == "check-" + platform) {
                if (platform == "sph") Console.WriteLine("{\"ok\":false,\"error\":{\"code\":\"SCHEMA_CHANGED\",\"stage\":\"navigate\"}}");
                else Console.Error.WriteLine("network request failed");
                return 7;
            }
            if (failure == "invalid-json" && platform == "sph") { Console.WriteLine("not json"); return 0; }
            if (File.Exists(expired)) {
                if (platform == "sph") Console.WriteLine("{\"ok\":false,\"error\":{\"code\":\"SESSION_EXPIRED\",\"stage\":\"navigate\"}}");
                else Console.Error.WriteLine("credential validation failed with Bilibili code -101");
                return 15;
            }
            if (platform == "sph") Console.WriteLine("{\"ok\":true,\"command\":\"list\",\"data\":{\"count\":0,\"videos\":[]}}");
            return 0;
        }
        if (platform == "sph" && Array.IndexOf(args, "publish") >= 0) {
            if (failure == "empty-response") return 0;
            if (failure == "cover") {
                Console.WriteLine("{\"ok\":false,\"error\":{\"code\":\"SCHEMA_CHANGED\",\"stage\":\"cover\",\"message\":\"Cover editor changed\",\"retryable\":false}}");
                return 11;
            }
            bool success = failure != "sph";
            if (success) Console.WriteLine("{\"ok\":true,\"command\":\"publish\",\"data\":{\"submitted\":true,\"dry_run\":false}}");
            else Console.WriteLine("{\"ok\":false,\"error\":{\"code\":\"RECOVERY_FAILED\",\"stage\":\"metadata\",\"message\":\"Mock failure\"}}");
        }
        if (failure == platform && (Array.IndexOf(args, "upload") >= 0 || Array.IndexOf(args, "publish") >= 0)) return 17;
        return 0;
    }
}
'@
    Copy-Item -LiteralPath $fake -Destination (Join-Path $testTool 'bilibili\biliup.exe')
    Set-Content -LiteralPath (Join-Path $testTool 'bilibili\cookies.json') -Value '{}' -Encoding UTF8
    New-Item -ItemType Directory -Force -Path (Join-Path $testTool 'sph\state\accounts\default\profile') | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $caseDir 'demo.mp4'), [byte[]]@(1, 2, 3))
    [IO.File]::WriteAllBytes((Join-Path $caseDir 'part two.mp4'), [byte[]]@(4, 5, 6))
    Add-Type -AssemblyName System.Drawing
    $bitmap = New-Object Drawing.Bitmap 160, 90
    try { $bitmap.Save((Join-Path $caseDir 'cover.png'), [Drawing.Imaging.ImageFormat]::Png) }
    finally { $bitmap.Dispose() }
    $meta = [ordered]@{
        title = '标题 "引号" 与空格'; tid = 231; tag = '计算机技术,科普'
        desc = "第一行：`"原样保留`" & `$()；`n第二行 C:\quoted\`"value`"\"
        cover = 'cover.png'; videos = @(); copyright = 1
    }
    Save-Meta $meta
    $options = @('-Project', '2026-10-27-test')

    $preview = Run-Entry ($options + '-DryRun')
    Assert (@(Read-Calls).Count -eq 0) 'DryRun executed a tool'
    Assert ($preview -match '--cover-landscape') 'Landscape shared cover was not adapted'
    Assert (-not (Test-Path -LiteralPath (Join-Path $caseDir 'work'))) 'Read-only mode wrote project files'
    Passed 'dry run adapts legacy metadata and covers without executing or writing'

    Run-Entry ($options + '-Yes') 1 | Out-Null
    Run-Entry ($options + '-Check') | Out-Null
    Assert (@(Read-Calls).Count -eq 0) 'Missing second executable did not block first upload'
    Copy-Item -LiteralPath $fake -Destination (Join-Path $testTool 'sph\sph.exe')
    Passed 'all tools are checked before submission; Check needs no executable'

    Run-Entry ($options + '-Yes') | Out-Null
    $calls = @(Read-Calls)
    Assert ($calls.Count -eq 4) 'Expected both login checks before bilibili upload and sph publish'
    Assert ($calls[0].argv -contains 'list' -and $calls[1].argv -contains 'list') 'Both login checks must precede either upload'
    $calls = @(Read-Uploads)
    Assert ($calls[0].platform -eq 'bilibili' -and $calls[1].platform -eq 'sph') 'Both platforms were not invoked'
    Assert ((Argument-Value $calls[0] '--title') -ceq $meta.title) 'Quoted Bilibili title changed'
    Assert ((Argument-Value $calls[1] '--title') -ceq $meta.title) 'Quoted sph title changed'
    Assert ((Argument-Value $calls[0] '--desc') -ceq $meta.desc) 'Multiline/quotes/backslashes changed'
    Assert ((Argument-Value $calls[1] '--description') -ceq $meta.desc) 'sph description changed'
    Assert ((Argument-Value $calls[1] '--cover') -eq (Join-Path $caseDir 'cover.png')) 'Shared landscape cover did not replace the profile frame'
    Assert ((Argument-Value $calls[1] '--cover-landscape') -eq (Join-Path $caseDir 'cover.png')) 'Shared landscape cover did not populate the sharing card'
    Assert ($calls[1].state -eq (Join-Path $testTool 'sph\state')) 'sph state is not isolated'
    Assert ($calls[0].cwd -eq (Join-Path $testTool 'bilibili')) 'bilibili cwd mismatch'
    Assert (@((Latest-Result).results | Where-Object { $_.status -eq 'submitted' }).Count -eq 2) 'Success summary missing'
    Passed 'dual upload preserves native arguments and reports both platforms'

    Reset-Calls
    $meta['title-short'] = '通用短标题'
    Save-Meta $meta
    Run-Entry ($options + '-Yes') | Out-Null
    $calls = @(Read-Uploads)
    Assert ((Argument-Value $calls[0] '--title') -ceq $meta.title) 'Short title replaced Bilibili full title'
    Assert ((Argument-Value $calls[1] '--title') -ceq $meta['title-short']) 'Top-level short title was not used'
    Assert ((Argument-Value $calls[1] '--description') -ceq ($meta.title + "`n" + $meta.desc)) 'Full title was lost from sph description'
    Passed 'shared title-short supplies the short title while retaining the full title'

    Reset-Calls
    $savedTitle = $meta.title
    $meta.title = '完整标题，保留逗号'
    $meta['title-short'] = '任务队列，网络线程池,实现'
    Save-Meta $meta
    $metadataHash = (Get-FileHash -LiteralPath $json).Hash
    $commaWarning = Run-Entry ($options + '-Yes')
    $calls = @(Read-Uploads)
    Assert ((Argument-Value $calls[0] '--title') -ceq $meta.title) 'Bilibili punctuation was altered'
    Assert ((Argument-Value $calls[1] '--title') -ceq '任务队列 网络线程池 实现') 'sph did not adapt Chinese and ASCII commas'
    Assert ((Argument-Value $calls[1] '--description') -ceq ($meta.title + "`n" + $meta.desc)) 'Full title punctuation was lost from description'
    Assert ((Get-FileHash -LiteralPath $json).Hash -eq $metadataHash) 'Platform adaptation rewrote shared metadata'
    Assert ($commaWarning -match '逗号' -and $commaWarning -match '空格') 'Title normalization was not disclosed'
    Reset-Calls
    $meta.Remove('title-short')
    $meta.title = '任务，队列,重构'
    Save-Meta $meta
    Run-Entry ($options + @('-Platforms', 'sph', '-Yes')) | Out-Null
    Assert ((Argument-Value @(Read-Uploads)[0] '--title') -ceq '任务 队列 重构') 'Fallback title did not adapt commas'
    $meta.title = $savedTitle
    Passed 'sph normalizes title commas without changing shared JSON, Bilibili or description'

    Reset-Calls
    foreach ($badShort in @($null, '', '   ', 123, ',，')) {
        $meta['title-short'] = $badShort
        Save-Meta $meta
        Run-Entry ($options + '-Yes') 1 | Out-Null
    }
    Assert (@(Read-Calls).Count -eq 0) 'Invalid short title allowed partial publication'
    $meta['title-short'] = '这是一条超过十六个字符的通用短标题'
    Save-Meta $meta
    Run-Entry ($options + @('-Platforms', 'bilibili', '-Yes')) | Out-Null
    Assert (@(Read-Calls).Count -eq 2) 'Video-specific short title limit blocked Bilibili'
    Reset-Calls
    Run-Entry ($options + '-Yes') 1 | Out-Null
    Assert (@(Read-Calls).Count -eq 0) 'Overlong video-channel title allowed partial publication'
    $meta.Remove('title-short')
    $meta.sph = @{ title = '旧字段' }
    Save-Meta $meta
    $migration = Run-Entry ($options + '-Yes') 1
    Assert ($migration -match 'sph.title' -and $migration -match 'title-short') 'Legacy field lacks a migration hint'
    Assert (@(Read-Calls).Count -eq 0) 'Legacy title was silently ignored'
    $meta.Remove('sph')
    Passed 'shared short-title validation and platform limits prevent unintended publication'

    $originalTitle = $meta.title
    $meta.title = '这是一条超过十六个字符的完整视频标题'
    Save-Meta $meta
    $fallback = Run-Entry ($options + '-Yes')
    $calls = @(Read-Uploads)
    Assert ((Argument-Value $calls[1] '--title') -ceq $meta.title.Substring(0, 16)) 'Missing short title no longer uses the existing fallback'
    Assert ($fallback -match 'title-short') 'Fallback hint references the old field'
    $meta.title = $originalTitle
    Save-Meta $meta
    Passed 'missing title-short retains explicit truncation warning and full-title fallback'

    Reset-Calls
    $meta.Remove('cover')
    Copy-Item -LiteralPath (Join-Path $caseDir 'cover.png') -Destination (Join-Path $caseDir 'demo.png')
    $schedule = (Get-Date).AddDays(1).ToString('yyyy-MM-dd HH:mm')
    $meta.sph = @{ collection = '我的 科普合集'; at = $schedule }
    Save-Meta $meta
    Run-Entry ($options + '-Yes') | Out-Null
    $calls = @(Read-Uploads)
    Assert ((Argument-Value $calls[0] '--cover') -eq (Join-Path $caseDir 'demo.png')) 'Bilibili did not discover the implicit cover'
    Assert ((Argument-Value $calls[1] '--cover') -eq (Join-Path $caseDir 'demo.png')) 'sph profile did not inherit the implicit cover'
    Assert ((Argument-Value $calls[1] '--cover-landscape') -eq (Join-Path $caseDir 'demo.png')) 'sph did not discover the implicit cover'
    Assert ($calls[1].argv -contains '--collection') 'Collection flag must be its own argument'
    Assert ((Argument-Value $calls[1] '--collection') -ceq '我的 科普合集') 'Collection value must be preserved separately'
    Assert ($calls[1].argv -contains '--at') 'Schedule flag must be its own argument'
    Assert ((Argument-Value $calls[1] '--at') -ceq $schedule) 'Schedule value must be preserved separately'
    $meta.Remove('sph')
    $meta.cover = 'cover.png'
    Save-Meta $meta
    Passed 'implicit cover discovery, collection and schedule survive native argument construction'

    Reset-Calls
    $meta.sph = @{ cover = 'demo.png'; cover_landscape = 'cover.png' }
    Save-Meta $meta
    Run-Entry ($options + @('-Platforms', 'sph', '-Yes')) | Out-Null
    $call = @(Read-Uploads)[0]
    Assert ((Argument-Value $call '--cover') -eq (Join-Path $caseDir 'demo.png')) 'Explicit profile cover was replaced'
    Assert ((Argument-Value $call '--cover-landscape') -eq (Join-Path $caseDir 'cover.png')) 'Explicit sharing-card cover was replaced'
    Reset-Calls
    $meta.sph = @{ cover_landscape = 'cover.png' }
    Save-Meta $meta
    Run-Entry ($options + @('-Platforms', 'sph', '-Yes')) | Out-Null
    $call = @(Read-Uploads)[0]
    Assert ($call.argv -notcontains '--cover') 'Explicit sharing-card-only configuration acquired a profile cover'
    Assert ((Argument-Value $call '--cover-landscape') -eq (Join-Path $caseDir 'cover.png')) 'Explicit sharing-card-only cover was lost'
    $portrait = New-Object Drawing.Bitmap 90, 160
    try { $portrait.Save((Join-Path $caseDir 'portrait.png'), [Drawing.Imaging.ImageFormat]::Png) }
    finally { $portrait.Dispose() }
    Reset-Calls
    $meta.Remove('sph')
    $meta.cover = 'portrait.png'
    Save-Meta $meta
    Run-Entry ($options + @('-Platforms', 'sph', '-Yes')) | Out-Null
    $call = @(Read-Uploads)[0]
    Assert ((Argument-Value $call '--cover') -eq (Join-Path $caseDir 'portrait.png')) 'Portrait source did not populate the profile cover'
    Assert ($call.argv -notcontains '--cover-landscape') 'Portrait source unexpectedly required a landscape editor'
    $meta.cover = 'cover.png'
    Save-Meta $meta
    Passed 'cover slots preserve explicit overrides and portrait-only behavior'

    Reset-Calls
    Run-Entry @('-Yes') 1 | Out-Null
    Run-Entry ($options + @('-Yes', '-DryRun')) 1 | Out-Null
    Run-Entry ($options + @('-Platforms', 'bilibili,typo', '-Yes')) 1 | Out-Null
    Assert (@(Read-Calls).Count -eq 0) 'Invalid invocation executed a tool'
    Passed 'ambiguous or conflicting commands are rejected before execution'

    $meta.videos = @('demo.mp4', 'part two.mp4')
    Save-Meta $meta
    Run-Entry ($options + '-Yes') 1 | Out-Null
    Assert (@(Read-Calls).Count -eq 0) 'Ambiguous multipart upload was submitted'
    $meta.sph = @{ video = 'part two.mp4' }
    Save-Meta $meta
    Run-Entry ($options + '-Yes') | Out-Null
    $calls = @(Read-Uploads)
    Assert ($calls[0].argv -contains (Join-Path $caseDir 'demo.mp4') -and $calls[0].argv -contains (Join-Path $caseDir 'part two.mp4')) 'Bilibili multipart lost a video'
    Assert ($calls[1].argv[1] -eq (Join-Path $caseDir 'part two.mp4')) 'sph video selection mismatch'
    Passed 'multipart requires explicit sph file while preserving Bilibili parts'

    Reset-Calls
    $meta.sph.video = '..\demo.mp4'
    Save-Meta $meta
    Run-Entry ($options + '-Yes') 1 | Out-Null
    $meta.sph.video = 'missing.mp4'
    Save-Meta $meta
    Run-Entry ($options + '-Yes') 1 | Out-Null
    Assert (@(Read-Calls).Count -eq 0) 'Bad sph files caused partial publication'
    Passed 'invalid input blocks both platforms before publication'

    $meta.Remove('sph')
    $meta.videos = @()
    Save-Meta $meta
    foreach ($failure in @('sph', 'bilibili')) {
        Reset-Calls
        $env:UPLOAD_TEST_FAILURE = $failure
        Run-Entry ($options + '-Yes') 1 | Out-Null
        $calls = @(Read-Uploads)
        $results = (Latest-Result).results
        Assert (@($results | Where-Object { $_.status -eq 'submitted' }).Count -eq 1) "Wrong partial result for $failure"
        Assert (@($results | Where-Object { $_.status -eq 'failed' }).Count -eq 1) "Missing failure for $failure"
        Assert (@($calls | Where-Object { $_.platform -eq 'sph' }).Count -eq 1) "sph not attempted after $failure"
    }
    $env:UPLOAD_TEST_FAILURE = ''
    Passed 'each runtime failure is isolated, summarized and returned as nonzero'

    # Exercise the same preflight used by the entry point with interactive login
    # allowed. Only fake executables are in these plans; no console/UI is needed.
    . (Join-Path $testTool 'common\runtime.ps1')
    . (Join-Path $testTool 'bilibili\adapter.ps1')
    . (Join-Path $testTool 'sph\adapter.ps1')
    $script:ToolDir = $testTool
    $authPlans = @((New-BilibiliTool), (New-SphTool 'default'))
    foreach ($plan in $authPlans) {
        Assert ([IO.Path]::GetFullPath($plan.CredentialPath).StartsWith(([IO.Path]::GetFullPath($testRoot) + '\'), [StringComparison]::OrdinalIgnoreCase)) 'Auth fixture must stay inside the temporary repository'
    }
    $authPlans[0].Arguments = @('upload')
    $authPlans[1].Arguments = @('publish')
    function Run-AuthFlow([bool]$ExpectedSuccess) {
        $failureMessage = ''
        try {
            Ensure-UploadSessions -Plans $authPlans -AllowLogin $true
            foreach ($plan in $authPlans) { Invoke-PlatformUpload $plan | Out-Null }
        } catch { $failureMessage = $_.Exception.Message }
        Assert ([string]::IsNullOrEmpty($failureMessage) -eq $ExpectedSuccess) "Unexpected auth result: $failureMessage"
        if (-not $ExpectedSuccess) { Assert (@(Read-Uploads).Count -eq 0) 'Authentication failure allowed a partial upload' }
    }
    Reset-Calls
    # Rename fake credentials within the verified temporary fixture, preserving
    # them so this case also covers first login with no file/profile.
    Move-Item -LiteralPath $authPlans[0].CredentialPath -Destination ($authPlans[0].CredentialPath + '.saved')
    Move-Item -LiteralPath $authPlans[1].CredentialPath -Destination ($authPlans[1].CredentialPath + '.saved')
    Run-AuthFlow $true
    $calls = @(Read-Calls)
    Assert (($calls | ForEach-Object { $_.platform + ':' + $(if ($_.argv -contains 'login') { 'login' } elseif ($_.argv -contains 'list') { 'list' } else { 'upload' }) }) -join ',' -eq 'bilibili:login,bilibili:list,sph:login,sph:list,bilibili:upload,sph:upload') 'First login did not recheck both platforms before uploading'
    Passed 'missing credentials trigger login and recheck for both platforms before upload'

    Reset-Calls
    foreach ($plan in $authPlans) { Set-Content -LiteralPath (Join-Path $plan.WorkingDirectory 'expired') -Value 'expired' }
    Run-AuthFlow $true
    $calls = @(Read-Calls)
    Assert ($calls.Count -eq 8 -and @($calls | Where-Object { $_.argv -contains 'login' }).Count -eq 2) 'Expired sessions did not login exactly once each'
    Assert ($calls[2].argv -contains 'list' -and $calls[5].argv -contains 'list') 'Login success was not rechecked'
    Assert ($calls[6].argv -contains 'upload' -and $calls[7].argv -contains 'publish') 'Upload started before all login checks'
    Passed 'expired sessions reauthenticate once, then both uploads proceed'

    foreach ($platform in @('bilibili', 'sph')) {
        $expired = Join-Path (Join-Path $testTool $platform) 'expired'
        foreach ($mode in @('cancel', 'sticky')) {
            Reset-Calls
            Set-Content -LiteralPath $expired -Value 'expired'
            $env:UPLOAD_TEST_FAILURE = "$mode-$platform"
            Run-AuthFlow $false
            Assert (@(Read-Calls | Where-Object { $_.argv -contains 'login' }).Count -eq 1) 'Login was retried or skipped'
            Remove-Item -LiteralPath $expired
        }
    }
    $env:UPLOAD_TEST_FAILURE = ''
    Passed 'cancelled login and still-expired login block all publication without looping'

    foreach ($mode in @('check-bilibili', 'check-sph', 'invalid-json')) {
        Reset-Calls
        $env:UPLOAD_TEST_FAILURE = $mode
        Run-AuthFlow $false
        Assert (@(Read-Calls | Where-Object { $_.argv -contains 'login' }).Count -eq 0) 'Network/schema/invalid response incorrectly triggered login'
        Reset-Calls
        Run-Entry ($options + '-Yes') 1 | Out-Null
        Assert (@(Read-Uploads).Count -eq 0) 'Entry point bypassed failed preflight'
    }
    $env:UPLOAD_TEST_FAILURE = ''
    Passed 'network, browser schema and invalid responses stop before either publication'

    foreach ($plan in $authPlans) {
        Reset-Calls
        $expired = Join-Path $plan.WorkingDirectory 'expired'
        Set-Content -LiteralPath $expired -Value 'expired'
        Run-Entry ($options + '-Yes') 1 | Out-Null
        Assert (@(Read-Uploads).Count -eq 0 -and @(Read-Calls | Where-Object { $_.argv -contains 'login' }).Count -eq 0) 'Noninteractive expiry tried to login or publish'
        Remove-Item -LiteralPath $expired
        Move-Item -LiteralPath $plan.CredentialPath -Destination ($plan.CredentialPath + '.missing')
        Reset-Calls
        Run-Entry ($options + '-Yes') 1 | Out-Null
        Assert (@(Read-Uploads).Count -eq 0 -and @(Read-Calls | Where-Object { $_.argv -contains 'login' }).Count -eq 0) 'Noninteractive missing credentials tried to login or publish'
        Move-Item -LiteralPath ($plan.CredentialPath + '.missing') -Destination $plan.CredentialPath
    }
    Passed 'unattended missing or expired sessions stop without opening login or uploading'

    Reset-Calls
    $env:UPLOAD_TEST_FAILURE = 'cover'
    $failureText = Run-Entry ($options + @('-Platforms', 'sph', '-Yes')) 1
    $result = (Latest-Result).results[0]
    Assert ($result.exit_code -eq 11 -and $result.error_code -eq 'SCHEMA_CHANGED' -and $result.stage -eq 'cover') 'sph structured failure was lost'
    Assert ($result.message -match 'Cover editor changed' -and $failureText -match 'SCHEMA_CHANGED/cover') 'sph error message missing from report or summary'
    Assert (@(Read-Uploads).Count -eq 1) 'Failure triggered an automatic retry'
    $env:UPLOAD_TEST_FAILURE = 'empty-response'
    Run-Entry ($options + @('-Platforms', 'sph', '-Yes')) 1 | Out-Null
    Assert ((Latest-Result).results[0].status -eq 'failed') 'Empty sph output was incorrectly marked as published'
    $env:UPLOAD_TEST_FAILURE = ''
    Passed 'sph failures preserve code, stage and message; missing confirmation never reports success'

    Reset-Calls
    $meta.Remove('tid')
    $meta.Remove('copyright')
    $meta.videos = @('not-needed.mp4')
    $meta.sph = @{ video = 'demo.mp4'; cover = '' }
    Save-Meta $meta
    Run-Entry ($options + @('-Platforms', 'channels', '-Yes')) | Out-Null
    $calls = @(Read-Uploads)
    Assert ($calls.Count -eq 1 -and $calls[0].platform -eq 'sph') 'Single platform retry invoked Bilibili'
    Assert ($calls[0].argv -notcontains '--cover' -and $calls[0].argv -notcontains '--cover-landscape') 'Empty override did not disable cover'
    Passed 'sph-only accepts its own file and ignores Bilibili fields'

    Reset-Calls
    $meta.sph.typo = 'bad'
    Save-Meta $meta
    Run-Entry ($options + @('-Platforms', 'sph', '-Yes')) 1 | Out-Null
    Assert (@(Read-Calls).Count -eq 0) 'Unknown metadata field was silently ignored'
    Passed 'unknown sph options fail locally'

    Reset-Calls
    Run-Entry @('-Login', '-Platforms', 'sph', '-Account', 'creator') | Out-Null
    $calls = @(Read-Calls)
    Assert ($calls.Count -eq 1 -and $calls[0].argv[0] -eq 'login') 'Login executed a publish operation'
    Assert ((Argument-Value $calls[0] '--account') -eq 'creator') 'Login account mismatch'
    Assert ($calls[0].state -eq (Join-Path $testTool 'sph\state')) 'Login uses a different state directory'
    Passed 'login shares the isolated state directory and selected account'

    Write-Host "All $passed integration groups passed. No real uploads."
} finally {
    $env:UPLOAD_TEST_RECORD = $oldRecord
    $env:UPLOAD_TEST_FAILURE = $oldFailure
    $resolved = [IO.Path]::GetFullPath($temp)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -like 'video-log-upload-test-*') {
        if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
    }
}
