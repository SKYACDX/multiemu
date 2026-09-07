/**
 * Client-side mirror of docs/themes-api.md's `Theme` schema. A theme is
 * always scoped to one system (gb/gbc/gba/nds) -- see that doc for why.
 * v1 is presets + palette only; `assets` is carried through untouched
 * (always null today) so a theme round-trips through the API without
 * losing fields once custom-image assets (v2) exist server-side.
 */

export type ThemeSystem = 'gb' | 'gbc' | 'gba' | 'nds';

export interface ThemePalette {
  shellBackground: string;
  shellBorder: string;
  screenBezel: string;
  dpadColor: string;
  actionButtonColor: string;
  shoulderButtonColor: string;
}

export type DpadPresetId = 'default' | 'rounded' | 'sharp';
export type ActionButtonsPresetId = 'default' | 'square' | 'compact';
export type ShoulderButtonsPresetId = 'default' | 'pill' | 'sharp';

export interface ThemePresets {
  dpad: DpadPresetId;
  actionButtons: ActionButtonsPresetId;
  shoulderButtons: ShoulderButtonsPresetId;
}

export interface ThemeAssets {
  shellBackground: {downloadUrl: string; storedName: string} | null;
  dpad: {downloadUrl: string; storedName: string} | null;
  buttonA: {downloadUrl: string; storedName: string} | null;
  buttonB: {downloadUrl: string; storedName: string} | null;
  buttonX: {downloadUrl: string; storedName: string} | null;
  buttonY: {downloadUrl: string; storedName: string} | null;
  buttonL: {downloadUrl: string; storedName: string} | null;
  buttonR: {downloadUrl: string; storedName: string} | null;
}

export interface Theme {
  id?: string;
  slug: string;
  name: string;
  system: ThemeSystem;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  downloads?: number;
  public?: boolean;
  palette: ThemePalette;
  presets: ThemePresets;
  assets?: ThemeAssets;
}

const EMPTY_ASSETS: ThemeAssets = {
  shellBackground: null,
  dpad: null,
  buttonA: null,
  buttonB: null,
  buttonX: null,
  buttonY: null,
  buttonL: null,
  buttonR: null,
};

/** Today's hardcoded look, per system -- what you get with no theme applied. */
const SYSTEM_ACCENT: Record<ThemeSystem, string> = {gb: '#4a90d9', gbc: '#4a90d9', gba: '#c2536a', nds: '#7a5cc2'};

export function defaultTheme(system: ThemeSystem): Theme {
  return {
    slug: `default-${system}`,
    name: 'Predeterminado',
    system,
    palette: {
      shellBackground: '#1e2027',
      shellBorder: SYSTEM_ACCENT[system],
      screenBezel: '#000000',
      dpadColor: '#33353c',
      actionButtonColor: '#8b3a4a',
      shoulderButtonColor: '#3a5a7a',
    },
    presets: {dpad: 'default', actionButtons: 'default', shoulderButtons: 'default'},
    assets: EMPTY_ASSETS,
  };
}

/** Lightens (positive percent) or darkens (negative) a "#rrggbb" color. */
export function shadeColor(hex: string, percent: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  const num = parseInt(clean, 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp(((num >> 16) & 0xff) + Math.round(255 * (percent / 100)));
  const g = clamp(((num >> 8) & 0xff) + Math.round(255 * (percent / 100)));
  const b = clamp((num & 0xff) + Math.round(255 * (percent / 100)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

export const PALETTE_SWATCHES = [
  '#c2536a', '#8b3a4a', '#7a5cc2', '#4a90d9', '#3a5a7a', '#4fae5a',
  '#d9a34a', '#d94a4a', '#4ad9c2', '#1e2027', '#33353c', '#000000',
  '#ffffff', '#eeeeee',
];

export const DPAD_PRESETS: {id: DpadPresetId; label: string; radius: number}[] = [
  {id: 'default', label: 'Clásico', radius: 8},
  {id: 'rounded', label: 'Redondo', radius: 20},
  {id: 'sharp', label: 'Cuadrado', radius: 2},
];

export const ACTION_BUTTON_PRESETS: {id: ActionButtonsPresetId; label: string; radius: number; scale: number}[] = [
  {id: 'default', label: 'Clásico', radius: 30, scale: 1},
  {id: 'square', label: 'Cuadrado', radius: 14, scale: 1},
  {id: 'compact', label: 'Compacto', radius: 24, scale: 0.85},
];

export const SHOULDER_BUTTON_PRESETS: {id: ShoulderButtonsPresetId; label: string; radius: number}[] = [
  {id: 'default', label: 'Clásico', radius: 8},
  {id: 'pill', label: 'Píldora', radius: 17},
  {id: 'sharp', label: 'Cuadrado', radius: 3},
];

/**
 * Concrete numbers/colors derived from a Theme -- the single source of
 * truth both GameControls (real, interactive) and ThemePreview (static,
 * for the editor/explore screens) read from, so a preview always
 * matches what you actually get in-game.
 */
export interface ResolvedControlStyle {
  dpadColor: string;
  dpadRadius: number;
  actionColorA: string;
  actionColorB: string;
  actionRadius: number;
  actionScale: number;
  shoulderColor: string;
  shoulderRadius: number;
  shellBackground: string;
  shellBorder: string;
  screenBezel: string;
}

export function resolveControlStyle(theme: Theme): ResolvedControlStyle {
  const dpad = dpadPreset(theme.presets.dpad);
  const action = actionButtonsPreset(theme.presets.actionButtons);
  const shoulder = shoulderButtonsPreset(theme.presets.shoulderButtons);
  return {
    dpadColor: theme.palette.dpadColor,
    dpadRadius: dpad.radius,
    actionColorA: theme.palette.actionButtonColor,
    actionColorB: shadeColor(theme.palette.actionButtonColor, -20),
    actionRadius: action.radius,
    actionScale: action.scale,
    shoulderColor: theme.palette.shoulderButtonColor,
    shoulderRadius: shoulder.radius,
    shellBackground: theme.palette.shellBackground,
    shellBorder: theme.palette.shellBorder,
    screenBezel: theme.palette.screenBezel,
  };
}

export function dpadPreset(id: DpadPresetId) {
  return DPAD_PRESETS.find(p => p.id === id) ?? DPAD_PRESETS[0];
}

export function actionButtonsPreset(id: ActionButtonsPresetId) {
  return ACTION_BUTTON_PRESETS.find(p => p.id === id) ?? ACTION_BUTTON_PRESETS[0];
}

export function shoulderButtonsPreset(id: ShoulderButtonsPresetId) {
  return SHOULDER_BUTTON_PRESETS.find(p => p.id === id) ?? SHOULDER_BUTTON_PRESETS[0];
}
