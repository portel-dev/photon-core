/**
 * MIME Type Utilities
 *
 * Extension-to-MIME mapping for Photon assets.
 * Extracted from photon's loader.ts.
 */

import * as path from 'path';

const MIME_TYPES: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  mjs: 'application/javascript',
  jsx: 'text/jsx',
  ts: 'text/typescript',
  tsx: 'text/tsx',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  xml: 'application/xml',
  md: 'text/markdown',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  pdf: 'application/pdf',
  zip: 'application/zip',
  csv: 'text/csv',
};

/**
 * Get MIME type from a filename based on its extension
 *
 * @returns The MIME type string, or 'application/octet-stream' for unknown extensions
 */
export function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase().slice(1);
  return MIME_TYPES[ext] || 'application/octet-stream';
}
