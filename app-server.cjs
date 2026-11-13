const { spawn, execFileSync,execFile } = require('node:child_process');
const runFile=require('node:util').promisify(execFile);
const { EventEmitter } = require('node:events');
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');
const {version:clientVersion}=require('./package.json');
function requestError(code,message){const error=new Error(message);error.code=code;return error;}

function locateCodex() {
  const override=process.env.KURUMI_CODEX_EXE;if(override&&path.isAbsolute(override)&&fs.existsSync(override))return override;
  // Resolve the currently installed package on every launch: its versioned path changes on updates.
  try {
    const script="$p=Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1; if ($p) { Join-Path $p.InstallLocation 'app\\resources\\codex.exe' }";
    const installed=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:10000}).trim();
    if(installed&&fs.existsSync(installed))return installed;
  } catch {}
  try {
    const lines = execFileSync('where.exe', ['codex.exe'], { encoding:'utf8', windowsHide:true }).trim().split(/\r?\n/);
    const found = lines.find(p => fs.existsSync(p));
    if (found) return found;
  } catch {}
  const root = path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
  if (fs.existsSync(root)) {
    const dirs = fs.readdirSync(root, {withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>path.join(root,d.name,'codex.exe')).filter(p=>fs.existsSync(p));
    dirs.sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
    if (dirs[0]) return dirs[0];
  }
  throw new Error('未找到 Codex 命令行程序，请确认 Codex 已安装。');
}
async function locateCodexAsync(){
 const override=process.env.KURUMI_CODEX_EXE;if(override&&path.isAbsolute(override)&&fs.existsSync(override))return override;
 try{const script="$p=Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1; if ($p) { Join-Path $p.InstallLocation 'app\\resources\\codex.exe' }";const result=await runFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:10000});const found=result.stdout.trim();if(found&&fs.existsSync(found))return found;}catch{}
 try{const result=await runFile('where.exe',['codex.exe'],{encoding:'utf8',windowsHide:true,timeout:3000});const found=result.stdout.trim().split(/\r?\n/).find(file=>fs.existsSync(file));if(found)return found;}catch{}
 const root=path.join(process.env.LOCALAPPDATA||'','OpenAI','Codex','bin');if(fs.existsSync(root)){const files=fs.readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>path.join(root,d.name,'codex.exe')).filter(file=>fs.existsSync(file)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);if(files[0])return files[0];}throw Error('未找到 Codex，请先安装并登录原生 Codex，或在客户端配置中选择 codex.exe。');
}

class AppServer extends EventEmitter {
  constructor(options={}) { super(); this.seq=0; this.pending=new Map(); this.proc=null; this.requestTimeoutMs=options.requestTimeoutMs||60000; this.spawnCwd=options.cwd; this.spawnEnv=options.env; }
  async start() {
    if(this.proc) return;
    this.executable=locateCodex();this.proc=spawn(this.executable,['app-server'],{stdio:['pipe','pipe','pipe'],windowsHide:true,...(this.spawnCwd?{cwd:this.spawnCwd}:{}),...(this.spawnEnv?{env:this.spawnEnv}:{})});
    this.proc.on('error',e=>{this.failPending('Codex 服务无法启动或连接已中断');this.emit('status',{error:e.message});});
    const proc=this.proc;
    proc.stdin.on('error',()=>{});
    this.proc.on('exit',(code)=>{if(this.proc!==proc)return;this.proc=null;this.failPending('Codex 服务已退出');this.emit('status',{error:`Codex 服务已退出 (${code})，请重新连接并检查 Codex 更新。`});});
    readline.createInterface({input:this.proc.stdout}).on('line',line=>{try{this.dispatch(JSON.parse(line));}catch{}});
    this.proc.stderr.on('data',()=>{});
    try{await this.request('initialize',{clientInfo:{name:'kurumi_desktop',title:'Kurumi Codex',version:clientVersion},capabilities:{experimentalApi:true,requestAttestation:false}});}catch(e){this.stop();throw e;}
    this.notify('initialized',{});
    this.emit('status',{ready:true});
  }
  dispatch(msg){
    if(msg.id!==undefined && msg.method){this.emit('server-request',msg);return;}
    if(msg.id!==undefined){const p=this.pending.get(msg.id);if(p){this.pending.delete(msg.id);clearTimeout(p.timer);if(msg.error){const error=requestError('RPC_REJECTED',msg.error.message||'Codex 拒绝请求');error.rpcCode=msg.error.code;p.reject(error);this.emit('rpc-failure',{method:p.method,error});}else p.resolve(msg.result);}return;}
    if(msg.method)this.emit('event',msg);
  }
  failPending(message){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(requestError('DELIVERY_UNKNOWN',message));}this.pending.clear();}
  request(method,params,timeoutMs=this.requestTimeoutMs){ if(!this.proc) return Promise.reject(requestError('NOT_RUNNING','Codex 服务未运行'));const id=++this.seq;return new Promise((resolve,reject)=>{const fail=()=>{const p=this.pending.get(id);if(p){this.pending.delete(id);clearTimeout(p.timer);p.reject(requestError('DELIVERY_UNKNOWN','向 Codex 服务发送时连接中断，无法确认请求是否已执行。'));}};const timer=timeoutMs>0?setTimeout(()=>{this.pending.delete(id);reject(requestError('DELIVERY_UNKNOWN','Codex 服务响应超时，无法确认请求是否已执行。'));},timeoutMs):null;this.pending.set(id,{resolve,reject,timer,method});try{this.proc.stdin.write(JSON.stringify({id,method,params})+'\n',err=>{if(err)fail();});}catch{fail();}}); }
  notify(method,params){if(this.proc)this.proc.stdin.write(JSON.stringify({method,params})+'\n');}
  answer(id,result){if(this.proc)this.proc.stdin.write(JSON.stringify({id,result})+'\n');}
  reject(id,message,code=-32601){if(this.proc)this.proc.stdin.write(JSON.stringify({id,error:{code,message}})+'\n');}
  stop(){if(this.proc){const proc=this.proc;this.proc=null;this.failPending('Codex 服务已停止');proc.stdin.destroy();proc.stdout.destroy();proc.stderr.destroy();proc.kill();}}
}
module.exports={AppServer,locateCodex,locateCodexAsync};
