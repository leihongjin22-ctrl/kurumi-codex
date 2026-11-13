(()=>{
  const api=window.kurumi,$=id=>document.getElementById(id);
  if(!api?.readQuota)return;
  let data=null,error='',connected=false,pending=null,generation=0,lastAttempt=0,taskTimer=null;
  const percent=n=>`${Math.round(n*10)/10}%`;
  const duration=n=>n===10080?'每周':n===300?'5 小时':n!=null?(n%60===0?`${n/60} 小时`:`${n} 分钟`):'时段';
  const date=n=>{const value=new Date(n);return Number.isFinite(value.getTime())?value.toLocaleString('zh-CN',{hour12:false}):'未知';};
  function render(){
    const windows=(data?.buckets||[]).flatMap(b=>[b.primary,b.secondary].filter(Boolean));
    const minimum=windows.length?Math.min(...windows.map(w=>w.remaining)):null;
    const stale=!!error||!connected||windows.some(w=>w.resetsAt&&w.resetsAt*1000<=Date.now());
    $('quotaSummary').textContent=minimum==null?(pending?'正在查询…':error?'额度不可用':'额度未知'):`余量 ${percent(minimum)}${stale?' · 旧':''}`;
    $('quotaHint').textContent=minimum==null?'Codex 账户额度':'最低窗口余量 · 点击详情';
    $('quotaButton').dataset.level=minimum==null?'unknown':minimum<=10?'low':minimum<=30?'medium':'normal';
    const p=minimum==null?0:minimum/100;
    $('quotaTopSand').setAttribute('height',String(p*15));$('quotaTopSand').setAttribute('y',String(21-p*15));
    const bottom=minimum==null?0:(1-p)*15;$('quotaBottomSand').setAttribute('height',String(bottom));$('quotaBottomSand').setAttribute('y',String(38-bottom));
    $('quotaButton').title=error?`额度刷新失败：${error}`:data?`更新于 ${date(data.updatedAt)}；点击查看各额度窗口`:'点击查询 Codex 额度';
    for(const id of ['quotaRefresh','quotaQuickRefresh']){$(id).disabled=!!pending||!connected;$(id).classList.toggle('is-loading',!!pending);}
    $('quotaStatus').textContent=error?`刷新失败：${error}${data?'；下方保留上次数据。':''}`:!connected?'服务未连接，已有数据可能过期。':pending?'正在查询最新额度…':data?.allowed===false?'服务当前不允许常规用量，请结合各窗口及账户状态查看。':data?.partial?'已接收服务更新，部分窗口仍可能是上次查询结果。':'已获取服务返回的额度。';
    const details=$('quotaDetails');details.replaceChildren();
    for(const b of data?.buckets||[]){
      const section=document.createElement('section');section.className='quota-bucket';
      const title=document.createElement('strong');title.textContent=`${b.name==='codex'?'Codex':b.name}${b.plan?' · '+b.plan:''}`;section.append(title);
      for(const [index,w] of [b.primary,b.secondary].entries()){
        const row=document.createElement('div');row.className='quota-window';
        if(!w){row.textContent=`${index===0?'主要':'次要'}窗口：服务未提供`;section.append(row);continue;}
        const text=document.createElement('span');text.textContent=`${duration(w.duration)} · 剩余 ${percent(w.remaining)}`;
        const meter=document.createElement('meter');meter.min=0;meter.max=100;meter.value=w.remaining;meter.setAttribute('aria-label',`${duration(w.duration)}剩余比例`);
        const reset=document.createElement('small');reset.textContent=w.resetsAt?`重置：${date(w.resetsAt*1000)}${w.resetsAt*1000<=Date.now()?'（时间已到，请刷新确认）':''}`:'重置时间未知';row.append(text,meter,reset);section.append(row);
      }
      if(b.credits){const credit=document.createElement('p');credit.textContent=b.credits.unlimited?'额外额度：不限量':`额外额度余额：${b.credits.balance??'未知'}`;section.append(credit);}
      if(b.reached){const reached=document.createElement('p');reached.textContent=`服务限额状态：${b.reached}`;section.append(reached);}
      details.append(section);
    }
    if(!data?.buckets?.length)details.textContent='服务尚未提供可显示的额度窗口，无法推算剩余次数。';
    if(data?.resetCredits!=null){const reset=document.createElement('p');reset.textContent=`可用额度重置次数：${data.resetCredits}`;details.append(reset);}
    $('quotaUpdated').textContent=data?`上次更新：${date(data.updatedAt)} · 前台每分钟自动查询；查询不发送模型消息。`:'查询不发送模型消息。';
  }
  async function refresh(){
    if(!connected||pending)return;
    const version=generation;lastAttempt=Date.now();error='';
    const request=api.readQuota();pending=request;render();
    try{const value=await request;if(version===generation){data=value;error='';}}
    catch(e){if(version===generation)error=e.message||'查询失败';}
    finally{if(pending===request)pending=null;render();if(version!==generation&&connected)setTimeout(refresh,0);}
  }
  function status(state){if(state.error){connected=false;generation++;error='Codex 服务已断开';render();}else if(state.ready){const was=connected;connected=true;render();if(!was)refresh();}}
  $('quotaButton').addEventListener('click',()=>{$('quotaDialog').showModal();render();if(!pending)refresh();});
  for(const id of ['quotaRefresh','quotaQuickRefresh'])$(id).addEventListener('click',refresh);
  $('quotaClose').addEventListener('click',()=>$('quotaDialog').close());
  api.onStatus(status);api.getStatus().then(status).catch(e=>{error=e.message;render();});
  api.onQuota?.(value=>{if(!connected)return;const map=new Map((data?.buckets||[]).map(b=>[b.id,b]));for(const b of value.buckets||[])map.set(b.id,b);data={...data,...value,buckets:[...map.values()],resetCredits:value.resetCredits??data?.resetCredits??null,allowed:value.allowed??data?.allowed??null};error='';render();});
  api.onEvent(event=>{if(event.method==='account/updated'){generation++;data=null;error='';render();refresh();}if(event.method==='turn/completed'&&connected){clearTimeout(taskTimer);taskTimer=setTimeout(refresh,2000);}});
  const foregroundRefresh=()=>{if(!document.hidden&&Date.now()-lastAttempt>15000)refresh();};
  document.addEventListener('visibilitychange',foregroundRefresh);window.addEventListener('focus',foregroundRefresh);
  setInterval(()=>{if(!document.hidden)refresh();},60000);
  render();
})();
