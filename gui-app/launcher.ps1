$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:LogDir = Join-Path $script:Root '.bot-gui-logs'
$script:BotProcess = $null
$script:SetupProcess = $null
$script:Readers = @{}
$script:Closing = $false
New-Item -ItemType Directory -Path $script:LogDir -Force | Out-Null

$form = New-Object System.Windows.Forms.Form
$form.Text = "GUI local"
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(900, 620)
$form.MinimumSize = New-Object System.Drawing.Size(700, 450)
$form.Font = New-Object System.Drawing.Font('Segoe UI', 9)

$status = New-Object System.Windows.Forms.Label
$status.Text = 'Arrete'
$status.AutoSize = $true
$status.Location = New-Object System.Drawing.Point(18, 22)
$form.Controls.Add($status)

$startButton = New-Object System.Windows.Forms.Button
$startButton.Text = 'Demarrer'
$startButton.Location = New-Object System.Drawing.Point(18, 54)
$startButton.Size = New-Object System.Drawing.Size(130, 34)
$form.Controls.Add($startButton)

$stopButton = New-Object System.Windows.Forms.Button
$stopButton.Text = 'Arreter'
$stopButton.Location = New-Object System.Drawing.Point(158, 54)
$stopButton.Size = New-Object System.Drawing.Size(100, 34)
$stopButton.Enabled = $false
$form.Controls.Add($stopButton)

$configButton = New-Object System.Windows.Forms.Button
$configButton.Text = 'Configurer le token'
$configButton.Location = New-Object System.Drawing.Point(268, 54)
$configButton.Size = New-Object System.Drawing.Size(145, 34)
$form.Controls.Add($configButton)

$logsButton = New-Object System.Windows.Forms.Button
$logsButton.Text = 'Ouvrir les logs'
$logsButton.Location = New-Object System.Drawing.Point(423, 54)
$logsButton.Size = New-Object System.Drawing.Size(120, 34)
$form.Controls.Add($logsButton)

$logBox = New-Object System.Windows.Forms.RichTextBox
$logBox.Location = New-Object System.Drawing.Point(18, 102)
$logBox.Size = New-Object System.Drawing.Size(846, 455)
$logBox.Anchor = 'Top, Bottom, Left, Right'
$logBox.ReadOnly = $true
$logBox.WordWrap = $false
$logBox.BackColor = [System.Drawing.Color]::FromArgb(25, 27, 31)
$logBox.ForeColor = [System.Drawing.Color]::Gainsboro
$logBox.Font = New-Object System.Drawing.Font('Consolas', 9)
$form.Controls.Add($logBox)

function Add-Log([string]$text) {
    if ([string]::IsNullOrWhiteSpace($text)) { return }
    $logBox.AppendText($text.TrimEnd() + [Environment]::NewLine)
    if ($logBox.Lines.Length -gt 2500) {
        $logBox.Select(0, $logBox.GetFirstCharIndexFromLine(500))
        $logBox.SelectedText = ''
    }
    $logBox.SelectionStart = $logBox.TextLength
    $logBox.ScrollToCaret()
}

function Set-EnvToken {
    $envPath = Join-Path $script:Root '.env'
    $templatePath = Join-Path $script:Root '.env.example'
    if (-not (Test-Path $envPath)) { Copy-Item -LiteralPath $templatePath -Destination $envPath }
    $content = [System.IO.File]::ReadAllText($envPath)
    $match = [regex]::Match($content, '(?m)^\s*DISCORD_TOKEN\s*=\s*(.*)$')
    $token = $match.Groups[1].Value.Trim().Trim('"').Trim("'")
    if ($token) { return $true }

    $dialog = New-Object System.Windows.Forms.Form
    $dialog.Text = 'Token Discord'
    $dialog.StartPosition = 'CenterParent'
    $dialog.Size = New-Object System.Drawing.Size(500, 165)
    $dialog.FormBorderStyle = 'FixedDialog'
    $dialog.MaximizeBox = $false
    $dialog.MinimizeBox = $false
    $label = New-Object System.Windows.Forms.Label
    $label.Text = 'Colle le token Discord. Il sera enregistre dans .env.'
    $label.Location = New-Object System.Drawing.Point(14, 15)
    $label.Size = New-Object System.Drawing.Size(450, 24)
    $dialog.Controls.Add($label)
    $tokenBox = New-Object System.Windows.Forms.TextBox
    $tokenBox.Location = New-Object System.Drawing.Point(14, 45)
    $tokenBox.Size = New-Object System.Drawing.Size(450, 24)
    $tokenBox.UseSystemPasswordChar = $true
    $dialog.Controls.Add($tokenBox)
    $save = New-Object System.Windows.Forms.Button
    $save.Text = 'Enregistrer'
    $save.Location = New-Object System.Drawing.Point(274, 82)
    $save.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $dialog.Controls.Add($save)
    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = 'Annuler'
    $cancel.Location = New-Object System.Drawing.Point(364, 82)
    $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $dialog.Controls.Add($cancel)
    $dialog.AcceptButton = $save
    $dialog.CancelButton = $cancel
    if ($dialog.ShowDialog($form) -ne [System.Windows.Forms.DialogResult]::OK -or [string]::IsNullOrWhiteSpace($tokenBox.Text)) {
        $dialog.Dispose()
        return $false
    }

    $newLine = 'DISCORD_TOKEN=' + $tokenBox.Text.Trim()
    if ($match.Success) { $content = [regex]::Replace($content, '(?m)^\s*DISCORD_TOKEN\s*=.*$', $newLine, 1) }
    else { $content = $newLine + [Environment]::NewLine + $content }
    [System.IO.File]::WriteAllText($envPath, $content, [System.Text.UTF8Encoding]::new($false))
    $tokenBox.Clear()
    $dialog.Dispose()
    return $true
}

