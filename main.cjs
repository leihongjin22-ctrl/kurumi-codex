const {app,BrowserWindow,ipcMain,dialog,shell,clipboard}=require('electron');
if(app.requestSingleInstanceLock&&!app.requestSingleInstanceLock()){app.quit();process.exit(0);}
app.on('second-instance',()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();}});
const path=require('node:path');
const fs=require('node:fs');
const {startupLogger}=require('./startup-log.cjs');
const startupLog=startupLogger(()=>path.join(app.getPath('userData'),'logs'));
process.on('uncaughtExceptionMonitor',error=>startupLog('uncaught-exception',{name:error?.name,code:error?.code,frames:String(error?.stack||'').split('\n').slice(1,5)}));
const {randomUUID}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {AppServer}=require('./app-server.cjs');
const {policyFor,selectModel}=require('./session-policy.cjs');
const {makeInput}=require('./attachment-input.cjs');
const {failureResult}=require('./delivery-state.cjs');
const {createBrowserManager}=require('./browser-manager.cjs');
const {loadFiles,preview,saveClipboardImage,IMAGE_EXT}=require('./attachments.cjs');
const {DEFAULTS: DEFAULT_PREFERENCES, normalize: normalizePreferences, load: loadPreferences, save: savePreferences} = require('./preferences.cjs');
const recovery = require('./session-recovery.cjs');
const {diagnose} = require('./diagnostics.cjs');
const threadSources = require('./thread-sources.cjs');
const {version:clientVersion}=require('./package.json');
const {listWorktrees,addWorktree}=require('./workspace-tools.cjs');
const {locateCodex}=require('./app-server.cjs');
const {execFile,spawn}=require('node:child_process');
const {promisify}=require('node:util');
const {StringDecoder}=require('node:string_decoder');
const {localVideo}=require('./local-video.cjs');
const {localFile,textTypes,currentPluginFile}=require('./local-file.cjs');
const {openHtmlPreview}=require('./html-preview.cjs');
const {normalizeQuota}=require('./quota.cjs');
const {ScheduledTasks}=require('./scheduled-tasks.cjs');
const {RemoteControl}=require('./remote-control.cjs');
const {RemoteThreads}=require('./remote-threads.cjs');
const clientConfig=require('./client-config.cjs');
const {UpdateGuard}=require('./update-guard.cjs');
const {copyPublicClient}=require('./distribution.cjs');
let settings={...clientConfig.DEFAULTS},settingsError='',updateGuard=null,existingProfile=false;
function updates(){if(!updateGuard)updateGuard=new UpdateGuard({directory:app.getPath('userData'),root:__dirname,notify:state=>send('compatibility-update',state),open:url=>shell.openExternal(url),config:()=>settings});return updateGuard;}
let remoteController=null,remoteWatcher=null,remoteInitError='';
function remote(){if(!remoteController)remoteController=new RemoteControl(path.join(app.getPath('userData'),'remote-settings.json'),state=>send('remote-status',state));return remoteController;}
let scheduledTasks=null,scheduledTimer=null;
function scheduler(){
 if(scheduledTasks)return scheduledTasks;
 scheduledTasks=new ScheduledTasks(path.join(app.getPath('userData'),'scheduled-tasks.json'),async(task,onThread)=>{
  if(!serverReady||!server||!diagnosticReport||diagnosticReport.checks.some(c=>c.status==='error'))throw Error('服务或兼容检查尚未就绪');
  if(!fsExistsDir(task.cwd)||!['readonly','workspace'].includes(task.access))throw Error('任务目录或权限无效');
  const origin=server;const list=await origin.request('model/list',{limit:100,includeHidden:false});const choice=selectModel(list.data||[],{model:task.model});const policy=policyFor(task.access,task.cwd);
  const created=await origin.request('thread/start',{cwd:task.cwd,approvalPolicy:policy.approvalPolicy,sandbox:policy.sandbox});const id=created.thread.id;loadedThreads.add(id);onThread(id);
  await origin.request('thread/name/set',{threadId:id,name:'定时 · '+task.name}).catch(()=>{});
  pendingStarts.add(id);try{const result=await origin.request('turn/start',{threadId:id,input:[{type:'text',text:task.prompt,text_elements:[]}],...choice,cwd:task.cwd,approvalPolicy:policy.approvalPolicy,sandboxPolicy:policy.sandboxPolicy});const turnId=result.turn?.id;if(turnId&&!finishedTurns.has(turnId)){activeTurns.set(id,turnId);if(pendingInterrupts.delete(id))await origin.request('turn/interrupt',{threadId:id,turnId});}}finally{pendingStarts.delete(id);}
 },()=>send('scheduled-update',{}));
 scheduledTimer=setInterval(()=>{if(serverReady)scheduledTasks.tick().catch(e=>send('codex-status',{warning:'定时任务保存或调度失败：'+e.message}));},15000);scheduledTimer.unref();return scheduledTasks;
}
const runFile=promisify(execFile);

let win;
let browser;
let quotaRequest=null,quotaEpoch=0;
let server;
let serverReady=false;
let serverError=null;
let cwd=path.dirname(__dirname);
let activeThread=null;
const activeTurns=new Map();
const pendingStarts=new Set();
const pendingSteers=new Set();
const pendingInterrupts=new Set();
const finishedTurns=new Set();
const loadedThreads=new Set();
let selectedAccess='workspace';
const tabAccess=new Map();
const tabAccessPending=new Set();
let preferences={...DEFAULT_PREFERENCES};
let preferencesPath='';
let pendingFullRestore=false;
let models=[];
let hasDrafts=false;
let diagnosticReport=null;
let diagnosticRun=null;
let terminal=null;
let knownSkills=new Map();
let knownPlugins=new Map();
const startedItems=new Map();
const uncertainThreads=new Set();
const checkedThreads=new Set();
const historicalImages=new Set();
const pendingQuestions=new Map();
const pendingApprovals=new Map();
const send=(name,data)=>{if(win&&!win.isDestroyed())win.webContents.send(name,data)};
const fsExistsDir=p=>{try{return fs.statSync(p).isDirectory()}catch{return false}};

function authorizeImages(turns){for(const turn of turns||[])for(const item of turn.items||[])if(item.type==='userMessage')for(const part of item.content||[])if(part.type==='localImage'&&typeof part.path==='string'&&path.isAbsolute(part.path))historicalImages.add(part.path);}

