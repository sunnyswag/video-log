@echo off
chcp 65001 >nul
title Bilibili Upload
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0upload.ps1"
