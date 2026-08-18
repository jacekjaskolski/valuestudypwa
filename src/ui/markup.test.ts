/**
 * Checks on `index.html` that do not need a browser.
 *
 * These exist because of a real failure: an SVG `<filter id="squint">` was added alongside the
 * existing `<input id="squint">`. `getElementById` returned the filter, `requireElement` threw
 * while the module was still initialising, and *every* control died — including the file input,
 * which is what made it look like the app had simply stopped loading photos.
 *
 * A duplicate id is silent in HTML and fatal here, so it is worth a test.
 *
 * The sources are pulled in with Vite's `?raw`, which keeps this free of `@types/node`.
 */

import { describe, expect, it } from 'vitest';
import markup from '../../index.html?raw';
import mainSource from '../main.ts?raw';
import controlsSource from './controls.ts?raw';
import valueBarSource from './valuebar.ts?raw';

/** Every `id="..."` in the markup, in document order. */
function ids(): string[] {
  return [...markup.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!);
}

/**
 * The ids that appear more than once.
 *
 * `Set.add` returns the set, which is always truthy — a `filter((id) => !seen.add(id))` therefore
 * never reports anything, which is how the first version of this passed while checking nothing.
 */
function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      repeated.push(value);
    }
    seen.add(value);
  }
  return repeated;
}

/** Every id the TypeScript demands via `requireElement` / `requireCanvas`. */
function requiredIds(): string[] {
  return [mainSource, controlsSource, valueBarSource].flatMap((source) =>
    [...source.matchAll(/require(?:Element|Canvas)\(\s*'([^']+)'/g)].map((match) => match[1]!),
  );
}

describe('index.html', () => {
  it('catches a duplicate id, so the check below is known to work', () => {
    expect(duplicates(['a', 'b', 'a'])).toEqual(['a']);
  });

  it('gives every element a unique id', () => {
    expect(duplicates(ids())).toEqual([]);
  });

  it('defines every id the app looks up', () => {
    const present = new Set(ids());
    const missing = requiredIds().filter((id) => !present.has(id));
    expect(missing).toEqual([]);
  });

  it('looks up something, so the check above cannot pass by finding nothing', () => {
    expect(requiredIds().length).toBeGreaterThan(10);
  });
});
