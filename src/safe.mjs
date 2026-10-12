import {promises as fs, createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

export const MAX_BYTES = 256 * 1024 * 1024;
export function relative(value) {
  if (typeof value !== 'string' || !value || value.length > 2048) throw Error('A relative path is required.');
  const v = value.replaceAll('\\', '/');
  if (/^[/.]|[:\x00-\x1f<>"|?*]/.test(v)) throw Error(`Unsafe path: ${value}`);
  const parts = v.split('/');
  for (const p of parts) {
    if (!p || p === '..' || p === '.' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)) throw Error(`Unsafe path: ${value}`);
  }
  return parts.join('/');
}
export function protect(value) {
  const v = relative(value), lower = v.toLowerCase();
  if (/\.(exe|com|bat|cmd|ps1|vbs|lnk|msi|scr)$/i.test(v)) throw Error('Executable installers and protected game programs cannot be deployed.');
  if (/^(scripts|plugins|mods)\//.test(lower)) return v;
  if (!v.includes('/') && (/\.(asi|ini|cfg|json)$/i.test(v) || /^(dinput8|scripthookv|scripthookvdotnet[23]?)\.dll$/i.test(v))) return v;
  throw Error(`Base-game write is protected: ${v}. Use a mods-folder destination.`);
}
export async function contained(root, value, allowRoot = false) {
  if (allowRoot && !value) return path.resolve(root);
  const rel = relative(value);
  let cursor = path.resolve(root);
  const rootStat = await fs.lstat(cursor).catch(e => e.code === 'ENOENT' ? null : Promise.reject(e));
  if (rootStat?.isSymbolicLink()) throw Error('Root directory cannot be a symbolic link.');
  for (const part of rel.split('/')) {
    // Resolve Windows casing on every platform; reject ambiguous archives/folders.
    const names = await fs.readdir(cursor).catch(e => e.code === 'ENOENT' ? [] : Promise.reject(e));
    const matches = names.filter(n => n.toLowerCase() === part.toLowerCase());
    if (matches.length > 1) throw Error(`Ambiguous case-insensitive path: ${value}`);
    cursor = path.join(cursor, matches[0] ?? part);
    const st = await fs.lstat(cursor).catch(e => e.code === 'ENOENT' ? null : Promise.reject(e));
    if (st?.isSymbolicLink()) throw Error(`Symbolic links are refused: ${value}`);
  }
  return cursor;
}
export async function exists(p) {try {await fs.access(p); return true;} catch(e) {if(e.code==='ENOENT')return false;throw e;}}
export async function bytes(p, max = MAX_BYTES) {
  const st = await fs.stat(p);
  if (!st.isFile() || st.size > max) throw Error(`File exceeds supported size (${max} bytes) or is not a file: ${path.basename(p)}`);
  return fs.readFile(p);
}
export function digest(b) {return createHash('sha256').update(b).digest('hex');}
export async function hash(p) {
  const h=createHash('sha256');for await(const b of createReadStream(p))h.update(b);return h.digest('hex');
}
export async function atomic(p, data) {
  await fs.mkdir(path.dirname(p), {recursive:true});
  const tmp=`${p}.${randomUUID()}.tmp`;
  try {
    const f=await fs.open(tmp,'wx');try{await f.writeFile(data);await f.sync();}finally{await f.close();}
    await fs.rename(tmp,p);
  } finally {await fs.rm(tmp,{force:true});}
}
export async function json(p, data) {return atomic(p, JSON.stringify(data,null,2));}
export async function walk(root, prefix='') {
  const result=[];
  for(const e of await fs.readdir(path.join(root,prefix), {withFileTypes:true})) {
    const rel=prefix?`${prefix}/${e.name}`:e.name;
    relative(rel);
    if(e.isSymbolicLink())throw Error(`Symbolic link in import: ${rel}`);
    if(e.isDirectory())result.push(...await walk(root,rel));
    else if(e.isFile())result.push(rel);
    if(result.length>20000)throw Error('Too many archive files.');
  }
  return result;
}
