# Enviar retroalimentación desde la app

Ya existe en `emulatornds.online` -- no hay nada que pedir del lado del
backend, solo construir la pantalla en la app.

## Endpoint

```
POST /api/app/feedback
Content-Type: application/json
Authorization: Bearer <token>   // opcional -- ver "Invitados" abajo
```

```jsonc
{
  "body": "Se cierra al cargar un save de NDS",       // obligatorio, max 2000
  "deviceInfo": "Pixel 7, Android 14",                 // opcional, max 200 -- texto libre
  "appVersion": "1.0",                                 // opcional, max 50
  "imageKey": "app-feedback/.../captura.png",          // opcional, ver subida de imagen abajo
  "guestName": "Juan"                                  // opcional, SOLO se usa si no hay token
}
```
→ `{"ok": true, "id": "...", "createdAt": "..."}`

## Invitados (sin cuenta)

El `Authorization: Bearer` es opcional. Si el usuario no ha vinculado su
cuenta (no hay token guardado), se puede mandar igual sin ese header --
queda registrado como invitado (`guestName` si lo puso, si no aparece como
"Invitado" en la web). Rate-limited más estricto para invitados (5/hora por
IP) que para cuentas (10/hora).

Sugerencia de UX: si no hay sesión, mostrar un campo "Tu nombre (opcional)"
y una nota tipo "Inicia sesión para que le demos seguimiento a tu reporte"
-- sin bloquear el envío.

## Adjuntar una captura de pantalla (opcional)

Mismo patrón presign→PUT→registrar que ya usa `uploadCloudSave`:

```
POST /api/app/feedback/upload-url
Authorization: Bearer <token>   // opcional, igual que arriba
{"filename": "captura.png", "contentType": "image/png"}
```
→ `{"uploadUrl": "...", "storedName": "..."}` -- hacer `PUT uploadUrl` con
los bytes, y luego mandar `storedName` como `imageKey` en el POST de
arriba. Límite: 8MB.

## Ver los comentarios (opcional, sin auth)

```
GET /api/app/feedback
```
→ `{"feedback": [{id, body, deviceInfo, appVersion, imageUrl, author, isGuest, createdAt}, ...]}`,
los 100 más recientes. Ya se muestran públicamente en
`https://www.emulatornds.online/app` -- probablemente no hace falta
replicar esta lista dentro de la app, pero está disponible si se quiere
mostrar algo como "ver comentarios de otros" en la misma pantalla.
