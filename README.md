# 밤하늘 별자리 관측기

위도와 경도를 입력하면 **그 장소의 지형(산 능선·바다)과 그 시각의 밤하늘**을 보여 주는 웹 프로그램입니다.
설치나 빌드 없이 브라우저만 있으면 실행됩니다.

## 실행 방법

**가장 쉬운 방법:** `standalone.html` 파일 하나만 내려받아 더블클릭하세요.
모든 코드와 별 자료가 이 파일 안에 들어 있어서 다른 파일이 필요 없습니다.
(코드를 고친 뒤에는 `python3 tools/build_standalone.py`로 다시 만듭니다.)

전체 폴더로 실행하려면:

```bash
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000 접속
```

폴더째 받았다면 `index.html`을 바로 열어도 됩니다. (`index.html`만 따로 받으면 화면이 깨집니다.) 지형·지명·지도는 인터넷 연결이 필요하고,
오프라인일 때는 가상 지형으로 대신 표시합니다.

## 기능

- **위치 지정**: 위도/경도 입력, 지도 클릭, 장소 이름 검색, 내 위치(GPS), 추천 관측지
- **실제 지형 배경**: 관측 지점 주변 반경 50 km의 고도 자료(AWS Terrain Tiles: SRTM 등, 가까운 곳 약 30 m·먼 곳 약 250 m 간격)로
  방위 2°마다 산 능선을 계산해 가까운 산·먼 산을 층으로 그립니다. 지구 곡률과 대기 굴절을 반영하고,
  바다 방향은 수면과 달빛·햇빛 반사로 표현합니다.
- **실제 건물**: OpenStreetMap에 등록된 건물(반경 약 1.5 km의 모든 건물 + 6 km 안의 고층 건물)을 불러와
  건물 윤곽을 지평선에 세웁니다. 높이 태그가 없으면 층수 × 3.2 m, 그것도 없으면 용도별 기본 높이를 씁니다.
  밤에는 창문 불빛이 켜지고, 먼 건물은 대기에 묻혀 흐리게, 산 뒤의 건물은 가려져 보입니다.
- **관측 높이**: 옥상·전망대처럼 지면보다 높은 곳에서 보는 경우 높이(m)를 넣으면 지형과 건물 윤곽이 다시 계산됩니다.
- **위성 지도**: 선택한 위치를 위성 사진/일반 지도로 보여 주고 현재 바라보는 방향을 부채꼴로 표시합니다.
- **밤하늘**: 6등급까지의 별 약 5,000개(색은 B−V 색지수), 88개 별자리 선과 한글 이름, 밝은 별 이름,
  은하수, 태양·달(위상 포함)·수성·금성·화성·목성·토성
- **시간**: 현지 시각 입력(시간대 자동 감지), 하루 시간 슬라이더, 지금/오늘 밤 버튼, 시간 흐름 재생
- **현실감**: 해의 고도에 따른 낮·박명·밤 하늘색, 대기 소광, 빛공해 정도, 달빛, 현재 구름양 반영
- **조작**: 드래그로 둘러보기, 휠·핀치로 확대, 방위 버튼, 전천(어안) 보기, 천체를 클릭하면 등급·고도·방위 정보
- **공유**: 위치·시각·시야가 주소창 URL에 저장되어 그대로 공유할 수 있습니다.
  예) `index.html?lat=33.36&lon=126.53&t=2026-10-25T12:30Z&h=0&az=180&alt=25&fov=100` (`h`는 관측 높이 m)

## 논리 게이트 퍼즐 (`logic-game/`)

같은 저장소에 들어 있는 디지털 논리 퍼즐 게임입니다. `logic-game/index.html` 파일 하나만 브라우저로 열면 됩니다.

- 게이트(NOT·AND·OR·NAND·NOR·XOR·XNOR)를 보드에 놓고 전선으로 이어 목표 진리표를 만족시키면 스테이지를 깹니다.
- 16단계: 전선 연결 → 기본 게이트 → NAND만으로 NOT/AND/OR/XOR → 반가산기 → 전가산기 → 멀티플렉서 → 다수결 회로 → 비교기 → 디코더 → 패리티 검사기 → 2비트 덧셈기
- 회로는 실시간으로 시뮬레이션되어 1인 전선은 노란색으로 빛나고, 진리표의 줄마다 맞음/틀림이 표시됩니다.
- 게이트를 적게 쓸수록 별을 더 받습니다(최소 개수면 ★★★). 진행 상황과 회로는 브라우저에 저장됩니다.

## PID 드론 호버링 (`pid-drone/`)

PID 제어기의 게인을 조절해 드론을 목표 높이에 띄우는 제어공학 게임입니다. `pid-drone/index.html` 하나만 열면 됩니다.

- 8개 미션: P 제어로 이륙 → PD로 출렁임 잡기 → PID로 처짐 없애기 → 돌풍 버티기 → 택배 싣기(질량 변화) → 적분 와인드업 → 센서 노이즈와 D 필터 → 자유 비행
- 드론 모델: 질량 1 kg, 최대 추력 25 N, 모터 지연 0.08 s, 공기 저항. 제어기는 50 Hz로 동작합니다.
- 비행이 끝나면 오버슈트·정착 시간·정상상태 오차 등을 채점하고, 오차 넓이(∫|e|dt)가 작을수록 별을 더 줍니다.
- 고도·추력 그래프와 P·I·D 각 항의 크기를 실시간으로 보여 줍니다.

## 정확도

천체 위치는 항성시·세차(IAU 1976)·대기 굴절을 적용해 계산하며, astropy와 비교해 별은 1′ 이내,
행성은 약 0.1° 이내, 달은 약 0.3° 이내로 일치합니다.

## 파일 구성

| 파일 | 역할 |
| --- | --- |
| `index.html`, `css/style.css` | 화면 구성 |
| `js/astro.js` | 천문 계산 (항성시, 세차, 좌표 변환, 태양·달·행성 위치) |
| `js/terrain.js` | 지형 고도 조회와 지평선 윤곽 계산, 시간대·구름양·지명 조회 |
| `js/buildings.js` | 건물 조회(OpenFreeMap 벡터 타일 해석, Overpass)와 건물 윤곽 계산 |
| `js/sky.js` | 렌더러 (WebGL 하늘·지형 + Canvas 별·라벨, 스테레오 투영) |
| `js/app.js` | 입력, 지도, 조작, 정보창 |
| `data/sky-data.js` | 별·별자리·은하수 자료 (`tools/build_data.py`로 생성) |
| `vendor/leaflet/` | 지도 라이브러리 Leaflet 1.9.4 |

별 자료를 다시 만들려면:

```bash
npm pack d3-celestial && tar xzf d3-celestial-*.tgz
python3 tools/build_data.py package/data data/sky-data.js
```

## 출처

- 별·별자리·은하수 자료: [d3-celestial](https://github.com/ofrohn/d3-celestial) (BSD-3, Olaf Frohn) — `data/LICENSE-d3-celestial`
- 지형 고도: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen, SRTM·GMTED·ETOPO1 등)
- 시간대·날씨: [Open-Meteo](https://open-meteo.com/)
- 건물: [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL) — 가까운 건물은 [OpenFreeMap](https://openfreemap.org/) 벡터 타일, 먼 고층 건물은 Overpass API
- 지명 검색: [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org/)
- 위성 사진: Esri World Imagery, 지도: OpenStreetMap
- 지도 라이브러리: [Leaflet](https://leafletjs.com/) (BSD-2)
