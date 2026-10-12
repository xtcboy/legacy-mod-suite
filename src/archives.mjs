import {promises as fs} from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {inflateRawSync} from 'node:zlib';
import {readZipEntries} from '../vendor/gtarage/zip.mjs';
import {relative, contained, bytes, MAX_BYTES, walk} from './safe.mjs';
const exec=promisify(execFile);
export function bundled7zip(){try{return createRequire(import.meta.url)('7zip-bin').path7za;}catch{return '';}}
const crcTable=Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
export function crc32(b){let c=0xffffffff;for(const v of b)c=crcTable[(c^v)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
export function unzipBuffer(b) {
  if(b.length>MAX_BYTES)throw Error('Archive size limit exceeded.');
  const entries=readZipEntries(b), names=new Set(), result=new Map();let total=0;
  if(entries.length>20000)throw Error('Too many ZIP entries.');
  for(const e of entries) {
    const name=relative(e.name.replace(/\/$/,'')), key=name.toLowerCase();
    if(names.has(key))throw Error('Duplicate case-insensitive ZIP path.');names.add(key);
    if(e.encrypted)throw Error('Encrypted ZIPs are not supported.');
    if(e.isDirectory)continue;
    total+=e.uncompressedSize;if(total>MAX_BYTES||e.uncompressedSize>MAX_BYTES)throw Error('Expanded archive size limit exceeded.');
    const o=e.localHeaderOffset;if(o+30>b.length||b.readUInt32LE(o)!==0x04034b50)throw Error('Invalid ZIP local header.');
    const n=b.readUInt16LE(o+26),ex=b.readUInt16LE(o+28),s=o+30+n+ex;
    if(s+e.compressedSize>b.length)throw Error('Truncated ZIP entry.');
    if(b.readUInt16LE(o+8)!==e.compressionMethod)throw Error('ZIP compression headers disagree.');
    const raw=b.subarray(s,s+e.compressedSize);
    const data=e.compressionMethod===0?Buffer.from(raw):e.compressionMethod===8?inflateRawSync(raw,{maxOutputLength:Math.max(1,e.uncompressedSize)}):null;
    if(!data||data.length!==e.uncompressedSize)throw Error('Unsupported/damaged ZIP.');
    result.set(name,data);
  }
  // CRC is checked against the authoritative central directory, including descriptors.
  let end=b.length-22;while(end>=Math.max(0,b.length-65557)&&b.readUInt32LE(end)!==0x06054b50)end--;
  let c=b.readUInt32LE(end+16);
  for(const e of entries){if(!e.isDirectory&&crc32(result.get(e.name.replaceAll('\\','/')))!==b.readUInt32LE(c+16))throw Error(`ZIP CRC mismatch: ${e.name}`);c+=46+b.readUInt16LE(c+28)+b.readUInt16LE(c+30)+b.readUInt16LE(c+32);}
  return result;
}
export function zipBuffer(entries) {
  const locals=[],central=[];let offset=0;
  for(const [rel,data] of entries){
    const name=Buffer.from(relative(rel)),b=Buffer.from(data),crc=crc32(b),l=Buffer.alloc(30),c=Buffer.alloc(46);
    l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(0x800,6);l.writeUInt32LE(crc,14);l.writeUInt32LE(b.length,18);l.writeUInt32LE(b.length,22);l.writeUInt16LE(name.length,26);
    c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt32LE(crc,16);c.writeUInt32LE(b.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);
    locals.push(l,name,b);central.push(c,name);offset+=l.length+name.length+b.length;
  }
  const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.size,8);end.writeUInt16LE(entries.size,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,cd,end]);
}
export async function extract(file, dest, sevenZip='') {
  await fs.mkdir(dest,{recursive:true});
  if(/\.(zip|oiv)$/i.test(file)){
    const contents=unzipBuffer(await bytes(file));
    for(const [rel,data]of contents){const p=await contained(dest,rel);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,data,{flag:'wx'});}
  } else if(/\.rar$/i.test(file)){
    let createExtractorFromData;try{({createExtractorFromData}=createRequire(import.meta.url)('node-unrar-js'));}catch{throw Error('RAR support is missing. Run npm ci, or import an extracted folder.');}
    const raw=await bytes(file),extractor=await createExtractorFromData({data:raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)}),listing=extractor.getFileList(),names=new Set();let total=0;
    if(listing.arcHeader.flags.volume||listing.arcHeader.flags.headerEncrypted)throw Error('Multipart/encrypted RARs are unsupported.');
    for(const h of listing.fileHeaders){const name=relative(h.name.replace(/\/$/,'')),key=name.toLowerCase();if(names.has(key)||h.flags.encrypted)throw Error('Duplicate/encrypted RAR entry.');names.add(key);total+=h.unpSize;if(total>MAX_BYTES||names.size>20000)throw Error('RAR expansion limit exceeded.');}
    for(const item of extractor.extract().files){if(item.fileHeader.flags.directory)continue;const name=relative(item.fileHeader.name),p=await contained(dest,name),data=Buffer.from(item.extraction);if(data.length!==item.fileHeader.unpSize||crc32(data)!==item.fileHeader.crc)throw Error('RAR checksum mismatch.');await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,data,{flag:'wx'});}
  } else if(/\.7z$/i.test(file)){
    sevenZip ||= bundled7zip();
    if(!sevenZip)throw Error('RAR/7z requires 7-Zip. Set its executable in Settings, or import an extracted folder.');
    if(process.platform!=='win32'&&sevenZip===bundled7zip())await fs.chmod(sevenZip,0o755);
    const {stdout}=await exec(sevenZip,['l','-slt','--',path.resolve(file)],{maxBuffer:8*1024*1024,timeout:30000});
    const chunks=stdout.split(/----------\r?\n/).at(-1).split(/\r?\n\r?\n/),files=[],seen=new Set();let size=0;
    for(const chunk of chunks){const n=/^Path = (.+)$/m.exec(chunk)?.[1];if(!n)continue;relative(n);if(seen.has(n.toLowerCase()))throw Error('Duplicate 7z path.');seen.add(n.toLowerCase());if(/^Encrypted = \+|^Symbolic Link =|^Hard Link =/m.test(chunk))throw Error('Encrypted/link archive entry refused.');const length=Number(/^Size = (\d+)$/m.exec(chunk)?.[1]||0);size+=length;if(!/^Folder = \+|^Attributes = D/m.test(chunk))files.push({name:n,length});}
    if(size>MAX_BYTES)throw Error('Expanded archive size limit exceeded.');
    if(files.length>20000)throw Error('Too many 7z files.');
    // Extract into memory, then write through our own path guard. The external tool never chooses filesystem destinations.
    for(const e of files){const {stdout:raw}=await exec(sevenZip,['e','-so','-bd','--',path.resolve(file),e.name],{encoding:'buffer',timeout:120000,maxBuffer:Math.max(e.length+1024,1024)});if(raw.length!==e.length)throw Error('7z extracted size mismatch.');const p=await contained(dest,e.name);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,raw,{flag:'wx'});}
  } else throw Error('Use ZIP, OIV, RAR, 7z, or a folder.');
  return walk(dest);
}
