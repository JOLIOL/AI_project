# 자산 키움 노트 - 로컬 시세 중계 (이 PC 안에서만 동작, localhost:47801)
# 브라우저는 보안 정책(CORS) 때문에 시세 서버에 직접 접속할 수 없어서, 이 스크립트가 대신 받아 전달합니다.
# 개인 자산 데이터는 보내지 않고, 조회할 종목 코드만 시세 제공처(야후·네이버·업비트)에 요청합니다.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$Port = 47801
$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
$Yahoo = 'https://query1.finance.yahoo.com'
$YahooSearch = 'https://query2.finance.yahoo.com'
$Naver = 'https://m.stock.naver.com'
$NaverAc = 'https://ac.stock.naver.com'
$Upbit = 'https://api.upbit.com'
if ($env:JASAN_UPSTREAM) { $Yahoo = $env:JASAN_UPSTREAM; $YahooSearch = $env:JASAN_UPSTREAM; $Naver = $env:JASAN_UPSTREAM; $NaverAc = $env:JASAN_UPSTREAM; $Upbit = $env:JASAN_UPSTREAM }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() } catch { exit 0 }   # 이미 실행 중이면 종료

$cache = @{}
$lastHit = Get-Date

function Get-Json([string]$url) {
  $r = Invoke-WebRequest -Uri $url -UserAgent $UA -UseBasicParsing -TimeoutSec 8
  $bytes = $r.RawContentStream.ToArray()
  $text = [Text.Encoding]::UTF8.GetString($bytes)
  return ($text | ConvertFrom-Json)
}
function To-Num($v) { if ($null -eq $v) { return $null }; $s = [string]$v; $s = $s -replace '[,\s%+]', ''; $d = 0.0; if ([double]::TryParse($s, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$d)) { return $d }; return $null }

