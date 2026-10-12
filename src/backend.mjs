import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {bytes, MAX_BYTES} from './safe.mjs';
import {readRpf, readVirtual, editVirtual, mkdirVirtual} from './rpf.mjs';
export class Backend {
  constructor(config){this.config=config;}
  async bridge(request){
    const c=this.config;if(!c.bridgePath||!c.codewalkerCore)throw Error('Encrypted or large RPF requires the optional Windows CodeWalker bridge.');
    if(process.platform!=='win32')throw Error('The optional CodeWalker bridge runs on Windows.');
    const input={...request,core:c.codewalkerCore,keys:c.keysPath||c.gamePath};
    // Stdin avoids Windows' command-line size limit for real model payloads.
    const stdout=await new Promise((resolve,reject)=>{
      const managed=/\.dll$/i.test(c.bridgePath),child=spawn(managed?'dotnet':c.bridgePath,managed?[c.bridgePath]:[],{windowsHide:true,stdio:['pipe','pipe','pipe']}),chunks=[];let n=0,error='';
      const timer=setTimeout(()=>{child.kill();reject(Error('Archive bridge timed out.'));},120000);
      child.on('error',e=>{clearTimeout(timer);reject(e);});
      child.stdout.on('data',b=>{n+=b.length;if(n>MAX_BYTES){child.kill();reject(Error('Archive bridge response exceeds the size limit.'));}else chunks.push(b);});
      child.stderr.on('data',b=>{if(error.length<16000)error+=b.toString();});
      child.on('close',code=>{clearTimeout(timer);const data=Buffer.concat(chunks).toString();if(data)resolve(data);else reject(Error(error||`Archive bridge exited with code ${code}`));});
      child.stdin.on('error',e=>{if(e.code!=='EPIPE')reject(e);});child.stdin.end(JSON.stringify(input));
    });
    let result;try{result=JSON.parse(stdout.trim());}catch{throw Error('Bridge returned an invalid response.');}if(result.error)throw Error(result.error);return result;
  }
  async read(file,entry){
    try{return readVirtual(await bytes(file),entry);}catch(e){if(e.code!=='ENCRYPTED_RPF'&&!String(e.message).includes('supported size'))throw e;return Buffer.from((await this.bridge({action:'read',file,entry})).base64,'base64');}
  }
  async list(file,entry=''){
    try{
      const b=await bytes(file),inside=entry?readVirtual(b,entry):b;return [...readRpf(inside).values()].map(e=>({path:e.path,name:e.name,kind:e.kind,size:e.size||0,systemFlags:e.kind==='resource'?e.a:undefined,graphicsFlags:e.kind==='resource'?e.z:undefined}));
    }catch(e){if(e.code!=='ENCRYPTED_RPF'&&!String(e.message).includes('supported size'))throw e;return(await this.bridge({action:'list',file,entry})).entries;}
  }
  async edit(file,entry,data,options={}){
    try{const out=editVirtual(await bytes(file),entry,data,options);await fs.writeFile(file,out);}catch(e){if(e.code!=='ENCRYPTED_RPF'&&!String(e.message).includes('supported size'))throw e;await this.bridge({action:options.remove?'delete':'write',file,entry,base64:data?.toString('base64')||'',createFolders:options.createFolders||false});}
  }
  async mkdir(file,entry){try{await fs.writeFile(file,mkdirVirtual(await bytes(file),entry));}catch(e){if(e.code!=='ENCRYPTED_RPF'&&!String(e.message).includes('supported size'))throw e;await this.bridge({action:'mkdir',file,entry});}}
}
