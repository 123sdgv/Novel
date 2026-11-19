import test from 'node:test';
import assert from 'node:assert/strict';
import {completion,endpoint,getModels} from '../js/api.js';
const config={url:'https://unit.invalid/v1/',key:'only-a-fixture',model:'fiction'};
function mock(t,fn) { t.mock.method(globalThis,'fetch',fn); }
function stream(chunks) {
  return new Response(new ReadableStream({ start(ctrl) {for(const c of chunks) ctrl.enqueue(c);ctrl.close();} }),
    {headers:{'content-type':'text/event-stream'}});
}
const utf8=s=>new TextEncoder().encode(s);
const packet=(content,reason=null)=>'data: '+JSON.stringify({choices:[{delta:{content},finish_reason:reason}]})+'\r\n\r\n';
test('URL 拼接兼容域名、版本路径、自定义代理前缀和完整端点',()=>{
  for (const url of ['https://api.example','https://api.example/v1/','https://api.example/v1/models','https://api.example/v1/chat/completions/']) {
    assert.equal(endpoint(url,'models'),'https://api.example/v1/models');
  }
  assert.equal(endpoint('https://api.example/prefix/v2/','chat/completions'),'https://api.example/prefix/v2/chat/completions');
  for (const bad of ['http://api.example','https://x.example?key=x','https://a:b@x.example','file:///x']) assert.throws(()=>endpoint(bad,'models'));
});
test('模型列表和短测试使用实际 HTTP 形状，不暴露 Key 到 URL',async t=>{
  const requests=[];
  mock(t,async(url,opts)=>{
    requests.push([url,opts]);
    return Response.json(opts.body?{choices:[{message:{content:'OK'}}]}:{data:[{id:'模型2'},{id:'模型1'}]});
  });
  assert.deepEqual(await getModels(config),['模型1','模型2']);
  await completion(config,[{role:'user',content:'回复 OK'}],{mode:'test'});
  assert.equal(requests[0][1].method,'GET');assert.equal(requests[0][0],'https://unit.invalid/v1/models');
  assert.equal(requests[0][1].headers.Authorization,'Bearer '+config.key);
  const body=JSON.parse(requests[1][1].body);assert.equal(body.stream,false);assert.equal(body.max_tokens,16);
});
test('SSE 跨 UTF-8 字节、CRLF 边界、心跳、role-only、结束标志；长正文保持完整',async t=>{
  const prose='雪落在空无一人的站台。'.repeat(500);
  const bytes=utf8(': heartbeat\r\n\r\n'+packet(undefined)+packet(prose)+packet('', 'length')+'data: [DONE]');
  const segments=[];for(let i=0;i<bytes.length;i+=41) segments.push(bytes.slice(i,i+41));
  mock(t,async()=>stream(segments));let result='';
  assert.equal(await completion(config,[],{onText:t=>{result+=t}}),'length');assert.equal(result,prose);
});
test('断线、坏数据、流内错误在已收到的正文后清楚报错',async t=>{
  let suffix='';mock(t,async()=>stream([utf8(packet('已收到')+suffix)]));
  for(const [end,err] of [['',/中断/],['data: {bad}\n\n',/解析/],['data: {"error":{"message":"故障"}}\n\n',/故障/]]) {
    suffix=end;let partial='';await assert.rejects(completion(config,[],{onText:t=>{partial+=t}}),err);assert.equal(partial,'已收到');
  }
});
test('停止生成会取消底层请求并保留已经交付的文本',async t=>{
  const ctrl=new AbortController();let output='',receivedSignal;
  mock(t,async(_url,{signal})=>{
    receivedSignal=signal;
    return new Response(new ReadableStream({start(c){c.enqueue(utf8(packet('保留')));
      signal.addEventListener('abort',()=>c.error(signal.reason));}}));
  });
  await assert.rejects(completion(config,[],{signal:ctrl.signal,onText:s=>{output+=s;ctrl.abort();}}),{name:'AbortError'});
  assert.ok(receivedSignal.aborted);assert.equal(output,'保留');
});
test('HTTP 错误带原因且遮盖回显凭据，网络错误给出 CORS 提示',async t=>{
  let code=401;
  mock(t,async()=>{if(!code) throw new TypeError('failed');
    return Response.json({error:{message:'bad '+config.key}},{status:code});});
  for(const n of [401,402,403,404,429]) {code=n;await assert.rejects(getModels(config),e=>e.message.includes(String(code))&&!e.message.includes(config.key));}
  code=0;await assert.rejects(getModels(config),/CORS/);
});

