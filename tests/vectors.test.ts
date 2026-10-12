import { describe, expect, it } from 'vitest';
import vectors from './vectors/bases-transpose-table.json';
import * as model from '../src/model';

describe('golden acceptance cases', () => {
	it('contains at least 20 cases', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
	for (const c of vectors.cases) {
		it(c.name, () => {
			const args = structuredClone(c.args);
			let result: unknown;
			try {
				const fn = model[c.function as keyof typeof model] as (...args: unknown[]) => unknown;
				result = fn(...args);
				if (c.function === 'applyEdit') result = args[0];
			} catch (e) {
				result = { error: (e as Error).message };
				if (c.function === 'applyEdit') expect(args[0]).toEqual(c.args[0]);
			}
			expect(result).toEqual(c.expected);
		});
	}
});
