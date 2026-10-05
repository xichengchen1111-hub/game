import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

const temp=await mkdtemp(join(tmpdir(),'undercurrent-test-'));
for(const file of ['data','game']) {
  const source=await readFile(new URL(`../src/${file}.ts`,import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace("'./data'","'./data.mjs'");
  await writeFile(join(temp,`${file}.mjs`),compiled);
}
const {freshGame,reducer,results,schedule}=await import(pathToFileURL(join(temp,'game.mjs')));
const {npcs,events}=await import(pathToFileURL(join(temp,'data.mjs')));
await rm(temp,{recursive:true,force:true});
const start=()=>reducer(freshGame(),{type:'start'});
const tick=(s,n)=>{for(let i=0;i<n;i++)s=reducer(s,{type:'tick'});return s};

test('180-second round emits all 70 unique scheduled messages and stops',()=>{
  let s=tick(start(),180);
  assert.equal(s.phase,'finished');assert.equal(s.elapsed,180);
  assert.equal(s.messages.length,70);assert.equal(new Set(s.messages.map(m=>m.id)).size,70);
  assert.equal(reducer(s,{type:'tick'}),s);
  for(const e of events)assert.ok(schedule.some(m=>m.at>e.at));
  assert.equal(new Set(npcs.map(n=>n.role)).size,9);
});
test('pause freezes time, investigation spending, and actions',()=>{
  const s=reducer(tick(start(),6),{type:'pause'});
  for(const action of [{type:'tick'},{type:'investigate',user:0,kind:'history'},{type:'moderate',user:0,action:'封禁'}])assert.equal(reducer(s,action),s);
  assert.equal(tick(reducer(s,{type:'resume'}),1).elapsed,7);
});
test('investigations charge once and cannot overdraw the budget',()=>{
  let s=start();
  s=reducer(s,{type:'investigate',user:0,kind:'history'});assert.equal(s.points,16);
  assert.equal(reducer(s,{type:'investigate',user:0,kind:'history'}),s);
  for(let user=1;user<9;user++)s=reducer(s,{type:'investigate',user,kind:'history'});
  assert.equal(s.points,0);assert.equal(reducer(s,{type:'investigate',user:0,kind:'relations'}),s);
});
test('mute blocks scheduled chat for 45 seconds then expires',()=>{
  let s=reducer(start(),{type:'moderate',user:0,action:'禁言'});
  s=tick(s,44);assert.equal(s.messages.filter(m=>m.user===0).length,0);assert.equal(s.suppressed,2);
  s=tick(s,26);assert.equal(s.messages.filter(m=>m.user===0).length,1);
});
test('ban persists; releasing restores future messages',()=>{
  let s=reducer(start(),{type:'moderate',user:1,action:'封禁'});
  s=tick(s,75);assert.equal(s.messages.filter(m=>m.user===1).length,0);
  s=reducer(s,{type:'moderate',user:1,action:'放行'});
  s=tick(s,105);assert.equal(s.messages.filter(m=>m.user===1).length,2);
});
test('watch markers preserve active restrictions',()=>{
  let s=reducer(start(),{type:'moderate',user:1,action:'封禁'});
  s=reducer(s,{type:'moderate',user:1,action:'标记观察'});
  assert.equal(s.users[1].watched,true);assert.equal(s.users[1].action,'封禁');
  s=tick(s,180);assert.equal(s.messages.filter(m=>m.user===1).length,0);
});
test('correct containment outperforms neglect; blanket bans penalize innocents',()=>{
  let careful=start(),blanket=start();
  for(const n of npcs){if(n.malicious)careful=reducer(careful,{type:'moderate',user:n.id,action:'封禁'});blanket=reducer(blanket,{type:'moderate',user:n.id,action:'封禁'});}
  const perfect=results(tick(careful,180)),ignored=results(tick(start(),180)),overreach=results(tick(blanket,180));
  assert.equal(perfect.accuracy,100);assert.equal(perfect.missed.length,0);assert.equal(perfect.innocent.length,0);
  assert.equal(ignored.missed.length,6);assert.equal(overreach.innocent.length,8);
  assert.ok(perfect.score>ignored.score);assert.ok(perfect.score>overreach.score);
  console.log('Simulation scores:',{careful:perfect.score,neglect:ignored.score,blanket:overreach.score});
});
test('releasing does not erase a wrongful sanction; stats stay bounded',()=>{
  let s=reducer(start(),{type:'moderate',user:0,action:'封禁'});
  s=reducer(s,{type:'moderate',user:0,action:'放行'});s=tick(s,180);
  assert.equal(results(s).innocent.length,1);
  for(const value of [s.atmosphere,s.satisfaction])assert.ok(value>=0&&value<=100);
  assert.deepEqual(reducer(s,{type:'reset'}),freshGame());
});
