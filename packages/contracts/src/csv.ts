export function csvCell(v: unknown) {
  const s = String(v ?? "");
  return (
    '"' +
    (/^[\s]*[=+@-]/.test(s) && !/^-[0-9]+(?:\.[0-9]+)?$/.test(s)
      ? "'" + s
      : s
    ).replaceAll('"', '""') +
    '"'
  );
}
export function encodeCsvRows(rows: Record<string, unknown>[]): string {
  const fields = rows.length ? Object.keys(rows[0]) : ["No records"];
  return (
    "\uFEFF" +
    [
      fields,
      ...rows.map((r) =>
        fields.map((f) =>
          typeof r[f] === "object" && r[f] !== null
            ? JSON.stringify(r[f])
            : r[f],
        ),
      ),
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n")
  );
}
