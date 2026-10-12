import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import BasesTransposeTablePlugin from '../src/main';
import { bindPro, isPro, onProChange, resetPro, SPONSORS } from '../src/pro';
import manifest from '../manifest.json';

afterEach(resetPro);
describe('Sponsors gate', () => {
	it('starts free and blocks export before a vault write', async () => {
		const app = App.createConfigured__({ files: { 'a.md': '# A' } });
		const plugin = new BasesTransposeTablePlugin(app as never, manifest as never);
		const message = vi.fn();
		expect(await plugin.exportView({ message } as never)).toBeNull();
		expect(message).toHaveBeenCalledOnce();
		expect(isPro()).toBe(false);
	});
	it('redraws when the Sponsors state changes and removes its listener', () => {
		let pro = false;
		let listener = () => undefined;
		const off = vi.fn();
		bindPro({ isPro: () => pro, onChange: (fn: () => void) => { listener = fn; return off; } } as never);
		const change = vi.fn();
		const unlisten = onProChange(change);
		pro = true; listener();
		expect(isPro()).toBe(true);
		expect(change).toHaveBeenCalledOnce();
		unlisten(); listener();
		expect(change).toHaveBeenCalledOnce();
		resetPro();
		expect(off).toHaveBeenCalledOnce();
		expect(isPro()).toBe(false);
	});
	it('uses the reference price and public client id', () => {
		expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' });
	});
});

describe('export command target', () => {
	it('uses the active pane when two comparison panes are visible', () => {
		const app = App.createConfigured__({ files: {} });
		const plugin = new BasesTransposeTablePlugin(app as never, manifest as never);
		const activeContainer = document.body.createDiv();
		const otherContainer = document.body.createDiv();
		const first = { containerEl: activeContainer.createDiv() };
		const second = { containerEl: otherContainer.createDiv() };
		for (const view of [first, second]) Object.defineProperty(view.containerEl, 'offsetParent', { value: document.body });
		plugin.views.add(first as never); plugin.views.add(second as never);
		vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue({ containerEl: activeContainer } as never);
		expect(plugin.targetView()).toBe(first);
		activeContainer.remove(); otherContainer.remove();
	});
	it('does not export an unrelated visible pane when the active pane has no comparison', () => {
		const app = App.createConfigured__({ files: {} });
		const plugin = new BasesTransposeTablePlugin(app as never, manifest as never);
		const containerEl = document.body.createDiv();
		Object.defineProperty(containerEl, 'offsetParent', { value: document.body });
		plugin.views.add({ containerEl } as never);
		vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(null);
		expect(plugin.targetView()).toBeNull();
		containerEl.remove();
	});
});

describe('plugin cleanup', () => {
	it('does not start work when layout becomes ready after unload', () => {
		const app = App.createConfigured__({ files: {} });
		let ready = () => undefined;
		vi.spyOn(app.workspace, 'onLayoutReady').mockImplementation((fn) => { ready = fn; });
		const plugin = new BasesTransposeTablePlugin(app as never, manifest as never);
		plugin.load();
		const reopen = vi.spyOn(plugin, 'reopenStaleBases').mockResolvedValue();
		const refresh = vi.spyOn(plugin.pro!, 'refresh').mockResolvedValue();
		const interval = vi.spyOn(plugin, 'registerInterval').mockImplementation(() => 0);
		plugin.unload(); ready();
		expect(reopen).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
		expect(interval).not.toHaveBeenCalled();
	});
});
