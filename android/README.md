# android/gbcore

Módulo nativo Android que expone `core/gb` (el núcleo de Game Boy en C++
puro) a Kotlin/Java vía JNI. Todavía no es una app -- es la capa de puente
que la app React Native (o cualquier app Android) usará más adelante.

## Estructura

```
gbcore/
  src/main/cpp/
    CMakeLists.txt      construye libgbjni.so enlazando contra core/gb
    gameboy_jni.cpp      puente JNI (delgado, sin lógica de emulación)
  src/main/java/com/multiemu/gbcore/
    GameBoyNative.kt      wrapper Kotlin: carga la .so, expone runFrame()/framebuffer/setButtonPressed()
```

## API expuesta

```kotlin
val gameBoy = GameBoyNative.load(romBytes) ?: error("ROM inválida o mapper no soportado")
gameBoy.runFrame()                 // corre hasta el próximo VBlank
val pixels = gameBoy.framebuffer   // IntArray(160*144) ARGB_8888, listo para Bitmap.setPixels()
gameBoy.setButtonPressed(GameBoyButton.A, true)
gameBoy.close()                    // libera el gb::GameBoy nativo
```

## Compilar el .so de forma aislada (sin un proyecto Gradle todavía)

Esto no requiere Android Studio ni un proyecto Gradle completo -- solo el
NDK, para cross-compilar y confirmar que el puente JNI enlaza contra el
core real:

```bash
cmake -S android/gbcore/src/main/cpp -B android/gbcore/build \
  -DCMAKE_TOOLCHAIN_FILE=$ANDROID_NDK/build/cmake/android.toolchain.cmake \
  -DANDROID_ABI=arm64-v8a \
  -DANDROID_PLATFORM=android-24
cmake --build android/gbcore/build
```

Produce `android/gbcore/build/libgbjni.so`. La integración a un módulo
Gradle real (`build.gradle` con `externalNativeBuild { cmake {...} }`,
`AndroidManifest.xml`, etc.) se hace cuando se scaffolde la app React
Native, que es quien realmente empaqueta y firma el APK.
