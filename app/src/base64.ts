// Minimal base64 <-> Uint8Array codec with no dependencies (Hermes has
// neither Buffer nor atob/btoa by default). Used to move ROM/patch bytes
// between the native side (which speaks base64 over the bridge) and the
// patchers (which need raw bytes).
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    result += CHARS[(triple >> 18) & 0x3f];
    result += CHARS[(triple >> 12) & 0x3f];
    result += i + 1 < len ? CHARS[(triple >> 6) & 0x3f] : '=';
    result += i + 2 < len ? CHARS[triple & 0x3f] : '=';
  }
  return result;
}

const DECODE_LOOKUP = (() => {
  const table = new Uint8Array(256);
  for (let i = 0; i < CHARS.length; i++) table[CHARS.charCodeAt(i)] = i;
  return table;
})();

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const outLen = Math.floor((clean.length * 3) / 4) - padding;
  const out = new Uint8Array(outLen);
  let outIdx = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const e0 = DECODE_LOOKUP[clean.charCodeAt(i)];
    const e1 = DECODE_LOOKUP[clean.charCodeAt(i + 1)];
    const e2 = i + 2 < clean.length ? DECODE_LOOKUP[clean.charCodeAt(i + 2)] : 0;
    const e3 = i + 3 < clean.length ? DECODE_LOOKUP[clean.charCodeAt(i + 3)] : 0;
    const triple = (e0 << 18) | (e1 << 12) | (e2 << 6) | e3;
    if (outIdx < outLen) out[outIdx++] = (triple >> 16) & 0xff;
    if (outIdx < outLen) out[outIdx++] = (triple >> 8) & 0xff;
    if (outIdx < outLen) out[outIdx++] = triple & 0xff;
  }
  return out;
}
