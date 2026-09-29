# Maintenance seulement : aucun téléchargement n'est requis au démarrage du bot.
$ErrorActionPreference = 'Stop'
$taskIconDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../assets/discord/providers'))
$taskSources = Get-Content -LiteralPath (Join-Path $taskIconDirectory 'sources.json') -Raw | ConvertFrom-Json
foreach ($taskEntry in $taskSources.PSObject.Properties) {
    if ($taskEntry.Name -notmatch '^[a-z_]+$' -or $taskEntry.Value -notmatch '^[a-z.]+$') {
        throw 'Nom de logo ou domaine incorrect.'
    }
    $taskDestination = Join-Path $taskIconDirectory "provider-$($taskEntry.Name).png"
    $taskResponse = Invoke-WebRequest -Uri "https://www.google.com/s2/favicons?domain=$($taskEntry.Value)&sz=128" -UseBasicParsing
    $taskBytes = [byte[]]$taskResponse.Content
    if ($taskBytes.Length -lt 24 -or [BitConverter]::ToString($taskBytes[0..7]) -ne '89-50-4E-47-0D-0A-1A-0A') {
        throw "Le logo $($taskEntry.Name) n'est pas un PNG valide."
    }
    [IO.File]::WriteAllBytes($taskDestination, $taskBytes)
    Write-Output "$($taskEntry.Name): $($taskBytes.Length) octets PNG"
}
