import {promises as fs} from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {analyze, EMF_ROOT, EMF_PLAYER} from './analyze.mjs';
import {CATALOG, dependencyOrder, externalDependency, satisfies} from './dependencies.mjs';
import {contained, protect, relative, exists, bytes, hash, json} from './safe.mjs';
import {Backend} from './backend.mjs';
import {emptyRpf} from './rpf.mjs';
import {registerDlc, parseXML, child} from './xml.mjs';
const exec=promisify(execFile);
function claim(op){return(op.target+(op.entry?'/'+op.entry:'')+(op.kind==='dlc-register'?'/#dlc/'+op.pack:'')).toLowerCase();}
function overlaps(a,b){return a===b||a.startsWith(b+'/')||b.startsWith(a+'/');}
async function copyAtomic(from,to){await fs.mkdir(path.dirname(to),{recursive:true});const tmp=`${to}.${randomUUID()}.tmp`;try{await fs.copyFile(from,tmp);const f=await fs.open(tmp,'r+');try{await f.sync();}finally{await f.close();}await fs.rename(tmp,to);}finally{await fs.rm(tmp,{force:true});}}
export class Engine {
  constructor(store,{testMode=false,failAfter=Infinity}={}){this.store=store;this.testMode=testMode;this.failAfter=failAfter;}
  get config(){return this.store.data.config;}
  get backend(){return new Backend(this.config);}
  async emfReady(game){
    if(!await externalDependency('emf',game))return false;
    try{
      const outer=await contained(game,EMF_ROOT),entries=await this.backend.list(outer,'x64/streamedpeds_players.rpf');
      if(!entries.some(e=>e.path.toLowerCase()==='player_one'&&e.kind==='directory'))return false;
      const update=await contained(game,'mods/update/update.rpf');if(!await exists(update))return false;
      const xml=parseXML((await this.backend.read(update,'common/data/dlclist.xml')).toString()),paths=child(xml,'Paths');
      return !!paths?.children.some(c=>c.name==='Item'&&/^dlcpacks:[\\/]EMFsingleplayer[\\/]$/i.test(c.text.trim()));
    }catch{return false;}
  }
  async game(write=false){
    const g=this.config.gamePath;if(!g)throw Error('Select the GTA V Legacy folder in Settings.');
    if(!await exists(path.join(g,'GTA5.exe')))throw Error('GTA5.exe not found. Select the Legacy game folder.');
    if(await exists(path.join(g,'GTA5_Enhanced.exe')))throw Error('Enhanced game folder is not supported.');
    if(write&&!this.testMode){
      if(process.platform!=='win32'||this.config.preparationMode)throw Error('Installation is available on Windows. Export a preparation bundle from this computer.');
      const {stdout}=await exec('tasklist',['/FO','CSV','/NH'],{windowsHide:true,timeout:10000});
      if(/"GTA5(?:_Enhanced)?\.exe"|"PlayGTAV\.exe"/i.test(stdout))throw Error('Close GTA V before installation.');
    }
    return path.resolve(g);
  }
  async verifiedDependency(id,version='*'){
    for(const req of CATALOG[id]?.required||[])if(!await this.verifiedDependency(req))return false;
    const matches=this.store.data.installed.filter(x=>x.dependencyKey===id);
    for(const i of matches){if(!satisfies(i.version,version))continue;try{
      await this.verify(i.modId);let current=true;
      for(const f of i.files){
        const owner=/\.rpf$/i.test(f.target)?this.store.data.installed.findLast(n=>n.files.some(g=>g.target.toLowerCase()===f.target.toLowerCase())):i;
        const expected=owner?.files.find(g=>g.target.toLowerCase()===f.target.toLowerCase())?.hash,p=await contained(this.config.gamePath,f.target);
        if(!await exists(p)||await hash(p)!==expected){current=false;break;}
      }
      if(current&&(id!=='emf'||await this.emfReady(this.config.gamePath)))return true;
    }catch{}}
    if(matches.length)return false;
    if(version!=='*')return false;
    const g=this.config.gamePath;if(!await externalDependency(id,g))return false;
    if(id==='emf')return this.emfReady(g);
    return true;
  }
  async plan(modId){
    await this.store.integrity(modId);const mod=this.store.mod(modId),p=await analyze(mod,this.store.dir(modId));
    if(mod.reviewedPlan){p.operations=mod.reviewedPlan.operations;p.requires=mod.reviewedPlan.requires||p.requires;p.method=mod.reviewedPlan.method||'reviewed';p.blockers=[];p.evidence.push('User-reviewed installation mapping.');}
    p.id=randomUUID();p.createdAt=new Date().toISOString();p.conflicts=[];p.missing=[];p.expected={};p.targets=[];
    if(mod.dependencyKey)for(const installed of this.store.data.installed)for(const req of installed.requires.filter(r=>r.kind==='required'&&r.id===mod.dependencyKey&&r.version&&r.version!=='*'))if(!satisfies(mod.version,req.version))p.blockers.push(`${installed.name} requires ${req.id} ${req.version}; incoming version is ${mod.version}.`);
    const game=this.config.gamePath;
    for(const req of p.requires.filter(r=>r.kind==='required'))if(!await this.verifiedDependency(req.id,req.version||'*'))p.missing.push(req);
    for(const op of p.operations){
      const alias=p.targets.find(t=>t.toLowerCase()===op.target.toLowerCase());if(alias)op.target=alias;
      protect(op.target);if(op.source&&!mod.files.includes(op.source))throw Error('Plan references an unknown source.');
      if(op.entry)relative(op.entry);if(!['copy','delete','rpf-add','rpf-delete','rpf-mkdir','dlc-register','ensure-archive'].includes(op.kind))throw Error('Unsupported installation operation.');
      if(!p.targets.includes(op.target))p.targets.push(op.target);
      for(const i of this.store.data.installed)if(i.modId!==modId)for(const c of i.claims){
        const frameworkContainer=i.dependencyKey==='emf'&&c===EMF_ROOT.toLowerCase()&&op.target.toLowerCase()===EMF_ROOT.toLowerCase()&&Boolean(op.entry);
        if(!frameworkContainer&&overlaps(c,claim(op)))p.conflicts.push({target:claim(op),modId:i.modId,name:i.name});
      }
      if(game){
        const target=await contained(game,op.target),present=await exists(target);
        if(!(op.target in p.expected))p.expected[op.target]=present?await hash(target):null;
        if(op.kind.startsWith('rpf-')){
          const fallback=op.target.replace(/^mods\//i,'');const base=present?target:await contained(game,fallback);
          if(!await exists(base)&&!p.operations.some(o=>o.target.toLowerCase()===op.target.toLowerCase()&&['copy','ensure-archive'].includes(o.kind))){
            if(!p.missing.some(r=>r.id==='emf'))p.blockers.push(`Archive missing: ${op.target}`);
          } else if(p.method==='emf'&&await exists(base)){
            try{
              const folder=op.entry.slice(0,op.entry.lastIndexOf('/')),inner=folder.slice(0,folder.toLowerCase().lastIndexOf('.rpf')+4),dir=folder.slice(inner.length+1);
              const listing=await this.backend.list(base,inner);
              if(!listing.some(e=>e.path.toLowerCase()===dir.toLowerCase()&&e.kind==='directory'))p.blockers.push(`EMF character destination not found: ${folder}`);
              if(listing.some(e=>(inner+'/'+e.path).toLowerCase()===op.entry.toLowerCase())&&!p.conflicts.some(c=>c.target===claim(op)))p.conflicts.push({target:claim(op),name:'Existing EMF slot (unmanaged)',modId:null});
            }catch(e){p.blockers.push(e.message);}
          } else if(op.kind==='rpf-add'&&present){
            try{
              const current=await this.backend.read(target,op.entry);let stock=false;
              const original=await contained(game,op.target.replace(/^mods\//i,''));
              if(await exists(original)){try{stock=current.equals(await this.backend.read(original,op.entry));}catch{}}
              if(!stock&&!p.conflicts.some(c=>c.target===claim(op)))p.conflicts.push({target:claim(op),name:op.target.toLowerCase()===EMF_ROOT.toLowerCase()?'Existing EMF slot (unmanaged)':'Existing archive entry (unmanaged)',modId:null});
            }catch(e){if(!/does not exist|not found/i.test(e.message))p.blockers.push(e.message);}
          }
        }else if(op.kind==='copy'&&present&&!p.conflicts.some(c=>c.target===claim(op))&&!this.store.data.installed.some(i=>i.modId===modId))p.conflicts.push({target:claim(op),name:'Existing file (unmanaged)',modId:null});
      }
    }
    for(const req of p.requires)if(typeof req.id!=='string'||!req.id||!['required','recommended','optional'].includes(req.kind))throw Error('Invalid dependency declaration.');
    p.conflicts=[...new Map(p.conflicts.map(c=>[c.target+':'+c.modId,c])).values()];p.blockers=[...new Set(p.blockers)];
    this.store.plans.set(p.id,p);return p;
  }
  async preview(id){const p=await this.plan(id);return p;}
  async install(planId,{overwrite=false}={}){
    if(this.recoveryBlocked)throw Error('Resolve interrupted-installation recovery in Backups before installing.');
    const p=this.store.plans.get(planId);if(!p)throw Error('Preview the installation again.');
    if(p.blockers.length)throw Error(p.blockers.join('\n'));if(p.conflicts.length&&!overwrite)throw Error('Review the conflicts and explicitly enable overwrite to continue.');
    if(this.store.data.installed.some(i=>i.modId===p.modId))throw Error('This mod is already enabled.');
    for(const r of p.requires.filter(r=>r.kind==='required'))if(!await this.verifiedDependency(r.id,r.version||'*'))throw Error(`Required dependency not verified: ${r.id}`);
    const game=await this.game(true);await this.store.integrity(p.modId);
    for(const [target,expected]of Object.entries(p.expected)){const file=await contained(game,target),now=await exists(file)?await hash(file):null;if(now!==expected)throw Error(`Destination changed since preview: ${target}. Preview again.`);}
    const id=randomUUID(),base=path.join(this.store.root,'transactions',id);await fs.mkdir(base,{recursive:true});
    const journal={id,modId:p.modId,game,status:'preparing',createdAt:new Date().toISOString(),files:[],plan:p};
    const journalPath=path.join(base,'journal.json');await json(journalPath,journal);
    try {
      for(let i=0;i<p.targets.length;i++){
        const target=p.targets[i],real=await contained(game,target),stage=path.join(base,'stage',String(i),path.basename(target)),backup=path.join(base,`${i}.backup`),before=await exists(real)?await hash(real):null;
        await fs.mkdir(path.dirname(stage),{recursive:true});
        if(before){await fs.copyFile(real,backup);if(await hash(backup)!==before)throw Error('Backup verification failed.');await fs.copyFile(real,stage);}
        else if(/\.rpf$/i.test(target)){
          const source=await contained(game,target.replace(/^mods\//i,''));
          if(await exists(source))await fs.copyFile(source,stage);
        }
        journal.files.push({target,before,after:null,stage,backup:before?backup:null});
      }
      for(const op of p.operations){
        const record=journal.files.find(f=>f.target===op.target),staged=record.stage;
        if(op.kind==='copy'){
          const source=await contained(this.store.dir(p.modId),op.source);
          if(/\.rpf$/i.test(op.target)){const f=await fs.open(source,'r');try{const header=Buffer.alloc(16),r=await f.read(header,0,16,0);if(r.bytesRead!==16||header.readUInt32LE(0)!==0x52504637)throw Error('DLC/archive payload is not an RPF7 file.');}finally{await f.close();}}
          await fs.copyFile(source,staged);
        }
        else if(op.kind==='delete'){await fs.rm(staged,{force:true});}
        else if(op.kind==='ensure-archive'){if(!await exists(staged))await fs.writeFile(staged,emptyRpf());}
        else if(op.kind==='rpf-mkdir'){await this.backend.mkdir(staged,op.entry);}
        else {
          if(!await exists(staged))throw Error(`Archive does not exist: ${op.target}`);
          let data;
          if(op.kind==='dlc-register')data=Buffer.from(registerDlc((await this.backend.read(staged,op.entry)).toString(),op.pack));
          else if(op.kind==='rpf-add')data=await bytes(await contained(this.store.dir(p.modId),op.source));
          await this.backend.edit(staged,op.entry,data,{remove:op.kind==='rpf-delete',createFolders:p.method!=='emf'&&op.createFolders===true});
          if(data){const actual=await this.backend.read(staged,op.entry);if(!actual.equals(data))throw Error(`Archive edit verification failed: ${op.entry}`);}
        }
      }
      for(const f of journal.files)f.after=await exists(f.stage)?await hash(f.stage):null;
      journal.status='prepared';await json(journalPath,journal);let count=0;
      for(const f of journal.files){
        const target=await contained(game,f.target),current=await exists(target)?await hash(target):null;
        if(current!==f.before)throw Error(`External change detected before commit: ${f.target}`);
        if(f.after)await copyAtomic(f.stage,target);else if(f.before)await fs.unlink(target);
        if(++count>=this.failAfter)throw Error('Injected interrupted installation.');
      }
      journal.status='committed';await json(journalPath,journal);
      const mod=this.store.mod(p.modId),record={modId:mod.id,name:mod.name,version:mod.version,dependencyKey:mod.dependencyKey,transaction:id,installedAt:new Date().toISOString(),requires:p.requires,claims:p.operations.map(claim),files:journal.files.map(f=>({target:f.target,hash:f.after}))};
      this.store.data.installed.push(record);this.store.data.history.push({action:'install',modId:mod.id,name:mod.name,transaction:id,at:record.installedAt});await this.store.save();
      journal.status='complete';await json(journalPath,journal);this.store.plans.delete(planId);return record;
    }catch(e){
      if(['prepared','committed'].includes(journal.status)){
        try{await this.restoreJournal(journal);this.store.data.installed=this.store.data.installed.filter(i=>i.transaction!==id);await this.store.save();journal.status='rolled-back';}
        catch(r){journal.status='recovery-required';journal.recoveryError=r.message;}
      } else journal.status='aborted';
      journal.error=e.message;await json(journalPath,journal);throw Error(journal.status==='recovery-required'?`${e.message}. Recovery paused: ${journal.recoveryError}`:e.message);
    }
  }
  async restoreJournal(j){
    // Preflight the entire restore before touching anything; preserve external edits.
    for(const f of j.files){
      const p=await contained(j.game,f.target),h=await exists(p)?await hash(p):null;
      if(h!==f.before&&h!==f.after)throw Error(`File changed externally: ${f.target}`);
      if(f.before&&(!await exists(f.backup)||await hash(f.backup)!==f.before))throw Error(`Backup missing or damaged: ${f.target}`);
    }
    for(const f of [...j.files].reverse()){
      const p=await contained(j.game,f.target),h=await exists(p)?await hash(p):null;if(h===f.before)continue;
      if(h!==f.after)throw Error(`File changed during restoration: ${f.target}`);
      if(f.before)await copyAtomic(f.backup,p);else if(h!==null)await fs.unlink(p);
    }
  }
  async verify(modId){
    const i=this.store.data.installed.find(i=>i.modId===modId);if(!i)throw Error('Mod is not enabled.');
    const all=this.store.data.installed,index=all.indexOf(i);
    for(const f of i.files){
      if(all.slice(index+1).some(n=>n.files.some(g=>g.target.toLowerCase()===f.target.toLowerCase())))continue;
      const p=await contained(this.config.gamePath,f.target),h=await exists(p)?await hash(p):null;if(h!==f.hash)throw Error(`Installed file changed externally: ${f.target}`);
    }
    return {verified:true,scope:'Installed file hashes, not in-game loading.'};
  }
  async uninstall(modId,{switching=false}={}){
    await this.game(true);const all=this.store.data.installed,i=all.find(x=>x.modId===modId);if(!i)throw Error('Mod is not enabled.');
    const dependents=all.filter(x=>x.modId!==modId&&x.requires.some(r=>r.kind==='required'&&r.id===i.dependencyKey));
    if(dependents.length)throw Error(`Dependency is used by ${dependents.map(x=>x.name).join(', ')}.`);
    const index=all.indexOf(i);if(all.slice(index+1).some(n=>n.files.some(f=>i.files.some(g=>f.target.toLowerCase()===g.target.toLowerCase()))))throw Error('A newer mod shares an archive/file. Disable the newer mod first to preserve it.');
    const jp=path.join(this.store.root,'transactions',i.transaction,'journal.json'),j=JSON.parse(await fs.readFile(jp,'utf8'));
    j.status='uninstalling';await json(jp,j);await this.restoreJournal(j);
    this.store.data.installed=all.filter(x=>x!==i);this.store.data.history.push({action:'disable',name:i.name,modId,transaction:i.transaction,at:new Date().toISOString()});await this.store.save();j.status='uninstalled';await json(jp,j);return{removed:modId};
  }
  async recover(){
    const base=path.join(this.store.root,'transactions');if(!await exists(base))return[];const recovered=[];
    for(const id of await fs.readdir(base)){
      const p=path.join(base,id,'journal.json');if(!await exists(p))continue;const j=JSON.parse(await fs.readFile(p,'utf8'));
      if(['prepared','committed','uninstalling','recovery-required'].includes(j.status)){
        try{await this.restoreJournal(j);this.store.data.installed=this.store.data.installed.filter(i=>i.transaction!==j.id);j.status='recovered';await json(p,j);await this.store.save();recovered.push({id,status:j.status});}
        catch(e){j.status='recovery-required';j.recoveryError=e.message;await json(p,j);recovered.push({id,status:j.status,error:e.message});}
      }
    }
    this.recoveryBlocked=recovered.some(r=>r.status==='recovery-required');return recovered;
  }
  async queue(ids){
    const nodes={};for(const mod of this.store.data.mods){const p=await analyze(mod,this.store.dir(mod.id));const req=mod.reviewedPlan?.requires||p.requires;nodes[mod.id]={...mod,requires:req.filter(r=>r.kind==='required')};if(mod.dependencyKey)nodes[mod.dependencyKey]={...mod,requires:req.filter(r=>r.kind==='required')};}
    for(const [id,c]of Object.entries(CATALOG))if(!nodes[id])nodes[id]={id,version:'unknown',name:c.name,requires:c.required.map(id=>({id,kind:'required'})),missing:true};
    const order=dependencyOrder(ids,nodes),result=[];const seen=new Set();
    for(const key of order){const n=nodes[key],dep=CATALOG[key]?key:n.dependencyKey;if(seen.has(n.id))continue;seen.add(n.id);
      result.push({key,modId:n.missing?null:n.id,name:n.name,status:dep&&await this.verifiedDependency(dep,n.version&&n.version!=='unknown'?'='+n.version:'*')?'verified':n.missing?'needs-archive':'pending'});}
    this.store.data.queue=result;await this.store.save();return result;
  }
  async runQueue(ids,{overwrite=false}={}){
    const outcomes=[];
    // Plan each root separately so one failed branch cannot cancel unrelated jobs.
    for(const id of ids){try{
      const items=await this.queue([id]);let blocked=false;
      for(const q of items){if(q.status==='verified')continue;
        if(!q.modId){q.status='needs-archive';blocked=true;continue;}
        if(blocked){q.status='paused';continue;}
        if(this.store.data.installed.some(i=>i.modId===q.modId)){try{await this.verify(q.modId);q.status='verified';continue;}catch(e){q.status='failed';q.error=e.message;blocked=true;continue;}}
        try{const p=await this.plan(q.modId);await this.install(p.id,{overwrite:overwrite&&q.modId===id});q.status='installed';}catch(e){q.status='failed';q.error=e.message;blocked=true;}
      }
      this.store.data.queue=items;await this.store.save();outcomes.push({id,items,success:!blocked});
    }catch(e){outcomes.push({id,success:false,error:e.message});}}
    this.store.data.pendingRoots=outcomes.filter(x=>!x.success).map(x=>x.id);await this.store.save();return outcomes;
  }
  async switchProfile(profileId){
    const profile=this.store.data.profiles.find(p=>p.id===profileId);if(!profile)throw Error('Profile does not exist.');
    await this.game(true);for(const i of this.store.data.installed)await this.verify(i.modId);
    for(const id of profile.mods){const mod=this.store.mod(id);await this.store.integrity(id);const p=await analyze(mod,this.store.dir(id));if(p.blockers.length&&!mod.reviewedPlan)throw Error(`Profile cannot be enabled: ${p.name}: ${p.blockers.join('; ')}`);}
    await this.queue(profile.mods);
    const before=this.store.data.installed.map(i=>i.modId);let changed=false;
    try{
      for(const i of [...this.store.data.installed].reverse())await this.uninstall(i.modId,{switching:true});changed=true;
      const results=await this.runQueue(profile.mods);if(results.some(x=>!x.success))throw Error('Profile installation paused. Previous profile will be restored.');
      this.store.data.activeProfile=profileId;await this.store.save();return{profile:profile.name};
    }catch(e){if(changed){for(const i of [...this.store.data.installed].reverse())await this.uninstall(i.modId,{switching:true});const restored=await this.runQueue(before,{overwrite:true});if(restored.some(x=>!x.success))throw Error(`${e.message} Automatic restoration also paused; inspect Backups.`);}throw e;}
  }
}
