import {randomUUID} from 'node:crypto';
import {parseXML, child, escape, serialize} from './xml.mjs';
import {relative, protect} from './safe.mjs';
import {zipBuffer} from './archives.mjs';
function attrsOnly(n, allowed){for(const k of Object.keys(n.attrs))if(!allowed.includes(k))throw Error(`Unsupported OIV attribute: ${n.name}.${k}`);}
function bool(v){if(!['True','False'].includes(v))throw Error('Invalid OIV boolean.');return v==='True';}
export function parseOiv(xml, files) {
  const root=parseXML(xml);if(root.name!=='package'||root.attrs.version!=='2.2'||root.attrs.target!=='Five')throw Error('Only GTA V OIV format 2.2 is supported.');
  if(!/^\{?[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\}?$/i.test(root.attrs.id||''))throw Error('Invalid OIV package GUID.');
  const meta=child(root,'metadata'),colors=child(root,'colors'),content=child(root,'content');
  if(!meta||!colors||!content||root.children.filter(n=>n.name==='content').length!==1)throw Error('OIV requires metadata, colors, and one content node.');
  const mv=child(meta,'version'),author=child(meta,'author'),header=child(colors,'headerBackground'),icon=child(colors,'iconBackground');
  if(!mv||!/^\d+$/.test(child(mv,'major')?.text.trim()||'')||!/^\d+$/.test(child(mv,'minor')?.text.trim()||'')||!child(author||{children:[]},'displayName')?.text.trim())throw Error('OIV metadata requires a numeric version and author display name.');
  if(!header||!icon||!/^\$[a-f0-9]{8}$/i.test(header.text.trim())||!/^\$[a-f0-9]{8}$/i.test(icon.text.trim()))throw Error('OIV requires valid ARGB colors.');bool(header.attrs.useBlackTextColor);
  const gameversion=child(meta,'gameversion')?.text.trim()||child(root,'gameversion')?.text.trim();if(gameversion&&gameversion!=='Legacy')throw Error(`OIV targets ${gameversion}, not Legacy.`);
  const ops=[];
  function recurse(node, outer='', prefix='', level=0){
    if(level>20)throw Error('OIV nesting limit.');
    for(const n of node.children){
      if(n.name==='archive'){
        attrsOnly(n,['path','type','createIfNotExist']);if(n.attrs.type!=='RPF7')throw Error('Only RPF7 OIV archives are supported.');
        const archive=relative(n.attrs.path),create=bool(n.attrs.createIfNotExist);
        if(!outer){const target=archive.toLowerCase().startsWith('mods/')?archive:`mods/${archive}`;protect(target);if(create)ops.push({kind:'ensure-archive',target});recurse(n,target,'',level+1);}
        else {if(create)throw Error('Creating nested OIV archives is unsupported; use an existing destination.');recurse(n,outer,prefix+archive+'/',level+1);}
      } else if(n.name==='add'||n.name==='delete'){
        attrsOnly(n,n.name==='add'?['source']:[]);if(n.children.length)throw Error('Unexpected OIV file command children.');
        const target=relative(n.text.trim()),source=n.name==='add'?relative('content/'+n.attrs.source):undefined;
        if(source&&!files.includes(source))throw Error(`Missing OIV payload: ${source}`);
        if(outer)ops.push({kind:n.name==='add'?'rpf-add':'rpf-delete',target:outer,entry:relative(prefix+target),source,...(n.name==='add'?{createFolders:true}:{})});
        else {protect(target);ops.push({kind:n.name==='add'?'copy':'delete',target,source});}
      } else if(n.name==='xml'){
        attrsOnly(n,['path']);const target=relative(n.attrs.path);
        for(const a of n.children){
          attrsOnly(a,['append','xpath']);
          if(a.name!=='add'||a.attrs.xpath!=='/SMandatoryPacksData/Paths'||!['First','Last'].includes(a.attrs.append)||!a.children.length||a.children.some(c=>c.name!=='Item'||c.children.length||Object.keys(c.attrs).length))throw Error('Unsupported OIV XML operation. Supported: dlclist Paths Item additions.');
          for(const item of a.children){const m=/^dlcpacks:[\\/]([a-z0-9_-]+)[\\/]$/i.exec(item.text.trim());if(!m)throw Error('Invalid DLC registration item.');
            if(outer)ops.push({kind:'dlc-register',target:outer,entry:relative(prefix+target),pack:m[1],append:a.attrs.append});
            else throw Error('Loose OIV XML edits are unsupported.');}
        }
      } else throw Error(`Unsupported OIV command: <${n.name}>. Entire package refused before any changes.`);
    }
  }
  recurse(content);if(!ops.length)throw Error('Empty OIV installation script.');
  const name=child(meta,'name')?.text.trim();if(!name)throw Error('Missing OIV package name.');
  const v=child(meta,'version');return {name,version:`${child(v||{children:[]},'major')?.text||0}.${child(v||{children:[]},'minor')?.text||0}`,operations:ops};
}
export function makeOiv(mod, plan, sources) {
  if(!plan.operations.length)throw Error('There are no supported operations to export.');
  const payload=new Map(),commands=[];let i=0;
  for(const op of plan.operations){
    if(!['copy','rpf-add','delete','rpf-delete'].includes(op.kind))throw Error(`OIV export does not support ${op.kind}; export a native bundle instead.`);
    let command;
    if(op.kind.includes('delete'))command=`<delete>${escape(op.entry||op.target)}</delete>`;
    else {const key=`${String(i++).padStart(4,'0')}/${op.source.split('/').at(-1)}`;payload.set('content/'+key,sources.get(op.source));command=`<add source="${escape(key)}">${escape(op.entry||op.target)}</add>`;}
    if(op.entry){
      const parts=op.entry.split('/'),indexes=parts.map((p,i)=>/\.rpf$/i.test(p)?i:-1).filter(x=>x>=0);
      // Rebuild command using the path inside the innermost archive.
      const last=indexes.at(-1)??-1;const local=parts.slice(last+1).join('/');
      if(op.kind.includes('delete'))command=`<delete>${escape(local)}</delete>`;else command=command.replace(escape(op.entry),escape(local));
      let start=0;const nested=[];for(const ix of indexes){nested.push(parts.slice(start,ix+1).join('/'));start=ix+1;}
      for(const p of nested.reverse())command=`<archive path="${escape(p)}" createIfNotExist="False" type="RPF7">${command}</archive>`;
      command=`<archive path="${escape(op.target.replace(/^mods\//i,''))}" createIfNotExist="False" type="RPF7">${command}</archive>`;
    }
    commands.push(command);
  }
  const version=(mod.version||'1.0').split('.');
  const xml=`<?xml version="1.0" encoding="UTF-8"?>\n<package version="2.2" id="{${randomUUID()}}" target="Five"><metadata><name>${escape(mod.name)}</name><version><major>${Number(version[0])||1}</major><minor>${Number(version[1])||0}</minor></version><author><displayName>${escape(mod.author||'User-prepared package')}</displayName></author><description>${escape('Install required dependencies first. '+(mod.requires||[]).map(x=>x.id).join(', '))}</description></metadata><colors><headerBackground useBlackTextColor="False">$FF000000</headerBackground><iconBackground>$FF000000</iconBackground></colors><content>${commands.join('\n')}</content></package>`;
  parseOiv(xml,[...payload.keys()]);payload.set('assembly.xml',Buffer.from(xml));return zipBuffer(payload);
}
