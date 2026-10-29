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
        if (failure == "renew" && Array.IndexOf(args, "renew") >= 0) return 7;
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
    Assert ($calls.Count -eq 3) 'Expected renew, bilibili upload and sph publish'
    Assert ($calls[0].argv -contains 'renew') 'Bilibili renew missing'
    Assert ($calls[1].platform -eq 'bilibili' -and $calls[2].platform -eq 'sph') 'Both platforms were not invoked'
    Assert ((Argument-Value $calls[1] '--title') -ceq $meta.title) 'Quoted Bilibili title changed'
    Assert ((Argument-Value $calls[2] '--title') -ceq $meta.title) 'Quoted sph title changed'
    Assert ((Argument-Value $calls[1] '--desc') -ceq $meta.desc) 'Multiline/quotes/backslashes changed'
    Assert ((Argument-Value $calls[2] '--description') -ceq $meta.desc) 'sph description changed'
    Assert ($calls[2].state -eq (Join-Path $testTool 'sph\state')) 'sph state is not isolated'
    Assert ($calls[1].cwd -eq (Join-Path $testTool 'bilibili')) 'bilibili cwd mismatch'
    Assert (@((Latest-Result).results | Where-Object { $_.status -eq 'submitted' }).Count -eq 2) 'Success summary missing'
    Passed 'dual upload preserves native arguments and reports both platforms'

    Reset-Calls
    $meta.Remove('cover')
    Copy-Item -LiteralPath (Join-Path $caseDir 'cover.png') -Destination (Join-Path $caseDir 'demo.png')
    $schedule = (Get-Date).AddDays(1).ToString('yyyy-MM-dd HH:mm')
    $meta.sph = @{ collection = '我的 科普合集'; at = $schedule }
    Save-Meta $meta
    Run-Entry ($options + '-Yes') | Out-Null
    $calls = @(Read-Calls)
    Assert ((Argument-Value $calls[1] '--cover') -eq (Join-Path $caseDir 'demo.png')) 'Bilibili did not discover the implicit cover'
    Assert ((Argument-Value $calls[2] '--cover-landscape') -eq (Join-Path $caseDir 'demo.png')) 'sph did not discover the implicit cover'
    Assert ($calls[2].argv -contains '--collection') 'Collection flag must be its own argument'
    Assert ((Argument-Value $calls[2] '--collection') -ceq '我的 科普合集') 'Collection value must be preserved separately'
    Assert ($calls[2].argv -contains '--at') 'Schedule flag must be its own argument'
    Assert ((Argument-Value $calls[2] '--at') -ceq $schedule) 'Schedule value must be preserved separately'
    $meta.Remove('sph')
    $meta.cover = 'cover.png'
    Save-Meta $meta
    Passed 'implicit cover discovery, collection and schedule survive native argument construction'

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
    $meta.sph = @{ video = 'part two.mp4'; title = '视频号独立短标题' }
    Save-Meta $meta
    Run-Entry ($options + '-Yes') | Out-Null
    $calls = @(Read-Calls)
    Assert ($calls[1].argv -contains (Join-Path $caseDir 'demo.mp4') -and $calls[1].argv -contains (Join-Path $caseDir 'part two.mp4')) 'Bilibili multipart lost a video'
    Assert ($calls[2].argv[1] -eq (Join-Path $caseDir 'part two.mp4')) 'sph video selection mismatch'
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
    foreach ($failure in @('sph', 'bilibili', 'renew')) {
        Reset-Calls
        $env:UPLOAD_TEST_FAILURE = $failure
        Run-Entry ($options + '-Yes') 1 | Out-Null
        $calls = @(Read-Calls)
        $results = (Latest-Result).results
        Assert (@($results | Where-Object { $_.status -eq 'submitted' }).Count -eq 1) "Wrong partial result for $failure"
        Assert (@($results | Where-Object { $_.status -eq 'failed' }).Count -eq 1) "Missing failure for $failure"
        Assert (@($calls | Where-Object { $_.platform -eq 'sph' }).Count -eq 1) "sph not attempted after $failure"
        if ($failure -eq 'renew') { Assert ($calls.Count -eq 2) 'Upload continued after failed renewal' }
    }
    $env:UPLOAD_TEST_FAILURE = ''
    Passed 'each runtime failure is isolated, summarized and returned as nonzero'

    Reset-Calls
    $env:UPLOAD_TEST_FAILURE = 'cover'
    $failureText = Run-Entry ($options + @('-Platforms', 'sph', '-Yes')) 1
    $result = (Latest-Result).results[0]
    Assert ($result.exit_code -eq 11 -and $result.error_code -eq 'SCHEMA_CHANGED' -and $result.stage -eq 'cover') 'sph structured failure was lost'
    Assert ($result.message -match 'Cover editor changed' -and $failureText -match 'SCHEMA_CHANGED/cover') 'sph error message missing from report or summary'
    Assert (@(Read-Calls).Count -eq 1) 'Failure triggered an automatic retry'
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
    $calls = @(Read-Calls)
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
