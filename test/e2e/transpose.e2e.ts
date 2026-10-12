import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';
import type BasesTransposeTablePlugin from '../../src/main';
const DIR = 'Bases Transpose Table';
const BASE = `${DIR}/Project comparison.base`;
const ATLAS = `${DIR}/Notes/Atlas.md`;
const BEACON = `${DIR}/Notes/Beacon.md`;
const ROOT = '.workspace-leaf.mod-active .bases-transpose-table';
const costInput = `${ROOT} input[data-path="${ATLAS}"][data-property="note.cost"]`;
async function openView(name = 'Compare'): Promise<void> {
	await browser.executeObsidian(async ({ app }, base, name) => { await app.workspace.openLinkText(`${base}#${name}`, '', false); }, BASE, name);
	await browser.waitUntil(async () => browser.executeObsidian(({ app }, id, name) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, BasesTransposeTablePlugin> } }).plugins.plugins[id];
		const v = p?.targetView();
		if (!v || v.config.name !== name || !v.containerEl.querySelector('.btt-title')) return false;
		if (name === 'Empty') return !!v.containerEl.querySelector('.btt-empty') && v.sheet.names.length === 0;
		if (name === 'Grouped') return v.containerEl.querySelectorAll('.btt-group').length === 5;
		return v.sheet.names.length === (name === 'Six notes' ? 5 : 3);
	}, pluginId, name), { timeout: 15000, timeoutMsg: `View ${name} did not render` });
}
async function state() {
	return browser.executeObsidian(({ app }, id) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, BasesTransposeTablePlugin> } }).plugins.plugins[id]!;
		const v = p.targetView()!;
		return { names: v.sheet.names, rows: v.sheet.rows, text: v.containerEl.textContent ?? '', inputs: v.containerEl.querySelectorAll('.btt-cell-input').length, marks: v.containerEl.querySelectorAll('.btt-row-mark').length, groups: Array.from(v.containerEl.querySelectorAll('.btt-group')).map((e) => e.textContent) };
	}, pluginId);
}
async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, on) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, BasesTransposeTablePlugin> } }).plugins.plugins[id]!;
		if (!on) { p.pro!.signOut(); return; }
		p.pro!['opts'].http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
		await p.pro!.refreshNow();
	}, pluginId, on);
}
async function value(path: string, key: string): Promise<unknown> {
	return browser.executeObsidian(({ app }, path, key) => app.metadataCache.getFileCache(app.vault.getFileByPath(path)!)?.frontmatter?.[key] as unknown, path, key);
}
async function waitValue(path: string, key: string, want: unknown): Promise<void> {
	await browser.waitUntil(async () => (await value(path, key)) === want, { timeout: 10000, timeoutMsg: `${path} ${key} did not become ${String(want)}` });
}
async function draft(selector: string, text: string): Promise<void> {
	const input = await browser.$(selector);
	await input.waitForExist(); await input.click();
	await browser.keys([process.platform === 'darwin' ? 'Meta' : 'Control', 'a']);
	await browser.keys(text || 'Backspace');
	expect(await browser.$(selector).getValue()).toBe(text);
}
async function edit(selector: string, text: string): Promise<void> {
	await draft(selector, text); await browser.keys('Enter');
}
async function clickButton(text: string): Promise<void> {
	await browser.execute((root, text) => {
		const button = Array.from(document.querySelector(root)!.querySelectorAll('button')).find((b) => b.textContent === text);
		if (!button) throw new Error(`Missing button ${text}`);
		button.click();
	}, ROOT, text);
}

