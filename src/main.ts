import { Notice, Plugin, View, normalizePath, type TFile } from 'obsidian';
import { createGitHubSponsors } from './license/github-obsidian';
import type { SponsorsManager } from './license/index';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { BasesTransposeTableSettingTab } from './settings';
import { TransposeView, VIEW_ID, viewOptions } from './view';
import { toMarkdown } from './model';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

export default class BasesTransposeTablePlugin extends Plugin {
	pro: SponsorsManager | null = null;
	readonly views = new Set<TransposeView>();
	private disposed = false;

	onload(): void {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		this.disposed = false;
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		const tab = new BasesTransposeTableSettingTab(this.app, this);
		this.addSettingTab(tab);
		this.register(pro.onChange(() => tab.update()));
		this.registerBasesView(VIEW_ID, {
			name: 'Transpose', icon: 'table-properties',
			factory: (controller, container) => new TransposeView(controller, container, this),
			options: viewOptions,
		});
		this.addCommand({
			id: 'export-markdown', name: 'Export comparison to Markdown',
			checkCallback: (checking) => {
				const view = this.targetView();
				if (!view) return false;
				if (!checking) void this.exportView(view);
				return true;
			},
		});
		this.app.workspace.onLayoutReady(() => {
			if (this.disposed) return;
			void this.reopenStaleBases();
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}

	onunload(): void { this.disposed = true; resetPro(); }

	targetView(): TransposeView | null {
		const active = this.app.workspace.getActiveViewOfType(View);
		if (!active) return null;
		const matches = [...this.views].filter((v) => active.containerEl.contains(v.containerEl) && v.containerEl.isConnected && v.containerEl.offsetParent !== null);
		return matches.length === 1 ? matches[0]! : null;
	}

	async reopenStaleBases(): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType('bases')) {
			if (this.disposed) return;
			const el = leaf.view.containerEl;
			if (!el.querySelector('.bases-transpose-table') || [...this.views].some((v) => el.contains(v.containerEl))) continue;
			const state = leaf.getViewState();
			await leaf.setViewState({ type: 'empty' });
			await leaf.setViewState(state);
		}
	}

	async exportView(view: TransposeView): Promise<TFile | null> {
		if (!isPro()) { view.proMessage('Markdown export needs Pro.'); return null; }
		if (view.isSaving) { view.message('Wait for the edit to finish before exporting.'); return null; }
		if (!view.sheet.names.length) { view.message('There are no notes to export.'); return null; }
		try {
			const folder = this.app.fileManager.getNewFileParent('');
			const stem = normalizePath(`${folder.path === '/' ? '' : folder.path + '/'}Comparison ${Date.now()}`);
			let path = `${stem}.md`;
			for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = `${stem} ${n}.md`;
			const file = await this.app.vault.create(path, toMarkdown(view.sheet));
			new Notice(`Exported comparison to ${file.path}`);
			return file;
		} catch (error) { view.message(`Export failed: ${String(error)}`); return null; }
	}
}
