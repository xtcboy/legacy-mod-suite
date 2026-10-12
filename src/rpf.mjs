import {inflateRawSync} from 'node:zlib';
import {relative, MAX_BYTES} from './safe.mjs';
export const MAGIC=0x52504637, OPEN=0x4e45504f;
const align=n=>Math.ceil(n/512)*512;
// Independent bounded RPF7 implementation. Encrypted TOCs are never interpreted as plaintext.
export function readRpf(b) {
  if(b.length<16||b.length>MAX_BYTES||b.readUInt32LE(0)!==MAGIC)throw Error('Not a supported RPF7 archive (maximum 256 MiB).');
  const count=b.readUInt32LE(4),namesSize=b.readUInt32LE(8),enc=b.readUInt32LE(12);
  if(enc!==0&&enc!==OPEN)throw Object.assign(Error('Encrypted RPF: configure the optional CodeWalker bridge, or use an OPEN mods copy.'),{code:'ENCRYPTED_RPF'});
  const header=16+count*16+namesSize;
  if(!count||count>65535||namesSize>65535||header>b.length)throw Error('Invalid RPF table sizes.');
  const names=b.subarray(16+count*16,header), entries=[];
  for(let i=0;i<count;i++){
    const o=16+i*16,isDir=b.readUInt32LE(o+4)===0x7fffff00;
    const no=isDir?b.readUInt32LE(o):b.readUInt16LE(o);let e=names.indexOf(0,no);
    if(no>=names.length||e<no)throw Error('Invalid RPF name.');
    const name=names.toString('utf8',no,e);if(i!==0)relative(name);if(name.includes('/')||name.includes('\\'))throw Error('RPF entry name is not a basename.');
    const entry={name,kind:isDir?'directory':(b[o+7]&0x80)?'resource':'binary'};
    if(isDir){entry.first=b.readUInt32LE(o+8);entry.count=b.readUInt32LE(o+12);}
    else {
      let size=b.readUIntLE(o+2,3),offset=(b.readUIntLE(o+5,3)&0x7fffff)*512;
      entry.a=b.readUInt32LE(o+8);entry.z=b.readUInt32LE(o+12);
      if(entry.kind==='resource'&&size===0xffffff)throw Error('Large resource entries are not supported by the native backend.');
      if(entry.kind==='resource'&&!size)throw Error('Zero-sized resource is unsupported.');
      if(entry.kind==='binary'&&entry.z!==0)throw Object.assign(Error('Encrypted RPF file entry requires the optional backend.'),{code:'ENCRYPTED_RPF'});
      entry.compressed=entry.kind==='binary'&&size!==0;if(!size)size=entry.a;
      if(offset<header||offset+size>b.length)throw Error('RPF entry extends outside archive.');
      entry.raw=Buffer.from(b.subarray(offset,offset+size));entry.size=size;
    }
    entries.push(entry);
  }
  if(entries[0].kind!=='directory')throw Error('RPF root must be a directory.');
  const map=new Map(),seen=new Set();
  function visit(i,prefix,depth){
    if(depth>40||seen.has(i)||i>=entries.length)throw Error('Cyclic/invalid RPF directory tree.');seen.add(i);
    const e=entries[i],rel=i===0?'':prefix?`${prefix}/${e.name}`:e.name;
    if(map.has(rel.toLowerCase()))throw Error('Duplicate RPF path.');map.set(rel.toLowerCase(),{...e,path:rel});
    if(e.kind==='directory'){
      if(e.first+e.count>entries.length)throw Error('Invalid RPF directory range.');
      for(let j=e.first;j<e.first+e.count;j++)visit(j,rel,depth+1);
    }
  }
  visit(0,'',0);if(seen.size!==entries.length)throw Error('Unreachable RPF entries.');return map;
}
export function entryData(e) {
  if(!e||e.kind==='directory')throw Error('RPF file does not exist.');
  if(e.compressed){const out=inflateRawSync(e.raw,{maxOutputLength:Math.max(1,Math.min(e.a,MAX_BYTES))});if(out.length!==e.a)throw Error('RPF uncompressed size mismatch.');return out;}
  return Buffer.from(e.raw);
}
export function resourceEntry(name, b) {
  if(b.length>=16&&b.readUInt32LE(0)===0x37435352){
    if(b.length>=0xffffff)throw Error('Resource exceeds native backend limit.');
    return {name,kind:'resource',raw:Buffer.from(b),a:b.readUInt32LE(8),z:b.readUInt32LE(12),compressed:false};
  }
  return {name,kind:'binary',raw:Buffer.from(b),a:b.length,z:0,compressed:false};
}
export function buildRpf(map) {
  const root={name:'',kind:'directory',path:'',kids:[]}, lookup=new Map([['',root]]);
  const items=[...map.values()].filter(e=>e.path).sort((a,b)=>a.path.split('/').length-b.path.split('/').length||a.path.localeCompare(b.path));
  for(const e of items){const p=relative(e.path),dir=p.includes('/')?p.slice(0,p.lastIndexOf('/')):'';if(!lookup.has(dir.toLowerCase()))throw Error('Missing RPF parent folder.');
    const n={...e,name:p.split('/').at(-1),kids:[]};lookup.get(dir.toLowerCase()).kids.push(n);lookup.set(p.toLowerCase(),n);}
  const ordered=[root];
  for(let i=0;i<ordered.length;i++)if(ordered[i].kind==='directory'){const e=ordered[i];e.kids.sort((a,b)=>a.name.toLowerCase().localeCompare(b.name.toLowerCase()));e.first=ordered.length;e.count=e.kids.length;ordered.push(...e.kids);}
  let ns=0;const names=[];
  for(const e of ordered){e.no=ns;const b=Buffer.from(e.name+'\0');names.push(b);ns+=b.length;}
  ns=Math.ceil(ns/16)*16;if(ns>65535||ordered.length>65535)throw Error('RPF name table too large.');
  const table=Buffer.alloc(16+ordered.length*16+ns);table.writeUInt32LE(MAGIC);table.writeUInt32LE(ordered.length,4);table.writeUInt32LE(ns,8);table.writeUInt32LE(OPEN,12);
  Buffer.concat(names).copy(table,16+ordered.length*16);
  let offset=align(table.length);const files=[];
  for(let i=0;i<ordered.length;i++){
    const e=ordered[i],o=16+i*16;
    if(e.kind==='directory'){table.writeUInt32LE(e.no,o);table.writeUInt32LE(0x7fffff00,o+4);table.writeUInt32LE(e.first,o+8);table.writeUInt32LE(e.count,o+12);}
    else {
      const raw=e.raw;if(!raw)throw Error('Missing RPF file bytes.');
      const size=e.kind==='resource'||e.compressed?raw.length:0;
      if(size>=0xffffff||offset/512>=0x800000)throw Error('RPF entry too large.');
      table.writeUInt16LE(e.no,o);table.writeUIntLE(size,o+2,3);table.writeUIntLE(offset/512+(e.kind==='resource'?0x800000:0),o+5,3);table.writeUInt32LE(e.a,o+8);table.writeUInt32LE(e.z,o+12);
      files.push({offset,raw});offset+=align(raw.length);
    }
  }
  if(offset>MAX_BYTES)throw Error('Rebuilt RPF exceeds 256 MiB native limit.');
  const result=Buffer.alloc(offset);table.copy(result);for(const f of files)f.raw.copy(result,f.offset);return result;
}
export function emptyRpf(){return buildRpf(new Map([['',{path:'',name:'',kind:'directory'}]]));}
export function setEntry(map, rel, data, createFolders=false) {
  rel=relative(rel);const parts=rel.split('/');let p='';
  for(const folder of parts.slice(0,-1)){p=p?`${p}/${folder}`:folder;if(!map.has(p.toLowerCase())){if(!createFolders)throw Error(`Missing RPF directory: ${p}`);map.set(p.toLowerCase(),{name:folder,path:p,kind:'directory'});}else if(map.get(p.toLowerCase()).kind!=='directory')throw Error('RPF parent is not a directory.');}
  if(map.get(rel.toLowerCase())?.kind==='directory')throw Error('Cannot replace a directory with a file.');
  map.set(rel.toLowerCase(),{...resourceEntry(parts.at(-1),data),path:rel});
}
export function readVirtual(outer, rel) {
  rel=relative(rel);let current=outer, remaining=rel;
  for(let i=0;i<20;i++){
    const m=readRpf(current),segments=remaining.split('/');const idx=segments.findIndex(x=>/\.rpf$/i.test(x));
    if(idx>=0&&idx<segments.length-1){current=entryData(m.get(segments.slice(0,idx+1).join('/').toLowerCase()));remaining=segments.slice(idx+1).join('/');}
    else return entryData(m.get(remaining.toLowerCase()));
  }
  throw Error('Nested RPF depth limit.');
}
export function editVirtual(outer, rel, data, {remove=false,createFolders=false,createArchives=false}={},depth=0) {
  if(depth>20)throw Error('Nested RPF depth limit.');rel=relative(rel);
  const m=readRpf(outer),segments=rel.split('/'),idx=segments.findIndex(x=>/\.rpf$/i.test(x));
  if(idx>=0&&idx<segments.length-1){
    const p=segments.slice(0,idx+1).join('/'),e=m.get(p.toLowerCase());
    if(!e&&!createArchives)throw Error(`Nested archive missing: ${p}`);
    const b=editVirtual(e?entryData(e):emptyRpf(),segments.slice(idx+1).join('/'),data,{remove,createFolders,createArchives},depth+1);setEntry(m,p,b,createFolders);
  } else if(remove){const e=m.get(rel.toLowerCase());if(e?.kind==='directory')throw Error('Directory deletion is unsupported.');m.delete(rel.toLowerCase());}
  else setEntry(m,rel,data,createFolders);
  return buildRpf(m);
}
export function mkdirVirtual(outer, rel, depth=0){
  if(depth>20)throw Error('Nested RPF depth limit.');rel=relative(rel);const m=readRpf(outer),parts=rel.split('/'),idx=parts.findIndex(p=>/\.rpf$/i.test(p));
  if(idx>=0&&idx<parts.length-1){const p=parts.slice(0,idx+1).join('/'),e=m.get(p.toLowerCase());const b=mkdirVirtual(entryData(e),parts.slice(idx+1).join('/'),depth+1);setEntry(m,p,b);}
  else {
    const parent=parts.slice(0,-1).join('/'),e=m.get(parent.toLowerCase());if(!e||e.kind!=='directory')throw Error('Parent RPF directory is missing.');
    if(m.has(rel.toLowerCase()))throw Error('An entry with this name already exists.');m.set(rel.toLowerCase(),{name:parts.at(-1),path:rel,kind:'directory'});
  }return buildRpf(m);
}
