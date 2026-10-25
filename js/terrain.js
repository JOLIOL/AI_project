// 관측 지점 주변 지형으로 지평선 윤곽(산 능선)을 만든다.
// 고도 자료: Open-Meteo Elevation API (Copernicus DEM 90 m). 실패하면 위치 기반 가상 지형을 쓴다.
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

  async function fetchElevations(points, onProgress) {
    const out = new Array(points.length);
    const chunks = [];
    for (let i = 0; i < points.length; i += 100) chunks.push(i);
    let done = 0;
    const worker = async () => {
      while (chunks.length) {
        const start = chunks.shift();
        const part = points.slice(start, start + 100);
        const url = 'https://api.open-meteo.com/v1/elevation?latitude=' +
          part.map((p) => p[0].toFixed(5)).join(',') + '&longitude=' + part.map((p) => p[1].toFixed(5)).join(',');
        const res = await fetch(url);
        if (!res.ok) throw new Error('elevation HTTP ' + res.status);
        const json = await res.json();
        json.elevation.forEach((e, k) => { out[start + k] = e; });
        done++;
        if (onProgress) onProgress(done / Math.ceil(points.length / 100));
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return out;
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

  function buildProfile(h0, grid) {
    const prof = emptyProfile();
    prof.observerElevation = h0;
    const eye = h0 + EYE_HEIGHT_M;
    // 가장 낮은 지평선은 수평선의 강하각(dip)
    const dip = -Math.sqrt((2 * Math.max(eye, 1)) / (EARTH_R * 1000 / (1 - REFRACTION_K))) * 180 / Math.PI;
    for (let a = 0; a < N_AZ; a++) {
      let far = dip, mid = -90, near = -90, water = 0, count = 0;
      for (let k = 0; k < DIST_KM.length; k++) {
        const h = grid[a][k];
        if (h == null || Number.isNaN(h)) continue;
        const ang = elevationAngle(eye, h, DIST_KM[k]);
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
    const elev = await fetchElevations(points, onProgress);
    const grid = [];
    for (let a = 0; a < N_AZ; a++) grid.push(elev.slice(1 + a * DIST_KM.length, 1 + (a + 1) * DIST_KM.length));
    const prof = buildProfile(elev[0] || 0, grid);
    prof.source = 'dem';
    cache.set(key, prof);
    return prof;
  }

  // 지역 시간대, 구름양 (Open-Meteo Forecast API)
  async function loadLocalInfo(lat, lon) {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) +
      '&timezone=auto&current=cloud_cover,temperature_2m,is_day';
    const res = await fetch(url);
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
    const res = await fetch(url);
    if (!res.ok) throw new Error('geocode HTTP ' + res.status);
    const j = await res.json();
    if (j.error) return null;
    const a = j.address || {};
    const parts = [a.city || a.town || a.village || a.county || a.state_district, a.state, a.country].filter(Boolean);
    return [...new Set(parts)].join(', ') || j.display_name;
  }

  async function searchPlace(query) {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=ko&q=' + encodeURIComponent(query);
    const res = await fetch(url);
    if (!res.ok) throw new Error('search HTTP ' + res.status);
    return (await res.json()).map((r) => ({ name: r.display_name, lat: +r.lat, lon: +r.lon }));
  }

  root.Terrain = { N_AZ, loadHorizon, syntheticProfile, emptyProfile, loadLocalInfo, reverseGeocode, searchPlace };
})(window);
