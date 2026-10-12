// Independent adapter to a user-provided CodeWalker assembly. No CodeWalker source or keys are included.
// Experimental: requires a separately built, legally obtained CodeWalker.Core.dll and dependencies.
using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;
using System.Collections;
using System.Text.RegularExpressions;

static class Program {
  static string Str(JsonElement e, string k) => e.TryGetProperty(k, out var v) ? v.GetString() ?? "" : "";
  static IEnumerable<object> Seq(object value) => ((IEnumerable)value).Cast<object>();
  static object Get(object o, string name) => o.GetType().GetProperty(name)?.GetValue(o) ?? o.GetType().GetField(name)?.GetValue(o) ?? throw new Exception("Missing backend member: " + name);
  static string Name(object o) => (string)Get(o,"Name");
  static object Invoke(Type t,string name,object? target,params object?[] args) {
    var methods=t.GetMethods().Where(m=>m.Name==name && m.GetParameters().Length==args.Length).ToArray();
    if(methods.Length!=1)throw new Exception("Backend API mismatch: "+name);
    return methods[0].Invoke(target,args)!;
  }
  static void Validate(string p) {
    if(string.IsNullOrWhiteSpace(p) || p.StartsWith('/') || p.StartsWith('\\') || p.Contains(':') || p.Replace('\\','/').Split('/').Any(x=>x==".."||x=="."||x==""))throw new Exception("Unsafe archive path.");
  }
  static object Find(object archive,string relative) {
    Validate(relative);object dir=Get(archive,"Root");var parts=relative.Replace('\\','/').Split('/');
    for(int i=0;i<parts.Length;i++){
      var entries=Seq(Get(dir,"Directories")).Concat(Seq(Get(dir,"Files")));var item=entries.SingleOrDefault(e=>Name(e).Equals(parts[i],StringComparison.OrdinalIgnoreCase));
      if(item==null)throw new Exception("Archive entry not found: "+relative);
      if(i==parts.Length-1)return item;dir=item;
    }throw new Exception("Invalid path.");
  }
  static (object archive,string rest) Nested(object archive,string path) {
    var parts=path.Replace('\\','/').Split('/');int start=0;
    for(int i=0;i<parts.Length;i++)if(parts[i].EndsWith(".rpf",StringComparison.OrdinalIgnoreCase)){
      var entry=Find(archive,string.Join('/',parts[start..(i+1)]));
      archive=Seq(Get(archive,"Children")).SingleOrDefault(c=>ReferenceEquals(Get(c,"ParentFileEntry"),entry)) ?? throw new Exception("Nested archive could not be opened.");start=i+1;
    }
    return(archive,string.Join('/',parts[start..]));
  }
  static IEnumerable<object> Listing(object dir,string prefix="") {
    foreach(var d in Seq(Get(dir,"Directories"))){var p=prefix+Name(d);yield return new{path=p,name=Name(d),kind="directory",size=0};foreach(var e in Listing(d,p+"/"))yield return e;}
    foreach(var f in Seq(Get(dir,"Files")))yield return new{path=prefix+Name(f),name=Name(f),kind=f.GetType().Name.Contains("Resource")?"resource":"binary",size=Convert.ToInt64(Get(f,"FileSize"))};
  }
  static byte[] Read(object entry,Type rpf){
    var archive=Get(entry,"File");
    if(entry.GetType().Name.Contains("Resource")){
      if((bool)Get(entry,"IsEncrypted"))throw new Exception("Encrypted script resources are unsupported by this adapter.");
      object top=archive;while(top.GetType().GetProperty("Parent")?.GetValue(top) is object parent)top=parent;
      using var stream=File.OpenRead((string)Get(top,"FilePath"));stream.Position=Convert.ToInt64(Get(archive,"StartPos"))+Convert.ToInt64(Get(entry,"FileOffset"))*512;
      int length=checked((int)Convert.ToInt64(Get(entry,"FileSize")));if(length<=0||length>256*1024*1024)throw new Exception("Unsupported resource size.");var b=new byte[length];stream.ReadExactly(b);return b;
    }
    return(byte[])Invoke(rpf,"ExtractFile",archive,entry);
  }
  public static void Main(string[] args) {
    try {
      var request=JsonDocument.Parse(args.Length==0?Console.In.ReadToEnd():args.Single()).RootElement;string core=Path.GetFullPath(Str(request,"core")),file=Path.GetFullPath(Str(request,"file")),action=Str(request,"action"),entry=Str(request,"entry");
      AssemblyLoadContext.Default.Resolving+=(_,name)=>{var p=Path.Combine(Path.GetDirectoryName(core)!,name.Name+".dll");return File.Exists(p)?AssemblyLoadContext.Default.LoadFromAssemblyPath(p):null;};
      var assembly=AssemblyLoadContext.Default.LoadFromAssemblyPath(core);var rpf=assembly.GetType("CodeWalker.GameFiles.RpfFile",true)!;var keys=assembly.GetType("CodeWalker.GameFiles.GTA5Keys",true)!;
      Invoke(keys,"LoadFromPath",null,Str(request,"keys"),false,null);
      object root=Activator.CreateInstance(rpf,file,Path.GetFileName(file))!;var errors=new List<string>();
      Invoke(rpf,"ScanStructure",root,(Action<string>)(_=>{}),(Action<string>)(s=>errors.Add(s)));if(errors.Count>0)throw new Exception(string.Join("; ",errors));
      var nested=string.IsNullOrEmpty(entry)?(root,""):Nested(root,entry);object current=nested.Item1;string remaining=nested.Item2;
      object result;
      if(action=="list"){
        if(remaining.Length>0)throw new Exception("List requires an archive path, not a file.");result=new{entries=Listing(Get(current,"Root")).ToArray()};
      }else if(action=="read")result=new{base64=Convert.ToBase64String(Read(Find(current,remaining),rpf))};
      else if(action=="write"||action=="delete"||action=="mkdir"){
        // Writes are restricted to the application's staged transaction copies.
        if(!Regex.IsMatch(file.Replace('\\','/'),@"/transactions/[^/]+/stage/\d+/"))throw new Exception("Archive mutations require a staged transaction copy.");
        Validate(remaining);Invoke(rpf,"EnsureValidEncryption",null,root,(Func<object,bool>)(_=>true),true);
        if(action=="delete")Invoke(rpf,"DeleteEntry",null,Find(current,remaining));
        else {
          var seg=remaining.Split('/');object dir=Get(current,"Root");foreach(var folder in seg[..^1]){var found=Seq(Get(dir,"Directories")).SingleOrDefault(d=>Name(d).Equals(folder,StringComparison.OrdinalIgnoreCase));if(found==null)throw new Exception("Destination folder missing: "+folder);dir=found;}
          if(action=="mkdir")Invoke(rpf,"CreateDirectory",null,dir,seg[^1]);
          else{var data=Convert.FromBase64String(Str(request,"base64"));Invoke(rpf,"CreateFile",null,dir,seg[^1],data,true);}
        }result=new{ok=true};
      }else throw new Exception("Unknown archive action.");
      Console.WriteLine(JsonSerializer.Serialize(result));
    }catch(Exception e){Console.WriteLine(JsonSerializer.Serialize(new{error=(e.InnerException??e).Message}));Environment.ExitCode=1;}
  }
}
