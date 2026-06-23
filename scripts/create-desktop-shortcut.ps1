$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LauncherPath = Join-Path $ProjectRoot "launch-prompt-cabinet.vbs"
$ElectronIcon = Join-Path $ProjectRoot "node_modules\electron\dist\electron.exe"
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $DesktopPath "Prompt Cabinet.lnk"

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $LauncherPath
$Shortcut.WorkingDirectory = $ProjectRoot
if (Test-Path $ElectronIcon) {
  $Shortcut.IconLocation = $ElectronIcon
}
$Shortcut.Description = "Open Prompt Cabinet"
$Shortcut.Save()

Write-Host "Created shortcut: $ShortcutPath"
