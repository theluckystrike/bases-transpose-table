import { BasesView, BooleanValue, NumberValue, StringValue, NullValue, Value, Notice, parsePropertyId, type BasesEntry, type BasesPropertyId, type BasesAllOptions, type QueryController } from 'obsidian';
import type BasesTransposeTablePlugin from './main';
import { isPro, onProChange } from './pro';
import { applyEdit, editableKind, normalizeSets, parseEdit, selectPaths, type Editable, type EditKind, type Sheet } from './model';

export const VIEW_ID = 'bases-transpose-table';
export const KEY = { marks: 'transposeMarks', sets: 'transposeSets', active: 'transposeActiveSet' };
export function viewOptions(): BasesAllOptions[] {
	return [{ type: 'toggle', key: KEY.marks, displayName: 'Mark equal and different rows (Pro)', default: false }];
}

function valueText(value: Value | null): string {
	return value === null || value instanceof NullValue ? '' : value.toString();
}

function displayKind(value: Value | null): string {
	if (value?.constructor === StringValue) return 'text';
	if (value?.constructor === NumberValue) return 'number';
	if (value?.constructor === BooleanValue) return 'boolean';
	return 'readonly';
}

export class TransposeView extends BasesView {
	type = VIEW_ID;
	readonly containerEl: HTMLElement;
	private readonly body: HTMLElement;
	private readonly status: HTMLElement;
	private pending = false;
	private dirty = false;
	private disposed = false;
	sheet: Sheet = { names: [], rows: [] };
	paths: string[] = [];

	constructor(controller: QueryController, containerEl: HTMLElement, private plugin: BasesTransposeTablePlugin) {
		super(controller);
		this.containerEl = containerEl.createDiv({ cls: 'bases-transpose-table' });
		this.body = this.containerEl.createDiv();
		this.status = this.containerEl.createDiv({ cls: 'btt-status', attr: { role: 'status', 'aria-live': 'polite' } });
		plugin.views.add(this);
		this.register(() => { this.disposed = true; plugin.views.delete(this); this.containerEl.remove(); });
		this.register(onProChange(() => this.onDataUpdated()));
	}

	onDataUpdated(): void {
		if (this.disposed || !this.data) return;
		if (this.pending || this.containerEl.contains(this.containerEl.ownerDocument.activeElement) && this.containerEl.ownerDocument.activeElement?.classList.contains('btt-cell-input')) {
			this.dirty = true;
			return;
		}
		this.render();
	}

	get isSaving(): boolean { return this.pending; }

	message(text: string): void { this.status.setText(text); new Notice(text); }

