import { activeChat, path } from './story.js';
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function button(action, label, style = '', id = '', attrs = '') {
  return `<button type="button" class="${style}" data-action="${action}" data-id="${esc(id)}" ${attrs}>${label}</button>`;
}
const paths = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  settings: '<path d="m9.4 4 .6-1.5h4l.6 1.5 1.6.9 1.7-.2 2 3.4-1 1.4v2l1 1.4-2 3.4-1.7-.2-1.6.9-.6 1.6h-4l-.6-1.6-1.6-.9-1.7.2-2-3.4 1-1.4v-2l-1-1.4 2-3.4 1.7.2z" transform="translate(0 1.5)"/><circle cx="12" cy="12" r="3"/>',
  back: '<path d="m14.5 5-7 7 7 7"/>',
  next: '<path d="m9 6 6 6-6 6"/>',
  menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  pencil: '<path d="m4 16-.7 4.7L8 20l11.7-11.7a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0ZM14.5 5.5l4 4"/>',
  trash: '<path d="M4 6.5h16M9 6V4h6v2M6 7l1 13h10l1-13M10 10v7m4-7v7"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  check: '<path d="m4.5 12 5.2 5.3 10-11"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  down: '<path d="m7 10 5 5 5-5"/>',
  send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  note: '<path d="M6 4h12v16H6zM9 9h6M9 13h6M9 17h3"/>'
};
export function glyph(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}
function iconButton(action, name, label, id = '', style = '') {
  return button(action,glyph(name),'icon-button '+style,id,`aria-label="${esc(label)}" title="${esc(label)}"`);
}
export function toolbar(page, story, editing = false) {
  let left, title, right;
  if (page === 'home') {
    left = iconButton('new-story','plus','新建故事');
    title = 'Novel';
    right = iconButton('backup-panel','settings','备份设置');
  } else if (page === 'world') {
    left = iconButton('back-world','back','返回');
    title = '';
    right = editing ? iconButton('save-world','check','完成') : iconButton('edit-world','circle','编辑世界观');
  } else if (page === 'settings') {
    left = iconButton('back-chat','back','返回对话');
    title = '';
    right = iconButton('home','menu','故事总览');
  } else {
    right = iconButton('settings','settings','故事设置');
    const name = activeChat(story).name;
    return '<span></span>' + `<button type="button" class="bar-title" data-action="chats" aria-label="切换对话：${esc(name)}"><span>${esc(name)}</span>${glyph('down')}</button>` + right;
  }
  return left + (title ? `<h1 class="bar-title">${esc(title)}</h1>` : '<span></span>') + right;
}
function nameRow(kind, id, name, current = false) {
  const isChat = kind === 'chat';
  const label = isChat ? '对话' : '故事';
  return `<li class="book-row" data-kind="${kind}" data-id="${esc(id)}">
    ${button(isChat?'use-chat':'open',esc(name),'book-open',id,current?'aria-current="true"':'')}
    <div class="row-actions">${iconButton('rename-'+kind,'pencil','编辑'+label,id,'rename')}
    ${iconButton('delete-'+kind,'trash','删除'+label,id,'delete')}</div></li>`;
}
export function overview(stories) {
  const rows = [...stories].sort((a,b) => b.updated.localeCompare(a.updated)).map(s => nameRow('story',s.id,s.title));
  return `<ul class="book-list" aria-label="故事列表">${rows.join('')}</ul>`;
}
export function sessionPanel(story) {
  const rows = story.chats.map(c => nameRow('chat',c.id,c.name,c.id===story.active));
  return `<div class="drawer-head">${iconButton('new-chat','plus','新建对话')}${iconButton('close-drawer','close','关闭对话栏')}</div>
    <ul class="book-list" aria-label="对话列表">${rows.join('')}</ul>`;
}
export function nameForm(kind,id,value) {
  return `<form class="name-form" data-kind="${kind}" data-id="${esc(id)}">
    <input name="name" aria-label="${kind==='chat'?'对话名称':'故事名称'}" value="${esc(value)}" maxlength="160" required autocomplete="off" enterkeyhint="done">
    </form>`;
}
export function backupPanel(empty) {
  return `<div class="drawer-head"><h2 id="backup-title">备份</h2>${iconButton('close-drawer','close','关闭')}</div>
  ${button('import-all','导入备份','drawer-action')}${button('export-all','导出','drawer-action','',empty?'disabled':'')}`;
}
const icon = '<img alt="" src="./icons/book.svg">';
export function messageMarkup(node, siblings, last) {
  const index = siblings.findIndex(n => n.id === node.id);
  const version = siblings.length > 1 ? `<div class="version">
    ${button('version','‹','',siblings[index-1]?.id,'aria-label="上一版本"'+(!index?' disabled':''))}
    <span>${index+1} / ${siblings.length}</span>
    ${button('version','›','',siblings[index+1]?.id,'aria-label="下一版本"'+(index===siblings.length-1?' disabled':''))}</div>` : '';
  const actions = button('edit','编辑','',node.id)+button('copy','复制','',node.id)+button('remove','删除','',node.id);
  const ai = node.role === 'assistant';
  return `<article class="message ${ai?'author-ai':'author-user'}" data-node="${esc(node.id)}">
    <div class="byline">${ai? icon+'<b>Novel Chat</b>' : '<b>你</b>'}${version}</div>
    <div class="prose">${esc(node.text)}</div><div class="msg-actions">${actions}
    ${ai?button('regenerate','重新生成','',node.id):last?button('reply','生成回复','',node.id):''}</div></article>`;
}
export function chatView(story) {
  const c = activeChat(story), nodes = path(c);
  const groups = new Map();
  for (const n of c.nodes) { if (!groups.has(n.parent)) groups.set(n.parent, []); groups.get(n.parent).push(n); }
  return `<section class="chat-shell"><div class="thread" id="thread"><div class="reading">
    ${c.seed ? '<details class="seed"><summary>前情总结</summary><div class="prose">'+esc(c.seed)+'</div></details>' : ''}
    ${nodes.map((n,i)=>messageMarkup(n,groups.get(n.parent),i===nodes.length-1)).join('')}
    <div id="stream"></div></div></div>
    <div class="composer-wrap"><div id="generation-status" class="generation-status" role="status"></div>
    <form id="composer"><textarea id="draft" rows="2" aria-label="写作要求" placeholder="写作要求…">${esc(c.draft)}</textarea>
    <div class="composer-actions">
    ${button('summary',glyph('note'),'round','','aria-label="章节总结" title="章节总结"'+(!nodes.length?' disabled':''))}
    <button class="round send" data-action="send" type="submit" aria-label="发送" title="发送">${glyph('send')}</button></div></form></div></section>`;
}
export function settings(config) {
  return `<section class="narrow">
  <button class="setting-entry" data-action="world">世界观${glyph('next')}</button>
  <section class="settings-block"><h2>API</h2>
  <form id="api-form"><label for="api-url">API URL</label><input id="api-url" type="url" placeholder="https://api.example.com/v1" value="${esc(config.url)}" autocomplete="off" spellcheck="false">
  <label for="api-key">API Key</label><input type="password" id="api-key" value="${esc(config.key)}" autocomplete="off" spellcheck="false">
  <label for="api-model">模型 ID</label><div class="field-pair"><input id="api-model" value="${esc(config.model)}" spellcheck="false" autocomplete="off">${button('models','拉取模型','outline')}</div>
  <div class="paired-actions"><button type="submit" class="primary">保存配置</button>${button('test','测试连接','outline')}</div><p id="api-status" role="status"></p></form></section>
  <section class="settings-block"><h2>备份</h2><div class="paired-actions">
  ${button('import-one','导入备份','outline')}${button('export-one','导出','outline')}</div></section></section>`;
}
export function worldView(story, editing) {
  return editing
    ? `<section class="note"><textarea id="world-text" aria-label="世界观" spellcheck="false"></textarea></section>`
    : `<section class="note" aria-label="世界观"><div class="note-text">${esc(story.world)}</div></section>`;
}
