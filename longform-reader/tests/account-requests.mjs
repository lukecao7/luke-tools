import assert from 'node:assert/strict';
const requests=[];
globalThis.location={href:'https://reading.example/',origin:'https://reading.example'};
globalThis.localStorage={getItem:key=>key.includes('deepseek')?'sk-synthetic-key-for-test':'a'.repeat(64)};
globalThis.window={addEventListener(){}};
globalThis.document={addEventListener(){},querySelector(){return null;}};
globalThis.fetch=async(url,options={})=>{requests.push({url:String(url),headers:new Headers(options.headers)});return new Response(JSON.stringify(String(url).includes('/balance')?{available:true,balances:[]}:{ok:true}),{headers:{'Content-Type':'application/json'}});};
const {configureDeepSeek,apiFetch}=await import('../public/deepseek-account.mjs');
configureDeepSeek({userOwnedKeys:true});
await apiFetch('/api/tasks/test/refine-highlights',{method:'POST'});
await apiFetch('/api/tasks/test/highlights',{method:'PATCH'});
await apiFetch('/api/tasks/test');
await apiFetch('https://elsewhere.example/api/tasks/test/refine-highlights',{method:'POST'});
for(const request of requests) {
  const model=request.url==='/api/tasks/test/refine-highlights' || request.url==='/api/deepseek/balance';
  assert.equal(request.headers.has('X-DeepSeek-Key'),model,'Only balance/model requests on this origin receive the key');
}
assert.equal(requests.find(r=>r.url==='/api/tasks/test/refine-highlights').headers.get('X-Reading-Space'),'a'.repeat(64));
console.log(JSON.stringify({ok:true,checks:['refinement receives existing bound key','ordinary reads and edits receive no key','cross-origin request receives no key']}));
