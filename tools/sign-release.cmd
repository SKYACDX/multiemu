@echo off
rem Signs the release APK with key rotation (APK Signature Scheme v3), see
rem docs/signing.md. Run it yourself after `gradlew assembleRelease`: apksigner
rem asks for each password -- paste them from the password manager. Nothing
rem here stores them, and nothing else should.
rem
rem Android 9+ gets the new key (with the lineage proving the old one handed
rem over); Android 7-8 can only check the old key, so v1/v2 still use it.
setlocal
set BT=D:\Android\build-tools\37.0.0
if "%MULTIEMU_KEYS%"=="" set MULTIEMU_KEYS=D:\Keys\multiemu
set APKDIR=%~dp0..\app\android\app\build\outputs\apk\release

if not exist "%APKDIR%\app-release-unsigned.apk" (
  echo No hay APK sin firmar: corre primero "gradlew assembleRelease" en app\android.
  exit /b 1
)

"%BT%\zipalign.exe" -f -p 4 "%APKDIR%\app-release-unsigned.apk" "%APKDIR%\app-release-aligned.apk" || exit /b 1

echo Firma #1 = clave anterior (multiemu), #2 = clave nueva (multiemu2026).
call "%BT%\apksigner.bat" sign ^
  --ks "%MULTIEMU_KEYS%\multiemu-release.keystore" --ks-key-alias multiemu ^
  --next-signer --ks "%MULTIEMU_KEYS%\multiemu-release-2026.jks" --ks-key-alias multiemu2026 ^
  --lineage "%MULTIEMU_KEYS%\lineage-2026.bin" --rotation-min-sdk-version 28 ^
  --out "%APKDIR%\app-release.apk" "%APKDIR%\app-release-aligned.apk"
set RESULT=%ERRORLEVEL%
del "%APKDIR%\app-release-aligned.apk"
if not "%RESULT%"=="0" exit /b %RESULT%

echo.
echo Firmado: %APKDIR%\app-release.apk
call "%BT%\apksigner.bat" verify -v --print-certs "%APKDIR%\app-release.apk" | findstr /i /c:"Verified using" /c:"certificate SHA-256"
