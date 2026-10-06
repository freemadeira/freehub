const NEEDS_QUOTES = /[",\r\n]/u;
// Spreadsheets run cells that start with these as formulas.
const FORMULA = /^[=+\-@\t\r]/u;

function cell(value: string): string {
  const safe = FORMULA.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** CSV with a BOM and CRLF line ends, the way Excel opens it without mangling accents. */
export function toCsv(rows: string[][]): string {
  return `\uFEFF${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

function delimiterOf(firstLine: string): string {
  const counts = [",", ";", "\t"].map((delimiter): [string, number] => [
    delimiter,
    firstLine.split(delimiter).length,
  ]);
  return counts.toSorted((a, b) => b[1] - a[1])[0]?.[0] ?? ",";
}

/** Parses CSV, guessing comma, semicolon or tab from the header line. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/u, "");
  const delimiter = delimiterOf(text.slice(0, text.search(/\r?\n|$/u)));
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(value);
      value = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value !== "" || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((item) => item.trim() !== ""));
}

export function downloadFile(
  name: string,
  content: string,
  type: string
): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
