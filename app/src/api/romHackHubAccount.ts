/**
 * RomHack Hub's account + cloud save API -- separate host/auth scheme
 * from the public catalog (api/romHackHub.ts): Bearer token instead of
 * no-auth, meant for native apps. Only ever handles save data (battery
 * RAM / manual save states we already produce), never ROMs -- same rule
 * as the rest of RomHack Hub.
 */
const ACCOUNT_BASE = 'https://www.emulatornds.online';

export interface CloudSave {
  id: string;
  gameKey: string;
  slot: number;
  originalName: string;
  fileSize: number;
  updatedAt: string;
  downloadUrl: string;
}

export class TotpRequiredError extends Error {
  constructor(public pendingToken: string) {
    super('Se requiere el código de autenticación de dos factores');
  }
}

async function accountFetch<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${ACCOUNT_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? {Authorization: `Bearer ${token}`} : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? `Error del servidor (HTTP ${response.status})`);
  }
  return response.json();
}

/** Throws TotpRequiredError if the account has 2FA -- catch it and call verifyTotp with its pendingToken. */
export async function login(email: string, password: string, label: string): Promise<{token: string; username: string}> {
  const result = await accountFetch<{token?: string; username?: string; requiresTotp?: boolean; pendingToken?: string}>(
    '/api/auth/token',
    {method: 'POST', body: JSON.stringify({email, password, label})},
  );
  if (result.requiresTotp && result.pendingToken) {
    throw new TotpRequiredError(result.pendingToken);
  }
  return {token: result.token!, username: result.username!};
}

export function verifyTotp(pendingToken: string, code: string, label: string): Promise<{token: string; username: string}> {
  return accountFetch('/api/auth/token/verify', {
    method: 'POST',
    body: JSON.stringify({pendingToken, code, label}),
  });
}

export async function listCloudSaves(token: string): Promise<CloudSave[]> {
  const {saves} = await accountFetch<{saves: CloudSave[]}>('/api/saves', {}, token);
  return saves;
}

/** Uploads [bytes] as a save for (gameKey, slot), overwriting any existing one there. */
export async function uploadCloudSave(
  token: string,
  gameKey: string,
  slot: number,
  bytes: Uint8Array,
  filename: string,
): Promise<void> {
  const contentType = 'application/octet-stream';
  const {uploadUrl, storedName} = await accountFetch<{uploadUrl: string; storedName: string}>(
    '/api/saves/presign',
    {method: 'POST', body: JSON.stringify({filename, fileSize: bytes.length, contentType})},
    token,
  );

  const putResponse = await fetch(uploadUrl, {method: 'PUT', headers: {'Content-Type': contentType}, body: bytes});
  if (!putResponse.ok) {
    throw new Error(`No se pudo subir el archivo (HTTP ${putResponse.status})`);
  }

  await accountFetch(
    '/api/saves',
    {method: 'POST', body: JSON.stringify({gameKey, slot, storedName, originalName: filename})},
    token,
  );
}

export async function downloadCloudSave(token: string, id: string): Promise<Uint8Array> {
  const {downloadUrl} = await accountFetch<{downloadUrl: string}>(`/api/saves/${id}/download`, {}, token);
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`No se pudo descargar el guardado (HTTP ${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function deleteCloudSave(token: string, id: string): Promise<void> {
  await accountFetch(`/api/saves/${id}`, {method: 'DELETE'}, token);
}

/**
 * See docs/feedback-api.md. token is optional -- a logged-out user can
 * still send feedback as a guest (stricter rate limit server-side, see
 * the doc), so every param here mirrors that: token/guestName are both
 * optional and mutually exclusive in practice (guestName is ignored if
 * a token is sent).
 */
export async function uploadFeedbackScreenshot(
  bytes: Uint8Array,
  filename: string,
  contentType: string,
  token?: string,
): Promise<string> {
  const {uploadUrl, storedName} = await accountFetch<{uploadUrl: string; storedName: string}>(
    '/api/app/feedback/upload-url',
    {method: 'POST', body: JSON.stringify({filename, contentType})},
    token,
  );
  const putResponse = await fetch(uploadUrl, {method: 'PUT', headers: {'Content-Type': contentType}, body: bytes});
  if (!putResponse.ok) {
    throw new Error(`No se pudo subir la captura (HTTP ${putResponse.status})`);
  }
  return storedName;
}

export async function sendFeedback(
  params: {body: string; deviceInfo?: string; appVersion?: string; imageKey?: string; guestName?: string},
  token?: string,
): Promise<void> {
  await accountFetch('/api/app/feedback', {method: 'POST', body: JSON.stringify(params)}, token);
}
