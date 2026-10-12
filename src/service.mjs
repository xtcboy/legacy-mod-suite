import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from './store.mjs';
import {Engine} from './engine.mjs';
import {CATALOG} from './dependencies.mjs';
import {aiPropose} from './analyze.mjs';
import {analyzeURL, resolveDownload, officialRelease, download} from './net.mjs';
import {relative, contained, bytes, exists, atomic, protect, digest} from './safe.mjs';
import {makeOiv} from './oiv.mjs';
import {zipBuffer} from './archives.mjs';
import {parseXML} from './xml.mjs';
export async function createService(root, options={}) {
  const store=await new Store(root).open(),engine=new Engine(store,options);
  const recovery=process.platform==='win32'||options.testMode?await engine.recover():[];
  const exports=new Map();
  async function doImport(file,meta){
    const mod=await store.import(file,meta);
    if(mod.dependencyKey==='scripthookv'&&mod.files.some(f=>f.split('/').at(-1).toLowerCase()==='dinput8.dll')&&!store.data.mods.some(m=>m.dependencyKey==='asi-loader'))await store.import(store.dir(mod.id),{name:'ASI Loader (Script Hook V bundle)',dependencyKey:'asi-loader',sourceURL:mod.sourceURL,version:mod.version});
    let resumed=null;if(mod.dependencyKey&&store.data.pendingRoots.length)resumed=await engine.runQueue([...store.data.pendingRoots]);return{mod,resumed};
  }
  async function smartQueue(ids,overwrite){
    const failures=new Map();
    for(const rootId of ids){
      let queue;try{queue=await engine.queue([rootId]);}catch{continue;}
      for(const q of queue.filter(q=>q.status==='needs-archive')){
        const c=CATALOG[q.key];if(!c||failures.has(q.key))continue;
        try{
          const release=c.github?await officialRelease(c.github,c.asset):{url:await resolveDownload(c.page),version:'unknown'};
          const extension=path.extname(new URL(release.url).pathname);if(!/\.(zip|rar|7z|oiv)$/i.test(extension))throw Error('Dependency has no supported direct archive.');
          const file=path.join(store.root,'downloads',randomUUID()+extension);await download(release.url,file);await doImport(file,{name:c.name,dependencyKey:q.key,sourceURL:c.page,version:release.version});
        }catch(e){failures.set(q.key,e.message);}
      }
    }
    const result=await engine.runQueue(ids,{overwrite});for(const r of result)for(const q of r.items||[])if(failures.has(q.key))q.error=failures.get(q.key);await store.save();return result;
  }
  const api={
    async state(){return{...store.publicState(),catalog:Object.fromEntries(Object.entries(CATALOG).map(([id,c])=>[id,{name:c.name,page:c.page,required:c.required,automatic:!!c.github}])),recovery};},
    async settings(args){
      const allowed=['gamePath','sevenZip','bridgePath','codewalkerCore','keysPath','aiEndpoint','aiModel','preparationMode'];
      for(const [k,v]of Object.entries(args))if(allowed.includes(k)){if(k==='gamePath'&&v!==store.data.config.gamePath&&store.data.installed.length)throw Error('Disable enabled mods before changing the game folder.');store.data.config[k]=k==='preparationMode'?Boolean(v):String(v).trim();}
      await store.save();store.plans.clear();return store.data.config;
    },
    async import(args){return doImport(path.resolve(args.path),args.metadata||{});},
    async update(args){const m=store.mod(args.id);for(const k of ['name','version','sourceURL','instructions','dependencyKey','userRequires'])if(args[k]!==undefined)m[k]=args[k];delete m.reviewedPlan;await store.save();store.plans.clear();return m;},
    async analyzeURL(args){return analyzeURL(args.url);},
    async download(args){
      const info=await analyzeURL(args.url),url=await resolveDownload(args.url),p=path.join(store.root,'downloads',randomUUID()+path.extname(new URL(url).pathname));await download(url,p);
      return doImport(p,{name:info.title,sourceURL:args.url,instructions:info.instructions});
    },
    async dependency(args){
      const c=CATALOG[args.id];if(!c)throw Error('Unknown dependency.');
      if(args.path)return doImport(path.resolve(args.path),{name:c.name,dependencyKey:args.id,sourceURL:c.page,version:args.version||'unknown'});
      if(!c.github)throw Error('This dependency needs an author-supplied archive. Import it using the dependency row.');
      const release=await officialRelease(c.github,c.asset),file=path.join(store.root,'downloads',`${randomUUID()}.zip`);await download(release.url,file);
      return doImport(file,{name:c.name,dependencyKey:args.id,version:release.version,sourceURL:c.page});
    },
    async preview(args){return engine.preview(args.id);},
    async install(args){return engine.install(args.planId,{overwrite:!!args.overwrite});},
    async queue(args){return engine.queue(args.ids);},
    async runQueue(args){return smartQueue(args.ids,!!args.overwrite);},
    async uninstall(args){return engine.uninstall(args.id);},
    async verify(args){return engine.verify(args.id);},
    async recover(){return engine.recover();},
    async profile(args){
      if(!args.name?.trim()||!Array.isArray(args.mods))throw Error('Profile name and mod selection are required.');for(const id of args.mods)store.mod(id);
      const id=randomUUID(),profile={id,name:args.name.trim(),mods:args.mods};store.data.profiles.push(profile);await store.save();return profile;
    },
    async switchProfile(args){return engine.switchProfile(args.id);},
    async ai(args){const mod=store.mod(args.id);let instructions=mod.instructions||'';for(const f of mod.files.filter(f=>/(readme|install|requirements)/i.test(f)&&/\.(txt|md|nfo)$/i.test(f)))instructions+='\n'+(await bytes(await contained(store.dir(mod.id),f),512*1024)).toString();const proposed=await aiPropose({...mod,instructions},store.data.config);return{proposed,message:'Review this proposal before accepting it.'};},
    async mapping(args){
      const mod=store.mod(args.id),p=args.plan;if(!Array.isArray(p.operations)||p.operations.length>1000||!p.operations.length)throw Error('Invalid reviewed mapping.');
      for(const o of p.operations){protect(o.target);if(o.entry)relative(o.entry);if(!['copy','rpf-add','rpf-mkdir'].includes(o.kind)||(o.kind!=='rpf-mkdir'&&!mod.files.includes(o.source)))throw Error('Reviewed mapping has unsupported operations or unknown files.');}
      // EMF player plans retain their mandatory requirements even when a mapping is edited.
      const prior=await engine.plan(mod.id);const requires=[...(p.requires||[])];for(const req of prior.requires.filter(r=>r.kind==='required')){const found=requires.find(r=>r.id===req.id);if(!found)requires.push(req);else{found.kind='required';if(req.version&&req.version!=='*'&&req.version!==found.version)found.version=found.version&&found.version!=='*'?found.version+' '+req.version:req.version;}}
      mod.reviewedPlan={...p,requires};await store.save();return engine.preview(mod.id);
    },
    async export(args){
      const mod=store.mod(args.id);await store.integrity(mod.id);const p=await engine.plan(mod.id),sources=new Map();
      if(p.blockers.length)throw Error(p.blockers.join('; '));for(const f of mod.files)sources.set(f,await bytes(await contained(store.dir(mod.id),f)));
      const name=mod.name.replace(/[^\w.-]+/g,'-').slice(0,80)||'mod',kind=args.kind||'bundle';
      let data,filename;
      if(kind==='oiv'){data=makeOiv(mod,p,sources);filename=name+'.oiv';}
      else {
        const entries=new Map();for(const [f,b]of sources)entries.set('payload/'+f,b);
        entries.set('legacy-bundle.json',Buffer.from(JSON.stringify({format:'legacy-suite-bundle-1',mod:{name:mod.name,version:mod.version,sourceURL:mod.sourceURL,instructions:mod.instructions,dependencyKey:mod.dependencyKey},plan:{...p,id:undefined,expected:undefined},note:'Re-preview against the Windows game directory. Dependencies are not embedded.'},null,2)));data=zipBuffer(entries);filename=name+'-windows-bundle.zip';
      }
      const id=randomUUID(),file=path.join(store.root,'exports',id,filename);await atomic(file,data);exports.set(id,{file,filename});return{id,filename};
    },
    async importBundle(args){
      const {mod}=await doImport(path.resolve(args.path),{}),dir=store.dir(mod.id);
      if(!mod.files.includes('legacy-bundle.json')||!mod.files.some(f=>f.startsWith('payload/')))throw Error('Not a Legacy Suite bundle.');
      const doc=JSON.parse((await bytes(path.join(dir,'legacy-bundle.json'))).toString());if(doc.format!=='legacy-suite-bundle-1')throw Error('Unsupported bundle.');
      const result=await store.import(path.join(dir,'payload'),doc.mod);
      // Imported mappings remain proposals until explicitly accepted on the receiving computer.
      result.bundleProposal={operations:doc.plan.operations,requires:doc.plan.requires,method:doc.plan.method};await store.save();return{mod:result,proposal:result.bundleProposal};
    },
    async explorer(args){
      const game=await engine.game(),rel=args.path||'';
      const parts=rel?relative(rel).split('/'):[],idx=parts.findIndex(p=>/\.rpf$/i.test(p));
      if(idx>=0){
        const physical=parts.slice(0,idx+1).join('/'),file=await contained(game,physical),rest=parts.slice(idx+1),last=rest.map((p,i)=>/\.rpf$/i.test(p)?i:-1).filter(i=>i>=0).at(-1)??-1;
        const nested=last>=0?rest.slice(0,last+1).join('/'):'',folder=rest.slice(last+1).join('/'),entries=await engine.backend.list(file,nested);
        const prefix=folder?folder+'/':'';return{path:rel,archive:physical,entries:entries.filter(e=>e.path.toLowerCase().startsWith(prefix.toLowerCase())&&e.path.toLowerCase()!==folder.toLowerCase()&&!e.path.slice(prefix.length).includes('/')).map(e=>({...e,name:e.path.slice(prefix.length),path:[physical,nested,e.path].filter(Boolean).join('/')}))};
      }
      const dir=await contained(game,rel,true),entries=[];
      for(const e of await fs.readdir(dir,{withFileTypes:true})){if(e.isSymbolicLink())continue;const r=rel?rel+'/'+e.name:e.name,s=await fs.stat(await contained(game,r));entries.push({name:e.name,path:r,kind:e.isDirectory()?'directory':/\.rpf$/i.test(e.name)?'archive':'file',size:s.size});}
      return{path:rel,entries};
    },
    async file(args){
      const game=await engine.game(),parts=relative(args.path).split('/'),idx=parts.findIndex(p=>/\.rpf$/i.test(p));
      const data=idx>=0&&idx<parts.length-1?await engine.backend.read(await contained(game,parts.slice(0,idx+1).join('/')),parts.slice(idx+1).join('/')):await bytes(await contained(game,args.path),16*1024*1024);
      const ext=path.extname(args.path).toLowerCase(),isText=['.xml','.meta','.txt','.ini','.cfg','.json','.md'].includes(ext)&&!data.includes(0);
      return{path:args.path,size:data.length,header:data.subarray(0,32).toString('hex'),text:isText?data.toString('utf8').slice(0,512*1024):null,preview:['.png','.jpg','.jpeg','.webp'].includes(ext)?`data:image/${ext.slice(1)};base64,${data.toString('base64')}`:null,resource:data.length>=16&&data.toString('ascii',0,4)==='RSC7'?{version:data.readUInt32LE(4),systemFlags:data.readUInt32LE(8),graphicsFlags:data.readUInt32LE(12)}:null};
    },
    async extractFile(args){
      const game=await engine.game(),rel=relative(args.path),parts=rel.split('/'),idx=parts.findIndex(p=>/\.rpf$/i.test(p));
      const b=idx>=0&&idx<parts.length-1?await engine.backend.read(await contained(game,parts.slice(0,idx+1).join('/')),parts.slice(idx+1).join('/')):await bytes(await contained(game,rel));
      const id=randomUUID(),filename=parts.at(-1),file=path.join(store.root,'exports',id,filename);await atomic(file,b);exports.set(id,{file,filename});return{id,filename};
    },
    async compare(args){
      const game=await engine.game(),modded=relative(args.path);if(!/^mods\//i.test(modded))throw Error('Choose a file under mods to compare with the base game.');
      const base=modded.replace(/^mods\//i,''),read=async rel=>{const p=rel.split('/'),i=p.findIndex(x=>/\.rpf$/i.test(x));return i>=0&&i<p.length-1?engine.backend.read(await contained(game,p.slice(0,i+1).join('/')),p.slice(i+1).join('/')):bytes(await contained(game,rel));};
      const current=await read(modded);let original;try{original=await read(base);}catch(e){if(e.code==='ENOENT'||e.message.includes('does not exist'))return{counterpart:false,message:'No base-game counterpart exists.'};throw e;}
      return{counterpart:true,same:current.equals(original),base:{size:original.length,sha256:digest(original)},modded:{size:current.length,sha256:digest(current)}};
    },
    async editFile(args){
      if(!args.editMode)throw Error('Enable Archive Explorer edit mode first.');
      const destination=relative(args.path),parts=destination.split('/'),idx=parts.findIndex(p=>/\.rpf$/i.test(p)),text=args.text;
      if(typeof text!=='string'||text.length>512*1024)throw Error('Text editor limit exceeded.');if(/\.(xml|meta)$/i.test(destination))parseXML(text);
      const dir=path.join(store.root,'edits',randomUUID());await fs.mkdir(dir,{recursive:true});const file=path.join(dir,parts.at(-1));await fs.writeFile(file,text);
      const mod=await store.import(dir,{name:'Archive edit: '+parts.at(-1)});let target=idx>=0?parts.slice(0,idx+1).join('/'):destination;if(idx>=0&&!target.toLowerCase().startsWith('mods/'))target='mods/'+target;
      const op=idx>=0?{kind:'rpf-add',target,entry:parts.slice(idx+1).join('/'),source:parts.at(-1)}:{kind:'copy',target,source:parts.at(-1)};
      protect(target);mod.reviewedPlan={method:'explorer-edit',operations:[op],requires:idx>=0?[{id:'openiv-asi',kind:'required',evidence:'Mods archive loader required.'}]:[]};await store.save();return engine.preview(mod.id);
    },
    async createFolder(args){
      if(!args.editMode)throw Error('Enable Archive Explorer edit mode first.');const rel=relative(args.path),name=relative(args.name);if(name.includes('/'))throw Error('Enter a folder name without slashes.');
      const parts=rel.split('/'),idx=parts.findIndex(p=>/\.rpf$/i.test(p));if(idx<0)throw Error('This action creates a folder inside an RPF archive.');
      let target=parts.slice(0,idx+1).join('/');if(!/^mods\//i.test(target))target='mods/'+target;const entry=[...parts.slice(idx+1),name].join('/');
      const dir=path.join(store.root,'edits',randomUUID());await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'operation.json'),JSON.stringify({action:'create-folder',target,entry}));
      const mod=await store.import(dir,{name:'Archive folder: '+name});mod.reviewedPlan={method:'explorer-folder',operations:[{kind:'rpf-mkdir',target,entry}],requires:[{id:'openiv-asi',kind:'required',evidence:'Mods archive loader required.'}]};await store.save();return engine.preview(mod.id);
    },
    async importFile(args){
      if(!args.editMode)throw Error('Enable Archive Explorer edit mode first.');
      const target=relative(args.destination),parts=target.split('/'),idx=parts.findIndex(p=>/\.rpf$/i.test(p));
      const dir=path.join(store.root,'edits',randomUUID());await fs.mkdir(dir,{recursive:true});const filename=path.basename(args.source);relative(filename);await fs.copyFile(args.source,path.join(dir,filename));
      const mod=await store.import(dir,{name:'Archive import: '+filename});let physical=idx>=0?parts.slice(0,idx+1).join('/'):target;if(idx>=0&&!physical.toLowerCase().startsWith('mods/'))physical='mods/'+physical;
      const op=idx>=0?{kind:'rpf-add',target:physical,entry:parts.slice(idx+1).join('/')+'/'+filename,source:filename}:{kind:'copy',target:physical+'/'+filename,source:filename};protect(op.target);
      mod.reviewedPlan={method:'explorer-import',operations:[op],requires:idx>=0?[{id:'openiv-asi',kind:'required',evidence:'Mods archive loader required.'}]:[]};await store.save();return engine.preview(mod.id);
    }
  };
  return{store,engine,exports,call:async(method,args={})=>{if(!Object.hasOwn(api,method))throw Error('Unknown operation.');return store.serial(()=>api[method](args));},close:()=>store.close()};
}
