import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createPdfScrollSync } from '../public/pdf-scroll-sync.mjs';
import { normalizeReadingProgress } from '../public/reading-progress.mjs';
import { pageGraphicBounds, completeFigureRect, labelAlignment } from '../public/pdf-figure-layout.mjs';
import { translatedPullQuotes, layoutTranslationPage } from '../public/pdf-translation-layout.mjs';

globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.cancelAnimationFrame = () => {};
function pane() {
  const element = new EventTarget();
  Object.assign(element,{clientHeight:600,scrollHeight:10000,scrollTop:0});
  element.getBoundingClientRect=()=>({top:100});
  element.scrollTo=({top})=>{element.scrollTop=top;};
  element.querySelectorAll=()=>Array.from({length:10},(_,i)=>({dataset:{pageNumber:String(i+1)},getBoundingClientRect:()=>({top:100+i*1000-element.scrollTop,height:1000})}));
  return element;
}
const left=pane(),right=pane();
const sync=createPdfScrollSync({original:left,translation:right,view:'compare',position:{pageNumber:4,fraction:.4},onChange:()=>{}});
const before=left.scrollTop, rightBefore=right.scrollTop;
sync.focus(4,{top:500,height:100},{top:750,height:140});
assert.equal(left.scrollTop,before,'Clicking evidence must not move the source');
assert.equal(right.scrollTop,rightBefore+250,'The translated sentence moves to the exact source height');
right.dispatchEvent(new Event('scroll'));
assert.equal(left.scrollTop,before,'A delayed programmatic scroll event cannot move the source');
sync.focus(4,{top:500,height:100},{top:500,height:140});
assert.equal(left.scrollTop,before); assert.equal(right.scrollTop,rightBefore+250);
sync.focus(4,{top:500,height:100},{top:-350,height:140},3);
const aligned=sync.getPosition(), crossRight=right.scrollTop;
assert.equal(aligned.alignment.translationPageNumber,3);
sync.restore(aligned);
assert.ok(Math.abs(right.scrollTop-crossRight)<=1,'Cross-page translation alignment survives restoration');
assert.equal(left.scrollTop,before);
const progress=normalizeReadingProgress({sourceType:'pdf',sourceAvailable:true,pageCount:10},{kind:'pdf',position:aligned,view:'compare',scale:1,updatedAt:new Date().toISOString()});
assert.equal(progress.position.alignment.translationPageNumber,3);
const beforeTranslationClick = right.scrollTop, beforeSourceFollow = left.scrollTop;
sync.focus(4, {top:450}, {top:300}, 4, 'translation');
assert.equal(right.scrollTop, beforeTranslationClick, 'Clicking translation keeps it stationary');
assert.equal(left.scrollTop, beforeSourceFollow + 150, 'The source follows to the translation height');
left.dispatchEvent(new Event('scroll'));
assert.equal(right.scrollTop, beforeTranslationClick, 'Reverse focus also suppresses delayed scroll echo');
sync.destroy();

const geometry=pageGraphicBounds({fnArray:[pdfjs.OPS.save,pdfjs.OPS.transform,pdfjs.OPS.constructPath,pdfjs.OPS.restore,pdfjs.OPS.constructPath],argsArray:[[],[2,0,0,2,10,20],[pdfjs.OPS.fill,[],[0,0,20,30]],[],[pdfjs.OPS.endPath,[],[0,0,100,100]]]}, {width:100,height:100,transform:[1,0,0,1,0,0]},pdfjs.OPS);
assert.deepEqual(geometry,[{left:.1,top:.2,width:.4,height:.6000000000000001}]);

// A combined figure surrounds a prose slot: the slot must remain at the
// source height, while genuine chart collisions still move text out of the way.
const figureNode = { dataset:{figureId:'combined'}, style:{}, querySelector:()=>null, getBoundingClientRect:()=>({height:800}) };
const proseNode = { id:'prose', dataset:{}, style:{}, querySelector:()=>null, getBoundingClientRect:()=>({height:100}) };
const content = { clientWidth:600, style:{}, children:[proseNode,figureNode] };
const fakePage = { querySelector:()=>content };
const layoutTask = { paragraphs:[{id:'prose',sourceSegments:[{rect:{left:.1,top:.4,width:.8,height:.1}}]}] };
const combined = {id:'combined',rect:{left:.1,top:.1,width:.8,height:.8},paintRegions:[{left:.1,top:.1,width:.8,height:.2},{left:.1,top:.7,width:.8,height:.2}]};
layoutTranslationPage(fakePage,layoutTask,{sourceWidth:600,sourceHeight:1000,figures:[combined],quotes:[]});
assert.equal(proseNode.style.top,'400px','Translated prose stays in the gap between charts');
layoutTask.paragraphs[0].sourceSegments[0].rect.top=.2;
layoutTranslationPage(fakePage,layoutTask,{sourceWidth:600,sourceHeight:1000,figures:[combined],quotes:[]});
assert.ok(parseFloat(proseNode.style.top)>900,'Prose never overlaps actual chart ink');

// Use the report involved in the feedback when available; no provider calls.
const id='63b838d8-5c3d-40d5-b67c-ce0e36d5937f';
let task;
try { task=JSON.parse(await readFile(new URL(`../data/${id}.json`,import.meta.url),'utf8')); } catch(error) { if(error.code!=='ENOENT')throw error; }
if(task){
  const pdf=await pdfjs.getDocument({data:new Uint8Array(await readFile(new URL(`../data/sources/${id}.pdf`,import.meta.url)))}).promise;
  const p7=await pdf.getPage(7), figure=task.figures.find(f=>f.pageNumber===7);
  const graphics=pageGraphicBounds(await p7.getOperatorList(),p7.getViewport({scale:1}),pdfjs.OPS);
  const crop=completeFigureRect(figure,graphics,task.paragraphs);
  assert.ok(crop.top+crop.height>.46,'The whole 68% ring extends beyond the old text-only crop');
  assert.ok(crop.top+crop.height<.57,'The following section must stay outside the chart crop');
  const bars=task.figures.find(f=>f.pageNumber===8);
  for(const label of bars.labels.filter(l=>/costs|outlook|Other|expats/.test(l.original))) assert.equal(labelAlignment(label,bars.labels),'right',label.original);
  assert.equal(labelAlignment(bars.labels.find(l=>l.original==='Top cost concerns'),bars.labels),'left');
  const quotes=translatedPullQuotes(task);
  assert.match(quotes.find(p=>p.id==='p-116').translation,/75%/);
  assert.match(quotes.find(p=>p.id==='p-122').translation,/三分之一/);
  await pdf.destroy();
}
console.log(JSON.stringify({ok:true,checks:['source stays fixed','same-height translation anchor','no scroll echo','cross-page anchor persists','PDF graphics transformed correctly','complete ring crop','original right alignment','pull quotes reuse existing translations'],realReport:!!task}));
