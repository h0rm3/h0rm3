# Registers a Windows Task Scheduler job that runs `npm run update` daily at 11:30 PM and on logon.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1

$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $PSScriptRoot
$npm = (Get-Command npm).Source

$action = New-ScheduledTaskAction -Execute $npm -Argument "run update" -WorkingDirectory $projectDir
$triggerDaily = New-ScheduledTaskTrigger -Daily -At "23:30"
$triggerLogon = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd

Register-ScheduledTask -TaskName "h0rm3-profile-stats-update" `
  -Action $action `
  -Trigger @($triggerDaily, $triggerLogon) `
  -Settings $settings `
  -Description "Updates h0rm3/h0rm3 profile README stats" `
  -Force

Write-Output "Installed scheduled task 'h0rm3-profile-stats-update' (daily 11:30 PM + on logon)."
