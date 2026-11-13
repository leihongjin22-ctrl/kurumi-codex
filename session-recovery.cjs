const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 16 * 1024 * 1024;
function validate(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.tabs) || value.tabs.length > 60) throw Error('恢复数据格式不受支持');
  const tabs = value.tabs.map(tab => {
    if (!tab || (tab.threadId != null && (typeof tab.threadId !== 'string' || tab.threadId.length > 256)) || typeof tab.draft !== 'string' || tab.draft.length > 200000 || !Array.isArray(tab.attachments) || tab.attachments.length > 8) throw Error('恢复数据格式不受支持');
    const result={ threadId: tab.threadId || null, title: String(tab.title || '新对话').slice(0, 200), cwd: typeof tab.cwd === 'string' ? tab.cwd : null, draft: tab.draft, attachments: tab.attachments, uncertain: !!tab.uncertain };
    if(tab.settings!=null){const s=tab.settings;if(!s||typeof s!=='object'||Array.isArray(s)||!['readonly','workspace','full'].includes(s.access)||!['default','plan'].includes(s.mode)||(s.model!=null&&(typeof s.model!=='string'||s.model.length>200))||(s.effort!=null&&(typeof s.effort!=='string'||s.effort.length>64)))throw Error('标签设置格式不受支持');result.settings={model:s.model||null,effort:s.effort||null,mode:s.mode,access:s.access};}
    const validateComment=(c,allowEmpty=false)=>{if(!c||typeof c!=='object'||typeof c.entryId!=='string'||c.entryId.length>300||typeof c.path!=='string'||c.path.length>4000||!['old','new'].includes(c.side)||!Number.isInteger(c.line)||c.line<1||typeof c.text!=='string'||(!allowEmpty&&!c.text.trim())||c.text.length>10000||typeof c.fingerprint!=='string'||c.fingerprint.length>100)throw Error('审核反馈格式不受支持');return {entryId:c.entryId,path:c.path,side:c.side,line:c.line,text:c.text,fingerprint:c.fingerprint};};
    if(tab.reviewComments!=null){if(!Array.isArray(tab.reviewComments)||tab.reviewComments.length>200)throw Error('审核反馈格式不受支持');result.reviewComments=tab.reviewComments.map(c=>validateComment(c));}
    if(tab.reviewDraft!=null)result.reviewDraft=validateComment(tab.reviewDraft,true);
    return result;
  });
  return { version: 1, activeIndex: Math.max(0, Math.min(Number.isInteger(value.activeIndex) ? value.activeIndex : 0, Math.max(0, tabs.length - 1))), tabs };
}
function load(file) {
  try {
    if (!fs.existsSync(file)) return null;
    if (fs.statSync(file).size > MAX_BYTES) throw Error('恢复数据超过大小限制');
    return validate(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (error) { throw Error('读取恢复数据失败：' + error.message); }
}
function save(file, value) {
  const data = JSON.stringify(validate(value));
  if (Buffer.byteLength(data, 'utf8') > MAX_BYTES) throw Error('草稿和附件恢复数据超过 16 MB');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try { fs.writeFileSync(tmp, data, 'utf8'); fs.renameSync(tmp, file); }
  catch (error) { try { fs.rmSync(tmp, { force: true }); } catch {} throw error; }
}
module.exports = { load, save, validate };