	private render(): void {
		this.dirty = false;
		this.body.empty();
		const pro = isPro();
		const sets = normalizeSets(this.config.get(KEY.sets));
		const active = pro ? sets.find((s) => s.name === this.config.get(KEY.active)) : undefined;
		const grouped = this.data.groupedData.flatMap((g) => g.entries.map((entry) => ({ entry, group: g.hasKey() ? g.key?.toString() ?? '' : '' })));
		const selected = selectPaths(grouped.map(({ entry }) => entry.file.path), active?.paths);
		this.paths = selected.paths;
		const columns = this.paths.map((path) => grouped.find(({ entry }) => entry.file.path === path)!);
		const properties = this.config.getOrder();
		this.sheet = { names: columns.map(({ entry }) => entry.file.basename), rows: [] };
		const toolbar = this.body.createDiv({ cls: 'btt-toolbar' });
		toolbar.createSpan({ cls: 'btt-title', text: `${columns.length} notes · ${properties.length} properties` });
		if (pro) {
			const select = toolbar.createEl('select', { attr: { 'aria-label': 'Saved comparison set' } });
			select.createEl('option', { value: '', text: 'Current query' });
			for (const set of sets) select.createEl('option', { value: set.name, text: set.name });
			select.value = active?.name ?? '';
			select.addEventListener('change', () => { if (!isPro()) return; this.config.set(KEY.active, select.value || null); this.render(); });
			const name = toolbar.createEl('input', { cls: 'btt-set-name', attr: { type: 'text', placeholder: 'Set name', 'aria-label': 'New comparison set name', maxlength: '80' } });
			const save = toolbar.createEl('button', { text: 'Save set' });
			save.disabled = !columns.length;
			save.addEventListener('click', () => this.saveSet(name.value));
			if (active) toolbar.createEl('button', { text: 'Delete set' }).addEventListener('click', () => {
				if (!isPro()) return;
				this.config.set(KEY.sets, sets.filter((s) => s.name !== active.name));
				this.config.set(KEY.active, null); this.render();
			});
			toolbar.createEl('button', { text: 'Export Markdown' }).addEventListener('click', () => void this.plugin.exportView(this));
		} else {
			toolbar.createSpan({ cls: 'btt-pro-note', text: 'Pro adds saved sets, row marks, and Markdown export.' });
		}
		if (selected.hidden) this.body.createDiv({ cls: 'btt-limit', text: `Five-note limit: showing the first five of ${selected.hidden + 5} notes in query and group order. Use Bases filters to choose fewer notes.` });
		if (selected.missing) this.body.createDiv({ cls: 'btt-limit', text: `${selected.missing} saved notes are absent from this query. Check filters, moved notes, or deleted notes.` });
		if (!columns.length) { this.body.createDiv({ cls: 'btt-empty', text: 'No notes to compare. Change the Bases filters or choose Current query.' }); return; }
		if (!properties.length) { this.body.createDiv({ cls: 'btt-empty', text: 'Choose properties from the Bases properties menu to add rows.' }); return; }
		const scroll = this.body.createDiv({ cls: 'btt-scroll' });
		const table = scroll.createEl('table', { cls: 'btt-table', attr: { 'aria-label': 'Note property comparison' } });
		const headings = table.createEl('thead').createEl('tr');
		headings.createEl('th', { text: 'Property', attr: { scope: 'col' } });
		for (const { entry, group } of columns) {
			const th = headings.createEl('th', { attr: { scope: 'col' } });
			const link = th.createEl('a', { text: entry.file.basename, cls: 'internal-link', href: entry.file.path });
			link.addEventListener('click', (event) => { event.preventDefault(); void this.app.workspace.openLinkText(entry.file.path, '', event.ctrlKey || event.metaKey); });
			if (group) th.createDiv({ cls: 'btt-group', text: group });
		}
		const tbody = table.createEl('tbody');
		for (const property of properties) {
			const row = tbody.createEl('tr', { attr: { 'data-property': property } });
			const label = this.config.getDisplayName(property);
			const heading = row.createEl('th', { text: label, attr: { scope: 'row' } });
			const values = columns.map(({ entry }) => entry.getValue(property));
			this.sheet.rows.push({ label, values: values.map(valueText) });
			if (pro && this.config.get(KEY.marks) === true && columns.length > 1) {
				const equal = values.every((v) => Value.equals(values[0] ?? null, v));
				row.classList.add(equal ? 'btt-equal' : 'btt-different');
				heading.createDiv({ cls: 'btt-row-mark', text: equal ? 'Equal' : 'Different' });
			}
			columns.forEach(({ entry }, i) => this.cell(row.createEl('td'), entry, property, values[i] ?? null));
		}
		this.body.createDiv({ cls: 'btt-help', text: 'Text and number: press Enter or leave the cell to save. Escape cancels. Checkboxes save when toggled. Other values are read only.' });
	}

	saveSet(name: string): boolean {
		if (!isPro()) { this.message('Saved comparison sets need Pro.'); return false; }
		if (this.pending) { this.message('Wait for the edit to finish before saving a set.'); return false; }
		name = name.trim().slice(0, 80);
		if (!name || !this.paths.length) { this.message('Enter a set name and compare at least one note.'); return false; }
		const sets = normalizeSets(this.config.get(KEY.sets));
		if (sets.some((s) => s.name === name)) { this.message('That set name exists. Use another name or delete the old set.'); return false; }
		if (sets.length >= 50) { this.message('The view holds up to 50 sets. Delete a set first.'); return false; }
		this.config.set(KEY.sets, [...sets, { name, paths: [...this.paths] }]);
		this.config.set(KEY.active, name);
		this.render();
		this.message(`Saved comparison set ${name}.`);
		return true;
	}

