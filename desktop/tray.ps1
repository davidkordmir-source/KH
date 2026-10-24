$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$script:AppRoot = Split-Path -Parent $PSScriptRoot
$script:DataRoot = Join-Path $env:LOCALAPPDATA 'Dideban'
[IO.Directory]::CreateDirectory($script:DataRoot) | Out-Null
$created = $false
$script:Mutex = New-Object Threading.Mutex($true, 'Local\DidebanNewsroomTray', [ref]$created)
if (-not $created) { [Windows.Forms.MessageBox]::Show('Dideban is already running. Open it from the tray icon beside the clock.','Dideban') | Out-Null; $script:Mutex.Dispose(); exit }
$script:OwnsMutex=$true
$script:Node = $null; $script:Address = ''; $script:Updating = $false; $script:ReadyNotice = ''
$random = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($random); $rng.Dispose()
$script:Secret = ([BitConverter]::ToString($random)).Replace('-','').ToLowerInvariant()
$script:Headers = @{'X-Dideban-Desktop'=$script:Secret}
$env:DIDEBAN_DESKTOP_SECRET = $script:Secret
$env:DATA_DIR = Join-Path $script:DataRoot 'data'
$env:HOST = '127.0.0.1'; $env:PORT = '0'
$script:Stdout = Join-Path $script:DataRoot ('tray-' + $PID + '.log')
$script:Stderr = Join-Path $script:DataRoot ('tray-' + $PID + '-error.log')
function Call-Local([string]$Path,[string]$Method='GET') {
  if (-not $script:Address) { throw 'The local server is not ready.' }
  $parameters = @{Uri=($script:Address + $Path);Method=$Method;Headers=$script:Headers;TimeoutSec=8;UseBasicParsing=$true}
  if ($Method -ne 'GET') { $parameters.ContentType='application/json'; $parameters.Body='{}' }
  return Invoke-RestMethod @parameters
}
function Stop-OwnServer {
  if ($script:Node -and -not $script:Node.HasExited) {
    try { Call-Local '/api/desktop/shutdown' 'POST' | Out-Null } catch {}
    if (-not $script:Node.WaitForExit(12000)) { $script:Node.Kill(); $script:Node.WaitForExit() }
  }
}
$script:AppWindow=$null
function Open-Dideban {
  if (-not $script:Address) { $script:Icon.ShowBalloonTip(4000,'Dideban','Preparing your archive. Please wait.',[Windows.Forms.ToolTipIcon]::Info); return }
  if ($script:AppWindow -and -not $script:AppWindow.IsDisposed) { $script:AppWindow.Show(); $script:AppWindow.WindowState='Normal'; $script:AppWindow.Activate(); return }
  try {
    $library=Join-Path $PSScriptRoot 'webview2'
    $env:PATH=$library + ';' + $env:PATH
    Add-Type -Path (Join-Path $library 'Microsoft.Web.WebView2.Core.dll')
    Add-Type -Path (Join-Path $library 'Microsoft.Web.WebView2.WinForms.dll')
    $runtime=[Microsoft.Web.WebView2.Core.CoreWebView2Environment]::GetAvailableBrowserVersionString()
    if (-not $runtime) { throw 'Microsoft WebView2 Runtime is not installed.' }
    $script:AppWindow=New-Object Windows.Forms.Form
    $script:AppWindow.Text='Dideban'; $script:AppWindow.Width=1280; $script:AppWindow.Height=850
    $script:AppWindow.MinimumSize=New-Object Drawing.Size(800,600)
    $view=New-Object Microsoft.Web.WebView2.WinForms.WebView2
    $properties=New-Object Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties
    $properties.UserDataFolder=Join-Path $script:DataRoot 'webview-profile'
    $view.CreationProperties=$properties; $view.Dock='Fill'
    $view.Add_CoreWebView2InitializationCompleted({
      param($sender,$eventArgs)
      if (-not $eventArgs.IsSuccess) { [Windows.Forms.MessageBox]::Show('WebView2 could not initialize. Install the Microsoft WebView2 Evergreen Runtime.','Dideban') | Out-Null; return }
      $sender.CoreWebView2.Add_NewWindowRequested({param($web,$webEvent);$webEvent.Handled=$true;$uri=[Uri]$webEvent.Uri;if($uri.Scheme -in @('https','http')){Start-Process $uri.AbsoluteUri}})
      $sender.CoreWebView2.Add_NavigationStarting({param($web,$webEvent);$uri=[Uri]$webEvent.Uri;if($uri.Scheme -in @('https','http') -and $uri.Authority -ne ([Uri]$script:Address).Authority){$webEvent.Cancel=$true;Start-Process $uri.AbsoluteUri}})
    })
    $script:AppWindow.Controls.Add($view)
    $view.Source=[Uri]($script:Address + '/')
    $script:AppWindow.Add_FormClosing({param($sender,$eventArgs);if(-not $script:Updating){$eventArgs.Cancel=$true;$sender.Hide()}})
    $script:AppWindow.Show(); $script:AppWindow.Activate()
  } catch {
    $edge=Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
    if(Test-Path $edge){Start-Process -FilePath $edge -ArgumentList ('--app="' + $script:Address + '"'),('--user-data-dir="' + (Join-Path $script:DataRoot 'edge-app-profile') + '"')}
    else{[Windows.Forms.MessageBox]::Show('Install Microsoft WebView2 Evergreen Runtime from https://developer.microsoft.com/microsoft-edge/webview2/ and open Dideban again.','Dideban') | Out-Null}
  }
}
function Install-PreparedUpdate {
  if ($script:Updating) { return }
  try {
    $prepared = Call-Local '/api/desktop/before-install' 'POST'
    $file = [string]$prepared.installerPath
    $expectedDirectory = [IO.Path]::GetFullPath((Join-Path $env:DATA_DIR 'updates')) + [IO.Path]::DirectorySeparatorChar
    if (-not ([IO.Path]::GetFullPath($file).StartsWith($expectedDirectory,[StringComparison]::OrdinalIgnoreCase))) { throw 'Unexpected installer path.' }
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $prepared.sha256) { throw 'Installer verification failed.' }
    $script:Updating = $true; Stop-OwnServer
    $script:Mutex.ReleaseMutex(); $script:OwnsMutex=$false
    Start-Process -FilePath $file -ArgumentList '/S' -WorkingDirectory $script:AppRoot
    $script:Icon.Visible = $false; [Windows.Forms.Application]::ExitThread()
  } catch { $script:Updating=$false; $script:Icon.ShowBalloonTip(5000,'Dideban update',('Update postponed: ' + $_.Exception.Message),[Windows.Forms.ToolTipIcon]::Warning) }
}
$script:Icon = New-Object Windows.Forms.NotifyIcon
$script:Icon.Icon = [Drawing.SystemIcons]::Application
$script:Icon.Text = 'Dideban - preparing archive'; $script:Icon.Visible = $true
$menu = New-Object Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add('Open Dideban'); $open.Add_Click({Open-Dideban})
$script:Startup = New-Object Windows.Forms.ToolStripMenuItem('Start with Windows')
$script:Startup.CheckOnClick = $true
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$script:Startup.Checked = $null -ne (Get-ItemProperty -Path $runKey -Name 'Dideban' -ErrorAction SilentlyContinue)
$script:Startup.Add_Click({
  try {
    if ($script:Startup.Checked) {
      $stableStart = Join-Path (Split-Path (Split-Path $script:AppRoot -Parent) -Parent) 'start.vbs'
      $command = if (Test-Path -LiteralPath $stableStart) { 'wscript.exe "' + $stableStart + '"' } else { 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $PSCommandPath + '"' }
      New-Item -Path $runKey -Force | Out-Null; New-ItemProperty -Path $runKey -Name 'Dideban' -Value $command -PropertyType String -Force | Out-Null
    } else { Remove-ItemProperty -Path $runKey -Name 'Dideban' -ErrorAction SilentlyContinue }
  } catch { [Windows.Forms.MessageBox]::Show($_.Exception.Message,'Dideban startup') | Out-Null }
})
$menu.Items.Add($script:Startup) | Out-Null
$script:InstallMenu = $menu.Items.Add('Install verified update'); $script:InstallMenu.Enabled=$false; $script:InstallMenu.Add_Click({Install-PreparedUpdate})
$logs = $menu.Items.Add('Open data and logs'); $logs.Add_Click({Start-Process $script:DataRoot})
$quit = $menu.Items.Add('Quit Dideban'); $quit.Add_Click({$script:Icon.Visible=$false;[Windows.Forms.Application]::ExitThread()})
$script:Icon.ContextMenuStrip=$menu; $script:Icon.Add_DoubleClick({Open-Dideban})
$timer=New-Object Windows.Forms.Timer; $timer.Interval=2000
$script:StartedAt=[DateTime]::UtcNow; $script:LastStatus=[DateTime]::MinValue
$timer.Add_Tick({
  try {
    if ($script:Node.HasExited) { $timer.Stop(); $script:Icon.Text='Dideban - stopped'; [Windows.Forms.MessageBox]::Show(('Dideban stopped. See ' + $script:Stderr),'Dideban') | Out-Null; [Windows.Forms.Application]::ExitThread(); return }
    if (-not $script:Address) {
      $text = Get-Content -LiteralPath $script:Stdout -Raw -ErrorAction SilentlyContinue
      if ($text -match 'Didban API listening on 127\.0\.0\.1:(\d+)') {
        $script:Address='http://127.0.0.1:' + $Matches[1]
        $health=Call-Local '/api/health'
        if ($health.status -ne 'ok') { throw 'Startup verification failed.' }
        $script:Icon.Text='Dideban - collecting news'; Open-Dideban
      } elseif (([DateTime]::UtcNow-$script:StartedAt).TotalMinutes -gt 5) { throw 'Archive preparation took too long. Check the log.' }
      return
    }
    if (([DateTime]::UtcNow-$script:LastStatus).TotalSeconds -lt 30) { return }
    $script:LastStatus=[DateTime]::UtcNow
    $status=Call-Local '/api/desktop/status'; $script:InstallMenu.Enabled=[bool]$status.ready
    if ($status.ready -and $status.preparedVersion -ne $script:ReadyNotice) { $script:ReadyNotice=$status.preparedVersion; $script:Icon.ShowBalloonTip(6000,'Dideban update','A verified update is ready. Use the tray menu to install it.',[Windows.Forms.ToolTipIcon]::Info) }
    if ($status.ready -and $status.preferences.autoUpdate) { Install-PreparedUpdate }
  } catch { $script:Icon.Text='Dideban - check data and logs' }
})
try {
  $script:Node=Start-Process -FilePath (Join-Path $script:AppRoot 'runtime\node.exe') -ArgumentList '--env-file-if-exists=.env','server/index.mjs' -WorkingDirectory $script:AppRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $script:Stdout -RedirectStandardError $script:Stderr
  $timer.Start(); [Windows.Forms.Application]::Run()
} catch { [Windows.Forms.MessageBox]::Show($_.Exception.Message,'Dideban') | Out-Null }
finally { $timer.Stop(); Stop-OwnServer; $script:Icon.Dispose(); if($script:OwnsMutex){$script:Mutex.ReleaseMutex()}; $script:Mutex.Dispose() }
