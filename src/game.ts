import { npcs, makeSchedule, type Action, type ChatMessage } from './data';
export const DURATION = 180;
export const schedule = makeSchedule();
export type Decision = {user:number; action:Action; at:number};
export type UserState = {action:Action; watched:boolean; muteUntil:number; warningAt:number; history:boolean; relations:boolean};
export type Game = {phase:'ready'|'playing'|'paused'|'finished'; elapsed:number; points:number; atmosphere:number; satisfaction:number; heat:number; messages:ChatMessage[]; users:Record<number,UserState>; decisions:Decision[]; suppressed:number};
export const freshGame = ():Game => ({phase:'ready',elapsed:0,points:18,atmosphere:85,satisfaction:82,heat:12480,messages:[],users:Object.fromEntries(npcs.map(n=>[n.id,{action:'放行',watched:false,muteUntil:0,warningAt:-100,history:false,relations:false}])),decisions:[],suppressed:0});
export type GameAction = {type:'start'|'pause'|'resume'|'tick'|'reset'} | {type:'investigate';user:number;kind:'history'|'relations'} | {type:'moderate';user:number;action:Action};
const clamp = (n:number)=>Math.max(0,Math.min(100,n));
export function reducer(state:Game,event:GameAction):Game {
  if(event.type==='reset')return freshGame();
  if(event.type==='start'&&state.phase==='ready')return {...state,phase:'playing'};
  if(event.type==='pause'&&state.phase==='playing')return {...state,phase:'paused'};
  if(event.type==='resume'&&state.phase==='paused')return {...state,phase:'playing'};
  if(state.phase!=='playing')return state;
  if(event.type==='investigate') {
    const cost=event.kind==='history'?2:3;
    if(state.users[event.user][event.kind]||state.points<cost)return state;
    return {...state,points:state.points-cost,users:{...state.users,[event.user]:{...state.users[event.user],[event.kind]:true}}};
  }
  if(event.type==='moderate') {
    const user=state.users[event.user];
    if(user.action===event.action && (event.action!=='禁言'||user.muteUntil>state.elapsed))return state;
    if(event.action==='标记观察'&&user.watched)return state;
    const next=event.action==='标记观察'
      ? {...user,watched:true,action:user.action==='放行'?'标记观察' as Action:user.action}
      : {...user,action:event.action,watched:event.action==='放行'?false:user.watched,muteUntil:event.action==='禁言'?state.elapsed+45:0,warningAt:event.action==='警告'?state.elapsed:user.warningAt};
    return {...state,users:{...state.users,[event.user]:next},decisions:[...state.decisions,{user:event.user,action:event.action,at:state.elapsed}]};
  }
  if(event.type==='tick') {
    const elapsed=state.elapsed+1;
    const incoming=schedule.filter(m=>m.at===elapsed);
    let suppressed=state.suppressed;
    const visible=incoming.filter(m=>{
      const u=state.users[m.user];
      const hidden=u.action==='封禁'||u.muteUntil>elapsed;
      if(hidden)suppressed++;
      return !hidden;
    });
    let atmosphere=state.atmosphere,satisfaction=state.satisfaction;
    // Consequences are aggregated in ten-second windows; never label an individual decision.
    if(elapsed%10===0) {
      const recent=state.messages.concat(visible).filter(m=>m.at>elapsed-10);
      const disruption=recent.filter(m=>npcs[m.user].malicious && elapsed>=32).reduce((sum,m)=>sum+(elapsed-state.users[m.user].warningAt<15?.45:1),0);
      const penalties=state.decisions.filter(d=>d.at>=elapsed-10&&d.at<elapsed&&!npcs[d.user].malicious).reduce((sum,d)=>sum+({放行:0,标记观察:0,警告:1,禁言:4,封禁:8}[d.action]),0);
      atmosphere=clamp(atmosphere+.7-disruption*1.8-penalties);
      satisfaction=clamp(satisfaction+.5-disruption*1.5-penalties*.55);
    }
    return {...state,elapsed,atmosphere,satisfaction,heat:state.heat+visible.length*(elapsed>105?97:39)+(elapsed===142?1680:0),messages:[...state.messages,...visible],suppressed,phase:elapsed>=DURATION?'finished':'playing'};
  }
  return state;
}
export function results(state:Game) {
  const sanctioned=new Set(state.decisions.filter(d=>d.action==='禁言'||d.action==='封禁').map(d=>d.user));
  const punished=new Set(state.decisions.filter(d=>['警告','禁言','封禁'].includes(d.action)).map(d=>d.user));
  const caught=npcs.filter(n=>n.malicious&&sanctioned.has(n.id));
  const missed=npcs.filter(n=>n.malicious&&!sanctioned.has(n.id));
  const innocent=npcs.filter(n=>!n.malicious&&punished.has(n.id));
  const correct=npcs.length-missed.length-innocent.length;
  const accuracy=Math.round(correct/npcs.length*100);
  const score=Math.round(accuracy*5+state.atmosphere*2.5+state.satisfaction*2.5);
  return {caught,missed,innocent,accuracy,score};
}
