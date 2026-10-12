// Deliberately bounded XML parser. No DTD, external entities, or evaluation.
export function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, x) => {
    const n={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
    if(x[0]!=='#')return n[x];
    const c=x[1].toLowerCase()==='x'?parseInt(x.slice(2),16):parseInt(x.slice(1),10);
    if(c<0||c>0x10ffff||c===0)throw Error('Invalid XML character.');return String.fromCodePoint(c);
  });
}
export function escape(s) {return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');}
export function parseXML(s) {
  s=s.replace(/^\uFEFF/,'');
  if(s.length>4*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(s))throw Error('XML DTDs/entities or oversized XML are refused.');
  const root={name:'#document',attrs:{},children:[],text:''}, stack=[root];
  const tokens=s.match(/<!--[\s\S]*?-->|<\?[^]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g)||[];
  if(tokens.join('')!==s)throw Error('Malformed XML.');
  for(const tok of tokens) {
    const parent=stack.at(-1);
    if(tok.startsWith('<!--')||tok.startsWith('<?'))continue;
    if(tok.startsWith('<![CDATA[')){parent.text+=tok.slice(9,-3);continue;}
    if(tok.startsWith('</')) {
      const name=tok.slice(2,-1).trim();if(stack.length===1||name!==parent.name)throw Error('Mismatched XML closing tag.');stack.pop();
    } else if(tok.startsWith('<')) {
      const m=/^<([\w.:-]+)([\s\S]*?)(\/?)>$/.exec(tok);if(!m)throw Error('Invalid XML element.');
      const attrs={};let rest=m[2];
      while(rest.trim()){
        const a=/^\s+([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(rest);
        if(!a||Object.hasOwn(attrs,a[1]))throw Error('Invalid or duplicate XML attribute.');
        attrs[a[1]]=decode(a[2]??a[3]);rest=rest.slice(a[0].length);
      }
      const node={name:m[1],attrs,children:[],text:''};parent.children.push(node);
      if(!m[3])stack.push(node);if(stack.length>64)throw Error('XML nesting limit.');
    } else {
      if(/&(?!#x[0-9a-f]+;|#\d+;|amp;|lt;|gt;|quot;|apos;)/i.test(tok))throw Error('Unknown XML entity.');
      parent.text+=decode(tok);
    }
  }
  if(stack.length!==1||root.children.length!==1||root.text.trim())throw Error('XML must have exactly one root.');
  return root.children[0];
}
export function child(n,name) {return n.children.find(c=>c.name===name);}
export function serialize(n, indent='') {
  const attrs=Object.entries(n.attrs).map(([k,v])=>` ${k}="${escape(v)}"`).join('');
  if(!n.children.length)return `${indent}<${n.name}${attrs}>${escape(n.text)}</${n.name}>`;
  return `${indent}<${n.name}${attrs}>${n.text.trim()?escape(n.text):''}\n${n.children.map(c=>serialize(c,indent+'  ')).join('\n')}\n${indent}</${n.name}>`;
}
export function registerDlc(xml, pack) {
  if(!/^[a-z0-9_-]+$/i.test(pack))throw Error('Invalid DLC name.');
  const root=parseXML(xml), paths=child(root,'Paths');
  if(root.name!=='SMandatoryPacksData'||!paths)throw Error('Unexpected dlclist.xml structure.');
  const entry=`dlcpacks:/${pack}/`;
  const canon=s=>s.toLowerCase().replaceAll('\\','/').trim();
  if(!paths.children.some(c=>c.name==='Item'&&canon(c.text)===canon(entry)))paths.children.push({name:'Item',attrs:{},children:[],text:entry});
  return '<?xml version="1.0" encoding="UTF-8"?>\n'+serialize(root)+'\n';
}
