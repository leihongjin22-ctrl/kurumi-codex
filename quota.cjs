function normalizeQuota(data){
  if(!data||typeof data!=='object')throw Error('额度响应格式不支持');
  const window=value=>value&&typeof value.usedPercent==='number'&&Number.isFinite(value.usedPercent)?{remaining:Math.max(0,Math.min(100,100-value.usedPercent)),duration:typeof value.windowDurationMins==='number'?value.windowDurationMins:null,resetsAt:typeof value.resetsAt==='number'?value.resetsAt:null}:null;
  const map=data.rateLimitsByLimitId;
  const entries=map&&typeof map==='object'&&!Array.isArray(map)&&Object.keys(map).length?Object.entries(map):data.rateLimits?[[data.rateLimits.limitId||'codex',data.rateLimits]]:[];
  return {buckets:entries.slice(0,30).filter(([,v])=>v&&typeof v==='object').map(([id,v])=>({id:String(id).slice(0,100),name:String(v.limitName||id).slice(0,120),plan:typeof v.planType==='string'?v.planType:null,primary:window(v.primary),secondary:window(v.secondary),reached:typeof v.rateLimitReachedType==='string'?v.rateLimitReachedType:null,credits:v.credits?{unlimited:v.credits.unlimited===true,balance:typeof v.credits.balance==='string'?v.credits.balance.slice(0,100):null}:null})),resetCredits:Number.isInteger(data.rateLimitResetCredits?.availableCount)?Math.max(0,data.rateLimitResetCredits.availableCount):null,allowed:typeof data.ordinaryUsageAllowed==='boolean'?data.ordinaryUsageAllowed:null};
}
module.exports={normalizeQuota};
