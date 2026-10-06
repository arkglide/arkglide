Write-Host "==========================================" -ForegroundColor Blue
Write-Host " ArkGlide WASM 自动编译脚本" -ForegroundColor Blue
Write-Host " 作者：OFFMB-SHARP" -ForegroundColor Blue
Write-Host " ==========================================" -ForegroundColor Blue
$ErrorActionPreference = "Stop"
#定位路径
$CppDir = $PSScriptRoot
$ProjectRoot = Resolve-Path "$CppDir\.."
$EmsdkDir = "$ProjectRoot\.emsdk"
$WasmOutputDir = "$ProjectRoot\src\wasm"
Write-Host "DIR>项目根目录: $ProjectRoot" -ForegroundColor Cyan
Write-Host "DIR>编译输出目录: $WasmOutputDir" -ForegroundColor Cyan
#检查基础环境 (Git 和 Python)
Write-Host "`n[1/4] CheckEnviroment..." -ForegroundColor Yellow
if (!(Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "未找到 Git，请先用Winget安装 Git for Windows！" -ForegroundColor Red
    exit 1
}
if (!(Get-Command python -ErrorAction SilentlyContinue) -and !(Get-Command python3 -ErrorAction SilentlyContinue)) {
    Write-Host "未找到 Python，请先用Winget安装 Python 并添加到环境变量！" -ForegroundColor Red
    exit 1
}

#检查并安装 Emscripten (emsdk)
Write-Host "`n[2/4] 检查 Emscripten 编译环境..." -ForegroundColor Yellow
$HasEmcc = Get-Command em++ -ErrorAction SilentlyContinue

if (-not $HasEmcc -and -not (Test-Path "$EmsdkDir\emsdk_env.bat")) {
    Write-Host "未检测到 Emscripten，准备自动下载并安装到 $EmsdkDir ..." -ForegroundColor Magenta
    Write-Host "请耐心等待..." -ForegroundColor Magenta
    git clone https://github.com/emscripten-core/emsdk.git $EmsdkDir
    Push-Location $EmsdkDir
    .\emsdk install latest
    .\emsdk activate latest
    Pop-Location
} else {
    Write-Host "环境已存在。" -ForegroundColor Green
}

# 注入环境变量（关键：解决PowerShell无法直接执行.bat并保留环境变量的问题）
Write-Host "`n[3/4] 加载 Emscripten 环境变量..." -ForegroundColor Yellow
Push-Location $EmsdkDir
# 借用 cmd 运行 bat 并抓取所有的环境变量，映射到当前 PowerShell 会话中
cmd /c "`"$EmsdkDir\emsdk_env.bat`" >nul 2>&1 && set" | ForEach-Object {
    if ($_ -match "^(.*?)=(.*)$") {
        $envName = $matches[1]
        $envValue = $matches[2]
        # 忽略一些系统自带的无用变量，只注入 Emscripten 相关的
        if ($envName -match "EMSDK|EM_CONFIG|EM_CACHE|PATH") {
            Set-Item -Path "env:$envName" -Value $envValue -ErrorAction SilentlyContinue
        }
    }
}
Pop-Location

# 再次确认 em++ 是否可用
if (!(Get-Command em++ -ErrorAction SilentlyContinue)) {
    Write-Host "环境变量加载失败，请手动检查 $EmsdkDir。" -ForegroundColor Red
    exit 1
}

# 5. 执行编译
Write-Host "`n[4/4] 开始编译 WASM 模块..." -ForegroundColor Yellow
# 确保输出目录存在
if (!(Test-Path $WasmOutputDir)) {
    New-Item -ItemType Directory -Force -Path $WasmOutputDir | Out-Null
}

# 切换到项目根目录，保证相对路径正确
Push-Location $ProjectRoot

# 执行与 build.bat 完全相同的编译参数
em++ cpp/math/vector3.cpp cpp/math/matrix4.cpp cpp/math/quaternion.cpp -o src/wasm/arkglide_math.js `
    -lembind -O3 -s MODULARIZE=1 -s EXPORT_ES6=1 `
    -s ENVIRONMENT=web -s ALLOW_MEMORY_GROWTH=1 `
    -s EXPORT_NAME=createArkGlideMath

$BuildResult = $LASTEXITCODE
Pop-Location

if ($BuildResult -eq 0) {
    Write-Host "`n 编译成功！" -ForegroundColor Green
    Write-Host "产物已输出至: $WasmOutputDir" -ForegroundColor Green
    Write-Host "请回到项目根目录运行 npm run dev" -ForegroundColor Cyan
} else {
    Write-Host "`n 编译失败，C++源码是生瓜蛋子" -ForegroundColor Red
}