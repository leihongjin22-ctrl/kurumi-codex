const fs=require('node:fs'),path=require('node:path');
const PRIVATE=/^(?:auth\.json|session-recovery\.json|client-settings\.json|remote-settings\.json|scheduled-tasks\.json|compatibility-watch\.json|install-location\.json|.*\.(?:lnk|log|bak))$/i;
function copyPublicClient(root,destination){
 root=fs.realpathSync(root);fs.mkdirSync(destination,{recursive:true});destination=fs.realpathSync(destination);
 if(destination===root||destination.startsWith(root+path.sep))throw Error('发布目标必须位于客户端源码目录之外');
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'release-manifest.json'),'utf8'));
 function copy(relative){if(path.isAbsolute(relative)||relative.split(/[\\/]/).includes('..'))throw Error('发布路径越界');const source=path.join(root,relative),target=path.join(destination,relative),stat=fs.lstatSync(source);if(stat.isSymbolicLink())throw Error('发布包不接受符号链接');if(PRIVATE.test(path.basename(relative)))throw Error('发布包包含私人数据文件');if(stat.isDirectory()){fs.mkdirSync(target,{recursive:true});for(const name of fs.readdirSync(source))copy(path.join(relative,name));}else{fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);}}
 for(const relative of [...manifest.files,...manifest.directories])copy(relative);
 fs.copyFileSync(path.join(root,'docs-public','README.md'),path.join(destination,'README.md'));return destination;
}
module.exports={copyPublicClient,PRIVATE};
