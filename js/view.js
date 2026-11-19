import { activeChat, path } from './story.js';
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function button(action, label, style = '', id = '', attrs = '') {
  return `<button type="button" class="${style}" data-action="${action}" data-id="${esc(id)}" ${attrs}>${label}</button>`;
}
const date = value => new Intl.DateTimeFormat('zh-CN', {year:'numeric',month:'short',day:'numeric'}).format(new Date(value));
const icon = '<img alt="" src="./icons/book.svg">';
export function overview(stories) {
  const intro = stories.length ? button('new-story','新建故事','primary') : '';
  const cards = [...stories].sort((a,b) => b.updated.localeCompare(a.updated)).map(s => {
    return `<article class="book-row"><button class="book-open" data-action="open" data-id="${esc(s.id)}">
    <span class="cover" aria-hidden="true"><i></i><i></i></span><span class="book-meta">
    <strong>${esc(s.title)}</strong><small>${s.chats.length} 个对话 <span>·</span> ${date(s.updated)} 更新</small></span></button>
    ${button('story-menu','管理','quiet',s.id,'aria-label="管理故事"')}</article>`;
  }).join('');
  return `<section class="wide"><div class="heading"><div><h1>故事总览</h1><p class="sub">共 ${stories.length} 个故事</p></div>${intro}</div>
    ${cards ? '<div class="book-list">'+cards+'</div>' : `<section class="empty-spread">
    <div class="empty-text"><h2>写下第一个故事</h2><p>从一段设定或一句对白开始。<br>每个故事都拥有自己的世界观与对话。</p>
    ${button('new-story','新建故事','primary plus')}</div><div class="book-art"><img src="./icons/bookshelf.svg" alt=""></div></section>`}
    <section class="backup-row"><div><h2>故事备份</h2><p>故事保存在当前浏览器，可导出为 JSON。</p></div>
    <div class="actions">${button('import-all','导入备份','outline')}${button('export-all','导出全部','outline','',stories.length?'':'disabled')}</div></section></section>`;
}
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
  const intro = !nodes.length && !c.seed ? `<section class="chat-empty"><div class="small-rule"></div><h2>从这里落笔</h2>
    <p>写下想展开的场景，或先为故事设定世界观。</p>${button('world','编辑世界观','underlink')}</section>` : '';
  return `<section class="chat-shell"><div class="chat-heading"><div class="chat-title"><h1>${esc(story.title)}</h1></div>
    ${button('chats',esc(c.name)+' <span aria-hidden="true">⌄</span>','outline session-button','','aria-label="切换或管理对话"')}</div>
    <div class="thread" id="thread"><div class="reading">
    ${c.seed ? '<details class="seed"><summary>前情总结</summary><div class="prose">'+esc(c.seed)+'</div></details>' : ''}
    ${intro}${nodes.map((n,i)=>messageMarkup(n,groups.get(n.parent),i===nodes.length-1)).join('')}
    <div id="stream"></div></div></div>
    <div class="composer-wrap"><div id="generation-status" class="generation-status" role="status"></div>
    <form id="composer"><textarea id="draft" rows="2" aria-label="写作要求" placeholder="写下这一段的情节或要求…">${esc(c.draft)}</textarea>
    <div class="composer-actions"><span class="session-hint">Ctrl / ⌘ + Enter 发送</span><div>
    <button class="primary send" data-action="send" type="submit" aria-label="发送">发送 <span aria-hidden="true">↑</span></button>
    ${button('summary','总结','outline','','aria-label="章节总结"'+(!nodes.length?' disabled':''))}</div></div></form></div></section>`;
}
export function settings(story, config) {
  return `<section class="narrow"><div class="heading"><div><h1>故事设置</h1><p class="sub">${esc(story.title)}</p></div></div>
  <button class="setting-entry" data-action="world"><span><strong>世界观</strong><small>${story.world?'编辑背景、人物与写作要求':'添加背景、人物与写作要求'}</small></span><span>编辑 ›</span></button>
  <section class="settings-block"><h2>API 连接</h2><p>配置此故事使用的 OpenAI 兼容接口。密钥只保存在本机。</p>
  <form id="api-form"><label>API URL<input id="api-url" type="url" placeholder="https://api.example.com/v1" value="${esc(config.url)}" autocomplete="off" spellcheck="false"></label>
  <label>API Key<input type="password" id="api-key" placeholder="输入服务商提供的密钥" value="${esc(config.key)}" autocomplete="off" spellcheck="false"></label>
  <label>模型 ID<span class="field-pair"><input id="api-model" placeholder="手动填写或拉取模型" value="${esc(config.model)}" spellcheck="false" autocomplete="off">${button('models','拉取模型','outline')}</span></label>
  <div class="actions"><button type="submit" class="primary">保存配置</button>${button('test','测试连接','outline')}</div><p id="api-status" role="status"></p></form></section>
  <section class="settings-block"><h2>故事备份</h2><p>包含世界观和全部对话版本。导入后会创建一个独立故事。</p>
  <div class="actions">${button('export-one','导出故事','outline')}${button('import-one','导入故事','outline')}</div></section></section>`;
}
export function worldView(story) {
  return `<section class="narrow"><div class="heading"><div><h1>世界观</h1><p class="sub">${esc(story.title)} · 所有对话共享</p></div></div>
  <form id="world-form"><label for="world-text">背景、人物与写作要求</label><textarea id="world-text" class="manuscript" rows="12" placeholder="比如：故事发生在哪里？人物彼此如何称呼？这一章采用谁的视角？">${esc(story.world)}</textarea>
  <div class="actions"><button class="primary" type="submit">保存世界观</button>${button('back-world','取消','outline')}</div></form></section>`;
}

