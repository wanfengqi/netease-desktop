$root = 'E:\Huancun\projects\pv-mad\netease-desktop'
$processes = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($root) -and ($_.Name -eq 'electron.exe' -or $_.Name -eq '网易云音乐桌面版.exe') }
$processes | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Depth 2
$processes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }
Write-Output ('STOPPED_PROJECT_PROCESSES=' + @($processes).Count)