	private cell(td: HTMLElement, entry: BasesEntry, property: BasesPropertyId, value: Value | null): void {
		const { type, name } = parsePropertyId(property);
		const fm = this.app.metadataCache.getFileCache(entry.file)?.frontmatter;
		const raw: unknown = type === 'note' && fm && Object.prototype.hasOwnProperty.call(fm, name) ? fm[name] : undefined;
		const kind = entry.file.extension === 'md' ? editableKind(property, raw, displayKind(value)) : null;
		if (!kind) { td.createSpan({ cls: 'btt-readonly', text: valueText(value), attr: { title: 'Read only' } }); return; }
		let original = raw as Editable;
		const label = `${entry.file.basename}: ${this.config.getDisplayName(property)}`;
		const input = kind === 'text'
			? td.createEl('textarea', { cls: 'btt-cell-input', attr: { rows: '1', 'aria-label': label } })
			: td.createEl('input', { cls: 'btt-cell-input', attr: { type: kind === 'boolean' ? 'checkbox' : 'text', 'aria-label': label } });
		input.dataset.path = entry.file.path;
		input.dataset.property = property;
		if (kind === 'boolean' && 'checked' in input) input.checked = original as boolean;
		else input.value = String(original);
		if (kind === 'number') input.inputMode = 'decimal';
		const sheetRow = this.sheet.rows[this.sheet.rows.length - 1];
		const column = this.paths.indexOf(entry.file.path);
		const commit = () => void this.writeCell(input, entry, name, kind, original, (next) => {
			original = next;
			input.value = String(next);
			if (sheetRow) sheetRow.values[column] = String(next);
		});
		if (kind === 'boolean') input.addEventListener('change', commit);
		input.addEventListener('keydown', (event) => {
			if ((event as KeyboardEvent).isComposing) return;
			const key = (event as KeyboardEvent).key;
			if (key === 'Enter') { event.preventDefault(); input.blur(); }
			if (key === 'Escape') { input.value = String(original); if ('checked' in input) input.checked = original === true; input.blur(); }
		});
		input.addEventListener('blur', () => {
			if (kind !== 'boolean' && input.value !== String(original)) commit();
			else queueMicrotask(() => { if (this.dirty) this.onDataUpdated(); });
		});
	}

	private async writeCell(input: HTMLInputElement | HTMLTextAreaElement, entry: BasesEntry, key: string, kind: EditKind, original: Editable, onSaved: (next: Editable) => void): Promise<void> {
		if (this.pending || this.disposed) return;
		this.pending = true;
		this.containerEl.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('.btt-cell-input').forEach((el) => { el.disabled = true; });
		let saved = false;
		let savedValue: Editable | null = null;
		try {
			const next = parseEdit(kind, kind === 'boolean' && 'checked' in input ? input.checked : input.value);
			await this.app.fileManager.processFrontMatter(entry.file, (fm: Record<string, unknown>) => applyEdit(fm, key, original, next));
			onSaved(next);
			saved = true;
			savedValue = next;
			this.status.setText(`Saved ${key} in ${entry.file.basename}.`);
		} catch (error) { this.message(error instanceof Error ? error.message : String(error)); }
		finally {
			this.pending = false;
			if (!this.disposed) {
				const current: unknown = this.app.metadataCache.getFileCache(entry.file)?.frontmatter?.[key];
				if (!saved || this.dirty && Object.is(current, savedValue)) this.render();
				else this.containerEl.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('.btt-cell-input').forEach((el) => { el.disabled = false; });
			}
		}
	}
}
