// Injected into the verification iframe BEFORE any user script. Runs on the
// opaque-origin sandbox, captures errors + a DOM summary + runs scripted smoke
// tests, and postMessages a structured report to the parent (no same-origin
// access needed — secure).

const MARKER = "forge-verify-shim";

export const REPORTER_SHIM = `<script>/*${MARKER}*/(function(){
  var errors=[];
  function push(m,s,l,c){ if(errors.length<25) errors.push({message:String(m||'Error').slice(0,500),source:s||'',line:l||0,col:c||0}); }
  window.addEventListener('error', function(ev){
    if(ev && ev.message){ push(ev.message, ev.filename, ev.lineno, ev.colno); }
    else if(ev && ev.error){ push(ev.error.message||ev.error, ev.filename, ev.lineno, ev.colno); }
  }, true);
  window.addEventListener('unhandledrejection', function(ev){
    var r=ev && ev.reason; push('Unhandled promise rejection: '+((r&&r.message)?r.message:String(r)),'',0,0);
  });
  try{ var _e=console.error; console.error=function(){ try{ push(Array.prototype.map.call(arguments,function(a){return (a&&a.message)?a.message:String(a);}).join(' '),'console',0,0); }catch(_){ } return _e.apply(console,arguments); }; }catch(_){ }
  function count(sel){ try{ return document.querySelectorAll(sel).length; }catch(_){ return 0; } }
  function summary(){
    var hs=[];
    try{ var els=document.querySelectorAll('h1,h2,h3'); for(var i=0;i<els.length&&hs.length<12;i++){ var t=(els[i].textContent||'').trim(); if(t)hs.push(t.slice(0,120)); } }catch(_){ }
    var bt=''; try{ bt=(document.body&&(document.body.innerText||document.body.textContent))||''; }catch(_){ }
    return {
      title:(document.title||'').slice(0,160),
      headings:hs,
      counts:{ forms:count('form'), buttons:count('button'), links:count('a[href]'), images:count('img'), inputs:count('input,textarea,select'), scripts:count('script'), canvases:count('canvas') },
      bodyTextLen:(bt||'').trim().length
    };
  }
  var smokeDone=false, smokeResults=[];
  function runSmoke(){
    if(smokeDone) return; smokeDone=true;
    var tests=(window.__FORGE_SMOKE__||[]);
    for(var i=0;i<tests.length;i++){
      var t=tests[i]||{}, ok=true, err='';
      try{ var r=(new Function(String(t.code||'')))(); if(r===false){ ok=false; err='assertion returned false'; } }
      catch(e){ ok=false; err=(e&&e.message)?e.message:String(e); }
      smokeResults.push({ id:t.id||('smoke-'+i), label:t.label||('Smoke '+i), ok:ok, error:err });
    }
  }
  function send(phase){ try{ if(phase==='final') runSmoke(); parent.postMessage({__forgeVerify:true,phase:phase,errors:errors,dom:summary(),smoke:smokeResults},'*'); }catch(_){ } }
  document.addEventListener('DOMContentLoaded',function(){ send('interim'); });
  window.addEventListener('load',function(){ send('interim'); setTimeout(function(){ send('final'); },1000); });
  setTimeout(function(){ send('final'); },2200);
})();</script>`;

/** Build the `window.__FORGE_SMOKE__` injection for scripted smoke tests. */
export function smokeData(tests: { id: string; label: string; code: string }[]): string {
  if (!tests.length) return "";
  return `<script>/*${MARKER}-data*/window.__FORGE_SMOKE__=${JSON.stringify(tests)};</script>`;
}

/** Insert the reporter shim (+ optional smoke data) so it runs before any user
 *  script. Idempotent. */
export function injectReporterShim(html: string, smoke = ""): string {
  if (!html || html.indexOf(MARKER + "*/") !== -1) return html;
  const payload = REPORTER_SHIM + smoke;
  const head = /<head[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + payload + html.slice(at);
  }
  const htmlTag = /<html[^>]*>/i.exec(html);
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length;
    return html.slice(0, at) + payload + html.slice(at);
  }
  return payload + html;
}
