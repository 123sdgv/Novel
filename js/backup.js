import { newStory } from './story.js';

const invalid = reason => { throw new Error('备份无效：' + reason); };
const array = (value, label) => Array.isArray(value) ? value : invalid(label);
const string = (value, label) => typeof value === 'string' ? value : invalid(label);
const name = value => string(value, '名称须为文本').trim() || invalid('名称为空');
const id = value => /^[a-zA-Z0-9_-]{1,128}$/.test(string(value, 'ID 须为文本')) ? value : invalid('ID 格式错误');
function unique(items, label) {
  const ids = new Set(items.map(item => id(item?.id)));
  if (ids.size !== items.length) invalid(label + ' 有重复 ID');
  return ids;
}
function readChat(c) {
  const raw = array(c.nodes, '消息列表缺失');
  unique(raw, '消息');
  const nodes = raw.map(n => ({
    id: n.id, parent: n.parent === null ? null : id(n.parent),
    role: ['user', 'assistant'].includes(n.role) ? n.role : invalid('消息角色错误'),
    text: string(n.text, '消息正文缺失') || invalid('消息正文为空'),
    selected: typeof n.selected === 'boolean' ? n.selected : invalid('分支选择无效')
  }));
  const groups = new Map();
  for (const n of nodes) {
    if (!groups.has(n.parent)) groups.set(n.parent, []);
    groups.get(n.parent).push(n);
  }
  for (const siblings of groups.values()) {
    if (siblings.filter(n => n.selected).length !== 1) invalid('同组版本必须选中一个');
  }
  const queue = [...(groups.get(null) || [])];
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i];
    if (n.parent === null && n.role !== 'user') invalid('首条消息角色错误');
    for (const child of groups.get(n.id) || []) {
      if (child.role === n.role) invalid('消息顺序错误');
      queue.push(child);
    }
  }
  if (queue.length !== nodes.length) invalid('存在断开的消息或循环引用');
  return { id: id(c.id), name: name(c.name), seed: string(c.seed, '前情字段缺失'),
    draft: string(c.draft ?? '', '草稿字段错误'), nodes };
}
function readStory(s) {
  const raw = array(s.chats, '对话列表缺失');
  const ids = unique(raw, '对话');
  if (!ids.has(s.active)) invalid('找不到当前对话');
  if (typeof s.updated !== 'string' || !Number.isFinite(Date.parse(s.updated))) invalid('修改时间错误');
  return { id: id(s.id), title: name(s.title), world: string(s.world, '世界观缺失'),
    active: s.active, updated: s.updated, chats: raw.map(readChat) };
}
export function pack(stories, scope) {
  return { schemaVersion: 1, scope, stories: stories.map(readStory) };
}
export function unpack(data, single = false) {
  if (data?.schemaVersion !== 1 || !['story', 'all'].includes(data.scope)) invalid('格式或版本不受支持');
  const stories = array(data.stories, '故事列表缺失');
  if ((data.scope === 'story' || single) && stories.length !== 1) invalid('请选择只包含一个故事的备份');
  unique(stories, '故事');
  return stories.map(raw => {
    const s = readStory(raw);
    // Chat and node IDs are scoped by story, so copying only the story ID keeps every edge intact.
    return { ...s, id: newStory(s.title).id, rev: 0 };
  });
}

