'use strict';
const rules = require('../../public/js/upload-rules');
const { ApiError } = require('../middleware/errorHandler');
const avatarLimits = { profile: 2_000_000, admin: 700_000 };

function reject(code, message, status = 422) {
  throw new ApiError(status, message, { code });
}

function validate(check) {
  try { return check(); }
  catch (error) {
    if (error.code?.startsWith('FILE_')) reject(error.code, error.message);
    throw error;
  }
}

function decode(data, limit) {
  if (typeof data !== 'string') reject('FILE_ENCODING', 'Send the file as base64.');
  if (data.length > 4 * Math.ceil(limit / 3)) reject('FILE_TOO_LARGE', `The file exceeds the ${limit / rules.MiB} MB limit.`);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 === 1) reject('FILE_ENCODING', 'The file encoding is invalid.');
  const bytes = Buffer.from(data, 'base64');
  const canonical = bytes.toString('base64');
  if (canonical !== data && canonical.replace(/=+$/, '') !== data) reject('FILE_ENCODING', 'The file encoding is invalid.');
  validate(() => rules.size(bytes.length, limit));
  return bytes;
}

function fileName(req) {
  try {
    const header = req.get('X-File-Name');
    return header === undefined ? undefined : decodeURIComponent(header);
  } catch (_) { reject('FILE_EXTENSION', 'The file name is invalid.'); }
}

function attachment(bytes, name, kind, limit) {
  return validate(() => {
    rules.size(bytes.length, limit);
    const type = rules.expectedType(name, kind);
    rules.checkSignature(type, bytes.subarray(0, 32), bytes.subarray(-1024), bytes.length);
    return type;
  });
}

function avatar(value, limit) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') reject('FILE_ENCODING', 'Send the avatar as an image data URL.');
  if (value.length > limit) reject('FILE_TOO_LARGE', 'The avatar exceeds the upload limit.');
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([\s\S]*)$/.exec(value);
  if (!match) reject('FILE_EXTENSION', 'Use a JPEG, PNG, WebP or GIF image data URL.');
  const bytes = decode(match[2], Math.floor(limit * 3 / 4));
  let type = rules.signature(bytes.subarray(0, 32), bytes.subarray(-1024), bytes.length);
  if (bytes.length >= 14 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6)) &&
      bytes.readUInt16LE(6) && bytes.readUInt16LE(8) && bytes.at(-1) === 0x3b) type = 'image/gif';
  if (type !== match[1]) reject('FILE_CONTENT', 'The avatar contents do not match the declared image format.');
  return `data:${type};base64,${bytes.toString('base64')}`;
}

module.exports = { reject, validate, decode, fileName, attachment, avatar, avatarLimits };
