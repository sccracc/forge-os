// Preview iframes are sandboxed WITHOUT `allow-same-origin` on purpose: that
// gives the framed document an opaque origin so generated code can never reach
// the host app's authenticated session (Firebase tokens, cookies, parent DOM).
//
// The catch: on an opaque origin, *reading* `window.localStorage` /
// `window.sessionStorage` throws a `SecurityError` immediately — so any app that
// touches storage (game stats, a "show once" loading screen, theme persistence)
// crashes on load and only the static top of the page renders. That's the
// "only the top UI shows, no game" failure.
//
// Fix: inject a tiny shim as the very first thing the document runs. It probes
// real storage; if it works (a same-origin context) it leaves it untouched, and
// if it throws it installs an in-memory replacement. Apps keep working, the
// opaque origin (and its security) stays intact, and nothing persists across a
// hard reload — which is exactly right for a live preview.

const MARKER = "forge-storage-shim";

/** Inline script string (kept compact; runs before any user script). */
export const STORAGE_SHIM = `<script>/*${MARKER}*/(function(){function m(){var s=Object.create(null);var a={getItem:function(k){k=String(k);return k in s?s[k]:null},setItem:function(k,v){s[String(k)]=String(v)},removeItem:function(k){delete s[String(k)]},clear:function(){s=Object.create(null)},key:function(i){var ks=Object.keys(s);return i>=0&&i<ks.length?ks[i]:null}};Object.defineProperty(a,'length',{get:function(){return Object.keys(s).length}});return a}function fix(n){var ok=false;try{var t=window[n];if(t){t.setItem('__forge_probe__','1');t.removeItem('__forge_probe__');ok=true}}catch(e){ok=false}if(!ok){var sh=m();try{Object.defineProperty(window,n,{configurable:true,get:function(){return sh}})}catch(e2){try{window[n]=sh}catch(e3){}}}}fix('localStorage');fix('sessionStorage')})();</script>`;

/**
 * Insert the storage shim so it executes before any user script: right after
 * `<head…>`, else after `<html…>`, else at the very top of the document.
 * Idempotent — safe to call on output that already contains the shim.
 */
export function injectStorageShim(html: string): string {
  if (!html || html.indexOf(MARKER) !== -1) return html;
  const head = /<head[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + STORAGE_SHIM + html.slice(at);
  }
  const htmlTag = /<html[^>]*>/i.exec(html);
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length;
    return html.slice(0, at) + STORAGE_SHIM + html.slice(at);
  }
  return STORAGE_SHIM + html;
}
