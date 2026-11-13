const app = document.getElementById('app');
const ticks = document.getElementById('clockTicks');
const numerals = document.getElementById('clockNumerals');
const fragments = document.getElementById('portalFragments');
const phaseLabel = document.getElementById('phaseLabel');
const progressNumber = document.getElementById('progressNumber');
const splashCounter = document.getElementById('splashCounter');
const launcherMode = new URLSearchParams(location.search).has('launcher');
const ns = 'http://www.w3.org/2000/svg';
let timers = [];
let ticker;

function svg(name, attrs = {}) {
  const el = document.createElementNS(ns, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}
function polar(cx, cy, radius, angle) {
  const a = (angle - 90) * Math.PI / 180;
  return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
}
function clockArtwork() {
  const roman = ['Ⅻ','Ⅰ','Ⅱ','Ⅲ','Ⅳ','Ⅴ','Ⅵ','Ⅶ','Ⅷ','Ⅸ','Ⅹ','Ⅺ'];
  for (let i = 0; i < 60; i++) {
    const angle = i * 6;
    const major = i % 5 === 0;
    const [x1,y1] = polar(300,300,major?232:240,angle);
    const [x2,y2] = polar(300,300,249,angle);
    ticks.appendChild(svg('line',{x1,y1,x2,y2,stroke:major?'#e7bc77':'#ad7955','stroke-width':major?3:1,'stroke-opacity':major?.9:.5}));
  }
  roman.forEach((n,i) => {
    const [x,y] = polar(300,300,202,i*30);
    const t = svg('text',{x,y:y+10,fill:'#e9c48a','font-family':'Georgia,serif','font-size':'31','text-anchor':'middle'});
    t.textContent = n;
    numerals.appendChild(t);
  });
  for(let i=0;i<12;i++){
    const start=i*30+1.1,end=(i+1)*30-1.1;
    const o1=polar(350,350,310,start),o2=polar(350,350,310,end);
    const q2=polar(350,350,250,end),q1=polar(350,350,250,start);
    const path=svg('path',{class:'fragment',d:`M${o1[0]} ${o1[1]} A310 310 0 0 1 ${o2[0]} ${o2[1]} L${q2[0]} ${q2[1]} A250 250 0 0 0 ${q1[0]} ${q1[1]} Z`});
    const a=i*30+15,rad=a*Math.PI/180;
    path.style.setProperty('--dx',`${Math.sin(rad)*390}px`);
    path.style.setProperty('--dy',`${-Math.cos(rad)*390}px`);
    path.style.setProperty('--rot',`${i%2?75:-75}deg`);
    fragments.appendChild(path);
    const [tx,ty]=polar(350,350,278,a);
    const t=svg('text',{class:'fragment-num',x:tx,y:ty+11});t.textContent=roman[i];
    t.style.setProperty('--dx',`${Math.sin(rad)*390}px`);
    t.style.setProperty('--dy',`${-Math.cos(rad)*390}px`);
    t.style.setProperty('--rot',`${i%2?75:-75}deg`);
    fragments.appendChild(t);
  }
  fragments.appendChild(svg('circle',{cx:350,cy:350,r:238,class:'fragment-decor'}));
}
function schedule(delay, callback){timers.push(setTimeout(callback,delay));}
function clearTimeline(){timers.forEach(clearTimeout);timers=[];clearInterval(ticker)}
function setPhase(phase,label,number){app.dataset.phase=phase;if(label)phaseLabel.textContent=label;if(number)progressNumber.textContent=number}
function finish(){clearTimeline();setPhase('entered','已进入 Codex','100%')}
function play(){
  clearTimeline();
  app.dataset.phase='idle';
  phaseLabel.textContent='唤醒时之庭';progressNumber.textContent='00%';splashCounter.textContent='00 : 12 : 00';
  schedule(140,()=>setPhase('reveal','时之庭正在开启','16%'));
  schedule(1350,()=>setPhase('hold','刻刻帝正在运行','38%'));
  schedule(3650,()=>setPhase('reverse','时间倒流中','76%'));
  schedule(4800,()=>setPhase('split','机械钟解体','96%'));
  schedule(5850,finish);
  let elapsed=0;
  ticker=setInterval(()=>{
    elapsed+=80;
    if(elapsed>=3650&&elapsed<4800){const v=Math.max(0,12-Math.floor((elapsed-3650)/95));splashCounter.textContent=`00 : ${String(v).padStart(2,'0')} : 00`}
    else if(elapsed<3650){splashCounter.textContent=`00 : 12 : ${String(Math.floor(elapsed/90)%60).padStart(2,'0')}`}
  },80);
}
clockArtwork();
document.getElementById('replayButton').addEventListener('click',play);
document.getElementById('skipButton').addEventListener('click',()=>{if(launcherMode){window.close()}else{finish()}});
if(launcherMode){document.body.classList.add('launcher-mode');document.getElementById('skipButton').textContent='跳过动画 ↗'}
function updateClock(){if(!document.hidden)document.getElementById('liveClock').textContent=new Date().toLocaleTimeString('zh-CN',{hour12:false})}
function updateMotion(){app.classList.toggle('motion-paused',document.hidden||!document.hasFocus());if(!document.hidden)updateClock();}
document.addEventListener('visibilitychange',updateMotion);window.addEventListener('focus',updateMotion);window.addEventListener('blur',updateMotion);updateMotion();
updateClock();setInterval(updateClock,1000);
if(matchMedia('(prefers-reduced-motion: reduce)').matches){finish()}else{play()}