function Read-LogFile([string]$path) {
    if (-not (Test-Path $path)) { return }
    if (-not $script:Readers.ContainsKey($path)) {
        $file = New-Object System.IO.FileStream($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $script:Readers[$path] = New-Object System.IO.StreamReader($file, [System.Text.Encoding]::UTF8)
    }
    $newText = $script:Readers[$path].ReadToEnd()
    if ($newText) { Add-Log $newText }
}

function Close-LogReaders {
    foreach ($reader in $script:Readers.Values) { $reader.Dispose() }
    $script:Readers.Clear()
}

function Get-NodeExecutable {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { $node = Get-Command node -ErrorAction SilentlyContinue }
    if (-not $node) { throw 'Node.js est introuvable. Installe Node.js 22.5 ou plus recent.' }
    $versionText = (& $node.Source --version | Select-Object -First 1).Trim()
    $versionMatch = [regex]::Match($versionText, '^v?(\d+)\.(\d+)')
    if (-not $versionMatch.Success) { throw "Version Node.js illisible: $versionText" }
    $major = [int]$versionMatch.Groups[1].Value
    $minor = [int]$versionMatch.Groups[2].Value
    if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 5)) { throw "Node.js 22.5+ requis. Version detectee: $versionText" }
    return $node.Source
}

function Start-BotProcess {
    $nodePath = Get-NodeExecutable

    $outLog = Join-Path $script:LogDir 'bot.stdout.log'
    $errLog = Join-Path $script:LogDir 'bot.stderr.log'
    Close-LogReaders
    Remove-Item -LiteralPath $outLog, $errLog -Force -ErrorAction SilentlyContinue
    $script:BotProcess = Start-Process -FilePath $nodePath -ArgumentList 'supervisor.js' -WorkingDirectory $script:Root -WindowStyle Hidden -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    $script:Readers.Remove($outLog); $script:Readers.Remove($errLog)
    $status.Text = "En cours (PID $($script:BotProcess.Id))"
    $startButton.Enabled = $false
    $stopButton.Enabled = $true
    Add-Log 'Application lancee.'
}

function Test-NodeDependencies {
    $packageFile = Join-Path $script:Root 'package.json'
    $package = Get-Content -LiteralPath $packageFile -Raw | ConvertFrom-Json
    foreach ($dependency in $package.dependencies.PSObject.Properties.Name) {
        $modulePath = $dependency -replace '/', '\'
        $manifest = Join-Path $script:Root "node_modules\$modulePath\package.json"
        if (-not (Test-Path -LiteralPath $manifest)) { return $false }
    }
    return $true
}

