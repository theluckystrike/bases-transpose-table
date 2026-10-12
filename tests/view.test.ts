import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, BasesViewConfig, BooleanValue, NumberValue, StringValue, NullValue } from 'obsidian-test-mocks/obsidian';
import { TransposeView, KEY } from '../src/view';
import { bindPro, resetPro } from '../src/pro';
import { RowEditor } from '../src/row-editor';
import type BasesTransposeTablePlugin from '../src/main';

const views: TransposeView[] = [];
afterEach(() => { for (const view of views.splice(0)) view.unload(); resetPro(); document.body.empty(); });
function setup(files: Record<string, string> = { 'A.md': '---\ncost: 5\nstatus: Draft\ndone: false\n---\nA', 'B.md': '---\ncost: 8\nstatus: Draft\ndone: true\n---\nB' }) {
	const app = App.createConfigured__({ files });
	const plugin = { views: new Set<TransposeView>(), exportView: vi.fn() } as unknown as BasesTransposeTablePlugin;
	const view = new TransposeView({} as never, document.body.createDiv(), plugin);
	view.app = app as never;
	view.load(); views.push(view);
	const config = BasesViewConfig.create__('', 'bases-transpose-table', 'Compare');
	config.setOrder(['note.cost', 'note.status', 'note.done', 'formula.total', 'note.absent']);
	view.config = config as never;
	const entries = Object.keys(files).map((path) => ({
		file: app.vault.getFileByPath(path)!,
		getValue: (property: string) => {
			const fm = app.metadataCache.getFileCache(app.vault.getFileByPath(path)!)?.frontmatter;
			const raw: unknown = fm?.[property.slice(5)];
			if (property === 'formula.total') return new NumberValue(10);
			return typeof raw === 'number' ? new NumberValue(raw) : typeof raw === 'boolean' ? new BooleanValue(raw) : typeof raw === 'string' ? new StringValue(raw) : NullValue.value;
		},
	}));
	view.data = { groupedData: [{ entries, hasKey: () => false }], data: entries } as never;
	view.onDataUpdated();
	return { app, view, config, plugin };
}

