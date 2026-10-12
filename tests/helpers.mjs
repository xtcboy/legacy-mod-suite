import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../src/service.mjs';
import {editVirtual, emptyRpf} from '../src/rpf.mjs';
export const shortRar=process.env.LEGACY_TEST_RAR||path.resolve('tests/fixtures/Supplied-ShortDreads.rar');
export function rpf(files){let b=emptyRpf();for(const [p,data]of Object.entries(files))b=editVirtual(b,p,Buffer.from(data),{createFolders:true,createArchives:true});return b;}
export async function setup(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'legacy-test-')),game=path.join(root,'game');await fs.mkdir(game);await fs.writeFile(path.join(game,'GTA5.exe'),'test fixture; not a real executable');
  const s=await createService(path.join(root,'data'),{testMode:true});s.store.data.config.gamePath=game;s.store.data.config.preparationMode=false;await s.store.save();
  t.after(async()=>{await s.close();await fs.rm(root,{recursive:true,force:true});});return{root,game,s};
}
export async function file(game,rel,data){const p=path.join(game,rel);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,data);return p;}
export async function importFiles(s,root,files,meta={}){const dir=path.join(root,'import-'+Math.random().toString(36).slice(2));await fs.mkdir(dir);for(const [p,b]of Object.entries(files))await file(dir,p,b);return(await s.call('import',{path:dir,metadata:meta})).mod;}
export async function fixtureEmf(game){
  await file(game,'dinput8.dll','fixture loader');await file(game,'OpenIV.asi','fixture loader');
  const inner=rpf({'player_one/readme.txt':'fixture','player_zero/readme.txt':'fixture','player_two/readme.txt':'fixture'}),outer=rpf({'x64/streamedpeds_players.rpf':inner});
  await file(game,'mods/update/x64/dlcpacks/EMFsingleplayer/dlc.rpf',outer);
  await file(game,'mods/update/update.rpf',rpf({'common/data/dlclist.xml':'<SMandatoryPacksData><Paths><Item>dlcpacks:/EMFsingleplayer/</Item></Paths></SMandatoryPacksData>'}));return outer;
}
