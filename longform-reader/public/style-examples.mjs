import {apiFetch, uploadLimitMB} from "./reading-space.mjs";
let examples = [], loaded = false, busy = false, message = '';
const mounts = new Set();
const escape = value => String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function request(url, options) {
  const response=await apiFetch(url,options), data=await response.json();
  if(!response.ok) throw new Error(data.error || '示范文档保存失败');
  return data;
}
function renderAll() {
  for(const mount of mounts) {
    if(!mount.isConnected) { mounts.delete(mount); continue; }
    mount.innerHTML=`<div class="examples-heading"><div><strong>风格示范</strong><span>${examples.length} / 5 份</span></div><label class="button example-upload ${busy || examples.length>=5?'disabled':''}">${busy?'正在读取…':'上传示范文档'}<input type="file" multiple accept=".pdf,.txt,.md,.markdown" aria-label="上传风格示范文档" ${busy || examples.length>=5?'disabled':''}></label></div>
      <p class="examples-note">上传你喜欢的成稿，摘要会参考它的语气、结构和表达。支持 PDF、TXT、Markdown，单次上传总计不超过 ${uploadLimitMB()} MB；只参考写法，不引用其中的事实。</p>
      <ul class="example-list">${examples.map(item=>`<li><span>${escape(item.name)}</span><button type="button" class="back-link" data-remove-example="${item.id}" aria-label="移除 ${escape(item.name)}" ${busy?'disabled':''}>移除</button></li>`).join('')}</ul>
      <p class="examples-status" role="status">${escape(message || (examples.length ? '已保存，之后生成摘要时会使用；示范片段会随摘要一起发送给模型。' : '可选，未上传时使用你选择的摘要风格。'))}</p>`;
    mount.querySelector('input').onchange=async event=>{
      const files=[...event.target.files]; if(!files.length)return;
      if(files.length+examples.length>5){message='最多保存 5 份，请先移除一些文档。';renderAll();return;}
      if(files.some(f=>f.size>25*1024*1024)){message='每份示范文档不能超过 25 MB。';renderAll();return;}
      const form=new FormData();files.forEach(file=>form.append('files',file));
      await mutate(()=>request('/api/style-examples',{method:'POST',body:form}));
    };
    mount.querySelectorAll('[data-remove-example]').forEach(button=>button.onclick=()=>mutate(()=>request(`/api/style-examples/${button.dataset.removeExample}`,{method:'DELETE'})));
  }
}
async function mutate(run) {
  if(busy)return;busy=true;message='正在读取并保存示范文档…';renderAll();
  try {examples=(await run()).examples;loaded=true;message='';}
  catch(error){message=error.message;}
  finally{busy=false;renderAll();}
}
export function examplesPending(){return busy;}
export function mountStyleExamples(container) {
  mounts.add(container);renderAll();
  if(!loaded)request('/api/style-examples').then(data=>{examples=data.examples;loaded=true;renderAll();}).catch(error=>{message=error.message;renderAll();});
}
