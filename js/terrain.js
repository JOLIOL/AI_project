// 관측 지점 주변 지형으로 지평선 윤곽(산 능선)을 만든다.
// 고도 자료: AWS Terrain Tiles (SRTM 등, terrarium PNG). 실패하면 위치 기반 가상 지형을 쓴다.
(function (root) {
  'use strict';

  const N_AZ = 180; // 2° 간격
  const DIST_KM = [0.25, 0.5, 0.8, 1.2, 1.8, 2.6, 3.6, 5, 7, 9.5, 13, 17, 22, 29, 38, 50];
  const NEAR_KM = 1.5;
  const MID_KM = 8;
  const EARTH_R = 6371;
  const REFRACTION_K = 0.13;
  const EYE_HEIGHT_M = 1.7;
  const cache = new Map();

  function destination(lat, lon, azDeg, distKm) {
    const d = distKm / EARTH_R;
    const t = (azDeg * Math.PI) / 180;
    const p1 = (lat * Math.PI) / 180;
    const l1 = (lon * Math.PI) / 180;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
    const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [(p2 * 180) / Math.PI, ((((l2 * 180) / Math.PI + 540) % 360) - 180)];
  }

  // 고도 타일 (AWS Terrain Tiles, terrarium 형식: 고도 = R·256 + G + B/256 − 32768 m).
  // 가까운 곳은 촘촘한 줌, 먼 곳은 성긴 줌의 타일에서 값을 읽는다. 호출 횟수 제한이 없다.
  const TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  const NEAR_ZOOM = 12;
  const FAR_ZOOM = 9;
  const NEAR_ZOOM_KM = 5;
  const tileCache = new Map();

  function tileXY(lat, lon, z) {
    const n = 2 ** z;
    const r = (lat * Math.PI) / 180;
    return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
  }

  async function fetchTile(z, x, y) {
    const n = 2 ** z;
    const key = `${z}/${((x % n) + n) % n}/${y}`;
    if (!tileCache.has(key)) {
      tileCache.set(key, (async () => {
        const res = await fetchWithTimeout(TILE_URL.replace('{z}/{x}/{y}', key), {}, 20000);
        if (!res.ok) throw new Error('고도 타일 HTTP ' + res.status);
        const bmp = await createImageBitmap(await res.blob());
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(bmp, 0, 0);
        const px = g.getImageData(0, 0, c.width, c.height).data;
        const elev = new Float32Array(c.width * c.height);
        for (let i = 0; i < elev.length; i++) elev[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
        return { size: c.width, elev };
      })());
      tileCache.get(key).catch(() => tileCache.delete(key));
    }
    return tileCache.get(key);
  }

  async function fetchElevations(points, zooms, onProgress) {
    const need = new Map();
    const coords = points.map(([lat, lon], i) => {
      const z = zooms[i];
      const [tx, ty] = tileXY(lat, lon, z);
      const key = `${z}/${Math.floor(tx)}/${Math.floor(ty)}`;
      need.set(key, [z, Math.floor(tx), Math.floor(ty)]);
      return [z, tx, ty];
    });
    let done = 0;
    const tiles = new Map();
    await Promise.all([...need].map(async ([key, [z, x, y]]) => {
      tiles.set(key, await fetchTile(z, x, y));
      done++;
      if (onProgress) onProgress(done / need.size);
    }));
    return coords.map(([z, tx, ty]) => {
      const t = tiles.get(`${z}/${Math.floor(tx)}/${Math.floor(ty)}`);
      const s = t.size;
      const fx = Math.min(s - 1.001, Math.max(0, (tx - Math.floor(tx)) * s - 0.5));
      const fy = Math.min(s - 1.001, Math.max(0, (ty - Math.floor(ty)) * s - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), u = fx - x0, v = fy - y0;
      const e = (x, y) => t.elev[y * s + x];
      return (e(x0, y0) * (1 - u) + e(x0 + 1, y0) * u) * (1 - v) + (e(x0, y0 + 1) * (1 - u) + e(x0 + 1, y0 + 1) * u) * v;
    });
  }

  function fetchWithTimeout(url, opts, ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    return fetch(url, Object.assign({}, opts, { signal: ctl.signal })).finally(() => clearTimeout(timer));
  }

  function elevationAngle(h0, h, distKm) {
    const drop = ((distKm * distKm) / (2 * EARTH_R)) * (1 - REFRACTION_K) * 1000;
    return (Math.atan2(h - h0 - drop, distKm * 1000) * 180) / Math.PI;
  }

  function emptyProfile() {
    return {
      far: new Float32Array(N_AZ), mid: new Float32Array(N_AZ), near: new Float32Array(N_AZ),
      water: new Float32Array(N_AZ), observerElevation: 0, source: 'flat',
    };
  }

  // extra: 지면보다 높은 곳(옥상, 전망대)에서 볼 때 추가 높이 (m)
  function buildProfile(h0, grid, extra = 0) {
    const prof = emptyProfile();
    prof.observerElevation = h0;
    prof.grid = grid;
    prof.distKm = DIST_KM;
    const eye = h0 + EYE_HEIGHT_M + extra;
    // 가장 낮은 지평선은 수평선의 강하각(dip)
    const dip = -Math.sqrt((2 * Math.max(eye, 1)) / (EARTH_R * 1000 / (1 - REFRACTION_K))) * 180 / Math.PI;
    for (let a = 0; a < N_AZ; a++) {
      let far = dip, mid = -90, near = -90, water = 0, count = 0;
      for (let k = 0; k < DIST_KM.length; k++) {
        const h = grid[a][k];
        if (h == null || Number.isNaN(h)) continue;
        const ang = elevationAngle(eye, Math.max(h, 0), DIST_KM[k]); // 바다(음수 수심)는 수면 0 m
        far = Math.max(far, ang);
        if (DIST_KM[k] <= MID_KM) mid = Math.max(mid, ang);
        if (DIST_KM[k] <= NEAR_KM) near = Math.max(near, ang);
        if (DIST_KM[k] >= 0.5) { count++; if (h <= 0.5) water++; }
      }
      prof.far[a] = far;
      prof.mid[a] = Math.max(mid, dip);
      prof.near[a] = Math.max(near, dip);
      prof.water[a] = count ? water / count : 0;
    }
    return prof;
  }

  // 결정적 의사 난수 잡음으로 만든 가상 산 능선
  function syntheticProfile(lat, lon) {
    let seed = Math.floor((lat + 90) * 1000) * 7919 + Math.floor((lon + 180) * 1000);
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const waves = [];
    for (let i = 0; i < 7; i++) waves.push({ f: 1 + Math.floor(rand() * (3 + i * 4)), p: rand() * Math.PI * 2, a: 1.6 / (i + 1) });
    const prof = emptyProfile();
    prof.source = 'synthetic';
    for (let a = 0; a < N_AZ; a++) {
      const t = (a / N_AZ) * Math.PI * 2;
      let h = 0;
      for (const w of waves) h += w.a * Math.sin(w.f * t + w.p);
      prof.far[a] = Math.max(0.3, 1.8 + h);
      prof.mid[a] = Math.max(0.1, 0.9 + h * 0.6 + 0.6 * Math.sin(5 * t + waves[0].p));
      prof.near[a] = Math.max(-0.2, 0.2 + 0.5 * Math.sin(9 * t + waves[1].p) * Math.sin(3 * t));
    }
    return prof;
  }

  async function loadHorizon(lat, lon, onProgress) {
    const key = lat.toFixed(4) + ',' + lon.toFixed(4);
    if (cache.has(key)) return cache.get(key);
    const points = [[lat, lon]];
    for (let a = 0; a < N_AZ; a++) {
      for (const d of DIST_KM) points.push(destination(lat, lon, (a * 360) / N_AZ, d));
    }
    const zooms = [NEAR_ZOOM];
    for (let a = 0; a < N_AZ; a++) for (const d of DIST_KM) zooms.push(d <= NEAR_ZOOM_KM ? NEAR_ZOOM : FAR_ZOOM);
    const elev = await fetchElevations(points, zooms, onProgress);
    const grid = [];
    for (let a = 0; a < N_AZ; a++) grid.push(elev.slice(1 + a * DIST_KM.length, 1 + (a + 1) * DIST_KM.length));
    const prof = buildProfile(Math.max(elev[0] || 0, 0), grid);
    prof.source = 'dem';
    cache.set(key, prof);
    return prof;
  }

  // 관측 높이만 바꿔 같은 고도 자료로 다시 계산
  function reprofile(prof, extra) {
    if (!prof.grid) return prof;
    const p = buildProfile(prof.observerElevation, prof.grid, extra);
    p.source = prof.source;
    return p;
  }

  // 지역 시간대, 구름양 (Open-Meteo Forecast API)
  async function loadLocalInfo(lat, lon) {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) +
      '&timezone=auto&current=cloud_cover,temperature_2m,is_day';
    const res = await fetchWithTimeout(url, {}, 15000);
    if (!res.ok) throw new Error('forecast HTTP ' + res.status);
    const j = await res.json();
    return {
      timezone: j.timezone, tzAbbr: j.timezone_abbreviation, utcOffsetMin: Math.round(j.utc_offset_seconds / 60),
      cloudCover: j.current ? j.current.cloud_cover : null, temperature: j.current ? j.current.temperature_2m : null,
    };
  }

  // 지명 (OpenStreetMap Nominatim)
  async function reverseGeocode(lat, lon) {
    const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=ko&lat=' + lat + '&lon=' + lon;
    const res = await fetchWithTimeout(url, {}, 15000);
    if (!res.ok) throw new Error('geocode HTTP ' + res.status);
    const j = await res.json();
    if (j.error) return null;
    const a = j.address || {};
    const parts = [a.city || a.town || a.village || a.county || a.state_district, a.state, a.country].filter(Boolean);
    return [...new Set(parts)].join(', ') || j.display_name;
  }

  async function searchPlace(query) {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=ko&q=' + encodeURIComponent(query);
    const res = await fetchWithTimeout(url, {}, 15000);
    if (!res.ok) throw new Error('search HTTP ' + res.status);
    return (await res.json()).map((r) => ({ name: r.display_name, lat: +r.lat, lon: +r.lon }));
  }

  root.Terrain = { N_AZ, fetchWithTimeout, EYE_HEIGHT_M, loadHorizon, reprofile, syntheticProfile, emptyProfile, loadLocalInfo, reverseGeocode, searchPlace };
})(window);
