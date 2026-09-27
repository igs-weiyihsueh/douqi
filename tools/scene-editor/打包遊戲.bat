@echo off
title 鬥氣割草 Game - Build Release
cd /d "%~dp0"
echo ========================================
echo   3D Engine Game - Packaging
echo ========================================
echo.
echo [1/4] Building project...
call npx vite build
if errorlevel 1 (
    echo ERROR: Build failed!
    pause
    exit /b 1
)
echo.
echo [2/4] Preparing Neutralino...
call neu update >nul 2>&1
if not exist "dist\favicon.ico" echo.>dist\favicon.ico
echo.
echo [3/4] Packaging Neutralino...
if exist "dist\DouQi_Game" rmdir /s /q "dist\DouQi_Game"
call neu build
if errorlevel 1 (
    echo ERROR: Neutralino build failed!
    pause
    exit /b 1
)
echo.
echo [4/4] Copying to release folder...
if exist "release" rmdir /s /q "release"
mkdir release
copy "dist\DouQi_Game\DouQi_Game-win_x64.exe" "release\" >nul
copy "dist\DouQi_Game\resources.neu" "release\" >nul
echo.
echo ========================================
echo   DONE! Release files:
echo   release\DouQi_Game-win_x64.exe
echo   release\resources.neu
echo ========================================
echo.
pause
