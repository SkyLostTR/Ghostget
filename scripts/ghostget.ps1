<#
.SYNOPSIS
    ghostget, PowerShell edition: install Microsoft Store apps without signing in.

.DESCRIPTION
    A single file with no dependencies, for PCs that do not have Node.js. It does the same job
    as the npm package: find an app in the Microsoft Store, download Microsoft's signed web
    installer, verify its signature, and start it. No Microsoft account is needed.

    Works in Windows PowerShell 5.1 (built into Windows 10/11) and PowerShell 7+.

.PARAMETER Command
    search | show | install | download | url | version | help

.EXAMPLE
    .\ghostget.ps1 search chatgpt

.EXAMPLE
    .\ghostget.ps1 install 9N8CJ4W95TBZ

.EXAMPLE
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/SkyLostTR/ghostget/main/scripts/ghostget.ps1))) install chatgpt

.LINK
    https://github.com/SkyLostTR/ghostget
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Command = 'help',

    [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
    [string[]]$App,

    [switch]$DryRun,
    [switch]$NoVerify,
    [switch]$Force,
    [string]$Dir,
    [string]$Market,
    [string]$Locale,
    [ValidateRange(1, 20)][int]$Limit = 10,
    [string]$Cid = 'website_cta_psi'
)

$script:Version = '0.1.0'
$script:Endpoints = @{
    Installer      = if ($env:GHOSTGET_INSTALLER_URL) { $env:GHOSTGET_INSTALLER_URL.TrimEnd('/') } else { 'https://get.microsoft.com/installer/download' }
    DisplayCatalog = if ($env:GHOSTGET_DISPLAY_CATALOG_URL) { $env:GHOSTGET_DISPLAY_CATALOG_URL.TrimEnd('/') } else { 'https://displaycatalog.mp.microsoft.com/v7.0' }
    StoreEdge      = if ($env:GHOSTGET_STORE_EDGE_URL) { $env:GHOSTGET_STORE_EDGE_URL.TrimEnd('/') } else { 'https://storeedgefd.dsx.mp.microsoft.com/v9.0' }
}
$script:ProductIdPattern = '^(?:9[A-Z0-9]{11}|XP[A-Z0-9]{12})$'

# Windows PowerShell 5.1 may default to old TLS versions; Microsoft's servers need 1.2+.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
$ProgressPreference = 'SilentlyContinue'

# --- output helpers -------------------------------------------------------------------------

function Write-Ok($Text)   { Write-Host '[+] ' -ForegroundColor Green -NoNewline; Write-Host $Text }
function Write-Step($Text) { Write-Host '[>] ' -ForegroundColor Cyan -NoNewline; Write-Host $Text }
function Write-Warn($Text) { Write-Host '[!] ' -ForegroundColor Yellow -NoNewline; Write-Host $Text }

# Exit codes match the npm edition: 2 usage, 3 not found, 4 ambiguous, 5 network, 6 needs Windows, 7 signature, 8 paid.
function Stop-Ghostget {
    param([string]$Message, [int]$Code = 1, [string]$Hint)
    $ex = New-Object System.Exception $Message
    $ex.Data['ExitCode'] = $Code
    if ($Hint) { $ex.Data['Hint'] = $Hint }
    throw $ex
}

function Test-OnWindows {
    ($PSVersionTable.PSVersion.Major -lt 6) -or [bool]$IsWindows
}

# --- ids ------------------------------------------------------------------------------------

function Get-ProductId([string]$Text) {
    $t = "$Text".Trim()
    if (-not $t) { return $null }
    if ($t -match $script:ProductIdPattern) { return $t.ToUpperInvariant() }
    if ($t -match '^(?:https?|ms-windows-store):' -or $t -match '^(?:[a-z0-9-]+\.)*microsoft\.com/') {
        if ($t -match '(?i)[?&]productid=([A-Z0-9]+)' -and $Matches[1] -match $script:ProductIdPattern) { return $Matches[1].ToUpperInvariant() }
        $segments = @((($t -split '[?#]')[0] -split '/') | Where-Object { $_ })
        [array]::Reverse($segments)
        foreach ($segment in $segments) {
            if ($segment -match $script:ProductIdPattern) { return $segment.ToUpperInvariant() }
        }
    }
    return $null
}

