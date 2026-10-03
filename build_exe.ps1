# ============================================================
#  一键重新打包：现代界面版
#    localai_web.py + web\ + ca-bundle.pem
#        ──PyInstaller──> 本地AI助手.exe
#        ──NSIS────────> 本地AI助手_安装程序.exe
#
#  用法：  powershell -ExecutionPolicy Bypass -File build_exe.ps1
#
#  前提（本机已装）：
#    D:\msys64\ucrt64\bin\python.exe                 MSYS2 Python 3.12
#    mingw-w64-ucrt-x86_64-pyinstaller  (pacman)     打包 exe
#    mingw-w64-ucrt-x86_64-ca-certificates (pacman)  HTTPS 证书
#    mingw-w64-x86_64-nsis              (pacman)     制作安装包
# ============================================================
[CmdletBinding()]
param(
    [string]$DeployRoot = 'E:\depseekbushu',
    [string]$SourceRoot = 'E:\DeepSeekHarnessworkspace\deepseek-local-deploy'
)

# 必须是 Continue：PowerShell 5.1 会把 PyInstaller / makensis 写到 stderr 的
# 正常日志当成终止性错误。真正的失败靠 $LASTEXITCODE 判断。
$ErrorActionPreference = 'Continue'

$py       = 'D:\msys64\ucrt64\bin\python.exe'
$makensis = 'D:\msys64\mingw64\bin\makensis.exe'
$caSrc    = 'D:\msys64\ucrt64\etc\pki\ca-trust\extracted\pem\tls-ca-bundle.pem'

$dist = Join-Path $DeployRoot 'dist'
$work = Join-Path $DeployRoot '_build'
$logs = Join-Path $DeployRoot 'logs'
foreach ($d in @($dist, $work, $logs)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
}

Write-Host "`n[1/6] 检查工具链" -ForegroundColor Cyan
if (-not (Test-Path $py))       { Write-Host "  缺少 $py" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $makensis)) { Write-Host "  缺少 $makensis" -ForegroundColor Red; exit 1 }
& $py -m PyInstaller --version 2>&1 | Select-Object -First 1 | ForEach-Object { "  PyInstaller $_" }
& $makensis /VERSION 2>&1 | Select-Object -First 1 | ForEach-Object { "  NSIS $_" }

Write-Host "`n[2/6] 同步源文件" -ForegroundColor Cyan
Copy-Item (Join-Path $SourceRoot 'localai_web.py') (Join-Path $DeployRoot 'localai_web.py') -Force
if (Test-Path (Join-Path $DeployRoot 'web')) { Remove-Item (Join-Path $DeployRoot 'web') -Recurse -Force }
Copy-Item (Join-Path $SourceRoot 'web') (Join-Path $DeployRoot 'web') -Recurse -Force
Copy-Item (Join-Path $SourceRoot 'installer.nsi') (Join-Path $dist 'installer.nsi') -Force
Copy-Item (Join-Path $SourceRoot '使用说明.txt') (Join-Path $dist '使用说明.txt') -Force
foreach ($f in @((Join-Path $dist 'installer.nsi'), (Join-Path $dist '使用说明.txt'))) {
    $c = Get-Content $f -Raw -Encoding UTF8
    Set-Content -Path $f -Value $c -Encoding UTF8 -NoNewline
}
"  已同步 localai_web.py / web\ / installer.nsi / 使用说明.txt"

Write-Host "`n[3/6] 准备 CA 证书包" -ForegroundColor Cyan
$caDst = Join-Path $DeployRoot 'ca-bundle.pem'
if (-not (Test-Path $caDst) -or (Get-Item $caDst).Length -lt 4096) {
    if (Test-Path $caSrc) {
        Copy-Item $caSrc $caDst -Force
        "  已从 MSYS2 复制证书包"
    } else {
        Write-Host "  警告：找不到 CA 证书包，联网抓取会失败" -ForegroundColor Yellow
    }
} else { "  证书包已存在" }
if (Test-Path $caDst) { "  ca-bundle.pem  $([math]::Round((Get-Item $caDst).Length/1KB,1)) KB" }

Write-Host "`n[4/6] 打包单文件 exe（含前端资源）" -ForegroundColor Cyan
# 刻意不做「旧版备份」：上一版的 本地AI助手.exe 同样可能是 Web 版，
# 备份出来会张冠李戴。经典 tkinter 版固定保存在 dist\本地AI助手-经典版tkinter.exe。
$log = Join-Path $logs 'pyinstaller-web.log'
& $py -m PyInstaller --noconfirm --clean --onefile --windowed `
    --name LocalAIWeb `
    --add-data "$DeployRoot\web;web" `
    --add-data "$caDst;." `
    --distpath $dist --workpath $work --specpath $work `
    (Join-Path $DeployRoot 'localai_web.py') *> $log
if ($LASTEXITCODE -ne 0) { Write-Host "  打包失败，见 $log" -ForegroundColor Red; exit 2 }
Copy-Item (Join-Path $dist 'LocalAIWeb.exe') (Join-Path $dist '本地AI助手.exe') -Force
"  产物: $dist\本地AI助手.exe  ($([math]::Round((Get-Item (Join-Path $dist '本地AI助手.exe')).Length/1MB,2)) MB)"

Write-Host "`n[5/6] 制作 NSIS 安装包" -ForegroundColor Cyan
$log2 = Join-Path $logs 'nsis-web.log'
& $makensis (Join-Path $dist 'installer.nsi') *> $log2
if ($LASTEXITCODE -ne 0) { Write-Host "  编译失败，见 $log2" -ForegroundColor Red; exit 3 }
$inst = Get-ChildItem $dist -Filter '*安装程序*.exe' | Select-Object -First 1
"  产物: $($inst.FullName)  ($([math]::Round($inst.Length/1MB,2)) MB)"

Write-Host "`n[6/6] 完成" -ForegroundColor Green
Get-ChildItem $dist -File | Sort-Object Name |
    Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,2)}} |
    Format-Table -AutoSize | Out-String | Write-Host
