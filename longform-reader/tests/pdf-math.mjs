import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pdfMathBlocks, filterFormulaText } from '../public/pdf-math.mjs';
import { translationFragments } from '../public/translation-presentation.mjs';

const segment = (text, left, top, width = .6, height = .013) => ({ text, start: 0, end: text.length, rect: { left, top, width, height } });
const p = (id, original, top, left = .12, extra = {}) => ({ id, original, pageNumber: 1, translationVisible: false, sourceSegments: [segment(original, left, top)], ...extra });
const task = { pageCount: 1, paragraphs: [
  p('intro', 'The type is enriched by an effect algebra.', .1, .12, { translationVisible: true }),
  p('inline-subscript', 'effect', .107, .4),
  p('formula', 'Γ ⊢ 𝑡: 𝑇', .15, .4),
  p('subscript', 'effect', .157, .48, { sourceSegments: [segment('effect', .48, .157, .04, .009)] }),
  p('number', '(1)', .15, .85, { sourceSegments: [segment('(1)', .85, .15, .03)] }),
  p('after', 'The following paragraph describes the context.', .2, .12, { translationVisible: true }),
  p('footer', '1', .925, .5),
] };
const blocks = pdfMathBlocks(task);
assert.equal(blocks.length, 1);
assert.deepEqual(new Set(blocks[0].paragraphIds), new Set(['formula', 'subscript', 'number']));
assert.ok(blocks[0].rect.top < .15 && blocks[0].rect.top + blocks[0].rect.height > .166, 'Keep accents, subscripts and equation number together');
assert.ok(!blocks[0].paragraphIds.includes('inline-subscript'), 'An inline subscript cannot pull a display crop over nearby prose');
const ascii = pdfMathBlocks({ pageCount: 1, paragraphs: [p('ascii', 'x = y + z', .2, .4), p('tag', '(2)', .2, .85)] });
assert.equal(ascii.length, 1, 'ASCII-only mathematics also survives');

// The earlier crop started at the previous line's baseline and leaked its
// descenders. Painting is filtered by the formula baseline, rather than by
// cutting closer to the formula and risking its accents or subscripts.
const painted = [];
const context = { getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  fillText(text) { painted.push(text); }, strokeText(text) { painted.push(text); } };
const originalFill = context.fillText;
const restore = filterFormulaText(context, [{ left: .38, top: .502, width: .29, height: .013 }], 1000, 1000);
context.fillText('previous prose descender', 400, 498);
context.fillText('formula', 400, 515);
context.strokeText('accent', 420, 513);
context.fillText('adjacent unrelated text', 800, 515);
assert.deepEqual(painted, ['formula', 'accent']);
restore(); assert.equal(context.fillText, originalFill);

const first = { ...p('first', 'A sentence starts here', .85), translationVisible: true, translation: '一个完整的句子。下一页的正文。',
  translationMembers: ['first', 'next'], translationAlignment: [
    { sourceParagraphId: 'first', sourceStart: 0, sourceEnd: 21, start: 0, end: 8 },
    { sourceParagraphId: 'next', sourceStart: 0, sourceEnd: 5, start: 0, end: 8 },
    { sourceParagraphId: 'next', sourceStart: 6, sourceEnd: 40, start: 8, end: 15 },
  ] };
const next = { ...p('next', 'ends. A whole new paragraph on the next page.', .1), pageNumber: 2, translationContinuationOf: 'first', translationVisible: true };
const crossPage = { pageCount: 2, paragraphs: [first, next] };
const before = JSON.stringify(crossPage);
const fragments = translationFragments(first, crossPage);
assert.deepEqual(fragments.map(f => f.pageNumber), [1, 2]);
assert.equal(fragments.map(f => first.translation.slice(f.start, f.end)).join(''), first.translation);
assert.equal(JSON.stringify(crossPage), before, 'Pagination preserves all saved strings, alignment and highlights');

// Regression: a formula was the root of a translation group and forced two
// subsequent prose paragraphs into the equation's narrow right-hand box.
const formula = { ...p('eq', '𝛾 ↦ 𝑒(𝛾)', .2, .4), translationVisible: true, translation: '𝛾 ↦ 𝑒(𝛾) 这段正文应使用正常栏宽。', translationMembers: ['eq', 'body'],
  translationAlignment: [
    { sourceParagraphId: 'eq', sourceStart: 0, sourceEnd: 11, start: 0, end: 12 },
    { sourceParagraphId: 'body', sourceStart: 0, sourceEnd: 180, start: 0, end: 24 },
  ] };
const body = { ...p('body', 'The following prose belongs to the normal reading column. '.repeat(4), .3), translationVisible: true,
  sourceSegments: [segment('The following prose belongs to the normal reading column.', .12, .3, .76)] };
const normal = translationFragments(formula, { paragraphs: [formula, body] }, { mathIds: new Set(['eq']) });
assert.ok(normal.length && normal[0].start > 0);
assert.equal(normal[0].sourceParagraphId, 'body');
assert.ok(normal[0].rect.width > .7);

// Locally available real paper regression; tests remain portable without it.
let paper;
try { paper = JSON.parse(await readFile(new URL('../.runtime/math-layout-backup-20261018/paper.json', import.meta.url), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
if (paper) {
  const math = pdfMathBlocks(paper), mathIds = new Set(math.flatMap(b => b.paragraphIds));
  const numbers = paper.paragraphs.filter(p => /^\(\d+\)$/.test(p.original.trim()) && p.sourceSegments[0]?.rect.left > .7);
  assert.equal(numbers.filter(p => mathIds.has(p.id)).length, numbers.length, 'Every isolated equation number is retained');
  assert.equal(math.filter(b => b.pageNumber === 7).length, 3);
  const root = paper.paragraphs.find(p => p.id === 'p-529');
  const parts = translationFragments(root, paper, { mathIds });
  assert.ok(parts.every(f => f.rect.width > .7), 'Page 16 prose never uses the formula box');
  assert.match(parts.map(f => root.translation.slice(f.start, f.end)).join(''), /这些构造共同构成/);
  assert.ok(parts.every(f => !root.translation.slice(f.start, f.end).includes('𝛾 ↦')), 'The restored equation is not duplicated as broken plain text');
}
console.log(JSON.stringify({ ok: true, checks: ['display math and numbering', 'inline math exclusion', 'cross-page partition', 'stable annotation offsets', 'formula-root prose column'], realPaper: !!paper }));