function Quote-Yahoo([string]$sym) {
  $u = "$Yahoo/v8/finance/chart/" + [Uri]::EscapeDataString($sym) + '?range=5d&interval=1d'
  $j = Get-Json $u
  $res = $j.chart.result[0]; if (-not $res) { return $null }
  $m = $res.meta; $price = To-Num $m.regularMarketPrice; if (-not $price) { return $null }
  $prev = To-Num $m.previousClose
  if (-not $prev) {
    $closes = @($res.indicators.quote[0].close | Where-Object { $_ -ne $null })
    if ($closes.Count -ge 2) { $prev = To-Num $closes[$closes.Count - 2] } else { $prev = To-Num $m.chartPreviousClose }
  }
  $name = $m.shortName; if (-not $name) { $name = $m.longName }
  return @{ price = $price; prev = $prev; currency = [string]$m.currency; time = [int64]$m.regularMarketTime; name = [string]$name; src = 'Yahoo'; symbol = $sym }
}
function Quote-Naver([string]$code) {
  $j = Get-Json "$Naver/api/stock/$code/basic"
  $price = To-Num $j.closePrice; if (-not $price) { return $null }
  $prev = $null; $ratio = To-Num ([string]$j.fluctuationsRatio)
  if ($null -ne $ratio) { if (([string]$j.fluctuationsRatio).Trim().StartsWith('-') -and $ratio -gt 0) { $ratio = -$ratio }; $prev = [math]::Round($price / (1 + $ratio / 100), 2) }
  return @{ price = $price; prev = $prev; currency = 'KRW'; time = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()); name = [string]$j.stockName; src = 'Naver'; symbol = $code }
}
function Quote-Upbit([string]$mkt) {
  $j = Get-Json "$Upbit/v1/ticker?markets=$mkt"
  $t = @($j)[0]; if (-not $t) { return $null }
  $price = To-Num $t.trade_price; $prev = To-Num $t.prev_closing_price
  return @{ price = $price; prev = $prev; currency = 'KRW'; time = [int64]([double]$t.trade_timestamp / 1000); name = $mkt; src = 'Upbit'; symbol = $mkt }
}
function Get-Quote([string]$s) {
  $key = $s.ToUpper()
  if ($cache.ContainsKey($key) -and ((Get-Date) - $cache[$key].t).TotalSeconds -lt 20) { return $cache[$key].v }
  $q = $null
  try {
    if ($key -match '^(KRW|BTC|USDT)-[A-Z0-9]+$') { $q = Quote-Upbit $key }
    elseif ($key -match '^\d{6}$') {
      try { $q = Quote-Yahoo "$key.KS" } catch { $q = $null }
      if (-not $q) { try { $q = Quote-Yahoo "$key.KQ" } catch { $q = $null } }
      if (-not $q) { $q = Quote-Naver $key }
    }
    else { $q = Quote-Yahoo $key }
  } catch { $q = $null }
  if ($q) { $cache[$key] = @{ t = (Get-Date); v = $q } }
  return $q
}
function Search-Symbols([string]$q) {
  $out = @()
  if ($q -match '[가-힣]') {
    try {
      $j = Get-Json ("$NaverAc/ac?q=" + [Uri]::EscapeDataString($q) + '&target=stock')
      foreach ($it in @($j.items)) { if ($it.code) { $out += @{ symbol = [string]$it.code; name = [string]$it.name; exch = [string]$it.typeName; type = [string]$it.category } } }
    } catch {}
  }
  if ($out.Count -eq 0) {
    try {
      $j = Get-Json ("$YahooSearch/v1/finance/search?q=" + [Uri]::EscapeDataString($q) + '&quotesCount=8&newsCount=0')
      foreach ($it in @($j.quotes)) { if ($it.symbol) { $n = $it.shortname; if (-not $n) { $n = $it.longname }; $out += @{ symbol = [string]$it.symbol; name = [string]$n; exch = [string]$it.exchDisp; type = [string]$it.quoteType } } }
    } catch {}
  }
  return ,$out
}
function Send([System.Net.HttpListenerContext]$ctx, [int]$code, $obj) {
  $res = $ctx.Response
  $res.StatusCode = $code
  $res.Headers.Add('Access-Control-Allow-Origin', '*')
  $res.Headers.Add('Access-Control-Allow-Private-Network', 'true')
  $res.Headers.Add('Access-Control-Allow-Methods', 'GET, OPTIONS')
  $res.Headers.Add('Cache-Control', 'no-store')
  $res.ContentType = 'application/json; charset=utf-8'
  $json = if ($null -eq $obj) { '{}' } else { ConvertTo-Json $obj -Depth 6 -Compress }
  $buf = [Text.Encoding]::UTF8.GetBytes($json)
  $res.ContentLength64 = $buf.Length
  $res.OutputStream.Write($buf, 0, $buf.Length)
  $res.OutputStream.Close()
}

while ($listener.IsListening) {
  $task = $listener.GetContextAsync()
  while (-not $task.Wait(60000)) {
    if (((Get-Date) - $lastHit).TotalHours -ge 3) { $listener.Stop(); exit 0 }
  }
  $ctx = $task.Result
  $lastHit = Get-Date
  try {
    $req = $ctx.Request
    if ($req.HttpMethod -eq 'OPTIONS') { Send $ctx 200 $null; continue }
    $path = $req.Url.AbsolutePath
    $qs = $req.QueryString
    if ($path -eq '/ping') { Send $ctx 200 @{ ok = $true; app = 'jasan-quote'; v = 1 } }
    elseif ($path -eq '/quote') {
      $out = @{}
      foreach ($s in (([string]$qs['s']) -split ',')) {
        $s = $s.Trim(); if (-not $s) { continue }
        $q = Get-Quote $s
        if ($q) { $out[$s] = $q } else { $out[$s] = @{ error = 'not_found' } }
      }
      Send $ctx 200 $out
    }
    elseif ($path -eq '/search') { Send $ctx 200 @{ items = (Search-Symbols ([string]$qs['q'])) } }
    elseif ($path -eq '/stop') { Send $ctx 200 @{ ok = $true }; $listener.Stop(); exit 0 }
    else { Send $ctx 404 @{ error = 'not_found' } }
  } catch {
    try { Send $ctx 500 @{ error = [string]$_.Exception.Message } } catch {}
  }
}
