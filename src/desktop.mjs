import {app,BrowserWindow,ipcMain,dialog,shell} from 'electron';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startServer} from './server.mjs';
let server,window;
if(!app.requestSingleInstanceLock())app.quit();
else {
  app.on('second-instance',()=>{window?.show();window?.focus();});
  await app.whenReady();
  try{
    server=await startServer(process.env.LEGACY_SUITE_DATA||path.join(app.getPath('userData'),'library'));
    window=new BrowserWindow({width:1380,height:900,minWidth:1000,minHeight:680,backgroundColor:'#000000',title:'Legacy Mod Suite',autoHideMenuBar:true,webPreferences:{preload:fileURLToPath(new URL('./preload.cjs',import.meta.url)),contextIsolation:true,nodeIntegration:false,sandbox:true}});
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
  }catch(e){dialog.showErrorBox('Unable to start Legacy Mod Suite',e.message);app.quit();}
  app.on('window-all-closed',()=>app.quit());
  let closing=false;app.on('before-quit',event=>{if(server&&!closing){event.preventDefault();closing=true;server.close().finally(()=>app.quit());}});
}
