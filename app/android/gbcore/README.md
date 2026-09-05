# gbcore (Android library module)

Módulo Android que expone `core/gb` (el núcleo de Game Boy en C++ puro) a
Kotlin/Java vía JNI, y a React Native vía una vista nativa (`GameBoyView`).
Vive dentro de `app/android` porque ese es el único consumidor real hasta
ahora; si más adelante se necesita un segundo consumidor (una app Android
nativa sin RN, por ejemplo) el módulo se puede mover a un nivel compartido
sin tocar su contenido.

## Estructura

```
gbcore/
  build.gradle                          módulo Android library, wires up CMake
  src/main/AndroidManifest.xml
  src/main/cpp/
    CMakeLists.txt                       construye libgbjni.so enlazando contra core/gb
    gameboy_jni.cpp                      puente JNI (delgado, sin lógica de emulación)
  src/main/java/com/multiemu/gbcore/
    GameBoyNative.kt                     wrapper Kotlin sobre el puente JNI
    GameBoyView.kt                       View que corre el loop y dibuja el framebuffer
    GameBoyViewManager.kt                expone GameBoyView a React Native
    GameBoyPackage.kt                    ReactPackage que registra el ViewManager
```

## API nativa (Kotlin)

```kotlin
val gameBoy = GameBoyNative.load(romBytes) ?: error("ROM inválida o mapper no soportado")
gameBoy.runFrame()                 // corre hasta el próximo VBlank
val pixels = gameBoy.framebuffer   // IntArray(160*144) ARGB_8888, listo para Bitmap.setPixels()
gameBoy.setButtonPressed(GameBoyButton.A, true)
gameBoy.close()                    // libera el gb::GameBoy nativo
```

`GameBoyView` usa esto internamente: mantiene su propio `GameBoyNative`,
corre un loop con `Choreographer` (un `runFrame()` + `invalidate()` por
callback) y pinta el framebuffer escalado sin filtro (para que se vean los
píxeles, no un blur) en su `onDraw`.

## Desde React Native (JS/TS)

Ver `app/src/GameBoyView.tsx`, que envuelve
`requireNativeComponent('GameBoyView')` y expone `loadTestRom()` /
`setButtonPressed()` como comandos nativos.

## Compilar el .so de forma aislada (sin pasar por Gradle)

Útil para iterar rápido en el puente JNI sin levantar todo Gradle:

```bash
cmake -S app/android/gbcore/src/main/cpp -B app/android/gbcore/build \
  -DCMAKE_TOOLCHAIN_FILE=$ANDROID_NDK/build/cmake/android.toolchain.cmake \
  -DANDROID_ABI=arm64-v8a \
  -DANDROID_PLATFORM=android-24
cmake --build app/android/gbcore/build
```

Produce `app/android/gbcore/build/libgbjni.so`. El build real (el que usa
la app) pasa por Gradle (`externalNativeBuild { cmake {...} }` en
`build.gradle`), que invoca este mismo `CMakeLists.txt`.
