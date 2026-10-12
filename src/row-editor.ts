import { Modal, type App } from 'obsidian';
import { parseEdit, type Editable, type EditKind } from './model';

export class RowEditor extends Modal {
	constructor(app: App, private label: string, private names: string[], private kind: EditKind, private original: Editable, private save: (next: Editable) => Promise<void>, private closed: () => void) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(`Edit ${this.label} in ${this.names.length} notes (Pro)`);
		this.contentEl.addClass('btt-row-editor');
		this.contentEl.createEl('p', { text: 'Save row replaces this property in each note listed below.' });
		const list = this.contentEl.createEl('ul');
		for (const name of this.names) list.createEl('li', { text: name });
		const input = this.kind === 'text'
			? this.contentEl.createEl('textarea', { attr: { rows: '3', 'aria-label': `New ${this.label} value` } })
			: this.contentEl.createEl('input', { attr: { type: this.kind === 'boolean' ? 'checkbox' : 'text', 'aria-label': `New ${this.label} value` } });
		if (this.kind === 'boolean' && 'checked' in input) input.checked = this.original === true;
		else input.value = String(this.original);
		if (this.kind === 'number') input.inputMode = 'decimal';
		const status = this.contentEl.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
		this.contentEl.createEl('p', { text: 'The edit keeps changed or deleted values. It saves each note separately. A failed write does not undo other writes.' });
		const actions = this.contentEl.createDiv({ cls: 'btt-row-actions' });
		actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
		const save = actions.createEl('button', { text: 'Save row', cls: 'mod-cta' });
		save.addEventListener('click', () => {
			let next: Editable;
			try { next = parseEdit(this.kind, this.kind === 'boolean' && 'checked' in input ? input.checked : input.value); }
			catch (error) { status.setText(error instanceof Error ? error.message : String(error)); return; }
			save.disabled = true;
			void this.save(next);
			this.close();
		});
		input.focus();
	}

	onClose(): void { this.contentEl.empty(); this.closed(); }
}