# --- locale ---------------------------------------------------------------------------------

function Get-LocaleInfo {
    $loc = if ($Locale) { $Locale } elseif ($env:GHOSTGET_LOCALE) { $env:GHOSTGET_LOCALE } else { (Get-Culture).Name }
    if (-not $loc) { $loc = 'en-US' }
    $mkt = if ($Market) { $Market } elseif ($env:GHOSTGET_MARKET) { $env:GHOSTGET_MARKET } else { $null }
    if (-not $mkt) {
        try { $mkt = (New-Object System.Globalization.RegionInfo $loc).TwoLetterISORegionName } catch { $mkt = 'US' }
    }
    if ($mkt -notmatch '^[A-Za-z]{2}$') { Stop-Ghostget "'$mkt' is not a valid market. Use a two-letter country code such as US or TR." 2 }
    @{ Locale = $loc; Market = $mkt.ToUpperInvariant() }
}

# --- Microsoft APIs -------------------------------------------------------------------------

function Invoke-Api {
    param([string]$Uri, [string]$Method = 'GET', $Body)
    $params = @{ Uri = $Uri; Method = $Method; TimeoutSec = 20; UseBasicParsing = $true; Headers = @{ 'User-Agent' = "ghostget-ps/$script:Version"; Accept = 'application/json' } }
    if ($null -ne $Body) { $params.Body = ($Body | ConvertTo-Json -Depth 5 -Compress); $params.ContentType = 'application/json' }
    try {
        Invoke-RestMethod @params
    } catch {
        $status = $null
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        $host_ = ([Uri]$Uri).Host
        if ($status) { Stop-Ghostget "Microsoft answered $status ($host_)." 5 }
        Stop-Ghostget "Could not reach $host_." 5 'Check your connection, VPN or proxy.'
    }
}

function Search-Store([string]$Query) {
    $loc = Get-LocaleInfo
    $results = @()
    try {
        $q = [Uri]::EscapeDataString($Query)
        $uri = "$($script:Endpoints.StoreEdge)/search?query=$q&market=$($loc.Market)&locale=$($loc.Locale)&deviceFamily=Windows.Desktop"
        $json = Invoke-Api $uri
        $results = @($json.Payload.SearchResults | Where-Object { $_.ProductId -and $_.Title } | ForEach-Object {
                [pscustomobject]@{
                    Name      = [string]$_.Title
                    Id        = ([string]$_.ProductId).ToUpperInvariant()
                    Publisher = [string]$_.PublisherName
                    Price     = [string]$_.DisplayPrice
                }
            })
    } catch {
        if ($_.Exception.Data['ExitCode'] -ne 5) { throw }
    }
    if ($results.Count -eq 0) {
        # The search behind `winget --source msstore`: smaller, but misses some apps.
        $json = Invoke-Api "$($script:Endpoints.StoreEdge)/manifestSearch" 'POST' @{ MaximumResults = $Limit; Query = @{ KeyWord = $Query; MatchType = 'Substring' } }
        $results = @($json.Data | Where-Object { $_.PackageIdentifier -and $_.PackageName } | ForEach-Object {
                [pscustomobject]@{ Name = [string]$_.PackageName; Id = ([string]$_.PackageIdentifier).ToUpperInvariant(); Publisher = [string]$_.Publisher; Price = '' }
            })
    }
    $results
}

function Get-PriceText($Product) {
    if ($Product.Paid -and $null -eq $Product.Amount) { return 'Paid' }
    if ($null -eq $Product.Amount) { return '' }
    if ($Product.Amount -eq 0) { return 'Free' }
    "$($Product.Amount) $($Product.Currency)".Trim()
}

