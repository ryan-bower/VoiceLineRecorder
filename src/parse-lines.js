// Shared line-list parser. Used by the server (validation) and the browser
// (preview) as an ES module. No dependencies so it runs in both.

const DELIMITERS = ["\t", "|"];

function isSkippable(rawLine) {
  const t = rawLine.trim();
  return t === "" || t.startsWith("#");
}

// Pick a delimiter only if it appears on most content rows — otherwise the
// list is plain prose that might incidentally contain a pipe.
function detectDelimiter(contentLines) {
  for (const delim of DELIMITERS) {
    const withDelim = contentLines.filter((l) => l.includes(delim)).length;
    if (contentLines.length > 0 && withDelim / contentLines.length >= 0.6) {
      return delim;
    }
  }
  return null;
}

// Parse raw .txt into [{ number, id, text, notes }]. number is 1-based.
export function parseLines(raw) {
  const contentLines = raw
    .split(/\r?\n/)
    .filter((l) => !isSkippable(l));

  const delimiter = detectDelimiter(contentLines);
  const format = delimiter ? "structured" : "plain";
  const lines = [];

  contentLines.forEach((rawLine, i) => {
    const number = i + 1;
    if (delimiter) {
      const parts = rawLine.split(delimiter).map((p) => p.trim());
      if (parts.length === 1) {
        lines.push({ number, id: "", text: parts[0], notes: "" });
      } else {
        lines.push({
          number,
          id: parts[0] || "",
          text: parts[1] || "",
          notes: parts.slice(2).join(" ").trim(),
        });
      }
    } else {
      lines.push({ number, id: "", text: rawLine.trim(), notes: "" });
    }
  });

  return { format, delimiter, lines };
}
