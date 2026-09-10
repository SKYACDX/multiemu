/**
 * Client for the RomHack Hub public API (read-only, no auth, CORS-open --
 * see romhack-hub's README.md, section "API pública"). It only ever
 * serves patch files (IPS/BPS/UPS/xdelta), never ROMs: the flow is
 * platform -> game -> hack -> patch -> download -> apply the patch
 * client-side (see ../patchers) onto a ROM the user already has.
 */
const API_BASE = 'https://emulatornds.online/api/v1';

export interface Platform {
  slug: string;
  name: string;
}

export interface Game {
  id: string;
  slug: string;
  title: string;
  platform: Platform;
  hackCount: number;
}

export interface Patch {
  id: string;
  version: number;
  format: string; // "IPS" | "BPS" | "UPS" | "XDELTA"
  formatLabel: string;
  originalName: string;
  fileSize: number;
  sha256: string;
  releaseNotes: string | null;
  createdAt: string;
  downloadUrl: string;
}

export interface Hack {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  createdAt: string;
  author: string;
  game: {slug: string; title: string; platform: Platform};
  patches: Patch[];
}

export interface Pagination {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
}

async function apiGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const queryString = query.toString();
  const response = await fetch(`${API_BASE}${path}${queryString ? `?${queryString}` : ''}`);
  if (!response.ok) {
    throw new Error(`RomHack Hub API error ${response.status} on ${path}`);
  }
  return response.json();
}

export function listPlatforms(): Promise<{platforms: Platform[]}> {
  return apiGet('/platforms');
}

export function listGames(params: {platform?: string; q?: string; limit?: number; offset?: number} = {}) {
  return apiGet<{games: Game[]; pagination: Pagination}>('/games', params);
}

export function listHacks(
  params: {game?: string; platform?: string; q?: string; limit?: number; offset?: number} = {},
) {
  return apiGet<{hacks: Hack[]; pagination: Pagination}>('/hacks', params);
}

export async function getHack(slug: string): Promise<Hack> {
  const {hack} = await apiGet<{hack: Hack}>(`/hacks/${slug}`);
  return hack;
}

/** Downloads a patch's raw bytes from its downloadUrl. */
export async function downloadPatchBytes(patch: Patch): Promise<Uint8Array> {
  const response = await fetch(patch.downloadUrl);
  if (!response.ok) {
    throw new Error(`No se pudo descargar el parche (HTTP ${response.status})`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

export interface AppListing {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  features: string[];
  iconUrl: string | null;
  screenshots: string[];
  updatedAt: string;
}

export interface AppRelease {
  id: string;
  version: string;
  versionCode: number;
  changelog: string;
  minAndroidSdk: number;
  apkUrl: string | null;
  apkSize: number;
  downloads: number;
  publishedAt: string;
}

/** See docs/update-check.md -- used to check for a newer app release. */
export function getAppInfo(): Promise<{listing: AppListing; latestRelease: AppRelease}> {
  return apiGet('/app');
}

/**
 * A different, separate public API on RomHack Hub: arbitrary files users
 * marked public (cover art, docs, and -- unlike /hacks -- potentially
 * full files depending on what they uploaded). No auth needed to browse
 * or download; RomLibraryScreen/HomeScreen filter results to
 * .zip/.gb/.gbc/.gba by originalName before showing them, since this
 * endpoint isn't restricted to emulator-loadable files the way /hacks is.
 */
export interface RomHackHubFile {
  id: string;
  title: string;
  description: string | null;
  originalName: string;
  fileSize: number;
  mimeType: string;
  platform: Platform;
  gameTitle: string | null;
  coverImageUrl: string | null;
  uploader: string;
  createdAt: string;
  downloadUrl: string;
}

export function listFiles(params: {platform?: string; q?: string; limit?: number; offset?: number} = {}) {
  return apiGet<{files: RomHackHubFile[]; pagination: Pagination}>('/files', params);
}

/** Downloads a public file's raw bytes from its downloadUrl. */
export async function downloadFileBytes(file: RomHackHubFile): Promise<Uint8Array> {
  const response = await fetch(file.downloadUrl);
  if (!response.ok) {
    throw new Error(`No se pudo descargar el archivo (HTTP ${response.status})`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Best-effort cover art lookup for the currently-loaded game -- searches
 * by platform + title (read from the ROM's own header, see romTitle.ts)
 * and returns the first result with cover art, or null. Never throws;
 * a missing/failed lookup just means no themed background this time.
 */
export async function findCoverArt(platform: string, gameTitle: string): Promise<string | null> {
  if (!gameTitle) return null;
  try {
    const {files} = await listFiles({platform, q: gameTitle, limit: 5});
    return files.find(f => f.coverImageUrl)?.coverImageUrl ?? null;
  } catch {
    return null;
  }
}
