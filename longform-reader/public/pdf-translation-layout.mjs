import { bounds, sentenceParts, projectAlignedRange } from './document-translation.mjs';
import { sourceFontSize } from './pdf-highlights.mjs';

// Pull quotes often repeat a body sentence. Reuse that sentence's translation
// instead of dropping the quote or sending the same text to the model again.
export function translatedPullQuotes(task) {
  const tokens = text => new Set((text.toLowerCase().match(/[a-z]+/g) || []).filter(w=>w.length>2));
  const quotes = [];
  for (const paragraph of task.paragraphs) {
    if (paragraph.translationVisible || paragraph.figureId || paragraph.original.length<45) continue;
    const box=bounds(paragraph.sourceSegments || []);
    if (!box || box.top<.04 || box.top+box.height>.94) continue;
    const embeddedQuote = /^[“”"‘’]\s*\w/.test(paragraph.original.trim());
    const decoration=embeddedQuote ? paragraph : task.paragraphs.find(p=>p.pageNumber===paragraph.pageNumber && /^[“”"‘’]+$/.test(p.original.trim()) && p.sourceSegments?.some(s=>Math.abs(s.rect.left-box.left)<.025 && s.rect.top<box.top && box.top-s.rect.top<.09));
    if (!decoration) continue;
    const quoteWords=tokens(paragraph.original);
    let best;
    for (const body of task.paragraphs.filter(p=>p.translationVisible && !p.figureId && Math.abs(p.pageNumber-paragraph.pageNumber)<=1)) {
      const parts=sentenceParts(body.original);
      for (let start=0;start<parts.length;start++) {
        for (let length=1;length<=3 && start+length<=parts.length;length++) {
          const end=parts[start+length-1].end, text=body.original.slice(parts[start].start,end), words=tokens(text);
          const overlap=[...quoteWords].filter(w=>words.has(w)).length;
          const score=2*overlap/Math.max(1,quoteWords.size+words.size);
          if (score<.82 || best && score<=best.score) continue;
          const target=task.paragraphs.find(p=>p.id===(body.translationContinuationOf || body.id));
          const ranges=(target?.translationAlignment || []).filter(a=>a.sourceParagraphId===body.id && a.sourceEnd>parts[start].start && a.sourceStart<end);
          const translated=[...new Map(ranges.map(r=>[`${r.start}:${r.end}`,r])).values()].sort((a,b)=>a.start-b.start).map(r=>target.translation.slice(r.start,r.end)).join('');
          if (translated) best={score,translated, sourceParagraphId:body.id, sourceStart:parts[start].start, sourceEnd:end};
        }
      }
    }
    if (best) quotes.push({...paragraph, translation:best.translated, headingLevel:0, pullQuote:true, decorationId:decoration.id,
      quoteSource:{paragraphId:best.sourceParagraphId,start:best.sourceStart,end:best.sourceEnd},
      sourceSegments:embeddedQuote ? paragraph.sourceSegments.filter(s=>!/^\s*[“”"‘’]+\s*$/.test(s.text || '')) : paragraph.sourceSegments});
  }
  return quotes;
}

// Reusing a translation does not reuse its annotation. A pull quote has its own
// source location and becomes highlighted only when that location is selected.
export function pullQuoteRanges(quotes, paragraphId, start, end) {
  const quote=quotes.find(p=>p.id===paragraphId);
  if (!quote || end<=start || start>=quote.original.length || end<=0) return [];
  return [{paragraphId:quote.id,...projectAlignedRange({sourceStart:0,sourceEnd:quote.original.length,start:0,end:quote.translation.length},start,end)}];
}

export function layoutTranslationPage(page, task, {sourceWidth, sourceHeight, figures, quotes, formulas = []}) {
  const content=page.querySelector('.pdf-layout-content');
  if (!content) return;
  const width=content.clientWidth, height=sourceHeight;
  if (!width) return;
  const placements=[];
  const place = (element, box, figure) => {
    element.style.position='absolute';
    element.style.left=`${box.left*100}%`;
    element.style.width=`${box.width*100}%`;
    element.style.margin='0';
    placements.push({element,box,figure});
  };
  for (const element of content.children) {
    const figure=figures.find(f=>f.id===element.dataset.figureId);
    const formula=formulas.find(f=>f.id===element.dataset.mathId);
    const paragraph=[...quotes,...task.paragraphs].find(p=>p.id===(element.dataset.sourceParagraph || element.id));
    let box=figure?.rect || formula?.rect || (element.dataset.sourceRect && JSON.parse(element.dataset.sourceRect)) || paragraph && bounds(paragraph.sourceSegments || []);
    if (!box) continue;
    if (formula) element.style.aspectRatio = String(box.width * width / (box.height * height));
    const text = element.querySelector('.paragraph-text');
    if (text && element.dataset.sourceIndent) text.style.textIndent = `${Number(element.dataset.sourceIndent) * width}px`;
    const heading=element.querySelector('.translation-section-title');
    const body=element.querySelector('.translation-body-text');
    if (heading && body && paragraph) {
      const base=sourceFontSize(paragraph,1);
      const headingSegments=paragraph.sourceSegments.filter(s=>s.rect.height>base*1.14);
      const bodySegments=paragraph.sourceSegments.filter(s=>s.rect.height<=base*1.14);
      const titleBox=bounds(headingSegments), bodyBox=bounds(bodySegments);
      if (titleBox && bodyBox && titleBox.top+titleBox.height<bodyBox.top+.02) {
        element.style.display='contents'; element.style.position='static';
        element.querySelector('.paragraph-text').style.display='contents';
        place(heading,titleBox); place(body,bodyBox); continue;
      }
    }
    place(element,box,figure || formula);
  }
  placements.sort((a,b)=>a.box.top-b.box.top || a.box.left-b.box.left);
  const placed=[];
  for (const item of placements) {
    let top=item.box.top*height;
    const actualHeight=item.element.getBoundingClientRect().height;
    for (const previous of placed) {
      const overlap=Math.min(item.box.left+item.box.width,previous.box.left+previous.box.width)-Math.max(item.box.left,previous.box.left);
      if (overlap < Math.min(item.box.width,previous.box.width)*.15) continue;
      if (previous.figure?.paintRegions?.length && !item.figure) {
        const scale = previous.height / previous.box.height;
        // The surrounding crop can include a blank column or an intentional
        // text slot. Only real painted regions obstruct translated prose.
        const conflicts = previous.figure.paintRegions.filter(r => {
          const horizontal = Math.min(item.box.left + item.box.width, r.left + r.width) - Math.max(item.box.left, r.left);
          const regionTop = previous.top + (r.top - previous.box.top) * scale;
          return horizontal > Math.min(item.box.width, r.width) * .15 && regionTop < top + actualHeight && regionTop + r.height * scale > top;
        });
        if (!conflicts.length) continue;
      }
      const nativeGap=(item.box.top-previous.box.top-previous.box.height)*height;
      // Use the PDF's paragraph spacing; add only a small floor to keep an
      // expanded Chinese paragraph clear of its following formula or heading.
      const gap = Math.max(item.figure || previous.figure ? 8 : 12, Math.min(nativeGap, 36));
      top=Math.max(top,previous.top+previous.height+gap);
    }
    item.element.style.top=`${top}px`;
    placed.push({...item,top,height:actualHeight});
  }
  content.style.height=`${Math.max(height,...placed.map(p=>p.top+p.height+24))}px`;
}
