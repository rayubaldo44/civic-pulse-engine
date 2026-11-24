// Shared CSV serialization for report exports.
// Formula-injection guard: spreadsheet apps (Excel, Sheets) execute cells
// starting with = + - @ as formulas. Cell content here derives from scraped
// public comments, so any such value is neutralized with a leading apostrophe.
const FORMULA_PREFIXES = new Set(['=', '+', '-', '@', '\t', '\r']);

export function csvCell(val: unknown): string {
	const raw = String(val ?? '');
	const safe = raw.length > 0 && FORMULA_PREFIXES.has(raw[0]) ? `'${raw}` : raw;
	return `"${safe.replace(/"/g, '""')}"`;
}
