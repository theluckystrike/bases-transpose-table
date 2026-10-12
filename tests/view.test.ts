import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, BasesViewConfig, BooleanValue, NumberValue, StringValue, NullValue } from 'obsidian-test-mocks/obsidian';
import { TransposeView, KEY } from '../src/view';
import { bindPro, resetPro } from '../src/pro';
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
	it('removes a view and its DOM on unload', () => {
		const { view, plugin } = setup();
		expect(plugin.views.size).toBe(1); view.unload();
		expect(plugin.views.size).toBe(0); expect(view.containerEl.isConnected).toBe(false);
	});
});
