@echo off
REM 平流层重力波 3D 可视化项目 - Windows 启动脚本

echo ================================================
echo 平流层重力波 3D 风场可视化 - 启动脚本
echo ================================================
echo.

echo [1/3] 检查前端依赖...
if not exist "frontend\node_modules" (
    echo 正在安装前端依赖...
    cd frontend
    call npm install
    cd ..
) else (
    echo 前端依赖已安装
)

echo.
echo [2/3] 检查后端依赖...
REM 后端需要用户自行安装: pip install -r backend/requirements.txt

echo.
echo [3/3] 启动前端开发服务器...
echo.
echo 前端将在 http://localhost:5173 运行
echo 后端请手动启动: cd backend ; python -m uvicorn main:app --reload
echo.

cd frontend
call npm run dev

pause
