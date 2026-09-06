import React from 'react';
import {Circle, Line, Path, Rect, Svg} from 'react-native-svg';

interface IconProps {
  size?: number;
  color?: string;
}

/**
 * Small hand-drawn line icons (original shapes, not from any icon pack)
 * so the UI doesn't rely on emoji glyphs, which render inconsistently
 * across devices/fonts and can't be recolored to match the theme.
 */

export function IconHome({size = 20, color = '#fff'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 11.5L12 4l8 7.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M6 10v9a1 1 0 0 0 1 1h3v-5a2 2 0 0 1 4 0v5h3a1 1 0 0 0 1-1v-9"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IconFile({size = 22, color = '#fff'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Path d="M14 3v4h4" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </Svg>
  );
}

export function IconFolder({size = 22, color = '#fff'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IconGlobe({size = 22, color = '#fff'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} />
      <Path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" stroke={color} strokeWidth={2} />
    </Svg>
  );
}

export function IconClose({size = 16, color = '#888'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1={5} y1={5} x2={19} y2={19} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      <Line x1={19} y1={5} x2={5} y2={19} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
    </Svg>
  );
}

export function IconChevronLeft({size = 22, color = '#7ab8ff'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M15 5l-7 7 7 7" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function IconSave({size = 20, color = '#fff'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Rect x={8} y={4} width={7} height={5} stroke={color} strokeWidth={2} />
      <Rect x={7} y={14} width={10} height={6} stroke={color} strokeWidth={2} />
    </Svg>
  );
}

export function IconAccount({size = 22, color = '#fff'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={4} stroke={color} strokeWidth={2} />
      <Path d="M4 20c0-4 3.5-6.5 8-6.5s8 2.5 8 6.5" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function IconCloud({size = 16, color = '#fff'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 18a4.5 4.5 0 0 1-.5-8.97A5.5 5.5 0 0 1 17.2 8.06 4 4 0 0 1 17 16H7Z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * A single upward-pointing triangle -- rotate it (via the `rotation` prop,
 * degrees) for the other three D-pad directions instead of relying on
 * Unicode arrow glyphs (▲▼◀▶), which aren't guaranteed to be in every
 * device's default font and rendered blank for left/right on at least one
 * test device.
 */
export function IconTriangle({size = 16, color = '#eee', rotation = 0}: IconProps & {rotation?: number}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{transform: [{rotate: `${rotation}deg`}]}}>
      <Path d="M12 5l8 14H4z" fill={color} />
    </Svg>
  );
}

export function IconTrash({size = 14, color = '#c77'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 7h16M9 7V4h6v3M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Decorative cartridge glyph -- used on the Home screen's empty state and header. */
export function IconCartridge({size = 40, color = '#555'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={6} y={2} width={12} height={7} rx={1} stroke={color} strokeWidth={2} />
      <Path
        d="M5 9h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Line x1={9} y1={13} x2={9} y2={18} stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}
