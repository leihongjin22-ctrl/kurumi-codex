const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {UpdateGuard,kind,repairLink}=require('../update-guard.cjs');
const config=require('../client-config.cjs'),{PRIVATE}=require('../distribution.cjs');
const root=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'kurumi-unit-'));
const healthy=(version,stamp)=>({client:'0.9.0',codex:version,nativeStamp:stamp,checks:['Codex 版本','协议结构','模型列表','会话列表'].map(name=>({name,status:'ok'}))});
(async()=>{try{
 const links=[];let enabled=true,inspections=0;
 const options={directory:temporary,root,open:async url=>links.push(url),config:()=>({autoRepair:enabled}),inspect:async()=>{inspections++;return {codex:'codex-cli 2',nativeStamp:'native-2'};}};
 const guard=new UpdateGuard(options);await guard.accept(healthy('codex-cli 1','native-1'));
 await guard.accept({...healthy('codex-cli 1','native-1'),client:'0.10.0',checks:[{name:'会话列表',status:'error',kind:'contract'}]});assert.equal(links.length,0,'client-only update must not auto-open');
 for(const category of ['network','quota','auth']){await guard.accept({codex:'codex-cli 2',nativeStamp:'native-2',checks:[{name:'会话列表',status:'error',kind:category}]});assert.equal(links.length,0);}
 // A core check can pass before a later optional feature reveals a contract change.
 await guard.accept(healthy('codex-cli 2','native-2'));await guard.failure('thread/list',{rpcCode:-32601,message:'Method not found'},'0.9.0');assert.equal(links.length,1);
 const url=new URL(links[0]);assert.equal(url.protocol,'codex:');assert.equal(url.hostname,'new');assert.equal(url.searchParams.get('path'),root);assert.ok(url.searchParams.get('prompt').includes('REPAIR.md'));assert.ok(!url.searchParams.get('prompt').includes('auth.json'));
 await guard.failure('thread/list',{rpcCode:-32601,message:'Method not found'},'0.9.0');assert.equal(links.length,1);assert.equal(inspections,1,'repeated failures should share cached inspection');
 const restored=new UpdateGuard(options);await restored.failure('thread/list',{rpcCode:-32601,message:'Method not found'},'0.9.0');assert.equal(links.length,1,'restart must not reopen same incident');await restored.openRepair();assert.equal(links.length,2,'explicit retry should work');
 enabled=false;await restored.accept({codex:'codex-cli 3',nativeStamp:'native-3',checks:[{name:'协议结构',status:'error',kind:'contract'}]});assert.equal(links.length,2);assert.ok(restored.snapshot().issue);
 assert.equal(kind({rpcCode:-32602,message:'invalid thread id: not found'}),'resource');assert.equal(kind({message:'401 unauthorized'}),'auth');assert.equal(kind({message:'quota 429'}),'quota');assert.equal(kind({message:'Network timeout'}),'network');
 const unicodeLink=new URL(repairLink('C:\\Apps\\时钟 & test',{codex:'2',previousCodex:'1',checks:[]}));assert.equal(unicodeLink.searchParams.get('path'),'C:\\Apps\\时钟 & test');
 const file=path.join(temporary,'client-settings.json');config.save(file,{...config.DEFAULTS,workspace:temporary,configured:true});assert.equal(config.load(file).workspace,temporary);assert.throws(()=>config.validate({...config.DEFAULTS,workspace:'relative'}));
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'release-manifest.json'),'utf8'));for(const item of [...manifest.files,...manifest.directories])assert.ok(fs.existsSync(path.join(root,item)),item+' missing');
 const pkg=require('../package.json'),plugin=JSON.parse(fs.readFileSync(path.join(root,'.codex-plugin','plugin.json'),'utf8'));assert.equal(pkg.version,plugin.version);assert.equal(plugin.skills,'./skills/');
 for(const item of manifest.files)assert.ok(!PRIVATE.test(path.basename(item)));assert.ok(!manifest.directories.includes('test-harness'));assert.ok(!manifest.directories.some(s=>/backup|cache|^docs$/.test(s)));
 for(const item of manifest.files.filter(f=>/\.(?:cjs|js)$/.test(f))){const source=fs.readFileSync(path.join(root,item),'utf8');for(const match of source.matchAll(/require\(['"](\.\/[^'"]+)['"]\)/g)){const target=path.resolve(root,match[1]);assert.ok(fs.existsSync(target)||fs.existsSync(target+'.js'),`Missing module ${match[1]} required by ${item}`);}}
 console.log('PASS: update correlation, no false network/quota/auth alert, once-per-build handoff, restart suppression, manual retry, disable switch, URI encoding, configuration, release manifest and module closure. Model requests: 0.');
}finally{for(const entry of fs.readdirSync(temporary)){const target=path.join(temporary,entry);if(fs.statSync(target).isFile())fs.unlinkSync(target);}fs.rmdirSync(temporary);}})().catch(error=>{console.error(error);process.exitCode=1;});
