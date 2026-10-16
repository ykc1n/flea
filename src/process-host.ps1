param([string]$Token, [string]$Payload, [switch]$Cleanup)
$ErrorActionPreference = 'Stop'
# Wait until the Node supervisor has durably recorded this owner's PID/token.
if (-not $Cleanup -and [Console]::In.ReadLine() -ne 'start') { exit 1 }
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class FleaJob {
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFO {
    public int cb; public IntPtr reserved, desktop, title;
    public int x,y,cx,cy,xc,yc,fill,flags; public short show,cbReserved;
    public IntPtr reserved2,stdin,stdout,stderr;
  }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process,thread; public int pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO info; public IntPtr attributes; }
  [StructLayout(LayoutKind.Sequential)] struct ACCOUNTING { public long a,b,c,d; public uint faults,total,active,terminated; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT {
    public long processTime,jobTime; public uint flags; public UIntPtr min,max;
    public uint active; public UIntPtr affinity; public uint priority,scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT {
    public BASIC_LIMIT basic; public IO_COUNTERS io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,ref EXTENDED_LIMIT info,int size);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr a,IntPtr b,bool inherit,uint flags,IntPtr environment,string directory,ref STARTUPINFOEX startup,out PROCESS_INFORMATION process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,UIntPtr attribute,IntPtr value,UIntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenJobObject(uint access,bool inherit,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int type,out ACCOUNTING info,int size,IntPtr returned);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int type);
  static Exception Error() { return new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
  static string Quote(string value) {
    var result=new StringBuilder("\""); int slashes=0;
    foreach(char ch in value) {
      if(ch=='\\') { slashes++; continue; }
      if(ch=='"') { result.Append('\\',slashes*2+1); result.Append(ch); }
      else { result.Append('\\',slashes); result.Append(ch); }
      slashes=0;
    }
    result.Append('\\',slashes*2); return result.Append('"').ToString();
  }
  static void WaitEmpty(IntPtr job) {
    for(int i=0;i<1500;i++) {
      ACCOUNTING info;
      if(!QueryInformationJobObject(job,1,out info,Marshal.SizeOf(typeof(ACCOUNTING)),IntPtr.Zero)) throw new InvalidOperationException("FLEA_OWNERSHIP_UNRESOLVED: "+Error().Message);
      if(info.active==0) return;
      System.Threading.Thread.Sleep(20);
    }
    throw new TimeoutException("FLEA_OWNERSHIP_UNRESOLVED: Job descendants did not terminate");
  }
  public static void Stop(string token) {
    IntPtr job=OpenJobObject(0x000c,false,"Flea-"+token);
    if(job==IntPtr.Zero) { if(Marshal.GetLastWin32Error()==2) return; throw Error(); }
    try { if(!TerminateJobObject(job,1)) throw Error(); WaitEmpty(job); }
    finally { CloseHandle(job); }
  }
  public static int Run(string[] argv,string token) {
    if(argv.Length==0) throw new ArgumentException("Missing command");
    IntPtr job=CreateJobObject(IntPtr.Zero,"Flea-"+token);
    if(job==IntPtr.Zero) throw Error();
    PROCESS_INFORMATION pi=new PROCESS_INFORMATION();
    IntPtr attributes=IntPtr.Zero,jobPointer=IntPtr.Zero; bool initialized=false;
    try {
      var limit=new EXTENDED_LIMIT(); limit.basic.flags=0x2000; // KILL_ON_JOB_CLOSE; no breakaway permitted
      if(!SetInformationJobObject(job,9,ref limit,Marshal.SizeOf(limit))) throw Error();
      var startup=new STARTUPINFOEX(); startup.info.cb=Marshal.SizeOf(startup); startup.info.flags=0x100;
      startup.info.stdin=GetStdHandle(-10); startup.info.stdout=GetStdHandle(-11); startup.info.stderr=GetStdHandle(-12);
      IntPtr size=IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);
      attributes=Marshal.AllocHGlobal(size);
      if(!InitializeProcThreadAttributeList(attributes,1,0,ref size)) throw Error();
      initialized=true; jobPointer=Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobPointer,job);
      if(!UpdateProcThreadAttribute(attributes,0,new UIntPtr(0x2000d),jobPointer,new UIntPtr((uint)IntPtr.Size),IntPtr.Zero,IntPtr.Zero)) throw Error();
      startup.attributes=attributes;
      var command=new StringBuilder();
      foreach(string arg in argv) { if(command.Length>0) command.Append(' '); command.Append(Quote(arg)); }
      // Atomic job association closes the create-before-assignment crash window.
      if(!CreateProcess(null,command,IntPtr.Zero,IntPtr.Zero,true,0x08080004,IntPtr.Zero,null,ref startup,out pi)) throw Error();
      if(ResumeThread(pi.thread)==0xffffffff) throw Error();
      if(WaitForSingleObject(pi.process,0xffffffff)!=0) throw Error();
      uint code; if(!GetExitCodeProcess(pi.process,out code)) throw Error();
      // The direct child may have abandoned descendants. Kill them before this owner exits.
      if(!TerminateJobObject(job,1)) throw Error();
      WaitEmpty(job);
      return unchecked((int)code);
    } finally {
      if(pi.process!=IntPtr.Zero) { TerminateJobObject(job,1); WaitEmpty(job); }
      CloseHandle(job); // Also kills descendants if the owner is cancelled or throws.
      if(initialized) DeleteProcThreadAttributeList(attributes);
      if(attributes!=IntPtr.Zero) Marshal.FreeHGlobal(attributes);
      if(jobPointer!=IntPtr.Zero) Marshal.FreeHGlobal(jobPointer);
      if(pi.thread!=IntPtr.Zero) CloseHandle(pi.thread);
      if(pi.process!=IntPtr.Zero) CloseHandle(pi.process);
    }
  }
}
'@
if ($Cleanup) { [FleaJob]::Stop($Token); exit 0 }
$arguments = [string[]](ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload))))
try { exit [FleaJob]::Run($arguments, $Token) }
catch {
  [Console]::Error.WriteLine($_.Exception.ToString())
  if ($_.Exception.ToString().Contains('FLEA_OWNERSHIP_UNRESOLVED')) { exit 125 }
  exit 1
}
