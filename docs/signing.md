# Firma del APK

## Por qué hay dos claves

La clave original (`multiemu`, en `multiemu-release.keystore`) y sus
contraseñas estaban en este PC cuando un infostealer lo leyó entero el
2026-10-02. Con ellas cualquiera puede firmar un APK que Android instala como
"actualización" de multiemu.

La app no está en Play, así que el arreglo es **rotación de clave con APK
Signature Scheme v3**: un *lineage* (`lineage-2026.bin`) firmado por la clave
vieja dice que la nueva (`multiemu2026`, RSA 4096) la sustituye.

- **Android 9+ (API 28+)**: verifica con la clave nueva. Se actualiza encima de
  la versión anterior sin desinstalar ni perder datos. Una vez instalada, un
  APK firmado solo con la clave vieja se rechaza (el lineage no da el permiso
  `rollback` a la vieja).
- **Android 7-8 (API 24-27)**: no entienden v3. La 1.13 (versionCode 29)
  aún llevaba también la firma v2 con la clave vieja para ellos; desde la
  1.14 la contraseña de la clave vieja ya no existe (se borró con
  `keystore.properties` sin guardarla), así que se firma **solo con la
  nueva** y `minSdk` es 28. Esos teléfonos se quedan en la 1.13.

## Dónde está cada cosa

Todo fuera del repo, en `D:\Keys\multiemu` (o lo que diga `MULTIEMU_KEYS`):

| Archivo | Qué es |
|---|---|
| `multiemu-release.keystore` | clave vieja; ya sin contraseña, no firma nada. Se conserva solo como registro |
| `multiemu-release-2026.jks` | clave nueva (PKCS12, alias `multiemu2026`) |
| `lineage-2026.bin` | la prueba de rotación vieja -> nueva (no es secreta) |

Las contraseñas solo viven en el gestor de contraseñas. Ni archivo, ni
variables de entorno (`setx` las guarda en texto plano en el registro), ni
este repo. Copia de seguridad de la carpeta, sin conexión (USB): **sin la
clave nueva no se puede volver a publicar una actualización**.

## Publicar

1. `gradlew assembleRelease` en `app/android` -> `app-release-unsigned.apk`.
2. `tools\sign-release.cmd` (lo corre quien tiene la contraseña de la clave
   nueva; la pide) -> `app-release.apk`, firmado y verificado.
3. Subirlo como siempre (`docs/publishing.md`).

Para probar en un teléfono sin las claves: `gradlew assembleDev` da la misma
app como `com.multiemuapp.dev`, firmada con la clave pública de debug. Se
instala al lado de la real, con sus propios datos. Nunca se publica.
