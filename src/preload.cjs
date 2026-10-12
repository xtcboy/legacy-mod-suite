const {contextBridge,ipcRenderer,webUtils}=require('electron');
contextBridge.exposeInMainWorld('desktop',{
  choose:kind=>ipcRenderer.invoke('select',kind),
  saveExport:id=>ipcRenderer.invoke('save-export',id),
  openLink:url=>ipcRenderer.invoke('open-link',url),
  filePath:file=>webUtils.getPathForFile(file)
});
