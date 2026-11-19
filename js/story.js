const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

export function newChat(name = '对话 1', seed = '') {
  return { id: uid(), name, seed, nodes: [], draft: '' };
}
export function newStory(title) {
  const chat = newChat();
  return { id: uid(), title, world: '', chats: [chat], active: chat.id, updated: now(), rev: 0 };
}
export function activeChat(story) {
  return story.chats.find(c => c.id === story.active);
}
export function path(chat) {
  const selected = new Map(chat.nodes.filter(n => n.selected).map(n => [n.parent, n]));
  const result = [];
  let parent = null;
  while (selected.has(parent)) {
    const node = selected.get(parent);
    result.push(node);
    parent = node.id;
  }
  return result;
}
export function select(chat, id) {
  const node = chat.nodes.find(n => n.id === id);
  if (!node) throw new Error('找不到这个消息版本。');
  for (const other of chat.nodes) {
    if (other.parent === node.parent) other.selected = other.id === id;
  }
}
export function append(chat, parent, role, text) {
  const previous = parent === null ? null : chat.nodes.find(n => n.id === parent);
  if ((parent !== null && !previous) || role !== (previous?.role === 'user' ? 'assistant' : 'user')) {
    throw new Error('消息位置已改变，请重新选择分支。');
  }
  if (!text.length) throw new Error('消息不能为空。');
  const node = { id: uid(), parent, role, text, selected: true };
  chat.nodes.push(node);
  select(chat, node.id);
  return node;
}
export function removeBranch(chat, id) {
  const children = new Map();
  for (const n of chat.nodes) {
    if (!children.has(n.parent)) children.set(n.parent, []);
    children.get(n.parent).push(n.id);
  }
  const target = chat.nodes.find(n => n.id === id);
  if (!target) throw new Error('找不到这条消息。');
  const removed = new Set([id]);
  for (const parent of removed) for (const child of children.get(parent) || []) removed.add(child);
  chat.nodes = chat.nodes.filter(n => !removed.has(n.id));
  const siblings = chat.nodes.filter(n => n.parent === target.parent);
  if (target.selected && siblings.length) select(chat, siblings.at(-1).id);
}

export const SYSTEM = '你是与作者共同创作中文小说的专业写作者。以作者当前的写作要求为准，尊重故事世界观、人物身份、叙事视角及当前分支已发生的事实。让人物的选择推动情节，用具体行动、感官细节和有辨识度的对白呈现转折。保持时间、动机和叙述声音连贯，避免模板化抒情、重复铺陈与复述前文。写作或续写时直接输出小说正文，自然分段，单次以约五千汉字为目标；若作者另有篇幅、格式或任务要求，依其要求。';
export const SUMMARY = '为下一次续写整理当前对话的章节总结。按时间顺序概括已发生的情节，记录人物关系与状态、当前场景、关键伏笔和未决事项。仅使用这条分支已有的事实，保留必要专名，避免推测和续写。';
export function messages(story, chat, { through, summary = false } = {}) {
  let history = path(chat);
  if (through !== undefined) {
    const index = history.findIndex(n => n.id === through);
    if (index < 0 || history[index].role !== 'user') throw new Error('生成位置不在当前分支。');
    history = history.slice(0, index + 1);
  }
  const out = [{ role: 'system', content: SYSTEM }];
  if (story.world.trim()) out.push({ role: 'system', content: '故事世界观与写作设定\n' + story.world });
  if (chat.seed.trim()) out.push({ role: 'user', content: '前情总结（本对话的起始背景）\n' + chat.seed });
  out.push(...history.map(n => ({ role: n.role, content: n.text })));
  if (summary) out.push({ role: 'user', content: SUMMARY });
  return out;
}

