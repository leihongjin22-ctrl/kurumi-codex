const fs=require('node:fs');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const exec=promisify(execFile);
async function git(cwd,args){const result=await exec('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:2*1024*1024});return result.stdout;}
async function rootFor(cwd){if(typeof cwd!=='string'||!path.isAbsolute(cwd)||!fs.statSync(cwd).isDirectory())throw Error('工作目录无效');return (await git(cwd,['rev-parse','--show-toplevel'])).trim();}
async function listWorktrees(cwd){
  const root=await rootFor(cwd),out=await git(root,['worktree','list','--porcelain']);
  const entries=out.trim().split(/\r?\n\r?\n/).filter(Boolean).map(block=>{const item={};for(const line of block.split(/\r?\n/)){const i=line.indexOf(' '),key=i<0?line:line.slice(0,i),value=i<0?true:line.slice(i+1);item[key]=value;}return item;});
  return {root,entries};
}
async function addWorktree(cwd,destination,ref){
  const root=await rootFor(cwd);
  if(typeof destination!=='string'||!path.isAbsolute(destination))throw Error('请输入工作树的完整路径');
  const target=path.resolve(destination);if(fs.existsSync(target))throw Error('目标路径已经存在，请选择新路径');
  const reference=String(ref||'HEAD').trim();if(!/^[A-Za-z0-9_][A-Za-z0-9._/~-]{0,199}$/.test(reference)||reference.includes('..'))throw Error('分支或提交名称无效');
  await git(root,['worktree','add','--detach','--',target,reference]);return {path:target,root,ref:reference};
}
module.exports={listWorktrees,addWorktree};
