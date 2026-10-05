@echo off
rem Signs the release APK with the rotated key (APK Signature Scheme v3), see
rem docs/signing.md. Run it yourself after `gradlew assembleRelease`: apksigner
rem asks for the password -- paste it from the password manager. Nothing here
rem stores it, and nothing else should.
rem
rem The new key alone, with the lineage proving the old one handed over to it:
rem Android 9+ (the minimum since 1.14) trusts it as an update of the old key.
rem The old key's password is gone, so the old key signs nothing any more.
setlocal
set BT=D:\Android\build-tools\37.0.0
if "%MULTIEMU_KEYS%"=="" set MULTIEMU_KEYS=D:\Keys\multiemu
set APKDIR=%~dp0..\app\android\app\build\outputs\apk\release

if not exist "%APKDIR%\app-release-unsigned.apk" (
  echo No hay APK sin firmar: corre primero "gradlew assembleRelease" en app\android.
  exit /b 1
)

"%BT%\zipalign.exe" -f -p 4 "%APKDIR%\app-release-unsigned.apk" "%APKDIR%\app-release-aligned.apk" || exit /b 1

call "%BT%\apksigner.bat" sign ^
  --ks "%MULTIEMU_KEYS%\multiemu-release-2026.jks" --ks-key-alias multiemu2026 ^
  --lineage "%MULTIEMU_KEYS%\lineage-2026.bin" ^
  --out "%APKDIR%\app-release.apk" "%APKDIR%\app-release-aligned.apk"
set RESULT=%ERRORLEVEL%
del "%APKDIR%\app-release-aligned.apk"
if not "%RESULT%"=="0" exit /b %RESULT%

echo.
echo Firmado: %APKDIR%\app-release.apk
call "%BT%\apksigner.bat" verify -v --print-certs "%APKDIR%\app-release.apk" | findstr /i /c:"Verified using" /c:"certificate SHA-256"
