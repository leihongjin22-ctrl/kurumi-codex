(()=>{
  const api=window.kurumi,dialog=document.getElementById('approvalDialog'),queue=[];let current=null;
  function showNext(){if(current||!queue.length)return;current=queue.shift();window.dispatchEvent(new Event('kurumi-open-chat'));document.getElementById('approvalTitle').textContent=current.title;document.getElementById('approvalMessage').textContent=current.message;const detail=document.getElementById('approvalDetail'),files=document.getElementById('approvalFiles');detail.textContent=current.detail;files.replaceChildren();files.hidden=!current.files?.length;if(current.files?.length){const add=(label,text)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.title=label;button.addEventListener('click',()=>{detail.textContent=text});files.append(button)};add('全部文件',current.detail);for(const file of current.files)add(file.path,`文件路径：${file.path}\n操作：${JSON.stringify(file.kind||{})}\n差异：\n${file.diff||''}`);}document.getElementById('approvalAllow').textContent=current.allowLabel||'允许一次';document.getElementById('approvalError').textContent='';dialog.showModal();document.getElementById('approvalDeny').focus();}
  function finish(){if(dialog.open)dialog.close();current=null;showNext();}
  api.onApprovalRequest(request=>{queue.push(request);showNext()});
  api.onApprovalResolved(({token})=>{const i=queue.findIndex(x=>x.token===token);if(i>=0)queue.splice(i,1);if(current?.token===token)finish()});
  async function answer(decision){if(!current)return;const deny=document.getElementById('approvalDeny'),allow=document.getElementById('approvalAllow');deny.disabled=allow.disabled=true;try{await api.answerApproval(current.token,decision);finish()}catch(e){document.getElementById('approvalError').textContent=e.message||'审批失败'}finally{deny.disabled=allow.disabled=false}}
  document.getElementById('approvalDeny').addEventListener('click',()=>answer('decline'));
  document.getElementById('approvalAllow').addEventListener('click',()=>answer('accept'));
  dialog.addEventListener('cancel',event=>{event.preventDefault();answer('decline')});
})();