describe('comparison controls', () => {
	it('places notes in columns and keeps formulas and missing properties read only', () => {
		const { view } = setup();
		expect(view.sheet.names).toEqual(['A', 'B']);
		expect(view.sheet.rows[0]).toEqual({ label: 'cost', values: ['5', '8'] });
		expect(view.containerEl.querySelectorAll('tr[data-property="note.cost"] input').length).toBe(2);
		expect(view.containerEl.querySelectorAll('tr[data-property="formula.total"] input').length).toBe(0);
		expect(view.containerEl.querySelectorAll('tr[data-property="note.absent"] input').length).toBe(0);
	});
	it('saves multiline text and a second edit before Bases refreshes', async () => {
		const { view, app } = setup();
		const input = view.containerEl.querySelector<HTMLTextAreaElement>('textarea')!;
		input.focus(); input.value = 'Line one\nLine two'; input.blur();
		await vi.waitFor(() => expect(app.metadataCache.getFileCache(app.vault.getFileByPath('A.md')!)?.frontmatter?.status).toBe('Line one\nLine two'));
		input.focus(); input.value = 'Draft'; input.blur();
		await vi.waitFor(() => expect(app.metadataCache.getFileCache(app.vault.getFileByPath('A.md')!)?.frontmatter?.status).toBe('Draft'));
	});
	it('handles a Pro state change before the first query arrives', () => {
		const { view } = setup();
		view.data = undefined as never;
		let change = () => undefined;
		bindPro({ isPro: () => false, onChange: (fn: () => void) => { change = fn; return () => undefined; } } as never);
		expect(() => change()).not.toThrow();
	});
	it('shows no editable cells for an empty query', () => {
		const { view } = setup({});
		expect(view.containerEl.textContent).toContain('No notes to compare');
		expect(view.containerEl.querySelectorAll('input').length).toBe(0);
	});
	it('renders five columns from a query with 50000 entries', () => {
		const { view } = setup({});
		const getValue = vi.fn(() => NullValue.value);
		const entries = Array.from({ length: 50000 }, (_, i) => ({ file: { path: `Note ${i}.md`, basename: `Note ${i}`, extension: 'md' }, getValue }));
		view.data = { groupedData: [{ entries, hasKey: () => false }], data: entries } as never;
		view.onDataUpdated();
		expect(view.sheet.names).toEqual(['Note 0', 'Note 1', 'Note 2', 'Note 3', 'Note 4']);
		expect(view.containerEl.textContent).toContain('first five of 50000');
		expect(getValue).toHaveBeenCalledTimes(25);
	});
	it('does not replace a focused draft during a query update', () => {
		const { view } = setup();
		const input = view.containerEl.querySelector<HTMLInputElement>('input')!;
		input.focus(); input.value = '12'; view.onDataUpdated();
		expect(view.containerEl.querySelector('input')).toBe(input);
		expect(input.value).toBe('12');
	});
	it('keeps the next focused draft when a deferred query refresh runs', async () => {
		const { view } = setup();
		const [first, second] = view.containerEl.querySelectorAll<HTMLInputElement>('tr[data-property="note.cost"] input');
		first!.focus(); view.onDataUpdated();
		second!.focus(); second!.value = '19';
		await new Promise<void>((resolve) => queueMicrotask(resolve));
		expect(second!.isConnected).toBe(true);
		expect(document.activeElement).toBe(second);
		expect(second!.value).toBe('19');
	});
	it('does not save Enter or cancel Escape during input composition', () => {
		const { view, app } = setup();
		const write = vi.spyOn(app.fileManager, 'processFrontMatter');
		const input = view.containerEl.querySelector<HTMLTextAreaElement>('textarea')!;
		input.focus(); input.value = '入力';
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
		expect(document.activeElement).toBe(input);
		expect(write).not.toHaveBeenCalled();
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true }));
		expect(input.value).toBe('入力');
	});
	it('guards Pro sets and ignores saved selections and marks in the free view', () => {
		const { view, config } = setup();
		config.set(KEY.marks, true); config.set(KEY.sets, [{ name: 'One', paths: ['A.md'] }]); config.set(KEY.active, 'One');
		view.onDataUpdated();
		expect(view.sheet.names).toEqual(['A', 'B']);
		expect(view.containerEl.querySelectorAll('.btt-row-mark').length).toBe(0);
		expect(view.saveSet('Blocked')).toBe(false);
		expect(config.get(KEY.sets)).toEqual([{ name: 'One', paths: ['A.md'] }]);
	});
	it('stores a Pro set, refuses a duplicate name, and intersects with the query', () => {
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
		const { view, config } = setup();
		expect(view.saveSet('Planning')).toBe(true);
		expect(config.get(KEY.sets)).toEqual([{ name: 'Planning', paths: ['A.md', 'B.md'] }]);
		expect(view.saveSet('Planning')).toBe(false);
		config.set(KEY.sets, [{ name: 'One', paths: ['B.md', 'Gone.md'] }]); config.set(KEY.active, 'One'); view.onDataUpdated();
		expect(view.sheet.names).toEqual(['B']);
		expect(view.containerEl.textContent).toContain('1 saved notes are absent');
	});
	it('does not rewrite stored CR line breaks when a text cell loses focus without a change', async () => {
		const { view, app } = setup({ 'A.md': '---\nstatus: "one\\r\\ntwo"\n---\nA', 'B.md': '---\nstatus: Draft\n---\nB' });
		expect(app.metadataCache.getFileCache(app.vault.getFileByPath('A.md')!)?.frontmatter?.status).toBe('one\r\ntwo');
		const write = vi.spyOn(app.fileManager, 'processFrontMatter');
		const input = view.containerEl.querySelector<HTMLTextAreaElement>('textarea')!;
		// Chromium returns textarea values with LF line breaks. happy-dom does not, so the test sets that value.
		input.focus(); input.value = 'one\ntwo'; input.blur();
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		expect(write).not.toHaveBeenCalled();
	});
	it('removes a view and its DOM on unload', () => {
		const { view, plugin } = setup();
		expect(plugin.views.size).toBe(1); view.unload();
		expect(plugin.views.size).toBe(0); expect(view.containerEl.isConnected).toBe(false);
	});
});

function enablePro(): void { bindPro({ isPro: () => true, onChange: () => () => undefined } as never); }
function rowDialog(view: TransposeView, property: `note.${string}` = 'note.cost') {
	expect(view.openRowEditor(property)).toBe(true);
	const dialog = document.querySelector<HTMLElement>('.btt-row-editor')!;
	const input = dialog.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')!;
	const click = (text: string) => [...dialog.querySelectorAll('button')].find((button) => button.textContent === text)!.click();
	return { dialog, input, click };
}
function fm(app: ReturnType<typeof setup>['app'], path: string) { return app.metadataCache.getFileCache(app.vault.getFileByPath(path)!)!.frontmatter!; }

