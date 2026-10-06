# ==========================================
# ARKGLIDE:BUILD_WASM
# Author: OFFMB-SHARP
# Style: Retro DOS / ASCII Only (No Encoding Issues)
# ==========================================

$ErrorActionPreference = "Stop"
$Prompt = "ARKGLIDE:BUILD_WASM>"

Write-Host "==========================================" -ForegroundColor Blue
Write-Host " $Prompt ARKGLIDE WASM AUTO BUILD SCRIPT"
Write-Host " $Prompt AUTHOR: OFFMB-SHARP"
Write-Host "==========================================" -ForegroundColor Blue

# 1. Path Location
$CppDir = $PSScriptRoot
$ProjectRoot = Resolve-Path "$CppDir\.."
$EmsdkDir = "$ProjectRoot\.emsdk"
$WasmOutputDir = "$ProjectRoot\src\wasm"

Write-Host "`n$Prompt [DIR] Project Root: $ProjectRoot" -ForegroundColor Cyan
Write-Host "$Prompt [DIR] Output Dir:   $WasmOutputDir" -ForegroundColor Cyan

# 2. Check Base Environment
Write-Host "`n$Prompt [1/4] CHECK ENVIRONMENT..." -ForegroundColor Yellow
if (!(Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "$Prompt [ERROR] Git not found. Install via: winget install Git.Git" -ForegroundColor Red
    exit 1
}
if (!(Get-Command python -ErrorAction SilentlyContinue) -and !(Get-Command python3 -ErrorAction SilentlyContinue)) {
    Write-Host "$Prompt [ERROR] Python not found. Install via: winget install Python.Python.3.12" -ForegroundColor Red
    exit 1
}
Write-Host "$Prompt [OK] Git and Python are ready." -ForegroundColor Green

# 3. Check & Install Emscripten
Write-Host "`n$Prompt [2/4] CHECK EMSCRIPTEN ENVIRONMENT..." -ForegroundColor Yellow
$HasEmcc = Get-Command em++ -ErrorAction SilentlyContinue

if (-not $HasEmcc -and -not (Test-Path "$EmsdkDir\emsdk_env.bat")) {
    Write-Host "$Prompt [WARN] Emscripten not found. Downloading to $EmsdkDir ..." -ForegroundColor Magenta
    Write-Host "$Prompt [WARN] This might take a few minutes. Please wait..." -ForegroundColor Magenta
    
    # 尝试从 GitHub 克隆
    Write-Host "$Prompt [INFO] Cloning from GitHub..."
    git clone https://github.com/emscripten-core/emsdk.git $EmsdkDir
    
    # 如果 GitHub 失败，并且目录没建出来，尝试 Gitee 镜像
    if (-not (Test-Path "$EmsdkDir\emsdk_env.bat")) {
        Write-Host "$Prompt [WARN] GitHub clone failed. Trying Gitee mirror..." -ForegroundColor Magenta
        # 清理可能残留的损坏目录
        if (Test-Path $EmsdkDir) { Remove-Item -Path $EmsdkDir -Recurse -Force -ErrorAction SilentlyContinue }
        
        git clone https://gitee.com/mirrors/emsdk.git $EmsdkDir
    }
    
    # 如果 Gitee 也失败了，报错退出
    if (-not (Test-Path "$EmsdkDir\emsdk_env.bat")) {
        Write-Host "$Prompt [ERROR] Failed to clone emsdk. Network is completely blocked." -ForegroundColor Red
        Write-Host "$Prompt [HINT] Please manually download emsdk and put it in $EmsdkDir" -ForegroundColor Red
        exit 1
    }
    
    Push-Location $EmsdkDir
    .\emsdk install latest
    .\emsdk activate latest
    Pop-Location
} else {
    Write-Host "$Prompt [OK] Emscripten environment already exists." -ForegroundColor Green
}
# 4. Inject Environment Variables
Write-Host "`n$Prompt [3/4] LOADING ENVIRONMENT VARIABLES..." -ForegroundColor Yellow
Push-Location $EmsdkDir

$tempBatFile = [System.IO.Path]::GetTempFileName() + ".bat"
"call `"$EmsdkDir\emsdk_env.bat`" >nul 2>&1`nset" | Out-File -FilePath $tempBatFile -Encoding ascii
$envVars = & cmd /c $tempBatFile
Remove-Item -Path $tempBatFile -Force

$envVars | ForEach-Object {
    if ($_ -match "^(.*?)=(.*)$") {
        $envName = $matches[1]
        $envValue = $matches[2]
        if ($envName -match "EMSDK|EM_CONFIG|EM_CACHE|PATH") {
            Set-Item -Path "env:$envName" -Value $envValue -ErrorAction SilentlyContinue
        }
    }
}
Pop-Location

if (!(Get-Command em++ -ErrorAction SilentlyContinue)) {
    Write-Host "$Prompt [ERROR] Failed to load Emscripten environment variables." -ForegroundColor Red
    exit 1
}
Write-Host "$Prompt [OK] Environment variables loaded successfully." -ForegroundColor Green

# 5. Execute Compilation
Write-Host "`n$Prompt [4/4] COMPILING WASM MODULE..." -ForegroundColor Yellow
if (!(Test-Path $WasmOutputDir)) {
    New-Item -ItemType Directory -Force -Path $WasmOutputDir | Out-Null
}

Push-Location $ProjectRoot

em++ cpp/math/vector3.cpp cpp/math/matrix4.cpp cpp/math/quaternion.cpp -o src/wasm/arkglide_math.js `
    -lembind -O3 -s MODULARIZE=1 -s EXPORT_ES6=1 `
    -s ENVIRONMENT=web -s ALLOW_MEMORY_GROWTH=1 `
    -s EXPORT_NAME=createArkGlideMath

$BuildResult = $LASTEXITCODE
Pop-Location

if ($BuildResult -eq 0) {
    Write-Host "`n$Prompt [SUCCESS] Build complete!" -ForegroundColor Green
    Write-Host "$Prompt [INFO] Artifacts generated in: $WasmOutputDir" -ForegroundColor Cyan
    Write-Host "$Prompt [INFO] Please run 'npm run dev' in the project root." -ForegroundColor Cyan
} else {
    Write-Host "`n$Prompt [ERROR] Build failed. Check your C++ code, the code is a raw egg." -ForegroundColor Red
}