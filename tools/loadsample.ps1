# 機器負載取樣器（2026-10-28 一次性工具，2026-10-29 進 repo）。判定在 scripts/loadjudge.mjs。
# 每個時段用各程序 CPU 時間的差值算佔整機的百分比（÷ 核心數），拆四塊：
#   observer = claude*.exe
#   own      = 路徑含 ms-playwright 或 .cache\puppeteer 的瀏覽器，或命令列含本 repo 名稱／mutate.mjs／layouttest／playwright 的 node
#   system   = 路徑在 系統目錄（%SystemRoot%） 底下、或讀不到路徑的
#   foreign  = 其餘全部
# 每行印 top=[外來前三名] systop=[系統前三名]。
#
# 為什麼系統那一塊也要印前幾名、也要設門檻（2026-10-29 補洞）：
#   2026-10-28 一輪突變期間，安裝程式（推論是 msiexec，在 系統目錄（%SystemRoot%） 底下）吃掉約 20%，被算進「系統」；
#   當時門檻只看外來，外來那塊一聲都沒響，兩條受干擾的耗時差點被拿去訂時限——是靠旁人告知的背景才回頭對上時間。
#   不改成「把安裝類程式改算外來」：那要一份名單，名單列不完，遇到沒見過的程式會靜默漏掉——那正是這次發生的事。
#
# ══ 盲點清單（比功能說明有用；每一條都不是它壞掉，是它量的東西跟我們以為的不一樣）══
#   ① 2026-10-28：安裝程式在 系統目錄（%SystemRoot%） 底下 → 算進「系統」→ 以為機器乾淨。補：印 systop、系統也設門檻（loadjudge）。
#   ② 2026-10-28：門檻只看外來 → 系統吃 20% 也判乾淨。補：系統同一個門檻形狀。
#   ③ 2026-10-29：own 用「瀏覽器路徑含 .cache\puppeteer／ms-playwright」認 → 別的專案用 puppeteer 開的瀏覽器會被算成本 repo 自己的。
#      沒補（待辦：改從父程序鏈認；改了之後跟 10-28、10-29 的數字不能直接比）。
#   ④ 2026-10-29：Claude 桌面 App 的內建瀏覽器面板是 claude.exe 自己的程序 → 算進「觀察者」，觀察者不設門檻 → 看不到。
#      實測：查詢島 14:04:12 起 GPU 滿載那 15 秒，觀察者那一窗 17（空機 3～4），外來 0.6。
#      判定端已補（loadjudge 觀察者門檻，同日）；取樣端仍分不出是內建瀏覽器還是本 Session 自己——超過一律算干擾。
#   ⑤ 2026-10-29：只量 CPU，GPU 完全量不到（④ 是靠 CPU 一起升高才間接看見）。沒補。
#   ⑥ 2026-10-29：門檻「基線＋一個核心」剛好容許一支吃滿一核的外來程序——查詢島的 node 測試／突變 8.5～9.7、整段平均判乾淨。
#      這是設計上的容忍度，不是錯；但「判乾淨」不等於「沒有別人在跑」。沒改。
#   ⑦ 2026-10-29：run-affected 開的 node 是 `node scripts/x.mjs`、命令列不含 repo 名 → 本 repo 自己的 node 測試多半算進「外來」
#      （推論：own=0 時 top 裡的 node 0.4～0.7）。方向是偏嚴（把自己算成干擾），不會讓干擾被漏掉。
#
# 已知限制：
#   - 時段中間結束的程序整個漏算（第二次快照沒有它）；時段越短漏得越少，預設用 10 秒。
#   - own 靠命令列字樣認：從路徑含 repo 名的地方跑的任何 node 都會被認成 own（例：session 暫存區）。
#   - 讀不到 StartTime 的程序（權限）跳過、不計。
# 用法：-Seconds 每段秒數  -Count 段數（0＝跑到被殺）  -Out 輸出檔（建議 .logs/ 底下）
param([int]$Seconds = 10, [int]$Count = 1, [string]$Out = '')
$cores = [Environment]::ProcessorCount
function Snap {
  $h = @{}
  foreach ($p in Get-Process) {
    try { $t = $p.TotalProcessorTime.TotalMilliseconds; $st = $p.StartTime } catch { continue }
    $h["$($p.Id)|$($st.Ticks)"] = @{ id = $p.Id; name = $p.ProcessName; path = $p.Path; ms = $t }
  }
  return $h
}
$cmd = @{}
function CmdLine($id) {
  if (-not $cmd.ContainsKey($id)) {
    $c = (Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue).CommandLine
    $cmd[$id] = if ($c) { $c } else { '' }
  }
  return $cmd[$id]
}
function Classify($e) {
  $n = $e.name.ToLower(); $p = if ($e.path) { $e.path.ToLower() } else { '' }
  if ($n -like 'claude*') { return 'observer' }
  if ($p -like '*ms-playwright*' -or $p -like '*\.cache\puppeteer\*') { return 'own' }
  if ($n -eq 'node' -and (CmdLine $e.id) -match 'TripQuest|mutate\.mjs|layouttest|playwright') { return 'own' }
  if ($p -eq '' -or $p -like "$env:SystemRoot\*") { return 'system' }
  return 'foreign'
}
$i = 0
while ($Count -eq 0 -or $i -lt $Count) {
  $a = Snap; $t0 = Get-Date
  Start-Sleep -Seconds $Seconds
  $b = Snap; $dt = ((Get-Date) - $t0).TotalMilliseconds
  $sum = @{ system = 0.0; observer = 0.0; own = 0.0; foreign = 0.0 }; $top = @{}; $stop = @{}
  foreach ($k in $b.Keys) {
    $e = $b[$k]; if ($e.name -eq 'Idle') { continue }
    $d = if ($a.ContainsKey($k)) { $e.ms - $a[$k].ms } else { $e.ms }
    if ($d -le 0) { continue }
    $c = Classify $e; $sum[$c] += $d
    if ($c -eq 'foreign') { $top[$e.name] = ($top[$e.name] + $d) }
    if ($c -eq 'system') { $stop[$e.name] = ($stop[$e.name] + $d) }
  }
  $pct = { param($v) [math]::Round(100 * $v / ($dt * $cores), 1) }
  $fmt = { param($h) ($h.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 3 | ForEach-Object { "$($_.Key)=$(& $pct $_.Value)" }) -join ',' }
  $line = "{0} system={1} observer={2} own={3} foreign={4} top=[{5}] systop=[{6}]" -f $t0.ToString('HH:mm:ss'), (& $pct $sum.system), (& $pct $sum.observer), (& $pct $sum.own), (& $pct $sum.foreign), (& $fmt $top), (& $fmt $stop)
  if ($Out) { Add-Content -Path $Out -Value $line -Encoding utf8 } else { $line }
  $i++
}
