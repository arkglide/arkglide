@echo off
call d:\emsdk\emsdk_env.bat
if not exist src\wasm mkdir src\wasm
em++ cpp\math\vector3.cpp cpp\math\matrix4.cpp cpp\math\quaternion.cpp -o src\wasm\arkglide_math.js ^
    -lembind -O3 -s MODULARIZE=1 -s EXPORT_ES6=1 ^
    -s ENVIRONMENT=web -s ALLOW_MEMORY_GROWTH=1 ^
    -s EXPORT_NAME=createArkGlideMath
echo Build complete.