'use strict';

(() => {
  const MiB = 1024 * 1024;
  const csvLimit = MiB;
  const formats = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', pdf: 'application/pdf',
  };
  const pdfKinds = ['receipt', 'letter'];

  function fail(code, message) {
    throw Object.assign(new Error(message), { code });
  }

  function size(sizeBytes, limit) {
    if (!sizeBytes) fail('FILE_EMPTY', 'The file is empty. Choose another file.');
    if (sizeBytes > limit) fail('FILE_TOO_LARGE', `The file exceeds the ${limit / MiB} MB limit.`);
  }

  function expectedType(name, kind) {
    const extension = typeof name === 'string' && /\.([a-z0-9]+)$/i.exec(name);
    const type = extension && formats[extension[1].toLowerCase()];
    const pdf = pdfKinds.includes(kind);
    if (!type || (!pdf && type === 'application/pdf')) {
      fail('FILE_EXTENSION', pdf ? 'Choose a .jpg, .jpeg, .jpe, .jfif, .png, .webp or .pdf file.' : 'Choose a .jpg, .jpeg, .jpe, .jfif, .png or .webp image.');
    }
    return type;
  }

  function signature(head, tail, length) {
    const matches = (offset, bytes) => bytes.every((byte, i) => head[offset + i] === byte);
    const ascii = (offset, value) => matches(offset, Array.from(value, char => char.charCodeAt(0)));
    if (length >= 20 && matches(0, [255, 216, 255]) && tail.some((byte, i) => byte === 255 && tail[i + 1] === 217)) return 'image/jpeg';
    if (length >= 45 && matches(0, [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]) &&
        ascii(12, 'IHDR') &&
        head.slice(16, 20).some(Boolean) && head.slice(20, 24).some(Boolean) &&
        matchesTail(tail, [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])) return 'image/png';
    if (length >= 26 && ascii(0, 'RIFF') && ascii(8, 'WEBP') &&
        (ascii(12, 'VP8 ') || ascii(12, 'VP8L') || ascii(12, 'VP8X'))) {
      const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
      const chunkSize = view.getUint32(16, true);
      const chunkHeader = (ascii(12, 'VP8 ') && chunkSize >= 10 && matches(23, [157, 1, 42])) ||
        (ascii(12, 'VP8L') && chunkSize >= 5 && head[20] === 47) ||
        (ascii(12, 'VP8X') && chunkSize === 10 && length > 30);
      if (chunkHeader && view.getUint32(4, true) + 8 === length && 20 + chunkSize + (chunkSize % 2) <= length) return 'image/webp';
    }
    const pdfEnd = /(?:^|[\r\n])startxref[\t\n\r ]+(\d+)[\t\n\r ]+%%EOF[\x00\t\n\f\r ]*$/.exec(String.fromCharCode(...tail));
    if (length >= 20 && /^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(String.fromCharCode(...head)) &&
        pdfEnd && Number(pdfEnd[1]) > 0 && Number(pdfEnd[1]) < length) return 'application/pdf';
    return null;
  }

  function matchesTail(tail, bytes) {
    return tail.length >= bytes.length && bytes.every((byte, i) => tail[tail.length - bytes.length + i] === byte);
  }

  function checkSignature(type, head, tail, length) {
    if (signature(head, tail, length) !== type) {
      fail('FILE_CONTENT', `The contents do not match a valid ${type.split('/')[1].toUpperCase()} file. Choose another file.`);
    }
  }

  function parseScheduleCsv(text) {
    if (typeof text !== 'string') fail('FILE_CONTENT', 'Choose or paste UTF-8 CSV text.');
    size(new TextEncoder().encode(text).length, csvLimit);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\uFFFD]/.test(text)) fail('FILE_CONTENT', 'Choose or paste UTF-8 CSV text.');
    text = text.replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], field = '', quoted = false, closed = false;
    const endField = () => { row.push(field); field = ''; closed = false; };
    const endRow = () => { endField(); if (row.some(value => value.trim())) rows.push(row); row = []; };
    const invalid = () => fail('FILE_CONTENT', 'CSV has an invalid quoted field. Check the quotes and try again.');
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char !== '"') field += char;
        else if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else if (char === ',') endField();
      else if (char === '\r' || char === '\n') {
        if (char === '\r' && text[i + 1] === '\n') i++;
        endRow();
      } else if (closed && /[ \t]/.test(char)) continue;
      else if (closed) invalid();
      else if (char === '"') {
        if (field.trim()) invalid();
        field = '';
        quoted = true;
      } else field += char;
    }
    if (quoted) invalid();
    endRow();
    const header = (rows[0] || []).map(value => value.trim().toLowerCase());
    const nameIdx = header.findIndex(value => /name|driver/.test(value));
    const centreIdx = header.findIndex(value => /centre|center|location/.test(value));
    if (nameIdx < 0 || centreIdx < 0 || nameIdx === centreIdx) fail('FILE_CONTENT', 'CSV needs separate Name and Centre columns.');
    if (rows.slice(1).some(values => values.length > header.length || values.length <= Math.max(nameIdx, centreIdx))) {
      fail('FILE_CONTENT', 'Each CSV row must have fields for the Name and Centre columns.');
    }
    return { rows, nameIdx, centreIdx };
  }

  const rules = { MiB, csvLimit, fail, size, expectedType, signature, checkSignature, parseScheduleCsv };
  if (typeof module === 'object' && module.exports) module.exports = rules;
  else globalThis.VMTLUploadRules = rules;
})();
