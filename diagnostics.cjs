const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const runFile = promisify(execFile);
const { locateCodex } = require('./app-server.cjs');
const threadSources = require('./thread-sources.cjs');
const {version:clientVersion}=require('./package.json');
const {kind}=require('./update-guard.cjs');

async function diagnose(server, userData) {
  const checks = [];
  const report = { checkedAt: new Date().toISOString(), client: clientVersion, electron: process.versions.electron || '未知', codex: '未知', changed: null, checks };
  const check = (name, status, message,extra={}) => checks.push({ name, status, message,...extra });
  let executable;
  try {
    executable = locateCodex();
    const result = await runFile(executable, ['--version'], { windowsHide: true, timeout: 10000, maxBuffer: 65536 });
    report.codex = result.stdout.trim().slice(0, 150);
    if (!report.codex) throw Error('未返回版本');
    check('Codex 版本', 'ok', report.codex);
  } catch { check('Codex 版本', 'error', '无法读取本机 Codex 版本'); return report; }
  let previous = null,previousData=null;
  const stat=fs.statSync(executable);
  const fingerprint=`${report.codex}|${stat.size}|${stat.mtimeMs}|${report.electron}|${clientVersion}`;
  const marker = path.join(userData, 'checked-version.json');
  try { previousData = JSON.parse(fs.readFileSync(marker, 'utf8'));previous=previousData.fingerprint; } catch {}
  report.nativeStamp=`${report.codex}|${stat.size}|${stat.mtimeMs}`;report.previousCodex=previousData?.codex||null;
  report.codexChanged=!!previousData&&(previousData.nativeStamp||previous?.split('|').slice(0,3).join('|'))!==report.nativeStamp;
  report.changed = previous !== fingerprint;
  if (report.changed) {
    try {
      const folder = path.join(userData, 'protocol-check', report.codex.replace(/[^a-z0-9._-]/gi, '_'));
      fs.mkdirSync(folder, { recursive: true });
      await runFile(executable, ['app-server', 'generate-json-schema', '--experimental', '--out', folder], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
      const requests = fs.readFileSync(path.join(folder, 'ClientRequest.json'), 'utf8');
      for (const method of ['initialize', 'thread/list', 'thread/start', 'thread/resume', 'turn/start', 'turn/interrupt']) if (!requests.includes(`"${method}"`)) throw Error('缺少必要请求');
      const fields = [ ['ThreadListParams.json',['cursor','limit','searchTerm','archived']], ['TurnStartParams.json',['threadId','input','model','sandboxPolicy']], ['ItemCompletedNotification.json',['threadId','item']] ];
      for (const [file, names] of fields) {const schema=JSON.parse(fs.readFileSync(path.join(folder,'v2',file),'utf8'));for(const name of names)if(!schema.properties?.[name])throw Error('缺少必要字段');}
      check('协议结构', 'ok', '已检查当前版本的主要请求和事件结构');
    } catch (error) {const incompatible=/缺少必要/.test(error.message||'');check('协议结构', incompatible?'error':'warning', incompatible?'检测到必要的协议方法或字段缺失，已暂停发送':'无法完成版本协议结构检查，请检查兼容性后再使用高级功能',{kind:incompatible?'contract':'unknown'}); }
  } else check('协议结构', 'ok', '本版本已检查主要协议结构');
  for (const [name, method, params] of [
    ['模型列表', 'model/list', {limit: 1, includeHidden: false}],
    ['会话列表', 'thread/list', {limit: 1, sourceKinds: threadSources, modelProviders:[]}],
    ['会话分组', 'threadSection/list', {limit: 1}],
  ]) {
    try { const result = await server.request(method, params); if (!Array.isArray(result?.data)) throw Error('响应格式不支持'); check(name, 'ok', '只读检查通过'); }
    catch(error) { check(name, name === '会话分组' ? 'warning' : 'error', '只读检查失败，该功能可能需要适配',{kind:kind(error)}); }
  }
  for(const [name,method,params] of [['手机同步','remoteControl/status/read',null],['额度同步','account/rateLimits/read',{}]]){
    try{const value=await server.request(method,params,15000);if(!value||typeof value!=='object'||name==='手机同步'&&!['disabled','connecting','connected','errored'].includes(value.status))throw Error('响应格式不支持');check(name,'ok','只读检查通过');}
    catch(error){check(name,'warning','可选同步接口暂不可用',{kind:kind(error)});}
  }
  if (checks.every(item => item.status === 'ok')) {
    try { fs.mkdirSync(userData, { recursive: true }); fs.writeFileSync(marker, JSON.stringify({codex: report.codex, fingerprint,nativeStamp:report.nativeStamp, checkedAt: report.checkedAt})); } catch { check('检查记录', 'warning', '无法保存版本检查记录'); }
  }
  return report;
}
module.exports = { diagnose };
