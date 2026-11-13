const {WebContentsView,session}=require('electron');
const {webURL}=require('./browser-url.cjs');

function createBrowserManager(win,send){
  const browserSession=session.fromPartition('persist:kurumi-web');
  browserSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  browserSession.setPermissionCheckHandler(()=>false);
  browserSession.on('will-download',event=>{event.preventDefault();send('browser-warning','内置浏览器暂不支持下载，请使用系统浏览器下载。');});
  let tabs=[],active=null,visible=false,bounds={x:0,y:0,width:1,height:1},seq=0;
  const current=()=>tabs.find(t=>t.id===active);
  const snapshot=()=>({visible,active,tabs:tabs.map(t=>({id:t.id,title:t.title,url:t.url,loading:t.loading,canBack:t.view.webContents.navigationHistory.canGoBack(),canForward:t.view.webContents.navigationHistory.canGoForward()}))});
  const publish=()=>send('browser-state',snapshot());
  function updateViews(){for(const t of tabs){t.view.setVisible(visible&&t.id===active);if(t.id===active)t.view.setBounds(bounds)}publish();}
  function navigate(value){const t=current();if(!t)throw Error('请先新建网页标签');const url=webURL(value);t.view.webContents.loadURL(url).catch(()=>{});}
  function create(url){
    if(tabs.length>=12)throw Error('最多打开 12 个网页标签');
    const view=new WebContentsView({webPreferences:{session:browserSession,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
    const t={id:`web-${++seq}`,title:'新网页',url:'',loading:false,view};tabs.push(t);active=t.id;
    win.contentView.addChildView(view);view.setVisible(false);
    const wc=view.webContents;
    wc.on('will-navigate',(event,urlValue)=>{try{webURL(event.url||urlValue)}catch{event.preventDefault()}});
    wc.on('will-redirect',(event,urlValue)=>{try{webURL(event.url||urlValue)}catch{event.preventDefault()}});
    wc.setWindowOpenHandler(({url})=>{try{webURL(url);setImmediate(()=>{try{create(url)}catch(e){send('browser-warning',e.message)}})}catch{}return {action:'deny'}});
    wc.on('page-title-updated',(_e,title)=>{t.title=title.slice(0,120)||'网页';publish()});
    const location=()=>{t.url=wc.getURL();publish()};
    wc.on('did-navigate',location);wc.on('did-navigate-in-page',location);
    wc.on('did-start-loading',()=>{t.loading=true;publish()});wc.on('did-stop-loading',()=>{t.loading=false;publish()});
    wc.on('did-fail-load',(_e,code,description,_url,isMainFrame)=>{if(isMainFrame&&code!==-3)send('browser-warning',`网页加载失败：${description}`)});
    updateViews();if(url)navigate(url);return snapshot();
  }
  function show(value){visible=!!value;if(visible&&!tabs.length)create();updateViews();return snapshot()}
  function select(id){if(!tabs.some(t=>t.id===id))throw Error('网页标签不存在');active=id;updateViews();return snapshot()}
  function close(id){const index=tabs.findIndex(t=>t.id===id);if(index<0)return snapshot();const [tab]=tabs.splice(index,1);win.contentView.removeChildView(tab.view);tab.view.webContents.close();if(active===id)active=tabs[Math.min(index,tabs.length-1)]?.id||null;if(!tabs.length&&visible)create();updateViews();return snapshot()}
  function resize(rect){const [width,height]=win.getContentSize();if(!rect||!['x','y','width','height'].every(k=>Number.isFinite(rect[k])))return;const x=Math.max(0,Math.min(width-1,Math.round(rect.x))),y=Math.max(0,Math.min(height-1,Math.round(rect.y)));bounds={x,y,width:Math.max(1,Math.min(width-x,Math.round(rect.width))),height:Math.max(1,Math.min(height-y,Math.round(rect.height)))};current()?.view.setBounds(bounds)}
  function action(name){const t=current();if(!t)return;const history=t.view.webContents.navigationHistory;if(name==='back'&&history.canGoBack())history.goBack();else if(name==='forward'&&history.canGoForward())history.goForward();else if(name==='reload')t.view.webContents.reload()}
  function dispose(){for(const t of tabs){win.contentView.removeChildView(t.view);t.view.webContents.close()}tabs=[]}
  return {show,create,select,close,resize,navigate,action,dispose};
}
module.exports={createBrowserManager,webURL};
