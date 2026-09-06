import {unzipSync} from 'fflate';

/**
 * Some patches (and, if a user picks one on iOS later, some ROMs) are
 * distributed as a .zip containing a single file. Returns the bytes of
 * the first entry whose extension is in [extensions], or null if none
 * matches -- or if [bytes] isn't a zip at all (checked by the "PK" local
 * file header signature, cheaper than trying to unzip and catching).
 */
export function extractFromZip(bytes: Uint8Array, extensions: string[]): {bytes: Uint8Array; name: string} | null {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null; // not a zip ("PK")

  // filter runs before inflating each entry -- for a zip bundling a ROM
  // alongside a readme/box art/etc, this skips decompressing everything
  // but the one file we actually want instead of inflating the whole
  // archive up front.
  const files = unzipSync(bytes, {
    filter: file => extensions.includes(file.name.split('/').pop()?.split('.').pop()?.toLowerCase() ?? ''),
  });
  for (const [name, contents] of Object.entries(files)) {
    return {bytes: contents, name: name.split('/').pop() ?? name};
  }
  return null;
}
