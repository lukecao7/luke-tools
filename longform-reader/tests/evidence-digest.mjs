import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {digestCandidates,digestStats,fitDigest,applyDigest,needsDigestRefinement,interleaveDigestTopics} from '../public/evidence-digest.mjs';
import {pullQuoteRanges} from '../public/pdf-translation-layout.mjs';

const text='Tariffs raised production costs for 75 percent of respondents. Firms have changed their sourcing strategies to manage the risk. Demand remains weak despite investment in new products.';
const task={paragraphs:Array.from({length:16},(_,i)=>({id:`p-${i}`,index:i,pageNumber:i+1,original:text,translationVisible:true,translation:'已有中文译文。',translationAlignment:[{start:0,end:8}],highlights:{original:[{id:`ai-${i}`,kind:'ai',start:0,end:text.length}],translation:[]}})),figures:[{id:'chart',labels:[{translation:'75%'}]}],summary:{content:'已有摘要'}};
task.paragraphs.push({id:'chart',index:16,original:'Tariffs 75%',figureId:'chart',translationVisible:false,highlights:{original:[{id:'chart-evidence',kind:'ai',start:0,end:11}],translation:[]}});
const manual={id:'my-highlight',kind:'user',start:0,end:30};task.paragraphs[0].highlights.original.push(manual);
assert(needsDigestRefinement(task));assert.equal(digestStats(task).ratio,1,'Only AI ranges count, overlaps are counted once');
const candidates=digestCandidates(task), originals=task.paragraphs.map(p=>[p.original,p.translation,p.translationAlignment]);
const ids=candidates.filter(c=>c.id.endsWith('s1')).map(c=>c.id);
const digest=fitDigest(task,ids);
assert(digest.selectedCharacters/digest.characters<=.3);assert(digest.selectedCharacters/digest.characters>=.2);
applyDigest(task,digest,randomUUID);
assert(!needsDigestRefinement(task));assert.deepEqual(task.paragraphs[0].highlights.original.find(h=>h.kind==='user'),manual);
assert.deepEqual(task.paragraphs.map(p=>[p.original,p.translation,p.translationAlignment]),originals);
assert.equal(task.paragraphs.at(-1).highlights.original[0].id,'chart-evidence');assert(task.summary.stale);
assert.throws(()=>fitDigest(task,['invented-id']),/无法对应原文/);
assert.throws(()=>fitDigest(task,[]),/不足以覆盖全文/);
const all=fitDigest(task,candidates.map(c=>c.id));assert(all.selectedCharacters/all.characters<=.3,'Returning every sentence must never mark the whole report');
// Rank order matters: a key late chapter must survive the budget, not just early pages.
const acrossThemes=fitDigest(task,interleaveDigestTopics([{topic:'Earlier subject',sentence_ids:candidates.slice(0,24).map(c=>c.id)},{topic:'Later subject',sentence_ids:candidates.slice(24).map(c=>c.id)}]));assert(acrossThemes.selected.some(c=>c.page>8),'Later themes survive even when the model lists sentences in page order');
const ranked=fitDigest(task,[...candidates].reverse().map(c=>c.id));assert.equal(ranked.selected[0].id,candidates.at(-1).id);

const cross={paragraphs:[
{id:'a',index:0,pageNumber:1,translationVisible:true,original:'The survey found that costs rose in the manufacturing',sourceSegments:[{rect:{top:.85,left:.1,width:.4,height:.04}}],highlights:{original:[],translation:[]}},
{id:'b',index:1,pageNumber:2,translationVisible:true,original:'sector, affecting 75 percent of companies. Demand fell.',sourceSegments:[{rect:{top:.08,left:.1,width:.4,height:.04}}],highlights:{original:[],translation:[]}},
...task.paragraphs.slice(2,8).map((p,i)=>({...p,id:`rest${i}`,index:i+2,pageNumber:i+3}))
]};
const sentence=digestCandidates(cross)[0];assert.equal(sentence.sources.length,2);assert.match(sentence.text,/manufacturing sector/);
const fitted=fitDigest(cross,[sentence.id,...digestCandidates(cross).map(c=>c.id)]);applyDigest(cross,fitted,randomUUID);
assert(cross.paragraphs[0].highlights.original.length);assert(cross.paragraphs[1].highlights.original.some(r=>r.start===0 && cross.paragraphs[1].original.slice(0,r.end)==='sector, affecting 75 percent of companies.'),'Cross-page sentence keeps both source fragments');
const quote={id:'quote',original:'75 percent are affected.',translation:'75%的企业受到影响。',quoteSource:{paragraphId:'body',start:0,end:24}};
assert.deepEqual(pullQuoteRanges([quote],'body',0,24),[],'Body evidence must not paint the repeated pull quote');
assert.deepEqual(pullQuoteRanges([quote],'quote',0,quote.original.length),[{paragraphId:'quote',start:0,end:quote.translation.length}]);
assert(pullQuoteRanges([quote],'quote',0,6)[0].end<quote.translation.length,'Resizing a pull quote maps only that selected span');
console.log(JSON.stringify({ok:true,checks:['AI coverage bounded by complete sentences','importance order retained across chapters','manual highlights and chart evidence preserved','translations unchanged','cross-page sentence remains complete','unknown and empty model selections rejected','no inherited pull-quote highlights']}));
