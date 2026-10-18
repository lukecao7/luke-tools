import assert from 'node:assert/strict';
import { translationBlocks, translationDisplayText, translationHeadingLabel } from '../public/translation-presentation.mjs';
import { applyTranslationResult } from '../public/document-translation.mjs';

const heading = { original: '4. A Calculus of Dynamic Composition', translation: '4。动态组合的演算', headingLevel: 1 };
assert.equal(translationDisplayText(heading), '4.动态组合的演算');
assert.equal(translationDisplayText(heading).length, heading.translation.length, 'Existing highlight offsets stay valid');
assert.equal(translationHeadingLabel(heading), '4. 动态组合的演算');
assert.equal(translationHeadingLabel({ original: '2.1. Effects', translation: '2。1。效果' }), '2.1. 效果');
assert.equal(translationDisplayText({ original: 'The value is 4.', translation: '值为 4。' }), '值为 4。', 'Ordinary Chinese sentence punctuation stays intact');

const original = 'First paragraph ends. Monadic effects. This paragraph continues onto a wrapped line. Algebraic effects. Final paragraph.';
const translation = '第一段结束。单子效果。此段延续到下一行。代数效果。最后一段。';
const sourceStarts = [0, original.indexOf('Monadic'), original.indexOf('This'), original.indexOf('Algebraic'), original.indexOf('Final')];
const targetStarts = [0, translation.indexOf('单子'), translation.indexOf('此段'), translation.indexOf('代数'), translation.indexOf('最后')];
const p = { id: 'p-1', original, translation, sourceSegments: [
  { start: 0, text: 'First paragraph ends.', rect: { left: .12, top: .1, height: .013 } },
  { start: sourceStarts[1], text: 'Monadic effects. This paragraph', rect: { left: .15, top: .125, height: .013 } },
  { start: original.indexOf('continues'), text: 'continues onto a wrapped line.', rect: { left: .12, top: .141, height: .013 } },
  { start: sourceStarts[3], text: 'Algebraic effects. Final paragraph.', rect: { left: .15, top: .167, height: .013 } },
], translationAlignment: sourceStarts.map((sourceStart, i) => ({ sourceParagraphId: 'p-1', sourceStart,
  sourceEnd: (sourceStarts[i + 1] ?? original.length) - 1, start: targetStarts[i], end: targetStarts[i + 1] ?? translation.length })) };
const before = JSON.stringify(p);
const blocks = translationBlocks(p);
assert.deepEqual(blocks.map(b => b.start), [0, targetStarts[1], targetStarts[3]], 'Recover source paragraph starts, not each PDF line');
assert.equal(blocks.map(b => translation.slice(b.start, b.end)).join(''), translation);
assert.equal(translation.slice(blocks[1].start, blocks[1].leadEnd), '单子效果。');
assert.equal(JSON.stringify(p), before, 'Rendering leaves source, translations and alignment unchanged');
assert.equal(translationBlocks({ ...p, translationAlignment: [] }).length, 1, 'Do not guess Chinese offsets when old alignment is missing');

const listSource = 'Intro: • First item; • Second item.';
const listTarget = '介绍：• 第一项；• 第二项。';
const list = { id: 'list', original: listSource, translation: listTarget,
  sourceSegments: [0, listSource.indexOf('•'), listSource.lastIndexOf('•')].map((start, i) => ({ start,
    text: listSource.slice(start), rect: { left: .12, top: .1 + i * .02, height: .013 } })),
  translationAlignment: [{ sourceParagraphId: 'list', sourceStart: 0, sourceEnd: listSource.length, start: 0, end: listTarget.length }] };
assert.deepEqual(translationBlocks(list).map(b => listTarget.slice(b.start, b.end)), ['介绍：', '• 第一项；', '• 第二项。'], 'Lists can share one aligned sentence with their introduction');

const numberedSource = 'Intro: 1. First item. 2. Second item.';
const numberedTarget = '介绍：1.第一项。2.第二项。';
const numbered = { id: 'numbered', original: numberedSource, translation: numberedTarget,
  sourceSegments: [0, numberedSource.indexOf('1.'), numberedSource.indexOf('2.')].map((start, i) => ({ start,
    text: numberedSource.slice(start), rect: { left: .12, top: .1 + i * .02, height: .013 } })),
  translationAlignment: [
    { sourceStart: 0, sourceEnd: numberedSource.indexOf('First'), start: 0, end: numberedTarget.indexOf('第一') },
    { sourceStart: numberedSource.indexOf('First'), sourceEnd: numberedSource.indexOf('2.'), start: numberedTarget.indexOf('第一'), end: numberedTarget.indexOf('2.') },
    { sourceStart: numberedSource.indexOf('2.'), sourceEnd: numberedSource.length, start: numberedTarget.indexOf('2.'), end: numberedTarget.length },
  ].map(a => ({ ...a, sourceParagraphId: 'numbered' })) };
assert.deepEqual(translationBlocks(numbered).map(b => numberedTarget.slice(b.start, b.end)), ['介绍：', '1.第一项。', '2.第二项。'], 'Number markers stay with their own item');

const task = { paragraphs: [{ id: 'heading', original: heading.original }] };
applyTranslationResult(task, { id: 'heading', original: heading.original, parts: [{ id: 's1', start: 0, end: heading.original.length }],
  sources: [{ id: 'heading', start: 0, end: heading.original.length }] }, { segments: [{ id: 's1', translation: heading.translation }] });
assert.equal(task.paragraphs[0].translation, '4.动态组合的演算', 'New translations save the correct section punctuation');
console.log(JSON.stringify({ ok: true, checks: ['source paragraph boundaries', 'run-in headings', 'stable annotation offsets', 'existing and future section numbering'] }));
