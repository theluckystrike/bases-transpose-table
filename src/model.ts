export type Editable = string | number | boolean;
export type EditKind = 'text' | 'number' | 'boolean';

/** Dates and links stay read only even when YAML stores them as text. */
export function storedKind(value: unknown): EditKind | null {
	if (typeof value === 'boolean') return 'boolean';
	if (typeof value === 'number') return Number.isFinite(value) ? 'number' : null;
	if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(value) && !value.includes('[[')) return 'text';
	return null;
}

export function editableKind(property: string, raw: unknown, displayed: string): EditKind | null {
	if (!property.startsWith('note.')) return null;
	const kind = storedKind(raw);
	return kind === displayed ? kind : null;
}

export function parseEdit(kind: EditKind, input: unknown): Editable {
	if (kind === 'boolean' && typeof input === 'boolean') return input;
	if (kind === 'text' && typeof input === 'string') return input;
	if (kind === 'number' && typeof input === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(input.trim())) {
		const n = Number(input.trim());
		if (Number.isFinite(n)) return n;
	}
	throw new Error('Enter a valid ' + kind + ' value. The old value was kept.');
}

/** Called inside processFrontMatter before its object is changed. */
export function applyEdit(frontmatter: Record<string, unknown>, key: string, original: Editable, next: Editable): void {
	if (!Object.prototype.hasOwnProperty.call(frontmatter, key) || !Object.is(frontmatter[key], original)) {
		throw new Error('Conflict: the property changed after this cell was shown. The new value was kept.');
	}
	const kind = storedKind(original);
	if (!kind || storedKind(frontmatter[key]) !== kind || typeof next !== typeof original || (typeof next === 'number' && !Number.isFinite(next))) {
		throw new Error('This property is read only. Its type was kept.');
	}
	frontmatter[key] = next;
}

export interface ComparisonSet { name: string; paths: string[] }
export function normalizeSets(value: unknown): ComparisonSet[] {
	if (!Array.isArray(value)) return [];
	const sets: ComparisonSet[] = [];
	for (const item of value.slice(0, 50)) {
		if (!item || typeof item !== 'object') continue;
		const { name, paths } = item as Partial<ComparisonSet>;
		if (typeof name !== 'string' || !name.trim() || !Array.isArray(paths) || sets.some((s) => s.name === name.trim().slice(0, 80))) continue;
		sets.push({ name: name.trim().slice(0, 80), paths: [...new Set(paths.filter((p): p is string => typeof p === 'string'))].slice(0, 5) });
	}
	return sets;
}

export function selectPaths(paths: string[], selected?: string[]): { paths: string[]; hidden: number; missing: number } {
	const candidates = selected ? paths.filter((p) => selected.includes(p)) : paths;
	return { paths: candidates.slice(0, 5), hidden: Math.max(0, candidates.length - 5), missing: selected ? selected.filter((p) => !paths.includes(p)).length : 0 };
}

export interface Sheet { names: string[]; rows: { label: string; values: string[] }[] }
function markdownCell(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_[\]!~])/g, '\\$1').replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, '<br>');
}
export function toMarkdown(sheet: Sheet): string {
	const row = (cells: string[]) => '| ' + cells.map(markdownCell).join(' | ') + ' |';
	return [row(['Property', ...sheet.names]), row(['---', ...sheet.names.map(() => '---')]), ...sheet.rows.map((r) => row([r.label, ...r.values]))].join('\n') + '\n';
}
