import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type BasesTransposeTablePlugin from './main';
import { helloSettingItems } from './hello/settings';

export class BasesTransposeTableSettingTab extends PluginSettingTab {
	declare plugin: BasesTransposeTablePlugin;
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Comparison view', desc: 'Choose Transpose in a base. Use the Bases properties menu for row order, and its filters and sort menu for note selection and order. The view shows up to five notes.' },
			...sponsorsSettingItems(this.plugin.pro!, PRO_UI),
		];
	}
}
