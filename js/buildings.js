// 주변 건물로 지평선 윤곽을 만든다.
// 건물 자료: OpenStreetMap (Overpass API). 높이 태그가 없으면 층수 × 3.2 m, 그것도 없으면 기본 높이를 쓴다.
(function (root) {
  'use strict';

  const N_BINS = 1440; // 0.25° 간격 (건물 벽은 지형보다 각이 져서 촘촘하게)
  const NEAR_M = 700; // 이 거리 안의 건물은 모두
  const FAR_M = 6000; // 이 거리 안에서는 고층 건물만
  const DEFAULT_HEIGHT = { house: 7, detached: 7, garage: 3, shed: 3, apartments: 30, commercial: 15, office: 25, church: 15 };
  const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  const cache = new Map();

  function query(lat, lon) {
    const near = `(around:${NEAR_M},${lat},${lon})`;
    const far = `(around:${FAR_M},${lat},${lon})`;
    return `[out:json][timeout:25];(
way["building"]${near};
way["building:part"]${near};
way["building"]["height"]${far}(if:number(t["height"])>=50);
way["building:part"]["height"]${far}(if:number(t["height"])>=50);
way["building"]["building:levels"]${far}(if:number(t["building:levels"])>=16);
);out tags geom qt;`;
  }

  function heightOf(tags) {
    const h = parseFloat(tags.height);
    if (Number.isFinite(h) && h > 0) return h;
    const lv = parseFloat(tags['building:levels']);
    if (Number.isFinite(lv) && lv > 0) return lv * 3.2 + 1;
    return DEFAULT_HEIGHT[tags.building] || 9;
  }

  async function load(lat, lon) {
    const key = lat.toFixed(4) + ',' + lon.toFixed(4);
    if (cache.has(key)) return cache.get(key);
    let json = null, lastErr = null;
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query(lat, lon)),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        if (!res.ok) throw new Error('overpass HTTP ' + res.status);
        json = await res.json();
        break;
      } catch (e) { lastErr = e; }
    }
    if (!json) throw lastErr;
    const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
    const list = [];
    for (const el of json.elements || []) {
      if (!el.geometry || el.geometry.length < 3) continue;
      const pts = el.geometry.map((g) => [(g.lon - lon) * kx, (g.lat - lat) * ky]);
      list.push({ pts, h: heightOf(el.tags || {}) });
    }
    const data = { list };
    cache.set(key, data);
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

  // eye: 관측자 눈높이 (지면 기준 m). 결과: 방위 칸마다 건물 꼭대기 고도각(°)과 거리(km)
  function profile(data, eye) {
    const top = new Float32Array(N_BINS).fill(-90);
    const dist = new Float32Array(N_BINS).fill(10);
    const binDeg = 360 / N_BINS;
    for (const b of data.list) {
      if (containsOrigin(b.pts)) continue; // 관측자가 서 있는 건물은 제외
      const pts = b.pts;
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
          const ang = (Math.atan2(b.h - eye, d) * 180) / Math.PI;
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
