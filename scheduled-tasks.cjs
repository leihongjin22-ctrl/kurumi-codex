const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
function nextTime(task,now=Date.now()){
 if(task.cadence==='hours')return now+task.hours*3600000;
 const d=new Date(now+8*3600000),[h,m]=task.time.split(':').map(Number);
 let candidate=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),h-8,m);
 if(candidate<=now)candidate+=86400000;
 while(task.cadence==='weekdays'&&[0,6].includes(new Date(candidate+8*3600000).getUTCDay()))candidate+=86400000;
 return candidate;
}
class ScheduledTasks{
 constructor(file,execute,onChange=()=>{}){this.file=file;this.execute=execute;this.onChange=onChange;this.inflight=new Set();this.tasks=[];if(fs.existsSync(file)){const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.version!==1||!Array.isArray(data.tasks)||data.tasks.length>100)throw Error('定时任务文件无法读取，原文件已保留');this.tasks=data.tasks;for(const t of this.tasks){if(!Array.isArray(t.runs))throw Error('定时任务记录格式不支持');for(const r of t.runs)if(['starting','running'].includes(r.status)){r.status='unknown';r.error='客户端曾退出，请检查运行会话后恢复';t.enabled=false;}}this.persist();}}
 persist(){fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=this.file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify({version:1,tasks:this.tasks}),'utf8');fs.renameSync(temp,this.file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}this.onChange();}
 list(){return JSON.parse(JSON.stringify(this.tasks));}
 save(input){
  if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.length>120||typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>20000||typeof input.cwd!=='string'||!path.isAbsolute(input.cwd)||!fs.statSync(input.cwd).isDirectory()||typeof input.model!=='string'||!input.model||input.model.length>200||!['readonly','workspace'].includes(input.access)||!['daily','weekdays','hours'].includes(input.cadence)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)||!Number.isInteger(input.hours)||input.hours<1||input.hours>168)throw Error('请检查任务名称、工作目录、模型和时间');
  let old=input.id?this.tasks.find(t=>t.id===input.id):null;if(input.id&&!old)throw Error('任务已不存在');if(!old&&this.tasks.length>=100)throw Error('最多保存 100 个任务');
  const task={id:old?.id||randomUUID(),name:input.name.trim(),prompt:input.prompt.trim(),cwd:input.cwd,model:input.model,access:input.access,cadence:input.cadence,time:input.time,hours:input.hours,enabled:input.enabled===true,runs:old?.runs||[],updatedAt:Date.now()};task.nextAt=nextTime(task);
  const previous=this.tasks;this.tasks=old?this.tasks.map(t=>t.id===old.id?task:t):[...this.tasks,task];try{this.persist();}catch(e){this.tasks=previous;throw e;}return task;
 }
 toggle(id,enabled){const task=this.tasks.find(t=>t.id===id);if(!task||typeof enabled!=='boolean')throw Error('任务无效');const copy=JSON.parse(JSON.stringify(task));task.enabled=enabled;task.nextAt=nextTime(task);try{this.persist();}catch(e){Object.assign(task,copy);throw e;}return task;}
 remove(id){const task=this.tasks.find(t=>t.id===id);if(!task)throw Error('任务不存在');if(task.runs.some(r=>['starting','running'].includes(r.status)))throw Error('请先停止当前运行');const before=this.tasks;this.tasks=this.tasks.filter(t=>t.id!==id);try{this.persist();}catch(e){this.tasks=before;throw e;}}
 acknowledge(id){const t=this.tasks.find(t=>t.id===id);if(!t)throw Error('任务不存在');for(const r of t.runs)if(r.status==='unknown')r.status='checked';this.persist();}
 async run(id){
  const task=this.tasks.find(t=>t.id===id);if(!task)throw Error('任务不存在');if(this.inflight.has(id)||task.runs.some(r=>['starting','running','unknown'].includes(r.status)))throw Error('请先检查上一次运行；结果不明时请打开会话核对并解除锁定');
  this.inflight.add(id);const run={id:randomUUID(),startedAt:Date.now(),status:'starting',threadId:null};task.runs.unshift(run);task.runs=task.runs.slice(0,20);task.nextAt=nextTime(task);
  try{this.persist();}catch(e){task.runs=task.runs.filter(r=>r!==run);this.inflight.delete(id);throw e;}
  try{await this.execute({...task},threadId=>{run.threadId=threadId;run.status='running';this.persist();});if(run.status==='starting')run.status='running';}
  catch(e){run.status=e.code==='DELIVERY_UNKNOWN'||e.deliveryUnknown?'unknown':'failed';run.error=String(e.message).slice(0,1000);run.completedAt=Date.now();if(run.status==='unknown')task.enabled=false;}
  finally{this.inflight.delete(id);this.persist();}return run;
 }
 finish(threadId,status){for(const task of this.tasks){const run=task.runs.find(r=>r.threadId===threadId&&['starting','running'].includes(r.status));if(run){run.status=['completed','interrupted','failed'].includes(status)?status:'unknown';run.completedAt=Date.now();if(run.status==='unknown')task.enabled=false;this.persist();return;}}}
 disconnect(){for(const t of this.tasks)for(const r of t.runs)if(['starting','running'].includes(r.status)){r.status='unknown';r.error='连接中断，请核对会话';t.enabled=false;}this.persist();}
 async tick(now=Date.now()){for(const t of this.tasks){if(!t.enabled||t.nextAt>now||this.inflight.has(t.id)||t.runs.some(r=>['starting','running','unknown'].includes(r.status)))continue;if(now-t.nextAt>120000){t.runs.unshift({id:randomUUID(),status:'skipped',startedAt:now,error:'客户端未及时运行，已跳过错过的时间'});t.runs=t.runs.slice(0,20);t.nextAt=nextTime(t,now);this.persist();continue;}await this.run(t.id);}}
}
module.exports={ScheduledTasks,nextTime};