describe('Pro row edits', () => {
	beforeEach(() => {
		vi.spyOn(RowEditor.prototype, 'open').mockImplementation(function () { document.body.append(this.containerEl); this.onOpen(); });
	});
	afterEach(() => vi.restoreAllMocks());
	it('blocks the free action before opening a dialog or writing', () => {
		const { view, app } = setup();
		const write = vi.spyOn(app.fileManager, 'processFrontMatter');
		expect(view.containerEl.querySelector('.btt-edit-row')).toBeNull();
		expect(view.openRowEditor('note.cost')).toBe(false);
		expect(document.querySelector('.btt-row-editor')).toBeNull();
		expect(write).not.toHaveBeenCalled();
	});
	it('offers only compatible property rows and lists all target paths', () => {
		enablePro(); const { view } = setup();
		expect(view.containerEl.querySelectorAll('.btt-edit-row')).toHaveLength(3);
		const { dialog, input, click } = rowDialog(view);
		expect([...dialog.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['A.md', 'B.md']);
		expect(input.value).toBe('5');
		click('Cancel');
		expect(view.openRowEditor('formula.total')).toBe(false);
		expect(view.openRowEditor('note.absent')).toBe(false);
	});
	it('writes numbers to every visible note and preserves other data', async () => {
		enablePro(); const { view, app } = setup();
		const { input, click } = rowDialog(view);
		input.value = '12.5'; click('Save row');
		await vi.waitFor(() => expect(view.containerEl.textContent).toContain('Saved cost in 2 of 2 notes.'));
		expect(fm(app, 'A.md')).toMatchObject({ cost: 12.5, status: 'Draft', done: false });
		expect(fm(app, 'B.md')).toMatchObject({ cost: 12.5, status: 'Draft', done: true });
		expect(view.isSaving).toBe(false);
		expect([...view.containerEl.querySelectorAll<HTMLInputElement>('input')].every((input) => !input.disabled)).toBe(true);
	});
	it('rejects bad numeric input without a write and keeps the dialog', () => {
		enablePro(); const { view, app } = setup(); const write = vi.spyOn(app.fileManager, 'processFrontMatter');
		const { dialog, input, click } = rowDialog(view);
		for (const value of ['abc', '', '1e999']) { input.value = value; click('Save row'); }
		expect(dialog.textContent).toContain('Enter a valid number');
		expect(write).not.toHaveBeenCalled();
		expect(view.openRowEditor('note.cost')).toBe(false);
	});
	it('cancel does not change any note', () => {
		enablePro(); const { view, app } = setup(); const write = vi.spyOn(app.fileManager, 'processFrontMatter');
		const { input, click } = rowDialog(view); input.value = '90'; click('Cancel');
		expect(write).not.toHaveBeenCalled();
		expect(fm(app, 'A.md').cost).toBe(5);
	});
	it('writes multiline text without converting it', async () => {
		enablePro(); const { view, app } = setup(); const { input, click } = rowDialog(view, 'note.status');
		input.value = 'Review\nNext week'; click('Save row');
		await vi.waitFor(() => expect(fm(app, 'B.md').status).toBe('Review\nNext week'));
		expect(fm(app, 'A.md').status).toBe('Review\nNext week');
	});
	it('writes checkbox state as a boolean', async () => {
		enablePro(); const { view, app } = setup(); const { input, click } = rowDialog(view, 'note.done');
		(input as HTMLInputElement).checked = true; click('Save row');
		await vi.waitFor(() => expect(fm(app, 'A.md').done).toBe(true));
		expect(fm(app, 'B.md').done).toBe(true);
	});
	it('keeps a concurrent change and reports that path while saving other notes', async () => {
		enablePro(); const { view, app } = setup(); const { input, click } = rowDialog(view);
		await app.fileManager.processFrontMatter(app.vault.getFileByPath('A.md')!, (fm) => { fm.cost = 99; });
		view.onDataUpdated(); input.value = '12'; click('Save row');
		await vi.waitFor(() => expect(view.containerEl.textContent).toContain('Saved cost in 1 of 2 notes.'));
		expect(fm(app, 'A.md').cost).toBe(99); expect(fm(app, 'B.md').cost).toBe(12);
		expect(view.containerEl.textContent).toContain('A.md: Conflict:');
	});
	it('does not create a property deleted while the dialog is open', async () => {
		enablePro(); const { view, app } = setup(); const { input, click } = rowDialog(view);
		await app.fileManager.processFrontMatter(app.vault.getFileByPath('B.md')!, (fm) => { delete fm.cost; });
		input.value = '12'; click('Save row');
		await vi.waitFor(() => expect(view.containerEl.textContent).toContain('Saved cost in 1 of 2 notes.'));
		expect(fm(app, 'B.md')).not.toHaveProperty('cost');
	});
	it('reports a disk failure without undoing the first write', async () => {
		enablePro(); const { view, app } = setup(); const original = app.fileManager.processFrontMatter.bind(app.fileManager);
		vi.spyOn(app.fileManager, 'processFrontMatter').mockImplementation(async (file, fn) => { if (file.path === 'B.md') throw new Error('Disk failure'); await original(file, fn); });
		const { input, click } = rowDialog(view); input.value = '12'; click('Save row');
		await vi.waitFor(() => expect(view.containerEl.textContent).toContain('B.md: Disk failure'));
		expect(fm(app, 'A.md').cost).toBe(12); expect(fm(app, 'B.md').cost).toBe(8);
	});
	it('does not write hidden query notes beyond the five-note limit', async () => {
		enablePro(); const files = Object.fromEntries(['A','B','C','D','E','F'].map((name) => [`${name}.md`, '---\ncost: 5\n---\nBody']));
		const { view, app } = setup(files); const { input, click } = rowDialog(view); input.value = '12'; click('Save row');
		await vi.waitFor(() => expect(view.containerEl.textContent).toContain('Saved cost in 5 of 5 notes.'));
		expect(fm(app, 'E.md').cost).toBe(12); expect(fm(app, 'F.md').cost).toBe(5);
	});
	it('keeps the original target set during a query update', async () => {
		enablePro(); const { view, app } = setup(); const { input, click } = rowDialog(view);
		view.data = { data: [], groupedData: [{ entries: [], hasKey: () => false }] } as never; view.onDataUpdated();
		expect(view.sheet.names).toEqual(['A', 'B']); input.value = '12'; click('Save row');
		await vi.waitFor(() => expect(fm(app, 'B.md').cost).toBe(12));
		expect(view.sheet.names).toEqual([]);
	});
	it('saves only paths in the active Pro set', async () => {
		enablePro(); const { view, app, config } = setup({ 'A.md': '---\ncost: 5\n---', 'B.md': '---\ncost: 8\n---', 'C.md': '---\ncost: 9\n---' });
		config.set(KEY.sets, [{ name: 'Pair', paths: ['A.md', 'C.md'] }]); config.set(KEY.active, 'Pair'); view.onDataUpdated();
		const { input, click } = rowDialog(view); input.value = '12'; click('Save row');
		await vi.waitFor(() => expect(fm(app, 'C.md').cost).toBe(12)); expect(fm(app, 'B.md').cost).toBe(8);
	});
	it('refuses the save after Pro is lost', () => {
		enablePro(); const { view, app } = setup(); const write = vi.spyOn(app.fileManager, 'processFrontMatter');
		const { input, click } = rowDialog(view); input.value = '12'; resetPro(); click('Save row');
		expect(write).not.toHaveBeenCalled(); expect(view.containerEl.textContent).toContain('Row edit was not saved');
	});
	it('closes the dialog on unload and stops later writes', async () => {
		enablePro(); const { view, app } = setup(); const original = app.fileManager.processFrontMatter.bind(app.fileManager);
		vi.spyOn(app.fileManager, 'processFrontMatter').mockImplementation(async (file, fn) => { await original(file, fn); view.unload(); });
		const { dialog, input, click } = rowDialog(view); input.value = '12'; click('Save row');
		await vi.waitFor(() => expect(view.isSaving).toBe(false)); expect(dialog.textContent).toBe('');
		expect(fm(app, 'A.md').cost).toBe(12); expect(fm(app, 'B.md').cost).toBe(8);
	});
	it('stops later writes after Pro is lost during the first write', async () => {
		enablePro(); const { view, app } = setup(); const original = app.fileManager.processFrontMatter.bind(app.fileManager);
		vi.spyOn(app.fileManager, 'processFrontMatter').mockImplementation(async (file, fn) => { await original(file, fn); resetPro(); });
		const { input, click } = rowDialog(view); input.value = '12'; click('Save row');
		await vi.waitFor(() => expect(view.containerEl.textContent).toContain('B.md: Row edit stopped.'));
		expect(fm(app, 'A.md').cost).toBe(12); expect(fm(app, 'B.md').cost).toBe(8);
	});
});
