const path=require('node:path');
function policyFor(mode,cwd){
  if(typeof cwd!=='string'||!path.isAbsolute(cwd))throw Error('项目目录无效');
  if(mode==='readonly')return {sandbox:'read-only',sandboxPolicy:{type:'readOnly'},approvalPolicy:'on-request'};
  if(mode==='workspace')return {sandbox:'workspace-write',sandboxPolicy:{type:'workspaceWrite',writableRoots:[cwd],networkAccess:false},approvalPolicy:'on-request'};
  if(mode==='full')return {sandbox:'danger-full-access',sandboxPolicy:{type:'dangerFullAccess'},approvalPolicy:'on-request'};
  throw Error('权限模式无效');
}
function selectModel(models,options){
  const model=models.find(x=>x.model===options.model);if(!model)throw Error('模型列表已变化，请重新选择模型。');
  const supported=(model.supportedReasoningEfforts||[]).map(x=>x.reasoningEffort);
  if(options.effort&&!supported.includes(options.effort))throw Error('推理强度不适用于当前模型。');
  return {model:model.model,...(options.effort?{effort:options.effort}:{})};
}
module.exports={policyFor,selectModel};
