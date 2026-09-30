import { pageGraphicBounds, completeFigureRect, labelAlignment } from "./pdf-figure-layout.mjs";
// Render the actual PDF graphics, not a re-created chart. Only translated text
// is replaced; numeric values, geometry, colors and legends remain in place.
const pageRenders = new Map();

async function chartPage(page, pdfjs) {
  if (pageRenders.has(page)) {
    const cached = pageRenders.get(page);
    pageRenders.delete(page); pageRenders.set(page, cached);
    return cached;
  }
  const pending = (async () => {
    const viewport = page.getViewport({ scale: 2 });
    const original = document.createElement("canvas"), background = document.createElement("canvas");
    original.width = background.width = Math.ceil(viewport.width);
    original.height = background.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: original.getContext("2d"), viewport }).promise;
    // getOperatorList and render have different optimized operation indexes.
    // Suppress only canvas text painting; PDF text advances and graphics state
    // still execute normally, preserving all paths and fills at exact positions.
    const graphics = background.getContext("2d");
    graphics.fillText = () => {};
    graphics.strokeText = () => {};
    await page.render({ canvasContext: graphics, viewport }).promise;
    const graphicBoxes = pageGraphicBounds(await page.getOperatorList(), viewport, pdfjs.OPS);
    return { original, background, graphics: graphicBoxes, textContent: await page.getTextContent() };
  })();
  pageRenders.set(page, pending);
  // Keep only a few full-resolution pages; the displayed chart crops are separate.
  while (pageRenders.size > 3) pageRenders.delete(pageRenders.keys().next().value);
  pending.catch(() => { if (pageRenders.get(page) === pending) pageRenders.delete(page); });
  return pending;
}

function inkColor(original, background, box) {
  const x = Math.max(0, Math.floor(box.left * original.width)), y = Math.max(0, Math.floor(box.top * original.height));
  const w = Math.min(original.width - x, Math.ceil(box.width * original.width)), h = Math.min(original.height - y, Math.ceil(box.height * original.height));
  if (!w || !h) return "#20282a";
  const pixels = original.getContext("2d").getImageData(x, y, w, h).data;
  const base = background.getContext("2d").getImageData(x, y, w, h).data;
  const colors = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    if (Math.abs(pixels[i] - base[i]) + Math.abs(pixels[i + 1] - base[i + 1]) + Math.abs(pixels[i + 2] - base[i + 2]) < 90) continue;
    const key = [pixels[i], pixels[i + 1], pixels[i + 2]].map(v => Math.round(v / 8) * 8).join(",");
    colors.set(key, (colors.get(key) || 0) + 1);
  }
  return `rgb(${[...colors].sort((a, b) => b[1] - a[1])[0]?.[0] || "32,40,42"})`;
}

