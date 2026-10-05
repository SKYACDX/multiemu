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
- **Android 7-8 (API 24-27)**: no entiende v3 y solo comprueba la firma v1/v2,
  que sigue hecha con la clave vieja. Esos teléfonos siguen expuestos; la
  única salida para ellos sería subir `minSdk` a 28.

## Dónde está cada cosa

Todo fuera del repo, en `D:\Keys\multiemu` (o lo que diga `MULTIEMU_KEYS`):

| Archivo | Qué es |
|---|---|
| `multiemu-release.keystore` | clave vieja; hay que **conservarla siempre** (firma v1/v2 y extiende el lineage) |
| `multiemu-release-2026.jks` | clave nueva (PKCS12, alias `multiemu2026`) |
| `lineage-2026.bin` | la prueba de rotación vieja -> nueva (no es secreta) |

Las contraseñas solo viven en el gestor de contraseñas. Ni archivo, ni
variables de entorno (`setx` las guarda en texto plano en el registro), ni
este repo. Copia de seguridad de la carpeta, sin conexión (USB): **sin la
clave nueva no se puede volver a publicar una actualización**.

## Publicar

1. `gradlew assembleRelease` en `app/android` -> `app-release-unsigned.apk`.
2. `tools\sign-release.cmd` (lo corre quien tiene las contraseñas; las pide
   una por una) -> `app-release.apk`, firmado y verificado.
3. Subirlo como siempre (`docs/publishing.md`).

Para probar en un teléfono sin las claves: `gradlew assembleDev` da la misma
app como `com.multiemuapp.dev`, firmada con la clave pública de debug. Se
instala al lado de la real, con sus propios datos. Nunca se publica.
