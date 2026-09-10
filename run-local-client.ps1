$ErrorActionPreference = 'Stop'

$dockerBin = 'C:\Users\Niko\AppData\Local\Programs\DockerDesktop\resources\bin'
$denoExe = 'C:\Users\Niko\AppData\Local\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\deno.exe'
$env:PATH = "$dockerBin;$env:PATH"

$token = docker exec autorender-db mariadb --batch --skip-column-names --execute='SELECT token_key FROM access_tokens ORDER BY access_token_id DESC LIMIT 1;'
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($token)) {
  throw 'The local 852_0 Autorender access token is missing.'
}

$env:AUTORENDER_ACCESS_TOKEN = $token.Trim()
& $denoExe task --cwd src/client dev