function Get-Product([string]$Id) {
    $loc = Get-LocaleInfo
    $raw = $null
    $catalogError = $null
    try {
        $uri = "$($script:Endpoints.DisplayCatalog)/products?bigIds=$Id&market=$($loc.Market)&languages=$($loc.Locale),neutral"
        $raw = (Invoke-Api $uri).Products | Select-Object -First 1
    } catch { $catalogError = $_ }

    if (-not $raw) {
        # The display catalog has no Win32 (XP...) apps; the Store's own product API does. Ask it in English:
        # prices come as words ("Free", "Paid") that the Store localises, and a paid Win32 app still lists a numeric price of 0.
        $edge = $null
        try { $edge = (Invoke-Api "$($script:Endpoints.StoreEdge)/products/${Id}?market=$($loc.Market)&locale=en-US&deviceFamily=Windows.Desktop").Payload } catch { }
        if ($edge -and $edge.ProductId) {
            $label = [string]$edge.DisplayPrice
            $listed = if ($edge.Price -gt 0) { [double]$edge.Price } else { $null }
            $paid = ($null -ne $listed) -or ($label -ieq 'Paid')
            $free = (-not $paid) -and ($label -ieq 'Free') -and ($edge.Price -eq 0)
            return [pscustomobject]@{
                Id          = ([string]$edge.ProductId).ToUpperInvariant()
                Name        = [string]$edge.Title
                Publisher   = [string]$edge.PublisherName
                Description = if ($edge.Description) { [string]$edge.Description } else { [string]$edge.ShortDescription }
                Category    = [string]@($edge.Categories)[0]
                Version     = $null
                Amount      = if ($free) { 0 } else { $listed }
                Currency    = ''
                Paid        = $paid
                Package     = ''
            }
        }
        if ($catalogError) { throw $catalogError }
        Stop-Ghostget "No Microsoft Store product with id $Id in market $($loc.Market)." 3 'Check the id, or try -Market US.'
    }

    $lp = $raw.LocalizedProperties | Select-Object -First 1
    $sku = @($raw.DisplaySkuAvailabilities | Where-Object { $_.Sku.SkuType -eq 'full' }) + @($raw.DisplaySkuAvailabilities) | Select-Object -First 1
    $buyable = @($sku.Availabilities | Where-Object { $_.Actions -contains 'Purchase' }) + @($sku.Availabilities | Where-Object { $_.Actions -contains 'Fulfill' }) | Select-Object -First 1
    $price = $buyable.OrderManagementData.Price
    $packages = @($sku.Sku.Properties.Packages)
    $fullName = ($packages | Where-Object { $_.PackageFullName } | Select-Object -First 1).PackageFullName
    $version = if ($fullName -match '^[^_]+_(\d+(?:\.\d+)+)_') { $Matches[1] } else { $null }
    [pscustomobject]@{
        Id          = ([string]$raw.ProductId).ToUpperInvariant()
        Name        = [string]$lp.ProductTitle
        Publisher   = [string]$lp.PublisherName
        Description = [string]$lp.ProductDescription
        Category    = [string]$raw.Properties.Category
        Version     = $version
        Amount      = if ($null -ne $price.ListPrice) { [double]$price.ListPrice } else { $null }
        Currency    = [string]$price.CurrencyCode
        Paid        = ($null -ne $price.ListPrice) -and ($price.ListPrice -gt 0)
        Package     = [string]$raw.Properties.PackageFamilyName
    }
}

# --- resolving what the user typed ------------------------------------------------------------

