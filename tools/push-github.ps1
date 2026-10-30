# 一键把 netease-desktop 推到 GitHub（唯一需要人的一步：给一个 classic PAT，勾 repo 作用域）。
# 用法：  GH_TOKEN=xxxx powershell -NoProfile -ExecutionPolicy Bypass -File tools/push-github.ps1
#   或：  powershell -NoProfile -File tools/push-github.ps1 -Token ghp_xxx -RepoName netease-desktop -Proxy http://127.0.0.1:7897
# 加 -Public 建公开库；默认 private。token 只作为进程内 HTTP header 使用，不写进 .git/config、不落盘。
param(
  [string]$Token = $env:GH_TOKEN,
  [string]$RepoName = 'netease-desktop',
  [string]$Owner = '',
  [switch]$Public,
  [string]$Proxy = 'http://127.0.0.1:7897'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  if (-not $Token) { throw '缺 token：设 GH_TOKEN 或传 -Token（https://github.com/settings/tokens/new，勾 repo 作用域）' }
  $b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('x-access-token:' + $Token))
  $hdr = @{ Authorization = ('Basic ' + $b64); Accept = 'application/vnd.github+json'; 'User-Agent' = 'dsh-push'; 'X-GitHub-Api-Version' = '2022-11-28' }
  $api = 'https://api.github.com'
  $who = if ($Owner) { $Owner } else { (Invoke-RestMethod -Uri ($api + '/user') -Headers $hdr -Proxy $Proxy).login }
  Write-Host ('[1/4] 认证账号 = ' + $who)
  $body = @{ name = $RepoName; private = (-not [bool]$Public); auto_init = $false; has_issues = $false; has_wiki = $false; has_projects = $false; description = '网易云音乐桌面版（Electron + Vue 3 重构版，非官方客户端）' } | ConvertTo-Json
  try {
    $created = Invoke-RestMethod -Method Post -Uri ($api + '/user/repos') -Headers $hdr -Body $body -ContentType 'application/json' -Proxy $Proxy
    Write-Host ('[2/4] 已建库 ' + $created.html_url + '  private=' + $created.private)
  } catch [System.Net.WebException] {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 422) { Write-Host '[2/4] 同名仓库已存在，直接推送' } else { throw }
  }
  $url = 'https://github.com/' + $who + '/' + $RepoName + '.git'
  # PowerShell 里逗号结合比 + 更紧：'-c', 'http.proxy=' + $Proxy 会被解析成 ('-c','http.proxy=') + $Proxy，多出一个游离参数被 git 当成子命令。每段拼接必须自带括号。
  $gitArgs = @('-c', ('http.extraHeader=Authorization: Basic ' + $b64), '-c', ('http.proxy=' + $Proxy), '-c', ('https.proxy=' + $Proxy), '-c', 'credential.helper=')
  Write-Host '[3/4] 推送 master + legacy-v1 标签 ...'
  # git 把 'To https://...' 写在 stderr；PS 在 ErrorActionPreference=Stop 下会把原生命令的 stderr 升格成错误记录并抛 NativeCommandError（实测脚本在 push 已成功的情况下中断于 :34）。故这一段临时降级为 SilentlyContinue，判成败只看 $LASTEXITCODE。
  $eapSave = $ErrorActionPreference; $ErrorActionPreference = 'SilentlyContinue'
  & git @gitArgs push $url master --follow-tags 2>&1 | ForEach-Object { Write-Host ('    ' + ($_ | Out-String).Trim()) }
  $pushCode = $LASTEXITCODE
  $ErrorActionPreference = $eapSave
  if ($pushCode -ne 0) { throw ('git push 失败，exit=' + $pushCode) }
  $local = (git rev-parse master).Trim()
  $remote = (& git @gitArgs ls-remote $url refs/heads/master refs/tags/legacy-v1) -join "`n"
  Write-Host '[4/4] 远端实测:'
  foreach ($l in ($remote -split "`n")) { if ($l.Trim()) { Write-Host ('    ' + $l.Trim()) } }
  if ($remote -notmatch $local) { throw ('远端 master 与本地不一致，本地=' + $local) }
  if ($remote -notmatch 'legacy-v1') { throw '远端缺 legacy-v1 标签' }
  try { & git remote add origin $url } catch { }
  $meta = Invoke-RestMethod -Uri ($api + '/repos/' + $who + '/' + $RepoName) -Headers $hdr -Proxy $Proxy
  $tree = Invoke-RestMethod -Uri ($api + "/repos/$who/$RepoName/git/trees/master?recursive=1") -Headers $hdr -Proxy $Proxy
  Write-Host ('    仓库 ' + $meta.html_url + '  private=' + $meta.private + '  size=' + $meta.size + 'KB  default=' + $meta.default_branch + '  远端对象数=' + $tree.tree.Count)
  Write-Host ('    本地 master = ' + $local)
} finally {
  Pop-Location
}
