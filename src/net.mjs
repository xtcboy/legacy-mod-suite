import dns from 'node:dns/promises';
import net from 'node:net';
import {MAX_BYTES, atomic} from './safe.mjs';
import {decode} from './xml.mjs';
function privateAddress(s){
  if(s.includes(':'))return s==='::1'||s==='::'||/^(fc|fd|fe[89ab])/i.test(s)||s.includes('.')||s.toLowerCase().startsWith('::ffff:');
  const a=s.split('.').map(Number);return a[0]===0||a[0]===10||a[0]===127||a[0]>=224||a[0]===169&&a[1]===254||a[0]===172&&a[1]>=16&&a[1]<=31||a[0]===192&&a[1]===168||a[0]===100&&a[1]>=64&&a[1]<=127;
}
export async function publicURL(raw) {
  const u=new URL(raw);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('Use a public HTTP(S) URL.');
  if(u.port&&!['80','443'].includes(u.port))throw Error('Nonstandard download ports are refused.');
  const host=u.hostname.replace(/^\[|\]$/g,'');
  const addrs=net.isIP(host)?[{address:host}]:await dns.lookup(host,{all:true});
  if(!addrs.length||addrs.some(x=>privateAddress(x.address)))throw Error('Private/local network download URLs are refused.');return u;
}
export async function fetchPublic(url, {limit=MAX_BYTES, accept='*/*'}={}) {
  let u=url;
  for(let i=0;i<6;i++){
    await publicURL(u);
    const r=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(30000),headers:{'User-Agent':'LegacyModSuite/0.1.0 (+local mod preparation)',Accept:accept}});
    if([301,302,303,307,308].includes(r.status)){const loc=r.headers.get('location');if(!loc)throw Error('Redirect missing a location.');await r.body?.cancel();u=new URL(loc,u).href;continue;}
    if(!r.ok)throw Error(`Download unavailable (HTTP ${r.status}). Import the archive or paste author instructions.`);
    if(Number(r.headers.get('content-length')||0)>limit)throw Error('Download too large.');
    let n=0;const chunks=[];for await(const b of r.body){n+=b.length;if(n>limit)throw Error('Download size limit exceeded.');chunks.push(b);}
    return {body:Buffer.concat(chunks),url:u,type:r.headers.get('content-type')||''};
  }
  throw Error('Too many redirects.');
}
export function pageInfo(html,url) {
  if(/just a moment|cf-chl-|verify you are human/i.test(html))throw Error('This page requires a browser download. Import its archive.');
  let description='';
  const opening=/<(div|section|article)\b[^>]*(?:id|class)\s*=\s*["'][^"']*\bmod-description\b[^"']*["'][^>]*>/i.exec(html);
  if(opening){let depth=1;const rest=html.slice(opening.index+opening[0].length),tags=new RegExp(`<\\/?${opening[1]}\\b[^>]*>`,'ig');for(const tag of rest.matchAll(tags)){depth+=tag[0].startsWith('</')?-1:1;if(!depth){description=rest.slice(0,tag.index);break;}}}
  if(!description)for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{const j=JSON.parse(m[1]);if(typeof j.description==='string'){description=j.description;break;}}catch{}}
  const text=decode(description.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi,'\n').replace(/<[^>]+>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n');
  const title=decode(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]*>/g,'')||/<title>(.*?)<\/title>/i.exec(html)?.[1]||'Imported mod').trim();
  const links=[];
  for(const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    try{const href=new URL(decode(m[1]),url).href,label=decode(m[2].replace(/<[^>]*>/g,'')).trim();if(/download|\.zip|\.rar|\.7z/i.test(href+' '+label))links.push({url:href,label});}catch{}
  }
  return {title,instructions:text.slice(0,60000),instructionStatus:description?'author-section':'needs-pasted-instructions',source:url,links:[...new Map(links.map(l=>[l.url,l])).values()]};
}
export async function analyzeURL(url){const r=await fetchPublic(url,{limit:4*1024*1024,accept:'text/html'});return pageInfo(r.body.toString(),r.url);}
export async function resolveDownload(url) {
  if(/\.(zip|rar|7z|oiv)(\?|$)/i.test(url))return url;
  const first=await analyzeURL(url);
  const exact=first.links.filter(l=>/\.(zip|rar|7z|oiv)(\?|$)/i.test(l.url));if(exact.length===1)return exact[0].url;
  const u=new URL(url);
  if(u.hostname.endsWith('gta5-mods.com')){
    const versionLinks=first.links.filter(l=>/\/download\/\d+/.test(l.url)&&!/^RENAME/i.test(l.label));
    if(versionLinks.length===1){const second=await analyzeURL(versionLinks[0].url);const files=second.links.filter(l=>/\.(zip|rar|7z|oiv)(\?|$)/i.test(l.url));if(files.length===1)return files[0].url;}
  }
  throw Error('No unambiguous direct archive link. Use Import archive.');
}
export async function officialRelease(repo, pattern) {
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo))throw Error('Invalid GitHub repository.');
  const r=await fetchPublic(`https://api.github.com/repos/${repo}/releases/latest`,{limit:4*1024*1024,accept:'application/vnd.github+json'}),j=JSON.parse(r.body);
  const assets=j.assets.filter(a=>pattern.test(a.name));if(assets.length!==1)throw Error('Official release has ambiguous or missing assets. Import the compatible dependency archive.');return{url:assets[0].browser_download_url,version:j.tag_name.replace(/^v/,'')};
}
export async function download(url,path){const r=await fetchPublic(url);if(!r.body.subarray(0,8).includes(Buffer.from('PK'))&&!/\.(rar|7z)(\?|$)/i.test(r.url))throw Error('Server did not return an archive.');await atomic(path,r.body);return path;}