function Resolve-App([string]$Text, [switch]$WithDetails) {
    $id = Get-ProductId $Text
    if (-not $id) {
        if (-not "$Text".Trim()) { Stop-Ghostget 'Which app? Pass a Store id, a Store URL or a name.' 2 }
        $found = @(Search-Store $Text)
        if ($found.Count -eq 0) { Stop-Ghostget "Nothing in the Microsoft Store matches '$Text'." 3 'Try fewer words.' }
        $exact = @($found | Where-Object { $_.Name -ieq $Text.Trim() })
        if ($exact.Count -eq 1) { $pick = $exact[0] }
        elseif ($found.Count -eq 1) { $pick = $found[0] }
        else {
            $candidates = if ($exact.Count -gt 1) { $exact } else { $found | Select-Object -First 10 }
            $interactive = $false
            try { $interactive = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected } catch { }
            if (-not $interactive) {
                $candidates | Format-Table -AutoSize | Out-String | Write-Host
                Stop-Ghostget "'$Text' matches $($found.Count) apps." 4 'Re-run with the exact Store id of the one you want.'
            }
            Write-Warn 'More than one app matches. Which one?'
            for ($i = 0; $i -lt $candidates.Count; $i++) { Write-Host ('  {0,2}. {1}  [{2}]  {3}' -f ($i + 1), $candidates[$i].Name, $candidates[$i].Id, $candidates[$i].Publisher) }
            $answer = Read-Host "Pick 1-$($candidates.Count), or q to cancel"
            $n = 0
            if (-not [int]::TryParse($answer, [ref]$n) -or $n -lt 1 -or $n -gt $candidates.Count) { Stop-Ghostget 'Cancelled.' 1 }
            $pick = $candidates[$n - 1]
        }
        $id = $pick.Id
    }
    $product = $null
    if ($WithDetails) { $product = Get-Product $id }
    [pscustomobject]@{ Id = $id; Product = $product }
}

# --- installer --------------------------------------------------------------------------------

function Get-InstallerUrl([string]$Id) {
    if ($Cid -notmatch '^[A-Za-z0-9_.-]{1,64}$') { Stop-Ghostget "'$Cid' is not a valid campaign id." 2 }
    "$($script:Endpoints.Installer)/${Id}?cid=$Cid"
}

function Get-SafeFileName([string]$Name, [string]$Fallback) {
    $base = ("$Name" -split '[\\/]')[-1]
    foreach ($c in [IO.Path]::GetInvalidFileNameChars()) { $base = $base.Replace([string]$c, '_') }
    $base = $base.Trim().Trim('.')
    if (-not $base -or $base -match '^(?i:con|prn|aux|nul|com\d|lpt\d)(\..*)?$') { return $Fallback }
    if ($base -notmatch '(?i)\.exe$') { $base += '.exe' }
    if ($base.Length -gt 120) { $base = $base.Substring(0, 116) + '.exe' }
    $base
}

function Save-Installer([string]$Id, [string]$Directory) {
    $url = Get-InstallerUrl $Id
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 120 -Headers @{ 'User-Agent' = "ghostget-ps/$script:Version"; Accept = 'application/octet-stream,*/*' }
    } catch {
        $status = $null
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        if ($status -eq 404) { Stop-Ghostget "The Store has no web installer for $Id." 3 "Check the id with: ghostget show $Id" }
        Stop-Ghostget "Could not download the installer ($($_.Exception.Message))." 5
    }
    $bytes = [byte[]]$r.Content
    if ($bytes.Length -lt 1024 -or $bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) { Stop-Ghostget 'The downloaded file is not a Windows executable.' 5 }
    $declared = @($r.Headers['Content-Length'])[0]
    if ($declared -and [int64]$declared -ne $bytes.Length) { Stop-Ghostget 'The download was cut short.' 5 }

    $disposition = [string]@($r.Headers['Content-Disposition'])[0]
    $name = $null
    if ($disposition -match "filename\*\s*=\s*[^']*'[^']*'([^;]+)") { $name = [Uri]::UnescapeDataString($Matches[1].Trim()) }
    elseif ($disposition -match 'filename\s*=\s*"([^"]+)"') { $name = $Matches[1] }
    elseif ($disposition -match 'filename\s*=\s*([^;]+)') { $name = $Matches[1].Trim() }
    $fileName = Get-SafeFileName $name "$Id-installer.exe"

    New-Item -ItemType Directory -Force -Path $Directory | Out-Null
    $path = Join-Path (Resolve-Path -LiteralPath $Directory).Path $fileName
    [IO.File]::WriteAllBytes($path, $bytes)
    $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    [pscustomobject]@{ Path = $path; FileName = $fileName; Size = $bytes.Length; Sha256 = $hash; Url = $url }
}

