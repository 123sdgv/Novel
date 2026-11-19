const frame = document.querySelector('iframe'), report = document.querySelector('#report');
const tick = ms => new Promise(resolve=>setTimeout(resolve,ms));
const w = () => frame.contentWindow, d = () => frame.contentDocument;
const el = sel => d().querySelector(sel);
const ok = (value, message) => { if (!value) throw new Error(message); };
const log = text => {report.textContent += text+'\n';};
async function wait(check, label) {
  const end=Date.now()+7000;
  while(Date.now()<end) { if (check()) return; await tick(20); }
  throw new Error('等待失败：'+label+'。'+(el('#notice')?.textContent || ''));
}
async function action(selector) {
  await wait(()=>el(selector) && !el(selector).disabled,selector);
  el(selector).click(); await tick(100);
}
const click = name => action('[data-action="'+name+'"]');
function fill(selector, value) {
  const field=el(selector);
  if (!field) throw new Error('字段缺失：'+selector);
  field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));
}
async function inlineName(value) {
  const field=el('.name-form input');
  ok(field && !el('#modal[open]'),'名称须在原行编辑');
  equal(el('.name-form').innerText.trim(),'保存');
  fill('.name-form input',value);await action('.name-form [type="submit"]');
}
async function dialogText(value) {
  await wait(()=>el('dialog[open] [name=value]'),'编辑弹窗');
  fill('dialog [name=value]',value);await action('dialog form .primary');
}
const prose = () => [...d().querySelectorAll('[data-node] .prose')].map(n=>n.textContent);
const equal = (actual,expected) => ok(JSON.stringify(actual)===JSON.stringify(expected),'期望 '+JSON.stringify(expected)+'，收到 '+JSON.stringify(actual));
async function main() {
  ok(['localhost','127.0.0.1','[::1]'].includes(location.hostname),'请在 localhost 上运行。');
  frame.src='../';await wait(()=>el('[data-action="new-story"]'),'总览');
  ok(!el('.book-row'),'请使用空白测试书架；未更改已有数据。');
  const calls=[],replies=[];
  let grabbed=null;
  const fixtureKey='fixture-browser-only';
  function installMock() {
    const original=w().fetch.bind(w());
    w().fetch=async(address,options)=>{
      if (!String(address).startsWith('https://novel-test.invalid/')) return original(address,options);
      if (String(address).endsWith('/models')) return Response.json({data:[{id:'test-model'}]});
      const body=JSON.parse(options.body);calls.push(body);
      if (!body.stream) return Response.json({choices:[{message:{content:'OK'}}]});
      const next=replies.shift();if (!next) throw new Error('没有预设测试回复');
      const stream=new ReadableStream({start(ctrl){
        const encoder=new TextEncoder();
        const chunk=s=>ctrl.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content:s}}]})+'\r\n\r\n'));
        let timer=setTimeout(()=>{
          chunk(next.text);
          if (!next.pause) {ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));ctrl.close();}
        },next.delay || 10);
        options.signal.addEventListener('abort',()=>{clearTimeout(timer);ctrl.error(options.signal.reason);},{once:true});
      }});
      return new Response(stream,{headers:{'content-type':'text/event-stream'}});
    };
    w().HTMLAnchorElement.prototype.click=async function(){
      if (this.download) grabbed=await (await original(this.href)).json();
    };
    el('#import-file').click=()=>{};
  }
  function mobile() {ok(d().documentElement.scrollWidth<=frame.clientWidth,'出现横向溢出');}
  async function send(text,reply) {
    replies.push({text:reply});fill('#draft',text);await click('send');
    await wait(()=>prose().at(-1)===reply,'回复保存');
  }
  async function reload() {
    const old=d();w().location.reload();
    await wait(()=>d()!==old && el('#draft'),'刷新恢复');installMock();
  }
  async function importFile(data,actionName) {
    await click(actionName);
    const dt=new (w().DataTransfer)();
    dt.items.add(new (w().File)([JSON.stringify(data)],'backup.json',{type:'application/json'}));
    const field=el('#import-file');field.files=dt.files;field.dispatchEvent(new Event('change',{bubbles:true}));
    await tick(120);
  }
  function swipe(dx,dy=0) {
    const face = el('.book-open');
    const start = { x:210, y:face.getBoundingClientRect().top + 20 };
    for (const [type,multiplier] of [['pointerdown',0],['pointermove',0.5],['pointermove',1],['pointerup',1]]) {
      face.dispatchEvent(new (w().PointerEvent)(type,{
        bubbles:true,isPrimary:true,pointerType:'touch',pointerId:2,button:0,
        clientX:start.x+dx*multiplier,clientY:start.y+dy*multiplier
      }));
    }
    face.dispatchEvent(new (w().MouseEvent)('click',{bubbles:true,cancelable:true,detail:1}));
  }
  async function openDrawer() {
    await click('backup-panel'); await wait(()=>el('#side-drawer[open]'),'侧栏打开');
  }
  installMock();mobile();
  equal(el('#app').innerText.trim(),'');
  equal(el('#nav h1').textContent,'Novel');
  await openDrawer();ok(el('[data-action="export-all"]').disabled,'空书架不应可导出');
  await click('close-drawer');
  await click('new-story');fill('.name-form input','取消的书稿');await click('cancel-name');
  equal(el('#app').innerText.trim(),'');
  await click('new-story');await inlineName('验收书稿');await wait(()=>el('#draft'),'聊天');
  equal(el('.reading').innerText.trim(),'');
  ok(!el('[data-action="home"]') && !el('.session-button'),'聊天页不应显示主页入口或旧下拉框');
  ok(el('[data-action="settings"] svg') && !el('#nav').innerText.includes('设置'),'设置应使用图标');
  ok(el('[data-action="summary"]').getBoundingClientRect().right<=el('[data-action="send"]').getBoundingClientRect().left,'总结应在发送左边');
  await click('settings');await click('home');
  equal(el('.book-row').innerText.trim(),'验收书稿');
  const originalLeft=el('.book-open').getBoundingClientRect().left;
  swipe(-120,4);
  await wait(()=>el('.book-row.revealed'),'左滑只展开');
  ok(!el('dialog[open]') && !el('#draft'),'滑动触发了操作');
  await wait(()=>{
    const face=el('.book-open').getBoundingClientRect(), editBox=el('.rename').getBoundingClientRect();
    return Math.abs(face.left-originalLeft)<1 && Math.abs(face.right-editBox.left)<1;
  },'展开后保留书名并露出操作');
  ok(el('.rename').textContent.trim()==='' && el('.delete').textContent.trim()==='','色块包含文字');
  await click('rename-story');equal(el('.name-form input').value,'验收书稿');
  await inlineName('验收书稿 · 修订');
  equal(el('.book-open').textContent,'验收书稿 · 修订');
  swipe(-120);await click('delete-story');await action('[data-return="cancel"]');
  equal(d().querySelectorAll('.book-row').length,1);
  swipe(-120);swipe(85);ok(!el('.book-row.revealed'),'右滑未收起');
  swipe(-9,65);ok(!el('.book-row.revealed') && !el('#draft'),'纵向滚动触发了操作');
  await click('open');await click('settings');await click('world');
  ok(!el('#world-text') && el('.note-text').textContent==='','空白世界观应当只读');
  await click('edit-world');ok(d().activeElement===el('#world-text'),'编辑器未聚焦');
  fill('#world-text','港口起雾');await click('save-world');
  ok(el('#api-form') && !el('dialog[open]'),'点勾应保存并返回设置');
  await click('world');equal(el('.note-text').textContent,'港口起雾');await click('back-world');
  for (const width of [320,390]) {
    frame.style.width=width+'px';await tick(40);
    const box=el('#api-form .paired-actions').getBoundingClientRect();
    const save=el('#api-form .primary').getBoundingClientRect(),test=el('[data-action="test"]').getBoundingClientRect();
    ok(save.top===test.top && Math.abs(save.width-test.width)<1 && Math.abs(box.right-test.right)<1,'API 操作未横向均分');mobile();
  }
  log('通过：精简书架、侧栏、左滑与点按分离、返回收起、笔记阅读与编辑、320/390px 等宽按钮');
  fill('#api-url','https://novel-test.invalid/v1');fill('#api-key',fixtureKey);
  fill('#api-model','手填模型');await click('test');ok(el('#api-status').textContent.includes('连接成功'),'短测试失败');
  await click('models');await action('[data-return="0"]');await wait(()=>el('#api-model').value==='test-model','选中模型');equal(el('#api-model').value,'test-model');
  await action('#api-form .primary');await click('back-chat');mobile();
  log('通过：手机总览、创建故事、世界观、手填模型、短测试与拉取模型');
  await send('A','A1');await send('A 后续','A2');
  replies.push({text:'B1'});await action('[data-node] [data-action="edit"]');await dialogText('B');
  await wait(()=>prose().at(-1)==='B1','编辑后回复');
  const history=()=>calls.at(-1).messages.slice(2).map(m=>m.content);
  equal(history(),['B']);equal(prose(),['B','B1']);
  replies.push({text:'B2'});await click('regenerate');await wait(()=>prose().at(-1)==='B2','重新生成');
  equal(history(),['B']);
  await action('[data-node]:first-child [aria-label="上一版本"]');equal(prose(),['A','A1','A 后续','A2']);
  await action('[data-node]:first-child [aria-label="下一版本"]');equal(prose(),['B','B2']);
  await action('[data-node]:last-of-type [data-action="edit"]');await dialogText('B2 编辑');
  equal(prose(),['B','B2 编辑']);
  await reload();equal(prose(),['B','B2 编辑']);
  log('通过：实际请求体隔离、回复重生、分支切换、编辑 AI、刷新恢复');
  replies.push({text:'已收到的半段',delay:1300,pause:true});fill('#draft','下一段');await click('send');
  await wait(()=>el('#generation-status')?.textContent.includes('1s'),'首字前计时');
  await wait(()=>el('#stream .prose')?.textContent==='已收到的半段','流式正文');
  ok(!el('#generation-status').textContent.includes('1s'),'首字后仍在计时');await click('stop');await reload();
  equal(prose().at(-1),'已收到的半段');
  const long='雾里传来汽笛。'.repeat(800);await send('写长文',long);equal(prose().at(-1).length,long.length);mobile();
  log('通过：等待计时、流式停止、刷新保留半段、长文手机排版');
  replies.push({text:'港口的前情'});await click('summary');await wait(()=>el('dialog[open] [name=value]'),'章节总结');
  ok(!history().includes('A1') && history().includes('B2 编辑'),'总结分支错误');
  await dialogText('修改过的前情');await send('开第二章','新章');
  equal(history(),['前情总结（本对话的起始背景）\n修改过的前情','开第二章']);
  await click('chats');
  const panel=el('#side-drawer');
  const rows=()=>panel.querySelectorAll('.book-open');
  const rowClick=async(index,act)=>{
    const button=rows()[index].closest('.book-row').querySelector('[data-action="'+act+'"]');
    button.click();await tick(100);
  };
  await wait(()=>panel.open && Math.abs(panel.getBoundingClientRect().left)<1,'左侧展开');
  equal(panel.querySelector('.drawer-head').innerText.trim(),'');
  equal(rows().length,2);
  equal(rows()[1].getAttribute('aria-current'),'true');
  const holdFace=rows()[0];
  const point=type=>holdFace.dispatchEvent(new (w().PointerEvent)(type,{bubbles:true,isPrimary:true,pointerId:4,pointerType:'touch',button:0,clientX:130,clientY:80}));
  point('pointerdown');await wait(()=>holdFace.closest('.revealed'),'长按显示操作');point('pointerup');
  holdFace.dispatchEvent(new (w().MouseEvent)('click',{bubbles:true,detail:1,cancelable:true}));
  ok(panel.open && !el('#modal[open]') && rows()[1].hasAttribute('aria-current'),'松手不应切换或编辑');
  await rowClick(0,'rename-chat');equal(el('.name-form input').value,'对话 1');
  await inlineName('第一章');equal(rows()[0].textContent,'第一章');
  await click('new-chat');await inlineName('临时对话');ok(!panel.open,'新建后应进入对话');
  equal(prose(),[]);await click('chats');equal(rows().length,3);
  swipe(-120);await rowClick(0,'delete-chat');ok(el('#modal[open] .icon-button svg'),'关闭须为 SVG');
  await action('#modal [data-return="cancel"]');equal(rows().length,3);
  rows()[2].dispatchEvent(new (w().KeyboardEvent)('keydown',{key:'ArrowLeft',bubbles:true}));
  await rowClick(2,'delete-chat');await action('#modal [data-return="yes"]');equal(rows().length,2);
  await rowClick(0,'use-chat');equal(prose().at(-1),long);
  log('通过：左侧对话栏、长按和左滑、原行改名、新建与删除、SVG 关闭、总结与发送顺序');
  log('通过：总结只取当前分支、带入新会话、原对话完整保留');
  await click('settings');await click('export-one');await wait(()=>grabbed,'单故事文件');
  const one=grabbed;ok(!JSON.stringify(one).includes(fixtureKey),'备份含有密钥');equal(one.stories[0].chats.length,2);
  await importFile(one,'import-one');await wait(()=>el('#draft'),'单故事恢复');equal(prose().at(-1),long);
  await click('settings');equal(el('#api-key').value,'');await click('home');equal(d().querySelectorAll('.book-row').length,2);
  grabbed=null;await openDrawer();await click('export-all');await wait(()=>grabbed,'全局文件');equal(grabbed.stories.length,2);
  await openDrawer();await importFile(grabbed,'import-all');equal(d().querySelectorAll('.book-row').length,4);
  await openDrawer();await importFile({schemaVersion:99},'import-all');equal(d().querySelectorAll('.book-row').length,4);
  log('通过：单故事和全局文件导出与恢复、密钥排除、错误导入保留现存数据');
  await click('open');await wait(()=>el('[data-node]'),'打开恢复的分支');await action('[data-node] [data-action="remove"]');await action('[data-return="cancel"]');equal(prose().at(-1),long);
  await action('[data-node] [data-action="remove"]');await action('[data-return="yes"]');
  equal(prose(),['A','A1','A 后续','A2']);
  log('通过：删除前确认，删除子树后恢复另一个版本');
  await click('settings');await click('home');swipe(-110);await click('delete-story');await action('[data-return="yes"]');
  equal(d().querySelectorAll('.book-row').length,3);
  log('通过：点红色区域并确认后才删除故事');
  const worker=await w().navigator.serviceWorker.ready;
  ok(worker.scope===new URL('../',location.href).href,'子路径 scope 错误');
  const keys=await w().caches.keys(), cache=await w().caches.open(keys.find(s=>s.startsWith('novel-chat:'+worker.scope+':')));
  const assets=await cache.keys();ok(assets.some(r=>r.url.endsWith('/icons/book-512.png')),'离线图标缺失');
  ok(!assets.some(r=>r.url.includes('novel-test.invalid')||r.url.includes('/models')),'缓存出现 API 请求');
  ok(!!await cache.match(new URL('../',location.href).href),'离线入口缺失');
  log('通过：Pages 子路径、Service Worker、离线资源白名单');
  log('全部浏览器验收通过');
}
document.querySelector('#run').onclick=async event=>{
  event.target.disabled=true;report.textContent='';
  try { await main(); } catch(e) { log('失败：'+e.message); }
};

