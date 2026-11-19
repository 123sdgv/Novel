import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const scope='https://test.invalid/Novel/';
test('离线命中子路径入口和全部静态文件，仅拦截明确允许的无凭据 GET',async()=>{
  const events={}, stored=new Map(), removed=[], prefix='novel-chat:'+scope+':';
  let claimed=false;
  const cache={
    async addAll(requests) {
      for(const request of requests) {
        assert.equal(request.cache,'reload');
        const name='./'+request.url.slice(scope.length);
        const rel=name==='./'?'../index.html':'../'+name.slice(2);
        const bytes=await readFile(new URL(rel,import.meta.url));
        stored.set(new URL(name,scope).href,bytes);
      }
    },
    match:req=>stored.get(req.url)
  };
  const globals={ URL, Request, self:{ registration:{scope},clients:{claim(){claimed=true;}},
    addEventListener(name,fn){events[name]=fn;} },caches:{open:async()=>cache,
    keys:async()=>[prefix+'old','other-project-cache'],delete:key=>removed.push(key)},
    fetch(){throw new Error('offline');} };
  vm.runInNewContext(await readFile(new URL('../sw.js',import.meta.url),'utf8'),globals);
  await new Promise((resolve,reject)=>events.install({waitUntil:promise=>promise.then(resolve,reject)}));
  await new Promise((resolve,reject)=>events.activate({waitUntil:promise=>promise.then(resolve,reject)}));
  assert.ok(claimed);assert.deepEqual(removed,[prefix+'old']);
  async function intercept(req) {let result; events.fetch({request:req,respondWith:res=>{result=res}});return await result;}
  for(const href of stored.keys()) assert.ok((await intercept(new Request(href))).length);
  for(const req of [new Request(scope+'models'),new Request(scope+'chat/completions',{method:'POST'}),new Request(scope,{headers:{Authorization:'Bearer fake'}}),new Request(scope+'?private=1')]) {
    assert.equal(await intercept(req),undefined);
  }
  const manifest=JSON.parse((await intercept(new Request(scope+'manifest.webmanifest'))).toString());
  assert.equal(new URL(manifest.start_url,scope).href,scope);
  assert.equal(new URL(manifest.scope,scope).href,scope);
  for(const icon of manifest.icons) {
    const bytes=stored.get(new URL(icon.src,scope).href);
    const size=Number(icon.sizes.split('x')[0]);assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);
  }
});

