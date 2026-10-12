import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {startServer} from './server.mjs';
const root=process.env.LEGACY_SUITE_DATA||path.join(os.homedir(),'.legacy-mod-suite');
const app=await startServer(root,{port:Number(process.env.LEGACY_SUITE_PORT)||0});
console.log(`Legacy Mod Suite is running at ${app.origin}`);
console.log('Keep this window open. Press Ctrl+C to close.');
if(!process.argv.includes('--no-open')){
  const cmd=process.platform==='win32'?'rundll32':process.platform==='darwin'?'open':'xdg-open';
  const args=process.platform==='win32'?['url.dll,FileProtocolHandler',app.origin]:[app.origin];spawn(cmd,args,{stdio:'ignore'}).on('error',()=>{});
}
async function quit(){await app.close();process.exit();}process.once('SIGINT',quit);process.once('SIGTERM',quit);
