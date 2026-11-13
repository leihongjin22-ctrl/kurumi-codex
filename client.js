const api = window.kurumi;
const $ = (id) => document.getElementById(id);
const input = $('messageInput');
const sendButton = $('sendButton');
const stopButton = $('stopButton');
const attachButton = $('attachButton');
const attachmentTray = $('attachmentTray');
const statusText = $('statusText');
const messages = $('messages');
const folderLabel = $('folderLabel');
const recentThreads = $('recentThreads');
const modelSelect = $('modelSelect');
const effortSelect = $('effortSelect');
const accessSelect = $('accessSelect');
const modeSelect = $('modeSelect');
const tabsEl = $('tabs');
const newTabButton = $('newTabButton');
const conversation = document.querySelector('.conversation');
const scroller = conversation;

let ready = false;
let connectionFailed = false;
let readyStarted = false;
let catalog = [];
let savedPreferences = null;
let preferencesReady = false;
let preferenceSaveTimer = null;
let currentFolder = '';
let tabs = [];
let activeTabId = null;
let tabSeq = 0;
let pendingAttachments = [];
let lastDraftState = null;
let recoveryReady = false;
let recoveryError = null;
let recoveryTimer = null;
let compatibilityStatus = 'checking';
let threadRows = [], threadCursor = null, threadArchived = false, threadQuery = '', threadListVersion = 0, threadLoading = false, sections = [], selectedThread = null, editingNewSection = false;
const byItem = new Map();
const activityNodes = new Map();
const collapsedThreadGroups=new Set();
let renderingMessages=false;
const pendingMessagePaints=new Map(), pendingActivityPaints=new Map();
const markdownCache=new Map(),activityState=new WeakMap(),streamState=new WeakMap();
let markdownCacheSize=0,paintFrame=null;

