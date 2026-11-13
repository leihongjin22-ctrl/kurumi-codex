function webURL(raw){
  if(typeof raw!=='string'||!raw.trim()||raw.length>8192)throw Error('请输入网址');
  let value=raw.trim();
  if(/^(localhost|127\.0\.0\.1)(:\d+)?([/\?#]|$)/i.test(value))value=`http://${value}`;
  else if(!/^[a-z][a-z0-9+.-]*:/i.test(value))value=`https://${value}`;
  let url;try{url=new URL(value)}catch{throw Error('网址无效')}
  if(!['http:','https:'].includes(url.protocol))throw Error('只支持 HTTP 和 HTTPS 网址');
  return url.href;
}
module.exports={webURL};