// State predicates replace fixed waits. No theme colors or screen coordinates are used.
describe('Transpose in the real app', function () {
	before(async function () { await setPro(false); });
	after(async function () { await setPro(false); });
	it('shows notes in columns and properties in the configured row order', async function () {
		await openView(); const s = await state();
		expect(s.names).toEqual(['Atlas', 'Beacon', 'Cobalt']);
		expect(s.rows.map((r) => r.label)).toEqual(['Cost', 'Status', 'Done', 'Team', 'Deadline', 'Tags', 'Details', 'Total formula', 'File size', 'Missing value']);
		expect(s.rows[0]?.values).toEqual(['5', '8', '5']); expect(s.marks).toBe(0);
	});
	it('writes a number to one note and refreshes its cell', async function () {
		await openView(); await edit(costInput, '12'); await waitValue(ATLAS, 'cost', 12);
		expect(await value(BEACON, 'cost')).toBe(8);
		await browser.waitUntil(async () => (await browser.$(costInput).getValue()) === '12', { timeout: 10000 });
		await edit(costInput, '5'); await waitValue(ATLAS, 'cost', 5);
	});
	it('rejects nonnumeric text and blank input', async function () {
		await openView(); await edit(costInput, 'abc');
		await browser.waitUntil(async () => (await state()).text.includes('Enter a valid number'), { timeout: 10000 });
		expect(await value(ATLAS, 'cost')).toBe(5); await edit(costInput, ''); expect(await value(ATLAS, 'cost')).toBe(5);
	});
	it('toggles boolean values and writes text as text', async function () {
		await openView(); const check = `${ROOT} input[data-path="${ATLAS}"][data-property="note.done"]`;
		await browser.$(check).click(); await waitValue(ATLAS, 'done', true);
		await browser.waitUntil(async () => browser.$(check).isSelected(), { timeout: 10000 });
		await browser.$(check).click(); await waitValue(ATLAS, 'done', false);
		const status = `${ROOT} .btt-cell-input[data-path="${ATLAS}"][data-property="note.status"]`;
		await edit(status, 'Planning'); await waitValue(ATLAS, 'status', 'Planning');
		await edit(status, 'Draft'); await waitValue(ATLAS, 'status', 'Draft');
	});
	it('keeps formula, file, date, list, object and absent cells read only', async function () {
		await openView();
		for (const property of ['formula.total', 'file.size', 'note.deadline', 'note.tags', 'note.details', 'note.missing']) expect(await browser.$$(`${ROOT} tr[data-property="${property}"] input`).length).toBe(0);
		expect((await state()).rows.find((r) => r.label === 'Missing value')?.values).toEqual(['', '', '']);
	});
	it('preserves a concurrent change and reports a conflict', async function () {
		await openView(); const input = await browser.$(costInput); await draft(costInput, '99');
		await browser.executeObsidian(async ({ app }, path) => { await app.fileManager.processFrontMatter(app.vault.getFileByPath(path)!, (fm: Record<string, unknown>) => { fm.cost = 7; }); }, ATLAS);
		await waitValue(ATLAS, 'cost', 7); expect(await input.getValue()).toBe('99'); await browser.keys('Enter');
		await browser.waitUntil(async () => (await state()).text.includes('Conflict:'), { timeout: 10000 });
		expect(await value(ATLAS, 'cost')).toBe(7);
		await browser.waitUntil(async () => (await browser.$(costInput).getValue()) === '7', { timeout: 10000 });
		await edit(costInput, '5'); await waitValue(ATLAS, 'cost', 5);
	});
	it('Escape cancels and an external edit refreshes an unfocused cell', async function () {
		await openView(); const input = await browser.$(costInput); await draft(costInput, '88'); await browser.keys('Escape'); expect(await value(ATLAS, 'cost')).toBe(5);
		await browser.executeObsidian(async ({ app }, path) => { await app.fileManager.processFrontMatter(app.vault.getFileByPath(path)!, (fm: Record<string, unknown>) => { fm.cost = 9; }); }, ATLAS);
		await browser.waitUntil(async () => (await browser.$(costInput).getValue()) === '9', { timeout: 10000 });
		await edit(costInput, '5'); await waitValue(ATLAS, 'cost', 5);
	});
	it('limits six notes and shows an empty state with no editable cells', async function () {
		await openView('Six notes'); expect((await state()).names).toEqual(['Atlas', 'Beacon', 'Cobalt', 'Delta', 'Ember']); expect((await state()).text).toContain('Five-note limit');
		await openView('Empty'); expect((await state()).names).toEqual([]); expect((await state()).inputs).toBe(0); expect((await state()).text).toContain('No notes to compare');
	});
	it('uses grouped query order and labels the groups', async function () {
		await openView('Grouped'); const s = await state(); expect(s.groups).toEqual(['Research', 'Research', 'Research', 'Studio', 'Studio']); expect(s.names).toEqual(['Cobalt', 'Delta', 'Fjord', 'Atlas', 'Beacon']);
	});
	it('opens a note heading and redraws after plugin reload', async function () {
		await openView(); await browser.$(`${ROOT} thead a`).click();
		await browser.waitUntil(async () => (await browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path)) === ATLAS, { timeout: 10000 });
		await openView(); expect((await reloadPlugin(pluginId)).errors).toEqual([]); await openView(); expect((await state()).names.length).toBe(3);
	});
	it('free state ignores Pro marks and blocks saving and export', async function () {
		await setPro(false); await openView('Marked'); expect((await state()).marks).toBe(0);
		const result = await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, BasesTransposeTablePlugin> } }).plugins.plugins[id]!;
			return { saved: p.targetView()!.saveSet('Blocked'), exported: await p.exportView(p.targetView()!) };
		}, pluginId); expect(result).toEqual({ saved: false, exported: null });
	});
	it('Pro marks rows, saves a named set, exports Markdown and returns to free', async function () {
		await setPro(true); await openView('Marked'); expect((await state()).marks).toBe(10);
		expect(await browser.$$(`${ROOT} .btt-equal`).length).toBeGreaterThan(0); expect(await browser.$$(`${ROOT} .btt-different`).length).toBeGreaterThan(0);
		await browser.$(`${ROOT} .btt-set-name`).setValue('Planning'); await clickButton('Save set');
		await browser.waitUntil(async () => (await obsidianPage.read(BASE)).includes('transposeSets'), { timeout: 10000 }); expect(await obsidianPage.read(BASE)).toContain(ATLAS);
		const markdown = await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, BasesTransposeTablePlugin> } }).plugins.plugins[id]!;
			const file = await p.exportView(p.targetView()!); if (!file) return ''; const text = await app.vault.read(file); await app.vault.delete(file); return text;
		}, pluginId);
		expect(markdown).toContain('| Property | Atlas | Beacon | Cobalt |'); expect(markdown).toContain('| Cost | 5 | 8 | 5 |');
		await clickButton('Delete set'); await setPro(false); await browser.waitUntil(async () => (await state()).marks === 0, { timeout: 10000 });
	});
	it('Pro row editor cancels, rejects invalid input, and saves only five visible notes', async function () {
		await setPro(true); await openView('Six notes');
		const paths = await browser.executeObsidian(({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, BasesTransposeTablePlugin> } }).plugins.plugins[id]!;
			return [...p.targetView()!.paths];
		}, pluginId);
		const originals = await Promise.all(paths.map((path) => value(path, 'cost')));
		const hidden = `${DIR}/Notes/Fjord.md`;
		const hiddenOriginal = await value(hidden, 'cost');
		try {
			await browser.$(`${ROOT} tr[data-property="note.cost"] .btt-edit-row`).click();
			expect(await browser.$$('.btt-row-editor li').length).toBe(5);
			await browser.$('.btt-row-editor input').setValue('abc');
			await browser.$('.btt-row-actions .mod-cta').click();
			expect(await browser.$('.btt-row-editor').getText()).toContain('Enter a valid number');
			expect(await value(paths[0]!, 'cost')).toBe(originals[0]);
			await browser.$('.btt-row-actions button').click();
			expect(await browser.$('.btt-row-editor').isExisting()).toBe(false);
			await browser.$(`${ROOT} tr[data-property="note.cost"] .btt-edit-row`).click();
			await browser.$('.btt-row-editor input').setValue('12.5');
			await browser.$('.btt-row-actions .mod-cta').click();
			for (const path of paths) await waitValue(path, 'cost', 12.5);
			expect(await value(hidden, 'cost')).toBe(hiddenOriginal);
			expect((await state()).text).toContain('Saved cost in 5 of 5 notes.');
		} finally {
			await browser.executeObsidian(async ({ app }, paths, originals) => {
				for (let i = 0; i < paths.length; i++) await app.fileManager.processFrontMatter(app.vault.getFileByPath(paths[i]!)!, (fm: Record<string, unknown>) => { fm.cost = originals[i]; });
			}, paths, originals);
			await setPro(false);
		}
	});
	it('Pro row edit keeps a concurrent value and reports partial success', async function () {
		await setPro(true); await openView();
		const paths = [ATLAS, BEACON, `${DIR}/Notes/Cobalt.md`];
		const originals = await Promise.all(paths.map((path) => value(path, 'cost')));
		try {
			await browser.$(`${ROOT} tr[data-property="note.cost"] .btt-edit-row`).click();
			await browser.executeObsidian(async ({ app }, path) => { await app.fileManager.processFrontMatter(app.vault.getFileByPath(path)!, (fm: Record<string, unknown>) => { fm.cost = 99; }); }, ATLAS);
			await waitValue(ATLAS, 'cost', 99);
			await browser.$('.btt-row-editor input').setValue('12');
			await browser.$('.btt-row-actions .mod-cta').click();
			await waitValue(BEACON, 'cost', 12); await waitValue(paths[2]!, 'cost', 12);
			expect(await value(ATLAS, 'cost')).toBe(99);
			await browser.waitUntil(async () => (await state()).text.includes('Saved cost in 2 of 3 notes.'), { timeout: 10000 });
			expect((await state()).text).toContain(`${ATLAS}: Conflict:`);
		} finally {
			await browser.executeObsidian(async ({ app }, paths, originals) => {
				for (let i = 0; i < paths.length; i++) await app.fileManager.processFrontMatter(app.vault.getFileByPath(paths[i]!)!, (fm: Record<string, unknown>) => { fm.cost = originals[i]; });
			}, paths, originals);
			await setPro(false);
		}
	});

});
