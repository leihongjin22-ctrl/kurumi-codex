const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const {promisify}=require('node:util'),{execFile}=require('node:child_process');
const run=promisify(execFile),{locateCodexAsync}=require('./app-server.cjs');
const SYNC_METHODS=new Set(['initialize','model/list','thread/list','thread/read','thread/resume','thread/turns/list','threadSection/list','remoteControl/status/read','account/rateLimits/read']);
function kind(error){const message=String(error?.message||'');if(/quota|rate.?limit|usage.limit|额度|429/i.test(message))return 'quota';if(/401|403|unauth|authentication|login|MFA|token.*expired|sign.in/i.test(message))return 'auth';if(/thread.*not found|does not exist|invalid.*thread.?id|not loaded|file.*not found/i.test(message))return 'resource';if(error?.rpcCode===-32601||error?.rpcCode===-32602||/method not found|unknown method|invalid params|missing.*field|unknown.*field|deserializ|响应格式不支持|缺少必要/i.test(message))return 'contract';if(/timeout|timed.out|network|connection|disconnected|超时|网络|连接|退出/i.test(message))return 'network';return 'unknown';}
const clean=value=>String(value||'未知').replace(/[^a-zA-Z0-9._+ -]/g,'').slice(0,140)||'unknown';
const id=stamp=>createHash('sha256').update(String(stamp)).digest('hex').slice(0,20);
async function probeBuild(){const executable=await locateCodexAsync(),stat=await fs.promises.stat(executable);const result=await run(executable,['--version'],{windowsHide:true,timeout:10000,maxBuffer:65536});const codex=clean(result.stdout.trim());return {codex,nativeStamp:`${codex}|${stat.size}|${stat.mtimeMs}`,installStamp:`${executable}|${stat.size}|${stat.mtimeMs}`};}
function repairPrompt(root,report){
 const failures=(report.checks||[]).filter(c=>c.kind==='contract'||c.name==='协议结构'&&c.status==='error').map(c=>String(c.name).slice(0,80));
 return `请修复 Kurumi Codex 皮肤客户端与新版 Codex 的兼容问题。\n客户端目录：${root}\n客户端版本：${clean(report.client)}；Codex：${clean(report.previousCodex)} → ${clean(report.codex)}。\n失败接口/检查：${failures.join('、')||'同步接口兼容检查'}。\n先读当前目录的 REPAIR.md 和 package.json；对照本机 codex app-server 的当前协议，修复客户端同步、消息和相关界面。保留皮肤、草稿、标签、附件、权限与审批；不要修改 WindowsApps 原生程序、读取登录凭据或自动重发旧任务。修改前备份；先跑不调用模型的诊断与回归，成功后更新版本和分发包，说明改动及验证。不要自动发送测试模型消息，也不要发布到远程仓库。`;
}
function repairLink(root,report){return 'codex://new?'+new URLSearchParams({path:root,prompt:repairPrompt(root,report)}).toString();}
class UpdateGuard{
 constructor({directory,root,notify=()=>{},open=()=>{},config=()=>({autoRepair:true}),inspect=probeBuild}){
  this.file=path.join(directory,'compatibility-watch.json');this.root=root;this.notify=notify;this.open=open;this.config=config;this.inspect=inspect;this.busy=false;this.checkedAt=0;this.timer=null;
  this.saved={version:1,lastGood:null,opened:[]};try{const v=JSON.parse(fs.readFileSync(this.file,'utf8'));if(v.version===1&&Array.isArray(v.opened))this.saved={...this.saved,...v,opened:v.opened.slice(-20)};}catch{}
  if(!this.saved.lastGood)try{const p=JSON.parse(fs.readFileSync(path.join(directory,'checked-version.json'),'utf8'));if(p.codex&&p.fingerprint)this.saved.lastGood={codex:clean(p.codex),nativeStamp:p.nativeStamp||p.fingerprint.split('|').slice(0,3).join('|')};}catch{}
  this.state={issue:null,updatePending:false,lastGood:this.saved.lastGood?.codex||null,autoRepair:this.config().autoRepair!==false};
 }
 snapshot(){return {...this.state,autoRepair:this.config().autoRepair!==false};}
 publish(){this.notify(this.snapshot());}
 save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=this.file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(this.saved),'utf8');fs.renameSync(temp,this.file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
 async accept(report){
  if(!report.nativeStamp||report.codex==='未知')return this.snapshot();
  const currentGood=this.saved.lastGood,previous=currentGood?.nativeStamp===report.nativeStamp&&this.saved.upgradeTo===report.nativeStamp?this.saved.upgradeFrom:currentGood,changed=!!previous&&previous.nativeStamp!==report.nativeStamp;
  const contract=(report.checks||[]).filter(c=>c.kind==='contract'&&c.status!=='ok'||c.name==='协议结构'&&c.status==='error');
  const healthy=['Codex 版本','协议结构','模型列表','会话列表'].every(name=>report.checks?.some(c=>c.name===name&&c.status==='ok'));
  if(healthy&&!contract.length){if(currentGood&&currentGood.nativeStamp!==report.nativeStamp){this.saved.upgradeFrom=currentGood;this.saved.upgradeTo=report.nativeStamp;}this.saved.lastGood={codex:clean(report.codex),nativeStamp:report.nativeStamp};this.state={...this.state,issue:null,updatePending:false,lastGood:clean(report.codex)};this.save();this.publish();return this.snapshot();}
  if(changed&&contract.length){
   const issueId=id(report.nativeStamp);this.state.issue={id:issueId,client:clean(report.client),codex:clean(report.codex),previousCodex:previous.codex,checks:contract.map(c=>({name:String(c.name).slice(0,80),kind:'contract',status:c.status})),nativeStamp:report.nativeStamp,opened:this.saved.opened.includes(issueId),openError:''};this.state.updatePending=false;this.publish();
   if(this.config().autoRepair!==false&&!this.saved.opened.includes(issueId))await this.openRepair(true);
  }
  return this.snapshot();
 }
 async inspectCached(){if(this.probePromise)return this.probePromise;if(this.build&&Date.now()-this.buildAt<30000)return this.build;this.probePromise=this.inspect().then(build=>{this.build=build;this.buildAt=Date.now();return build;}).finally(()=>{this.probePromise=null;});return this.probePromise;}
 async failure(method,error,client){if(!SYNC_METHODS.has(method)||kind(error)!=='contract')return;try{const build=await this.inspectCached();await this.accept({...build,client,checks:[{name:method,status:'error',kind:'contract'}]});}catch{}}
 async poll(){if(this.busy)return;this.busy=true;this.checkedAt=Date.now();try{const build=await this.inspect();if(this.saved.lastGood&&build.nativeStamp!==this.saved.lastGood.nativeStamp&&!this.state.issue){this.state.updatePending=true;this.state.installedCodex=build.codex;this.publish();}}catch{}finally{this.busy=false;}}
 start(){if(this.timer)return;this.timer=setInterval(()=>this.poll(),120000);this.timer.unref?.();}
 stop(){clearInterval(this.timer);this.timer=null;}
 async openRepair(automatic=false){const issue=this.state.issue;if(!issue)throw Error('当前没有已确认的更新兼容故障');if(automatic&&this.saved.opened.includes(issue.id))return this.snapshot();
  if(!this.saved.opened.includes(issue.id)){this.saved.opened.push(issue.id);this.saved.opened=this.saved.opened.slice(-20);this.save();}issue.opened=true;issue.openError='';this.publish();
  try{await this.open(repairLink(this.root,issue));}catch{issue.openError='无法通过 codex:// 打开原生应用，请确认原生 Codex 已安装；可复制下方修复提示词。';this.publish();throw Error(issue.openError);}return this.snapshot();
 }
 draft(){if(!this.state.issue)throw Error('当前没有更新兼容故障');return {prompt:repairPrompt(this.root,this.state.issue),path:this.root};}
}
module.exports={UpdateGuard,kind,probeBuild,repairPrompt,repairLink};