function activeTab() { return tabs.find((tab) => tab.id === activeTabId) || null; }
function isBusy(tab=activeTab()){return Boolean(tab?.busy);}
function setStatus(text) { statusText.textContent = text; }
function setTabStatus(tab,text){if(!tab)return;tab.status=text;if(tab.id===activeTabId)setStatus(text);}
function explainError(value){const text=String(value||'未知错误');if(/rate.?limit|usage limit|quota|额度|too many requests/i.test(text))return '账户额度或请求频率受限，请等待恢复后重试。 '+text;if(/network|connection|timed? ?out|网络|连接中断/i.test(text))return '连接异常。 '+text;return text;}
function newId(prefix = 'id') { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function nearBottom() { return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 150; }
function scrollBottom(force = false) { if (!renderingMessages&&(force || nearBottom())) scroller.scrollTop = scroller.scrollHeight; }

function enable() {
  const hasModel = catalog.some(model=>model.id===modelSelect.value);
  const tab = activeTab();
  const busy=isBusy(tab),submitting=Boolean(tab?.submitting);
  $('app').classList.toggle('task-active',tabs.some(isBusy));
  $('remoteRunNotice').hidden=!tab?.remoteControlled||!busy;
  sendButton.disabled = !ready || compatibilityStatus!=='ok' || !tab?.accessReady || !!tab?.accessPending || (busy&&(!tab?.turnId||submitting)) || !!tab?.steering || !hasModel || Boolean(tab?.uncertain);
  input.disabled = submitting || !!tab?.steering;
  input.placeholder=busy?'任务进行中：输入补充消息并按 Enter 提交':'输入你的想法… Enter 发送，Shift + Enter 换行';
  sendButton.title=busy?'补充当前任务':'发送';
  document.querySelector('.new-session').disabled = !ready;
  modelSelect.disabled = !ready || submitting || !catalog.length;
  effortSelect.disabled = !ready || submitting || !effortSelect.options.length;
  accessSelect.disabled = !ready || submitting || !!tab?.accessPending;
  modeSelect.disabled = !ready || submitting;
  stopButton.hidden = !busy;
  stopButton.disabled = !tab?.threadId;
  attachButton.disabled = !ready || busy;
  newTabButton.disabled = !ready;
  $('reconnectButton').hidden = ready || !connectionFailed;
  $('deliveryBanner').hidden = !tab?.uncertain;
  $('checkDelivery').disabled = !ready || busy || Boolean(tab?.checkingHistory);
  $('unlockDelivery').disabled = !ready || busy || !tab?.historyChecked;
  const hasDrafts=tabs.some(item=>item.uncertain || item.reviewComments?.length || item.reviewDraft?.text?.trim() || (item.id===activeTabId ? Boolean(input.value.trim() || pendingAttachments.length) : Boolean(item.draft?.trim() || item.attachments?.length)));
  if(hasDrafts!==lastDraftState){lastDraftState=hasDrafts;api.setHasDrafts(hasDrafts);}
  if(!$('reviewPanel').hidden&&tab){const entries=reviewEntries(tab);$('reviewInsert').disabled=!tab.reviewComments.length||!!tab.reviewDraft||input.disabled||tab.reviewComments.some(comment=>!commentIsCurrent(comment,entries));}
  scheduleRecovery();
}

function recoverySnapshot(){
  saveActiveTab();
  return {version:1,activeIndex:Math.max(0,tabs.findIndex(tab=>tab.id===activeTabId)),tabs:tabs.map(tab=>({threadId:tab.threadId,title:tab.title,cwd:tab.cwd,draft:tab.draft||'',attachments:(tab.attachments||[]).map(({dataUrl,...attachment})=>attachment),uncertain:!!(tab.uncertain||tab.busy||tab.submitting),settings:{...tab.settings},reviewComments:tab.reviewComments.slice(),...(tab.reviewDraft?{reviewDraft:{...tab.reviewDraft}}:{})}))};
}
async function persistRecovery(){
  if(!recoveryReady||recoveryError)throw Error(recoveryError||'恢复数据尚未加载');
  if(recoveryTimer){clearTimeout(recoveryTimer);recoveryTimer=null;}
  await api.saveSession(recoverySnapshot());
}
function scheduleRecovery(){
  if(!recoveryReady||recoveryError)return;
  if(recoveryTimer)clearTimeout(recoveryTimer);
  recoveryTimer=setTimeout(()=>{recoveryTimer=null;persistRecovery().catch(error=>setStatus('草稿恢复保存失败：'+error.message));},350);
}
async function previewRestored(tab){
  if(!tab?.threadId||tab.previewLoaded||tab.previewLoading||!ready)return;
  tab.previewLoading=true;
  try{const result=await api.previewThread(tab.threadId);tab.turns=result.turns||[];tab.nextCursor=result.nextCursor||null;tab.previewLoaded=true;if(tab.id===activeTabId){renderMessages(tab);setStatus(tab.uncertain?'已恢复草稿，请先检查最新历史':'已恢复对话，发送时将重新连接');}}
  catch(error){if(tab.id===activeTabId)setStatus('恢复历史失败：'+error.message);}
  finally{tab.previewLoading=false;}
}
async function restoreSession(){
  try{
    const saved=await api.loadSession();
    if(saved?.tabs?.length){
      for(const item of saved.tabs){const tab=createTab({threadId:item.threadId,title:item.title,cwd:item.cwd,settings:item.settings,reviewComments:item.reviewComments,reviewDraft:item.reviewDraft});tab.draft=item.draft||'';tab.attachments=item.attachments||[];tab.uncertain=!!item.uncertain&&!!item.threadId;tab.needsResume=!!item.threadId;}
      activeTabId=tabs[Math.min(saved.activeIndex||0,tabs.length-1)].id;
      const tab=activeTab();input.value=tab.draft;pendingAttachments=tab.attachments.slice();folderLabel.textContent=tab.cwd||'未选择目录';if(tab.cwd)currentFolder=tab.cwd;renderAttachmentTray();renderTabs();renderMessages(tab);
    }
  }catch(error){recoveryError=error.message;setStatus('恢复数据读取失败，原文件已保留：'+error.message);}
  finally{recoveryReady=true;}
}
window.addEventListener('beforeunload',()=>{if(recoveryReady&&!recoveryError&&tabs.length){const result=api.saveSessionSync(recoverySnapshot());if(!result?.ok)console.error('无法保存恢复数据');}});

/* ---------- Markdown renderer (local, escaped, no remote dependencies) ---------- */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function inlineMarkdown(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return out;
}
function markedMarkdown(text){
  const parser=window.marked;if(!parser?.marked||!parser.Renderer)return null;
  const renderer=new parser.Renderer();
  renderer.html=token=>escapeHtml(token.text||'');
  const localReference=window.KurumiFeedback.localReference;
  const extOf=href=>(href.match(/\.([a-z\d]+)$/i)?.[1]||'').toLowerCase();
  const videoButton=(path,label,audio=false)=>`<button type="button" class="local-video-preview" data-kind="${audio?'audio':'video'}" data-path="${escapeHtml(path)}">▶ ${escapeHtml(label||(audio?'播放本地音频':'播放本地视频'))}</button>`;
  const fileButtons=(file,label,line=1)=>{const ext=extOf(file),image=['png','jpg','jpeg','webp','gif','bmp','avif'].includes(ext),html=['html','htm','svg'].includes(ext),text=window.KurumiFeedback.textExtensions.has(ext),document=['pdf','docx','xlsx','pptx','doc','xls','ppt'].includes(ext);const name=escapeHtml(label||'本地文件'),path=escapeHtml(file);let main='';if(image||html||text||document)main=`<button type="button" class="local-file-preview" data-kind="${image?'image':html?'html':text?'text':'document'}" data-line="${line}" data-path="${path}">${image?'▣ 预览':html?'◈ 离线预览':text?'▤ 查看文本':'↗ 打开'}：${name}</button>`;else main=`<span class="local-file-name">${name}</span>`;return `<span class="local-file-card">${main}<button type="button" class="local-file-reveal" data-path="${path}" title="在文件管理器中显示">文件位置</button></span>`;};
  const localMarkup=token=>{const file=localReference(token);if(!file)return null;const ext=extOf(file);return ['mp4','webm'].includes(ext)?videoButton(file,token.text||'播放本地视频'):['mp3','wav','m4a','ogg'].includes(ext)?videoButton(file,token.text||'播放本地音频',true):fileButtons(file,token.text,Number(String(token.href).match(/:(\d+)(?::\d+)?$/)?.[1])||1);};
  renderer.image=token=>localMarkup(token)||`<span>${escapeHtml(token.text||'图片')}</span>`;
  renderer.link=function(token){const local=localMarkup(token);if(local)return local;const body=this.parser.parseInline(token.tokens||[]);let url;try{url=new URL(token.href)}catch{return body}if(!['http:','https:'].includes(url.protocol))return body;return `<a href="${escapeHtml(url.href)}" target="_blank" rel="noreferrer">${body}</a>`;};
  renderer.code=token=>`<div class="code-block"><div class="code-head"><span>${escapeHtml((token.lang||'code').trim())}</span><button type="button" class="copy-code">复制</button></div><pre><code>${escapeHtml(token.text||'')}</code></pre></div>`;
  try{return parser.marked.parse(String(text||''),{gfm:true,renderer});}catch{return null;}
}
function renderMarkdown(value,cache=true){
  const source=String(value||'');
  if(cache&&markdownCache.has(source)){const html=markdownCache.get(source);markdownCache.delete(source);markdownCache.set(source,html);return html;}
  const html=renderMarkdownUncached(source),size=source.length+html.length;
  if(cache&&size<=300000){while(markdownCache.size&&(markdownCache.size>=400||markdownCacheSize+size>2000000)){const key=markdownCache.keys().next().value;markdownCacheSize-=key.length+markdownCache.get(key).length;markdownCache.delete(key);}markdownCache.set(source,html);markdownCacheSize+=size;}
  return html;
}
function renderMarkdownUncached(value) {
  const rendered=markedMarkdown(value);if(rendered!==null)return rendered;
  let text = String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const codeBlocks = [];
  text = text.replace(/```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g, (_match, lang, code) => {
    const index = codeBlocks.length;
    codeBlocks.push({ lang: String(lang || '').trim(), code: String(code || '').replace(/\n$/, '') });
    return `\u0000CODE${index}\u0000`;
  });
  const lines = text.split('\n');
  const output = [];
  let i = 0;
  const isList = (line) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(line);
  const isBlockStart = (line) => !line.trim() || /^\s*#{1,6}\s+/.test(line) || /^\s*>\s?/.test(line) || /^\s*```/.test(line) || /^\s*\u0000CODE\d+\u0000\s*$/.test(line) || /^\s*---+\s*$/.test(line) || isList(line) || /^\s*\|.*\|\s*$/.test(line);
  const renderCode = (index) => {
    const block = codeBlocks[index] || { lang: '', code: '' };
    const lang = escapeHtml(block.lang || 'code');
    return `<div class="code-block"><div class="code-head"><span>${lang}</span><button type="button" class="copy-code">复制</button></div><pre><code>${escapeHtml(block.code)}</code></pre></div>`;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    const codeMatch = line.match(/^\s*\u0000CODE(\d+)\u0000\s*$/);
    if (codeMatch) { output.push(renderCode(Number(codeMatch[1]))); i += 1; continue; }
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(6, heading[1].length);
      output.push(`<h${level}>${inlineMarkdown(heading[2].trim())}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) { output.push('<hr>'); i += 1; continue; }
    if (isList(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (i < lines.length && isList(lines[i]) && /^\s*\d+[.)]\s+/.test(lines[i]) === ordered) {
        items.push(`<li>${inlineMarkdown(lines[i].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''))}</li>`);
        i += 1;
      }
      output.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(inlineMarkdown(lines[i].replace(/^\s*>\s?/, '')));
        i += 1;
      }
      output.push(`<blockquote>${quote.join('<br>')}</blockquote>`);
      continue;
    }
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const splitRow = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
      const head = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      output.push(`<table><thead><tr>${head.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const paragraph = [line];
    i += 1;
    while (i < lines.length && !isBlockStart(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    output.push(`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`);
  }
  return output.join('');
}

/* ---------- Message rendering ---------- */
function attachmentChip(att, removable = false) {
  const chip = document.createElement('div');
  chip.className = 'attachment-chip';
  const candidate = att.dataUrl || att.url;
  const image = typeof candidate==='string' && /^data:image\/(png|jpeg|webp|gif|bmp|avif);base64,/i.test(candidate) && candidate.length<2000000 ? candidate : null;
  if (image) {
    const img = document.createElement('img');
    img.src = image;
    img.alt = att.name || '附件';
    chip.append(img);
  } else {
    const icon = document.createElement('span');
    icon.textContent = att.kind === 'image' ? '▣' : '▤';
    chip.append(icon);
    if(!removable&&att.kind==='image'&&att.path&&api.historyImagePreview){api.historyImagePreview(att.path).then(data=>{if(data&&chip.isConnected){const img=document.createElement('img');img.src=data;img.alt=att.name||'图片附件';icon.replaceWith(img)}}).catch(()=>{});}
  }
  const name = document.createElement('span');
  name.textContent = att.name || att.path || '附件';
  name.title = att.path || att.name || '';
  chip.append(name);
  if(Number.isFinite(att.size)){const size=document.createElement('small');size.textContent=att.size<1024?`${att.size} B`:att.size<1048576?`${(att.size/1024).toFixed(1)} KB`:`${(att.size/1048576).toFixed(1)} MB`;chip.append(size);}
  if(att.extracted){const label=document.createElement('small');label.textContent='已提取文本';chip.append(label);}
  if (removable) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'attachment-remove';
    remove.textContent = '×';
    remove.title = '移除附件';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      pendingAttachments = pendingAttachments.filter((item) => item.id !== att.id);
      renderAttachmentTray();
    });
    chip.append(remove);
  }
  return chip;
}

function appendUser(text, attachments = [], id = null) {
  const row = document.createElement('div');
  row.className = 'message user-message';
  if (id) row.dataset.itemId = id;
  const avatar = document.createElement('span');
  avatar.className = 'message-avatar';
  avatar.textContent = 'K';
  const box = document.createElement('div');
  box.className = 'message-content';
  const small = document.createElement('small');
  small.textContent = '你';
  box.append(small);
  if (attachments.length) {
    const wrap = document.createElement('div');
    wrap.className = 'message-attachments';
    attachments.forEach((att) => wrap.append(attachmentChip(att)));
    box.append(wrap);
  }
  if (text) {
    const p = document.createElement('p');
    p.textContent = text;
    box.append(p);
  }
  row.append(avatar, box);
  messages.append(row);
  scrollBottom();
  return row;
}

function appendAssistant(text = '', id = null) {
  const row = document.createElement('div');
  row.className = 'message assistant-message';
  if (id) row.dataset.itemId = id;
  const avatar = document.createElement('span');
  avatar.className = 'message-avatar codex-avatar';
  avatar.textContent = '✧';
  const box = document.createElement('div');
  box.className = 'message-content markdown-body';
  const small = document.createElement('small');
  small.textContent = 'Codex';
  box.append(small);
  const body = document.createElement('div');
  body.className = 'markdown-content';
  body.innerHTML = renderMarkdown(text);
  box.append(body);
  row.append(avatar, box);
  messages.append(row);
  if (id) byItem.set(id, body);
  scrollBottom();
  return body;
}

function appendSystem(label, text) {
  const row = document.createElement('div');
  row.className = 'message system-message';
  const avatar = document.createElement('span');
  avatar.className = 'message-avatar';
  avatar.textContent = '·';
  const box = document.createElement('div');
  box.className = 'message-content';
  const small = document.createElement('small');
  small.textContent = label;
  const p = document.createElement('p');
  p.textContent = text;
  box.append(small, p);
  row.append(avatar, box);
  messages.append(row);
  scrollBottom();
}

function contentText(item) {
  return (item.content || []).filter((part) => part.type === 'text').map((part) => part.text || '').filter(Boolean).join('\n');
}
function contentAttachments(item) {
  const result = [];
  for (const part of item.content || []) {
    if (part.type === 'image' || part.type === 'localImage') {
      const imagePath = part.path || '';
      const name = part.name || imagePath.split(/[\\/]/).pop() || '图片附件';
      result.push({ kind: 'image', name, dataUrl: part.url || part.image_url || null, path: imagePath });
    }
  }
  return result;
}
function renderItem(item) {
  if (!item) return;
  if (item.type === 'userMessage') appendUser(contentText(item), contentAttachments(item), item.id);
  else if (item.type === 'agentMessage') appendAssistant(item.text || '', item.id);
  else if (activityTypes.has(item.type)) renderActivity(item);
  else if(item.type==='clientNotice')appendSystem(item.label,item.text);
  else if(item.type)appendSystem('暂不支持的项目',`当前客户端不能完整显示此类任务过程（${String(item.type).slice(0,80)}），可在原生 Codex 中查看。`);
}

function limited(text){text=String(text||'');return text.length>200000?text.slice(0,200000)+'\n\n[内容过长，仅显示前 200000 字符]':text;}
const activityTypes=new Set(['commandExecution','fileChange','plan','mcpToolCall','dynamicToolCall','collabAgentToolCall','subAgentActivity','webSearch','imageView','imageGeneration','reasoning','contextCompaction','enteredReviewMode','exitedReviewMode','sleep','functionCallOutput','hookPrompt']);
function renderActivity(item){
  let node=activityNodes.get(item.id);if(!node){node=document.createElement('details');node.className='task-activity';const summary=document.createElement('summary'),pre=document.createElement('pre');node.append(summary,pre);activityState.set(node,{summary,pre,item,filled:false,text:null});node.addEventListener('toggle',()=>{if(node.open)fillActivity(activityState.get(node));});activityNodes.set(item.id,node);messages.append(node);}
  const state=activityState.get(node),summary=state.summary;state.item=item;
  const labels={commandExecution:'命令',fileChange:'文件变更',plan:'计划',mcpToolCall:'工具',dynamicToolCall:'工具',collabAgentToolCall:'协作任务',subAgentActivity:'子任务',webSearch:'网页搜索',imageView:'查看图片',imageGeneration:'生成图片',reasoning:'思路摘要',contextCompaction:'整理上下文',enteredReviewMode:'开始审核',exitedReviewMode:'结束审核',sleep:'等待',functionCallOutput:'工具结果',hookPrompt:'工作流提示'};
  const statusLabels={completed:'已完成',failed:'失败',inProgress:'进行中',pending:'等待中'};
  const status=statusLabels[item.status]||item.status||(item.type==='reasoning'?(window.KurumiTiming.reasoning(item)?.live?'进行中':'历史记录'):'进行中');
  const detail=item.command?String(item.command).replace(/\s+/g,' ').slice(0,160):String(item.tool||item.query||item.path||'').slice(0,80);
  const label=`${labels[item.type]||'任务'} · ${status}${detail?' · '+detail:''}`;
  if(state.label!==label){summary.textContent=label;state.label=label;state.clock=null;}
  if(item.type==='reasoning'){const time=window.KurumiTiming.reasoning(item);let clock=state.clock;if(!clock){clock=document.createElement('span');clock.className='thinking-time';summary.append(clock);state.clock=clock;}clock.textContent=time?` · ${time.live?'正在思考':'思考用时'} ${time.estimated?'约 ':''}${window.KurumiTiming.format(time.ms)}`:' · 思考用时未保存';if(time?.live){clock.dataset.thoughtStart=String(item.startedAtMs??item._clientStartedAt);clock.dataset.estimated=String(time.estimated);}else delete clock.dataset.thoughtStart;}
  summary.title=item.command||item.tool||label;
  // Closed tools keep their DOM and defer large output formatting until expanded.
  if(!state.filled||node.open||state.status!==item.status||item.type==='reasoning'||item.type==='plan')fillActivity(state);
  state.status=item.status;
  if(item.type==='imageView'&&typeof item.path==='string'&&state.imagePath!==item.path){state.imageCard?.remove();const button=document.createElement('button');button.type='button';button.className='local-file-preview';button.dataset.path=item.path;button.dataset.kind=/\.svg$/i.test(item.path)?'html':'image';button.textContent='预览图片';const card=document.createElement('span');card.className='local-file-card';card.append(button);node.append(card);state.imageCard=card;state.imagePath=item.path;}
}
function fillActivity(state){
  const {item,pre}=state;let text;
  if(item.type==='commandExecution')text=[item.command&&`命令：${item.command}`,item.cwd&&`目录：${item.cwd}`,item.aggregatedOutput&&limited(item.aggregatedOutput),item.exitCode!=null&&`退出码：${item.exitCode}`].filter(Boolean).join('\n');
  else if(item.type==='fileChange')text=limited((item.changes||[]).map(c=>`${c.kind?.type||'change'} ${c.path||''}\n${c.diff||''}`).join('\n\n'));
  else if(item.type==='plan')text=limited(item.text);
  else if(item.type==='reasoning')text=limited((item.summary||[]).join('\n'));
  else text=limited(JSON.stringify(Object.fromEntries(Object.entries(item).filter(([key])=>!['id','type','content'].includes(key))),null,2));
  if(text!==state.text){pre.textContent=text;state.text=text;}state.filled=true;
}
function showPlan(tab){const el=$('taskPlan');el.replaceChildren();el.hidden=!tab?.plan?.plan?.length;if(el.hidden)return;const title=document.createElement('strong');title.textContent='执行计划';el.append(title);if(tab.plan.explanation){const p=document.createElement('p');p.textContent=tab.plan.explanation;el.append(p)}const list=document.createElement('ol');for(const step of tab.plan.plan){const li=document.createElement('li');li.textContent=`${({pending:'○',inProgress:'◐',completed:'✓'}[step.status]||'○')} ${step.step}`;list.append(li)}el.append(list);}
function updateReview(tab){if($('reviewPanel').hidden&&tab?.threadId){$('reviewButton').disabled=false;return;}const entries=reviewEntries(tab);$('reviewButton').disabled=!tab?.threadId&&!entries.length&&!tab?.reviewComments?.length&&!tab?.reviewDraft;if(!$('reviewPanel').hidden)renderReview(tab,entries);}
function rememberActivity(tab,item){let turn=tab.turns[tab.turns.length-1];if(!turn){turn={items:[]};tab.turns.push(turn)}let existing=turn.items.find(x=>x.id===item.id);if(existing)Object.assign(existing,item);else{existing={...item};turn.items.push(existing)}if(tab.id===activeTabId){if(document.hidden)tab.needsPaint=true;else renderActivity(existing);}return existing;}
function noticeFor(tab,label,text){if(!tab)return;let turn=tab.turns[tab.turns.length-1];if(!turn){turn={items:[]};tab.turns.push(turn)}turn.items.push({type:'clientNotice',label,text});if(tab.id===activeTabId)appendSystem(label,text);}

function renderMessages(tab) {
  for(const map of [pendingMessagePaints,pendingActivityPaints])for(const [key,entry] of map)if(entry.tab===tab)map.delete(key);
  messages.replaceChildren();
  byItem.clear();
  activityNodes.clear();
  if (!tab) return;
  showPlan(tab);updateReview(tab);
  conversation.classList.toggle('has-thread', Boolean(tab.turns.length));
  if (tab.nextCursor) {
    const earlier = document.createElement('button');
    earlier.type = 'button';
    earlier.className = 'load-earlier';
    earlier.textContent = '加载更早的消息';
    earlier.addEventListener('click', () => loadEarlier(tab.id));
    messages.append(earlier);
  }
  renderingMessages=true;
  try{for (const turn of tab.turns || []){for (const item of turn.items || []) renderItem(item);const text=window.KurumiTiming.turnSummary(turn);if(text){const meta=document.createElement('div');meta.className='turn-timing';meta.textContent=text;messages.append(meta);}}}
  finally{renderingMessages=false;}
  requestAnimationFrame(() => {
    if (tab.scrollTop) scroller.scrollTop = tab.scrollTop;
    else scroller.scrollTop = scroller.scrollHeight;
  });
}

/* ---------- Tabs ---------- */
function createTab(data = {}) {
  const incoming=data.settings||{};const fallback=savedPreferences||{};const requestedAccess=incoming.access||fallback.access||'workspace';
  const tab = {
    id: `tab-${++tabSeq}`,
    threadId: data.threadId || null,
    title: data.title || '新对话',
    cwd: data.cwd || null,
    turns: data.turns || [],
    nextCursor: data.nextCursor || null,
    historyWarning: data.historyWarning || null,
    draft: '',
    scrollTop: 0,
    attachments: [],
    uncertain: false,
    historyChecked: false,
    checkingHistory: false,
    needsResume: false,
    plan: null,
    diff: '',
    busy: false,
    submitting: false,
    steering: false,
    completedDuringSubmit: false,
    unsupportedTypes: new Set(),
    turnId: null,
    status: requestedAccess==='full'?'此标签上次使用完全访问；已恢复为工作区写入，需要时请重新确认':'',
    settings:{model:incoming.model??fallback.model??null,effort:incoming.effort??fallback.effort??null,mode:incoming.mode||fallback.mode||'default',access:requestedAccess==='readonly'?'readonly':'workspace'},
    accessReady:false,accessPending:true,legacySettings:!data.settings,fullRestoreNotice:requestedAccess==='full'||(!data.settings&&!!fallback.fullAccessWasDowngraded),reviewComments:Array.isArray(data.reviewComments)?data.reviewComments.slice():[],reviewDraft:data.reviewDraft||null,reviewSelection:null,
  };
  tabs.push(tab);
  api.setTabAccess(tab.id,tab.settings.access).then(value=>{if(!tabs.includes(tab)){api.releaseTab(tab.id).catch(()=>{});return;}tab.settings.access=value;tab.accessReady=true;if(tab.id===activeTabId){accessSelect.value=value;if(tab.fullRestoreNotice)setStatus('此标签上次使用完全访问；已恢复为工作区写入，需要时请重新确认');}}).catch(error=>{if(tab.id===activeTabId)setStatus('标签权限初始化失败：'+error.message);}).finally(()=>{tab.accessPending=false;enable();});
  return tab;
}
function saveActiveTab() {
  const tab = activeTab();
  if (!tab) return;
  tab.draft = input.value;
  tab.scrollTop = scroller.scrollTop;
  tab.attachments = pendingAttachments.slice();
}
function tabTitle(text, fallback = '新对话') {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 34) : fallback;
}
function renderTabs() {
  tabsEl.replaceChildren();
  for (const tab of tabs) {
    const el = document.createElement('div');
    el.className = `tab${tab.id === activeTabId ? ' active' : ''}`;
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', tab.id === activeTabId ? 'true' : 'false');
    el.tabIndex = 0;
    el.title = tab.title;
    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = `${tab.busy?'◌ ':''}${tab.title}`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.textContent = '×';
    close.title = '关闭标签页';
    close.addEventListener('click', (event) => { event.stopPropagation(); closeTab(tab.id); });
    el.addEventListener('click', () => switchTab(tab.id));
    el.addEventListener('auxclick', (event) => { if (event.button === 1) { event.preventDefault(); closeTab(tab.id); } });
    el.addEventListener('keydown', (event) => { if (event.key === 'Enter') switchTab(tab.id); });
    el.append(title, close);
    tabsEl.append(el);
  }
}
function switchTab(id) {
  if (id === activeTabId) return;
  const tab = tabs.find((item) => item.id === id);
  if (!tab) return;
  saveActiveTab();
  activeTabId = id;
  input.value = tab.draft || '';
  pendingAttachments = (tab.attachments || []).slice();
  renderAttachmentTray();
  folderLabel.textContent = tab.cwd || '未选择目录';
  if(tab.cwd)currentFolder=tab.cwd;
  applyTabSettings(tab);
  renderTabs();
  renderMessages(tab);
  drawThreads();
  if (tab.threadId && !tab.needsResume) api.selectThread(tab.threadId, tab.cwd).catch((error) => setStatus(error.message));
  if(tab.needsResume)previewRestored(tab);
  setStatus(tab.status || (tab.threadId ? '已打开对话' : '新对话'));
  enable();
}
function newTab() {
  if(tabs.length>=60){setStatus('最多恢复 60 个标签，请先关闭不需要的标签');return;}
  saveActiveTab();
  const tab = createTab({ cwd: currentFolder });
  activeTabId = tab.id;
  applyTabSettings(tab);
  input.value = '';
  pendingAttachments = [];
  renderAttachmentTray();
  folderLabel.textContent = tab.cwd || '未选择目录';
  renderTabs();
  renderMessages(tab);
  drawThreads();
  setStatus('新对话');
  input.focus();
  enable();
}
async function closeTab(id) {
  if (isBusy(tabs.find(tab=>tab.id===id))) { setStatus('该标签的任务运行中，完成后再关闭'); return; }
  if(id===activeTabId)saveActiveTab();
  const target=tabs.find(tab=>tab.id===id);
  if(target?.accessPending){setStatus('请等待该标签的权限设置完成');return;}
  if(target && (target.uncertain || target.draft?.trim() || target.attachments?.length || target.reviewComments?.length || target.reviewDraft?.text?.trim())){
    try{if(!await api.confirmCloseTab())return;}catch(error){setStatus('无法关闭标签页：'+error.message);return;}
  }
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  const wasActive = id === activeTabId;
  tabs.splice(index, 1);
  api.releaseTab(id).catch(error=>setStatus('清理标签权限失败：'+error.message));
  if (!tabs.length) createTab();
  if (wasActive) {
    activeTabId = tabs[Math.min(index, tabs.length - 1)].id;
    const tab = activeTab();
    applyTabSettings(tab);
    input.value = tab.draft || '';
    pendingAttachments = (tab.attachments || []).slice();
    renderAttachmentTray();
    folderLabel.textContent = tab.cwd || '未选择目录';
    renderMessages(tab);
    if (tab.threadId && !tab.needsResume) api.selectThread(tab.threadId, tab.cwd).catch(() => {});
  }
  renderTabs();
  drawThreads();
  enable();
}
function cycleTabs(direction) {
  if (tabs.length < 2) return;
  const index = tabs.findIndex((tab) => tab.id === activeTabId);
  switchTab(tabs[(index + direction + tabs.length) % tabs.length].id);
}

/* ---------- History ---------- */
async function loadEarlier(tabId) {
  const tab = tabs.find((item) => item.id === tabId);
  if (!tab || !tab.nextCursor || isBusy(tab) || tab.loadingHistory) return;
  tab.loadingHistory = true;
  const cursor=tab.nextCursor;
  const oldHeight = scroller.scrollHeight;
  const oldTop = scroller.scrollTop;
  try {
    setStatus('正在加载更早的消息…');
    const result = await api.loadEarlier(tab.threadId, cursor);
    tab.turns = [...(result.turns || []), ...tab.turns];
    tab.nextCursor = result.nextCursor || null;
    if (tab.id === activeTabId) {
      renderMessages(tab);
      requestAnimationFrame(() => { scroller.scrollTop = oldTop + (scroller.scrollHeight - oldHeight); });
    }
    setStatus('已加载更早的消息');
  } catch (error) { setStatus('加载历史失败：' + error.message); }
  finally { tab.loadingHistory = false; }
}

/* ---------- Attachments ---------- */
function renderAttachmentTray() {
  attachmentTray.replaceChildren();
  attachmentTray.hidden = pendingAttachments.length === 0;
  for (const att of pendingAttachments) attachmentTray.append(attachmentChip(att, true));
  enable();
}
async function addAttachments() {
  if (!ready || isBusy()) return;
  const target=activeTab();
  try {
    const result = await api.chooseFiles();
    addAttachmentResult(target,result);
  } catch (error) { setStatus('添加附件失败：' + error.message); }
}
function addAttachmentResult(tab,result){
  if(!tab||!tabs.includes(tab))return;
  const active=tab.id===activeTabId;
  const existing=active?pendingAttachments:tab.attachments;
  const available=Math.max(0,8-existing.length),incoming=result.files||[];
  existing.push(...incoming.slice(0,available));
  const warnings=[...(result.skipped||[])];if(incoming.length>available)warnings.push('每条消息最多添加 8 个附件');
  tab.attachments=existing.slice();if(active){pendingAttachments=existing;renderAttachmentTray();input.focus();}
  if(warnings.length)setStatus(warnings.join('；'));else if(incoming.length)setStatus(`已添加 ${incoming.length} 个附件${incoming.some(x=>x.extracted)?'；文档仅提取文本，图片未识别':''}`);
  enable();
}
async function addDropped(files){
  if(!ready||isBusy())return;const tab=activeTab();
  try{const paths=api.droppedPaths(Array.from(files));if(!paths.length){setStatus('无法读取拖入文件的路径');return;}setStatus('正在读取附件…');addAttachmentResult(tab,await api.readDroppedFiles(paths));}
  catch(error){setStatus('添加附件失败：'+error.message);}
}
for(const name of ['dragenter','dragover'])document.addEventListener(name,event=>{if(event.dataTransfer?.types?.includes('Files')){event.preventDefault();document.querySelector('.composer-wrap').classList.add('dragging');}});
document.addEventListener('dragleave',event=>{if(!event.relatedTarget)document.querySelector('.composer-wrap').classList.remove('dragging')});
document.addEventListener('drop',event=>{if(!event.dataTransfer?.types?.includes('Files'))return;event.preventDefault();document.querySelector('.composer-wrap').classList.remove('dragging');addDropped(event.dataTransfer.files);});
input.addEventListener('paste',async event=>{if(!ready||isBusy()||!Array.from(event.clipboardData?.items||[]).some(item=>item.kind==='file'&&item.type.startsWith('image/')))return;event.preventDefault();const tab=activeTab();try{setStatus('正在读取剪贴板图片…');addAttachmentResult(tab,await api.pasteImage());}catch(error){setStatus('粘贴图片失败：'+error.message)}});

/* ---------- Models / status ---------- */
function updateEfforts(preferredEffort = undefined) {
  const model = catalog.find((x) => x.id === modelSelect.value);
  effortSelect.replaceChildren();
  for (const effort of model?.efforts || []) {
    const opt = document.createElement('option');
    opt.value = effort;
    opt.textContent = ({ low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高', ultra: '超高' }[effort] || effort);
    effortSelect.append(opt);
  }
  const wanted = preferredEffort === undefined ? savedPreferences?.effort : preferredEffort;
  if (wanted && model?.efforts.includes(wanted)) effortSelect.value = wanted;
  else if (model?.defaultReasoningEffort && model.efforts.includes(model.defaultReasoningEffort)) effortSelect.value = model.defaultReasoningEffort;
  enable();
}
function applyTabSettings(tab){
  if(!tab)return;
  modeSelect.value=tab.settings.mode;accessSelect.value=tab.settings.access;$('accessNotice').hidden=!tab.fullRestoreNotice;
  modelSelect.querySelectorAll('option[data-unavailable]').forEach(option=>option.remove());
  if(!catalog.length)return;
  let model=catalog.find(item=>item.id===tab.settings.model);
  if(tab.settings.model&&!model){const option=document.createElement('option');option.value=tab.settings.model;option.textContent=`${tab.settings.model}（不可用，请重新选择）`;option.disabled=true;option.dataset.unavailable='true';modelSelect.append(option);modelSelect.value=tab.settings.model;effortSelect.replaceChildren();return;}
  model=model||catalog.find(item=>item.id===savedPreferences?.model)||catalog.find(item=>item.isDefault)||catalog[0];
  if(model){modelSelect.value=model.id;tab.settings.model=model.id;updateEfforts(tab.settings.effort);tab.settings.effort=effortSelect.value||null;}
}
async function loadPreferences() {
  try {
    savedPreferences = await api.getPreferences();
    if(savedPreferences?.fullAccessWasDowngraded){for(const tab of tabs)if(tab.legacySettings){tab.fullRestoreNotice=true;tab.status='此标签原先使用完全访问；已恢复为工作区写入，需要时请重新确认';}}
  } catch (error) {
    savedPreferences = { model: null, effort: null, mode: 'default', access: 'workspace' };
    setStatus('偏好读取失败：' + error.message);
  } finally {
    preferencesReady = true;
  }
}
function schedulePreferenceSave(immediate = false) {
  if (!preferencesReady || !savedPreferences) return;
  savedPreferences = {
    model: modelSelect.value || null,
    effort: effortSelect.value || null,
    mode: modeSelect.value || 'default',
    access: savedPreferences.access==='readonly'?'readonly':'workspace',
  };
  if (preferenceSaveTimer) clearTimeout(preferenceSaveTimer);
  const flush = () => {
    preferenceSaveTimer = null;
    const {access,...patch}=savedPreferences;api.savePreferences(patch).catch((error) => setStatus('偏好保存失败：' + error.message));
  };
  if (immediate) flush();
  else preferenceSaveTimer = setTimeout(flush, 180);
}
async function loadModels() {
  try {
    catalog = await api.models();
    modelSelect.replaceChildren();
    for (const model of catalog) {
      const opt = document.createElement('option');
      opt.value = model.id;
      opt.textContent = model.displayName;
      modelSelect.append(opt);
    }
    if(!catalog.length)setStatus('当前账号没有可选模型');
    if(activeTab())applyTabSettings(activeTab());
  } catch (error) {
    catalog = [];
    modelSelect.replaceChildren();
    setStatus('模型读取失败：' + error.message);
    enable();
  }
}
function drawThreads(){
  const priorScroll=recentThreads.scrollTop;
  recentThreads.replaceChildren();
  const groups=new Map();
  for(const thread of threadRows){
    const pinned=thread.section?.name==='Pinned';
    const folder=thread.cwd||'未分配项目';const project=folder.split(/[\\/]/).filter(Boolean).pop()||folder;
    const key=pinned?'pinned':`${thread.section?.id||''}\u0000${folder}`;
    if(!groups.has(key))groups.set(key,{pinned,label:pinned?'☆ 已置顶':`${thread.section?.name?thread.section.name+' · ':''}${project}`,title:folder,items:[]});groups.get(key).items.push(thread);
  }
  const ordered=[...groups.values()].sort((a,b)=>a.pinned?-1:b.pinned?1:a.label.localeCompare(b.label));
  for(const group of ordered){
    const groupId=`${group.pinned?'pinned':group.title}\u0000${group.label}`;const collapsed=collapsedThreadGroups.has(groupId);
    const label=document.createElement('button');label.type='button';label.className='thread-group';label.title=group.title;label.setAttribute('aria-expanded',String(!collapsed));label.textContent=`${collapsed?'▸':'▾'} ${group.label}`;label.addEventListener('click',()=>{if(collapsedThreadGroups.has(groupId))collapsedThreadGroups.delete(groupId);else collapsedThreadGroups.add(groupId);drawThreads();});recentThreads.append(label);
    if(collapsed)continue;
    for(const thread of group.items){
      const row=document.createElement('div');row.className='thread-row';
      const button=document.createElement('button');button.className=`nav-item${activeTab()?.threadId===thread.id?' active':''}`;button.title=thread.name;button.textContent=thread.name||'未命名对话';button.addEventListener('click',()=>threadArchived?editThread(thread):openThread(thread));
      const more=document.createElement('button');more.className='thread-options';more.type='button';more.title='整理对话';more.setAttribute('aria-label',`整理对话：${thread.name}`);more.textContent='⋯';more.addEventListener('click',()=>editThread(thread));row.append(button,more);recentThreads.append(row);
    }
  }
  if(!threadRows.length&&!threadLoading){const empty=document.createElement('div');empty.className='thread-group';empty.textContent='没有符合条件的对话';recentThreads.append(empty);}
  $('moreThreads').hidden=!threadCursor;$('moreThreads').disabled=threadLoading;
  recentThreads.scrollTop=priorScroll;
}
async function refreshThreads(append=false) {
  if(append&&(threadLoading||!threadCursor))return;
  const version=append?threadListVersion:++threadListVersion, cursor=append?threadCursor:null;
  if(!append){threadRows=[];threadCursor=null;}threadLoading=true;drawThreads();
  try {
    const result=await api.listThreads({cursor,search:threadQuery,archived:threadArchived});
    if(version!==threadListVersion)return;
    const seen=new Set(threadRows.map(item=>item.id));for(const item of result.data||[])if(!seen.has(item.id)){threadRows.push(item);seen.add(item.id);}threadCursor=result.nextCursor||null;
  } catch(error){if(version===threadListVersion)setStatus('无法读取对话：'+error.message);}
  finally{if(version===threadListVersion){threadLoading=false;drawThreads();}}
}
async function refreshSections(){try{sections=await api.listSections();}catch(error){sections=[];setStatus('分组暂不可用：'+error.message);}}
async function editThread(thread){
  selectedThread=thread;editingNewSection=false;await refreshSections();
  $('threadDialogTitle').textContent=threadArchived?'已归档的对话':'整理对话';$('threadDialogDetail').textContent=threadArchived?'恢复后可在普通列表中打开。':'对话按工作目录显示；置顶会移动到 Codex 的置顶分组。';
  $('threadNameLabel').hidden=threadArchived;$('threadSectionLabel').hidden=threadArchived;$('threadSave').hidden=threadArchived;$('threadPin').hidden=threadArchived;
  $('threadNameInput').value=thread.name||'';const select=$('threadSectionInput');select.replaceChildren();
  const ungrouped=document.createElement('option');ungrouped.value='';ungrouped.textContent='未分组';select.append(ungrouped);
  for(const section of sections){const option=document.createElement('option');option.value=section.id;option.textContent=section.name==='Pinned'?'置顶':section.name;select.append(option);}
  select.value=thread.section?.id||'';$('threadPin').textContent=thread.section?.name==='Pinned'?'取消置顶':'置顶';$('threadArchive').textContent=threadArchived?'恢复对话':'归档';$('threadArchive').hidden=false;$('threadDialogError').textContent='';$('threadDialog').showModal();
}
$('newSection').addEventListener('click',()=>{editingNewSection=true;selectedThread=null;$('threadDialogTitle').textContent='新建对话分组';$('threadDialogDetail').textContent='创建后可从对话的整理菜单中选择分组。';$('threadNameLabel').hidden=false;$('threadNameInput').value='';$('threadSectionLabel').hidden=true;$('threadArchive').hidden=true;$('threadPin').hidden=true;$('threadSave').hidden=false;$('threadDialogError').textContent='';$('threadDialog').showModal();$('threadNameInput').focus();});
$('threadCancel').addEventListener('click',()=>$('threadDialog').close());
$('threadForm').addEventListener('submit',async event=>{event.preventDefault();const save=$('threadSave');save.disabled=true;try{const name=$('threadNameInput').value.trim();if(!name)throw Error('请输入名称');if(editingNewSection)await api.createSection(name);else if(selectedThread){if(name!==selectedThread.name)await api.renameThread(selectedThread.id,name);const next=$('threadSectionInput').value||null;if(next!==(selectedThread.section?.id||null))await api.moveThreadSection(selectedThread.id,next);for(const tab of tabs)if(tab.threadId===selectedThread.id)tab.title=tabTitle(name);renderTabs();}await refreshSections();$('threadDialog').close();refreshThreads();enable();}catch(error){$('threadDialogError').textContent=error.message;}finally{save.disabled=false;}});
$('threadPin').addEventListener('click',async()=>{const button=$('threadPin');button.disabled=true;try{const pinned=sections.find(section=>section.name==='Pinned');if(!pinned)throw Error('当前 Codex 版本未提供置顶分组');await api.moveThreadSection(selectedThread.id,selectedThread.section?.id===pinned.id?null:pinned.id);$('threadDialog').close();refreshThreads();}catch(error){$('threadDialogError').textContent=error.message;}finally{button.disabled=false;}});
$('threadArchive').addEventListener('click',async()=>{const button=$('threadArchive');button.disabled=true;try{if(!threadArchived&&tabs.some(tab=>tab.threadId===selectedThread.id))throw Error('请先关闭此对话的标签页，再归档。');await api.archiveThread(selectedThread.id,!threadArchived);$('threadDialog').close();refreshThreads();}catch(error){$('threadDialogError').textContent=error.message;}finally{button.disabled=false;}});
let threadSearchTimer=null;
$('threadSearch').addEventListener('input',()=>{clearTimeout(threadSearchTimer);threadSearchTimer=setTimeout(()=>{threadQuery=$('threadSearch').value.trim();refreshThreads();},250);});
$('archiveToggle').addEventListener('click',()=>{threadArchived=!threadArchived;$('archiveToggle').textContent=threadArchived?'返回':'归档';refreshThreads();});
$('moreThreads').addEventListener('click',()=>refreshThreads(true));
async function openThread(thread) {
  const existing = tabs.find((tab) => tab.threadId === thread.id);
  if (existing) { switchTab(existing.id); return; }
  if(tabs.length>=60){setStatus('最多恢复 60 个标签，请先关闭不需要的标签');return;}
  saveActiveTab();
  const previousTabId = activeTabId;
  const tab = createTab({ threadId: thread.id, title: tabTitle(thread.name || thread.preview), cwd: thread.cwd || currentFolder });
  activeTabId = tab.id;
  applyTabSettings(tab);
  input.value = '';
  pendingAttachments = [];
  renderAttachmentTray();
  folderLabel.textContent = tab.cwd || '未选择目录';
  renderTabs();
  renderMessages(tab);
  drawThreads();
  tab.busy = true; enable();
  try {
    setTabStatus(tab,'正在打开对话…');
    const result = await api.resumeThread(thread.id);
    tab.threadId = result.id;
    tab.openedRunning=!!result.runningTurnId;if(result.runningTurnId)tab.turnId=result.runningTurnId;
    tab.cwd = result.cwd || tab.cwd;
    tab.turns = result.turns || [];
    tab.nextCursor = result.nextCursor || null;
    tab.historyWarning = result.historyWarning || null;
    tab.title = tabTitle(thread.name || thread.preview || contentText(tab.turns[0]?.items?.[0] || {}));
    if(activeTabId===tab.id){currentFolder=tab.cwd||currentFolder;folderLabel.textContent=tab.cwd||'未选择目录';}
    renderTabs();
    if(activeTabId===tab.id)renderMessages(tab);
    if (tab.historyWarning) noticeFor(tab,'历史读取提示', tab.historyWarning);
    if (result.branched) noticeFor(tab,'分支已创建', '原对话被其他客户端占用；新消息将写入新分支。');
    setTabStatus(tab,tab.historyWarning || (result.branched ? '已创建分支，可以继续发送' : '已打开历史对话，可以继续发送'));
  } catch (error) {
    const message = error.message;
    tabs = tabs.filter((item) => item.id !== tab.id);
    if(activeTabId===tab.id){activeTabId=null;if(tabs.some((item)=>item.id===previousTabId))switchTab(previousTabId);else if(tabs.length)switchTab(tabs[0].id);else newTab();setStatus('无法打开对话：'+message);}
    else setStatus('后台打开对话失败：'+message);
  } finally { tab.busy=!!tab.openedRunning;delete tab.openedRunning;renderTabs();enable(); }
}

/* ---------- Sending / events ---------- */
async function submit() {
  const text = input.value.trim();
  const tab = activeTab();
  if (!tab || (!text && !pendingAttachments.length) || !ready || compatibilityStatus!=='ok' || !tab.accessReady || tab.accessPending || !catalog.some(model=>model.id===modelSelect.value) || tab.uncertain) return;
  if(isBusy(tab)){await steer(tab,text);return;}
  tab.busy=true;tab.submitting=true;tab.completedDuringSubmit=false;tab.turnId=null;enable();renderTabs();
  const attachments = pendingAttachments.slice();
  tab.draft=input.value;tab.attachments=attachments.slice();
  const chosenModel=modelSelect.value,chosenEffort=effortSelect.value||null,chosenMode=modeSelect.value;
  const previousTitle=tab.title;
  const previousPlan=tab.plan,previousDiff=tab.diff;tab.plan=null;tab.diff='';if(tab.id===activeTabId){showPlan(tab);updateReview(tab);}
  let pendingTurn = null;
  let attemptedSend = false;
  try {
    if(tab.needsResume && tab.threadId){
      const resumed=await api.resumeThread(tab.threadId);
      tab.threadId=resumed.id;tab.cwd=resumed.cwd||tab.cwd;tab.turns=resumed.turns||[];tab.nextCursor=resumed.nextCursor||null;tab.needsResume=false;
      if(tab.id===activeTabId){folderLabel.textContent=tab.cwd;renderMessages(tab);}
      if(resumed.branched)noticeFor(tab,'分支已创建','原对话被其他客户端占用；新消息将写入新分支。');
    }
    if (!tab.threadId) {
      const result = await api.newThread(tab.cwd,tab.id);
      tab.threadId = result.id;
    tab.openedRunning=!!result.runningTurnId;if(result.runningTurnId)tab.turnId=result.runningTurnId;
      tab.cwd = result.cwd;
      if(tab.id===activeTabId)folderLabel.textContent = tab.cwd;
    }
    await persistRecovery();
    const content = [];
    if (text) content.push({ type: 'text', text });
    for (const att of attachments) {
      if (att.kind === 'image') content.push({ type: 'image', name: att.name, url: att.dataUrl });
      else content.push({ type: 'text', text: `[附件：${att.name}]` });
    }
    const turn = { items: [{ type: 'userMessage', id: newId('user'), content }] };
    pendingTurn = turn;
    tab.turns.push(turn);
    tab.title = tabTitle(text || attachments[0]?.name || tab.title);
    renderTabs();
    if(tab.id===activeTabId){renderMessages(tab);scrollBottom(true);}
    setTabStatus(tab,'Codex 正在工作…');
    attemptedSend = true;
    const response = await api.sendMessage(text, {
      model: chosenModel,
      effort: chosenEffort,
      mode: chosenMode,
      tabId:tab.id,
      attachments,
      threadId: tab.threadId,
      cwd: tab.cwd,
    });
    if(!response?.ok){const error=new Error(response?.message||'发送请求未完成');error.delivery=response?.delivery||'unknown';throw error;}
    if(!tab.completedDuringSubmit&&response.result?.turn?.id)tab.turnId=response.result.turn.id;
    tab.draft='';tab.attachments=[];if(tab.id===activeTabId){input.value='';pendingAttachments=[];renderAttachmentTray();}
    tab.submitting=false;if(tab.completedDuringSubmit)tab.busy=false;renderTabs();enable();
  } catch (error) {
    const unknown=error.delivery==='unknown'||(!error.delivery&&attemptedSend);
    if(!unknown){tab.plan=previousPlan;tab.diff=previousDiff;if(pendingTurn){tab.turns=tab.turns.filter((turn)=>turn!==pendingTurn);tab.title=previousTitle;renderTabs();}if(tab.id===activeTabId)renderMessages(tab);}
    if(unknown){tab.uncertain=true;tab.historyChecked=false;}else{tab.uncertain=false;tab.historyChecked=false;}
    if(tab.id===activeTabId)tab.draft=input.value;
    tab.attachments=attachments.slice();
    if(tab.id===activeTabId)renderAttachmentTray();
    tab.submitting=false;tab.busy=false;renderTabs();enable();
    setTabStatus(tab,(unknown?'发送结果不明，请先检查历史：':'消息未发送：') + explainError(error.message));
    noticeFor(tab,unknown?'执行状态不明':'消息未发送', explainError(error.message));
  }
}

async function steer(tab,text){
  if(!text||!tab.turnId||tab.submitting||tab.steering)return;
  if(pendingAttachments.length){setStatus('补充消息暂不支持附件，请先移除附件');return;}
  tab.steering=true;enable();
  try{
    await persistRecovery();
    const result=await api.steerTurn(tab.threadId,tab.turnId,text);
    if(!result?.ok){const error=new Error(result?.message||'补充消息未完成');error.delivery=result?.delivery||'unknown';throw error;}
    let turn=tab.turns[tab.turns.length-1];if(!turn){turn={items:[]};tab.turns.push(turn);}turn.items.push({type:'userMessage',id:newId('steer'),content:[{type:'text',text}]});
    tab.draft='';if(tab.id===activeTabId){input.value='';renderMessages(tab);scrollBottom(true);}setTabStatus(tab,'补充消息已提交');
  }catch(error){const unknown=error.delivery==='unknown';if(unknown){tab.uncertain=true;tab.historyChecked=false;}setTabStatus(tab,(unknown?'补充消息状态不明，请核对历史：':'补充消息未发送：')+explainError(error.message));}
  finally{tab.steering=false;enable();}
}

function ensureLiveAssistant(tab, id) {
  let turn = tab.turns[tab.turns.length - 1];
  if (!turn) { turn = { items: [] }; tab.turns.push(turn); }
  let item = turn.items.find((entry) => entry.type === 'agentMessage' && entry.id === id);
  if (!item) {
    item = { type: 'agentMessage', id, text: '' };
    turn.items.push(item);
  }
  return item;
}
function paintAssistant(tab,item,final=false){
  if(tab.id!==activeTabId)return;
  if(document.hidden){tab.needsPaint=true;return;}
  const stick=nearBottom();let body=byItem.get(item.id);
  const now=performance.now();let state=body&&streamState.get(body);
  if(final&&state?.final&&state.source===item.text)return;
  const interval=item.text.length>128000?650:item.text.length>48000?350:item.text.length>12000?200:90;
  if(!body){body=appendAssistant(item.text,item.id);state={source:item.text,at:now,tail:null,final};streamState.set(body,state);}
  else if(!final&&state&&item.text.startsWith(state.source)&&now-state.at<interval){if(!state.tail){state.tail=document.createElement('span');state.tail.className='stream-tail';body.append(state.tail);}state.tail.textContent=item.text.slice(state.source.length);}
  else{body.innerHTML=renderMarkdown(item.text,final);streamState.set(body,{source:item.text,at:now,tail:null,final});}
  if(stick)scrollBottom(true);
}
function schedulePaint(map,tab,item,paint){
  if(tab.id!==activeTabId)return;
  if(document.hidden){tab.needsPaint=true;return;}
  map.set(`${tab.id}:${item.id}`,{tab,item,paint});
  if(paintFrame===null)paintFrame=requestAnimationFrame(flushPaints);
}
function flushPaints(){paintFrame=null;const started=performance.now();for(const map of [pendingMessagePaints,pendingActivityPaints]){for(const [key,{tab,item,paint}] of map){map.delete(key);if(tab.id===activeTabId)paint(tab,item);if(performance.now()-started>8)break;}if(performance.now()-started>8)break;}if(pendingMessagePaints.size||pendingActivityPaints.size)paintFrame=requestAnimationFrame(flushPaints);}
function cancelPaint(map,tab,itemId){map.delete(`${tab.id}:${itemId}`);}
document.addEventListener('visibilitychange',()=>{if(!document.hidden){const tab=activeTab();if(tab?.needsPaint){tab.needsPaint=false;renderMessages(tab);}}});

sendButton.addEventListener('click', submit);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit(); }
});
input.addEventListener('input',enable);
stopButton.addEventListener('click', () => {const tab=activeTab();if(tab?.threadId)api.interrupt(tab.threadId).then(result=>setTabStatus(tab,result?.queued?'已请求停止，任务启动后会中断':result?.requested?'已请求停止':'任务正在启动，请稍后重试')).catch((error) => setTabStatus(tab,error.message));});
attachButton.addEventListener('click', addAttachments);
newTabButton.addEventListener('click', newTab);
document.querySelector('.new-session').addEventListener('click', newTab);
modelSelect.addEventListener('change', () => {const tab=activeTab();if(!tab)return;tab.settings.model=modelSelect.value;updateEfforts(null);tab.settings.effort=effortSelect.value||null;schedulePreferenceSave();enable();});
effortSelect.addEventListener('change', () => {const tab=activeTab();if(tab)tab.settings.effort=effortSelect.value||null;schedulePreferenceSave();enable();});
modeSelect.addEventListener('change', () => {const tab=activeTab();if(tab)tab.settings.mode=modeSelect.value;schedulePreferenceSave();enable();});
accessSelect.addEventListener('change', async () => {
  const tab=activeTab();if(!tab||tab.accessPending)return;
  const proposed = accessSelect.value;tab.accessPending=true;enable();
  try {
    tab.settings.access=await api.setTabAccess(tab.id,proposed);tab.accessReady=true;
    const canceled=proposed==='full'&&tab.settings.access!=='full';
    if(!canceled)tab.fullRestoreNotice=false;
    if(activeTabId===tab.id){accessSelect.value=tab.settings.access;$('accessNotice').hidden=!tab.fullRestoreNotice;setStatus(canceled?'已取消完全访问，此标签保留原有权限':'此标签的权限已更新，将用于下一条消息');}
  } catch (error) {
    if(activeTabId===tab.id){accessSelect.value=tab.settings.access;setStatus('权限设置失败：' + error.message);}
  } finally {tab.accessPending=false;enable();}
});
$('chooseFolder').addEventListener('click', async () => {
  if (isBusy()) { setStatus('请先等待当前标签的任务完成'); return; }
  try {
    const result = await api.chooseFolder();
    currentFolder = result.cwd;
    folderLabel.textContent = result.cwd;
    const tab = activeTab();
    if (tab && result.changed) tab.cwd = result.cwd;
    if (result.changed) setStatus('工作目录已更新');
  } catch (error) { setStatus(error.message); }
});
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key === 't') { event.preventDefault(); newTab(); }
  if (event.key === 'w') { event.preventDefault(); if (activeTabId) closeTab(activeTabId); }
  if (event.key === 'Tab') { event.preventDefault(); cycleTabs(event.shiftKey ? -1 : 1); }
});
messages.addEventListener('click', (event) => {
  const videoButton=event.target.closest('.local-video-preview');
  if(videoButton){
    const file=videoButton.dataset.path,cwd=activeTab()?.cwd||'',audio=videoButton.dataset.kind==='audio';videoButton.disabled=true;
    (audio?api.resolveLocalAudio(file,cwd):api.resolveLocalVideo(file,cwd)).then(url=>{
      if(!videoButton.isConnected)return;
      const box=document.createElement('span');box.className='local-video-box';
      const media=document.createElement(audio?'audio':'video');media.controls=true;media.preload='metadata';media.src=url;
      const info=document.createElement('small');info.textContent=audio?'本地音频':'本地视频';
      const open=document.createElement('button');open.type='button';open.className='local-video-open';open.textContent='用系统播放器打开';open.dataset.path=file;open.dataset.cwd=cwd;open.dataset.kind=audio?'audio':'video';
      media.addEventListener('error',()=>{info.textContent='无法在客户端播放，可尝试系统播放器';});
      box.append(media,info,open);videoButton.replaceWith(box);
    }).catch(error=>{videoButton.disabled=false;setStatus('无法预览媒体：'+error.message);});return;
  }
  const openVideo=event.target.closest('.local-video-open');
  if(openVideo){const d=openVideo.dataset;(d.kind==='audio'?api.openLocalAudio(d.path,d.cwd):api.openLocalVideo(d.path,d.cwd)).catch(error=>setStatus('无法打开媒体：'+error.message));return;}
  const fileButton=event.target.closest('.local-file-preview');
  if(fileButton){const file=fileButton.dataset.path,cwd=activeTab()?.cwd||'',kind=fileButton.dataset.kind;fileButton.disabled=true;
    const card=fileButton.closest('.local-file-card'),existing=card.querySelector('.local-image-preview');
    if(kind==='image'&&existing){existing.remove();fileButton.textContent=fileButton.dataset.label;fileButton.disabled=false;return;}
    if(kind==='text'){api.readLocalText(file,cwd).then(result=>{$('textFileTitle').textContent=result.path;const pre=$('textFileContent');const alternative=$('textFileAlternative');alternative.hidden=!result.missing;alternative.dataset.path=result.alternative||'';pre.textContent=result.missing?'此旧版本文件已不在本机。可选择查看当前已安装插件的对应文件，内容可能与历史版本不同。':result.text.split('\n').map((line,i)=>`${i+1}  ${line}`).join('\n');$('textFileDialog').showModal();pre.scrollTop=Math.max(0,(Number(fileButton.dataset.line||1)-1)*20);}).catch(error=>setStatus('无法读取文本：'+error.message)).finally(()=>fileButton.disabled=false);return;}
    const action=kind==='image'?api.resolveLocalImage(file,cwd).then(url=>{if(!fileButton.isConnected)return;const image=document.createElement('img');image.className='local-image-preview';image.alt=fileButton.textContent;image.src=url;image.addEventListener('error',()=>setStatus('图片无法显示，请检查格式或使用文件位置'));fileButton.dataset.label=fileButton.textContent;fileButton.textContent='收起图片';card.append(image);}):api.previewLocalFile(file,cwd).then(()=>setStatus(kind==='html'?'已打开离线预览窗口，网络资源已关闭':'已请求系统应用打开文件'));
    action.catch(error=>setStatus('无法打开文件：'+error.message)).finally(()=>{if(fileButton.isConnected)fileButton.disabled=false;});return;}
  const reveal=event.target.closest('.local-file-reveal');
  if(reveal){api.revealLocalFile(reveal.dataset.path,activeTab()?.cwd||'').catch(error=>setStatus('无法显示文件位置：'+error.message));return;}
  const copy = event.target.closest('.copy-code');
  if (copy) {
    const code = copy.closest('.code-block')?.querySelector('code')?.textContent || '';
    api.copyText(code).then(() => { copy.textContent = '已复制'; setTimeout(() => { copy.textContent = '复制'; }, 1200); }).catch(() => {});
    return;
  }
  const link = event.target.closest('a[href]');
  if (link) { event.preventDefault(); api.openExternal(link.href).catch(() => {}); }
});

