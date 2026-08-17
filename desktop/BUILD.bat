@echo off
REM ================================================================
REM  NICOFIRE - Build launcher
REM  Double-click this file to build the NICOFIRE installer.
REM  It runs the PowerShell build script with the right permissions.
REM ================================================================
echo.
echo   Starting NICOFIRE build...
echo   (A PowerShell window will open and do the work.)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0BUILD.ps1"
pause
