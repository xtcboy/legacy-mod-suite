import {createRequire} from 'node:module';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startServer} from '../src/server.mjs';
import {fixtureEmf,shortRar} from '../tests/helpers.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=await fs.mkdtemp(path.join(os.tmpdir(),'legacy-ui-')),game=path.join(base,'game');await fs.mkdir(game);await fs.writeFile(path.join(game,'GTA5.exe'),'fixture');await fixtureEmf(game);
const server=await startServer(path.join(base,'data'),{testMode:true}),s=server.service;s.store.data.config.gamePath=game;await s.store.save();
const rar=shortRar;
const m=(await s.call('import',{path:rar,metadata:{name:'Short Dreads for Franklin',sourceURL:'https://www.gta5-mods.com/player/short-dreads-for-franklin'}})).mod;
const browser=await chromium.launch({headless:true,executablePath:process.env.LEGACY_BROWSER_PATH||chromium.executablePath(),args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-dev-shm-usage']});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],failed=[];
page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push(r.url()));
await fs.mkdir('../qa-screenshots',{recursive:true});
try{
  await page.goto(server.origin);await page.locator('#mode').filter({hasText:'Preparation mode'}).waitFor();
  await page.screenshot({path:'../qa-screenshots/home.png',fullPage:true});
  for(const name of ['import','queue','library','oiv','dependencies','conflicts','backups','profiles','settings']){
    await page.locator(`[data-page="${name}"]`).click();await page.waitForTimeout(75);
    if(!await page.locator('#content').textContent())throw Error('Empty '+name+' page');
  }
  await page.locator('[data-page="library"]').click();await page.getByRole('button',{name:'Preview',exact:true}).first().click();await page.locator('dialog[open]').waitFor();
  if(!await page.locator('#modal-content').textContent().then(t=>t.includes('player_one/hair_002_u.ydd')))throw Error('Hair preview missing verified destination.');
  await page.screenshot({path:'../qa-screenshots/preview.png',fullPage:true});
  await page.locator('#close-dialog').click();
  await page.locator('[data-page="explorer"]').click();await page.locator('.file-row').first().waitFor();
  const input=page.locator('#content .row input').first();await input.fill('mods/update/x64/dlcpacks/EMFsingleplayer/dlc.rpf/x64/streamedpeds_players.rpf/player_one');await page.getByRole('button',{name:'Go',exact:true}).click();
  await page.locator('.file-row').filter({hasText:'readme.txt'}).click();await page.locator('.details textarea').waitFor();
  if(await page.locator('.details textarea').inputValue()!=='fixture')throw Error('Archive text preview failed.');
  await page.screenshot({path:'../qa-screenshots/explorer.png',fullPage:true});
  if(errors.length||failed.length)throw Error(JSON.stringify({errors,failed}));
  console.log(JSON.stringify({uiPages:12,realRarImport:true,emfPreview:true,nestedExplorer:true,textPreview:true,pageErrors:errors,failedRequests:failed},null,2));
}finally{await browser.close();await server.close();await fs.rm(base,{recursive:true,force:true});}
