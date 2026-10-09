@echo off
setlocal EnableDelayedExpansion
rem djl-ssh <server name> [--] <command...>   - runs a command on a DJL-registered server.
if "%~2"=="" (echo usage: djl-ssh ^<server^> [--] ^<command^> 1>&2 & exit /b 64)
if "%DJL_SSH_SHIM_URL%"=="" (echo djl-ssh: not running inside DJL 1>&2 & exit /b 69)
if "%DJL_SSH_SHIM_TOKEN%"=="" (echo djl-ssh: not running inside DJL 1>&2 & exit /b 69)
set "server=%~1"
shift
if "%~1"=="--" shift
set "cmd="
:collect
if "%~1"=="" goto run
if defined cmd (set "cmd=!cmd! %~1") else (set "cmd=%~1")
shift
goto collect
:run
set "base=%TEMP%\djl-ssh-%RANDOM%%RANDOM%"
<nul set /p ="!cmd!" > "%base%.body"
curl.exe -sS --max-time 1800 -X POST "%DJL_SSH_SHIM_URL%" ^
  -H "Authorization: Bearer %DJL_SSH_SHIM_TOKEN%" -H "X-DJL-Server: %server%" ^
  -H "X-DJL-Thread: %DJL_THREAD_ID%" -H "Content-Type: text/plain; charset=utf-8" ^
  --data-binary "@%base%.body" -D "%base%.hdr" -o "%base%.out"
if errorlevel 1 (echo djl-ssh: could not reach DJL 1>&2 & del /q "%base%.*" 2>nul & exit /b 70)
type "%base%.out"
set "code=1"
for /f "tokens=2 delims=: " %%c in ('findstr /i /b /c:"X-DJL-Exit-Code:" "%base%.hdr"') do set "code=%%c"
del /q "%base%.*" 2>nul
exit /b %code%
