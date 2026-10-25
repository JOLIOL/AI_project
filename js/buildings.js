// 주변 건물로 지평선 윤곽을 만든다.
// 건물 자료 (모두 OpenStreetMap):
//  - 가까운 건물: OpenFreeMap 벡터 타일(CDN, render_height 포함). 실패하면 Overpass API로 대신 받는다.
//  - 먼 고층 건물: Overpass API (높이 50 m 이상 또는 16층 이상만)
(function (root) {
  'use strict';

  const N_BINS = 1440; // 0.25° 간격 (건물 벽은 지형보다 각이 져서 촘촘하게)
  const TILE_RADIUS_M = 1500; // 벡터 타일로 받는 범위
  const NEAR_M = 700; // Overpass 대체 요청 범위
  const FAR_M = 6000; // 이 거리 안에서는 고층 건물만
  const TILE_ZOOM = 14;
  const EARTH_R_M = 6371000;
  const DEFAULT_HEIGHT = { house: 7, detached: 7, garage: 3, shed: 3, apartments: 30, commercial: 15, office: 25, church: 15 };
  const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
  const ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];
  const cache = new Map();
  const fetchT = (url, opts, ms) => root.Terrain.fetchWithTimeout(url, opts, ms);

  // ---------- Mapbox Vector Tile 해석 (건물 레이어만) ----------
  function pbfReader(buf) {
    let pos = 0;
    const r = {
      get eof() { return pos >= buf.length; },
      get pos() { return pos; },
      advance(n) { pos += n; },
      varint() {
        let v = 0, shift = 0, b;
        do { b = buf[pos++]; v += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
        return v;
      },
      bytes() { const n = r.varint(); const out = buf.subarray(pos, pos + n); pos += n; return out; },
      skip(wire) {
        if (wire === 0) r.varint();
        else if (wire === 1) pos += 8;
        else if (wire === 2) pos += r.varint();
        else if (wire === 5) pos += 4;
        else throw new Error('pbf wire type ' + wire);
      },
      fields(fn) {
        while (pos < buf.length) { const key = r.varint(); fn(key >> 3, key & 7); }
      },
    };
    return r;
  }
  const utf8 = new TextDecoder();
  const packed = (bytes) => { const r = pbfReader(bytes), out = []; while (!r.eof) out.push(r.varint()); return out; };
  const zigzag = (n) => (n % 2 ? -(n + 1) / 2 : n / 2);

  function decodeValue(bytes) {
    const r = pbfReader(bytes);
    let v = null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    r.fields((f, w) => {
      if (f === 1) v = utf8.decode(r.bytes());
      else if (f === 2) { v = dv.getFloat32(r.pos, true); r.advance(4); }
      else if (f === 3) { v = dv.getFloat64(r.pos, true); r.advance(8); }
      else if (f === 4 || f === 5) v = r.varint();
      else if (f === 6) v = zigzag(r.varint());
      else if (f === 7) v = !!r.varint();
      else r.skip(w);
    });
    return v;
  }

  // 반환: [{ rings: [[[x, y], ...]], props }] (x, y는 타일 안 좌표 0..extent)
  function decodeBuildingLayer(buf) {
    const tile = pbfReader(buf);
    const out = [];
    tile.fields((f, w) => {
      if (f !== 3) return tile.skip(w);
      const layer = pbfReader(tile.bytes());
      let name = '', extent = 4096;
      const keys = [], values = [], feats = [];
      layer.fields((lf, lw) => {
        if (lf === 1) name = utf8.decode(layer.bytes());
        else if (lf === 2) feats.push(layer.bytes());
        else if (lf === 3) keys.push(utf8.decode(layer.bytes()));
        else if (lf === 4) values.push(layer.bytes());
        else if (lf === 5) extent = layer.varint();
        else layer.skip(lw);
      });
      if (name !== 'building') return;
      const vals = values.map(decodeValue);
      for (const fb of feats) {
        const fr = pbfReader(fb);
        let type = 0, tags = [], geom = [];
        fr.fields((ff, fw) => {
          if (ff === 2) tags = packed(fr.bytes());
          else if (ff === 3) type = fr.varint();
          else if (ff === 4) geom = packed(fr.bytes());
          else fr.skip(fw);
        });
        if (type !== 3) continue; // 다각형만
        const props = {};
        for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = vals[tags[i + 1]];
        const rings = [];
        let x = 0, y = 0, ring = null;
        for (let i = 0; i < geom.length;) {
          const cmd = geom[i] & 7, count = geom[i] >> 3;
          i++;
          if (cmd === 1 || cmd === 2) {
            for (let k = 0; k < count; k++) {
              x += zigzag(geom[i++]);
              y += zigzag(geom[i++]);
              if (cmd === 1) { ring = []; rings.push(ring); }
              ring.push([x / extent, y / extent]);
            }
          }
        }
        out.push({ rings: rings.filter((rg) => rg.length >= 3), props });
      }
    });
    return out;
  }

  let tileUrlPromise = null;
  function tileUrlTemplate() {
    if (!tileUrlPromise) {
      tileUrlPromise = fetchT(TILEJSON_URL, {}, 15000)
        .then((res) => { if (!res.ok) throw new Error('타일 목록 HTTP ' + res.status); return res.json(); })
        .then((j) => j.tiles[0]);
      tileUrlPromise.catch(() => { tileUrlPromise = null; });
    }
    return tileUrlPromise;
  }

  async function fetchTileBytes(url) {
    const res = await fetchT(url, {}, 20000);
    if (res.status === 204 || res.status === 404) return null; // 빈 타일
    if (!res.ok) throw new Error('건물 타일 HTTP ' + res.status);
    let buf = new Uint8Array(await res.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b && typeof DecompressionStream !== 'undefined') {
      const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
      buf = new Uint8Array(await new Response(ds).arrayBuffer());
    }
    return buf;
  }

  async function loadFromTiles(lat, lon) {
    const tpl = await tileUrlTemplate();
    const z = TILE_ZOOM, n = 2 ** z;
    const toTile = (la, lo) => {
      const r = (la * Math.PI) / 180;
      return [((lo + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
    };
    const dLat = TILE_RADIUS_M / 110540, dLon = TILE_RADIUS_M / (111320 * Math.cos((lat * Math.PI) / 180));
    const [x0, y0] = toTile(lat + dLat, lon - dLon).map(Math.floor);
    const [x1, y1] = toTile(lat - dLat, lon + dLon).map(Math.floor);
    const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
    const jobs = [];
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        jobs.push(fetchTileBytes(tpl.replace('{z}', z).replace('{x}', tx).replace('{y}', ty)).then((buf) => {
          if (!buf) return [];
          const out = [];
          for (const f of decodeBuildingLayer(buf)) {
            if (f.props.hide_3d) continue;
            const h = Number(f.props.render_height) || 5;
            for (const ring of f.rings) {
              const pts = ring.map(([fx, fy]) => {
                const lo = ((tx + fx) / n) * 360 - 180;
                const la = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + fy)) / n))) * 180) / Math.PI;
                return [(lo - lon) * kx, (la - lat) * ky];
              });
              out.push({ pts, h });
            }
          }
          return out;
        }));
      }
    }
    return (await Promise.all(jobs)).flat();
  }

  // ---------- Overpass ----------
  function nearQuery(lat, lon) {
    const a = `(around:${NEAR_M},${lat},${lon})`;
    return `[out:json][timeout:25];(way["building"]${a};way["building:part"]${a};);out tags geom qt;`;
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
        const res = await fetchT(url, { method: 'POST', body: 'data=' + encodeURIComponent(q),
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

  function overpassToList(elements, lat, lon) {
    const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
    return elements.filter((el) => el.geometry && el.geometry.length >= 3).map((el) => ({
      pts: el.geometry.map((g) => [(g.lon - lon) * kx, (g.lat - lat) * ky]),
      h: heightOf(el.tags || {}),
    }));
  }

  // onUpdate(data)는 가까운 건물이 도착했을 때, 먼 고층 건물까지 도착했을 때 각각 불린다.
  // 반환 promise는 두 요청이 모두 끝나면 최종 data로 풀리고, 둘 다 실패하면 거부된다.
  async function load(lat, lon, onUpdate) {
    const key = lat.toFixed(4) + ',' + lon.toFixed(4);
    if (cache.has(key)) {
      if (onUpdate) onUpdate(cache.get(key));
      return cache.get(key);
    }
    const data = { list: [], nearOk: null, farOk: null, done: false, errors: [] };
    const nearTask = loadFromTiles(lat, lon).catch((e) => {
      data.errors.push('타일: ' + e.message);
      return runQuery(nearQuery(lat, lon), 30000).then((els) => overpassToList(els, lat, lon));
    }).then((list) => {
      data.list.push(...list);
      data.nearOk = true;
      if (onUpdate) onUpdate(data);
    }, (e) => {
      data.nearOk = false;
      data.errors.push('가까운 건물: ' + e.message);
      throw e;
    });
    const farTask = runQuery(farQuery(lat, lon), 40000).then((els) => {
      const seen = new Set();
      // 가까운 범위는 이미 타일로 받았으므로 먼 건물만 더한다
      for (const b of overpassToList(els, lat, lon)) {
        const c = b.pts[0];
        if (Math.hypot(c[0], c[1]) < TILE_RADIUS_M * 0.9 && data.nearOk) continue;
        const k = c[0].toFixed(0) + ',' + c[1].toFixed(0);
        if (!seen.has(k)) { seen.add(k); data.list.push(b); }
      }
      data.farOk = true;
      if (onUpdate) onUpdate(data);
    }, (e) => {
      data.farOk = false;
      data.errors.push('먼 고층 건물: ' + e.message);
      throw e;
    });
    const [near, far] = await Promise.allSettled([nearTask, farTask]);
    data.done = true;
    if (near.status === 'rejected' && far.status === 'rejected') throw new Error(data.errors.join(' / '));
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

  root.Buildings = { N_BINS, load, profile, decodeBuildingLayer };
})(window);