function createWindow(){
  win=new BrowserWindow({width:1500,height:950,minWidth:850,minHeight:620,backgroundColor:'#100b11',title:'Kurumi Codex',autoHideMenuBar:true,icon:path.join(__dirname,'assets','kurumi-codex-icon.ico'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  browser=createBrowserManager(win,send);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  const mainUrl=pathToFileURL(path.join(__dirname,'index.html')).href;
  win.webContents.on('will-navigate',(event,url)=>{if(url!==mainUrl)event.preventDefault();});
  win.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  win.on('show',()=>startupLog('window-shown'));
  win.on('unresponsive',()=>startupLog('window-unresponsive'));
  win.on('focus',()=>{if(updateGuard&&Date.now()-updateGuard.checkedAt>30000)updateGuard.poll();});
  win.webContents.on('render-process-gone',(_event,details)=>startupLog('renderer-exited',{reason:details.reason,exitCode:details.exitCode}));
  win.on('close',event=>{if(activeTurns.size||pendingStarts.size||hasDrafts||terminal?.running||terminal?.mode==='system'){const message=[activeTurns.size||pendingStarts.size?'关闭客户端会中断正在运行的任务；重启后需要核对历史。':'',terminal?.running||terminal?.mode==='system'?'关闭客户端会结束终端会话，请检查命令执行结果。':'',hasDrafts?'草稿、附件和审核反馈会尝试保存在本机；恢复时可能需要重新选择已移动的附件。':''].filter(Boolean).join('\n');const answer=dialog.showMessageBoxSync(win,{type:'question',title:'确认关闭客户端',message,buttons:['继续使用','关闭客户端'],defaultId:0,cancelId:0});if(answer===0){event.preventDefault();return;}}browser?.dispose();});
  win.loadFile(path.join(__dirname,'index.html'));
  win.webContents.on('did-finish-load',async()=>{
    startupLog('ui-loaded',{version:clientVersion});
    if(server){send('codex-status',{ready:serverReady});return;}
    try{await startServer();}catch(e){serverReady=false;serverError=e.message;diagnosticReport={checkedAt:new Date().toISOString(),client:clientVersion,electron:process.versions.electron||'未知',codex:'未知',changed:null,checks:[{name:'服务连接',status:'error',message:'Codex 服务启动或协议握手失败，请检查安装和更新。'}]};send('diagnostics-update',diagnosticReport);send('codex-status',{error:e.message})}
  });
}

async function startServer(){
  diagnosticReport=null;
  const serverCwd=path.join(app.getPath('userData'),'server-work');fs.mkdirSync(serverCwd,{recursive:true});
  const serverEnv={...process.env};for(const key of Object.keys(serverEnv))if(key.toUpperCase()==='CODEX_WINDOWS_REGISTERED_CORE')delete serverEnv[key];
  server=new AppServer({cwd:serverCwd,env:serverEnv});
  const origin=server;
  server.on('event',event=>{
    if(server!==origin)return;
    remoteController?.event(event);remoteWatcher?.event(event);
    if(event.method==='item/completed'&&event.params?.item?.type==='userMessage')authorizeImages([{items:[event.params.item]}]);
    if(event.method==='turn/completed'&&scheduledTasks)try{scheduledTasks.finish(event.params?.threadId,event.params?.turn?.status);}catch(e){send('codex-status',{warning:'定时任务记录保存失败：'+e.message});}
    if(event.method==='account/updated')quotaEpoch++;
    if(event.method==='account/rateLimits/updated'){try{send('quota-update',{...normalizeQuota(event.params),updatedAt:Date.now(),partial:true});}catch{}}
    const threadId=event.params?.threadId,turnId=event.params?.turn?.id;
    if(threadId&&turnId&&event.method==='turn/started'&&!finishedTurns.has(turnId)){activeTurns.set(threadId,turnId);if(pendingInterrupts.delete(threadId))origin.request('turn/interrupt',{threadId,turnId}).catch(e=>send('codex-status',{warning:'停止任务失败：'+e.message}));}
    if(threadId&&event.method==='turn/completed'){if(turnId){finishedTurns.add(turnId);if(finishedTurns.size>100)finishedTurns.delete(finishedTurns.values().next().value);}if(!turnId||activeTurns.get(threadId)===turnId)activeTurns.delete(threadId);pendingInterrupts.delete(threadId);}
    if(event.method==='item/started'&&event.params?.item?.id)startedItems.set(event.params.item.id,event.params.item);
    if(event.method==='item/completed'&&event.params?.item?.id)startedItems.delete(event.params.item.id);
    if(event.method==='serverRequest/resolved'){
      for(const [token,request] of pendingQuestions)if(request.origin===origin&&request.id===event.params?.requestId){pendingQuestions.delete(token);send('user-input-resolved',{token});}
      for(const [token,request] of pendingApprovals)if(request.origin===origin&&request.id===event.params?.requestId){pendingApprovals.delete(token);send('approval-resolved',{token});}
    }
    send('codex-event',event);
  });
  server.on('status',s=>{if(s.ready){serverReady=true;serverError=null;}if(s.error){if(terminal?.origin===origin){send('terminal-exit',{id:terminal.id,error:'服务已断开；运行中的命令可能已执行，请先核对结果'});terminal=null;}for(const [token,request] of pendingQuestions)if(request.origin===origin){pendingQuestions.delete(token);send('user-input-resolved',{token});}for(const [token,request] of pendingApprovals)if(request.origin===origin){pendingApprovals.delete(token);send('approval-resolved',{token});}for(const threadId of new Set([...activeTurns.keys(),...pendingStarts])){uncertainThreads.add(threadId);checkedThreads.delete(threadId);}serverReady=false;serverError=s.error;}send('codex-status',s)});
  server.on('server-request',msg=>handleRequest(msg,origin));
  server.on('rpc-failure',({method,error})=>{updates().failure(method,error,clientVersion).catch(()=>{});});
  server.on('status',state=>{if(state.error){remoteController?.detach();remoteWatcher?.stop();}});
  server.on('status',state=>{if(state.error&&scheduledTasks)try{scheduledTasks.disconnect();}catch(e){send('codex-status',{warning:'定时任务断线记录失败：'+e.message});}});
  await server.start();
  serverReady=true;
  startupLog('service-ready');
  try{remoteInitError='';remote().attach(origin).catch(()=>{});remoteWatcher?.stop();remoteWatcher=new RemoteThreads(origin,{enabled:()=>remoteController?.enabled&&remoteController.state.status==='connected'&&!remoteController.state.offline,loaded:loadedThreads,pending:pendingStarts,notify:data=>{if(server===origin){authorizeImages(data.turns);send('remote-task',data);}},active:(id,turnId)=>{if(server===origin){if(turnId)activeTurns.set(id,turnId);else activeTurns.delete(id);}}});}catch(e){remoteInitError=e.message;send('remote-status',{offline:true,status:'errored',enabled:false,error:e.message});}
  try{scheduler();}catch(e){send('codex-status',{warning:'定时任务数据无法读取：'+e.message});}
  send('codex-status',{ready:true});
  runDiagnostics().catch(()=>{});
}

async function runDiagnostics(){
  if(diagnosticRun)return diagnosticRun;
  if(!serverReady||!server)throw Error('Codex 服务尚未连接');
  const origin=server;
  diagnosticRun=diagnose(origin,app.getPath('userData')).catch(()=>({checkedAt:new Date().toISOString(),client:clientVersion,electron:process.versions.electron||'未知',codex:'未知',changed:null,checks:[{name:'兼容检查',status:'error',message:'兼容检查未能完成，已暂停发送'}]})).then(async report=>{if(server===origin){diagnosticReport=report;send('diagnostics-update',report);try{await updates().accept(report);}catch{}}return report;}).finally(()=>{diagnosticRun=null;});
  return diagnosticRun;
}

async function handleRequest(msg,origin){
  const p=msg.params||{};
  if(msg.method==='item/tool/requestUserInput'){
    const questions=p.questions;
    if(!Array.isArray(questions)||!questions.length||questions.length>10||JSON.stringify(questions).length>24000||questions.some(q=>!q||typeof q.id!=='string'||!q.id||q.id.length>200||typeof q.question!=='string'||(q.options!=null&&!Array.isArray(q.options)))||new Set(questions.map(q=>q.id)).size!==questions.length){origin.reject(msg.id,'交互问题格式不受支持');send('codex-status',{warning:'交互问题格式不受支持，已拒绝请求。'});return;}
    const token=randomUUID();pendingQuestions.set(token,{origin,id:msg.id,questions,threadId:p.threadId});send('user-input-request',{token,threadId:p.threadId,questions});return;
  }
  if(msg.method==='item/permissions/requestApproval'){
    const perms=p.permissions;const detail=JSON.stringify({reason:p.reason,cwd:p.cwd,permissions:perms},null,2);
    if(!perms||typeof perms!=='object'||Object.keys(perms).some(k=>!['network','fileSystem'].includes(k))||(!perms.network&&!perms.fileSystem)||detail.length>200000){origin.answer(msg.id,{permissions:{},scope:'turn'});send('codex-status',{warning:'权限申请详情不完整或不受支持，已拒绝。'});return;}
    const token=randomUUID();pendingApprovals.set(token,{origin,id:msg.id,type:'permissions',perms});send('approval-request',{token,threadId:p.threadId,title:'Codex 请求额外权限',message:'允许后仅对当前任务生效。请检查全部权限详情。',detail,allowLabel:'允许当前任务'});return;
  }
  if(['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(msg.method)){
    const item=startedItems.get(p.itemId)||{};
    const desc=p.networkApprovalContext?'网络访问':msg.method.includes('commandExecution')?'命令执行':'文件修改';
    const changes=Array.isArray(item.changes)?item.changes.map(change=>`文件路径：${change.path||''}\n操作：${JSON.stringify(change.kind||{})}\n差异：\n${change.diff||''}`).join('\n\n'):null;
    const detail=[p.reason,p.command||item.command,p.networkApprovalContext&&JSON.stringify(p.networkApprovalContext),p.additionalPermissions&&`额外权限：${JSON.stringify(p.additionalPermissions,null,2)}`,p.cwd&&`目录：${p.cwd}`,p.grantRoot&&`授权目录：${p.grantRoot}`,changes].filter(Boolean).join('\n\n');
    const missingAction=msg.method.includes('fileChange')?(!Array.isArray(item.changes)||!item.changes.length||item.changes.some(change=>!change||typeof change.path!=='string'||typeof change.diff!=='string')):!(p.command||item.command||p.networkApprovalContext);
    if(missingAction||!detail||detail.length>200000||(Array.isArray(p.availableDecisions)&&!p.availableDecisions.includes('accept'))){origin.answer(msg.id,{decision:'decline'});send('codex-status',{warning:'审批详情无法完整显示或不支持此审批方式，已拒绝请求。'});return;}
    const files=msg.method.includes('fileChange')?item.changes.map(change=>({path:change.path,kind:change.kind,diff:change.diff})):null;
    const token=randomUUID();pendingApprovals.set(token,{origin,id:msg.id,type:'decision'});send('approval-request',{token,threadId:p.threadId,title:'Codex 请求批准',message:files?'请审核全部文件变更；批准将应用整个请求。':desc,detail,files,allowLabel:files?'允许全部文件变更一次':'允许一次'});
  }else{origin.reject(msg.id,`此客户端尚不支持请求 ${msg.method}`);send('codex-status',{warning:`暂不支持请求：${msg.method}`});}
}

ipcMain.handle('current-folder',()=>cwd);
ipcMain.handle('status',()=>({ready:serverReady,error:serverError}));
ipcMain.handle('diagnostics',()=>diagnosticReport);
ipcMain.handle('run-diagnostics',()=>runDiagnostics());
ipcMain.handle('load-session',()=>{const value=recovery.load(path.join(app.getPath('userData'),'session-recovery.json'));for(const tab of value?.tabs||[])if(tab.threadId&&tab.uncertain)uncertainThreads.add(tab.threadId);return value;});
function saveSession(value){recovery.save(path.join(app.getPath('userData'),'session-recovery.json'),value);return true;}
ipcMain.handle('save-session',(_e,value)=>saveSession(value));
ipcMain.on('save-session-sync',(event,value)=>{try{saveSession(value);event.returnValue={ok:true};}catch(error){event.returnValue={ok:false,error:error.message};}});
ipcMain.handle('get-preferences',async()=>{
  const fullAccessWasDowngraded=pendingFullRestore;
  if(pendingFullRestore){pendingFullRestore=false;selectedAccess='workspace';preferences=normalizePreferences({...preferences,access:'workspace'});}
  return {...preferences,access:selectedAccess,fullAccessWasDowngraded};
});
ipcMain.handle('save-preferences',(_e,patch)=>{
  if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('偏好设置格式无效');
  const next={...preferences};
  for(const key of ['model','effort','mode']){if(Object.prototype.hasOwnProperty.call(patch,key))next[key]=patch[key];}
  if(Object.prototype.hasOwnProperty.call(patch,'access')){
    if(!['readonly','workspace','full'].includes(patch.access)||patch.access!==selectedAccess)throw Error('权限状态尚未生效');
    next.access=patch.access;
  }
  preferences=normalizePreferences(next);
  if(preferencesPath)savePreferences(preferencesPath,preferences);
  return preferences;
});
ipcMain.handle('reconnect',async()=>{if(server?.proc)throw Error('服务进程仍在运行，请等待当前任务完成后再处理。');activeThread=null;activeTurns.clear();pendingStarts.clear();pendingInterrupts.clear();finishedTurns.clear();loadedThreads.clear();startedItems.clear();server=null;await startServer();return {ready:true};});
ipcMain.on('draft-state',(event,value)=>{if(event.sender===win.webContents)hasDrafts=!!value;});
ipcMain.handle('confirm-close-tab',async()=>{const r=await dialog.showMessageBox(win,{type:'question',title:'关闭标签页',message:'此标签有未发送草稿、附件、审核反馈或待核对状态，关闭后将丢失。',buttons:['继续编辑','关闭标签页'],defaultId:0,cancelId:0});return r.response===1;});
ipcMain.handle('choose-folder',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openDirectory']});if(!r.canceled&&r.filePaths[0]){cwd=r.filePaths[0];return {cwd,changed:true};}return {cwd,changed:false};});
ipcMain.handle('models',async()=>{if(!server)throw Error('服务尚未就绪');let cursor=null;models=[];do{const r=await server.request('model/list',{limit:100,includeHidden:false,...(cursor?{cursor}:{})});models.push(...(r.data||[]).filter(x=>!x.hidden));cursor=r.nextCursor||null;}while(cursor&&models.length<500);return models.map(m=>({id:m.model,displayName:m.displayName||m.model,isDefault:!!m.isDefault,defaultReasoningEffort:m.defaultReasoningEffort,efforts:(m.supportedReasoningEfforts||[]).map(e=>e.reasoningEffort)}));});
ipcMain.handle('set-access',async(_e,mode)=>{if(!['readonly','workspace','full'].includes(mode))throw Error('权限模式无效');if(mode==='full'&&selectedAccess!=='full'){const answer=await dialog.showMessageBox(win,{type:'warning',title:'确认完全访问',message:'完全访问允许 Codex 在本机整个文件系统中读写并运行命令。',detail:'命令或文件更改仍可能需要单独批准。此选择会记住，下次启动恢复完全访问时仍需再次确认。',buttons:['取消','启用完全访问'],defaultId:0,cancelId:0});if(answer.response!==1)return selectedAccess;}const next=normalizePreferences({...preferences,access:mode});if(preferencesPath)savePreferences(preferencesPath,next);preferences=next;selectedAccess=mode;return selectedAccess;});
function checkedTabAccess(id){if(typeof id!=='string'||!/^tab-[0-9]+$/.test(id)||!tabAccess.has(id)||tabAccessPending.has(id))throw Error('当前标签权限尚未就绪');return tabAccess.get(id);}
ipcMain.handle('set-tab-access',async(_e,id,mode)=>{if(typeof id!=='string'||!/^tab-[0-9]+$/.test(id)||!['readonly','workspace','full'].includes(mode))throw Error('标签或权限无效');if(tabAccessPending.has(id))throw Error('该标签权限正在更改');const previous=tabAccess.get(id)||'workspace';tabAccessPending.add(id);try{if(mode==='full'&&previous!=='full'){const answer=await dialog.showMessageBox(win,{type:'warning',title:'确认此标签的完全访问',message:'此标签的任务将允许 Codex 在本机整个文件系统中读写并运行命令。',detail:'该选择仅作用于此标签。重启客户端后完全访问需要重新确认。',buttons:['取消','启用完全访问'],defaultId:0,cancelId:0});if(answer.response!==1){tabAccess.set(id,previous);return previous;}}tabAccess.set(id,mode);return mode;}finally{tabAccessPending.delete(id);}});
ipcMain.handle('release-tab',(_e,id)=>{if(tabAccessPending.has(id))throw Error('该标签权限正在更改');tabAccess.delete(id);return true;});
ipcMain.handle('new-thread',async(_e,folder,tabId)=>{if(!server)throw Error('服务尚未就绪');const targetFolder=typeof folder==='string'&&fsExistsDir(folder)?folder:cwd;const policy=policyFor(checkedTabAccess(tabId),targetFolder);const r=await server.request('thread/start',{cwd:targetFolder,approvalPolicy:policy.approvalPolicy,sandbox:policy.sandbox});loadedThreads.add(r.thread.id);activeThread=r.thread.id;return {id:r.thread.id,cwd:targetFolder};});
ipcMain.handle('list-threads',async(_e,options={})=>{if(!server)throw Error('服务尚未就绪');if(options.cursor!=null&&(typeof options.cursor!=='string'||options.cursor.length>=4000))throw Error('对话列表游标无效');const cursor=options.cursor||null;const search=typeof options.search==='string'?options.search.trim().slice(0,200):'';const r=await server.request('thread/list',{limit:30,sortKey:'updated_at',sourceKinds:threadSources,modelProviders:[],archived:!!options.archived,...(cursor?{cursor}:{}),...(search?{searchTerm:search}:{})});return {data:(r.data||[]).map(t=>({id:t.id,name:t.name||t.preview||'未命名对话',preview:t.preview||t.name||'',cwd:t.cwd||'',updatedAt:t.updatedAt||0,status:t.status?.type||'',section:t.section||null})),nextCursor:r.nextCursor||null};});
ipcMain.handle('list-sections',async()=>{if(!server)throw Error('服务尚未就绪');const all=[];let cursor=null;do{const r=await server.request('threadSection/list',{limit:100,...(cursor?{cursor}:{})});all.push(...(r.data||[]));cursor=r.nextCursor||null;}while(cursor&&all.length<500);return all.map(s=>({id:s.id,name:s.name}));});
ipcMain.handle('create-section',async(_e,name)=>{if(typeof name!=='string'||!name.trim()||name.length>100)throw Error('分组名称无效');return server.request('threadSection/create',{name:name.trim()});});
ipcMain.handle('move-thread-section',async(_e,id,sectionId)=>{if(typeof id!=='string'||!id||id.length>256||(sectionId!==null&&(typeof sectionId!=='string'||!sectionId||sectionId.length>256)))throw Error('对话或分组无效');return server.request('thread/section/move',{threadId:id,sectionId});});
ipcMain.handle('rename-thread',async(_e,id,name)=>{if(typeof id!=='string'||!id||id.length>256||typeof name!=='string'||!name.trim()||name.length>200)throw Error('对话名称无效');return server.request('thread/name/set',{threadId:id,name:name.trim()});});
ipcMain.handle('archive-thread',async(_e,id,archived)=>{if(typeof id!=='string'||!id||id.length>256||typeof archived!=='boolean')throw Error('对话无效');if(activeTurns.has(id)||pendingStarts.has(id))throw Error('请等待任务完成后再归档');return server.request(archived?'thread/archive':'thread/unarchive',{threadId:id});});
ipcMain.handle('preview-thread',async(_e,id)=>{if(typeof id!=='string'||!id||id.length>256)throw Error('对话 ID 无效');const r=await server.request('thread/turns/list',{threadId:id,limit:50,sortDirection:'desc',itemsView:'full'});const turns=(r.data||[]).reverse();authorizeImages(turns);return {turns,nextCursor:r.nextCursor||null};});
ipcMain.handle('select-thread',async(_e,id,cwdIn)=>{if(typeof id!=='string'||!id||id.length>256)throw Error('对话 ID 无效');activeThread=id;if(typeof cwdIn==='string'&&fsExistsDir(cwdIn))cwd=cwdIn;return {id:activeThread,cwd};});
ipcMain.handle('resume-thread',async(_e,id)=>{
  if(typeof id!=='string'||id.length>256)throw Error('对话 ID 无效');
  let r,branched=false;
  if(loadedThreads.has(id)){const read=await server.request('thread/read',{threadId:id,includeTurns:true});r={thread:read.thread};}
  else{
    try{r=await server.request('thread/resume',{threadId:id});}
    catch(e){
      if(/active writer|already.*active|正在.*运行/i.test(e.message)){
        const choice=await dialog.showMessageBox(win,{type:'question',title:'对话正在其他窗口使用',message:'这个对话目前被另一个 Codex 客户端占用。',detail:'你可以关闭占用它的窗口后重试，或创建一个保留已有内容的新分支继续。新消息将写入分支，不会写入原对话；正在进行的回复可能不完整。',buttons:['取消','创建分支继续'],defaultId:0,cancelId:0});
        if(choice.response!==1)throw Error('原对话仍被占用，请关闭占用它的窗口后重试。');
        r=await server.request('thread/fork',{threadId:id,excludeTurns:true});branched=true;
      }else if(/modelProviderMismatch|provider.*mismatch/i.test(e.message)){throw Error('该对话使用的模型提供方与当前配置不同；请在原 Codex 中打开，或切回原提供方后重试。');}
      else throw e;
    }
  }
  const newId=r.thread.id;const resolvedCwd=r.thread.cwd&&fsExistsDir(r.thread.cwd)?r.thread.cwd:cwd;cwd=resolvedCwd;
  activeThread=newId;loadedThreads.add(newId);let historyWarning=null;let turns=r.thread.turns||[];let nextCursor=null;
  try{const history=await server.request('thread/turns/list',{threadId:newId,limit:50,sortDirection:'desc',itemsView:'full'});turns=(history.data||[]).reverse();nextCursor=history.nextCursor||null;}
  catch{if(!turns.length){try{const full=await server.request('thread/read',{threadId:newId,includeTurns:true});turns=full.thread?.turns||[];}catch{historyWarning='历史内容暂时无法读取；你可以在原生 Codex 中查看。';}}}
  authorizeImages(turns);return {id:newId,cwd:resolvedCwd,turns,nextCursor,branched,historyWarning,runningTurnId:activeTurns.get(newId)||null};
});
ipcMain.handle('load-earlier',async(_e,threadId,cursor)=>{
  if(typeof threadId!=='string'||!threadId||typeof cursor!=='string'||cursor.length>4000)throw Error('历史游标无效');
  const r=await server.request('thread/turns/list',{threadId,limit:50,cursor,sortDirection:'desc',itemsView:'full'});
  const turns=(r.data||[]).reverse();authorizeImages(turns);return {turns,nextCursor:r.nextCursor||null};
});
ipcMain.handle('read-latest',async(_e,threadId)=>{if(typeof threadId!=='string'||!threadId||threadId.length>256)throw Error('对话 ID 无效');if(activeTurns.has(threadId)||pendingStarts.has(threadId))throw Error('当前任务仍在运行，请等待结束后再核对');const r=await server.request('thread/turns/list',{threadId,limit:50,sortDirection:'desc',itemsView:'full'});checkedThreads.add(threadId);const turns=(r.data||[]).reverse();authorizeImages(turns);return {turns,nextCursor:r.nextCursor||null};});
ipcMain.handle('ack-delivery',(_e,threadId)=>{if(!checkedThreads.has(threadId))throw Error('请先检查最新历史');if(activeTurns.has(threadId)||pendingStarts.has(threadId))throw Error('当前任务仍在运行，请等待完成后再解除限制');uncertainThreads.delete(threadId);checkedThreads.delete(threadId);return true;});
ipcMain.handle('answer-user-input',(_e,token,answers)=>{const request=pendingQuestions.get(token);if(!request||request.origin!==server||!server.proc)throw Error('问题已失效');if(!answers||typeof answers!=='object'||Array.isArray(answers))throw Error('回答格式无效');const result=Object.create(null);for(const q of request.questions){const answer=answers[q.id];if(typeof answer!=='string'||!answer.trim()||answer.length>10000)throw Error('请完成所有问题');const options=q.options||[];if(options.length&&!q.isOther&&!options.some(option=>option.label===answer))throw Error('请选择提供的选项');result[q.id]={answers:[answer.trim()]};}pendingQuestions.delete(token);request.origin.answer(request.id,{answers:result});return true;});
ipcMain.handle('cancel-user-input',(_e,token)=>{const request=pendingQuestions.get(token);if(request){pendingQuestions.delete(token);request.origin.reject(request.id,'用户取消回答',-32800);}return true;});
ipcMain.handle('answer-approval',(_e,token,decision)=>{const request=pendingApprovals.get(token);if(!request||request.origin!==server||!server.proc)throw Error('审批请求已失效');if(!['accept','decline'].includes(decision))throw Error('审批选项无效');pendingApprovals.delete(token);if(request.type==='permissions'){const permissions=decision==='accept'?Object.fromEntries(Object.entries(request.perms).filter(([,value])=>value!=null)):{};request.origin.answer(request.id,{permissions,scope:'turn'});}else request.origin.answer(request.id,{decision});return true;});
ipcMain.handle('choose-files',async()=>{
  const r=await dialog.showOpenDialog(win,{title:'添加图片、文档或文本',properties:['openFile','multiSelections'],filters:[{name:'图片、文档或文本',extensions:['png','jpg','jpeg','webp','gif','bmp','avif','pdf','docx','xlsx','pptx','txt','md','json','jsonl','log','csv','tsv','js','jsx','ts','tsx','py','rb','go','rs','java','c','h','cpp','hpp','cs','php','html','css','scss','less','xml','yml','yaml','toml','ini','cfg','sh','ps1','bat','cmd','sql']},{name:'所有文件',extensions:['*']}]});
  if(r.canceled)return {files:[],skipped:[]};
  return loadFiles(r.filePaths);
});
ipcMain.handle('read-dropped-files',async(_e,paths)=>loadFiles(paths));
ipcMain.handle('paste-image',async()=>{const image=clipboard.readImage();const file=saveClipboardImage(image,path.join(app.getPath('userData'),'kurumi-attachments'));return loadFiles([file]);});
ipcMain.handle('history-image-preview',async(_e,file)=>{if(typeof file!=='string'||!historicalImages.has(file)||!IMAGE_EXT.has(path.extname(file).toLowerCase()))return null;try{const stat=fs.statSync(file);if(!stat.isFile()||stat.size>20*1024*1024)return null;return await preview(file)}catch{return null}});
ipcMain.handle('worktree-list',(_e,folder)=>listWorktrees(folder));
ipcMain.handle('worktree-add',(_e,folder,target,ref)=>addWorktree(folder,target,ref));
ipcMain.handle('skills-list',async(_e,folder)=>{if(!serverReady||!server)throw Error('Codex 服务未连接');if(!fsExistsDir(folder))throw Error('工作目录无效');const result=await server.request('skills/list',{cwds:[folder],forceReload:true});const entry=(result.data||[]).find(x=>x.cwd===folder)||(result.data||[])[0];const skills=entry?.skills||[];knownSkills=new Map(skills.map(skill=>[skill.path,skill]));return {skills,errors:entry?.errors||[]};});
ipcMain.handle('skill-enable',async(_e,skillPath,enabled)=>{if(!serverReady||!server)throw Error('Codex 服务未连接');if(!knownSkills.has(skillPath)||typeof enabled!=='boolean')throw Error('请先刷新技能列表');await server.request('skills/config/write',{path:skillPath,enabled});return true;});
ipcMain.handle('plugin-markets',async()=>{const result=await runFile(locateCodex(),['plugin','marketplace','list','--json'],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1024*1024});const data=JSON.parse(result.stdout);return (data.marketplaces||[]).map(m=>m.name).filter(name=>typeof name==='string');});
ipcMain.handle('plugins-list',async(_e,marketplace,available)=>{if(typeof marketplace!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(marketplace))throw Error('插件市场名称无效');const args=['plugin','list','--marketplace',marketplace,'--json'];if(available)args.push('--available');const result=await runFile(locateCodex(),args,{encoding:'utf8',windowsHide:true,timeout:25000,maxBuffer:4*1024*1024});const data=JSON.parse(result.stdout);const plugins=[...(data.installed||[]),...(data.available||[])];knownPlugins=new Map(plugins.filter(p=>typeof p.pluginId==='string').map(p=>[p.pluginId,p]));return plugins.map(p=>({pluginId:p.pluginId,name:p.name,installed:!!p.installed,enabled:!!p.enabled,version:p.version,installPolicy:p.installPolicy,authPolicy:p.authPolicy}));});
ipcMain.handle('plugin-change',async(_e,id,install)=>{if(!knownPlugins.has(id)||typeof install!=='boolean'||!/^[A-Za-z0-9][A-Za-z0-9_.-]*@[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id))throw Error('请先刷新插件列表');const plugin=knownPlugins.get(id);if(install===!!plugin.installed)throw Error('插件状态已变化，请刷新');const answer=await dialog.showMessageBox(win,{type:'question',title:install?'安装插件':'卸载插件',message:`${install?'安装':'卸载'} ${id}？`,detail:'这会更改本机 Codex 的插件配置；插件可能包含技能、工具或钩子。',buttons:['取消',install?'安装':'卸载'],defaultId:0,cancelId:0});if(answer.response!==1)return {canceled:true};try{const result=await runFile(locateCodex(),['plugin',install?'add':'remove',id,'--json'],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:1024*1024});return {canceled:false,result:JSON.parse(result.stdout)};}catch(error){knownPlugins.delete(id);throw Error('插件操作结果未确认，请刷新列表核对后再决定是否重试：'+error.message);}});
ipcMain.handle('terminal-start',async(_e,folder,mode,tabId)=>{
  if(!serverReady||!server)throw Error('Codex 服务未连接');if(terminal)throw Error('请先结束当前终端');if(typeof folder!=='string'||!path.isAbsolute(folder)||!fsExistsDir(folder))throw Error('工作目录无效');if(!['sandbox','system'].includes(mode))throw Error('终端模式无效');
  const id=randomUUID();
  if(mode==='sandbox'){const access=checkedTabAccess(tabId);terminal={id,mode,origin:server,folder,access,running:false,policy:policyFor(access,folder).sandboxPolicy};return {id,cwd:folder,access,mode};}
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.CODEX_WINDOWS_REGISTERED_CORE;
  const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command','-'],{cwd:folder,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  terminal={id,mode,child,folder};const stdout=new StringDecoder('utf8'),stderr=new StringDecoder('utf8');
  child.stdout.on('data',chunk=>{const text=stdout.write(chunk);if(text)send('terminal-output',{id,text});});child.stderr.on('data',chunk=>{const text=stderr.write(chunk);if(text)send('terminal-output',{id,text});});child.stdin.on('error',()=>{});
  child.on('close',code=>{if(terminal?.id===id){const tail=stdout.end()+stderr.end();if(tail)send('terminal-output',{id,text:tail});terminal=null;send('terminal-exit',{id,code});}});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)}).catch(error=>{if(terminal?.id===id)terminal=null;throw error;});
  child.stdin.write('[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; $OutputEncoding = New-Object System.Text.UTF8Encoding\n');
  return {id,cwd:folder,access:'系统账户权限，不受 Codex 沙箱限制',mode};
});
ipcMain.handle('terminal-write',async(_e,id,text)=>{if(!terminal||terminal.id!==id)throw Error('终端已关闭');if(typeof text!=='string'||!text.trim()||text.length>20000)throw Error('终端输入无效');const current=terminal;if(current.mode==='system'){const encoded=Buffer.from(text,'utf8').toString('base64');const command=`Invoke-Expression ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))\n`;await new Promise((resolve,reject)=>current.child.stdin.write(command,error=>error?reject(error):resolve()));return {streaming:true};}if(current.origin!==server)throw Error('终端已断开');if(current.running)throw Error('请等待当前命令完成');current.running=true;try{const result=await current.origin.request('command/exec',{command:['powershell.exe','-NoLogo','-NoProfile','-NonInteractive','-Command',text],cwd:current.folder,sandboxPolicy:current.policy,timeoutMs:30000});return {stdout:String(result.stdout||'').slice(0,200000),stderr:String(result.stderr||'').slice(0,200000),exitCode:result.exitCode};}finally{current.running=false;}});
ipcMain.handle('terminal-stop',(_e,id)=>{if(!terminal||terminal.id!==id)return false;if(terminal.mode==='system'){terminal.child.kill();return true;}if(terminal.running)throw Error('请等待当前命令完成或超时');terminal=null;send('terminal-exit',{id,code:0});return true;});
ipcMain.handle('send-message',async(_e,text,options={})=>{
  let attempted=false,accepted=false;let targetId=null;
  try{
    if(typeof text!=='string'||text.length>200000)throw Error('消息内容无效');
    if(!serverReady||!server)throw Error('Codex 服务未连接');
    if(!diagnosticReport||diagnosticReport.checks.some(check=>check.status==='error'))throw Error('Codex 兼容检查尚未通过，请打开诊断查看');
    targetId=options.threadId||activeThread;if(typeof targetId!=='string'||!targetId||targetId.length>256)throw Error('对话 ID 无效');
    if(!loadedThreads.has(targetId))throw Error('请先恢复对话');
    if(activeTurns.has(targetId)||pendingStarts.has(targetId))throw Error('此对话的任务仍在运行，请等待完成');
    if(uncertainThreads.has(targetId))throw Error('上一条消息的状态尚未核对，请先检查历史');
    const targetFolder=typeof options.cwd==='string'&&fsExistsDir(options.cwd)?options.cwd:cwd;
    const input=makeInput(text,options.attachments||[]);
    const choice=selectModel(models,options);const policy=policyFor(checkedTabAccess(options.tabId),targetFolder);
    if(!['default','plan'].includes(options.mode))throw Error('任务模式无效');
    const collaborationMode={mode:options.mode,settings:{model:choice.model,reasoning_effort:choice.effort||null,developer_instructions:null}};
    attempted=true;pendingStarts.add(targetId);const result=await server.request('turn/start',{threadId:targetId,input,...choice,collaborationMode,cwd:targetFolder,approvalPolicy:policy.approvalPolicy,sandboxPolicy:policy.sandboxPolicy});accepted=true;const turnId=result.turn?.id;if(turnId&&!finishedTurns.has(turnId)){activeTurns.set(targetId,turnId);if(pendingInterrupts.delete(targetId))server.request('turn/interrupt',{threadId:targetId,turnId}).catch(e=>send('codex-status',{warning:'停止任务失败：'+e.message}));}return {ok:true,result};
  }catch(error){const failure=failureResult(error,attempted,activeTurns.has(targetId));if(failure.delivery==='unknown'&&targetId){uncertainThreads.add(targetId);checkedThreads.delete(targetId);}return failure;}
  finally{if(attempted&&targetId){pendingStarts.delete(targetId);if(!accepted)pendingInterrupts.delete(targetId);}}
});
ipcMain.handle('interrupt',async(_e,threadId)=>{const turnId=activeTurns.get(threadId);if(turnId){await server.request('turn/interrupt',{threadId,turnId});return {requested:true};}if(pendingStarts.has(threadId)){pendingInterrupts.add(threadId);return {queued:true};}return {requested:false};});
ipcMain.handle('steer-turn',async(_e,threadId,expectedTurnId,text)=>{
  let attempted=false;
  try{
    if(!serverReady||!server)throw Error('Codex 服务未连接');
    if(!diagnosticReport||diagnosticReport.checks.some(check=>check.status==='error'))throw Error('Codex 兼容检查尚未通过');
    if(typeof threadId!=='string'||!threadId||typeof expectedTurnId!=='string'||!expectedTurnId||activeTurns.get(threadId)!==expectedTurnId)throw Error('任务已经结束或发生变化，请检查后重试');
    if(typeof text!=='string'||!text.trim()||text.length>200000)throw Error('补充消息无效');
    if(uncertainThreads.has(threadId)||pendingSteers.has(threadId))throw Error('请先核对上一条消息的状态');
    pendingSteers.add(threadId);attempted=true;
    const result=await server.request('turn/steer',{threadId,expectedTurnId,input:[{type:'text',text:text.trim(),text_elements:[]}]});
    return {ok:true,result};
  }catch(error){const failure=failureResult(error,attempted,false);if(failure.delivery==='unknown'&&threadId){uncertainThreads.add(threadId);checkedThreads.delete(threadId);}return failure;}
  finally{if(attempted)pendingSteers.delete(threadId);}
});
ipcMain.handle('copy-text',(_e,text)=>{if(typeof text==='string')clipboard.writeText(text);});
ipcMain.handle('remote-status',()=>{if(remoteInitError)return {offline:true,status:'errored',enabled:false,error:remoteInitError};return remote().snapshot();});
ipcMain.handle('compatibility-state',()=>updates().snapshot());
ipcMain.handle('compatibility-open',()=>updates().openRepair(false));
ipcMain.handle('compatibility-draft',()=>updates().draft());
ipcMain.handle('client-config',()=>({settings,error:settingsError,firstRun:!settings.configured&&!existingProfile,root:__dirname,packaged:app.isPackaged}));
ipcMain.handle('client-config-save',(_e,value)=>{const validated=clientConfig.validate(value);if(validated.codexExecutable!==settings.codexExecutable&&(activeTurns.size||pendingStarts.size))throw Error('请等待运行中的任务结束后再更改 Codex 路径');const file=path.join(app.getPath('userData'),'client-settings.json');if(settingsError&&fs.existsSync(file))fs.copyFileSync(file,file+'.invalid-'+Date.now()+'.bak');settings=clientConfig.save(file,{...validated,configured:true});settingsError='';if(settings.codexExecutable)process.env.KURUMI_CODEX_EXE=settings.codexExecutable;else delete process.env.KURUMI_CODEX_EXE;if(settings.pythonExecutable)process.env.KURUMI_PYTHON=settings.pythonExecutable;else delete process.env.KURUMI_PYTHON;updates().publish();return {settings,restartRequired:true};});
ipcMain.handle('client-config-pick',async(_e,type)=>{if(!['workspace','codexExecutable','pythonExecutable'].includes(type))throw Error('配置项无效');const result=await dialog.showOpenDialog(win,{properties:[type==='workspace'?'openDirectory':'openFile'],...(type==='workspace'?{}:{filters:[{name:'Executable',extensions:['exe']}]})});return result.canceled?null:result.filePaths[0]||null;});
ipcMain.handle('install-skin-plugin',async()=>{const cli=locateCodex(),source=path.join(app.getPath('userData'),'plugin-sources',clientVersion);copyPublicClient(__dirname,source);await runFile(cli,['plugin','marketplace','add',source,'--json'],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024*1024});await runFile(cli,['plugin','add','kurumi-skin-tools@kurumi-codex','--json'],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:1024*1024});return {installed:true};});
ipcMain.handle('remote-refresh',()=>remote().refresh());
ipcMain.handle('remote-set',(_e,value)=>remote().setEnabled(value));
ipcMain.handle('remote-pair',()=>remote().pair());
ipcMain.handle('remote-pair-status',()=>remote().pairingStatus());
ipcMain.handle('remote-clients',()=>remote().listClients());
ipcMain.handle('remote-revoke',(_e,id)=>remote().revoke(id));
ipcMain.handle('remote-thread',(_e,id)=>{if(typeof id!=='string'||id.length>256||!remoteWatcher)throw Error('远程会话无效');return remoteWatcher.snapshot(id);});
ipcMain.handle('scheduled-list',()=>scheduler().list());
ipcMain.handle('scheduled-save',(_e,input)=>scheduler().save(input));
ipcMain.handle('scheduled-toggle',(_e,id,enabled)=>scheduler().toggle(id,enabled));
ipcMain.handle('scheduled-remove',(_e,id)=>scheduler().remove(id));
ipcMain.handle('scheduled-run',async(_e,id)=>{const answer=await dialog.showMessageBox(win,{type:'question',title:'立即运行定时任务',message:'立即运行会新建 Codex 会话并使用账户额度。',buttons:['取消','立即运行'],defaultId:0,cancelId:0});if(answer.response!==1)return {canceled:true};return scheduler().run(id);});
ipcMain.handle('scheduled-ack',async(_e,id)=>{const answer=await dialog.showMessageBox(win,{type:'question',title:'解除运行锁定',message:'请先打开运行会话，确认上次任务是否执行。解除后可以再次运行，可能造成重复操作。',buttons:['继续核对','已核对，解除锁定'],defaultId:0,cancelId:0});if(answer.response===1)scheduler().acknowledge(id);});
ipcMain.handle('scheduled-stop',async(_e,threadId)=>{const known=scheduler().list().some(t=>t.runs.some(r=>r.threadId===threadId&&['starting','running'].includes(r.status)));if(!known)throw Error('任务不在运行');const turnId=activeTurns.get(threadId);if(turnId)await server.request('turn/interrupt',{threadId,turnId});else if(pendingStarts.has(threadId))pendingInterrupts.add(threadId);else throw Error('任务状态正在更新，请刷新后重试');return true;});
ipcMain.handle('read-quota',async()=>{
  if(!serverReady||!server)throw Error('Codex 服务未连接');
  if(quotaRequest)return quotaRequest;
  const origin=server,epoch=quotaEpoch;
  const request=origin.request('account/rateLimits/read',{},15000).then(data=>{if(server!==origin||!serverReady||epoch!==quotaEpoch)throw Error('连接或账户已变化，请刷新');return {...normalizeQuota(data),updatedAt:Date.now()};});
  quotaRequest=request;try{return await request;}finally{if(quotaRequest===request)quotaRequest=null;}
});
ipcMain.handle('open-external',async(_e,url)=>{if(typeof url==='string'&&/^https?:\/\//i.test(url))await shell.openExternal(url);});
ipcMain.handle('resolve-local-video',(_e,file,cwd)=>localVideo(localFile(file,cwd).path).url);
ipcMain.handle('open-local-video',async(_e,file,cwd)=>{const error=await shell.openPath(localVideo(localFile(file,cwd).path).path);if(error)throw Error(error);return true;});
ipcMain.handle('resolve-local-audio',(_e,file,cwd)=>{const item=localFile(file,cwd);if(!['.mp3','.wav','.m4a','.ogg'].includes(item.ext))throw Error('不支持这种音频格式');return item.url;});
ipcMain.handle('open-local-audio',async(_e,file,cwd)=>{const item=localFile(file,cwd);if(!['.mp3','.wav','.m4a','.ogg'].includes(item.ext))throw Error('不支持这种音频格式');const error=await shell.openPath(item.path);if(error)throw Error(error);return true;});
ipcMain.handle('resolve-local-image',(_e,file,cwd)=>{const item=localFile(file,cwd);if(item.kind!=='image'||item.size>50*1024*1024)throw Error('图片格式不支持或文件大于 50 MB');return item.url;});
ipcMain.handle('preview-local-file',async(_e,file,cwd)=>{const item=localFile(file,cwd);if(item.kind==='html'){await openHtmlPreview(BrowserWindow,win,item);return 'html';}if(item.kind!=='document')throw Error('此类型不能直接打开，请使用“文件位置”');const error=await shell.openPath(item.path);if(error)throw Error(error);return 'document';});
ipcMain.handle('reveal-local-file',async(_e,file,cwd)=>{const item=localFile(file,cwd,true);if(item.kind==='directory'){const error=await shell.openPath(item.path);if(error)throw Error(error);}else shell.showItemInFolder(item.path);return true;});
ipcMain.handle('read-local-text',async(_e,file,cwd)=>{let item;try{item=localFile(file,cwd);}catch(e){const alternative=typeof file==='string'?currentPluginFile(file):null;if(alternative)return {path:file,missing:true,alternative};throw e;}if(!textTypes.has(item.ext))throw Error('不支持这种文本格式');if(item.size>1024*1024)throw Error('文本大于 1 MB，请从文件位置打开');return {path:item.path,text:await fs.promises.readFile(item.path,'utf8')};});
for(const [name,handler] of Object.entries({
  'browser-show':value=>browser.show(value),
  'browser-create':()=>browser.create(),
  'browser-select':id=>browser.select(id),
  'browser-close':id=>browser.close(id),
  'browser-resize':rect=>browser.resize(rect),
  'browser-navigate':url=>browser.navigate(url),
  'browser-action':action=>browser.action(action),
}))ipcMain.handle(name,(event,...args)=>{if(event.sender!==win.webContents)throw Error('无权操作浏览器');return handler(...args)});

app.whenReady().then(()=>{
  startupLog('app-ready',{version:clientVersion,electron:process.versions.electron});
  existingProfile=fs.existsSync(path.join(app.getPath('userData'),'session-recovery.json'));
  try{settings=clientConfig.load(path.join(app.getPath('userData'),'client-settings.json'));}catch(e){settings={...clientConfig.DEFAULTS,autoRepair:false};settingsError=e.message;}
  if(settings.codexExecutable)process.env.KURUMI_CODEX_EXE=settings.codexExecutable;if(settings.pythonExecutable)process.env.KURUMI_PYTHON=settings.pythonExecutable;if(settings.workspace&&fsExistsDir(settings.workspace))cwd=settings.workspace;else if(app.isPackaged)cwd=app.getPath('documents');
  try{fs.mkdirSync(app.getPath('userData'),{recursive:true});fs.writeFileSync(path.join(app.getPath('userData'),'install-location.json'),JSON.stringify({root:__dirname,version:clientVersion}));}catch(error){startupLog('install-location-write-failed',{code:error.code});}
  updates().start();
  preferencesPath=path.join(app.getPath('userData'),'preferences.json');
  preferences=loadPreferences(preferencesPath);
  if(preferences.access==='full'){selectedAccess='workspace';pendingFullRestore=true;}
  else selectedAccess=preferences.access;
  createWindow();
});
app.on('window-all-closed',()=>{updateGuard?.stop();remoteWatcher?.stop();remoteController?.detach();if(terminal?.mode==='system')terminal.child.kill();server?.stop();app.quit()});
