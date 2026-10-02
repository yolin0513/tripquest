# 一次性可行性實驗（2026-10-02）：Job Object 殺得乾淨 Git Bash 開的整棵樹嗎？
# 同一組情境：bash -c '( sleep 118 & ) ; sleep 117'——118 是中間子殼已結束的孤兒，117 是直接子程序。
# 判準：殺之前兩支都在、而且 IsProcessInJob 都是 true（不是 true＝Git Bash 的程序脫離了 job→這條做不到）；TerminateJobObject 之後 0 個殘留。
param([string]$Bash, [string]$Mode = 'terminate')
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class Job {
  [StructLayout(LayoutKind.Sequential)] public struct BASIC { public long a; public long b; public uint LimitFlags; public UIntPtr c; public UIntPtr d; public uint e; public UIntPtr f; public uint g; public uint h; }
  [StructLayout(LayoutKind.Sequential)] public struct IO { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] public struct EXT { public BASIC Basic; public IO Io; public UIntPtr a, b, c, d; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct SI { public int cb; public string r, d, t; public int x, y, xs, ys, xc, yc, fill, flags; public short show, r2; public IntPtr r3, i, o, e; }
  [StructLayout(LayoutKind.Sequential)] public struct PI { public IntPtr hProcess, hThread; public int pid, tid; }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetInformationJobObject(IntPtr h, int cls, ref EXT info, int len);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool TerminateJobObject(IntPtr j, uint code);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool IsProcessInJob(IntPtr p, IntPtr j, out bool r);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint acc, bool inh, int pid);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern uint ResumeThread(IntPtr t);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool CreateProcess(string app, string cmd, IntPtr pa, IntPtr ta, bool inh, uint flags, IntPtr env, string cwd, ref SI si, out PI pi);
  public static IntPtr NewJob() {
    IntPtr j = CreateJobObject(IntPtr.Zero, null);
    if (j == IntPtr.Zero) throw new Exception("CreateJobObject " + Marshal.GetLastWin32Error());
    EXT e = new EXT(); e.Basic.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE：萬一這支腳本自己死掉，job 關閉時連帶殺
    if (!SetInformationJobObject(j, 9, ref e, Marshal.SizeOf(typeof(EXT)))) throw new Exception("SetInformationJobObject " + Marshal.GetLastWin32Error());
    return j;
  }
  public static int Start(IntPtr j, string cmd) {
    SI si = new SI(); si.cb = Marshal.SizeOf(typeof(SI)); PI pi;
    if (!CreateProcess(null, cmd, IntPtr.Zero, IntPtr.Zero, false, 0x4 | 0x08000000, IntPtr.Zero, null, ref si, out pi)) throw new Exception("CreateProcess " + Marshal.GetLastWin32Error());
    if (!AssignProcessToJobObject(j, pi.hProcess)) throw new Exception("AssignProcessToJobObject " + Marshal.GetLastWin32Error());
    ResumeThread(pi.hThread); CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
    return pi.pid;
  }
  public static string InJob(IntPtr j, int pid) {
    IntPtr h = OpenProcess(0x1000, false, pid); // QUERY_LIMITED_INFORMATION
    if (h == IntPtr.Zero) return "開不了（" + Marshal.GetLastWin32Error() + "）";
    bool r; bool ok = IsProcessInJob(h, j, out r); CloseHandle(h);
    return ok ? r.ToString() : "查不了";
  }
}
'@
function Sleeps { @(Get-CimInstance Win32_Process -Filter "Name='sleep.exe'" | Where-Object { $_.CommandLine -match ' 11[78]\b' } | ForEach-Object { [pscustomobject]@{ Pid = [int]$_.ProcessId; Sec = ([regex]::Match($_.CommandLine, ' (11[78])\b')).Groups[1].Value } }) }
"開始前：117／118 的 sleep $((Sleeps).Count) 支（要 0）"
$j = [Job]::NewJob()
$root = [Job]::Start($j, "`"$Bash`" -c `"( sleep 118 & ) ; sleep 117`"")
"root（Git Bash）pid $root，在 job 裡＝$([Job]::InJob($j, $root))"
Start-Sleep -Milliseconds 2500
$before = Sleeps
foreach ($s in $before) { "殺之前：sleep $($s.Sec)（pid $($s.Pid)）在 job 裡＝$([Job]::InJob($j, $s.Pid))" }
$formed = @($before | Where-Object Sec -eq '117').Count -eq 1 -and @($before | Where-Object Sec -eq '118').Count -eq 1
"（判準對照：一支 117 的合成清單算出 $(@(@([pscustomobject]@{Sec='117'}) | Where-Object Sec -eq '117').Count)，要 1）"
if (-not $formed) { "⊘ 情境未成立：殺之前沒有恰好一支 117、一支 118" }
if ($Mode -eq 'rootonly') { Stop-Process -Id $root -Force; $t = '（對照組：不用 job，只殺 root）' } elseif ($Mode -eq 'close') { $t = "（不呼叫，直接關 job：$([Job]::CloseHandle($j))）"; $j = [IntPtr]::Zero } else { $t = [Job]::TerminateJobObject($j, 1) }
Start-Sleep -Milliseconds 1500
$after = Sleeps
"TerminateJobObject＝$t；殺之後還活著：$(if ($after.Count) { ($after | ForEach-Object { "sleep $($_.Sec)（pid $($_.Pid)）" }) -join '、' } else { '無' })"
"結論：情境成立＝$formed；殘留 $($after.Count) 個"
foreach ($s in $after) { try { Stop-Process -Id $s.Pid -Force } catch {} }
[Job]::CloseHandle($j) | Out-Null
"收拾後：$((Sleeps).Count) 支"
