import { newChat, newStory, activeChat, path, append, select, removeBranch, messages } from './story.js';
import { openDB, allStories, addStories, changeStory, readApi } from './db.js';
import { pack, unpack } from './backup.js';
import { endpoint, getModels, completion } from './api.js';
import { esc, button, toolbar, overview, backupPanel, chatView, settings, worldView } from './view.js';

import { enableStorySwipes } from './swipe.js';

const $ = s => document.querySelector(s);
const app = $('#app'), nav = $('#nav'), modal = $('#modal');
const drawer = $('#backup-drawer');
const catalog = new Map();
const blankApi = { url:'', key:'', model:'' };
let db, page = 'home', sid = '', routeHash = '', api = blankApi;
let operation = false, generation = null, serial = Promise.resolve(), draftTimer, noticeTimer, fileScope;
let apiOriginal = '', editingWorld = false;
const story = () => catalog.get(sid);
const chat = () => activeChat(story());
function notify(message) {
  const box = $('#notice');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { box.hidden = true; }, 6500);
}
function queue(work) {
  const next = serial.then(work);
  serial = next.catch(() => {});
  return next;
}
function update(id, edit, config) {
  return queue(async () => {
    const before = catalog.get(id), next = structuredClone(before);
    edit(next);
    await changeStory(db, before, next, config);
    catalog.set(id, next);
    return next;
  });
}
const updateCurrent = (edit, config) => update(sid, edit, config);
function stashKey(id, cid) { return 'novel-draft:' + location.pathname + ':' + id + '/' + cid; }
function stash(id, cid, value) {
  try {
    if (value == null) sessionStorage.removeItem(stashKey(id, cid));
    else sessionStorage.setItem(stashKey(id, cid), value);
  } catch { /* IndexedDB remains the primary store. */ }
}
async function flushDraft() {
  clearTimeout(draftTimer);
  const field = $('#draft');
  if (!field || !story()) return;
  const id = sid, cid = chat().id, value = field.value;
  await queue(async () => {
    const before = catalog.get(id);
    const old = before?.chats.find(c => c.id === cid);
    if (!old) return;
    if (old.draft !== value) {
      const next = structuredClone(before);
      next.chats.find(c => c.id === cid).draft = value;
      await changeStory(db, before, next);
      catalog.set(id, next);
    }
    if ($('#draft')?.value === value) stash(id, cid, null);
  });
}
function showDialog(title, body, options = {}) {
  const wrapper = $('#modal-body');
  wrapper.innerHTML = `<div class="dialog-head"><h2 id="modal-title">${esc(title)}</h2>
    <button type="button" data-return="cancel" aria-label="关闭弹窗">关闭</button></div>${body}`;
  return new Promise(resolve => {
    function close(value) {
      modal.close();
      wrapper.onclick = wrapper.onsubmit = modal.oncancel = null;
      resolve(value);
    }
    modal.oncancel = event => { event.preventDefault(); close(null); };
    wrapper.onclick = event => {
      const target = event.target.closest('[data-return]');
      if (target) close(target.dataset.return === 'cancel' ? null : target.dataset.return);
    };
    wrapper.onsubmit = event => {
      event.preventDefault();
      const field = wrapper.querySelector('[name=value]');
      const value = field?.value.trim();
      if (field && !value) { field.focus(); return; }
      close(value ?? 'ok');
    };
    modal.showModal();
    if (options.focus) wrapper.querySelector(options.focus)?.focus();
  });
}
function askText(title, label, current, submit, long = false) {
  const field = long ? `<textarea class="edit-long" name="value" rows="8" required>${esc(current)}</textarea>`
    : `<input name="value" value="${esc(current)}" maxlength="160" required autocomplete="off">`;
  return showDialog(title, `<form><label>${esc(label)}${field}</label><div class="actions"><button class="primary">${esc(submit)}</button></div></form>`, { focus:'[name=value]' });
}
const choice = (value, label, style = 'outline') => `<button type="button" class="${style}" data-return="${esc(value)}">${esc(label)}</button>`;
async function confirmAction(title, message, label) {
  return (await showDialog(title,`<p>${esc(message)}</p><div class="actions">${choice('yes',label,'primary')}${choice('cancel','取消')}</div>`)) === 'yes';
}
function readForm() {
  return { url:$('#api-url').value.trim(), key:$('#api-key').value.trim(), model:$('#api-model').value.trim() };
}
function hasChanges() {
  return (page === 'settings' && $('#api-form') && JSON.stringify(readForm()) !== apiOriginal);
}
function draw({ bottom = false } = {}) {
  const previousScroll = $('#thread')?.scrollTop || 0;
  document.body.dataset.page = page;
  document.body.classList.toggle('chat-page', page === 'chat');
  nav.innerHTML = toolbar(page,story(),editingWorld);
  document.title = (page === 'home' ? '故事总览' : story().title) + ' · Novel Chat';
  if (page === 'home') app.innerHTML = overview([...catalog.values()]);
  if (page === 'settings') {
    app.innerHTML = settings(api);
    apiOriginal = JSON.stringify(readForm());
  }
  if (page === 'world') {
    app.innerHTML = worldView(story(),editingWorld);
    if (editingWorld) {
      const field = $('#world-text');
      field.value = story().world;
      field.focus();
      field.setSelectionRange(field.value.length,field.value.length);
    }
  }
  if (page === 'chat') {
    app.innerHTML = chatView(story());
    try {
      const value = sessionStorage.getItem(stashKey(sid,chat().id));
      if (value !== null) $('#draft').value = value;
    } catch { /* Private browsing may restrict session storage. */ }
    const thread = $('#thread');
    thread.scrollTop = bottom ? thread.scrollHeight : previousScroll;
  }
}
function hashFor(target, id) { return target === 'home' ? '' : '#/' + id + '/' + target; }
async function go(target, id = sid, { saved = false, fromHistory = false } = {}) {
  if (generation) { notify('请先停止生成，再离开当前对话。'); return false; }
  if (!saved && hasChanges() && !await confirmAction('离开编辑页？','本次修改尚未保存。','放弃修改')) return false;
  if (page === 'world' && editingWorld) {
    const value = $('#world-text').value;
    if (value !== story().world) await updateCurrent(s => { s.world = value; });
  }
  if (drawer.open) drawer.close();
  await flushDraft();
  if (target === 'home') {
    const latest = await allStories(db);
    catalog.clear();
    for (const item of latest) catalog.set(item.id,item);
  }
  const config = target === 'home' ? blankApi : await readApi(db, id) || blankApi;
  const previousHash = routeHash;
  const returningFromNote = page === 'world' && history.state?.worldFrom === hashFor(target,id);
  editingWorld = false;
  page = target; sid = target === 'home' ? '' : id; api = config;
  routeHash = hashFor(page,sid);
  if (!fromHistory && location.hash !== routeHash) {
    if (returningFromNote) history.back();
    else history.pushState(page === 'world' ? {worldFrom:previousHash} : null,'',location.pathname + location.search + routeHash);
  }
  draw({ bottom:true }); window.scrollTo(0,0);
  return true;
}
async function route() {
  const [,id,target] = location.hash.split('/');
  const valid = catalog.has(id) && ['chat','settings','world'].includes(target);
  if (location.hash && !valid) history.replaceState(null,'',location.pathname);
  if (!await go(valid?target:'home', id, {fromHistory:true})) history.replaceState(null,'',location.pathname + routeHash);
}
function download(data, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a = document.createElement('a');
  a.href=url; a.download=filename.replace(/[\\/:*?"<>|]/g,'-');
  document.body.append(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function newStoryDialog() {
  const title = await askText('新建故事','故事名称','','创建故事');
  if (!title) return;
  const s = newStory(title);
  await addStories(db,[s]); catalog.set(s.id,s);
  await go('chat',s.id);
}
async function editStory(action, id) {
  const s = catalog.get(id);
  if (action === 'rename-story') {
    const title = await askText('编辑故事','故事名称',s.title,'保存');
    if (title && title !== s.title) await update(id,next => { next.title=title; });
  } else if (await confirmAction('删除「'+s.title+'」？','世界观和全部对话将一起删除。','删除')) {
    await changeStory(db,s,null);
    catalog.delete(id);
  }
  draw();
}
async function sessions() {
  await flushDraft();
  const rows = story().chats.map(c=>`<div class="session-row">
    ${choice('use:'+c.id,c.name,c.id===chat().id?'chosen':'')}${choice('rename:'+c.id,'改名','quiet')}${choice('delete:'+c.id,'删除','quiet')}</div>`).join('');
  const selected = await showDialog('故事对话',`<div class="dialog-list">${rows}</div><div class="actions">${choice('new','新建对话','primary')}</div>`);
  if (!selected) return;
  const [action,id] = selected.split(':');
  if (action === 'new' || action === 'rename') {
    const target = story().chats.find(c=>c.id===id);
    const name = await askText(action==='new'?'新建对话':'重命名对话','对话名称',target?.name || '对话 '+(story().chats.length+1),'保存');
    if (!name) return;
    await updateCurrent(s=>{
      if (target) s.chats.find(c=>c.id===id).name=name;
      else { const c=newChat(name); s.chats.push(c); s.active=c.id; }
    });
  } else if (action === 'use') await updateCurrent(s=>{ s.active=id; });
  else if (action === 'delete') {
    if (!await confirmAction('删除对话？','将删除此对话的全部消息与版本。故事世界观会保留。','删除对话')) return;
    await updateCurrent(s=>{
      s.chats=s.chats.filter(c=>c.id!==id);
      if (!s.chats.length) s.chats.push(newChat());
      if (s.active===id) s.active=s.chats[0].id;
    });
    stash(sid,id,null);
  }
  draw({bottom:true});
}
function verified(config, withModel = true) {
  endpoint(config.url,'models');
  if (!config.key) throw new Error('请填写 API Key。');
  if (withModel && !config.model) throw new Error('请填写模型 ID。');
  return config;
}
async function apiAction(action) {
  const status = $('#api-status'), started = performance.now();
  try {
    const config = verified(readForm(),action!=='models');
    if (action==='save-api') {
      await updateCurrent(()=>{},config); api=config; apiOriginal=JSON.stringify(config);
      status.textContent='API 配置已保存。'; return;
    }
    status.textContent=action==='models'?'正在拉取模型…':'正在测试连接…';
    if (action==='models') {
      const ids = await getModels(config);
      const model = await showDialog('选择模型','<div class="dialog-list">'+ids.map((id,i)=>choice(String(i),id,'')).join('')+'</div>');
      if (model!==null) $('#api-model').value=ids[Number(model)];
      status.textContent='已获取 '+ids.length+' 个模型。';
    } else {
      await completion(config,[{role:'user',content:'回复 OK'}],{mode:'test'});
      status.textContent='连接成功 · 用时 '+((performance.now()-started)/1000).toFixed(1)+' 秒';
    }
  } catch (e) { status.textContent=e.message + (action==='test'?'（用时 '+((performance.now()-started)/1000).toFixed(1)+' 秒）':''); }
}
async function requireApi() {
  try { verified(api); return true; }
  catch {
    if (await confirmAction('配置 API 后开始写作','填写兼容接口的 URL、API Key 和模型 ID，即可生成正文。','前往设置')) await go('settings');
    return false;
  }
}
async function generate(parent, summary = false) {
  const snapshot = story(), cid = chat().id, id = sid;
  const history = messages(snapshot,chat(),summary?{summary:true}:{through:parent});
  const controller = new AbortController();
  generation = controller;
  const started = performance.now();
  const status = $('#generation-status'), thread = $('#thread'), container = $('#stream');
  if (!summary) {
    let afterParent = false;
    for (const element of thread.querySelectorAll('[data-node]')) {
      if (afterParent) element.hidden = true;
      if (element.dataset.node === parent) afterParent = true;
    }
  }
  const textNode = document.createTextNode('');
  container.innerHTML = '<article class="message author-ai"><div class="byline"><img alt="" src="./icons/book.svg"><b>'+(summary?'章节总结':'Novel Chat')+'</b></div><div class="prose"></div></article>';
  container.querySelector('.prose').append(textNode);
  let output='', nodeId=null, checkpoint=0, savedLength=0, persistenceFailed=false;
  const stopClock = () => { status.firstChild.textContent=summary?'正在整理总结':'正在生成'; };
  status.innerHTML='<span></span>'+button('stop','停止生成');
  const tick = () => { status.firstChild.textContent='等待正文 · '+Math.floor((performance.now()-started)/1000)+'s'; };
  tick(); const clock=setInterval(tick,250);
  $('#draft').readOnly=true;
  document.querySelectorAll('#composer button,.msg-actions button,.version button,.chat-heading button,header button').forEach(b=>{b.disabled=true;});
  thread.scrollTop=thread.scrollHeight;
  async function persist() {
    if (summary || savedLength===output.length || persistenceFailed) return;
    const text=output;
    try {
      await update(id,s=>{
        const c=s.chats.find(c=>c.id===cid);
        if (!nodeId) nodeId=append(c,parent,'assistant',text).id;
        else c.nodes.find(n=>n.id===nodeId).text=text;
      });
      savedLength=text.length;
      checkpoint=performance.now();
    } catch(e) { persistenceFailed=true; throw e; }
  }
  let message='';
  try {
    const finish=await completion(api,history,{mode:summary?'summary':'write',signal:controller.signal,onText:async value=>{
      const stick=thread.scrollHeight-thread.clientHeight-thread.scrollTop<100;
      if (!output) { clearInterval(clock); stopClock(); }
      output+=value; textNode.appendData(value);
      if (stick) thread.scrollTop=thread.scrollHeight;
      if (!summary && (!nodeId || performance.now()-checkpoint>750)) await persist();
    }});
    if (finish==='length') message='已达到服务商的输出上限，可发送“继续写”。';
  } catch(e) { message=controller.signal.aborted?'已停止生成。':e.message; }
  finally {
    clearInterval(clock);
    try { await persist(); } catch(e) { message=e.message; }
    generation=null;
    draw({bottom:true});
  }
  if (message) notify(message);
  if (persistenceFailed && output) {
    await askText('保存失败，请先复制这段正文','未保存的正文',output,'关闭',true);
    return;
  }
  if (summary && output.trim()) {
    const seed=await askText('章节总结','总结内容',output,'新建对话并带入总结',true);
    if (seed) {
      await updateCurrent(s=>{ const c=newChat('对话 '+(s.chats.length+1),seed); s.chats.push(c); s.active=c.id; });
      draw({bottom:true});
    }
  }
}
async function send() {
  const field=$('#draft'), value=field.value.trim();
  if (!value) { field.focus(); return; }
  if (path(chat()).at(-1)?.role==='user') { notify('上一条要求还没有回复。可点「生成回复」，或编辑该条要求。'); return; }
  if (!await requireApi()) return;
  await flushDraft();
  let id;
  await updateCurrent(s=>{
    const c=activeChat(s); id=append(c,path(c).at(-1)?.id??null,'user',value).id;
    c.draft='';
  });
  stash(sid,chat().id,null);
  draw({bottom:true});
  await generate(id);
}
async function editMessage(node) {
  const value=await askText('编辑消息','新版本',node.text,'保存新版本',true);
  if (!value || value===node.text) return;
  let id;
  await updateCurrent(s=>{ id=append(activeChat(s),node.parent,node.role,value).id; });
  draw({bottom:true});
  if (node.role==='user' && await requireApi()) await generate(id);
}
async function dispatch(action,id) {
  if (action==='home') return go('home');
  if (action==='open') return go('chat',id);
  if (action==='settings' || action==='back-chat') return go(action==='settings'?'settings':'chat');
  if (action==='world') return go('world');
  if (action==='edit-world') { editingWorld=true; draw(); return; }
  if (action==='back-world' || action==='save-world') return go('settings');
  if (action==='new-story') return newStoryDialog();
  if (action==='rename-story' || action==='delete-story') return editStory(action,id);
  if (action==='backup-panel') {
    drawer.innerHTML=backupPanel(!catalog.size);
    drawer.showModal();
    return;
  }
  if (action==='close-backup') { drawer.close(); return; }
  if (action==='chats') return sessions();
  if (['models','test','save-api'].includes(action)) return apiAction(action);
  if (action.startsWith('export-')) {
    if (drawer.open) drawer.close();
    await flushDraft();
    const single=action==='export-one';
    download(pack(single?[story()]:await allStories(db),single?'story':'all'),(single?story().title:'Novel-Chat-全部故事')+'.json'); return;
  }
  if (action.startsWith('import-')) {
    if (drawer.open) drawer.close();
    fileScope=action==='import-one'?'story':'all';
    $('#import-file').value=''; $('#import-file').click(); return;
  }
  if (action==='send') return send();
  await flushDraft();
  if (action==='summary') {
    if (path(chat()).length && await requireApi()) await generate(null,true);
    return;
  }
  if (action==='version') {
    await updateCurrent(s=>select(activeChat(s),id)); draw(); return;
  }
  const n=path(chat()).find(node=>node.id===id);
  if (!n) return;
  if (action==='copy') { await navigator.clipboard.writeText(n.text); notify('已复制。'); }
  if (action==='edit') await editMessage(n);
  if (action==='remove' && await confirmAction('删除这个版本？','此版本及它下面的所有后续消息和分支都将删除。其他同级版本会保留。','删除此分支')) {
    await updateCurrent(s=>removeBranch(activeChat(s),id)); draw();
  }
  if ((action==='regenerate' || action==='reply') && await requireApi()) await generate(n.role==='user'?n.id:n.parent);
}
async function run(work) {
  if (operation) return;
  operation=true;
  try { await work(); } catch(e) { notify(e.message || '操作失败，请重试。'); }
  finally { operation=false; }
}
enableStorySwipes(app);
drawer.addEventListener('click',event=>{
  if (event.target !== drawer) return;
  const rect = drawer.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right) drawer.close();
});
document.addEventListener('click',event=>{
  const target=event.target.closest('[data-action]');
  if (!target || !db) return;
  event.preventDefault();
  if (target.dataset.action==='stop') { generation?.abort(); return; }
  run(()=>dispatch(target.dataset.action,target.dataset.id));
});
document.addEventListener('submit',event=>{
  const action={composer:'send','api-form':'save-api'}[event.target.id];
  if (action) { event.preventDefault(); run(()=>dispatch(action)); }
});
document.addEventListener('keydown',event=>{
  if (event.target.id==='draft' && event.key==='Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
    event.preventDefault(); run(send);
  }
});
document.addEventListener('input',event=>{
  if (event.target.id!=='draft') return;
  stash(sid,chat().id,event.target.value);
  clearTimeout(draftTimer);
  draftTimer=setTimeout(()=>flushDraft().catch(e=>notify(e.message)),350);
});
$('#import-file').addEventListener('change',event=>run(async()=>{
  const file=event.target.files[0]; if (!file) return;
  let data; try { data=JSON.parse(await file.text()); } catch { throw new Error('无法读取 JSON，请选择 Novel Chat 备份。'); }
  const list=unpack(data,fileScope==='story');
  if (!list.length) { notify('备份中没有故事。'); return; }
  if (hasChanges() && !await confirmAction('离开编辑页？','导入后将打开新故事，本页还有未保存的修改。','继续导入')) return;
  await addStories(db,list);
  for (const s of list) catalog.set(s.id,s);
  if (fileScope==='story') await go('chat',list[0].id,{saved:true});
  else { await go('home'); }
  notify('已导入 '+list.length+' 个故事。');
}));
window.addEventListener('hashchange',()=>{
  if (!db || location.hash === routeHash) return;
  if (operation || modal.open) { history.replaceState(null,'',location.pathname+routeHash); return; }
  run(route);
});
document.addEventListener('visibilitychange',()=>{ if (document.hidden && !generation) flushDraft().catch(e=>notify(e.message)); });
async function start() {
  db=await openDB();
  for (const s of await allStories(db)) catalog.set(s.id,s);
  await route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>notify('离线资源未能缓存，下次联网打开时会重试。'));
}
start().catch(e=>{ app.innerHTML='<p class="loading">'+esc(e.message)+'</p>'; });

