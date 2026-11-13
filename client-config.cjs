const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const DEFAULTS={version:1,configured:false,workspace:null,codexExecutable:null,pythonExecutable:null,autoRepair:true};
function validate(raw){
 if(!raw||raw.version!==1||typeof raw.autoRepair!=='boolean')throw Error('客户端配置格式不支持');
 const result={...DEFAULTS,configured:raw.configured===true,autoRepair:raw.autoRepair};
 for(const key of ['workspace','codexExecutable','pythonExecutable']){const value=raw[key];if(value==null||value===''){result[key]=null;continue;}if(typeof value!=='string'||value.length>4000||!path.isAbsolute(value)||/[\0-\x1f]/.test(value))throw Error('配置路径无效：'+key);result[key]=value;}
 return result;
}
function load(file){if(!fs.existsSync(file))return {...DEFAULTS};return validate(JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')));}
function save(file,value){const data=validate(value);for(const key of ['workspace','codexExecutable','pythonExecutable'])if(data[key]){const stat=fs.statSync(data[key]);if(key==='workspace'?!stat.isDirectory():!stat.isFile()||path.extname(data[key]).toLowerCase()!=='.exe')throw Error('请选择有效的目录或可执行文件：'+key);}fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(data,null,2),'utf8');fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}return data;}
module.exports={DEFAULTS,load,save,validate};
