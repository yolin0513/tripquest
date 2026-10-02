# 程序建立／結束事件（2026-10-02）：給 tools/sample-run.mjs 逐一計數峰值用，不靠定時取樣。
# 不需要系統管理員：用 WMI 的 __InstanceCreationEvent／__InstanceDeletionEvent，WMI 每 0.1 秒檢查一次（WITHIN 0.1）——
# 活不到約 0.1 秒的程序仍可能漏掉（最準的 Win32_ProcessStartTrace 要系統管理員，這個 session 沒有）。
# 每個事件輸出一行：C<tab>pid<tab>ppid<tab>name<tab>建立時間(ms)  或  D<tab>pid
# 一開始先輸出 READY；收到 stdin 關閉（父程序結束）或 .stop 檔出現就結束。
param([string]$StopFile)
$ErrorActionPreference = 'Stop'
Register-CimIndicationEvent -Query "SELECT * FROM __InstanceCreationEvent WITHIN 0.1 WHERE TargetInstance ISA 'Win32_Process'" -SourceIdentifier tqC | Out-Null
Register-CimIndicationEvent -Query "SELECT * FROM __InstanceDeletionEvent WITHIN 0.1 WHERE TargetInstance ISA 'Win32_Process'" -SourceIdentifier tqD | Out-Null
[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
try {
  while (-not ($StopFile -and (Test-Path $StopFile))) {
    $e = Wait-Event -Timeout 1
    if (-not $e) { continue }
    $t = $e.SourceEventArgs.NewEvent.TargetInstance
    if ($e.SourceIdentifier -eq 'tqC') {
      $ms = [int64]([DateTimeOffset]$t.CreationDate).ToUnixTimeMilliseconds()
      [Console]::Out.WriteLine("C`t$($t.ProcessId)`t$($t.ParentProcessId)`t$($t.Name)`t$ms")
    } else {
      [Console]::Out.WriteLine("D`t$($t.ProcessId)")
    }
    [Console]::Out.Flush()
    Remove-Event -EventIdentifier $e.EventIdentifier
  }
} finally {
  Unregister-Event -SourceIdentifier tqC -ErrorAction SilentlyContinue
  Unregister-Event -SourceIdentifier tqD -ErrorAction SilentlyContinue
}
