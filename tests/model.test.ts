import { describe, expect, it } from 'vitest';
import { normalizeSets, toMarkdown } from '../src/model';

describe('Markdown line breaks', () => {
	it('keeps CR, LF and CRLF inside one table cell', () => {
		const markdown = toMarkdown({ names: ['A'], rows: [{ label: 'Text', values: ['one\rtwo\nthree\r\nfour'] }] });
		expect(markdown).toBe('| Property | A |\n| --- | --- |\n| Text | one<br>two<br>three<br>four |\n');
	});
});


describe('saved set names', () => {
	it('drops duplicate names after truncating hand-edited config values', () => {
		const name = 'A'.repeat(80);
		expect(normalizeSets([{ name: name + 'one', paths: ['A.md'] }, { name: name + 'two', paths: ['B.md'] }])).toEqual([{ name, paths: ['A.md'] }]);
	});
});

describe('Markdown export marks', () => {
	it('escapes tag, math, comment and highlight marks so the export keeps plain value text', () => {
		const markdown = toMarkdown({ names: ['A'], rows: [{ label: 'Note', values: ['#urgent $5/$8 %%hidden%% ==mark=='] }] });
		expect(markdown).toBe('| Property | A |\n| --- | --- |\n| Note | \\#urgent \\$5/\\$8 \\%\\%hidden\\%\\% \\=\\=mark\\=\\= |\n');
	});
});
