// Minimal base64 <-> Uint8Array codec with no dependencies (Hermes has
// neither Buffer nor atob/btoa by default). Used to move ROM/patch bytes
// between the native side (which speaks base64 over the bridge) and the
// patchers (which need raw bytes).
//
// Builds into an array + one join() rather than repeated string += --
// GBA ROMs can be up to 32MB (~43M base64 characters), and a naive
// append-in-a-loop risks an O(n^2) cliff on engines that don't optimize
// string concatenation into ropes (this was visibly slow on-device with
// Hermes before this rewrite).
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  const len = bytes.length;
  const out = new Array<string>(Math.ceil(len / 3) * 4);
  let outIdx = 0;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out[outIdx++] = CHARS[(triple >> 18) & 0x3f];
    out[outIdx++] = CHARS[(triple >> 12) & 0x3f];
    out[outIdx++] = i + 1 < len ? CHARS[(triple >> 6) & 0x3f] : '=';
    out[outIdx++] = i + 2 < len ? CHARS[triple & 0x3f] : '=';
  }
  return out.join('');
}

const DECODE_LOOKUP = (() => {
  const table = new Uint8Array(256);
  for (let i = 0; i < CHARS.length; i++) table[CHARS.charCodeAt(i)] = i;
  return table;
})();

/**
 * [base64] is expected to be well-formed (no whitespace/newlines) --
 * everything in this app produces it with Android's Base64.NO_WRAP or
 * this module's own bytesToBase64, neither of which ever does. Skipping
 * a defensive regex-cleanup pass matters here: running one over a
 * multi-ten-MB string is itself a slow full copy.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const outLen = Math.floor((base64.length * 3) / 4) - padding;
  const out = new Uint8Array(outLen);
  let outIdx = 0;
  for (let i = 0; i < base64.length; i += 4) {
    const e0 = DECODE_LOOKUP[base64.charCodeAt(i)];
    const e1 = DECODE_LOOKUP[base64.charCodeAt(i + 1)];
    const e2 = i + 2 < base64.length ? DECODE_LOOKUP[base64.charCodeAt(i + 2)] : 0;
    const e3 = i + 3 < base64.length ? DECODE_LOOKUP[base64.charCodeAt(i + 3)] : 0;
    const triple = (e0 << 18) | (e1 << 12) | (e2 << 6) | e3;
    if (outIdx < outLen) out[outIdx++] = (triple >> 16) & 0xff;
    if (outIdx < outLen) out[outIdx++] = (triple >> 8) & 0xff;
    if (outIdx < outLen) out[outIdx++] = triple & 0xff;
  }
  return out;
}
