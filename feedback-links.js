(()=>{
  function localReference(token){
    let href=String(token.href||'');
    if(/^file:\/\//i.test(href)){try{const url=new URL(href);if(url.hostname&&url.hostname!=='localhost')return null;href=decodeURIComponent(url.pathname);}catch{return null;}}
    else{if(/^[a-z][a-z\d+.-]*:/i.test(href)&&!/^[a-z]:[\\/]/i.test(href))return null;try{href=decodeURIComponent(href)}catch{}}
    href=href.replace(/(\.[a-z\d]{1,12})#[^\\/]*$/i,'$1').replace(/:(\d+)(?::\d+)?$/,'');if(/^\/[a-z]:[\\/]/i.test(href))href=href.slice(1);
    if(/^(?:[a-z]:[\\/]|\/(?!\/))/i.test(href))return href;
    return /^(?![\\/])[^?#\r\n]+\.[a-z\d]{1,12}$/i.test(href)?href:null;
  }
  const api={localReference,textExtensions:new Set('txt md markdown csv tsv json jsonl xml js cjs mjs jsx ts tsx css scss py ps1 sh cmd bat toml yaml yml log sql rs go java c h cpp'.split(' '))};
  if(typeof module!=='undefined')module.exports=api;else window.KurumiFeedback=api;
})();
