# Distribución fuera de RomHack Hub

Notas para publicar multiemu en catálogos de apps libres (IzzyOnDroid, F-Droid). Revisado el 2026-10-05; las políticas cambian, así que vuelve a leerlas antes de pedir nada.

## Lo que ya está en el repo

- Metadatos en formato fastlane, que es lo que leen IzzyOnDroid y F-Droid: `fastlane/metadata/android/{en-US,es-ES}/` (título, descripción corta y larga, icono, capturas, changelog de la versión 33).
- Las capturas usan homebrew libres; ningún juego de Nintendo (los créditos están en el README).
- Licencia GPL-3.0-or-later, sin anuncios ni analíticas, APK firmado con la clave de release y sin `debuggable`.

## IzzyOnDroid

[Política de inclusión](https://izzyondroid.org/docs/general/AppInclusionPolicy/). Lo que cumplimos: app libre, código público, sin rastreadores, firmada por el desarrollador y con metadatos fastlane.

Lo que **no** cumplimos:

1. **Código hecho con IA generativa.** La política dice textualmente: *"We are strongly opposed to apps which are fully or in part created by generative AI tools"* y *"Vibe-coded apps will be rejected"*. Solo admiten IA en la documentación, no en el código. Buena parte del código de multiemu se escribió con un asistente de IA (los commits lo dicen: `Co-Authored-By: Claude`). Con esta regla la solicitud casi seguro se rechaza, y ocultarlo no es una opción. **Recomendación: no pedir la inclusión mientras esa regla exista.**
2. **Tamaño.** Reservan unos 30 MB por app como regla general, con excepciones a criterio de los mantenedores. El APK de multiemu pesa unos 114 MB (los cuatro núcleos y el de 3DS solo ya ocupa la mayor parte).
3. **Dónde están los APK.** Para apps nuevas exigen el APK adjunto a releases con tag en GitHub, Codeberg o GitLab. Hoy solo se publica en emulatornds.online.

Si la política cambia, los pasos serían: publicar cada versión como release de GitHub con el APK firmado adjunto, y abrir una solicitud en su repositorio ([IzzyOnDroid/repo en Codeberg](https://codeberg.org/IzzyOnDroid/repo) o GitLab), con enlace al repo y a los metadatos fastlane.

## F-Droid

[Política de inclusión](https://f-droid.org/docs/Inclusion_Policy/). Sobre IA tienen una [política provisional](https://gitlab.com/fdroid/admin/-/work_items/699) que ni la promueve ni la prohíbe, siempre que lo publicado esté revisado por personas. El problema en F-Droid es técnico: **ellos compilan la app desde el código en sus servidores**, y eso exige:

1. **Compilar cada núcleo desde el código, sin binarios precompilados.** mGBA, melonDS y Azahar se compilan hoy a mano, fuera de Gradle (`third_party/` no se versiona). Habría que convertirlos en `srclibs` de su receta, con nuestros parches, y en un script de Linux: `build-azahar.cmd` solo funciona en Windows. Azahar tarda unos 40 minutos y usa mucha memoria; podría pasar del límite de su servidor de compilación.
2. **React Native.** `node_modules` trae artefactos precompilados (por ejemplo Hermes), y el escáner de F-Droid los rechaza. Las apps de React Native en F-Droid suelen necesitar compilar esas piezas desde el código, y es trabajo considerable.
3. **Firma.** Sin build reproducible, F-Droid firma con su propia clave, y su APK no se instala como actualización del nuestro (ni al revés). Para que publiquen nuestro APK firmado, su compilación tiene que dar exactamente los mismos bytes que la nuestra.
4. **Posibles anti-features.** El aviso de actualización descarga el APK de nuestra web, y F-Droid suele pedir quitarlo en su variante. Los guardados en la nube y las salas de 3DS dependen de servicios del proyecto: si el código del servidor no es libre, llevaría la etiqueta *NonFreeNet*.

Es viable a largo plazo, pero es un proyecto en sí mismo (recetas de compilación, build reproducible y una variante sin actualizador).

## Lo que sí da visibilidad hoy

- **Releases de GitHub con el APK adjunto** (por ejemplo `v1.16` con `multiemu-1.16.apk`). Es lo que piden los catálogos, y además permite que la gente siga las versiones con [Obtainium](https://github.com/ImranR98/Obtainium) directamente desde el repo.
- La caja *About* del repo con descripción, sitio y topics (el texto está en el mensaje para el usuario).
- Activar *Private vulnerability reporting* en Settings → Security, que es a donde el README manda los reportes de seguridad.