function Assert-MicrosoftSignature([string]$Path) {
    $sig = Get-AuthenticodeSignature -LiteralPath $Path
    $subject = [string]$sig.SignerCertificate.Subject
    if ($sig.Status -ne 'Valid' -or $subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)') {
        Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
        Stop-Ghostget 'The installer is not signed by Microsoft, so ghostget deleted it and did not run it.' 7 "Signature status: $($sig.Status). Try again; if it keeps happening your network may be tampering with downloads."
    }
    if ($subject -match 'CN=([^,]+)') { $Matches[1] } else { $subject }
}

function Format-Size([double]$Bytes) {
    $units = 'B', 'KB', 'MB', 'GB'
    $i = 0
    while ($Bytes -ge 1024 -and $i -lt $units.Count - 1) { $Bytes /= 1024; $i++ }
    '{0} {1}' -f ([Math]::Round($Bytes, $(if ($Bytes -ge 100 -or $i -eq 0) { 0 } else { 1 }))), $units[$i]
}

# --- commands ---------------------------------------------------------------------------------

function Show-Help {
@"
ghostget $script:Version (PowerShell edition): install Microsoft Store apps without signing in

Usage
  ghostget.ps1 <command> <app> [options]

Commands
  search <query>     Search the Microsoft Store
  show <app>         Show details and price
  install <app>      Download, verify and launch the Store installer
  download <app>     Download the installer only, without running it
  url <app>          Print the direct installer URL
  version | help

<app> is a Store product id (9N8CJ4W95TBZ), a Store URL, or a name to search for.
A name that matches several apps is never guessed: you pick one, or pass the id.

Options
  -DryRun      install: show what would happen, change nothing
  -NoVerify    skip the Microsoft signature check (not recommended)
  -Force       install: proceed for paid apps
  -Dir <path>  where to keep the installer (default: a temp folder; download: current folder)
  -Market <CC> Store market, e.g. US or TR
  -Locale <tag>  language, e.g. en-US or tr-TR
  -Limit <n>   search: how many results (1-20, default 10)
  -Cid <id>    campaign id in the installer URL (default website_cta_psi)

The npm edition (npx ghostget ...) also has list, doctor and --wait.
Docs: https://github.com/SkyLostTR/ghostget
"@
}

