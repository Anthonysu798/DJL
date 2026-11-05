import { ApiError } from "../http/errors.ts";

export const COMMERCE_CSV_COLUMNS = [
  "supplierId",
  "sku",
  "name",
  "description",
  "category",
  "imageUrl",
  "priceCents",
  "costCents",
  "commissionBps",
  "returnDays",
  "stock",
] as const;

/** Strict CSV, including escaped quotes/newlines. Import never interprets spreadsheet formulae. */
export function parseCommerceCsv(input: unknown): Record<string, unknown>[] {
  if (typeof input !== "string" || input.length > 200_000)
    throw new ApiError(400, "invalid_csv", "CSV must be text of at most 200 KB.");
  const source = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  const endField = () => {
    row.push(field);
    field = "";
    closed = false;
  };
  const endRow = () => {
    endField();
    if (row.some((v) => v.length)) rows.push(row);
    row = [];
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else field += c;
    } else if (c === '"' && field === "" && !closed) quoted = true;
    else if (c === ",") endField();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      endRow();
    } else {
      if (closed || c === '"') throw new ApiError(400, "invalid_csv", "Invalid quoted CSV field.");
      field += c;
    }
  }
  if (quoted) throw new ApiError(400, "invalid_csv", "Unclosed CSV quote.");
  if (field || row.length || closed) endRow();
  if (
    rows.length < 2 ||
    rows.length > 1001 ||
    rows[0]!.join(",") !== COMMERCE_CSV_COLUMNS.join(",")
  )
    throw new ApiError(
      400,
      "invalid_csv",
      `Use 1–1000 rows and the exact header: ${COMMERCE_CSV_COLUMNS.join(",")}`,
    );
  return rows.slice(1).map((values, i) => {
    if (values.length !== COMMERCE_CSV_COLUMNS.length)
      throw new ApiError(400, "invalid_csv", `Row ${i + 2} has the wrong number of columns.`);
    return Object.fromEntries(
      COMMERCE_CSV_COLUMNS.map((name, index) => {
        const value = values[index]!;
        return [
          name,
          ["priceCents", "costCents", "commissionBps", "returnDays", "stock"].includes(name)
            ? /^\d+$/.test(value)
              ? Number(value)
              : NaN
            : value,
        ];
      }),
    );
  });
}