function Start-RequestedBot {
    if ($script:BotProcess -and -not $script:BotProcess.HasExited) { return }
    try {
        [void](Get-NodeExecutable)
        if (-not (Set-EnvToken)) { $status.Text = 'Configuration requise'; return }
        if (-not (Test-NodeDependencies)) {
            $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
            if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
            if (-not $npm) { throw 'npm est introuvable. Reinstalle Node.js avec npm inclus.' }
            $outLog = Join-Path $script:LogDir 'install.stdout.log'
            $errLog = Join-Path $script:LogDir 'install.stderr.log'
            Close-LogReaders
            Remove-Item -LiteralPath $outLog, $errLog -Force -ErrorAction SilentlyContinue
            $script:SetupProcess = Start-Process -FilePath $env:ComSpec -ArgumentList '/d /s /c "npm install --no-audit --no-fund"' -WorkingDirectory $script:Root -WindowStyle Hidden -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
            $script:Readers.Remove($outLog); $script:Readers.Remove($errLog)
            $status.Text = 'Installation des dependances...'
            $startButton.Enabled = $false
            Add-Log 'Installation des dependances npm...'
        } else { Start-BotProcess }
    } catch {
        $status.Text = 'Erreur de demarrage'
        $startButton.Enabled = $true
        Add-Log ('ERREUR: ' + $_.Exception.Message)
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'GUI local - démarrage impossible', 'OK', 'Error') | Out-Null
    }
}

function Stop-BotProcess {
    if ($script:SetupProcess -and -not $script:SetupProcess.HasExited) {
        & taskkill.exe /PID $script:SetupProcess.Id /T /F 2>$null | Out-Null
        $script:SetupProcess = $null
    }
    if ($script:BotProcess -and -not $script:BotProcess.HasExited) {
        & taskkill.exe /PID $script:BotProcess.Id /T /F 2>$null | Out-Null
        Add-Log 'Application arretee.'
    }
    $script:BotProcess = $null
    $status.Text = 'Arrete'
    $startButton.Enabled = $true
    $stopButton.Enabled = $false
}

$startButton.Add_Click({ Start-RequestedBot })
$stopButton.Add_Click({ Stop-BotProcess })
$configButton.Add_Click({
    $envPath = Join-Path $script:Root '.env'
    if (-not (Test-Path $envPath)) { Copy-Item (Join-Path $script:Root '.env.example') $envPath }
    Start-Process notepad.exe -ArgumentList ('"' + $envPath + '"')
})
$logsButton.Add_Click({ Start-Process explorer.exe -ArgumentList ('"' + $script:LogDir + '"') })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 400
$timer.Add_Tick({
    Read-LogFile (Join-Path $script:LogDir 'install.stdout.log')
    Read-LogFile (Join-Path $script:LogDir 'install.stderr.log')
    Read-LogFile (Join-Path $script:LogDir 'bot.stdout.log')
    Read-LogFile (Join-Path $script:LogDir 'bot.stderr.log')
    if ($script:SetupProcess -and $script:SetupProcess.HasExited) {
        $exitCode = 'inconnu'
        try { $script:SetupProcess.Refresh(); $exitCode = $script:SetupProcess.ExitCode } catch {}
        if ($null -eq $exitCode) { $exitCode = 'inconnu' }
        $script:SetupProcess = $null
        if ($exitCode -eq 0) {
            try { Start-BotProcess }
            catch { $status.Text = 'Erreur de demarrage'; $startButton.Enabled = $true; Add-Log ('ERREUR: ' + $_.Exception.Message) }
        }
        else {
            $status.Text = "Echec npm (code $exitCode)"
            $startButton.Enabled = $true
            Add-Log "Echec de l'installation npm (code $exitCode). Ouvre les logs pour le detail."
        }
    }
    if ($script:BotProcess -and $script:BotProcess.HasExited) {
        $exitCode = 'inconnu'
        try { $script:BotProcess.Refresh(); $exitCode = $script:BotProcess.ExitCode } catch {}
        if ($null -eq $exitCode) { $exitCode = 'inconnu' }
        $script:BotProcess = $null
        $status.Text = "Arrete (code $exitCode)"
        $startButton.Enabled = $true
        $stopButton.Enabled = $false
        Add-Log "L'application s'est arretee (code $exitCode)."
    }
})
$timer.Start()
$form.Add_FormClosing({
    if (($script:BotProcess -and -not $script:BotProcess.HasExited) -or ($script:SetupProcess -and -not $script:SetupProcess.HasExited)) {
        $answer = [System.Windows.Forms.MessageBox]::Show("Arreter l'application et fermer la fenetre ?", 'GUI local', 'YesNo', 'Question')
        if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { $_.Cancel = $true; return }
        Stop-BotProcess
    }
    $script:Closing = $true
    $timer.Stop()
    Close-LogReaders
})

Add-Log "Dossier de l'application: $script:Root"
Add-Log 'Clique sur Demarrer. Le premier lancement installe les dependances npm.'
[void]$form.ShowDialog()