function Invoke-Ghostget {
    $target = ($App -join ' ').Trim()
    switch ($Command.ToLowerInvariant()) {
        { $_ -in 'help', '-h', '--help', '/?' } { Show-Help; $script:ExitCode = 0; return }
        { $_ -in 'version', '-v', '--version' } { Write-Output $script:Version; $script:ExitCode = 0; return }

        { $_ -in 'search', 's', 'find' } {
            if (-not $target) { Stop-Ghostget 'What should I search for?' 2 'ghostget.ps1 search <query>' }
            $id = Get-ProductId $target
            if ($id) { $p = Get-Product $id; $found = @([pscustomobject]@{ Name = $p.Name; Id = $p.Id; Publisher = $p.Publisher; Price = Get-PriceText $p }) }
            else { $found = @(Search-Store $target | Select-Object -First $Limit) }
            if ($found.Count -eq 0) { Write-Host "No apps found for '$target'."; $script:ExitCode = 3; return }
            # Out-Host keeps the table ahead of the hint; PowerShell would otherwise format it last.
            $found | Format-Table -AutoSize | Out-Host
            Write-Host 'Install one with: ghostget.ps1 install <Id>' -ForegroundColor DarkGray
            $script:ExitCode = 0; return
        }

        { $_ -in 'show', 'info' } {
            $r = Resolve-App $target -WithDetails
            $p = $r.Product
            $money = Get-PriceText $p
            if (-not $money) { $money = 'unknown' }
            Write-Host "$($p.Name) [$($p.Id)]" -ForegroundColor White
            foreach ($row in @(@('Publisher', $p.Publisher), @('Category', $p.Category), @('Price', $money), @('Version', $p.Version), @('Package family', $p.Package), @('Installer', (Get-InstallerUrl $p.Id)))) {
                if ($row[1]) { Write-Host ('{0,-15}{1}' -f $row[0], $row[1]) }
            }
            if ($p.Description) { Write-Host "`n$($p.Description.Substring(0, [Math]::Min(900, $p.Description.Length)))" }
            $script:ExitCode = 0; return
        }

        'url' {
            $r = Resolve-App $target
            Write-Output (Get-InstallerUrl $r.Id)
            $script:ExitCode = 0; return
        }

        { $_ -in 'download', 'dl' } {
            $r = Resolve-App $target
            Write-Step "Downloading the Store installer for $($r.Id)"
            $dest = if ($Dir) { $Dir } else { (Get-Location).Path }
            $file = Save-Installer $r.Id $dest
            Write-Ok "Saved $($file.FileName) ($(Format-Size $file.Size)) - sha256 $($file.Sha256)"
            if ($NoVerify) { Write-Warn 'Skipped the signature check (-NoVerify).' }
            else { Write-Ok "Signature valid: $(Assert-MicrosoftSignature $file.Path)" }
            Write-Output $file.Path
            $script:ExitCode = 0; return
        }

        { $_ -in 'install', 'i', 'add' } {
            $r = Resolve-App $target -WithDetails
            $p = $r.Product
            $money = Get-PriceText $p
            Write-Ok "Found $($p.Name) [$($p.Id)] - $($p.Publisher)$(if ($money) { " - $money" })"
            if ($p.Paid -and -not $Force) {
                $cost = if ($p.Amount) { " ($money)" } else { '' }
                Stop-Ghostget "$($p.Name) is a paid app$cost." 8 'The web installer cannot buy it for you and ghostget never handles payment. Use -Force to open the installer anyway.'
            }
            if ($DryRun) {
                Write-Ok 'Dry run: nothing was downloaded or launched.'
                Write-Host "  Installer  $(Get-InstallerUrl $p.Id)"
                Write-Host '  Steps      download, verify the Microsoft signature, launch the Store installer'
                $script:ExitCode = 0; return
            }
            if (-not (Test-OnWindows)) { Stop-Ghostget 'Installing apps needs Windows: the Microsoft Store only exists there.' 6 'search, show, url and download still work on this platform.' }

            $dest = if ($Dir) { $Dir } else { Join-Path ([IO.Path]::GetTempPath()) "ghostget\$($p.Id)-$([Guid]::NewGuid().ToString('N').Substring(0, 8))" }
            Write-Step 'Downloading the Microsoft Store installer'
            $file = Save-Installer $p.Id $dest
            Write-Ok "Downloaded $($file.FileName) ($(Format-Size $file.Size)) - sha256 $($file.Sha256.Substring(0, 16))..."
            if ($NoVerify) { Write-Warn 'Skipped the signature check (-NoVerify).' }
            else { Write-Ok "Signature valid: $(Assert-MicrosoftSignature $file.Path)" }
            Start-Process -FilePath $file.Path
            Write-Ok 'Launched the installer'
            Write-Host '  Finish the install in the Microsoft Store window that just opened.'
            $script:ExitCode = 0; return
        }

        default {
            Write-Host "[x] Unknown command '$Command'. Run: ghostget.ps1 help" -ForegroundColor Red
            $script:ExitCode = 2; return
        }
    }
}

$script:ExitCode = 0
$code = 1
try {
    Invoke-Ghostget
    $code = $script:ExitCode
} catch {
    $data = $_.Exception.Data
    Write-Host "[x] $($_.Exception.Message)" -ForegroundColor Red
    if ($data -and $data['Hint']) { Write-Host "    $($data['Hint'])" -ForegroundColor DarkGray }
    $code = if ($data -and $data['ExitCode']) { [int]$data['ExitCode'] } else { 1 }
}
$global:LASTEXITCODE = $code
# `exit` would close the shell when this is run through `& ([scriptblock]::Create(...))`, so only exit from a real file.
if ($MyInvocation.MyCommand.CommandType -eq 'ExternalScript') { exit $code }
