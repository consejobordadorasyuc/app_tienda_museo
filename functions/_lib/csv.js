/**
 * Lector y escritor CSV compatible con comas, comillas, saltos de línea y UTF-8.
 */
export function parseCsv(text) {
  if (!text || !text.trim()) return [];

  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows.shift().map((header) => header.trim());

  return rows
    .filter((values) => values.some((value) => value !== ''))
    .map((values) => {
      const object = {};
      headers.forEach((header, index) => {
        object[header] = values[index] ?? '';
      });
      return object;
    });
}

function escapeCell(value) {
  const stringValue = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export function stringifyCsv(rows, columns) {
  const header = columns.map(escapeCell).join(',');
  const lines = rows.map((row) => columns.map((column) => escapeCell(row[column])).join(','));
  return `${[header, ...lines].join('\n')}\n`;
}
