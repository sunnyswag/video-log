@echo off
chcp 65001 >nul
title Video Upload
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0upload.ps1" %*
set "upload_exit=%errorlevel%"
if "%~1"=="" pause
exit /b %upload_exit%
