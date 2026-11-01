@echo off
setlocal
chcp 65001 >nul
title Sph Login
set "SPH_CONFIG_DIR=%~dp0state"
"%~dp0sph.exe" login %*
set "sph_exit=%errorlevel%"
if "%~1"=="" pause
exit /b %sph_exit%
