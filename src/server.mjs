import http from 'node:http';
import {promises as fs} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {createService} from './service.mjs';
import {relative, bytes, MAX_BYTES, atomic} from './safe.mjs';
const UI=fileURLToPath(new URL('../ui/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png'};
export async function startServer(root,{port=0,testMode=false}={}){
  const service=await createService(root,{testMode}),token=randomBytes(32).toString('hex');let origin='';
  const server=http.createServer(async(req,res)=>{
    function reply(code,value){res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
    try{
      if(req.headers.host!==new URL(origin).host)return reply(403,{error:'Invalid host.'});
      const url=new URL(req.url,origin),p=url.pathname;
      const authenticated=()=>{
        const raw=req.headers.authorization||'',expected='Bearer '+token;
        return Buffer.byteLength(raw)===Buffer.byteLength(expected)&&timingSafeEqual(Buffer.from(raw),Buffer.from(expected))&&(!req.headers.origin||req.headers.origin===origin);
      };
      if(p.startsWith('/api/')&&req.method==='POST'){
        if(!authenticated())return reply(403,{error:'Unauthorized local request.'});
        let n=0;const parts=[];for await(const b of req){n+=b.length;if(n>2*1024*1024)throw Error('Request too large.');parts.push(b);}
        const args=JSON.parse(Buffer.concat(parts).toString()||'{}'),result=await service.call(p.slice(5),args);return reply(200,{result});
      }
      if(p==='/upload'&&req.method==='POST'){
        if(!authenticated())return reply(403,{error:'Unauthorized local upload.'});
        const name=relative(decodeURIComponent(req.headers['x-file-name']||'mod.zip'));if(name.includes('/'))throw Error('Upload needs a basename.');
        let n=0;const parts=[];for await(const b of req){n+=b.length;if(n>MAX_BYTES)throw Error('Upload exceeds 256 MiB.');parts.push(b);}
        const file=path.join(service.store.root,'incoming',randomUUID(),name);await atomic(file,Buffer.concat(parts));return reply(200,{result:{path:file}});
      }
      if(p.startsWith('/export/')&&req.method==='GET'){
        if(!authenticated())return reply(403,{error:'Unauthorized export request.'});const e=service.exports.get(p.slice(8));if(!e)return reply(404,{error:'Export not found.'});
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${e.filename}"`});res.end(await bytes(e.file));return;
      }
      if(req.method!=='GET')return reply(405,{error:'Method not allowed.'});
      const name=p==='/'?'index.html':relative(decodeURIComponent(p.slice(1)));
      if(!['index.html','app.js','style.css'].includes(name)&&!/^fonts\/[\w.-]+$/.test(name))return reply(404,{error:'Not found.'});
      let data=await fs.readFile(path.join(UI,name));if(name==='index.html')data=Buffer.from(data.toString().replace('__LOCAL_TOKEN__',token));
      res.writeHead(200,{'Content-Type':mime[path.extname(name)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(data);
    }catch(e){if(!res.headersSent)reply(400,{error:e.message});else res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin='http://127.0.0.1:'+server.address().port;return{server,service,origin,token,close:async()=>{await new Promise(r=>server.close(r));await service.close();}};
}
