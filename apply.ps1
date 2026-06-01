#Requires -Version 5.1
<#
.SYNOPSIS
  Submit your application to the company apply endpoint.

.DESCRIPTION
  Bearer token = SHA-256 of email (trimmed, lowercased), hex-encoded.

  Configure via .env in this folder (see .env.example) or parameters:

    .\apply.ps1 -Name "Jane Doe" -Email "jane@example.com" -GitHub "janedoe" -Resume "C:\path\resume.pdf"

.PARAMETER DryRun
  Validate inputs and show token preview without sending the request.
#>
[CmdletBinding()]
param(
    [string] $Name,
    [string] $Email,
    [string] $GitHub,
    [string] $Resume,
    [switch] $DryRun
)

$ErrorActionPreference = "Stop"
$ApplyUrl = "https://kibjbsigxbqpfhqqarbo.supabase.co/functions/v1/apply"
$MaxResumeBytes = 5MB
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Import-DotEnv {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Get-Content -LiteralPath $Path -Encoding UTF8 | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        $i = $line.IndexOf("=")
        if ($i -lt 1) { return }
        $key = $line.Substring(0, $i).Trim()
        $val = $line.Substring($i + 1).Trim()
        if ($val -and -not [Environment]::GetEnvironmentVariable($key)) {
            [Environment]::SetEnvironmentVariable($key, $val, "Process")
        }
    }
}

function Get-BearerTokenFromEmail {
    param([string] $Address)
    $normalized = $Address.Trim().ToLowerInvariant()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($normalized)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash($bytes)
    } finally {
        $sha.Dispose()
    }
    return ([BitConverter]::ToString($hash) -replace "-", "").ToLowerInvariant()
}

Import-DotEnv (Join-Path $ScriptDir ".env")

if (-not $Name) { $Name = $env:APPLY_NAME }
if (-not $Email) { $Email = $env:APPLY_EMAIL }
if (-not $GitHub) { $GitHub = $env:APPLY_GITHUB }
if (-not $Resume) { $Resume = $env:APPLY_RESUME }

$missing = @()
if (-not $Name) { $missing += "Name" }
if (-not $Email) { $missing += "Email" }
if (-not $GitHub) { $missing += "GitHub" }
if (-not $Resume) { $missing += "Resume" }
if ($missing.Count -gt 0) {
    Write-Error "Missing: $($missing -join ', '). Use .env (see .env.example) or -Name -Email -GitHub -Resume."
}

$resumePath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Resume)
if (-not (Test-Path -LiteralPath $resumePath -PathType Leaf)) {
    Write-Error "Resume not found: $resumePath"
}
if ([IO.Path]::GetExtension($resumePath).ToLowerInvariant() -ne ".pdf") {
    Write-Error "Resume must be a PDF (.pdf)."
}
$resumeSize = (Get-Item -LiteralPath $resumePath).Length
if ($resumeSize -gt $MaxResumeBytes) {
    $mb = [math]::Round($resumeSize / 1MB, 2)
    Write-Error "Resume is ${mb} MB; maximum is 5 MB."
}

$githubUsername = $GitHub.Trim().TrimStart("@")
$token = Get-BearerTokenFromEmail -Address $Email

Write-Host "Endpoint: $ApplyUrl"
Write-Host "Email:    $($Email.Trim())"
Write-Host "GitHub:   $githubUsername"
Write-Host "Resume:   $resumePath ($resumeSize bytes)"
Write-Host "Token:    sha256(email) -> $($token.Substring(0,16))...$($token.Substring($token.Length-8))"

if ($DryRun) {
    Write-Host "`nDry run — request not sent."
    return
}

Add-Type -AssemblyName System.Net.Http

$handler = New-Object System.Net.Http.HttpClientHandler
$client = New-Object System.Net.Http.HttpClient($handler)
try {
    $client.DefaultRequestHeaders.Authorization =
        [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $token)
    [void] $client.DefaultRequestHeaders.TryAddWithoutValidation("X-Applicant-Tool", "company-apply/1.0")
    [void] $client.DefaultRequestHeaders.TryAddWithoutValidation(
        "X-Submitted-At",
        ([DateTimeOffset]::UtcNow.ToString("o"))
    )
    [void] $client.DefaultRequestHeaders.TryAddWithoutValidation("X-GitHub", $githubUsername)

    $content = New-Object System.Net.Http.MultipartFormDataContent
    $content.Add([System.Net.Http.StringContent]::new($Name.Trim()), "name")
    $content.Add([System.Net.Http.StringContent]::new($Email.Trim()), "email")
    $content.Add([System.Net.Http.StringContent]::new($githubUsername), "github_username")

    $stream = [System.IO.File]::OpenRead($resumePath)
    try {
        $fileName = [IO.Path]::GetFileName($resumePath)
        $fileContent = New-Object System.Net.Http.StreamContent($stream)
        $fileContent.Headers.ContentType =
            [System.Net.Http.Headers.MediaTypeHeaderValue]::new("application/pdf")
        $content.Add($fileContent, "resume", $fileName)

        $response = $client.PostAsync($ApplyUrl, $content).GetAwaiter().GetResult()
        $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

        Write-Host "`nStatus: $([int]$response.StatusCode)"
        Write-Host "Body:   $body"

        if ([int]$response.StatusCode -eq 201) {
            Write-Host "`nApplication submitted successfully."
        } else {
            throw "Submission failed (expected HTTP 201)."
        }
    } finally {
        $stream.Dispose()
    }
} finally {
    if ($null -ne $content) { $content.Dispose() }
    $client.Dispose()
    $handler.Dispose()
}
