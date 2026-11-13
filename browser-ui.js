(() => {
  const api=window.kurumi, pane=document.getElementById('browserPane'),workspace=document.querySelector('.workspace');
  const area=document.getElementById('browserViewport'),address=document.getElementById('webAddress'),tabs=document.getElementById('webTabs');
  const notice=document.getElementById('browserNotice');let visible=false;
  const warn=e=>{notice.textContent=typeof e==='string'?e:(e?.message||'浏览器操作失败')};
  function resize(){if(!visible)return;const r=area.getBoundingClientRect();api.browserResize({x:r.x,y:r.y,width:r.width,height:r.height}).catch(warn)}
  function show(value){visible=value;pane.hidden=!value;workspace.classList.toggle('browser-open',value);api.browserShow(value).catch(warn);if(value)requestAnimationFrame(resize)}
  function render(state){
    tabs.replaceChildren();
    for(const t of state.tabs){
      const tab=document.createElement('div');tab.className=`browser-tab${t.id===state.active?' active':''}`;
      const label=document.createElement('button');label.className='web-tab-label';label.textContent=t.title;label.title=t.title;label.addEventListener('click',()=>api.browserSelect(t.id).catch(warn));
      const close=document.createElement('button');close.className='web-tab-close';close.textContent='×';close.title='关闭网页标签';close.addEventListener('click',()=>api.browserClose(t.id).catch(warn));
      tab.append(label,close);tabs.append(tab);
    }
    const active=state.tabs.find(t=>t.id===state.active);
    if(document.activeElement!==address)address.value=active?.url||'';
    document.getElementById('webBack').disabled=!active?.canBack;document.getElementById('webForward').disabled=!active?.canForward;
  }
  document.getElementById('browserToggle').addEventListener('click',()=>show(!visible));
  document.getElementById('browserClose').addEventListener('click',()=>show(false));
  window.addEventListener('kurumi-open-chat',()=>{if(visible)show(false)});
  document.getElementById('webNew').addEventListener('click',()=>api.browserCreate().catch(warn));
  for(const [id,action] of [['webBack','back'],['webForward','forward'],['webReload','reload']])document.getElementById(id).addEventListener('click',()=>api.browserAction(action).catch(warn));
  function go(){api.browserNavigate(address.value).then(()=>address.blur()).catch(warn)}
  document.getElementById('webGo').addEventListener('click',go);
  address.addEventListener('keydown',e=>{if(e.key==='Enter')go()});
  for(const selector of ['#tabs','#newTabButton','.new-session','#recentThreads'])document.querySelector(selector).addEventListener('click',()=>{if(visible)show(false)});
  api.onBrowserState(render);api.onBrowserWarning(warn);
  new ResizeObserver(resize).observe(area);window.addEventListener('resize',resize);
})();
