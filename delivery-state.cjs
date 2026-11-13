function failureResult(error,requestAttempted,turnStarted=false){
  const definite=!requestAttempted||(!turnStarted&&['RPC_REJECTED','NOT_RUNNING'].includes(error?.code));
  return {ok:false,delivery:definite?'not_sent':'unknown',message:error?.message||'请求失败'};
}
module.exports={failureResult};
