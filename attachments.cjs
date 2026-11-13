const fs=require('node:fs');
const path=require('node:path');
const {execFile,execFileSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {nativeImage}=require('electron');
const IMAGE_EXT=new Set(['.png','.jpg','.jpeg','.webp','.gif','.bmp','.avif']);
const TEXT_EXT=new Set(['.txt','.md','.markdown','.json','.jsonl','.log','.csv','.tsv','.js','.jsx','.ts','.tsx','.py','.rb','.go','.rs','.java','.c','.h','.cpp','.hpp','.cs','.php','.html','.htm','.css','.scss','.less','.xml','.yml','.yaml','.toml','.ini','.cfg','.sh','.ps1','.bat','.cmd','.sql','.graphql']);
const DOCUMENT_EXT=new Set(['.pdf','.docx','.xlsx','.pptx']);
const MAX_FILE=20*1024*1024;
let cachedPython;
function locatePython(){
  const configured=process.env.KURUMI_PYTHON;if(configured&&path.isAbsolute(configured)&&fs.existsSync(configured))return configured;
  if(cachedPython&&fs.existsSync(cachedPython))return cachedPython;
  const script="$p=Get-AppxPackage | Where-Object {$_.Name -like 'OpenAI.CodexPrimaryRuntime.*'} | Sort-Object Version -Descending | Select-Object -First 1; if ($p) { Join-Path $p.InstallLocation 'dependencies\\python\\python.exe' }";
  try{const p=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:10000}).trim();if(p&&fs.existsSync(p)){cachedPython=p;return p;}}catch{}
  throw Error('未找到 Codex 工作区文档解析组件');
}
function extractDocument(file){return new Promise((resolve,reject)=>{
  let python;try{python=locatePython()}catch(e){reject(e);return;}
  execFile(python,[path.join(__dirname,'extract-attachment.py'),file],{encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:1024*1024,env:{...process.env,PYTHONIOENCODING:'utf-8'}},(error,stdout)=>{
    let result;try{result=JSON.parse(stdout)}catch{}
    if(error||!result?.text){reject(Error(result?.error||'文档读取失败或超时'));return;}resolve(result.text);
  });
});}
async function preview(file){try{const img=await nativeImage.createThumbnailFromPath(file,{width:160,height:160});return img.isEmpty()?null:img.toDataURL()}catch{return null}}
async function loadFiles(paths){
  if(!Array.isArray(paths))throw Error('文件列表无效');
  const files=[],skipped=[];
  if(paths.length>8)skipped.push('每次最多选择 8 个文件，其余文件未添加');
  for(const file of paths.slice(0,8)){
    if(typeof file!=='string'||!path.isAbsolute(file)){skipped.push('文件路径无效');continue;}
    const name=path.basename(file),ext=path.extname(file).toLowerCase();
    try{
      const stat=fs.statSync(file);if(!stat.isFile())throw Error('不是普通文件');if(stat.size>MAX_FILE)throw Error('超过 20 MB');
      const base={id:randomUUID(),name,path:file,size:stat.size};
      if(IMAGE_EXT.has(ext))files.push({...base,kind:'image',dataUrl:await preview(file)});
      else if(TEXT_EXT.has(ext)){const text=fs.readFileSync(file,'utf8');if(text.length>200000)throw Error('超过 200000 字符');files.push({...base,kind:'text',text});}
      else if(DOCUMENT_EXT.has(ext)){const text=await extractDocument(file);files.push({...base,kind:'text',text,extracted:true});}
      else throw Error('不支持此文件类型');
    }catch(error){skipped.push(`${name}：${error.message||'读取失败'}`)}
  }
  return {files,skipped};
}
function saveClipboardImage(image,folder){
  if(!image||image.isEmpty())throw Error('剪贴板中没有可用图片');
  const size=image.getSize();if(size.width*size.height>40000000)throw Error('图片像素过多');
  const png=image.toPNG();if(png.length>MAX_FILE)throw Error('图片超过 20 MB');
  fs.mkdirSync(folder,{recursive:true});const file=path.join(folder,`${randomUUID()}.png`);fs.writeFileSync(file,png,{flag:'wx'});return file;
}
module.exports={loadFiles,preview,saveClipboardImage,IMAGE_EXT};
