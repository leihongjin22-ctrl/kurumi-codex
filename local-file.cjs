const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL,fileURLToPath}=require('node:url');

const images=new Set(['.png','.jpg','.jpeg','.webp','.gif','.bmp','.avif']);
const html=new Set(['.html','.htm','.svg']);
const documents=new Set(['.pdf','.docx','.xlsx','.pptx','.doc','.xls','.ppt','.txt','.md','.csv','.tsv','.json','.xml']);
const textTypes=new Set(['.txt','.md','.markdown','.csv','.tsv','.json','.jsonl','.xml','.js','.cjs','.mjs','.jsx','.ts','.tsx','.css','.scss','.py','.ps1','.sh','.cmd','.bat','.toml','.yaml','.yml','.log','.sql','.rs','.go','.java','.c','.h','.cpp']);
function localFile(input,cwd,allowDirectory=false){
  if(typeof input!=='string'||!input||input.length>4000||/[\0-\x1f]/.test(input))throw Error('文件路径无效');
  let file=input;
  if(/^\/[a-z]:[\\/]/i.test(file))file=file.slice(1);
  if(/^file:/i.test(file)){try{const url=new URL(file);if(url.hostname&&url.hostname!=='localhost')throw Error();file=fileURLToPath(url);}catch{throw Error('本地文件链接无效');}}
  if(process.platform==='win32'&&(/^(?:\\\\|\/\/)/.test(file)||/^[a-z]:[^\\/]/i.test(file)))throw Error('暂不支持网络共享或不完整的磁盘路径');
  if(!path.isAbsolute(file)){
    if(typeof cwd!=='string'||!path.isAbsolute(cwd)||(process.platform==='win32'&&!/^[a-z]:[\\/]/i.test(cwd)))throw Error('无法确定相对文件的工作目录');
    file=path.resolve(cwd,file);
  }
  if(process.platform==='win32'&&!/^[a-z]:[\\/]/i.test(file))throw Error('只支持本机磁盘上的文件');
  let resolved,stat;try{resolved=fs.realpathSync(file);if(process.platform==='win32'&&!/^[a-z]:[\\/]/i.test(resolved))throw Error();stat=fs.statSync(resolved);}catch{throw Error('找不到文件或无法读取；请检查文件是否已移动');}
  if(allowDirectory&&stat.isDirectory())return {path:resolved,kind:'directory'};
  if(!stat.isFile())throw Error('路径不是文件');
  const ext=path.extname(resolved).toLowerCase();
  return {path:resolved,url:pathToFileURL(resolved).href,ext,size:stat.size,kind:images.has(ext)?'image':html.has(ext)?'html':documents.has(ext)?'document':'other'};
}
function previewResourceAllowed(url,folder){
  try{
    if(!url.startsWith('file:'))return false;
    const file=fs.realpathSync(fileURLToPath(url));
    const relative=path.relative(folder,file);
    return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));
  }catch{return false;}
}
function currentPluginFile(file,cacheRoot=path.join(require('node:os').homedir(),'.codex','plugins','cache')){
  try{const clean=/^\/[a-z]:[\\/]/i.test(file)?file.slice(1):file;const relative=path.relative(cacheRoot,path.resolve(clean));if(relative.startsWith('..')||path.isAbsolute(relative))return null;const parts=relative.split(path.sep);if(parts.length<5)return null;const base=path.join(cacheRoot,parts[0],parts[1]);const suffix=parts.slice(3);const versions=fs.readdirSync(base,{withFileTypes:true}).filter(x=>x.isDirectory()&&x.name!==parts[2]).map(x=>({name:x.name,time:fs.statSync(path.join(base,x.name)).mtimeMs})).sort((a,b)=>b.time-a.time);for(const v of versions){try{const item=localFile(path.join(base,v.name,...suffix));if(textTypes.has(item.ext))return item.path;}catch{}}return null;}catch{return null;}
}
module.exports={localFile,previewResourceAllowed,textTypes,currentPluginFile};
