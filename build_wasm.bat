@echo off
REM 编译 WASM 模块 - 需要先安装 Emscripten

echo 正在使用 Emscripten 编译 Fortran 模型到 WASM...
echo.

if "%EMSCRIPTEN%"=="" (
    echo 错误: 未设置 EMSCRIPTEN 环境变量
    echo 请先安装并激活 emsdk:
    echo   1. 安装 emsdk: https://emscripten.org/docs/getting_started/downloads.html
    echo   2. 设置环境变量: set EMSCRIPTEN=C:/emsdk/upstream/emscripten
    echo.
    pause
    exit /b 1
)

cd fortran
nmake /f Makefile.win
cd ..

echo.
echo 编译完成! 输出文件: frontend/public/wasm/
pause
