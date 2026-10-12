import {app,BrowserWindow,ipcMain,dialog,shell} from 'electron';
import path from 'node:path';
import {promises as fs} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {startServer} from './server.mjs';
let server,window;
const splash='<!doctype html><meta charset="utf-8"><title>Starting Legacy Mod Suite</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08090c;color:#f2f3f5;font:16px system-ui,sans-serif}.card{text-align:center;padding:36px}h1{font-size:22px;font-weight:600}p{color:#9296a2}.spinner{width:26px;height:26px;margin:26px auto;border:3px solid #30333b;border-top-color:#d5ff52;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style><main class="card"><div class="spinner"></div><h1>Legacy Mod Suite</h1><p>Preparing your workspace…</p></main>';
async function writeStartupLog(message){try{const file=path.join(app.getPath('temp'),'Legacy-Mod-Suite-startup.log');await fs.appendFile(file,`${new Date().toISOString()} ${message}\n`,'utf8');}catch{}}
if(!app.requestSingleInstanceLock())app.quit();
else {
  app.on('second-instance',()=>{window?.show();window?.focus();});
  try{
    await app.whenReady();
    await writeStartupLog('Electron ready; creating the startup window.');
    window=new BrowserWindow({width:1380,height:900,minWidth:1000,minHeight:680,backgroundColor:'#000000',title:'Starting Legacy Mod Suite',autoHideMenuBar:true,show:true,webPreferences:{preload:fileURLToPath(new URL('./preload.cjs',import.meta.url)),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    window.show();window.focus();
    await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(splash));
    window.webContents.on('did-fail-load',(_,code,description,url,isMainFrame)=>{if(isMainFrame)void writeStartupLog(`Page load failed (${code}): ${description}; ${url}`);});
    window.webContents.on('render-process-gone',(_,details)=>{void writeStartupLog(`Renderer exited: ${JSON.stringify(details)}`);});
    await writeStartupLog('Startup window visible; opening the local workspace.');
    server=await startServer(process.env.LEGACY_SUITE_DATA||path.join(app.getPath('userData'),'library'));
    await writeStartupLog(`Local workspace ready at ${server.origin}; loading the interface.`);
    const valid=event=>event.sender===window.webContents&&event.senderFrame.url.startsWith(server.origin+'/');
    ipcMain.handle('select',async(event,kind)=>{
      if(!valid(event))throw Error('Untrusted window.');
      const folder=kind==='folder',result=await dialog.showOpenDialog(window,{properties:[folder?'openDirectory':'openFile'],...(kind==='archive'?{filters:[{name:'Mod archives',extensions:['zip','rar','7z','oiv']}]}:{})});return result.canceled?null:result.filePaths[0];
    });
    ipcMain.handle('save-export',async(event,id)=>{
      if(!valid(event))throw Error('Untrusted window.');const item=server.service.exports.get(id);if(!item)throw Error('Export not found.');
      const r=await dialog.showSaveDialog(window,{defaultPath:item.filename});if(r.canceled)return null;
      const {copyFile}=await import('node:fs/promises');await copyFile(item.file,r.filePath);return r.filePath;
    });
    ipcMain.handle('open-link',async(event,url)=>{if(!valid(event))throw Error('Untrusted window.');const u=new URL(url);if(!['http:','https:'].includes(u.protocol))throw Error('Invalid link.');await shell.openExternal(u.href);});
    window.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith(server.origin+'/'))e.preventDefault();});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.session.setPermissionRequestHandler((_,__,callback)=>callback(false));
    await window.loadURL(server.origin);
    window.setTitle('Legacy Mod Suite');window.show();window.focus();
    await writeStartupLog('Interface loaded.');
  }catch(e){const detail=e?.stack||String(e);await writeStartupLog(`Startup failed: ${detail}`);dialog.showErrorBox('Unable to start Legacy Mod Suite',detail);app.quit();}
  app.on('window-all-closed',()=>app.quit());
  let closing=false;app.on('before-quit',event=>{if(server&&!closing){event.preventDefault();closing=true;server.close().finally(()=>app.quit());}});
}
