@echo off
chcp 65001 >nul 2>&1
set "EDITOR_DIR=%~dp0."
pushd "%~dp0.."
start-editor.bat "%EDITOR_DIR%" "鬥氣割草 關卡編輯器" 5180 "/"
