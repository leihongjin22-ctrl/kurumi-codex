(()=>{
 const finite=n=>typeof n==='number'&&Number.isFinite(n);
 function reasoning(item,now=Date.now()){
   const start=finite(item.startedAtMs)?item.startedAtMs:item._clientStartedAt;
   const end=finite(item.completedAtMs)?item.completedAtMs:item._clientCompletedAt;
   if(finite(item.durationMs))return {ms:Math.max(0,item.durationMs),live:false,estimated:false};
   if(!finite(start))return null;
   if(finite(end))return {ms:Math.max(0,end-start),live:false,estimated:!finite(item.startedAtMs)||!finite(item.completedAtMs)};
   return finite(item._clientStartedAt)?{ms:Math.max(0,now-start),live:true,estimated:!finite(item.startedAtMs)}:null;
 }
 function format(ms){const sec=Math.floor(ms/1000);return sec>=60?`${Math.floor(sec/60)} 分 ${sec%60} 秒`:`${sec} 秒`;}
 function turnSummary(turn){
   const items=(turn.items||[]).filter(x=>x.type==='reasoning');const times=items.map(x=>reasoning(x));
   const known=times.filter(x=>x&&!x.live),missing=times.filter(x=>!x).length,live=times.some(x=>x?.live);
   let total=finite(turn.durationMs)?turn.durationMs:finite(turn.startedAt)&&finite(turn.completedAt)?(turn.completedAt-turn.startedAt)*1000:null;
   return [total!=null?'任务用时 '+format(total):'',known.length?'思考用时 '+(known.some(x=>x.estimated)?'约 ':'')+format(known.reduce((a,x)=>a+x.ms,0)):'',live?'思考进行中':'',missing?`${missing} 段思考用时未保存`:''].filter(Boolean).join(' · ');
 }
 const api={reasoning,format,turnSummary};if(typeof module!=='undefined')module.exports=api;else window.KurumiTiming=api;
})();
