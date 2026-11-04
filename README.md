# jasan-data

「자산 키움 노트」 앱이 실행될 때 내려받는 시장 정보 파일입니다.

- `jasan-data/market.json` — 기준금리, 코스피, 금융상품 가이드, 수익률 가정 등
- 매주 자동으로 갱신됩니다. 개인 자산 데이터는 포함되지 않습니다.
- 스키마: `schema`(1), `updatedAt`(YYYY-MM-DD), `asOfLabel`, `market[{k,v,n}]`, `baseRate`, `guide[{t,tag,risk?,d,f[[k,v]],tip[]}]`, `outlook[{t,body}]`, `notices[]`, `scenarios[3]{k,r,desc}`, `marketView{rateTrend(up|flat|down),equity(high|neutral|low),summary,tilts[]}`, `typeRates{}`, `sources[{title,url}]`
