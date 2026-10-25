// 주변 건물로 지평선 윤곽을 만든다.
// 건물 자료: OpenStreetMap (Overpass API). 높이 태그가 없으면 층수 × 3.2 m, 그것도 없으면 기본 높이를 쓴다.
(function (root) {
  'use strict';

  const N_BINS = 1440; // 0.25° 간격 (건물 벽은 지형보다 각이 져서 촘촘하게)
  const NEAR_M = 700; // 이 거리 안의 건물은 모두
  const FAR_M = 6000; // 이 거리 안에서는 고층 건물만
  const EARTH_R_M = 6371000;
  const DEFAULT_HEIGHT = { house: 7, detached: 7, garage: 3, shed: 3, apartments: 30, commercial: 15, office: 25, church: 15 };
  const ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];
  const cache = new Map();

  function nearQuery(lat, lon) {
    const a = `(around:${NEAR_M},${lat},${lon})`;
    return `[out:json][timeout:40];(way["building"]${a};way["building:part"]${a};);out tags geom qt;`;
  }

  // 먼 곳은 높이·층수 태그가 있는 건물만 골라 서버 부담을 줄인다
  function farQuery(lat, lon) {
    const a = `(around:${FAR_M},${lat},${lon})`;
    return `[out:json][timeout:60];(
way["building"]["height"]${a}(if:number(t["height"])>=50);
way["building:part"]["height"]${a}(if:number(t["height"])>=50);
way["building"]["building:levels"]${a}(if:number(t["building:levels"])>=16);
);out tags geom qt;`;
  }

  function heightOf(tags) {
    const h = parseFloat(tags.height);
    if (Number.isFinite(h) && h > 0) return h;
    const lv = parseFloat(tags['building:levels']);
    if (Number.isFinite(lv) && lv > 0) return lv * 3.2 + 1;
    return DEFAULT_HEIGHT[tags.building] || 9;
  }

  async function runQuery(q, timeoutMs) {
    let lastErr = null;
    for (const url of ENDPOINTS) {
      try {
        const res = await root.Terrain.fetchWithTimeout(url, { method: 'POST', body: 'data=' + encodeURIComponent(q),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, timeoutMs);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        // 시간 초과 등은 HTTP 200에 remark로만 알려 준다
        if (json.remark && /error|timed out|out of memory/i.test(json.remark)) throw new Error(json.remark);
        return json.elements || [];
      } catch (e) {
        lastErr = e.name === 'AbortError' ? new Error('응답 시간 초과') : e;
      }
    }
    throw lastErr || new Error('no endpoint');
  }

  // onUpdate(data)는 가까운 건물이 도착했을 때, 먼 고층 건물까지 도착했을 때 각각 불린다.
  // 반환 promise는 두 요청이 모두 끝나면 최종 data로 풀리고, 둘 다 실패하면 거부된다.
  async function load(lat, lon, onUpdate) {
    const key = lat.toFixed(4) + ',' + lon.toFixed(4);
    if (cache.has(key)) {
      if (onUpdate) onUpdate(cache.get(key));
      return cache.get(key);
    }
    const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
    const seen = new Set();
    const data = { list: [], nearOk: null, farOk: null, done: false };
    const add = (elements) => {
      for (const el of elements) {
        if (seen.has(el.id) || !el.geometry || el.geometry.length < 3) continue;
        seen.add(el.id);
        const pts = el.geometry.map((g) => [(g.lon - lon) * kx, (g.lat - lat) * ky]);
        data.list.push({ pts, h: heightOf(el.tags || {}) });
      }
    };
    const part = (q, ms, flag) => runQuery(q, ms).then((els) => {
      add(els);
      data[flag] = true;
      if (onUpdate) onUpdate(data);
    }, (e) => {
      data[flag] = false;
      throw e;
    });
    const [near, far] = await Promise.allSettled([part(nearQuery(lat, lon), 30000, 'nearOk'), part(farQuery(lat, lon), 70000, 'farOk')]);
    data.done = true;
    if (near.status === 'rejected' && far.status === 'rejected') throw near.reason;
    if (data.nearOk && data.farOk) cache.set(key, data);
    return data;
  }

  function containsOrigin(pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > 0) !== (yj > 0) && 0 < ((xj - xi) * -yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // 지형 고도 자료로 (방위, 거리) 지점의 땅 높이를 관측 지점 대비로 추정한다.
  // 고도 자료가 성겨서(수십~수백 m) 앞뒤 표본 중 낮은 쪽을 써 건물이 떠 보이지 않게 한다.
  function groundFn(terrain) {
    if (!terrain || !terrain.grid) return () => 0;
    const dist = terrain.distKm;
    const grid = terrain.grid;
    const h0 = terrain.observerElevation;
    const nAz = grid.length;
    return (az, dKm) => {
      const row = grid[Math.round((az / 360) * nAz) % nAz];
      if (dKm <= dist[0]) return 0;
      let k = 0;
      while (k < dist.length - 2 && dist[k + 1] < dKm) k++;
      const a = row[k], b = row[k + 1];
      const g = a == null ? b : b == null ? a : Math.min(a, b);
      return g == null ? 0 : g - h0;
    };
  }

  // eye: 관측자 눈높이 (지면 기준 m). terrain: 지형 윤곽 결과(있으면 건물 밑동 높이에 반영).
  // 결과: 방위 칸마다 건물 꼭대기 고도각(°)과 거리(km)
  function profile(data, eye, terrain) {
    const top = new Float32Array(N_BINS).fill(-90);
    const dist = new Float32Array(N_BINS).fill(10);
    const binDeg = 360 / N_BINS;
    const ground = groundFn(terrain);
    for (const b of data.list) {
      if (containsOrigin(b.pts)) continue; // 관측자가 서 있는 건물은 제외
      const pts = b.pts;
      let cx = 0, cy = 0;
      for (const p of pts) { cx += p[0]; cy += p[1]; }
      cx /= pts.length; cy /= pts.length;
      const cd = Math.hypot(cx, cy);
      const base = ground(((Math.atan2(cx, cy) * 180) / Math.PI + 360) % 360, cd / 1000);
      const rel = base + b.h - eye;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        const az1 = Math.atan2(p[0], p[1]) / (Math.PI / 180);
        const az2 = Math.atan2(q[0], q[1]) / (Math.PI / 180);
        const span = Math.abs(((az2 - az1 + 540) % 360) - 180);
        const n = Math.min(2000, Math.ceil(span / (binDeg * 0.8)) + 1);
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          const x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t;
          const d = Math.max(Math.hypot(x, y), 3);
          const drop = (d * d) / (2 * EARTH_R_M) * 0.87; // 지구 곡률 (대기 굴절 보정 포함)
          const ang = (Math.atan2(rel - drop, d) * 180) / Math.PI;
          const az = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
          const bin = Math.floor(az / binDeg) % N_BINS;
          if (ang > top[bin]) { top[bin] = ang; dist[bin] = d / 1000; }
        }
      }
    }
    return { top, dist, count: data.list.length };
  }

  root.Buildings = { N_BINS, load, profile };
})(window);
