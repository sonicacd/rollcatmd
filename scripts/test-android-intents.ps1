param(
    [string]$ManifestPath = '',
    [string]$JavaHome = '',
    [switch]$Offline
)

$ErrorActionPreference = 'Stop'
$qaRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$qaCache = Join-Path $qaRoot 'work\qa\android-intent'
$qaClasses = Join-Path $qaCache 'classes'
New-Item -ItemType Directory -Path $qaClasses -Force | Out-Null

if (-not $ManifestPath) {
    $ManifestPath = Join-Path $qaRoot 'src-tauri\gen\android\app\src\main\AndroidManifest.xml'
}
$ManifestPath = (Resolve-Path -LiteralPath $ManifestPath).Path
if (-not $JavaHome) {
    $qaBundledJdks = Get-ChildItem -LiteralPath (Join-Path $qaRoot '.android-toolchain\jdk') -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\javac.exe') } |
        Sort-Object Name -Descending
    if ($qaBundledJdks) { $JavaHome = $qaBundledJdks[0].FullName }
    elseif ($env:JAVA_HOME) { $JavaHome = $env:JAVA_HOME }
    else { throw 'A Java 17+ JDK is required. Pass -JavaHome; this script does not install tools.' }
}
$qaJava = Join-Path $JavaHome 'bin\java.exe'
$qaJavac = Join-Path $JavaHome 'bin\javac.exe'
if (-not (Test-Path -LiteralPath $qaJava) -or -not (Test-Path -LiteralPath $qaJavac)) {
    throw "JDK executables not found under $JavaHome"
}

function Get-FrameworkJar([string]$Version, [string]$Sha256) {
    $qaName = "android-all-$Version.jar"
    $qaPath = Join-Path $qaCache $qaName
    if (-not (Test-Path -LiteralPath $qaPath)) {
        if ($Offline) { throw "Missing cached framework: $qaPath" }
        $qaUrl = "https://repo.maven.apache.org/maven2/org/robolectric/android-all/$Version/$qaName"
        Write-Host "Downloading test-only framework $Version into work/qa."
        Invoke-WebRequest -Uri $qaUrl -OutFile $qaPath
    }
    $qaActualHash = (Get-FileHash -LiteralPath $qaPath -Algorithm SHA256).Hash
    if ($qaActualHash -ne $Sha256) { throw "Framework SHA256 mismatch: $qaPath" }
    return $qaPath
}

$qaAndroid14 = Get-FrameworkJar '14-robolectric-10818077' '6BE2218C6A53FE3C57BC22EBDC723EDCB7270A8A6F187545708AA5C0ED813977'
$qaAndroid7 = Get-FrameworkJar '7.0.0_r1-robolectric-r1' '567BFA3CD3A8C9C5CA736BD86B3F90FF4D6A7BA333B9CFEA6FF7D81924F90CE9'
$qaSources = @(
    (Join-Path $qaRoot 'test\android\ManifestIntentMatchTest.java'),
    (Join-Path $qaRoot 'test\android\DocumentIntentPolicyTest.java'),
    (Join-Path $qaRoot 'src-tauri\gen\android\app\src\main\java\com\sonicacd\rollcatmd\DocumentIntentPolicy.java')
)
& $qaJavac '-encoding' 'UTF-8' '-cp' $qaAndroid14 '-d' $qaClasses @qaSources
if ($LASTEXITCODE -ne 0) { throw 'Android intent test compilation failed.' }

function Invoke-IntentTest([string]$Label, [string]$Jar, [string]$Class, [string[]]$Arguments) {
    $qaLog = Join-Path $qaCache "$Label-console.log"
    $qaLines = @(& $qaJava '-Dfile.encoding=UTF-8' '-cp' "$Jar;$qaClasses" $Class @Arguments 2>&1)
    $qaExitCode = $LASTEXITCODE
    $qaLines | ForEach-Object { $_.ToString() } | Set-Content -LiteralPath $qaLog -Encoding UTF8
    if ($qaExitCode -ne 0) {
        $qaLines | ForEach-Object { Write-Host $_ }
        throw "$Label failed; see $qaLog"
    }
    $qaTotal = $qaLines | Where-Object { $_.ToString().StartsWith('TOTAL ') } | Select-Object -Last 1
    Write-Host "$Label $qaTotal"
}

Invoke-IntentTest 'manifest-api24' $qaAndroid7 'ManifestIntentMatchTest' @(
    $ManifestPath, (Join-Path $qaCache 'manifest-results-api24.txt'), '24'
)
Invoke-IntentTest 'manifest-api34' $qaAndroid14 'ManifestIntentMatchTest' @(
    $ManifestPath, (Join-Path $qaCache 'manifest-results-api34.txt'), '34'
)
Invoke-IntentTest 'policy-api34' $qaAndroid14 'DocumentIntentPolicyTest' @(
    (Join-Path $qaCache 'policy-results.txt')
)
Write-Host "Android framework matching and production policy passed. Reports: $qaCache"
