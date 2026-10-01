/** Decodes the bytes of an imported file: UTF-8 (BOM removed), UTF-16 with a BOM, else windows-1252. */
export function decodeImportBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Spreadsheets on Windows commonly save CSV as windows-1252, which is never valid UTF-8 for é, ü, “ ”.
    // A UTF-8 file with a few stray bytes stays UTF-8 (they become U+FFFD) when it has at least as
    // many valid multi-byte characters as invalid bytes: windows-1252 text rarely forms one.
    const text = new TextDecoder('utf-8').decode(bytes);
    let valid = 0;
    let invalid = 0;
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code === 0xfffd) invalid++;
      else if (code > 0x7f && (code < 0xdc00 || code > 0xdfff)) valid++;
    }
    return valid >= invalid ? text : new TextDecoder('windows-1252').decode(bytes);
  }
}
