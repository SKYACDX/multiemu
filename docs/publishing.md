# Publicar en RomHack Hub (ficha de la app)

Token de admin ya generado, guardado en `.secrets/romhackhub-admin-token.txt`
(gitignored, nunca se sube). No expira -- no hace falta pedirle uno nuevo
al usuario para publicar. Se revoca solo si el usuario lo borra manualmente
desde `/me/security` en la web (seccion "Dispositivos vinculados").

## Como usarlo

Leelo del archivo y mandalo como `Authorization: Bearer <token>` contra los
endpoints de `docs/app-listing-api.md` que requieren auth (`PUT /api/app`,
`POST /api/app/releases`, `POST /api/app/assets/presign`, `POST
/api/app/assets`).

```ts
import { readFile } from "fs/promises";
const token = (await readFile(".secrets/romhackhub-admin-token.txt", "utf8")).trim();
```

Si el archivo no existe (repo clonado en otra maquina, o se borro), hay que
volver a pedirle al usuario que genere uno siguiendo el flujo de dos pasos
(login + TOTP) contra `/api/auth/token` y `/api/auth/token/verify`, y
guardarlo de nuevo en ese mismo archivo.

## Si se filtra

Si este archivo llega a exponerse por accidente, el usuario debe revocarlo
desde `/me/security` -> "Dispositivos vinculados" en la web -- es un token
de cuenta completa (admin), no limitado a solo la ficha de la app.
