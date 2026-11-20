/* eslint-env node */
/**
 * Puts "when this photo was taken" into a JPEG, as a camera does: an EXIF
 * block (APP1) with DateTime, DateTimeOriginal and OffsetTimeOriginal
 * (+05:30), right after the start-of-image marker. Any EXIF block the JPEG
 * already had is dropped (COCO photos carry their own dates).
 */
const IST_MS = 5.5 * 3600000;

const exifDate = ms => {
  const d = new Date(ms + IST_MS);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}:${p(d.getUTCMonth() + 1)}:${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
};

/** A little-endian TIFF structure holding the three tags. */
const tiff = ms => {
  const date = Buffer.from(`${exifDate(ms)}\0`, 'ascii'); // 20 bytes
  const offset = Buffer.from('+05:30\0', 'ascii'); // 7 bytes
  // Layout: header(8) | IFD0: count(2) + 2 entries(24) + next(4) = 30 | ExifIFD: count(2) + 2 entries(24) + next(4) = 30 | data
  const ifd0At = 8;
  const exifAt = ifd0At + 30;
  const dataAt = exifAt + 30;
  const dateAt = dataAt;
  const offsetAt = dateAt + date.length;
  const buf = Buffer.alloc(offsetAt + offset.length);
  buf.write('II', 0, 'ascii');
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(ifd0At, 4);
  const entry = (at, tag, type, count, value) => {
    buf.writeUInt16LE(tag, at);
    buf.writeUInt16LE(type, at + 2);
    buf.writeUInt32LE(count, at + 4);
    buf.writeUInt32LE(value, at + 8);
  };
  buf.writeUInt16LE(2, ifd0At);
  entry(ifd0At + 2, 0x0132, 2, date.length, dateAt); // DateTime
  entry(ifd0At + 14, 0x8769, 4, 1, exifAt); // ExifIFD pointer
  buf.writeUInt32LE(0, ifd0At + 26);
  buf.writeUInt16LE(2, exifAt);
  entry(exifAt + 2, 0x9003, 2, date.length, dateAt); // DateTimeOriginal
  entry(exifAt + 14, 0x9011, 2, offset.length, offsetAt); // OffsetTimeOriginal
  buf.writeUInt32LE(0, exifAt + 26);
  date.copy(buf, dateAt);
  offset.copy(buf, offsetAt);
  return buf;
};

/** The JPEG with an EXIF block saying it was taken at `ms` (UTC milliseconds). */
const exifJpeg = (jpeg, ms) => {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('not a JPEG');
  // Drop existing APP1 (EXIF) segments; keep everything else.
  const parts = [];
  let i = 2;
  while (i + 4 <= jpeg.length && jpeg[i] === 0xff) {
    const marker = jpeg[i + 1];
    if (marker === 0xda) break; // start of scan: the rest is image data
    const len = jpeg.readUInt16BE(i + 2);
    if (marker !== 0xe1) parts.push(jpeg.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff(ms)]);
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xffe1, 0);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), head, payload, ...parts, jpeg.subarray(i)]);
};

module.exports = { exifJpeg, exifDate };
