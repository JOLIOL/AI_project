// 천문 계산: 항성시, 세차, 적도→지평 좌표 변환, 태양·달·행성의 근사 위치.
// 정확도 목표는 맨눈 관측 수준(별 ≲ 1′, 달 ≲ 0.3°, 행성 ≲ 0.1°).
(function (root) {
  'use strict';

  const DEG = Math.PI / 180;
  const J2000 = 2451545.0;

  const mod = (x, m) => ((x % m) + m) % m;
  const sind = (d) => Math.sin(d * DEG);
  const cosd = (d) => Math.cos(d * DEG);

  function julianDate(date) {
    return date.getTime() / 86400000 + 2440587.5;
  }

  // 그리니치 평균 항성시 (도)
  function gmst(jd) {
    const d = jd - J2000;
    const T = d / 36525;
    return mod(280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - (T * T * T) / 38710000, 360);
  }

  function obliquity(jd) {
    const T = (jd - J2000) / 36525;
    return 23.439291 - 0.0130042 * T;
  }

  function raDecToVec(ra, dec) {
    const cd = cosd(dec);
    return [cd * cosd(ra), cd * sind(ra), sind(dec)];
  }

  function vecToRaDec(v) {
    return { ra: mod(Math.atan2(v[1], v[0]) / DEG, 360), dec: Math.asin(Math.max(-1, Math.min(1, v[2]))) / DEG };
  }

  function mulMat(a, b) {
    const r = [];
    for (let i = 0; i < 3; i++) {
      r.push([0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));
    }
    return r;
  }

  function mulVec(m, v) {
    return [
      m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
      m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
      m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ];
  }

  // J2000 → 해당 시점 평균 적도 좌표 세차 행렬 (IAU 1976)
  function precessionMatrix(jd) {
    const T = (jd - J2000) / 36525;
    const as = DEG / 3600;
    const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * as;
    const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * as;
    const th = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * as;
    const cz = Math.cos(zeta), sz = Math.sin(zeta);
    const cZ = Math.cos(z), sZ = Math.sin(z);
    const ct = Math.cos(th), st = Math.sin(th);
    return [
      [cZ * ct * cz - sZ * sz, -cZ * ct * sz - sZ * cz, -cZ * st],
      [sZ * ct * cz + cZ * sz, -sZ * ct * sz + cZ * cz, -sZ * st],
      [st * cz, -st * sz, ct],
    ];
  }

  // 적도(해당 시점) 벡터 → 지평 벡터 [동, 북, 천정]
  function horizonMatrix(lstDeg, latDeg) {
    const sL = sind(lstDeg), cL = cosd(lstDeg);
    const sp = sind(latDeg), cp = cosd(latDeg);
    return [
      [-sL, cL, 0],
      [-sp * cL, -sp * sL, cp],
      [cp * cL, cp * sL, sp],
    ];
  }

  function vecToAltAz(v) {
    return {
      alt: Math.asin(Math.max(-1, Math.min(1, v[2]))) / DEG,
      az: mod(Math.atan2(v[0], v[1]) / DEG, 360),
    };
  }

  function altAzToVec(alt, az) {
    const ca = cosd(alt);
    return [ca * sind(az), ca * cosd(az), sind(alt)];
  }

  // 대기 굴절 (Bennett): 참 고도 → 겉보기 고도
  function refract(alt) {
    if (alt < -2) return alt;
    const h = Math.max(alt, -1.9);
    return alt + 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * DEG) / 60;
  }

  // 태양 (해당 시점 적도 좌표, 저정밀)
  function sunEquatorial(jd) {
    const n = jd - J2000;
    const L = 280.46 + 0.9856474 * n;
    const g = 357.528 + 0.9856003 * n;
    const lam = L + 1.915 * sind(g) + 0.02 * sind(2 * g);
    const eps = obliquity(jd);
    return {
      ra: mod(Math.atan2(cosd(eps) * sind(lam), cosd(lam)) / DEG, 360),
      dec: Math.asin(sind(eps) * sind(lam)) / DEG,
      lon: mod(lam, 360),
    };
  }

  // 달 (Astronomical Almanac 저정밀식, 해당 시점 적도 좌표 + 지평 시차)
  function moonEquatorial(jd) {
    const T = (jd - J2000) / 36525;
    const lam = 218.32 + 481267.881 * T
      + 6.29 * sind(135.0 + 477198.87 * T) - 1.27 * sind(259.3 - 413335.36 * T)
      + 0.66 * sind(235.7 + 890534.22 * T) + 0.21 * sind(269.9 + 954397.74 * T)
      - 0.19 * sind(357.5 + 35999.05 * T) - 0.11 * sind(186.5 + 966404.03 * T);
    const bet = 5.13 * sind(93.3 + 483202.02 * T) + 0.28 * sind(228.2 + 960400.89 * T)
      - 0.28 * sind(318.3 + 6003.15 * T) - 0.17 * sind(217.6 - 407332.21 * T);
    const par = 0.9508 + 0.0518 * cosd(135.0 + 477198.87 * T) + 0.0095 * cosd(259.3 - 413335.36 * T)
      + 0.0078 * cosd(235.7 + 890534.22 * T) + 0.0028 * cosd(269.9 + 954397.74 * T);
    const eps = obliquity(jd);
    const v = eclipticToEquatorialVec(raDecToVec(lam, bet), eps);
    return Object.assign(vecToRaDec(v), { parallax: par });
  }

  function eclipticToEquatorialVec(v, eps) {
    const ce = cosd(eps), se = sind(eps);
    return [v[0], ce * v[1] - se * v[2], se * v[1] + ce * v[2]];
  }

  // JPL 근사 케플러 궤도 요소 (1800–2050, J2000 황도): [a, e, I, L, 근일점 경도, 승교점 경도] 와 세기당 변화율
  const ELEMENTS = {
    mercury: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
      [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
    venus: [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
      [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
    earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
      [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]],
    mars: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
      [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
    jupiter: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
      [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
    saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
      [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  };

  const PLANETS = [
    { id: 'mercury', ko: '수성', H: -0.42, color: '#c9b9a6' },
    { id: 'venus', ko: '금성', H: -4.4, color: '#fff4d6' },
    { id: 'mars', ko: '화성', H: -1.52, color: '#ff8a5c' },
    { id: 'jupiter', ko: '목성', H: -9.4, color: '#ffe2b5' },
    { id: 'saturn', ko: '토성', H: -8.88, color: '#f2d79a' },
  ];

  function heliocentric(id, T) {
    const [e0, rate] = ELEMENTS[id];
    const [a, e, I, L, wbar, node] = e0.map((x, i) => x + rate[i] * T);
    const w = wbar - node;
    let M = mod(L - wbar + 180, 360) - 180;
    let E = M + (e / DEG) * sind(M);
    for (let k = 0; k < 6; k++) {
      E -= (E - (e / DEG) * sind(E) - M) / (1 - e * cosd(E));
    }
    const xp = a * (cosd(E) - e);
    const yp = a * Math.sqrt(1 - e * e) * sind(E);
    const cw = cosd(w), sw = sind(w), cO = cosd(node), sO = sind(node), cI = cosd(I), sI = sind(I);
    return [
      (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
      (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
      sw * sI * xp + cw * sI * yp,
    ];
  }

  // 행성의 J2000 적도 좌표와 대략적인 밝기
  function planetPositions(jd) {
    const T = (jd - J2000) / 36525;
    const earth = heliocentric('earth', T);
    const eps0 = 23.43928;
    return PLANETS.map((p) => {
      let helio = heliocentric(p.id, T);
      let geo = helio.map((x, i) => x - earth[i]);
      // 광행차 시간 보정 (한 번 반복)
      const lt = Math.hypot(...geo) * 0.0057755183 / 36525;
      helio = heliocentric(p.id, T - lt);
      geo = helio.map((x, i) => x - earth[i]);
      const r = Math.hypot(...helio);
      const delta = Math.hypot(...geo);
      const eq = eclipticToEquatorialVec(geo.map((x) => x / delta), eps0);
      const cosPhase = (r * r + delta * delta - Math.hypot(...earth) ** 2) / (2 * r * delta);
      const phaseAngle = Math.acos(Math.max(-1, Math.min(1, cosPhase))) / DEG;
      const mag = p.H + 5 * Math.log10(r * delta) + 0.02 * phaseAngle;
      return Object.assign({}, p, vecToRaDec(eq), { mag, dist: delta });
    });
  }

  // 두 방향 사이 각거리 (도)
  function angularDistance(v1, v2) {
    const d = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
    return Math.acos(Math.max(-1, Math.min(1, d))) / DEG;
  }

  root.Astro = {
    DEG, mod, julianDate, gmst, obliquity, raDecToVec, vecToRaDec, mulMat, mulVec,
    precessionMatrix, horizonMatrix, vecToAltAz, altAzToVec, refract,
    sunEquatorial, moonEquatorial, planetPositions, angularDistance, PLANETS,
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = globalThis.Astro;
