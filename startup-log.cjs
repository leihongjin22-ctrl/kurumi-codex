const fs=require('node:fs'),path=require('node:path');
function startupLogger(directory){return (event,details={})=>{try{const folder=directory(),file=path.join(folder,'main.log');fs.mkdirSync(folder,{recursive:true});if(fs.existsSync(file)&&fs.statSync(file).size>1024*1024)fs.renameSync(file,path.join(folder,'main.previous.log'));fs.appendFileSync(file,JSON.stringify({at:new Date().toISOString(),event,...details})+'\n','utf8');}catch{}};}
module.exports={startupLogger};
