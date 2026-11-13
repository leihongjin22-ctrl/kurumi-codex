const fs=require('node:fs'),path=require('node:path'),{PRIVATE}=require('../distribution.cjs');
function audit(root){const failures=[],files=[];const excluded=/^(?:backup[^\\/]*|test-harness|build-cache|dist|node_modules|\.git|logs|protocol-check)$/i;
 function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name),relative=path.relative(root,file);if(entry.isSymbolicLink()){failures.push(relative+': symlink');continue;}if(excluded.test(entry.name)||PRIVATE.test(entry.name)){failures.push(relative+': private artifact');continue;}if(entry.isDirectory()){walk(file);continue;}files.push(relative);if(/\.(?:cjs|js|json|md|ps1|cmd|txt|yml)$/.test(entry.name)){const value=fs.readFileSync(file,'utf8');if(/[a-z]:[\\/]+Users[\\/]+[^\s'"<>]+/i.test(value)||/\bsk-[A-Za-z0-9_-]{32,}\b/.test(value))failures.push(relative+': personal path or key');}}
 }walk(root);for(const required of ['package.json','.codex-plugin/plugin.json','.agents/plugins/marketplace.json','assets/academy-poster.png','vendor/marked-LICENSE.md','REPAIR.md','runtime.json'])if(!fs.existsSync(path.join(root,required)))failures.push(required+': missing');
 return {ok:!failures.length,files:files.length,failures};
}
if(require.main===module){const result=audit(path.resolve(process.argv[2]||'.'));console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;}
module.exports={audit};
