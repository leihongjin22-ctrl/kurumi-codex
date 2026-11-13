const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {previewResourceAllowed}=require('./local-file.cjs');
const previewWindows=new Set();

async function openHtmlPreview(BrowserWindow,parent,file){
  const folder=path.dirname(file.path);
  const preview=new BrowserWindow({width:1100,height:760,minWidth:500,minHeight:350,parent,title:`文件预览 · ${path.basename(file.path)}`,autoHideMenuBar:true,webPreferences:{partition:`preview-${randomUUID()}`,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
  previewWindows.add(preview);preview.on('closed',()=>previewWindows.delete(preview));
  const contents=preview.webContents,session=contents.session;
  session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  session.setPermissionCheckHandler(()=>false);
  session.on('will-download',event=>event.preventDefault());
  session.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>callback({cancel:!previewResourceAllowed(details.url,folder)}));
  contents.setWindowOpenHandler(()=>({action:'deny'}));
  contents.on('will-navigate',event=>event.preventDefault());
  try{await preview.loadFile(file.path);}catch(error){if(!preview.isDestroyed())preview.close();throw error;}
  return preview;
}
module.exports={openHtmlPreview};
