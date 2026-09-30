import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,symlink,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {digestStats} from '../public/evidence-digest.mjs';

const root=path.resolve(import.meta.dirname,'..'),dir=await mkdtemp(path.join(tmpdir(),'reading-byok-'));
const keyA='sk-test-reader-a-1234567890',keyB='sk-test-reader-b-1234567890',spaceA='a'.repeat(64),spaceB='b'.repeat(64);
const calls=[];let server, api, depleted=false, rejectChat=false, incompleteMode='', translationAttempts=0, refineDelay=0;
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const hash=s=>createHash('sha256').update(s).digest('hex');
const until=async check=>{for(let i=0;i<120;i++){if(await check())return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out');};
try {
 api=createServer(async(req,res)=>{
   res.setHeader('Content-Type','application/json');
   const key=(req.headers.authorization || '').replace('Bearer ','');
   if(![keyA,keyB].includes(key)){res.writeHead(401);return res.end('{}');}
   if(req.url==='/user/balance')return res.end(JSON.stringify({is_available:!depleted,balance_infos:[{currency:'CNY',total_balance:depleted?'0.00':'8.00'}]}));
   let raw='';for await(const chunk of req)raw+=chunk;
   const body=JSON.parse(raw);calls.push({key,body});
   if(rejectChat){res.writeHead(402);return res.end('{}');}
   const prompt=body.messages.at(-1).content;
   let result;
   if(prompt.includes('SOURCE_BLOCKS:')){const items=JSON.parse(prompt.split('SOURCE_BLOCKS:').at(-1));result={body_ids:items.map(p=>p.id),figures:[],highlights:items.map(p=>({id:p.id,quotes:[p.text]}))};}
   else if(prompt.includes('SOURCE_ITEMS:')){
     const items=JSON.parse(prompt.split('SOURCE_ITEMS:').at(-1));translationAttempts++;
     result={translations:Object.fromEntries(items.map(p=>[p.id,Object.fromEntries([...p.text.matchAll(/^\[(s\d+)\]/gm)].map(m=>[m[1],'验证文字。']))]))};
     if(incompleteMode==='always' || incompleteMode==='once' && translationAttempts===1)delete result.translations['p-2']?.s2;
   }
   else if(prompt.includes('SENTENCES:')) {
     const sentences=JSON.parse(prompt.split('SENTENCES:').at(-1));result={topics:[{topic:"测试主题",sentence_ids:sentences.map(s=>s.id)}]};
     if(refineDelay)await new Promise(r=>setTimeout(r,refineDelay));
   }
   else result={title:'隔离验证摘要',summary:key===keyA?'用户甲摘要':'用户乙摘要',answer:'这是验证解释。'};
   res.end(JSON.stringify({choices:[{message:{tool_calls:[{function:{name:'return_result',arguments:JSON.stringify(result)}}]}}]}));
 });
 const apiPort=await listen(api);
 for(const name of ['server.mjs','deepseek-access.mjs','task-updates.mjs','package.json'])await copyFile(path.join(root,name),path.join(dir,name));
 for(const name of ['public','schemas','ocr','node_modules'])await symlink(path.join(root,name),path.join(dir,name));
 const probe=createServer();const port=await listen(probe);await new Promise(r=>probe.close(r));
 const url=`http://127.0.0.1:${port}`;
 server=spawn(process.execPath,['server.mjs'],{cwd:dir,env:{...process.env,VERCEL:'0',USER_OWNED_KEYS:'1',STORAGE_PROVIDER:'local',APP_PASSWORD:'',DEEPSEEK_API_KEY:'sk-server-key-must-never-be-used',DEEPSEEK_BASE_URL:`http://127.0.0.1:${apiPort}`,PORT:String(port)},stdio:'ignore'});
 await until(()=>fetch(url+'/api/health').then(r=>r.ok,()=>false));
 const headers=(space,key)=>({'X-Reading-Space':space,...(key?{'X-DeepSeek-Key':key}:{})});
 const request=(route,space,key,method='GET',body)=>fetch(url+route,{method,headers:{...headers(space,key),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 if(process.argv.includes('--serve')) {
   console.log(JSON.stringify({url,dir,keyA,keyB,spaceA,spaceB}));
   // Browser checks can switch the mock's balance without touching a provider.
   const timer=setInterval(async()=>{depleted=await readFile(path.join(dir,'depleted'),'utf8').then(()=>true,()=>false);},100);
   await new Promise(r=>{process.once('SIGINT',r);process.once('SIGTERM',r);});clearInterval(timer);
 } else {
   assert.equal((await fetch(url+'/api/tasks')).status,428);
   assert.equal((await request('/api/tasks/..%2F..%2Fsecret',spaceA)).status,400);
   const health=await(await fetch(url+'/api/health')).json();assert.equal(health.model,'deepseek-v4-flash');assert.equal(health.userOwnedKeys,true);
   assert.equal((await request('/api/deepseek/balance',spaceA)).status,428);
   assert.equal((await request('/api/deepseek/balance',spaceA,'sk-invalid-key-123456789')).status,401);
   assert.equal((await(await request('/api/deepseek/balance',spaceA,keyA)).json()).available,true);
   assert.equal((await request('/api/tasks',spaceA,undefined,'POST',{text:'不得使用服务器共享 Key。'})).status,428);
   const id=randomUUID(),folder=path.join(dir,'data/spaces',hash(spaceA));await mkdir(path.join(folder,'sources'),{recursive:true});
   const task={id,title:'隔离材料',sourceType:'pdf',sourceAvailable:true,status:'ready',pageCount:1,paragraphs:[{id:'p-1',index:0,pageNumber:1,original:'Evidence supports this conclusion.',translation:'证据支持这一结论。',highlights:{original:[{id:'h-1',start:0,end:33,kind:'user'}],translation:[]}}]};
   await writeFile(path.join(folder,id+'.json'),JSON.stringify(task));await writeFile(path.join(folder,'sources',id+'.pdf'),'%PDF-test-source');
   assert.equal((await(await request('/api/tasks',spaceA)).json()).tasks.length,1);
   assert.equal((await(await request('/api/tasks',spaceB)).json()).tasks.length,0);
   for(const route of [`/api/tasks/${id}`,`/api/tasks/${id}/source`])assert.equal((await request(route,spaceB)).status,404);
   assert.equal((await request(`/api/tasks/${id}/highlights`,spaceB,undefined,'PATCH',{paragraphId:'p-1',side:'original',highlights:[]})).status,404);
   assert.equal((await request(`/api/tasks/${id}`,spaceB,undefined,'DELETE')).status,404);
   assert.equal((await request(`/api/tasks/${id}`,spaceA)).status,200);
   const form=new FormData();form.append('files',new Blob(['先说结论，再列依据。示范事实不可引用。']),'style.txt');
   assert.equal((await fetch(url+'/api/style-examples',{method:'POST',headers:headers(spaceA),body:form})).status,201);
   const pdfForm=new FormData();pdfForm.append('files',new Blob([await readFile(path.join(root,'tests/fixtures/selection-native.pdf'))],{type:'application/pdf'}),'selection-native.pdf');
   const pdfUpload=await fetch(url+'/api/style-examples',{method:'POST',headers:headers(spaceA),body:pdfForm});
   assert.equal(pdfUpload.status,201);assert.ok((await pdfUpload.json()).examples.find(example=>example.name==='selection-native.pdf').characters>200,'PDF uploads must parse before any model call');
   assert.equal((await(await request('/api/style-examples',spaceB)).json()).examples.length,0);
   assert.equal((await request(`/api/tasks/${id}/summary`,spaceA,keyA,'POST',{targetLength:800})).status,200);
   assert.equal(calls.at(-1).key,keyA);assert.equal(calls.at(-1).body.model,'deepseek-v4-flash');assert.match(calls.at(-1).body.messages.at(-1).content,/示范事实/);
   const old=(await(await request(`/api/tasks/${id}`,spaceA)).json()).task.summary;
   depleted=true;const before=calls.length;
   assert.equal((await request(`/api/tasks/${id}/summary`,spaceA,keyA,'POST',{targetLength:800})).status,402);assert.equal(calls.length,before);
   depleted=false;rejectChat=true;
   assert.equal((await request(`/api/tasks/${id}/summary`,spaceA,keyA,'POST',{targetLength:800})).status,402);assert.equal(calls.length,before+1,'Do not retry a depleted key');
   const failed=(await(await request(`/api/tasks/${id}`,spaceA)).json()).task;assert.deepEqual(failed.summary,old);assert.equal(failed.summaryProgress.code,'DEEPSEEK_BALANCE_LOW');
   rejectChat=false;
   // Same task ID in two browsers remains isolated, even under concurrent requests.
   const folderB=path.join(dir,'data/spaces',hash(spaceB));await mkdir(folderB,{recursive:true});await writeFile(path.join(folderB,id+'.json'),JSON.stringify(task));
   const concurrent=await Promise.all([request(`/api/tasks/${id}/summary`,spaceA,keyA,'POST',{targetLength:800}),request(`/api/tasks/${id}/summary`,spaceB,keyB,'POST',{targetLength:800})]);
   assert.deepEqual(concurrent.map(r=>r.status),[200,200]);
   assert.equal((await(await request(`/api/tasks/${id}`,spaceA)).json()).task.summary.content,'用户甲摘要');
   assert.equal((await(await request(`/api/tasks/${id}`,spaceB)).json()).task.summary.content,'用户乙摘要');
   const recoveryId=randomUUID(),recovery={...task,id:recoveryId,sourceType:'paste',sourceAvailable:false,documentAnalyzed:true,processingStartedAt:new Date(Date.now()-12000).toISOString(),paragraphs:[
     {...task.paragraphs[0],index:0,language:'en',translationVisible:true,status:'pending',translation:''},
     {...task.paragraphs[0],id:'p-2',index:1,language:'en',original:'Trade creates risks. Eighty-eight percent are affected.',translationVisible:true,status:'pending',translation:''}
   ]};
   await writeFile(path.join(folder,recoveryId+'.json'),JSON.stringify(recovery));
   incompleteMode='once';translationAttempts=0;const beforeRecovery=calls.length;
   await request(`/api/tasks/${recoveryId}/retry`,spaceA,keyA,'POST',{});
   await until(async()=> (await(await request(`/api/tasks/${recoveryId}`,spaceA)).json()).task.status==='ready');
   const recoveryCalls=calls.slice(beforeRecovery);assert.equal(recoveryCalls.length,2);
   const retryItems=JSON.parse(recoveryCalls[1].body.messages.at(-1).content.split('SOURCE_ITEMS:').at(-1));
   assert.deepEqual(retryItems.map(p=>p.id),['p-2'],'Only incomplete paragraphs are requested again');
   assert.match(retryItems[0].text,/Trade creates risks/);assert.match(retryItems[0].text,/Eighty-eight percent/,'Repair retains the complete paragraph context');
   const contract=recoveryCalls[0].body.tools[0].function.parameters;
   assert.deepEqual(contract.properties.translations.properties['p-2'].required,['s1','s2']);
   assert.equal(recoveryCalls[0].body.tools[0].function.strict,true);
   await writeFile(path.join(folder,recoveryId+'.json'),JSON.stringify(recovery));
   incompleteMode='always';translationAttempts=0;
   await request(`/api/tasks/${recoveryId}/retry`,spaceA,keyA,'POST',{});
   await until(async()=> (await(await request(`/api/tasks/${recoveryId}`,spaceA)).json()).task.status==='failed');
   const incomplete=(await(await request(`/api/tasks/${recoveryId}`,spaceA)).json()).task;
   assert.equal(incomplete.paragraphs[0].status,'done');assert.equal(incomplete.paragraphs[1].status,'pending');assert.equal(incomplete.errorCode,'TRANSLATION_INCOMPLETE');
   incompleteMode='';const beforeResume=calls.length;
   await request(`/api/tasks/${recoveryId}/retry`,spaceA,keyA,'POST',{});
   await until(async()=> (await(await request(`/api/tasks/${recoveryId}`,spaceA)).json()).task.status==='ready');
   assert.equal(calls.length,beforeResume+1);assert.deepEqual(JSON.parse(calls.at(-1).body.messages.at(-1).content.split('SOURCE_ITEMS:').at(-1)).map(p=>p.id),['p-2']);
   // An over-selected saved report is repaired once without translating again.
   const refineId=randomUUID(),refineText='Tariffs raised costs for 75 percent of firms. Companies shifted their supply chains. Demand remains weak despite new investment.';
   const refineTask={...recovery,id:refineId,status:'ready',paragraphs:Array.from({length:20},(_,i)=>({id:`p-${i}`,index:i,original:refineText,translation:'已保存的中文。',translationVisible:true,status:'done',highlights:{original:[{id:`a-${i}`,kind:'ai',start:0,end:refineText.length}],translation:[]}}))};
   await writeFile(path.join(folder,refineId+'.json'),JSON.stringify(refineTask));
   assert.equal((await request(`/api/tasks/${refineId}/refine-highlights`,spaceB,keyB,'POST')).status,404);
   depleted=true;assert.equal((await request(`/api/tasks/${refineId}/refine-highlights`,spaceA,keyA,'POST')).status,402);depleted=false;
   refineDelay=250;const beforeRefine=calls.length;
   const refinement=request(`/api/tasks/${refineId}/refine-highlights`,spaceA,keyA,'POST');
   await until(()=>calls.length>beforeRefine);
   const userRange={id:'concurrent-manual',kind:'user',start:0,end:20};
   await request(`/api/tasks/${refineId}/highlights`,spaceA,undefined,'PATCH',{paragraphId:'p-1',side:'original',highlights:[userRange]});
   const refined=(await(await refinement).json()).task;
   assert(digestStats(refined).ratio<=.30);assert.equal(calls.length,beforeRefine+1);
   assert(refined.paragraphs[1].highlights.original.some(r=>r.id===userRange.id));
   assert(refined.paragraphs.every(p=>p.translation==='已保存的中文。'));
   await request(`/api/tasks/${refineId}/refine-highlights`,spaceA,keyA,'POST');assert.equal(calls.length,beforeRefine+1,'Already fixed reports incur no further model call');
   await writeFile(path.join(folder,refineId+'.json'),JSON.stringify(refineTask));
   const cancelBefore=calls.length,cancelledRefinement=request(`/api/tasks/${refineId}/refine-highlights`,spaceA,keyA,'POST');
   await until(()=>calls.length>cancelBefore);
   assert.equal((await request(`/api/tasks/${refineId}/cancel`,spaceA,undefined,'POST')).status,200);
   assert.equal((await cancelledRefinement).status,400);
   const cancelled=(await(await request(`/api/tasks/${refineId}`,spaceA)).json()).task;
   assert.equal(cancelled.status,'ready');assert.deepEqual(cancelled.paragraphs,refineTask.paragraphs,'Cancelling preserves the previous digest and completed report');
   refineDelay=0;
   const automaticBefore=calls.length;
   const automatic=await request('/api/tasks',spaceA,keyA,'POST',{title:'Automatic evidence budget',text:Array.from({length:20},()=>refineText).join('\n\n')});
   const automaticId=(await automatic.json()).task.id;
   await until(async()=> (await(await request(`/api/tasks/${automaticId}`,spaceA)).json()).task.status==='ready');
   const automaticallyFixed=(await(await request(`/api/tasks/${automaticId}`,spaceA)).json()).task;
   assert(digestStats(automaticallyFixed).ratio<=.30);
   assert.equal(calls.slice(automaticBefore).filter(c=>c.body.messages.at(-1).content.includes('SENTENCES:')).length,1,'A new over-selected import is corrected automatically before opening');
   const scan=async folder=>{for(const entry of await readdir(folder,{withFileTypes:true})){const f=path.join(folder,entry.name);if(entry.isDirectory())await scan(f);else if(entry.name.endsWith('.json')){const s=await readFile(f,'utf8');for(const secret of [keyA,keyB,spaceA,spaceB,'sk-server-key-must-never-be-used'])assert.ok(!s.includes(secret),'Secrets must not persist');}}};await scan(path.join(dir,'data'));
   console.log(JSON.stringify({refinement:true,checks:['one selection-only call','30 percent maximum','concurrent manual edit preserved','translations unchanged','repeat is free of model calls','cancellation preserves report','browser isolation and balance preflight']}));
   console.log(JSON.stringify({ok:true,checks:['browser workspace isolation for list/read/source/update/delete','PDF style examples parsed and scoped','only request key used','V4 Flash selected','missing/invalid keys actionable','balance preflight blocks model call','402 does not retry','previous summary preserved','concurrent browser keys isolated','required sentence IDs','partial translation repairs only missing units with full context','failed translation preserves completed units and resumes without analysis','no keys or browser secrets saved']}));
 }
} finally {if(server){server.kill();await new Promise(r=>server.once('exit',r));}if(api)await new Promise(r=>api.close(r));await rm(dir,{recursive:true,force:true});}
