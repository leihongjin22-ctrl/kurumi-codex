const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');

function localVideo(file){
  if(typeof file!=='string'||file.length>4000||/[\0-\x1f]/.test(file)||!path.isAbsolute(file)||!['.mp4','.webm'].includes(path.extname(file).toLowerCase()))throw Error('只支持本机 MP4 或 WebM 文件');
  // Do not allow a message to initiate a network share connection.
  if(process.platform==='win32'&&!/^[a-z]:[\\/]/i.test(file))throw Error('只支持本机磁盘上的视频');
  let resolved,stat;
  try{resolved=fs.realpathSync(file);if(process.platform==='win32'&&!/^[a-z]:[\\/]/i.test(resolved))throw Error();stat=fs.statSync(resolved);}catch{throw Error('找不到视频文件或无法读取');}
  if(!stat.isFile()||!['.mp4','.webm'].includes(path.extname(resolved).toLowerCase()))throw Error('视频文件无效');
  return {path:resolved,url:pathToFileURL(resolved).href};
}
module.exports={localVideo};
