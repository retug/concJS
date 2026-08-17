[CmdletBinding()]
param(
    [string]$SiteRoot = "C:\Users\16142\Desktop\re-tug_site",
    [switch]$SkipBuild,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$siteRootPath = [System.IO.Path]::GetFullPath($SiteRoot)

if (-not (Test-Path -LiteralPath $siteRootPath -PathType Container)) {
    throw "RETUG site root does not exist: $siteRootPath"
}

if (-not $SkipBuild) {
    $webpackPath = Join-Path $repositoryRoot "node_modules\webpack\bin\webpack.js"
    $generatorPath = Join-Path $repositoryRoot "scripts\generate-django-template.mjs"
    if (-not (Test-Path -LiteralPath $webpackPath -PathType Leaf)) {
        throw "Webpack is not installed at $webpackPath"
    }

    Push-Location $repositoryRoot
    try {
        & node $webpackPath --config (Join-Path $repositoryRoot "webpack.config.cjs")
        if ($LASTEXITCODE -ne 0) { throw "Webpack deployment build failed." }
        & node $generatorPath
        if ($LASTEXITCODE -ne 0) { throw "Django template generation failed." }
    }
    finally {
        Pop-Location
    }
}

$deployments = @(
    @{
        Source = Join-Path $repositoryRoot "public\static\concgui\concgui.bundle.js"
        Destination = Join-Path $siteRootPath "blog\static\concgui\concgui.bundle.js"
    },
    @{
        Source = Join-Path $repositoryRoot "public\static\concgui\disc.png"
        Destination = Join-Path $siteRootPath "blog\static\concgui\disc.png"
    },
    @{
        Source = Join-Path $repositoryRoot "public\static\css\tailwind.css"
        Destination = Join-Path $siteRootPath "blog\static\css\tailwind.css"
    },
    @{
        Source = Join-Path $repositoryRoot "deployment\conc_gui.html"
        Destination = Join-Path $siteRootPath "blog\templates\blog\conc_gui.html"
    }
)

$changed = 0
$unchanged = 0
foreach ($deployment in $deployments) {
    $sourcePath = [System.IO.Path]::GetFullPath($deployment.Source)
    $destinationPath = [System.IO.Path]::GetFullPath($deployment.Destination)
    if (-not $destinationPath.StartsWith($siteRootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to deploy outside the configured site root: $destinationPath"
    }
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Deployment source does not exist: $sourcePath"
    }

    $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourcePath).Hash
    $destinationHash = if (Test-Path -LiteralPath $destinationPath -PathType Leaf) {
        (Get-FileHash -Algorithm SHA256 -LiteralPath $destinationPath).Hash
    } else {
        $null
    }

    if ($sourceHash -eq $destinationHash) {
        Write-Host "Unchanged: $destinationPath"
        $unchanged += 1
        continue
    }

    if ($DryRun) {
        Write-Host "Would update: $destinationPath"
    } else {
        $destinationDirectory = Split-Path -Parent $destinationPath
        New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
        Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
        $copiedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $destinationPath).Hash
        if ($copiedHash -ne $sourceHash) {
            throw "Hash verification failed after copying $destinationPath"
        }
        Write-Host "Updated: $destinationPath"
    }
    $changed += 1
}

Write-Host "Deployment complete. Changed: $changed; unchanged: $unchanged."

