#!/usr/bin/env node
/**
 * Builds HAMILHA_ANDROID_IOS.zip with zero external dependencies using Node built-in zlib.
 * Strictly excludes secrets, signing keys, local databases, node_modules, and build caches.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT_DIR = path.resolve(process.cwd());
const OUTPUT_ZIP = path.join(ROOT_DIR, 'HAMILHA_ANDROID_IOS.zip');

const INCLUDED_TOP_LEVEL = [
  '.dockerignore',
  '.env.example',
  '.github',
  '.gitignore',
  'Dockerfile',
  'README.md',
  'index.html',
  'metadata.json',
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'server.ts',
  'server',
  'src',
  'scripts',
  'flutter_app',
];

const EXCLUDED_DIR_NAMES = new Set([
  '.git',
  '.dart_tool',
  '.gradle',
  'build',
  'dist',
  'node_modules',
  'data',
  'Pods',
  '.symlinks',
]);

function shouldExcludeFile(relPosixPath) {
  const base = path.posix.basename(relPosixPath);
  if (base === '.DS_Store' || base === 'HAMILHA_ANDROID_IOS.zip') return true;
  if (base === 'key.properties') return true;
  if (base.startsWith('.env') && base !== '.env.example') return true;
  if (/\.(jks|keystore|p12|mobileprovision|db|db-shm|db-wal|log)$/i.test(base)) return true;
  return false;
}

function collectFiles(absPath, relPosix, results) {
  const stat = fs.lstatSync(absPath);
  if (stat.isSymbolicLink()) return;

  if (stat.isDirectory()) {
    const dirName = path.basename(absPath);
    if (EXCLUDED_DIR_NAMES.has(dirName)) return;
    const entries = fs.readdirSync(absPath).sort();
    for (const entry of entries) {
      const childAbs = path.join(absPath, entry);
      const childRel = relPosix ? `${relPosix}/${entry}` : entry;
      collectFiles(childAbs, childRel, results);
    }
    return;
  }

  if (stat.isFile() && !shouldExcludeFile(relPosix)) {
    results.push({ absPath, relPosix, mode: stat.mode, mtime: stat.mtime });
  }
}

// Precompute CRC-32 table
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function toDosTimeDate(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { dosTime, dosDate };
}

function buildZipBuffer(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const item of files) {
    const rawData = fs.readFileSync(item.absPath);
    const compressedData = zlib.deflateRawSync(rawData, { level: 6 });
    const useDeflate = compressedData.length < rawData.length;
    const payload = useDeflate ? compressedData : rawData;
    const method = useDeflate ? 8 : 0;
    const checksum = crc32(rawData);
    const nameBuf = Buffer.from(item.relPosix, 'utf-8');
    const { dosTime, dosDate } = toDosTimeDate(item.mtime);

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, payload);

    // Preserve Unix permissions and ensure gradlew is always executable on macOS/Linux
    const unixMode = item.relPosix.endsWith('/gradlew')
      ? 0o755
      : ((item.mode & 0o777) || 0o644);
    const externalAttrs = ((0o100000 | unixMode) << 16) >>> 0;

    // Central directory header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4); // version made by: Unix
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(externalAttrs, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

const files = [];
for (const entry of INCLUDED_TOP_LEVEL) {
  const abs = path.join(ROOT_DIR, entry);
  if (fs.existsSync(abs)) {
    collectFiles(abs, entry, files);
  }
}

const zipBuffer = buildZipBuffer(files);
const tmpZip = `${OUTPUT_ZIP}.tmp`;
fs.writeFileSync(tmpZip, zipBuffer);
fs.renameSync(tmpZip, OUTPUT_ZIP);

const kb = (zipBuffer.length / 1024).toFixed(1);
console.log(`[HAMILHA] Built HAMILHA_ANDROID_IOS.zip (${files.length} files, ${kb} KB)`);
