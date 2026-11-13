const fs=require('node:fs');
function makeInput(text,attachments=[]){
  if(typeof text!=='string'||text.length>200000)throw Error('消息内容无效');
  if(!Array.isArray(attachments)||attachments.length>8)throw Error('每条消息最多添加 8 个附件');
  let fullText=text.trim();
  for(const a of attachments){
    if(a.kind==='text'){
      if(typeof a.text!=='string')throw Error('文本附件内容无效');
      fullText+=`\n\n--- 附件：${a.name} ---\n${a.text}`;
    }else if(a.kind!=='image')throw Error('不支持的附件类型');
  }
  if(fullText.length>250000)throw Error('消息和文本附件总长度超过 250000 字符，请减少附件。');
  const input=[];
  if(fullText)input.push({type:'text',text:fullText,text_elements:[]});
  for(const a of attachments)if(a.kind==='image'){
    if(typeof a.path!=='string'||!fs.existsSync(a.path))throw Error(`图片附件不存在：${a.name||a.path||'未知文件'}`);
    input.push({type:'localImage',path:a.path});
  }
  if(!input.length)throw Error('消息或附件为空');
  if(!input.some(part=>part.type==='text'))input.unshift({type:'text',text:'请查看附件。',text_elements:[]});
  return input;
}
module.exports={makeInput};
