/* Минимальное чтение и запись .xlsx без внешних библиотек.
 * .xlsx — это zip с XML. Распаковка — встроенный в браузер DecompressionStream.
 * Читает только значения ячеек (формулы — по сохранённому результату). Формат .xls не поддерживается. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.HPD = root.HPD || {}).xlsx = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_ENTRY = 40 * 1024 * 1024;
  const MAX_ROWS = 50000;
  const MAX_COLS = 60;
  const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  /* ---------- чтение ---------- */

  async function inflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function readZip(buf) {
    const bytes = new Uint8Array(buf);
    const view = new DataView(buf);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Файл не похож на книгу Excel (.xlsx).');
    const count = view.getUint16(eocd + 10, true);
    let pos = view.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const entries = new Map();
    for (let n = 0; n < count; n++) {
      if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50) throw new Error('Повреждён архив .xlsx.');
      const nameLen = view.getUint16(pos + 28, true);
      entries.set(dec.decode(bytes.subarray(pos + 46, pos + 46 + nameLen)), {
        method: view.getUint16(pos + 10, true),
        compSize: view.getUint32(pos + 20, true),
        size: view.getUint32(pos + 24, true),
        offset: view.getUint32(pos + 42, true),
      });
      pos += 46 + nameLen + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true);
    }
    return async function getText(name) {
      const e = entries.get(name);
      if (!e) return null;
      if (e.size > MAX_ENTRY) throw new Error('Файл слишком большой для загрузки.');
      const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
      const data = bytes.subarray(start, start + e.compSize);
      let out;
      if (e.method === 0) out = data;
      else if (e.method === 8) out = await inflateRaw(data);
      else throw new Error('Неподдерживаемое сжатие в файле .xlsx.');
      if (out.length > MAX_ENTRY) throw new Error('Файл слишком большой для загрузки.');
      return dec.decode(out);
    };
  }

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Повреждён XML внутри файла .xlsx.');
    return doc;
  }

  const els = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));

  function colIndex(ref) {
    const m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return -1;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64;
    return n - 1;
  }

  function textOf(si) { // <si> может состоять из нескольких <r><t>; фонетические вставки <rPh> пропускаем
    let s = '';
    const walk = (node) => {
      for (const c of Array.from(node.children)) {
        if (c.localName === 'rPh') continue;
        if (c.localName === 't') s += c.textContent;
        else walk(c);
      }
    };
    walk(si);
    return s;
  }

  /** Возвращает { name, rows } для листа с одним из предпочтительных имён, иначе для первого листа. */
  async function readXlsx(buf, preferred) {
    const getText = readZip(buf);
    const wbText = await getText('xl/workbook.xml');
    if (!wbText) throw new Error('Файл не похож на книгу Excel (.xlsx).');
    const wb = parseXml(wbText);
    const sheets = els(wb, 'sheet').map((s) => ({ name: s.getAttribute('name'), rid: s.getAttributeNS(NS_REL, 'id') }));
    if (!sheets.length) throw new Error('В книге нет листов.');
    const pick = sheets.find((s) => (preferred || []).includes(s.name)) || sheets[0];

    const relsText = await getText('xl/_rels/workbook.xml.rels');
    let target = null;
    if (relsText) {
      const rel = els(parseXml(relsText), 'Relationship').find((r) => r.getAttribute('Id') === pick.rid);
      if (rel) {
        const t = rel.getAttribute('Target');
        target = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
      }
    }
    if (!target) target = 'xl/worksheets/sheet' + (sheets.indexOf(pick) + 1) + '.xml';

    const ssText = await getText('xl/sharedStrings.xml');
    const shared = ssText ? els(parseXml(ssText), 'si').map(textOf) : [];

    const sheetText = await getText(target);
    if (!sheetText) throw new Error('Не удалось прочитать лист «' + pick.name + '».');
    const rows = [];
    let seq = 0;
    for (const row of els(parseXml(sheetText), 'row')) {
      const r = row.getAttribute('r') ? Number(row.getAttribute('r')) - 1 : seq;
      seq = r + 1;
      if (r >= MAX_ROWS) break;
      const line = [];
      let cseq = 0;
      for (const c of els(row, 'c')) {
        let ci = colIndex(c.getAttribute('r'));
        if (ci < 0) ci = cseq;
        cseq = ci + 1;
        if (ci >= MAX_COLS) continue;
        const t = c.getAttribute('t');
        const v = Array.from(c.children).find((x) => x.localName === 'v');
        let val = '';
        if (t === 'inlineStr') val = textOf(Array.from(c.children).find((x) => x.localName === 'is') || c);
        else if (v) {
          if (t === 's') val = shared[Number(v.textContent)] ?? '';
          else if (t === 'str' || t === 'e') val = v.textContent;
          else if (t === 'b') val = v.textContent === '1';
          else val = v.textContent === '' ? '' : Number(v.textContent);
        }
        line[ci] = val;
      }
      rows[r] = line;
    }
    for (let i = 0; i < rows.length; i++) rows[i] = Array.from(rows[i] || [], (x) => (x === undefined ? '' : x));
    return { name: pick.name, rows };
  }

  /* ---------- запись ---------- */

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(b) {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(files) { // без сжатия: файлы маленькие
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = enc.encode(f.data);
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(10, 0, true); lh.setUint16(12, 0x5a21, true); // дата 2025-01-01
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(14, 0x5a21, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, x) => s + x.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
    let p = 0;
    for (const x of all) { out.set(x, p); p += x.length; }
    return out;
  }

  const esc = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function colName(i) {
    let s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }

  function sheetXml(sheet) {
    const cols = (sheet.widths || []).map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('');
    const rows = sheet.rows.map((row, r) => {
      const cells = row.map((v, c) => {
        const ref = colName(c) + (r + 1);
        const s = r === 0 && sheet.header ? ' s="1"' : '';
        if (typeof v === 'number') return '<c r="' + ref + '"' + s + '><v>' + v + '</v></c>';
        if (v === '' || v == null) return '';
        return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
      }).join('');
      return '<row r="' + (r + 1) + '">' + cells + '</row>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (sheet.header ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '') +
      (cols ? '<cols>' + cols + '</cols>' : '') + '<sheetData>' + rows + '</sheetData></worksheet>';
  }

  /** sheets: [{ name, rows: [[...]], widths?: [...], header?: bool }] → Uint8Array с содержимым .xlsx */
  function writeXlsx(sheets) {
    const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const files = [
      { name: '[Content_Types].xml', data: X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>' },
      { name: '_rels/.rels', data: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: X + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + NS_REL + '"><sheets>' + sheets.map((s, i) => '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: X + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
      ...sheets.map((s, i) => ({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml(s) })),
    ];
    return zip(files);
  }

  return { readXlsx, writeXlsx };
});
