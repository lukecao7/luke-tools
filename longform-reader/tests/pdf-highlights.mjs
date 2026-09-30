import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { highlightGroups, sourceFontSize } from '../public/pdf-highlights.mjs';
const marks = [{id:'a',start:0,end:3},{id:'b',start:4,end:7},{id:'c',start:14,end:17}];
assert.deepEqual(highlightGroups('one two gap ! six',marks).map(({start,end,ids})=>({start,end,ids})),[{start:0,end:7,ids:['a','b']},{start:14,end:17,ids:['c']}]);
assert.equal(sourceFontSize({sourceSegments:[{text:'Title',rect:{height:.03}},{text:'This is the longer body of the paragraph.',rect:{height:.014}}]},1000),14);
process.env.VERCEL='1';
const {default:app}=await import('../server.mjs');
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}`;
const task=JSON.parse(await readFile(new URL('../data/63b838d8-5c3d-40d5-b67c-ce0e36d5937f.json',import.meta.url)));
const sourcePath=fileURLToPath(new URL(`../data/sources/${task.id}.pdf`,import.meta.url));
const p=task.paragraphs.find(p=>p.original.includes('renewed trade frictions'));
const start=p.original.indexOf('US-China relations continue'),end=p.original.indexOf('Companies’ first');
const split=p.original.indexOf('and tariffs',start);
p.highlights.original=[{id:'a',start,end:split-1,kind:'ai'},{id:'b',start:split,end,kind:'ai'}];p.highlights.translation=[];
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1470,height:950}}),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
let release, hold=false, fail=false;
await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()).pathname;
  if(url.endsWith('/source'))return route.fulfill({path:sourcePath,contentType:'application/pdf'});
  let body={task};
  if(url==='/api/auth/status')body={authenticated:true};
  else if(url==='/api/health')body={online:false,provider:'codex'};
  else if(url==='/api/tasks')body={tasks:[task]};
  else if(url.endsWith('/summary') && route.request().method()==='PATCH'){ task.summary={...task.summary,...route.request().postDataJSON()};body={summary:task.summary}; }
  else if(url.endsWith('/highlights')){
    if(hold)await new Promise(r=>release=r);
    if(fail){fail=false;return route.fulfill({status:503,json:{error:'offline'}});}
    const updates=route.request().postDataJSON().updates;
    updates.forEach(u=>task.paragraphs.find(p=>p.id===u.paragraphId).highlights[u.side]=u.highlights);body={updates};
  }
  await route.fulfill({json:body});
});
const group=page.locator(`.pdf-highlight-group[data-paragraph-id="${p.id}"]`);
const scrolls=()=>page.evaluate(()=>['#pdf-scroll','#pdf-translation-scroll'].map(s=>document.querySelector(s).scrollTop));
async function clickRange(registry){
  const point=await page.evaluate(({registry,id})=>{
    const r=[...CSS.highlights.get(registry)].find(r=>r.startContainer.parentElement.closest(`#${id}`));
    const b=r.getClientRects()[0];return{x:b.x+Math.min(5,b.width/2),y:b.y+b.height/2};
  },{registry,id:p.id});await page.mouse.click(point.x,point.y);
}
try{
  await page.goto(`${base}/#/read/${task.id}`);
  await page.locator('.pdf-page-shell').first().waitFor();
  await page.getByRole('button',{name:'执行摘要 3',exact:true}).click();await group.waitFor();
  const count=await group.locator('.pdf-highlight-overlay').count();assert.ok(count>2);
  const before=await scrolls();
  const box=await group.locator('.pdf-highlight-overlay').first().boundingBox();await page.mouse.click(box.x+3,box.y+3);
  await page.getByRole('button',{name:'取消高亮',exact:true}).waitFor();
  assert.equal((await scrolls())[0],before[0]);
  const paired=await page.evaluate(id=>{const source=document.querySelector(`.pdf-highlight-group[data-paragraph-id="${id}"] .pdf-highlight-overlay`).getBoundingClientRect();const ranges=[...CSS.highlights.get('linked-translation')];return{source:source.top,target:Math.min(...ranges.map(r=>r.getBoundingClientRect().top)),text:ranges.map(r=>r.toString()).join('')};},p.id);
  assert.ok(paired.text.length);assert.ok(Math.abs(paired.source-paired.target)<2);
  checks.push('cross-line highlight selects as one group; source stays fixed; matching translated span aligns');
  const stationary=(await scrolls())[1];await clickRange('saved-translation');
  await page.getByRole('button',{name:'调整译文高亮终点'}).waitFor();assert.equal((await scrolls())[1],stationary);
  hold=true;
  await page.getByRole('button',{name:'取消高亮',exact:true}).click();
  assert.equal(await group.count(),0,'UI removes the source before the server responds');
  assert.equal(await page.evaluate(id=>[...CSS.highlights.get('saved-translation')].filter(r=>r.startContainer.parentElement.closest(`#${id}`)).length,p.id),0);
  assert.equal(p.highlights.original.length,2,'The server response is still deliberately blocked');
  hold=false;release();await page.waitForFunction(()=>document.querySelector('#highlight-save-status').hidden);
  checks.push('translation cancellation updates both panes before a delayed save completes');
  // Select translated prose via real mouse movement.
  const points=await page.evaluate(id=>{const e=document.querySelector(`#${id} .translation-body-text`)||document.querySelector(`#${id} .paragraph-text`);const n=e.firstChild;return[8,25].map(o=>{const r=document.createRange();r.setStart(n,o);r.setEnd(n,o+1);const b=r.getBoundingClientRect();return{x:b.x,y:b.y+b.height/2};});},p.id);
  await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.mouse.move(points[1].x,points[1].y,{steps:8});await page.mouse.up();
  fail=true;await page.getByRole('button',{name:'高亮',exact:true}).click();await group.waitFor();
  await page.getByRole('button',{name:'高亮已暂存 · 点击重试保存'}).waitFor();
  await page.getByRole('button',{name:'高亮已暂存 · 点击重试保存'}).click();
  await page.waitForFunction(()=>document.querySelector('#highlight-save-status').hidden);
  const newRange={...p.highlights.original[0]};assert.ok(newRange.end>newRange.start);
  await page.reload();await group.waitFor();assert.equal(Number(await group.getAttribute('data-start')),newRange.start);
  checks.push('translated selection adds source evidence; failed save stays pending; retry and reload preserve it');
  const current = {...p.highlights.original[0]};
  const visible = await group.locator('.pdf-highlight-overlay').first().boundingBox();
  await page.mouse.click(visible.x + 2, visible.y + 2);
  const targetEnd = current.end - 8;
  const endpoint = await page.evaluate(async ({p, offset}) => {
    const {segmentDomRange} = await import('/pdf-selection.mjs');
    const segment = p.sourceSegments.find(s => s.start <= offset && s.end > offset);
    const rect = segmentDomRange(document.querySelector(`.pdf-page-shell[data-page-number="${p.pageNumber}"] .pdf-text-layer`), segment, offset, offset + 1).getBoundingClientRect();
    return {x:rect.left + rect.width * .2, y:rect.top + rect.height / 2};
  }, {p, offset:targetEnd});
  const handle = await group.locator('.pdf-range-handle.end').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(endpoint.x, endpoint.y, {steps:8}); await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('#highlight-save-status').hidden);
  assert.equal(p.highlights.original[0].start,current.start); assert.equal(p.highlights.original[0].end,targetEnd);
  const sourceAfter = await group.locator('.pdf-highlight-overlay').first().boundingBox();
  await page.mouse.click(sourceAfter.x+2,sourceAfter.y+2);
  hold=true; await page.getByRole('button',{name:'取消高亮',exact:true}).click();
  assert.equal(await group.count(),0); assert.equal(p.highlights.original.length,1);
  hold=false;release();await page.waitForFunction(()=>document.querySelector('#highlight-save-status').hidden);
  checks.push('source endpoint changes propagate; source cancellation also responds before server completion');
  await page.getByRole('button',{name:'查看摘要',exact:true}).click();
  const sizes=await page.locator('.summary-title,.summary-content').evaluateAll(nodes=>nodes.map(n=>({width:n.clientWidth,scrollWidth:n.scrollWidth,height:n.clientHeight,scrollHeight:n.scrollHeight})));
  for(const size of sizes){assert.ok(size.scrollWidth<=size.width+1);assert.ok(size.scrollHeight<=size.height+1);}
  const editedTitle = '一份可以完整编辑和保存的长报告摘要标题：关键结论、证据与风险';
  await page.getByRole('textbox',{name:'摘要标题',exact:true}).fill(editedTitle);
  await page.getByRole('button',{name:'保存修改',exact:true}).click();
  await page.getByText('修改已保存',{exact:true}).waitFor();
  assert.equal(task.summary.title,editedTitle);
  checks.push('summary title wraps fully, edits save intact, and body expands without an internal scroll frame');
  assert.deepEqual(errors,[]);
  const output=new URL('../.runtime/interaction-fix-2026-09-06/',import.meta.url);await mkdir(output,{recursive:true});
  await page.screenshot({path:fileURLToPath(new URL('summary-after.png',output))});
  await writeFile(new URL('browser-regression.json',output),JSON.stringify({ok:true,checks,errors},null,2));console.log(JSON.stringify({ok:true,checks,errors}));
}catch(error){console.log({errors,dom:await page.locator('body').innerText().then(s=>s.slice(0,1000)),source:await page.locator('.pdf-page-shell[data-page-number="4"]').getAttribute('data-rendered')});await page.screenshot({path:'.runtime/interaction-fix-2026-09-06/test-failure.png'});throw error;}finally{await browser.close();server.close();}
