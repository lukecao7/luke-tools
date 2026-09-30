import assert from "node:assert/strict";
import { layoutPageToParagraphs, segmentPdfPages, shouldSkipSuggestedHighlights } from "../server.mjs";
import { ocrReason } from "../ocr/engine.mjs";
import { pdfSelectionBetween } from "../public/pdf-selection.mjs";
import { mergeHighlightRects } from "../public/pdf-highlights.mjs";

const columns = [{ id: "left", original: "First line. Next line." }, { id: "right", original: "Unrelated column." }];
const selected = pdfSelectionBetween(columns, { paragraphId: "left", offset: 0 }, { paragraphId: "left", offset: 16 });
assert.deepEqual(selected.map(p => p.paragraphId), ["left"]);
assert.equal(selected[0].text, "First line. Next");
assert.deepEqual(pdfSelectionBetween(columns, { paragraphId: "left", offset: 16 }, { paragraphId: "left", offset: 0 }), selected);
assert.equal(pdfSelectionBetween(columns, { paragraphId: "left", offset: 4 }, { paragraphId: "left", offset: 4 }).length, 0);
// DOMRect exposes inherited getters; object spread drops its geometry.
const domRect = Object.create({ left: 10, top: 20, width: 40, height: 12 });
assert.deepEqual(mergeHighlightRects([domRect]), [{ left: 10, top: 20, width: 40, height: 12 }]);

const structuralExamples = [
  "TABLE OF CONTENTS Executive Summary 3 Survey Results 5",
  "Executive Summary",
  "AUTHOR Kyle Sullivan EDITOR Erin Slawson",
  "US-CHINA BUSINESS COUNCIL",
];

for (const original of structuralExamples) {
  assert.equal(shouldSkipSuggestedHighlights({ original, headingLevel: 0, pageNumber: 2 }), true, `不应高亮：${original}`);
}

assert.equal(shouldSkipSuggestedHighlights({
  original: "Tariffs are increasing the cost of inputs for 75 percent of surveyed companies.",
  headingLevel: 0,
  pageNumber: 8,
}), false, "关键调查结论应允许进入候选重点");

const paragraphs = segmentPdfPages([
  "Executive Summary\n\nCompanies remain committed to the market.",
  "Risk outlook\n\nTariffs are increasing input costs.",
]);
assert.equal(paragraphs[0].pageNumber, 1);
assert.equal(paragraphs.at(-1).pageNumber, 2);
assert.equal(new Set(paragraphs.map((item) => item.id)).size, paragraphs.length);

const layoutParagraphs = layoutPageToParagraphs({ items: [
  { str: "Left column contains a substantive narrative sentence.", width: 230, height: 11, transform: [11, 0, 0, 11, 36, 410] },
  { str: "It continues on the next line with supporting detail.", width: 228, height: 11, transform: [11, 0, 0, 11, 36, 392] },
  { str: "Right column remains a separate narrative paragraph.", width: 230, height: 11, transform: [11, 0, 0, 11, 320, 410] },
  { str: "It must not be interleaved with the left column.", width: 220, height: 11, transform: [11, 0, 0, 11, 320, 392] },
  { str: "Tariffs increasing input costs", width: 140, height: 8.5, transform: [8.5, 0, 0, 8.5, 80, 620] },
  { str: "75%", width: 18, height: 8.5, transform: [8.5, 0, 0, 8.5, 520, 620] },
] }, { width: 612, height: 792 }, { pageNumber: 8 });
assert.equal(layoutParagraphs.filter((item) => item.roleHint === "body").length, 2, "双栏正文不应交叉拼接");
assert.equal(layoutParagraphs.some((item) => item.original === "75%" && item.roleHint === "chart"), true, "图表数值应保留为可定位区域");
assert.equal(layoutParagraphs.every((item) => item.sourceSegments.every((segment) => segment.rect)), true, "每个 PDF 文字片段应携带稳定坐标");

const spaced = layoutPageToParagraphs({ items: [
  { str: "  Wide   spaces must preserve exact character offsets.  ", width: 300, height: 12, transform: [12, 0, 0, 12, 36, 500] },
] }, { width: 612, height: 792 }, { pageNumber: 1 });
assert.equal(spaced[0].original, "Wide   spaces must preserve exact character offsets.");
assert.equal(spaced[0].sourceSegments[0].sourceStart, 2);
assert.equal(spaced[0].original.slice(spaced[0].sourceSegments[0].start, spaced[0].sourceSegments[0].end), spaced[0].sourceSegments[0].text);
assert.equal(ocrReason({ items: [{ str: "Readable native text should avoid unnecessary OCR." }] }), null);
assert.equal(ocrReason({ items: [] }), "missing-text");
assert.equal(ocrReason({ items: [{ str: "\ufffd\ufffd".repeat(30) }] }), "invalid-text");

console.log(JSON.stringify({ ok: true, structuralExamples: structuralExamples.length, paragraphs: paragraphs.length, layoutParagraphs: layoutParagraphs.length }));
