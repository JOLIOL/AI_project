// 화면 구성과 상호작용: 위치·시간 입력, 지도, 드래그/확대, 천체 정보.
(function () {
  'use strict';

  const A = window.Astro;
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');

  const PRESETS = [
    ['서울 남산', 37.5512, 126.9882],
    ['제주 한라산', 33.3617, 126.5292],
    ['강원 영월 별마로천문대', 37.1985, 128.4875],
    ['설악산 대청봉', 38.1194, 128.4656],
    ['몽골 고비사막', 43.5, 104.0],
    ['하와이 마우나케아', 19.8207, -155.4681],
    ['칠레 아타카마 사막', -24.6272, -70.4042],
    ['미국 그랜드캐니언', 36.0544, -112.1401],
    ['스위스 체르마트', 46.0207, 7.7491],
    ['뉴질랜드 테카포', -44.0046, 170.4775],
    ['노르웨이 트롬쇠', 69.6492, 18.9553],
    ['적도 · 태평양 한가운데', 0.0, -150.0],
  ];

  const state = {
    offsetMin: 540,
    tzName: '',
    playing: false,
    dirty: true,
    lastFrame: 0,
    info: null,
    localInfo: null,
    loadToken: 0,
    baseProfile: null,
    buildingData: null,
  };

  let sky;
  try {
    sky = new window.SkyView($('sky'), window.SKY_DATA);
  } catch (e) {
    document.body.insertAdjacentHTML('beforeend', '<p style="padding:80px 20px;text-align:center">' + e.message + '</p>');
    return;
  }
  window.skyView = sky; // 콘솔 디버깅용
  const requestDraw = () => { state.dirty = true; };

  // ---------- 상태 표시 ----------
  let statusTimer = 0;
  function showStatus(text, ms) {
    const el = $('status');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(statusTimer);
    if (ms) statusTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  // ---------- 시간 ----------
  function localParts(t) {
    const d = new Date(t + state.offsetMin * 60000);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
  }

  function formatOffset(min) {
    const s = min < 0 ? '−' : '+';
    const a = Math.abs(min);
    return 'UTC' + s + Math.floor(a / 60) + (a % 60 ? ':' + pad(a % 60) : '');
  }

  function setTime(t, { keepInput = false } = {}) {
    sky.time = t;
    const p = localParts(t);
    if (!keepInput) $('datetime').value = `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
    $('timeSlider').value = p.h * 60 + p.mi;
    requestDraw();
    scheduleUrlUpdate();
  }

  function localToUtc(y, mo, d, h, mi) {
    return Date.UTC(y, mo - 1, d, h, mi) - state.offsetMin * 60000;
  }

  $('datetime').addEventListener('change', (e) => {
    const m = /^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/.exec(e.target.value);
    if (m) setTime(localToUtc(+m[1], +m[2], +m[3], +m[4], +m[5]), { keepInput: true });
  });
  $('timeSlider').addEventListener('input', (e) => {
    const p = localParts(sky.time);
    const v = +e.target.value;
    setTime(localToUtc(p.y, p.mo, p.d, Math.floor(v / 60), v % 60));
  });
  $('nowBtn').addEventListener('click', () => setTime(Date.now()));
  $('tonightBtn').addEventListener('click', () => {
    const p = localParts(Date.now());
    setTime(localToUtc(p.y, p.mo, p.d, 21, 0));
  });
  $('playBtn').addEventListener('click', () => {
    state.playing = !state.playing;
    $('playBtn').textContent = state.playing ? '❚❚ 정지' : '▶ 재생';
    state.lastFrame = performance.now();
  });

  // ---------- 위치 ----------
  function setLocation(lat, lon, { name = null, fromMap = false } = {}) {
    lat = Math.max(-90, Math.min(90, lat));
    lon = ((((lon + 180) % 360) + 360) % 360) - 180;
    sky.lat = lat;
    sky.lon = lon;
    $('lat').value = lat.toFixed(4);
    $('lon').value = lon.toFixed(4);
    state.localInfo = null;
    state.offsetMin = Math.round(lon / 15) * 60;
    state.tzName = '경도 기준 추정';
    $('placeName').textContent = name || `${fmtCoord(lat, '북위', '남위')} ${fmtCoord(lon, '동경', '서경')}`;
    updateMeta();
    setTime(sky.time);
    updateMap(lat, lon, fromMap);
    state.baseProfile = null;
    state.buildingData = null;
    sky.setProfile(window.Terrain.syntheticProfile(lat, lon));
    sky.setBuildings(null);
    requestDraw();

    const token = ++state.loadToken;
    showStatus('지형 불러오는 중…');
    window.Terrain.loadHorizon(lat, lon, (f) => {
      if (token === state.loadToken) showStatus(`지형 불러오는 중… ${Math.round(f * 100)}%`);
    }).then((prof) => {
      if (token !== state.loadToken) return;
      state.baseProfile = prof;
      applyEyeHeight();
      state.elevation = prof.observerElevation;
      updateMeta();
      showStatus('실제 지형(수치표고모델)을 적용했습니다', 2500);
      requestDraw();
    }).catch(() => {
      if (token !== state.loadToken) return;
      state.elevation = null;
      showStatus('지형 자료를 받지 못해 가상 지형을 표시합니다 (오프라인?)', 4000);
    });

    window.Buildings.load(lat, lon).then((data) => {
      if (token !== state.loadToken) return;
      state.buildingData = data;
      applyEyeHeight();
      if (data.list.length) showStatus(`주변 건물 ${data.list.length.toLocaleString()}개를 반영했습니다 (OpenStreetMap)`, 3000);
    }).catch(() => {
      if (token === state.loadToken) showStatus('건물 자료를 받지 못했습니다 (OpenStreetMap 서버 응답 없음)', 3500);
    });

    window.Terrain.loadLocalInfo(lat, lon).then((info) => {
      if (token !== state.loadToken) return;
      state.localInfo = info;
      state.offsetMin = info.utcOffsetMin;
      state.tzName = info.timezone;
      applyCloud();
      setTime(sky.time);
      updateMeta();
    }).catch(() => {});

    if (!name) {
      window.Terrain.reverseGeocode(lat, lon).then((n) => {
        if (token === state.loadToken && n) $('placeName').textContent = n;
      }).catch(() => {});
    }
    scheduleUrlUpdate();
  }

  // 관측 높이(옥상·전망대 등)를 지형·건물 윤곽에 반영
  function applyEyeHeight() {
    const extra = Math.max(0, parseFloat($('eyeHeight').value) || 0);
    sky.eyeHeight = window.Terrain.EYE_HEIGHT_M + extra;
    if (state.baseProfile) sky.setProfile(window.Terrain.reprofile(state.baseProfile, extra));
    sky.setBuildings(state.buildingData ? window.Buildings.profile(state.buildingData, sky.eyeHeight) : null);
    requestDraw();
    scheduleUrlUpdate();
  }

  function fmtCoord(v, pos, neg) {
    return `${v >= 0 ? pos : neg} ${Math.abs(v).toFixed(2)}°`;
  }

  function updateMeta() {
    const parts = [`${fmtCoord(sky.lat, 'N', 'S').replace(' ', '')} ${fmtCoord(sky.lon, 'E', 'W').replace(' ', '')}`];
    if (state.elevation != null) parts.push(`해발 ${Math.round(state.elevation)} m`);
    const li = state.localInfo;
    if (li && li.cloudCover != null) parts.push(`현재 구름 ${li.cloudCover}%`);
    if (li && li.temperature != null) parts.push(`${li.temperature}°C`);
    $('placeMeta').textContent = parts.join(' · ');
    $('tzLabel').textContent = `(${state.tzName ? state.tzName + ', ' : ''}${formatOffset(state.offsetMin)})`;
  }

  function applyCloud() {
    const li = state.localInfo;
    sky.opts.cloud = $('useCloud').checked && li && li.cloudCover != null ? li.cloudCover / 100 : 0;
    requestDraw();
  }

  $('locForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const lat = parseFloat($('lat').value), lon = parseFloat($('lon').value);
    if (Number.isFinite(lat) && Number.isFinite(lon)) setLocation(lat, lon);
  });

  $('geoBtn').addEventListener('click', () => {
    if (!navigator.geolocation) return showStatus('이 브라우저는 위치 정보를 지원하지 않습니다', 3000);
    showStatus('현재 위치 확인 중…');
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocation(pos.coords.latitude, pos.coords.longitude),
      () => showStatus('위치 권한이 없거나 위치를 찾지 못했습니다', 3000),
      { enableHighAccuracy: true, timeout: 10000 });
  });

  const presetSel = $('presets');
  PRESETS.forEach(([name, lat, lon], i) => {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = name;
    presetSel.appendChild(o);
  });
  presetSel.addEventListener('change', () => {
    if (presetSel.value === '') return;
    const [name, lat, lon] = PRESETS[+presetSel.value];
    setLocation(lat, lon, { name });
    presetSel.value = '';
  });

  $('searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('searchQ').value.trim();
    const ul = $('searchResults');
    if (!q) return;
    ul.innerHTML = '<li>검색 중…</li>';
    window.Terrain.searchPlace(q).then((list) => {
      ul.innerHTML = '';
      if (!list.length) ul.innerHTML = '<li>결과가 없습니다</li>';
      for (const r of list) {
        const li = document.createElement('li');
        li.textContent = r.name;
        li.addEventListener('click', () => {
          ul.innerHTML = '';
          setLocation(r.lat, r.lon, { name: r.name.split(',').slice(0, 2).join(',') });
        });
        ul.appendChild(li);
      }
    }).catch(() => { ul.innerHTML = '<li>검색 서비스에 연결할 수 없습니다</li>'; });
  });

  // ---------- 지도 ----------
  let map = null, marker = null, wedge = null;
  function initMap() {
    if (!window.L) {
      $('map').innerHTML = '<div class="map-offline">지도를 불러올 수 없습니다</div>';
      return;
    }
    map = L.map('map', { zoomControl: true, attributionControl: true }).setView([sky.lat, sky.lon], 11);
    const layers = {
      sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 18, attribution: 'Esri, Maxar, Earthstar Geographics',
      }),
      osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap',
      }),
    };
    let current = layers.sat.addTo(map);
    document.querySelectorAll('input[name="basemap"]').forEach((r) => r.addEventListener('change', () => {
      map.removeLayer(current);
      current = layers[r.value].addTo(map);
    }));
    marker = L.circleMarker([sky.lat, sky.lon], { radius: 6, color: '#ffd37a', weight: 2, fillOpacity: 0.9 }).addTo(map);
    wedge = L.polygon([], { color: '#7fb0ff', weight: 1, fillOpacity: 0.18, interactive: false }).addTo(map);
    map.on('click', (e) => setLocation(e.latlng.lat, e.latlng.lng, { fromMap: true }));
  }

  function updateMap(lat, lon, fromMap) {
    if (!map) return;
    marker.setLatLng([lat, lon]);
    if (!fromMap) map.setView([lat, lon], Math.max(map.getZoom(), 10));
    updateWedge();
  }

  function updateWedge() {
    if (!map) return;
    const { az, fov } = sky.view;
    const half = Math.min(fov, 359) / 2;
    const R = 8; // km
    const pts = [[sky.lat, sky.lon]];
    for (let a = az - half; a <= az + half + 0.01; a += Math.max(2, half / 10)) {
      const d = R / 6371, t = a * A.DEG, p1 = sky.lat * A.DEG;
      const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
      const l2 = sky.lon * A.DEG + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
      pts.push([p2 / A.DEG, l2 / A.DEG]);
    }
    wedge.setLatLngs(sky.view.alt > 80 ? [] : pts);
  }

  // ---------- 보기 옵션 ----------
  document.querySelectorAll('[data-opt]').forEach((el) => {
    el.checked = !!sky.opts[el.dataset.opt];
    el.addEventListener('change', () => {
      sky.opts[el.dataset.opt] = el.checked;
      if (el.dataset.opt === 'terrain') sky.uploadHorizon();
      if (el.dataset.opt === 'buildings') sky.uploadBuildings();
      requestDraw();
    });
  });
  $('useCloud').addEventListener('change', applyCloud);
  $('eyeHeight').addEventListener('change', applyEyeHeight);
  const pollutionNames = ['아주 어두운 하늘', '시골', '교외', '도시 근교', '도심'];
  const updatePollution = () => {
    sky.opts.pollution = +$('pollution').value;
    $('pollutionLabel').textContent = '(' + pollutionNames[Math.min(4, Math.floor(sky.opts.pollution * 5))] + ')';
    requestDraw();
  };
  $('pollution').addEventListener('input', updatePollution);
  updatePollution();

  document.querySelectorAll('[data-look]').forEach((b) => b.addEventListener('click', () => {
    sky.view = { az: +b.dataset.look, alt: 25, fov: 100 };
    onViewChange();
  }));
  $('zenithBtn').addEventListener('click', () => {
    const span = Math.max(sky.cssW, sky.cssH), minDim = Math.min(sky.cssW, sky.cssH);
    sky.view = { az: 180, alt: 90, fov: Math.min(230, 4 * Math.atan(span / minDim * 1.02) / A.DEG) };
    onViewChange();
  });

  $('togglePanel').addEventListener('click', () => $('panel').classList.toggle('closed'));
  if (window.innerWidth < 640) $('panel').classList.add('closed');

  // ---------- 둘러보기 (드래그, 확대) ----------
  const skyEl = $('sky');
  const pointers = new Map();
  let dragStart = null, pinchStart = null, moved = false;

  function onViewChange() {
    const v = sky.view;
    v.alt = Math.max(-30, Math.min(90, v.alt));
    v.az = A.mod(v.az, 360);
    v.fov = Math.max(8, Math.min(230, v.fov));
    updateWedge();
    requestDraw();
    scheduleUrlUpdate();
  }

  skyEl.addEventListener('pointerdown', (e) => {
    skyEl.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    moved = false;
    if (pointers.size === 1) {
      dragStart = { x: e.clientX, y: e.clientY, view: Object.assign({}, sky.view) };
      skyEl.classList.add('dragging');
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), fov: sky.view.fov };
    }
  });
  skyEl.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      sky.view.fov = pinchStart.fov * pinchStart.d / Math.max(10, Math.hypot(a[0] - b[0], a[1] - b[1]));
      moved = true;
      onViewChange();
    } else if (pointers.size === 1 && dragStart) {
      const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      const k = sky.view.fov / Math.max(sky.cssW, sky.cssH);
      const flip = dragStart.view.alt > 89 ? -1 : 1;
      sky.view.az = dragStart.view.az - dx * k * flip;
      sky.view.alt = dragStart.view.alt + dy * k;
      onViewChange();
    }
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) {
      skyEl.classList.remove('dragging');
      if (!moved && dragStart) selectAt(e.clientX, e.clientY);
      dragStart = null;
    } else if (pointers.size === 1) {
      const [p] = [...pointers.values()];
      dragStart = { x: p[0], y: p[1], view: Object.assign({}, sky.view) };
    }
  };
  skyEl.addEventListener('pointerup', endPointer);
  skyEl.addEventListener('pointercancel', endPointer);
  skyEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    sky.view.fov *= Math.exp(e.deltaY * 0.0012);
    onViewChange();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    const step = sky.view.fov / 20;
    const keys = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (keys[e.key]) {
      sky.view.az += keys[e.key][0];
      sky.view.alt += keys[e.key][1];
    } else if (e.key === '+' || e.key === '=') sky.view.fov /= 1.15;
    else if (e.key === '-') sky.view.fov *= 1.15;
    else if (e.key === ' ') { $('playBtn').click(); e.preventDefault(); return; }
    else return;
    e.preventDefault();
    onViewChange();
  });

  window.addEventListener('resize', () => { sky.resize(); requestDraw(); });

  // ---------- 천체 정보 ----------
  function fmtRA(ra) {
    const h = ra / 15;
    return `${Math.floor(h)}h ${pad(Math.floor((h % 1) * 60))}m`;
  }
  function fmtDec(dec) {
    const a = Math.abs(dec);
    return `${dec < 0 ? '−' : '+'}${Math.floor(a)}° ${pad(Math.floor((a % 1) * 60))}′`;
  }
  function azName(az) {
    return ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'][Math.round(az / 22.5) % 16];
  }

  function selectAt(x, y) {
    const p = sky.pick(x, y);
    state.info = p;
    renderInfo();
    requestDraw();
  }

  function renderInfo() {
    const el = $('info');
    const p = state.info;
    if (!p) { el.hidden = true; return; }
    const { alt, az } = A.vecToAltAz(p.v);
    let title, sub = '', rows = [];
    if (p.type === 'star') {
      const st = p.obj;
      const con = st.name && st.name.c ? sky.conById[st.name.c] : sky.constellationAt(p.v);
      title = st.name ? st.name.ko : `HIP ${st.hip}`;
      sub = [st.name && st.name.en, con && `${st.name && st.name.b ? st.name.b + ' ' : ''}${con.ko}`].filter(Boolean).join(' · ');
      rows = [['밝기', `${st.mag.toFixed(2)} 등급`], ['적경/적위', `${fmtRA(st.ra)} / ${fmtDec(st.dec)}`]];
    } else if (p.type === 'planet') {
      title = p.obj.ko;
      sub = '행성';
      rows = [['밝기', `약 ${p.obj.mag.toFixed(1)} 등급`], ['지구로부터', `${p.obj.dist.toFixed(2)} AU`]];
    } else if (p.type === 'moon') {
      title = '달';
      sub = moonPhaseName(sky.eph);
      rows = [['밝은 면', `${Math.round(sky.eph.moonIllum * 100)}%`]];
    } else {
      title = '태양';
      sub = '맨눈이나 망원경으로 직접 보지 마세요';
    }
    rows.push(['고도', `${alt.toFixed(1)}°`], ['방위', `${az.toFixed(1)}° (${azName(az)})`]);
    el.innerHTML = `<h3></h3><div class="meta"></div><dl></dl>`;
    el.querySelector('h3').textContent = title;
    el.querySelector('.meta').textContent = sub;
    el.querySelector('dl').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    el.hidden = false;
  }

  function moonPhaseName(eph) {
    const k = eph.moonIllum;
    if (k < 0.03) return '삭 (달이 거의 보이지 않음)';
    if (k > 0.97) return '보름달';
    if (Math.abs(k - 0.5) < 0.06) return eph.waxing ? '상현달' : '하현달';
    if (k < 0.5) return eph.waxing ? '초승달' : '그믐달';
    return eph.waxing ? '차오르는 달' : '기우는 달';
  }

  function sunState(alt) {
    if (alt > 0) return '낮';
    if (alt > -6) return '시민 박명';
    if (alt > -12) return '항해 박명';
    if (alt > -18) return '천문 박명';
    return '밤';
  }

  function updateClock(eph) {
    const p = localParts(sky.time);
    const sunAlt = Math.asin(eph.sun[2]) / A.DEG;
    $('clock').innerHTML = `<b>${p.y}.${pad(p.mo)}.${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}</b>` +
      `<span class="meta">${sunState(sunAlt)} · 태양 ${sunAlt.toFixed(0)}° · ${moonPhaseName(eph)}</span>`;
  }

  // ---------- URL 공유 ----------
  let urlTimer = 0;
  function scheduleUrlUpdate() {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => {
      const q = new URLSearchParams({
        lat: sky.lat.toFixed(4), lon: sky.lon.toFixed(4), t: new Date(sky.time).toISOString().slice(0, 16) + 'Z',
        h: (+$('eyeHeight').value || 0).toFixed(0), az: sky.view.az.toFixed(0), alt: sky.view.alt.toFixed(0), fov: sky.view.fov.toFixed(0),
      });
      try { history.replaceState(null, '', '?' + q); } catch (e) { /* file:// 등 */ }
    }, 400);
  }

  // ---------- 그리기 루프 ----------
  function frame(now) {
    if (state.playing) {
      const dt = Math.min(0.1, (now - state.lastFrame) / 1000);
      setTime(sky.time + dt * +$('speed').value * 1000);
    }
    state.lastFrame = now;
    if (state.dirty) {
      state.dirty = false;
      const eph = sky.render();
      updateClock(eph);
      if (state.info) {
        state.info = sky.selected;
        renderInfo();
      }
    }
    requestAnimationFrame(frame);
  }

  // ---------- 시작 ----------
  const q = new URLSearchParams(location.search);
  const num = (k, d) => (q.has(k) && Number.isFinite(parseFloat(q.get(k))) ? parseFloat(q.get(k)) : d);
  const t0 = q.has('t') ? Date.parse(q.get('t')) : NaN;
  sky.time = Number.isFinite(t0) ? t0 : Date.now();
  sky.view = { az: num('az', 180), alt: num('alt', 25), fov: num('fov', 100) };
  $('eyeHeight').value = Math.max(0, num('h', 0));
  sky.eyeHeight = window.Terrain.EYE_HEIGHT_M + +$('eyeHeight').value;
  initMap();
  setLocation(num('lat', PRESETS[0][1]), num('lon', PRESETS[0][2]), { name: q.has('lat') ? null : PRESETS[0][0] });
  onViewChange();
  requestAnimationFrame(frame);
})();