export async function renderTranslatedFigure({ page, pdfjs, figure, element, paragraphs = [], sourcePageWidth, onReady }) {
  if (element.dataset.rendering || !element.isConnected) return;
  element.dataset.rendering = "true";
  try {
    const { original, background, graphics, textContent } = await chartPage(page, pdfjs);
    if (!element.isConnected) return;
    const crop = completeFigureRect(figure, graphics, paragraphs), sx = crop.left * original.width, sy = crop.top * original.height;
    element.dataset.crop = JSON.stringify(crop);
    element.dataset.sourceWidth = String(crop.width * sourcePageWidth);
    element.style.setProperty("--source-figure-width", `${crop.width * sourcePageWidth}px`);
    element.style.aspectRatio = String(crop.width * original.width / (crop.height * original.height));
    const width = crop.width * original.width, height = crop.height * original.height;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width); canvas.height = Math.ceil(height);
    const context = canvas.getContext("2d");
    // Start with graphics only: a chart crop may also intersect nearby prose.
    // Keeping the original text here leaks English even when the prose has
    // already been translated and placed elsewhere in the right pane.
    context.drawImage(background, sx, sy, width, height, 0, 0, canvas.width, canvas.height);
    // Preserve numeric labels in their original typeface and exact position.
    for (const label of figure.labels.filter(l => l.translation === l.original)) {
      for (const segment of label.sourceSegments) {
        const r = segment.rect, pad = Math.max(2, r.height * original.height * .18);
        const x = r.left * original.width - sx - 1, y = r.top * original.height - sy - pad;
        const w = r.width * original.width + 2, h = r.height * original.height + pad * 2;
        context.drawImage(original, x + sx, y + sy, w, h, x, y, w, h);
      }
    }
    const labels = element.querySelector(".figure-labels");
    for (const label of figure.labels) {
      if (!label.translation || label.translation === label.original) continue;
      const box = label.rect;
      // Native PDFs have a clean graphics-only background. OCR text is baked
      // into the bitmap, so replace just its word boxes with sampled paper ink.
      for (const segment of label.sourceSegments) {
        const r = segment.rect;
        const pad = Math.max(3, r.height * original.height * .4);
        const x = r.left * original.width - sx - 2, y = r.top * original.height - sy - pad;
        const w = r.width * original.width + 4, h = r.height * original.height + pad * 2;
        if (segment.ocr) {
          const sample = original.getContext("2d").getImageData(Math.max(0, Math.floor(r.left * original.width - 3)), Math.max(0, Math.floor(r.top * original.height)), 1, 1).data;
          context.fillStyle = `rgb(${sample[0]},${sample[1]},${sample[2]})`; context.fillRect(x, y, w, h);
        } else context.drawImage(background, x + sx, y + sy, w, h, x, y, w, h);
      }
      const text = document.createElement("span");
      text.id = `translated-${label.id}`;
      text.className = "figure-translated-label";
      text.dataset.labelId = label.id;
      text.dataset.chartParagraph = label.paragraphId;
      text.dataset.sourceStart = String(label.sourceStart); text.dataset.sourceEnd = String(label.sourceEnd);
      const ink = document.createElement('span'); ink.className = 'figure-label-ink'; ink.textContent = label.translation; text.append(ink);
      text.style.left = `${(box.left - crop.left) / crop.width * 100}%`;
      text.style.top = `${(box.top - crop.top) / crop.height * 100}%`;
      text.style.width = `${box.width / crop.width * 100}%`;
      text.style.color = inkColor(original, background, box);
      text.style.textAlign = labelAlignment(label, figure.labels);
      const sourceItem = textContent.items.filter(item=>String(item.str || "").trim())[label.sourceSegments.find(s=>!s.ocr)?.sourceIndex];
      let fontName = "";
      try { if (sourceItem?.fontName) fontName = page.commonObjs.get(sourceItem.fontName)?.name || ""; } catch { /* OCR and non-embedded fonts use regular weight. */ }
      const weight = /bold|black|heavy/i.test(fontName) ? 700 : 400;
      text.style.fontWeight = String(weight);
      if (/italic|oblique/i.test(fontName)) text.style.fontStyle = "italic";
      const sourceHeight = label.sourceSegments.map(s => s.rect.height).sort((a, b) => a - b)[Math.floor(label.sourceSegments.length / 2)];
      let font = sourceHeight * original.height;
      const measure = document.createElement("canvas").getContext("2d");
      while (font > sourceHeight * original.height * .65) {
        measure.font = `${weight} ${font}px sans-serif`;
        const lines = Math.ceil(measure.measureText(label.translation).width / Math.max(1, box.width * original.width));
        if (lines * font * 1.08 <= Math.max(font * 1.1, box.height * original.height * 1.15)) break;
        font *= .95;
      }
      text.style.fontSize = `${font / width * 100}cqw`;
      labels.append(text);
    }
    canvas.className = "figure-canvas";
    canvas.setAttribute("aria-label", "图表原有图形、数值和配色");
    element.querySelector(".figure-loading")?.remove();
    element.prepend(canvas);
    // Numeric-only chart labels keep their exact PDF pixels, with transparent
    // semantic anchors so selecting source evidence still has a visible match.
    for (const label of figure.labels.filter(l => l.translation === l.original)) {
      const text = document.createElement("span");
      text.id = `translated-${label.id}`; text.className = "figure-numeric-anchor";
      text.dataset.labelId = label.id;
      text.dataset.chartParagraph = label.paragraphId;
      text.dataset.sourceStart = String(label.sourceStart); text.dataset.sourceEnd = String(label.sourceEnd);
      text.setAttribute("aria-label", label.original);
      text.style.cssText = `left:${(label.rect.left - crop.left) / crop.width * 100}%;top:${(label.rect.top - crop.top) / crop.height * 100}%;width:${label.rect.width / crop.width * 100}%;height:${label.rect.height / crop.height * 100}%`;
      const ink = document.createElement('span'); ink.className = 'figure-label-ink'; ink.textContent = label.original; text.append(ink);
      const sourceHeight = Math.max(...label.sourceSegments.map(s => s.rect.height));
      text.style.fontSize = `${sourceHeight * original.height / width * 100}cqw`;
      text.style.textAlign = labelAlignment(label, figure.labels);
      labels.append(text);
    }
    element.setAttribute('role', 'group');
    element.setAttribute('aria-label', '中文图表，可划取文字添加高亮');
    onReady?.();
  } catch (error) {
    delete element.dataset.rendering;
    const message = element.querySelector(".figure-loading");
    if (message) message.textContent = "图表暂时未能加载，请刷新重试。";
    console.error("Figure render failed", error);
  }
}

