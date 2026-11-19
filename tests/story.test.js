import test from 'node:test';
import assert from 'node:assert/strict';
import {newStory,newChat,activeChat,path,append,select,removeBranch,messages,SUMMARY,SYSTEM} from '../js/story.js';
import {pack,unpack} from '../js/backup.js';

function fixture() {
  const s=newStory('纸上城'); s.world='港口永远起雾';
  const c=activeChat(s);
  const a=append(c,null,'user','A'), a1=append(c,a.id,'assistant','A1');
  const next=append(c,a1.id,'user','A 后续');
  append(c,next.id,'assistant','旧结尾');
  const b=append(c,null,'user','B'), b1=append(c,b.id,'assistant','B1');
  return {s,c,a,a1,next,b,b1};
}
const texts = rows => rows.map(n=>n.content);
test('改历史要求时 B1 的请求只有固定指令、世界观与 B',()=>{
  const {s,c,b}=fixture();
  assert.deepEqual(messages(s,c,{through:b.id}),[
    {role:'system',content:SYSTEM},{role:'system',content:'故事世界观与写作设定\n港口永远起雾'},{role:'user',content:'B'}]);
});
test('重新生成历史回复时剔除自己及所有下文，保留其他版本',()=>{
  const {s,c,a,a1}=fixture(); select(c,a.id);
  assert.deepEqual(texts(messages(s,c,{through:a.id})).slice(2),['A']);
  const alt=append(c,a.id,'assistant','A2'); append(c,alt.id,'user','新结尾');
  select(c,a1.id); assert.deepEqual(path(c).map(n=>n.text),['A','A1','A 后续','旧结尾']);
  select(c,alt.id); assert.deepEqual(path(c).map(n=>n.text),['A','A2','新结尾']);
});
test('不能为隐藏分支或 AI 节点生成回复',()=>{
  const {s,c,a,b1}=fixture();
  for (const n of [a,b1]) assert.throws(()=>messages(s,c,{through:n.id}));
});
test('编辑 AI 产生独立版本，用户与 AI 的分支选择均可恢复',()=>{
  const {c,a,a1,b,b1}=fixture();
  const edit=append(c,b1.parent,'assistant','B 编辑版'); append(c,edit.id,'user','B 后续');
  select(c,a.id); assert.equal(path(c)[1].id,a1.id);
  select(c,b.id); assert.deepEqual(path(c).map(n=>n.text),['B','B 编辑版','B 后续']);
  select(c,b1.id); assert.deepEqual(path(c).map(n=>n.text),['B','B1']);
});
test('删除仅移除目标子树，自动选中剩余版本或回到父消息',()=>{
  const {s,c,a,a1,b}=fixture();
  removeBranch(c,b.id); assert.deepEqual(path(c).map(n=>n.text),['A','A1','A 后续','旧结尾']);
  removeBranch(c,a1.id); assert.deepEqual(c.nodes.map(n=>n.text),['A']);
  assert.deepEqual(texts(messages(s,c)).slice(2),['A']);
  removeBranch(c,a.id); assert.deepEqual(path(c),[]);
});
test('总结仅读取活动分支，新会话仅携带编辑后的总结并共享世界观',()=>{
  const {s,c}=fixture(), before=structuredClone(c);
  assert.deepEqual(texts(messages(s,c,{summary:true})).slice(2),['B','B1',SUMMARY]);
  assert.deepEqual(c,before);
  const next=newChat('第二章','手动调整的总结'); s.chats.push(next);
  const u=append(next,null,'user','继续');
  assert.deepEqual(texts(messages(s,next,{through:u.id})),[SYSTEM,'故事世界观与写作设定\n港口永远起雾','前情总结（本对话的起始背景）\n手动调整的总结','继续']);
});
test('备份白名单排除所有层级的配置，重复导入不覆盖原故事',()=>{
  const {s,c,a}=fixture(); s.api={key:'mock-secret'}; c.key='mock-secret'; c.nodes[0].apiKey='mock-secret'; c.draft='草稿';
  const payload=pack([s],'story'); assert.ok(!JSON.stringify(payload).includes('mock-secret'));
  const [copy]=unpack(payload,true), [again]=unpack(payload,true);
  assert.equal(new Set([s.id,copy.id,again.id]).size,3);
  assert.deepEqual(copy.chats,payload.stories[0].chats);
  select(activeChat(copy),a.id); assert.equal(path(activeChat(copy)).at(-1).text,'旧结尾');
});
test('全书架保留会话和活动选择，拒绝错版本和重复故事 ID',()=>{
  const {s}=fixture(); const other=newStory('另一部'); const c=newChat('新会话','前情'); s.chats.push(c); s.active=c.id;
  const data=pack([s,other],'all'); const restored=unpack(data);
  assert.equal(activeChat(restored[0]).seed,'前情'); assert.equal(restored.length,2);
  assert.throws(()=>unpack(data,true)); assert.throws(()=>unpack({...data,schemaVersion:9}));
  assert.throws(()=>unpack({...data,stories:[data.stories[0],data.stories[0]]}));
});
test('拒绝无效引用、循环、角色错误、重复或缺失选择，原数据不变',()=>{
  const {s}=fixture(); const data=pack([s],'story'), clean=JSON.stringify(data);
  for(const damage of [
    c=>{c.nodes[0].parent='missing'}, c=>{c.nodes[0].parent=c.nodes[1].id},
    c=>{c.nodes[0].role='assistant'}, c=>{c.nodes[0].selected=true},c=>{c.nodes.at(-1).selected=false},
    c=>c.nodes.push({...c.nodes[0]}),c=>{c.nodes[0].text=4}
  ]) {
    const bad=structuredClone(data); damage(bad.stories[0].chats[0]);
    assert.throws(()=>unpack(bad)); assert.equal(JSON.stringify(data),clean);
  }
});

