import {exists, contained} from './safe.mjs';
export const CATALOG = {
  'asi-loader': {name:'ASI Loader', required:[], files:['dinput8.dll'], page:'http://www.dev-c.com/gtav/scripthookv/'},
  'openiv-asi': {name:'OpenIV.ASI', required:['asi-loader'], files:['OpenIV.asi'], page:'https://openiv.com/'},
  'scripthookv': {name:'Script Hook V', required:['asi-loader'], files:['ScriptHookV.dll'], page:'http://www.dev-c.com/gtav/scripthookv/'},
  'shvdn': {name:'ScriptHookVDotNet', required:['scripthookv'], files:['ScriptHookVDotNet.asi','ScriptHookVDotNet3.dll'], github:'scripthookvdotnet/scripthookvdotnet', asset:/\.zip$/i, page:'https://github.com/scripthookvdotnet/scripthookvdotnet/releases'},
  'lemonui': {name:'LemonUI (SHVDN3)', required:['shvdn'], files:['scripts/LemonUI.SHVDN3.dll'], github:'LemonUIbyLemon/LemonUI', asset:/\.zip$/i, page:'https://github.com/LemonUIbyLemon/LemonUI/releases'},
  'emf': {name:'EMFSingleplayer', required:['openiv-asi'], files:['mods/update/x64/dlcpacks/EMFsingleplayer/dlc.rpf'], page:'https://www.gta5-mods.com/tools/emfsp-easy-mod-folder-for-sp-player-mods'},
  'heap-adjuster': {name:'Heap Adjuster',required:['asi-loader'],files:['HeapAdjuster.asi'],page:'https://www.gta5-mods.com/tools/heapadjuster'},
  'packfile-adjuster': {name:'Packfile Limit Adjuster',required:['asi-loader'],files:['PackfileLimitAdjuster.asi'],page:'https://www.gta5-mods.com/tools/packfile-limit-adjuster'},
  'gameconfig': {name:'Compatible gameconfig',required:['openiv-asi'],files:[],page:'https://www.gta5-mods.com/misc/gta-5-gameconfig-300-cars'}
};
export function satisfies(version, constraint='*') {
  if(!constraint||constraint==='*')return true;
  if(!/^v?\d+(\.\d+){0,3}$/.test(version||''))return false;
  const compare=(a,b)=>{const x=a.replace(/^v/,'').split('.').map(Number),y=b.replace(/^v/,'').split('.').map(Number);for(let i=0;i<4;i++){const d=(x[i]||0)-(y[i]||0);if(d)return Math.sign(d);}return 0;};
  return constraint.split(/\s+/).every(t=>{const m=/^(>=|<=|>|<|=|\^|~)?(v?\d+(?:\.\d+){0,3})$/.exec(t);if(!m)throw Error(`Unsupported version constraint: ${constraint}`);const c=compare(version,m[2]);switch(m[1]){case '>=':return c>=0;case '<=':return c<=0;case '>':return c>0;case '<':return c<0;case '^':case '~':{const base=m[2].replace(/^v/,'').split('.').map(Number),upper=[...base];const ix=m[1]==='~'?Math.min(1,base.length-1):Math.min(base.findIndex(n=>n!==0)<0?base.length-1:base.findIndex(n=>n!==0),2);upper[ix]++;for(let j=ix+1;j<upper.length;j++)upper[j]=0;return c>=0&&compare(version,upper.join('.'))<0;}default:return c===0;}});
}
export function dependencyOrder(ids, nodes) {
  const result=[],active=new Set(),done=new Set();
  const visit=id=>{
    if(active.has(id))throw Error(`Circular dependency involving ${id}`);if(done.has(id))return;
    const n=nodes[id];if(!n)throw Error(`Missing dependency: ${id}`);active.add(id);
    for(const req of n.requires??[])if(req.kind!=='optional'&&req.kind!=='recommended'){
      const dep=typeof req==='string'?{id:req}:req;visit(dep.id);
      const provider=nodes[dep.id];if(dep.version&&!satisfies(provider.version,dep.version))throw Error(`Version conflict: ${dep.id} needs ${dep.version}, found ${provider.version||'unknown'}`);
    }
    active.delete(id);done.add(id);result.push(id);
  };for(const id of ids)visit(id);return result;
}
export async function externalDependency(id, game) {
  const c=CATALOG[id];if(!c||!c.files.length||!game)return false;
  for(const file of c.files)if(!await exists(await contained(game,file)))return false;
  return true;
}
export function requirementsFromText(text) {
  const patterns=[['emf',/EMF(?:Singleplayer|sp)?|easy mod folder/i],['scripthookv',/script\s*hook\s*v(?!\s*(?:\.net|dotnet))/i],['shvdn',/scripthookvdotnet|script\s*hook\s*v\s*\.net/i],['lemonui',/lemonui/i],['heap-adjuster',/heap\s*adjuster/i],['packfile-adjuster',/packfile\s*limit\s*adjuster/i],['openiv-asi',/OpenIV[.\s]+ASI/i]];
  const out=[];
  for(const line of text.split(/[\r\n]+/))for(const [id,re]of patterns)if(re.test(line)){
    if(/not required|does(?:n't| not) require|without\s+(?:EMF|script)/i.test(line))continue;
    const kind=/optional/i.test(line)?'optional':/recommend|suggest/i.test(line)?'recommended':'required';
    if(id==='emf'&&/do not use|not compatible|not supported|incompatible/i.test(line))continue;
    const match=re.exec(line),tail=line.slice(match.index+match[0].length).replace(/^[*_\s:(]+/,''),v=/^(?:version\s+|v)?(>=|<=|\^|~|=)?(\d+(?:\.\d+){1,3})\b/i.exec(tail);
    if(!out.some(x=>x.id===id))out.push({id,kind,...(v?{version:(v[1]||'=')+v[2]}:{}),evidence:line.trim().slice(0,350)});
  }
  return out;
}
