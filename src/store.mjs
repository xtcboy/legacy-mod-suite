import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {json, exists, contained, hash, bytes, walk} from './safe.mjs';
import {extract} from './archives.mjs';
export class Store {
  constructor(root){this.root=path.resolve(root);this.statePath=path.join(this.root,'state.json');this.plans=new Map();this.tail=Promise.resolve();}
  async open(){
    await fs.mkdir(this.root,{recursive:true});const lock=path.join(this.root,'lock');
    if(await exists(lock)){
      const pid=Number(await fs.readFile(lock,'utf8'));let alive=true;try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}
      if(alive)throw Error('Another Legacy Mod Suite instance is using this data folder.');await fs.rm(lock);
    }
    this.lock=await fs.open(lock,'wx');await this.lock.writeFile(String(process.pid));
    if(await exists(this.statePath))this.data=JSON.parse(await fs.readFile(this.statePath,'utf8'));
    else {this.data={schema:1,config:{gamePath:'',sevenZip:'',bridgePath:'',codewalkerCore:'',keysPath:'',aiEndpoint:'',aiModel:'',preparationMode:process.platform!=='win32'},mods:[],installed:[],history:[],profiles:[{id:'vanilla',name:'Vanilla',mods:[]}],queue:[]};await this.save();}
    if(this.data.schema!==1)throw Error('Unsupported installation database version.');this.data.pendingRoots||=[];return this;
  }
  async close(){await this.lock?.close();await fs.rm(path.join(this.root,'lock'),{force:true});}
  async save(){await json(this.statePath,this.data);}
  async serial(fn){const task=this.tail.then(fn);this.tail=task.catch(()=>{});return task;}
  mod(id){const m=this.data.mods.find(x=>x.id===id);if(!m)throw Error('Mod does not exist.');return m;}
  dir(id){return path.join(this.root,'mods',this.mod(id).id,'content');}
  async import(file, metadata={}) {
    const id=randomUUID(),base=path.join(this.root,'mods',id),dest=path.join(base,'content');await fs.mkdir(dest,{recursive:true});
    try{
      const st=await fs.lstat(file);if(st.isSymbolicLink())throw Error('Symbolic link imports are refused.');
      if(st.isDirectory()){
        for(const rel of await walk(file)){const from=await contained(file,rel),to=await contained(dest,rel);await fs.mkdir(path.dirname(to),{recursive:true});await fs.copyFile(from,to);}
      } else await extract(file,dest,this.data.config.sevenZip);
      // Remove a single cosmetic wrapper directory, while preserving explicit deployment roots.
      let files=await walk(dest);
      while(files.length&&files.every(f=>f.includes('/'))){
        const roots=new Set(files.map(f=>f.split('/')[0]));if(roots.size!==1)break;const top=[...roots][0];
        if(/^(scripts|mods|plugins|EMFsingleplayer|content)$/i.test(top))break;
        const tmp=path.join(base,'unwrap');await fs.rename(path.join(dest,top),tmp);await fs.rm(dest,{recursive:true});await fs.rename(tmp,dest);files=await walk(dest);
      }
      if(!files.length)throw Error('Archive has no files.');
      const hashes={};for(const rel of files)hashes[rel]=await hash(await contained(dest,rel));
      const mod={id,name:metadata.name||path.basename(file).replace(/\.(zip|rar|7z|oiv)$/i,''),version:metadata.version||'unknown',sourceURL:metadata.sourceURL||'',instructions:metadata.instructions||'',dependencyKey:metadata.dependencyKey||'',userRequires:metadata.userRequires||[],files,hashes,importedAt:new Date().toISOString()};
      this.data.mods.push(mod);await this.save();return mod;
    }catch(e){await fs.rm(base,{recursive:true,force:true});throw e;}
  }
  async integrity(id){const m=this.mod(id);for(const rel of m.files){const p=await contained(this.dir(id),rel);if(!await exists(p)||await hash(p)!==m.hashes[rel])throw Error(`Imported mod content changed: ${rel}. Import a fresh copy.`);}}
  publicState(){return{...this.data,platform:process.platform,dataPath:this.root,capabilities:{nativeRpf:'OPEN/NONE RPF7, up to 256 MiB',encryptedRpf:this.data.config.bridgePath?'Optional bridge configured; requires runtime validation':'Unavailable until optional bridge is configured',modelPreview:false,desktop:Boolean(process.versions.electron),aiConfigured:Boolean(this.data.config.aiEndpoint)}};}
}
