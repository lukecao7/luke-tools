import { closeDialogOnOutside } from './reader-controls.mjs';

const KEY='longform.deepseek.key.v1', SPACE='longform.reading.space.v1';
let configured=false, owned=false, uploadLimit=25, checking=false, lastCheck=0;
const readKey=()=>localStorage.getItem(KEY) || '';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function configureDeepSeek(health) {
  owned=Boolean(health.userOwnedKeys);uploadLimit=health.uploadLimitMB || 25;configured=true;
  if(owned && !/^[a-f0-9]{64}$/.test(localStorage.getItem(SPACE) || '')) {
    const bytes=crypto.getRandomValues(new Uint8Array(32));
    localStorage.setItem(SPACE,[...bytes].map(x=>x.toString(16).padStart(2,'0')).join(''));
  }
  if(owned && readKey())void checkBalance();
}
export const uploadLimitMB=()=>uploadLimit;
export function workspaceHeaders() { return owned ? {'X-Reading-Space':localStorage.getItem(SPACE)} : {}; }
export function accountButton() { return owned ? `<button type="button" class="button deepseek-settings" data-deepseek-settings>${readKey()?'DeepSeek 设置':'绑定 DeepSeek'}</button>` : ''; }
export function requireBoundKey() { if(!owned || readKey())return true;showBinding();return false; }
function needsModel(url,method) { return method==='POST' && (['/api/tasks','/api/explain'].includes(url) || /^\/api\/tasks\/[^/]+\/(summary|retry|upgrade|refine-highlights)$/.test(url)); }
export async function apiFetch(url,options={}) {
  const path=new URL(url,location.href);
  if(path.origin!==location.origin || !path.pathname.startsWith('/api/'))return fetch(url,options);
  const headers=new Headers(options.headers), method=(options.method || 'GET').toUpperCase();
  if(configured && owned) {
    for(const [key,value]of Object.entries(workspaceHeaders()))headers.set(key,value);
    if(path.pathname==='/api/deepseek/balance' || needsModel(path.pathname,method)) {
      const key=readKey();if(key)headers.set('X-DeepSeek-Key',key);
    }
  }
  const response=await fetch(url,{...options,headers});
  if(!response.ok) {
    const data=await response.clone().json().catch(()=>({}));reportAccountError(data);
  } else if(owned && needsModel(path.pathname,method))void checkBalance();
  return response;
}
export function reportAccountError(value) {
  const code=value?.code || value?.errorCode;
  if(!['DEEPSEEK_BALANCE_LOW','DEEPSEEK_KEY_INVALID','DEEPSEEK_KEY_REQUIRED'].includes(code))return;
  const empty=code==='DEEPSEEK_BALANCE_LOW';
  showNotice(empty?'DeepSeek 余额不足':'需要绑定 DeepSeek',empty?'已完成的内容已保留。充值后可以继续处理。':value.error || '请检查或绑定你的 API Key。',empty);
}
function showNotice(title,detail,topup=false) {
  let node=document.querySelector('#deepseek-notice');
  if(!node){node=document.createElement('aside');node.id='deepseek-notice';node.className='deepseek-notice';node.setAttribute('role','alert');document.body.append(node);}
  node.innerHTML=`<button class="notice-dismiss" aria-label="关闭额度提醒">×</button><strong>${escape(title)}</strong><p>${escape(detail)}</p><div>${topup?'<a class="button" href="https://platform.deepseek.com/top_up" target="_blank" rel="noopener noreferrer">前往充值</a>':''}<button class="button" type="button" data-deepseek-settings>${topup?'检查余额':'绑定 / 更换 Key'}</button></div>`;
  node.querySelector('.notice-dismiss').onclick=()=>node.remove();
}
function balanceText(data) { return data.balances.map(b=>`${b.currency==='CNY'?'¥':b.currency==='USD'?'$':escape(b.currency)}${escape(b.total)}`).join(' / '); }
async function queryBalance(key) {
  const response=await fetch('/api/deepseek/balance',{headers:{...workspaceHeaders(),'X-DeepSeek-Key':key}});
  const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error || '余额查询失败'),{code:data.code});return data;
}
async function checkBalance() {
  if(!owned || !readKey() || checking)return;checking=true;
  try {
    const data=await queryBalance(readKey());lastCheck=Date.now();
    if(!data.available)showNotice('DeepSeek 余额不足','请充值后继续，已有报告和摘要仍可阅读。',true);
    else {
      const low=data.balances.length && data.balances.every(b=>Number(b.total)<(b.currency==='CNY'?1:.15));
      if(low)showNotice('DeepSeek 余额较低',`当前余额 ${balanceText(data)}，长报告处理可能中断。`,true);
      else document.querySelector('#deepseek-notice')?.remove();
    }
    return data;
  } catch(error) {reportAccountError({code:error.code,error:error.message});}
  finally{checking=false;}
}
export function showBinding() {
  if(document.querySelector('.deepseek-dialog'))return;
  const existing=readKey(),dialog=document.createElement('dialog');dialog.className='summary-options deepseek-dialog';dialog.setAttribute('aria-label','绑定 DeepSeek API');
  dialog.innerHTML=`<form class="summary-options-content" autocomplete="off"><div class="dialog-heading"><div><span class="eyebrow">你的模型 · 你的额度</span><h2>${existing?'DeepSeek 设置':'绑定 DeepSeek API'}</h2></div><button type="button" class="close-x" aria-label="关闭 DeepSeek 设置">×</button></div>
    <p class="deepseek-model">默认使用 <strong>DeepSeek V4 Flash</strong><span>deepseek-v4-flash</span></p>
    <p class="summary-options-intro">分析、翻译、解释和生成摘要会使用你的 DeepSeek API 余额。验证 Key 和查询余额不会生成内容。</p>
    ${existing?`<p class="bound-key">已绑定 · 尾号 ${escape(existing.slice(-4))}</p>`:''}
    <label class="summary-emphasis" for="deepseek-api-key">DeepSeek API Key</label>
    <div class="key-input-row"><input class="title-input" id="deepseek-api-key" name="deepseek-api-key" type="password" autocomplete="new-password" autocapitalize="none" spellcheck="false" data-1p-ignore data-lpignore="true" aria-describedby="deepseek-key-help deepseek-binding-result" placeholder="${existing?'输入新的 Key 可更换绑定':'粘贴 sk- 开头的完整 API Key'}" ${existing?'':'required'}><button class="button key-visibility" type="button" aria-label="显示 API Key" aria-pressed="false">显示</button></div>
    <p class="key-help" id="deepseek-key-help">请使用 DeepSeek 平台创建的完整 Key（sk- 开头），不是本站访问密码。</p>
    <a class="account-link" href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer">在 DeepSeek 平台创建 API Key ↗</a>
    <div class="key-privacy"><strong>保存在当前浏览器</strong><p>Key 只保存在这台设备的此浏览器中。调用时经本站服务临时转发给 DeepSeek，不保存到服务器。请勿在公用电脑绑定。</p><p>尚无账号同步；换浏览器需要重新绑定。清除网站数据会失去本浏览器的阅读空间入口。</p></div>
    <p class="binding-result" id="deepseek-binding-result" role="status"></p><div class="dialog-actions">${existing?'<button type="button" class="button forget-key">解除绑定</button>':''}<button class="button primary" type="submit">${existing?'检查余额 / 更新':'验证并继续'}</button></div></form>`;
  document.body.append(dialog);closeDialogOnOutside(dialog,'.summary-options-content');dialog.querySelector('.close-x').onclick=()=>dialog.close();
  const keyInput=dialog.querySelector('#deepseek-api-key'),visibility=dialog.querySelector('.key-visibility');
  visibility.onclick=()=>{const show=keyInput.type==='password';keyInput.type=show?'text':'password';visibility.textContent=show?'隐藏':'显示';visibility.setAttribute('aria-label',show?'隐藏 API Key':'显示 API Key');visibility.setAttribute('aria-pressed',String(show));};
  keyInput.addEventListener('input',()=>{keyInput.removeAttribute('aria-invalid');const result=dialog.querySelector('.binding-result');result.textContent='';result.removeAttribute('data-error');});
  dialog.querySelector('.forget-key')?.addEventListener('click',()=>{localStorage.removeItem(KEY);document.querySelector('#deepseek-notice')?.remove();dialog.close();updateButtons();});
  dialog.querySelector('form').onsubmit=async event=>{
    event.preventDefault();const input=keyInput,enteredKey=input.value.trim(),key=enteredKey || readKey(),result=dialog.querySelector('.binding-result'),button=dialog.querySelector('[type=submit]');
    if(!/^sk-[A-Za-z0-9_-]{12,240}$/.test(key)){input.setAttribute('aria-invalid','true');result.dataset.error='true';result.textContent=key.startsWith('sk-')?'Key 不完整或含有无效字符，请从 DeepSeek 平台复制完整 Key，不要复制带星号的隐藏版本。':'这里需要 sk- 开头的 DeepSeek API Key，不能填写本站访问密码。请通过上方链接创建并复制 Key。';return;}
    input.removeAttribute('aria-invalid');result.removeAttribute('data-error');button.disabled=true;result.textContent='正在验证并查询余额…';
    try {
      const data=await queryBalance(key);localStorage.setItem(KEY,key);input.value='';input.required=false;updateButtons();
      result.textContent=`绑定成功 · 当前余额 ${balanceText(data)}${data.available?'':' · 余额不足，请先充值'}`;
      if(!data.available)showNotice('DeepSeek 余额不足','Key 已保存，请充值后继续。',true);else document.querySelector('#deepseek-notice')?.remove();
      button.textContent='检查余额 / 更新';
      if(enteredKey || !existing)dialog.close();
    }catch(error){result.dataset.error='true';result.textContent=error.message;}
    finally{button.disabled=false;}
  };
  dialog.showModal();
}
function updateButtons(){document.querySelectorAll('.deepseek-settings').forEach(b=>b.textContent=readKey()?'DeepSeek 设置':'绑定 DeepSeek');}
document.addEventListener('click',event=>{if(event.target.closest('[data-deepseek-settings]'))showBinding();});
window.addEventListener('focus',()=>{if(Date.now()-lastCheck>60000)void checkBalance();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden && Date.now()-lastCheck>60000)void checkBalance();});
