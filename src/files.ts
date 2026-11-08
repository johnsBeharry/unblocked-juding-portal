/** File rules shared by the legacy submission endpoint and the artist entry endpoints. */

export const STATIC_LIMIT = 5 * 1024 * 1024; // jpg/png/pdf
export const MOTION_LIMIT = 20 * 1024 * 1024; // gif/mp4
export const MAX_ASSETS = 3;
export const ACCEPTED_TYPES = ["jpg", "png", "gif", "pdf", "mp4"];

export type Detected = { mime: string; ext: string; limit: number };

/** Detects the file type from its first bytes (never the name or Content-Type). */
export function detectFileType(bytes: Uint8Array): Detected | null {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (startsWith([0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg", limit: STATIC_LIMIT };
  if (startsWith([0x89, 0x50, 0x4e, 0x47])) return { mime: "image/png", ext: "png", limit: STATIC_LIMIT };
  if (startsWith([0x47, 0x49, 0x46, 0x38])) return { mime: "image/gif", ext: "gif", limit: MOTION_LIMIT };
  if (startsWith([0x25, 0x50, 0x44, 0x46])) return { mime: "application/pdf", ext: "pdf", limit: STATIC_LIMIT };
  if (startsWith([0x66, 0x74, 0x79, 0x70], 4)) return { mime: "video/mp4", ext: "mp4", limit: MOTION_LIMIT };
  return null;
}
