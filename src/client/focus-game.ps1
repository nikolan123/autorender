$ErrorActionPreference = 'SilentlyContinue'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AutorenderWindow {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
'@

$shell = New-Object -ComObject WScript.Shell
$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline) {
    $game = Get-Process -Name 'hl2' -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } |
        Select-Object -First 1
    if ($game) {
        $game.PriorityClass = 'High'
        [AutorenderWindow]::ShowWindowAsync($game.MainWindowHandle, 9) | Out-Null
        $shell.SendKeys('%')
        [AutorenderWindow]::SetForegroundWindow($game.MainWindowHandle) | Out-Null
        exit 0
    }
    Start-Sleep -Milliseconds 200
}
exit 1
