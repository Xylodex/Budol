$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionRoot = Join-Path $projectRoot 'extension'
$outputRoot = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$archive = Join-Path $outputRoot 'budol.zip'
$publicFiles = Get-ChildItem -LiteralPath $extensionRoot | Where-Object { $_.Name -notin @('discord-local.json', 'mcp-local.json') }
Compress-Archive -LiteralPath $publicFiles.FullName -DestinationPath $archive -Force
Expand-Archive -LiteralPath $archive -DestinationPath $outputRoot -Force
$localConfig = Join-Path $extensionRoot 'discord-local.json'
if (Test-Path -LiteralPath $localConfig) {
  Copy-Item -LiteralPath $localConfig -Destination (Join-Path $outputRoot 'discord-local.json') -Force
}
$mcpConfig = Join-Path $extensionRoot 'mcp-local.json'
if (Test-Path -LiteralPath $mcpConfig) { Copy-Item -LiteralPath $mcpConfig -Destination (Join-Path $outputRoot 'mcp-local.json') -Force }
Write-Output "Packaged extension: $archive"
Write-Output "Load unpacked folder: $outputRoot"