async function onReady() {
  if (ready) return;
  const first=!readyStarted;
  readyStarted = true;
  ready = true;
  connectionFailed = false;
  setStatus('Codex 已连接 · 正在执行兼容检查…');
  await recoveryLoaded;
  await loadPreferences();
  await loadModels();
  try{const report=await api.diagnostics();if(report)applyDiagnostics(report);}catch(error){compatibilityStatus='blocked';setStatus('兼容检查不可用：'+error.message);}
  refreshThreads();
  if (first && !tabs.length) {
    const tab = createTab({ cwd: currentFolder });
    activeTabId = tab.id;
    applyTabSettings(tab);
    folderLabel.textContent = tab.cwd || '未选择目录';
    renderTabs();
    renderMessages(tab);
  }
  if(first&&activeTab()?.needsResume)previewRestored(activeTab());
  if(recoveryError)setStatus('恢复数据读取失败，原文件已保留：'+recoveryError);
  enable();
}

const recoveryLoaded=restoreSession();
api.currentFolder().then((folder) => {
  const tab = activeTab();
  currentFolder = tab?.cwd || folder;
  folderLabel.textContent = currentFolder;
  if (tab && !tab.threadId && !tab.cwd) tab.cwd = folder;
}).catch((error) => setStatus(error.message));
api.getStatus().then((state) => { if (state.ready) onReady();else if(state.error){connectionFailed=true;setStatus('连接错误：'+state.error);enable();} }).catch(() => {});
api.onStatus((state) => {
  if (state.ready) onReady();
  if (state.error) {
    for(const item of tabs){if(item.busy&&item.threadId){item.uncertain=true;item.historyChecked=false;}if(item.threadId)item.needsResume=true;if(!item.submitting)item.busy=false;}
    ready = false;compatibilityStatus='checking';connectionFailed=true;setStatus('连接错误：' + state.error);renderTabs();enable();
  }
  if (state.warning) appendSystem('提示', state.warning);
});
api.onEvent((event) => {
  const params = event.params || {};
  const tab = params.threadId ? tabs.find(item=>item.threadId===params.threadId) : null;
  if(!tab)return;
  const visible=tab.id===activeTabId,turnId=params.turnId||params.turn?.id;
  if(tab.turnId&&turnId&&tab.turnId!==turnId)return;
  if(tab.remoteControlled&&event.method==='item/completed'&&params.item?.type==='userMessage'){let turn=tab.turns.at(-1);if(!turn){turn={id:tab.turnId,items:[]};tab.turns.push(turn);}const incoming=params.item;const existing=turn.items.find(x=>x.id===incoming.id||(x.type==='userMessage'&&contentText(x)===contentText(incoming)));if(existing)Object.assign(existing,incoming);else{turn.items.push(incoming);if(visible)renderItem(incoming);}}
  if(['item/started','item/completed'].includes(event.method)&&params.item?.type==='reasoning'){const existing=tab.turns.flatMap(t=>t.items||[]).find(x=>x.id===params.item.id);params.item._clientStartedAt=existing?._clientStartedAt??Date.now();if(event.method==='item/completed')params.item._clientCompletedAt=Date.now();}
  if(event.method==='turn/started'&&params.turn?.id){tab.busy=true;tab.turnId=params.turn.id;const turn=tab.turns[tab.turns.length-1];if(turn){if(!turn.id)turn.id=params.turn.id;turn.startedAt=params.turn.startedAt??turn.startedAt??Date.now()/1000;}if(visible)enable();}
  if (event.method === 'item/agentMessage/delta') {
    const itemId = params.itemId || 'current';
    const item = ensureLiveAssistant(tab, itemId);
    item.text += params.delta || '';
    if(visible)schedulePaint(pendingMessagePaints,tab,item,paintAssistant);
  }
  if ((event.method === 'item/started'||event.method === 'item/completed') && activityTypes.has(params.item?.type) && tab){cancelPaint(pendingActivityPaints,tab,params.item.id);rememberActivity(tab,{...params.item,status:params.item.status||(event.method==='item/completed'?'completed':'inProgress')});if(visible&&params.item.type==='fileChange')updateReview(tab);}
  if(event.method==='item/completed'&&params.item?.type&&!['userMessage','agentMessage'].includes(params.item.type)&&!activityTypes.has(params.item.type)&&!tab.unsupportedTypes.has(params.item.type)){tab.unsupportedTypes.add(params.item.type);noticeFor(tab,'暂不支持的项目',`当前客户端不能完整显示此类任务过程（${String(params.item.type).slice(0,80)}），可在原生 Codex 中查看。`);}
  if (event.method === 'item/commandExecution/outputDelta'){const turn=tab.turns[tab.turns.length-1];const item=turn?.items?.find(x=>x.id===params.itemId);if(item){item.aggregatedOutput=limited((item.aggregatedOutput||'')+(params.delta||''));if(visible)schedulePaint(pendingActivityPaints,tab,item,(_tab,value)=>renderActivity(value));}}
  if (event.method === 'item/plan/delta'){const turn=tab.turns[tab.turns.length-1];let item=turn?.items?.find(x=>x.id===params.itemId);if(!item)item=rememberActivity(tab,{type:'plan',id:params.itemId,text:''});item.text=limited((item.text||'')+(params.delta||''));if(visible)schedulePaint(pendingActivityPaints,tab,item,(_tab,value)=>renderActivity(value));}
  if(event.method==='item/reasoning/summaryTextDelta'){const turn=tab.turns[tab.turns.length-1];let item=turn?.items?.find(x=>x.id===params.itemId);if(!item)item=rememberActivity(tab,{type:'reasoning',id:params.itemId,summary:[]});if(!Array.isArray(item.summary))item.summary=[];const index=Number.isInteger(params.summaryIndex)&&params.summaryIndex>=0&&params.summaryIndex<100?params.summaryIndex:0;item.summary[index]=limited((item.summary[index]||'')+(params.delta||''));if(visible)schedulePaint(pendingActivityPaints,tab,item,(_tab,value)=>renderActivity(value));}
  if (event.method === 'turn/plan/updated'){tab.plan={plan:params.plan||[],explanation:params.explanation};if(visible)showPlan(tab);}
  if (event.method === 'turn/diff/updated'){tab.diff=String(params.diff||'');const turn=tab.turns[tab.turns.length-1];if(turn){if(!turn.id&&(params.turnId||tab.turnId))turn.id=params.turnId||tab.turnId;turn.reviewDiff=tab.diff;}if(visible)updateReview(tab);}
  if (event.method === 'item/completed' && params.item?.type === 'agentMessage') {
    const item = ensureLiveAssistant(tab, params.item.id);
    item.text = params.item.text || item.text;
    cancelPaint(pendingMessagePaints,tab,item.id);if(visible)paintAssistant(tab,item,true);
  }
  if (event.method === 'turn/completed') {
    if(tab.submitting)tab.completedDuringSubmit=true;else tab.busy=false;if('openedRunning' in tab)tab.openedRunning=false;tab.turnId=null;enable();
    const turn = params.turn || {};
    const completedTurn=tab.turns.find(t=>t.id===turn.id)||tab.turns.at(-1);for(const item of completedTurn?.items||[])if(item.type==='agentMessage'){cancelPaint(pendingMessagePaints,tab,item.id);if(visible)paintAssistant(tab,item,true);}
    const savedTurn=tab.turns.find(x=>x.id===turn.id)||tab.turns.at(-1);if(savedTurn){savedTurn.completedAt=turn.completedAt??Date.now()/1000;if(typeof turn.durationMs==='number')savedTurn.durationMs=turn.durationMs;const text=window.KurumiTiming.turnSummary(savedTurn);if(visible&&text){const meta=document.createElement('div');meta.className='turn-timing';meta.textContent=text;messages.append(meta);}}
    setTabStatus(tab,turn.status === 'completed' ? '任务完成' : turn.status==='failed'?'任务失败：消息已提交，请检查执行结果':turn.status==='interrupted'?'任务已中断：消息已提交':'任务状态未知，请检查历史');
    if (turn.error) noticeFor(tab,'任务错误（消息已提交）', explainError(turn.error.message || JSON.stringify(turn.error)));
    refreshThreads();
    renderTabs();
  }
  if (event.method === 'error' && !params.willRetry) noticeFor(tab,'错误', params.error?.message || '任务发生错误');
});
function diffFiles(value){
  const text=String(value||'');const chunks=text.split(/(?=^diff --git )/m).filter(part=>part.trim());
  return chunks.map((chunk,index)=>{let match=chunk.match(/^\+\+\+\s+(?:b\/)?(.+)$/m);if(match?.[1]==='/dev/null')match=chunk.match(/^---\s+(?:a\/)?(.+)$/m);return {name:match?.[1]||`变更 ${index+1}`,text:chunk};});
}
function fingerprint(text){text=String(text||'').replace(/\r\n/g,'\n');const hunk=text.search(/^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/m);if(hunk>=0)text=text.slice(hunk);text=text.replace(/\n+$/,'');let a=2166136261,b=5381;for(let i=0;i<text.length;i++){const n=text.charCodeAt(i);a=Math.imul(a^n,16777619);b=(Math.imul(b,33)^n)|0;}return `${text.length}-${a>>>0}-${b>>>0}`;}
function reviewPath(value,cwd){let path=String(value||'').replace(/\\/g,'/'),root=String(cwd||'').replace(/\\/g,'/').replace(/\/+$/,'');const windows=/^[a-z]:\//i.test(root);const compare=value=>windows?value.toLowerCase():value;if(root&&compare(path).startsWith(compare(root+'/')))path=path.slice(root.length+1);return compare(path);}
function reviewEntries(tab){
  if(!tab)return [];const entries=[];
  for(let i=0;i<(tab.turns||[]).length;i++){
    const turn=tab.turns[i],items=(turn.items||[]).filter(item=>item.type==='fileChange'&&Array.isArray(item.changes));
    let files=[];if(turn.reviewDiff)files=diffFiles(turn.reviewDiff);else if(items.length){const grouped=new Map();for(const item of items)for(const change of item.changes){if(typeof change?.path!=='string'||typeof change.diff!=='string'||!change.diff)continue;const old=grouped.get(change.path)||'';grouped.set(change.path,old+(old?'\n':'')+change.diff);}files=[...grouped].map(([name,text])=>({name,text}));}
    if(!files.length)continue;const id=`${turn.id?'turn:'+turn.id:items[0]?.id?'item:'+items[0].id:'local:'+i}`.slice(0,300);
    const pending=items.some(item=>item.status&&item.status!=='completed');entries.push({id,label:`${turn.reviewDiff?'当前会话':'历史记录'} · 第 ${i+1} 轮${pending?'（含未完成或未批准变更）':''}`,files});
  }
  return entries.reverse();
}
function renderReview(tab,entries=reviewEntries(tab)){
  const revision=$('reviewRevision'),list=$('diffFiles'),content=$('diffContent'),note=$('reviewNote');
  revision.replaceChildren();list.replaceChildren();content.replaceChildren();
  if(!tab){note.textContent='请选择对话';return;}
  for(const entry of entries){const option=document.createElement('option');option.value=entry.id;option.textContent=entry.label;revision.append(option);}
  let entry=entries.find(item=>item.id===tab.reviewSelection?.entryId)||entries[0];
  if(entry){revision.value=entry.id;let file=entry.files.find(item=>item.name===tab.reviewSelection?.path)||entry.files[0];tab.reviewSelection={entryId:entry.id,path:file.name};
    note.textContent=`${entry.label}；仅展示已加载的任务记录，未必代表当前文件状态。悬停有行号的差异，点击“＋”添加反馈。`;
    for(const item of entry.files){const button=document.createElement('button');button.type='button';button.textContent=item.name;button.title=item.name;button.classList.toggle('active',item===file);button.addEventListener('click',()=>{tab.reviewSelection={entryId:entry.id,path:item.name};renderReview(tab);});list.append(button);}
    renderReviewDiff(tab,entry,file);
  }else{note.textContent=tab.nextCursor?'当前已加载记录没有文件差异。可先在聊天区加载更早的消息。':'没有可恢复的文件差异；旧版本若未保存文件变更，无法从历史重建。';content.textContent='没有可显示的差异';}
  const form=$('reviewCommentForm'),draft=tab.reviewDraft;form.hidden=!draft;
  if(draft){$('reviewCommentLocation').textContent=`${draft.path} · ${draft.side==='old'?'旧版':'新版'}第 ${draft.line} 行`;const field=$('reviewCommentText');if(form.dataset.tabId!==tab.id||document.activeElement!==field)field.value=draft.text;form.dataset.tabId=tab.id;}
  renderReviewComments(tab,entries);
}
function renderReviewDiff(tab,entry,file){
  const content=$('diffContent'),lines=limited(file.text).split('\n'),fragment=document.createDocumentFragment(),fileHash=fingerprint(file.text);let oldLine=0,newLine=0;
  for(const line of lines.slice(0,5000)){
    const row=document.createElement('span');row.className='review-line';let side=null,number=null;const hunk=line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if(hunk){oldLine=Number(hunk[1]);newLine=Number(hunk[2]);row.classList.add('hunk');}
    else if(line.startsWith('+')&&!line.startsWith('+++')&&newLine>0){side='new';number=newLine++;row.classList.add('added');}
    else if(line.startsWith('-')&&!line.startsWith('---')&&oldLine>0){side='old';number=oldLine++;row.classList.add('removed');}
    else if(line.startsWith(' ')&&newLine>0){side='new';number=newLine++;oldLine++;}
    const button=document.createElement('button');button.type='button';button.textContent='+';button.tabIndex=side?0:-1;button.hidden=!side;
    if(side){button.setAttribute('aria-label',`在 ${file.name} ${side==='old'?'旧版':'新版'}第 ${number} 行添加反馈`);button.addEventListener('click',()=>{if(tab.reviewDraft?.text?.trim()){setStatus('请先保存或取消当前行的反馈');$('reviewCommentText').focus();return;}tab.reviewDraft={entryId:entry.id,path:file.name,side,line:number,text:'',fingerprint:fileHash};renderReview(tab);$('reviewCommentText').focus();enable();});}
    const numberEl=document.createElement('span');numberEl.className='review-line-number';numberEl.textContent=number||'';const text=document.createElement('span');text.textContent=line||' ';row.append(button,numberEl,text);fragment.append(row);
  }
  if(lines.length>5000){const rest=document.createElement('span');rest.textContent='\n[后续内容仍可查看，但暂不支持逐行添加反馈]\n'+lines.slice(5000).join('\n');fragment.append(rest);}content.append(fragment);
}
function commentIsCurrent(comment,entries){const entry=entries.find(item=>item.id===comment.entryId),tab=activeTab(),file=entry?.files.find(item=>reviewPath(item.name,tab?.cwd)===reviewPath(comment.path,tab?.cwd));return !!file&&fingerprint(file.text)===comment.fingerprint;}
function renderReviewComments(tab,entries){
  const container=$('reviewComments');container.replaceChildren();$('reviewCommentCount').textContent=String(tab.reviewComments.length);let stale=false;
  for(const [index,comment] of tab.reviewComments.entries()){const current=commentIsCurrent(comment,entries);if(!current)stale=true;const row=document.createElement('div');row.className=`review-comment${current?'':' stale'}`;const remove=document.createElement('button');remove.type='button';remove.textContent='删除';remove.addEventListener('click',()=>{tab.reviewComments.splice(index,1);renderReview(tab);enable();});const title=document.createElement('strong');title.textContent=`${comment.path} · ${comment.side==='old'?'旧版':'新版'}第 ${comment.line} 行`;const desc=document.createElement('small');desc.textContent=comment.text+(current?'':'（差异已变化或尚未加载，请重新核对）');row.append(remove,title,desc);container.append(row);}
  $('reviewInsert').disabled=!tab.reviewComments.length||stale||!!tab.reviewDraft||input.disabled;
}
$('reviewRevision').addEventListener('change',()=>{const tab=activeTab();if(!tab)return;tab.reviewSelection={entryId:$('reviewRevision').value,path:null};renderReview(tab);});
$('reviewButton').addEventListener('click',()=>{const tab=activeTab();if(!tab)return;window.dispatchEvent(new Event('kurumi-open-chat'));$('reviewPanel').hidden=false;document.querySelector('.skin').classList.add('review-open');renderReview(tab);});
$('closeDiff').addEventListener('click',()=>{$('reviewPanel').hidden=true;document.querySelector('.skin').classList.remove('review-open');});
$('reviewCommentText').addEventListener('input',()=>{const tab=activeTab();if(tab?.reviewDraft){tab.reviewDraft.text=$('reviewCommentText').value;enable();}});
$('reviewCancelComment').addEventListener('click',()=>{const tab=activeTab();if(tab){tab.reviewDraft=null;renderReview(tab);enable();}});
$('reviewCommentForm').addEventListener('submit',event=>{event.preventDefault();const tab=activeTab(),draft=tab?.reviewDraft;if(!draft||!draft.text.trim())return;if(tab.reviewComments.length>=200){setStatus('一个标签最多保存 200 条审核反馈');return;}if(!commentIsCurrent(draft,reviewEntries(tab))){setStatus('差异已变化，请重新选择对应行');return;}tab.reviewComments.push({...draft,text:draft.text.trim()});tab.reviewDraft=null;renderReview(tab);enable();});
$('reviewInsert').addEventListener('click',()=>{const tab=activeTab(),entries=reviewEntries(tab);if(!tab||!tab.reviewComments.length||tab.reviewDraft||input.disabled||tab.reviewComments.some(comment=>!commentIsCurrent(comment,entries)))return;const text='请检查以下文件审核反馈（行号以所选差异为准）：\n'+tab.reviewComments.map(comment=>`- ${comment.path}（${comment.side==='old'?'旧版':'新版'}第 ${comment.line} 行；${entries.find(entry=>entry.id===comment.entryId)?.label||comment.entryId}）：${comment.text}`).join('\n');const next=input.value?input.value+(input.value.endsWith('\n')?'\n':'\n\n')+text:text;if(next.length>200000){setStatus('草稿过长，请减少反馈后再加入');return;}input.value=next;tab.reviewComments=[];renderReview(tab);enable();input.focus();setStatus('审核反馈已加入草稿，确认后可发送');});
$('reconnectButton').addEventListener('click',async()=>{
  const button=$('reconnectButton');button.disabled=true;setStatus('正在重新连接…');
  try{await api.reconnect();}catch(error){connectionFailed=true;setStatus('重新连接失败：'+error.message);}
  finally{button.disabled=false;enable();}
});
$('checkDelivery').addEventListener('click',async()=>{
  const tab=activeTab();if(!tab?.uncertain||!tab.threadId||!ready||isBusy(tab)||tab.checkingHistory)return;
  tab.checkingHistory=true;enable();setStatus('正在读取最新历史…');
  try{
    const result=await api.readLatest(tab.threadId);
    tab.turns=result.turns||[];tab.nextCursor=result.nextCursor||null;tab.historyChecked=true;
    if(activeTabId===tab.id){renderMessages(tab);appendSystem('请核对','历史已刷新。未显示不代表任务一定没有执行；请确认后再解除限制。');setStatus('历史已刷新，请核对执行结果');}
  }catch(error){if(activeTabId===tab.id)setStatus('读取历史失败：'+error.message);}
  finally{tab.checkingHistory=false;enable();}
});
$('unlockDelivery').addEventListener('click',async()=>{
  const tab=activeTab();if(!tab?.uncertain||!tab.historyChecked||isBusy(tab))return;
  try{await api.acknowledgeDelivery(tab.threadId);tab.uncertain=false;tab.historyChecked=false;if(activeTabId===tab.id)setStatus('已解除限制，请自行决定是否发送草稿');}
  catch(error){if(activeTabId===tab.id)setStatus('暂时无法解除限制：'+error.message);}
  finally{enable();}
});
function applyDiagnostics(report){compatibilityStatus=(report.checks||[]).some(check=>check.status==='error')?'blocked':'ok';if((report.checks||[]).some(check=>check.status!=='ok'))setStatus(compatibilityStatus==='blocked'?'兼容检查失败，已暂停发送；请打开左下角诊断':'版本检查有提示，请打开左下角诊断查看');else if(statusText.textContent.includes('正在执行兼容检查'))setStatus('Codex 已连接 · 兼容检查通过');enable();}
function renderDiagnostics(report){
  const el=$('diagnosticsContent');el.replaceChildren();
  if(!report){el.textContent='尚未完成检查。';return;}
  const info=document.createElement('p');info.className='question-intro';info.textContent=`客户端 ${report.client} · Electron ${report.electron} · ${report.codex} · ${report.changed?'检测到新版本或首次检查':'版本未变化'}`;el.append(info);
  for(const check of report.checks||[]){const row=document.createElement('div');row.className=`diagnostic-row ${check.status}`;row.textContent=`${check.status==='ok'?'✓':check.status==='warning'?'!':'×'} ${check.name}：${check.message}`;el.append(row);}
  const note=document.createElement('p');note.className='question-intro';note.textContent='通过基础检查不代表全部高级功能兼容；不会自动发送消息。';el.append(note);
}
$('diagnosticsButton').addEventListener('click',async()=>{$('diagnosticsDialog').showModal();try{renderDiagnostics(await api.diagnostics());}catch(error){$('diagnosticsContent').textContent='读取诊断失败：'+error.message;}});
$('diagnosticsClose').addEventListener('click',()=>$('diagnosticsDialog').close());
$('diagnosticsRun').addEventListener('click',async()=>{const button=$('diagnosticsRun');button.disabled=true;$('diagnosticsContent').textContent='正在运行只读检查…';try{const report=await api.runDiagnostics();renderDiagnostics(report);applyDiagnostics(report);}catch(error){$('diagnosticsContent').textContent='检查失败：'+error.message;}finally{button.disabled=false;}});
api.onDiagnostics(report=>{if($('diagnosticsDialog').open)renderDiagnostics(report);applyDiagnostics(report);});
window.kurumiWorkspace={openChat:openThread,cwd:()=>activeTab()?.cwd||currentFolder,tabId:()=>activeTabId,open:(folder)=>{const before=activeTabId;newTab();if(activeTabId===before)return false;const tab=activeTab();tab.cwd=folder;currentFolder=folder;folderLabel.textContent=folder;setStatus('已在新标签选择工作树');enable();return true;}};
let remoteListTimer=null;
api.onRemoteTask?.(async data=>{
  await recoveryLoaded;
  let tab=tabs.find(t=>t.threadId===data.threadId);const fresh=!tab;
  if(!tab){if(tabs.length>=60){setStatus('收到其他设备任务；标签已满，可从会话列表打开');refreshThreads();return;}tab=createTab({threadId:data.threadId,title:tabTitle(data.title||'手机任务'),cwd:data.cwd||currentFolder});}
  tab.remoteControlled=true;tab.needsResume=false;
  if(data.title)tab.title=tabTitle(data.title);if(data.cwd)tab.cwd=data.cwd;
  if(data.started){tab.busy=true;tab.turnId=data.turnId||null;if(data.turnId&&!tab.turns.some(t=>t.id===data.turnId))tab.turns.push({id:data.turnId,startedAt:Date.now()/1000,items:[]});}
  if(data.turns){tab.turns=window.KurumiRemoteHistory.merge(data.turns,tab.turns,!!data.stable);tab.nextCursor=data.nextCursor||null;if(data.stable||fresh){tab.busy=!!data.busy;tab.turnId=data.turnId||null;}}
  tab.status=tab.busy?'其他设备正在运行此任务':'已同步其他设备的会话';
  if((data.started||(fresh&&data.busy))&&activeTabId!==tab.id)switchTab(tab.id);
  else if(tab.id===activeTabId){renderMessages(tab);setStatus(tab.status);}
  renderTabs();enable();clearTimeout(remoteListTimer);remoteListTimer=setTimeout(refreshThreads,250);
});
enable();

setInterval(()=>{if(document.hidden)return;for(const el of document.querySelectorAll('[data-thought-start]'))el.textContent=' · 正在思考 '+(el.dataset.estimated==='true'?'约 ':'')+window.KurumiTiming.format(Math.max(0,Date.now()-Number(el.dataset.thoughtStart)));},1000);

$('textFileAlternative').addEventListener('click',async()=>{try{const result=await api.readLocalText($('textFileAlternative').dataset.path,activeTab()?.cwd||'');if(result.missing)throw Error('当前版本文件也已变化，请重新打开');$('textFileTitle').textContent='当前版本 · '+result.path;$('textFileContent').textContent=result.text.split('\n').map((line,i)=>`${i+1}  ${line}`).join('\n');$('textFileAlternative').hidden=true;}catch(error){setStatus('无法读取当前版本：'+error.message);}});
