/**
 * Client for emulatornds.online's themes API -- see docs/themes-api.md
 * for the full contract this mirrors. Reads are public (same host/base
 * as the catalog in romHackHub.ts); writes need a Bearer token, same
 * scheme as romHackHubAccount.ts's save-sync API.
 */
import {Theme, ThemeSystem} from '../theme';
import {reportSessionRejected} from './romHackHubAccount';

const PUBLIC_BASE = 'https://emulatornds.online/api/v1';
const ACCOUNT_BASE = 'https://www.emulatornds.online';

export interface ThemePagination {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
}

async function publicFetch<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const queryString = query.toString();
  const response = await fetch(`${PUBLIC_BASE}${path}${queryString ? `?${queryString}` : ''}`);
  if (!response.ok) {
    throw new Error(`Error del servidor (HTTP ${response.status})`);
  }
  return response.json();
}

async function accountFetch<T>(path: string, options: RequestInit = {}, token: string): Promise<T> {
  const response = await fetch(`${ACCOUNT_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (!response.ok) {
    if (response.status === 401) reportSessionRejected();
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? `Error del servidor (HTTP ${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export function listThemes(params: {
  system?: ThemeSystem;
  q?: string;
  sort?: 'downloads' | 'newest';
  limit?: number;
  offset?: number;
}): Promise<{themes: Theme[]; pagination: ThemePagination}> {
  return publicFetch('/themes', params);
}

export async function getTheme(id: string): Promise<Theme> {
  const {theme} = await publicFetch<{theme: Theme}>(`/themes/${id}`);
  return theme;
}

/** Best-effort telemetry -- never blocks applying a theme if it fails. */
export async function incrementThemeDownload(id: string): Promise<void> {
  try {
    await fetch(`${PUBLIC_BASE}/themes/${id}/downloads`, {method: 'POST'});
  } catch {
    // ignore
  }
}

export async function createTheme(token: string, theme: Theme): Promise<Theme> {
  const {theme: created} = await accountFetch<{theme: Theme}>(
    '/api/themes',
    {method: 'POST', body: JSON.stringify(theme)},
    token,
  );
  return created;
}

export async function updateTheme(token: string, id: string, patch: Partial<Theme>): Promise<Theme> {
  const {theme: updated} = await accountFetch<{theme: Theme}>(
    `/api/themes/${id}`,
    {method: 'PATCH', body: JSON.stringify(patch)},
    token,
  );
  return updated;
}

export function deleteTheme(token: string, id: string): Promise<void> {
  return accountFetch(`/api/themes/${id}`, {method: 'DELETE'}, token);
}
