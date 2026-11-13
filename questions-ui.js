(()=>{
  const api=window.kurumi,dialog=document.getElementById('questionDialog'),form=document.getElementById('questionForm'),list=document.getElementById('questionList'),error=document.getElementById('questionError');
  const queue=[];let current=null;
  function showNext(){
    if(current||!queue.length)return;current=queue.shift();window.dispatchEvent(new Event('kurumi-open-chat'));list.replaceChildren();error.textContent='';
    for(const q of current.questions){
      const field=document.createElement('fieldset');field.className='question-block';field.dataset.questionId=q.id;
      const legend=document.createElement('legend');legend.textContent=q.header||'问题';field.append(legend);
      const prompt=document.createElement('p');prompt.textContent=q.question;field.append(prompt);
      for(const option of q.options||[]){const label=document.createElement('label');label.className='question-option';const radio=document.createElement('input');radio.type='radio';radio.name=`question-${q.id}`;radio.value=option.label;label.append(radio,document.createTextNode(' '+option.label));if(option.description){const desc=document.createElement('small');desc.textContent=option.description;label.append(desc)}field.append(label);}
      if(!q.options?.length||q.isOther){const free=document.createElement('input');free.className='question-free';free.type=q.isSecret?'password':'text';free.maxLength=10000;free.placeholder=q.options?.length?'或输入其他答案':'输入你的回答';free.addEventListener('input',()=>{if(free.value)field.querySelectorAll('input[type=radio]').forEach(r=>{r.checked=false})});field.append(free);}
      list.append(field);
    }
    dialog.showModal();
  }
  function finish(){if(dialog.open)dialog.close();current=null;list.replaceChildren();showNext();}
  api.onUserInputRequest(request=>{queue.push(request);showNext()});
  api.onUserInputResolved(({token})=>{const index=queue.findIndex(q=>q.token===token);if(index>=0)queue.splice(index,1);if(current?.token===token)finish()});
  form.addEventListener('submit',async event=>{event.preventDefault();if(!current)return;const answers=Object.create(null);for(const field of list.querySelectorAll('fieldset')){const selected=field.querySelector('input[type=radio]:checked');const free=field.querySelector('.question-free');const value=selected?.value||free?.value||'';if(!value.trim()){error.textContent='请完成所有问题。';return;}answers[field.dataset.questionId]=value;}try{await api.answerUserInput(current.token,answers);finish()}catch(e){error.textContent=e.message||'提交失败'}});
  async function cancel(){if(!current)return;try{await api.cancelUserInput(current.token)}finally{finish()}}
  document.getElementById('questionCancel').addEventListener('click',cancel);dialog.addEventListener('cancel',event=>{event.preventDefault();cancel()});
})();
