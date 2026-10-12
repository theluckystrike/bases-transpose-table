import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type BasesTransposeTablePlugin from './main';

export class BasesTransposeTableSettingTab extends PluginSettingTab {
	declare plugin: BasesTransposeTablePlugin;
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Comparison view', desc: 'Choose Transpose in a base. Use the Bases properties menu for row order, and its filters and sort menu for note selection and order. The view shows up to five notes.' },
			...sponsorsSettingItems(this.plugin.pro!, PRO_UI),
		];
	}
}
