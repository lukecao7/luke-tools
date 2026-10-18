import { bounds } from './document-translation.mjs';

const mathInk = /[\u0391-\u03c9\u2100-\u214f\u2190-\u22ff\u27c0-\u27ff\u{1d400}-\u{1d7ff}]/u;
const relation = /[=<>∈∉⊆⊂⊇⊃⊢⊣⊨→↦⇒⇔≡≔≤≥∶]/u;
const numbered = /^\(\d+(?:[a-z]|\.\d+)*\)$/i;
const formulaText = text => (mathInk.test(text) || relation.test(text)) && (text.match(/[A-Za-z]{3,}/g) || []).length <= 4
  && !/\b(the|this|for|every|define|write|that|where|proof|lemma|definition|theorem|from|with|under|type|context|is|are)\b/i.test(text);

// Keep display mathematics as PDF pixels. Text extraction loses baselines,
// fraction bars and math fonts, so guessing LaTeX from those strings is unsafe.
// Group nearby pieces (including subscripts and equation numbers) before
// deciding whether they form a formula. No model call or saved-data migration.
export function pdfMathBlocks(task) {
  const result = [];
  for (let pageNumber = 1; pageNumber <= task.pageCount; pageNumber++) {
    const page = task.paragraphs.filter(p => p.pageNumber === pageNumber);
    if (page.some(p => /^(table of contents|contents)$/i.test(p.original.trim()))) continue;
    const numbers = page.filter(p => numbered.test(p.original.trim())).map(p => bounds(p.sourceSegments || [])).filter(r => r?.left > .7);
    const numberedMath = p => {
      const box = bounds(p.sourceSegments || []);
      return box && box.height < .04 && relation.test(p.original) && numbers.some(r => Math.abs(r.top - box.top) < .012);
    };
    const prose = page.filter(p => !p.figureId && !formulaText(p.original) && !numberedMath(p) && /[A-Za-z]{3,}/.test(p.original) && (p.original.match(/[A-Za-z]{3,}/g) || []).length >= 5);
    const candidates = page.filter(p => !p.figureId && !p.headingLevel && !prose.includes(p)
      && (p.translationVisible === false || formulaText(p.original) || numberedMath(p)))
      .map(p => ({ p, rect: bounds(p.sourceSegments || []) })).filter(x => x.rect && x.rect.top > .06 && x.rect.top + x.rect.height < .92)
      // Superscripts/subscripts on a prose baseline belong to inline math, not
      // a separate display block. Otherwise a tiny Γ can drag the next formula
      // crop across an entire intervening paragraph.
      .filter(x => !prose.some(p => (p.sourceSegments || []).some(s => s.rect && s.text?.trim().length > 12
        && x.rect.top < s.rect.top + s.rect.height * .85 && x.rect.top + x.rect.height > s.rect.top + s.rect.height * .15)))
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    const groups = [];
    for (const item of candidates) {
      const previous = groups.at(-1);
      const box = previous && bounds(previous.flatMap(x => x.p.sourceSegments));
      const gap = box && item.rect.top - box.top - box.height;
      const interveningText = box && prose.some(p => (p.sourceSegments || []).some(s => s.rect?.top > box.top && s.rect.top < item.rect.top + .006));
      if (previous && gap <= .04 && !interveningText) previous.push(item);
      else groups.push([item]);
    }
    for (const group of groups) {
      const text = group.map(x => x.p.original).join(' ');
      const hasNumber = group.some(x => numbered.test(x.p.original.trim()));
      const words = text.match(/[A-Za-z]{3,}/g) || [];
      if (!((mathInk.test(text) && (relation.test(text) || hasNumber) || relation.test(text) && (hasNumber || formulaText(text))) && words.length < 28)) continue;
      const rect = bounds(group.flatMap(x => x.p.sourceSegments));
      // Keep a little paper around glyph boxes for accents, descenders and rules.
      const top = Math.max(.025, rect.top - .004), left = Math.max(0, rect.left - .004);
      result.push({ id: `math-${pageNumber}-${result.length + 1}`, pageNumber,
        paragraphIds: group.map(x => x.p.id), original: text,
        rect: { left, top, width: Math.min(1, rect.left + rect.width + .004) - left, height: rect.height + .008 } });
    }
  }
  return result;
}

const pageRenders = new WeakMap();
export async function renderPdfMath({ page, element, block, onReady }) {
  if (element.dataset.rendering || !element.isConnected) return;
  element.dataset.rendering = 'true';
  try {
    let pending = pageRenders.get(page);
    if (!pending) {
      pending = (async () => {
        const viewport = page.getViewport({ scale: 2.5 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        return canvas;
      })();
      pageRenders.set(page, pending);
    }
    const original = await pending;
    if (!element.isConnected) return;
    const r = block.rect, canvas = document.createElement('canvas');
    canvas.width = Math.ceil(r.width * original.width); canvas.height = Math.ceil(r.height * original.height);
    canvas.getContext('2d').drawImage(original, r.left * original.width, r.top * original.height, r.width * original.width, r.height * original.height, 0, 0, canvas.width, canvas.height);
    canvas.className = 'pdf-math-canvas';
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `原文公式：${block.original}`);
    element.replaceChildren(canvas);
    pageRenders.delete(page);
    onReady?.();
  } catch (error) {
    pageRenders.delete(page); delete element.dataset.rendering;
    element.textContent = '公式暂时未能加载，刷新后重试';
    console.error('Formula render failed', error);
  }
}
