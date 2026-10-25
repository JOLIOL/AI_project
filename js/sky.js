// 하늘 렌더러: 스테레오 투영 카메라로 하늘(WebGL), 별·별자리(2D), 지형(WebGL), 라벨(2D)을 겹쳐 그린다.
(function (root) {
  'use strict';

  const A = root.Astro;
  const DEG = A.DEG;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------- WebGL 공통 ----------
  const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const COMMON = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uScale;
uniform vec3 uR, uU, uF;
out vec4 outColor;
vec3 viewDir() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uScale;
  float r2 = dot(p, p);
  vec3 c = vec3(4.0 * p, 4.0 - r2) / (4.0 + r2);
  return normalize(c.x * uR + c.y * uU + c.z * uF);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

  const SKY_FRAG = COMMON + `
uniform vec3 uSun;
uniform vec3 uMoon;
uniform float uMoonLight;
uniform float uPollution;
uniform float uAtmos;
uniform float uCloud;
void main() {
  vec3 d = viewDir();
  float h = clamp(d.z, 0.0, 1.0);
  float hz = pow(1.0 - h, 4.0);
  float sAlt = uSun.z;
  float day = smoothstep(-0.105, 0.17, sAlt);
  float twi = smoothstep(-0.31, -0.03, sAlt) * (1.0 - smoothstep(-0.03, 0.3, sAlt));
  float cosSun = dot(d, uSun);

  vec3 night = mix(vec3(0.004, 0.008, 0.022), vec3(0.03, 0.045, 0.085), hz);
  night += uPollution * mix(vec3(0.02, 0.018, 0.02), vec3(0.32, 0.2, 0.11), pow(1.0 - h, 6.0));
  night += uMoonLight * mix(vec3(0.03, 0.05, 0.1), vec3(0.06, 0.08, 0.13), hz);
  vec3 dayCol = mix(vec3(0.12, 0.33, 0.74), vec3(0.62, 0.77, 0.94), pow(1.0 - h, 2.5));
  vec3 col = mix(night, dayCol, day);

  float towardSun = exp(-(1.0 - cosSun) * 2.2);
  vec3 twiCol = mix(vec3(0.1, 0.12, 0.3), vec3(1.0, 0.45, 0.16), towardSun) * pow(1.0 - h, 3.0);
  col += twi * twiCol * (0.35 + 0.65 * towardSun);
  col += twi * vec3(0.05, 0.07, 0.18) * (1.0 - hz);

  float sunUp = smoothstep(-0.05, 0.02, sAlt);
  col += sunUp * (pow(max(cosSun, 0.0), 400.0) * 1.5 + pow(max(cosSun, 0.0), 12.0) * 0.25) * vec3(1.0, 0.93, 0.8);
  col += (1.0 - day) * uMoonLight * pow(max(dot(d, uMoon), 0.0), 80.0) * 0.35 * vec3(0.8, 0.85, 1.0);

  vec3 cloudCol = mix(vec3(0.02, 0.025, 0.03) + uPollution * 0.08, vec3(0.75, 0.77, 0.8), day);
  col = mix(col, cloudCol, uCloud * 0.85);

  col = mix(vec3(0.0), col, uAtmos);
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
}`;

  const GROUND_FRAG = COMMON + `
uniform sampler2D uHorizon;
uniform vec3 uSun;
uniform vec3 uMoon;
uniform float uMoonLight;
uniform float uAtmos;
uniform float uDegPerPx;
const float PI = 3.14159265;
vec4 horizonAt(float az) {
  float n = float(textureSize(uHorizon, 0).x);
  float x = az / (2.0 * PI) * n;
  float i0 = floor(x);
  float t = x - i0;
  int a = int(mod(i0, n));
  int b = int(mod(i0 + 1.0, n));
  return mix(texelFetch(uHorizon, ivec2(a, 0), 0), texelFetch(uHorizon, ivec2(b, 0), 0), t);
}
void main() {
  vec3 d = viewDir();
  float az = mod(atan(d.x, d.y), 2.0 * PI);
  float alt = degrees(asin(clamp(d.z, -1.0, 1.0)));
  vec4 hp = horizonAt(az);
  float edge = clamp((hp.r - alt) / uDegPerPx + 0.5, 0.0, 1.0);
  if (edge <= 0.0) discard;

  float day = smoothstep(-0.105, 0.2, uSun.z) * uAtmos;
  float moon = uMoonLight * (1.0 - day) * uAtmos;
  vec3 nearN = vec3(0.008, 0.01, 0.014), midN = vec3(0.018, 0.022, 0.034), farN = vec3(0.035, 0.045, 0.07);
  vec3 nearD = vec3(0.13, 0.17, 0.09), midD = vec3(0.2, 0.27, 0.19), farD = vec3(0.4, 0.48, 0.58);
  vec3 lightN = vec3(1.0) + moon * vec3(2.5, 2.8, 3.4);
  vec3 col;
  float layerFar = smoothstep(hp.g - uDegPerPx, hp.g, alt);
  float layerMid = smoothstep(hp.b - uDegPerPx, hp.b, alt);
  vec3 nightCol = mix(mix(nearN, midN, layerMid), farN, layerFar) * lightN;
  vec3 dayCol = mix(mix(nearD, midD, layerMid), farD, layerFar);
  col = mix(nightCol, dayCol, day);

  // 바다: 지평선이 거의 0°이고 그 방향 샘플 대부분이 해수면
  float sea = smoothstep(0.55, 0.8, hp.a) * (1.0 - smoothstep(0.15, 0.6, hp.r - hp.b));
  if (sea > 0.0 && alt < hp.r) {
    float depth = clamp(-alt / 20.0, 0.0, 1.0);
    vec3 water = mix(mix(vec3(0.03, 0.05, 0.1), vec3(0.008, 0.012, 0.025), depth), mix(vec3(0.42, 0.56, 0.7), vec3(0.08, 0.2, 0.33), depth), day);
    vec2 h2 = normalize(d.xy + 1e-6);
    float sparkle = 0.25 + 0.75 * step(0.55, hash(floor(gl_FragCoord.xy / vec2(7.0, 2.0))));
    vec2 m2 = normalize(uMoon.xy + 1e-6);
    float glitter = pow(max(dot(h2, m2), 0.0), 300.0) * step(0.0, uMoon.z) * moon * sparkle;
    vec2 s2 = normalize(uSun.xy + 1e-6);
    glitter += pow(max(dot(h2, s2), 0.0), 120.0) * smoothstep(-0.02, 0.1, uSun.z) * sparkle * 0.8;
    water += glitter * vec3(0.9, 0.85, 0.7) * (1.0 - depth);
    col = mix(col, water, sea);
  }
  col *= 0.55 + 0.45 * smoothstep(-35.0, 0.0, alt);
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(col * edge, edge);
}`;

  function createGL(canvas, fragSrc) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) return null;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragSrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uniforms = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      uniforms[info.name] = gl.getUniformLocation(prog, info.name);
    }
    return { gl, prog, uniforms };
  }

  // ---------- 별 색 (B−V 색지수 → RGB) ----------
  const BV_TABLE = [[-0.4, [155, 176, 255]], [0.0, [202, 215, 255]], [0.4, [248, 247, 255]], [0.6, [255, 244, 234]],
    [1.0, [255, 210, 161]], [1.5, [255, 173, 81]], [2.0, [255, 140, 58]]];
  function bvColor(bv) {
    bv = clamp(bv, -0.4, 2.0);
    for (let i = 1; i < BV_TABLE.length; i++) {
      if (bv <= BV_TABLE[i][0]) {
        const [b0, c0] = BV_TABLE[i - 1], [b1, c1] = BV_TABLE[i];
        const t = (bv - b0) / (b1 - b0);
        return c0.map((c, k) => Math.round(c + (c1[k] - c) * t));
      }
    }
    return BV_TABLE[BV_TABLE.length - 1][1];
  }

  const CARDINALS = [['북', 0], ['북동', 45], ['동', 90], ['남동', 135], ['남', 180], ['남서', 225], ['서', 270], ['북서', 315]];

  class SkyView {
    constructor(container, data) {
      this.container = container;
      this.layers = ['sky', 'stars', 'ground', 'overlay'].map((name) => {
        const c = document.createElement('canvas');
        c.className = 'sky-layer sky-' + name;
        container.appendChild(c);
        return c;
      });
      const [skyC, starC, groundC, overC] = this.layers;
      this.skyGL = createGL(skyC, SKY_FRAG);
      this.groundGL = createGL(groundC, GROUND_FRAG);
      if (!this.skyGL || !this.groundGL) throw new Error('WebGL2를 지원하지 않는 브라우저입니다.');
      this.ctx = starC.getContext('2d');
      this.octx = overC.getContext('2d');

      this.view = { az: 180, alt: 25, fov: 100 };
      this.lat = 37.5665;
      this.lon = 126.978;
      this.time = Date.now();
      this.opts = { lines: true, conNames: true, starNames: true, planets: true, milkyWay: true, grid: false,
        terrain: true, atmosphere: true, pollution: 0.25, cloud: 0 };
      this.profile = window.Terrain.emptyProfile();
      this.flatProfile = window.Terrain.emptyProfile();
      this.picks = [];
      this.moonLight = 0;
      this.prepareData(data);
      this.makeSprites();
      this.horizonTex = null;
      this.uploadHorizon();
      this.resize();
    }

    prepareData(data) {
      const names = data.starNames;
      this.stars = data.stars.map(([hip, ra, dec, mag, bv]) => ({
        hip, ra, dec, mag, v: A.raDecToVec(ra, dec), rgb: bvColor(bv), name: names[hip] || null,
      }));
      this.constellations = data.constellations.map((c) => ({
        id: c.id, ko: c.ko, en: c.en, rank: c.rank, ra: c.ra, dec: c.dec, v: A.raDecToVec(c.ra, c.dec),
        lines: c.lines.map((seg) => seg.map(([ra, dec]) => A.raDecToVec(ra, dec))),
      }));
      this.conById = Object.fromEntries(this.constellations.map((c) => [c.id, c]));
      this.milkyWay = data.milkyWay.map(([ra, dec, lvl]) => ({ v: A.raDecToVec(ra, dec), lvl }));
    }

    makeSprites() {
      const s = document.createElement('canvas');
      s.width = s.height = 64;
      const g = s.getContext('2d');
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        grad.addColorStop(t, `rgba(185,198,245,${Math.exp(-t * t * 4.5).toFixed(3)})`);
      }
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      this.mwSprite = s;
    }

    setProfile(profile) {
      this.profile = profile;
      this.uploadHorizon();
    }

    activeProfile() {
      return this.opts.terrain ? this.profile : this.flatProfile;
    }

    uploadHorizon() {
      const { gl } = this.groundGL;
      const p = this.activeProfile();
      const n = p.far.length;
      const buf = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        buf[i * 4] = p.far[i];
        buf[i * 4 + 1] = p.mid[i];
        buf[i * 4 + 2] = p.near[i];
        buf[i * 4 + 3] = p.water[i];
      }
      if (!this.horizonTex) this.horizonTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.horizonTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, n, 1, 0, gl.RGBA, gl.FLOAT, buf);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    horizonAlt(az) {
      const p = this.activeProfile().far;
      const n = p.length;
      const x = (A.mod(az, 360) / 360) * n;
      const i = Math.floor(x);
      const t = x - i;
      return p[i % n] * (1 - t) + p[(i + 1) % n] * t;
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      this.dpr = dpr;
      this.cssW = w;
      this.cssH = h;
      for (const c of this.layers) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
        c.style.width = w + 'px';
        c.style.height = h + 'px';
      }
    }

    // ---------- 카메라 ----------
    camera() {
      const { az, alt, fov } = this.view;
      const f = A.altAzToVec(alt, az);
      const r = [Math.cos(az * DEG), -Math.sin(az * DEG), 0];
      const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
      // 화면의 긴 변이 시야각(fov)을 덮는다
      const span = Math.max(this.cssW, this.cssH, 1);
      const scale = (span / 2) / (2 * Math.tan((fov * DEG) / 4)); // CSS px / 투영 단위
      return { f, r, u, scale, cx: this.cssW / 2, cy: this.cssH / 2 };
    }

    project(v, cam, zMin = -0.2) {
      const z = v[0] * cam.f[0] + v[1] * cam.f[1] + v[2] * cam.f[2];
      if (z < zMin) return null;
      const x = v[0] * cam.r[0] + v[1] * cam.r[1] + v[2] * cam.r[2];
      const y = v[0] * cam.u[0] + v[1] * cam.u[1] + v[2] * cam.u[2];
      const k = (2 / (1 + z)) * cam.scale;
      return [cam.cx + k * x, cam.cy - k * y];
    }

    unproject(sx, sy, cam) {
      const X = (sx - cam.cx) / cam.scale;
      const Y = (cam.cy - sy) / cam.scale;
      const r2 = X * X + Y * Y;
      const x = (4 * X) / (4 + r2), y = (4 * Y) / (4 + r2), z = (4 - r2) / (4 + r2);
      return [0, 1, 2].map((i) => x * cam.r[i] + y * cam.u[i] + z * cam.f[i]);
    }

    degPerPx(cam) {
      return 1 / (cam.scale * DEG); // 화면 중심 기준 (스테레오 투영 배율 2 → 1/2 상쇄)
    }

    // ---------- 천체 위치 ----------
    computeEphemeris() {
      const jd = A.julianDate(new Date(this.time));
      const lst = A.gmst(jd) + this.lon;
      const H = A.horizonMatrix(lst, this.lat);
      const M = A.mulMat(H, A.precessionMatrix(jd));
      const toHor = (m, v) => this.refractVec(A.mulVec(m, v));
      const sunEq = A.sunEquatorial(jd);
      const sun = toHor(H, A.raDecToVec(sunEq.ra, sunEq.dec));
      const moonEq = A.moonEquatorial(jd);
      let moonV = A.mulVec(H, A.raDecToVec(moonEq.ra, moonEq.dec));
      const mAltAz = A.vecToAltAz(moonV);
      moonV = this.refractVec(A.altAzToVec(mAltAz.alt - moonEq.parallax * Math.cos(mAltAz.alt * DEG), mAltAz.az));
      const elong = A.angularDistance(moonV, sun);
      const moonIllum = (1 - Math.cos(elong * DEG)) / 2;
      // 차오르는 달인지: 달 황경 − 태양 황경
      const moonEcl = A.mod(Math.atan2(
        Math.sin(moonEq.ra * DEG) * Math.cos(A.obliquity(jd) * DEG) + Math.tan(moonEq.dec * DEG) * Math.sin(A.obliquity(jd) * DEG),
        Math.cos(moonEq.ra * DEG)) / DEG, 360);
      const waxing = A.mod(moonEcl - sunEq.lon, 360) < 180;
      const planets = A.planetPositions(jd).map((p) => Object.assign(p, { h: toHor(M, A.raDecToVec(p.ra, p.dec)) }));
      this.eph = { jd, lst, H, M, sun, moon: moonV, moonEq, moonIllum, waxing, elong, planets };
      return this.eph;
    }

    refractVec(v) {
      const alt = Math.asin(clamp(v[2], -1, 1)) / DEG;
      if (alt < -2 || alt > 80) return v;
      const ra = A.refract(alt);
      const h = Math.hypot(v[0], v[1]) || 1e-9;
      const c = Math.cos(ra * DEG) / h;
      return [v[0] * c, v[1] * c, Math.sin(ra * DEG)];
    }

    limitingMag(sunAlt) {
      const base = 6.6 - this.opts.pollution * 3.4;
      if (!this.opts.atmosphere) return 6.6;
      let lim = base;
      if (sunAlt > -18) lim = Math.min(base, base - ((sunAlt + 18) / 14) * (base - 1.5));
      if (sunAlt > -4) lim = 1.5 - ((sunAlt + 4) / 4) * 5.5;
      lim -= this.opts.cloud * 4 + this.moonLight * 1.3;
      return Math.max(lim, -5);
    }

    // ---------- 그리기 ----------
    render() {
      const cam = this.camera();
      const eph = this.computeEphemeris();
      this.picks = [];
      const sunAlt = Math.asin(eph.sun[2]) / DEG;
      const moonUp = eph.moon[2] > 0 ? 1 : 0;
      const moonLight = moonUp * eph.moonIllum * Math.min(1, eph.moon[2] * 4);
      this.moonLight = this.opts.atmosphere ? moonLight : 0;
      this.drawGL(this.skyGL, cam, eph, moonLight);
      this.drawStars(cam, eph, sunAlt);
      this.drawGL(this.groundGL, cam, eph, moonLight);
      this.drawOverlay(cam, eph, sunAlt);
      return eph;
    }

    drawGL(layer, cam, eph, moonLight) {
      const { gl, uniforms: u } = layer;
      const dpr = this.dpr;
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(u.uRes, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform1f(u.uScale, cam.scale * dpr);
      gl.uniform3fv(u.uR, cam.r);
      gl.uniform3fv(u.uU, cam.u);
      gl.uniform3fv(u.uF, cam.f);
      gl.uniform3fv(u.uSun, eph.sun);
      gl.uniform3fv(u.uMoon, eph.moon);
      gl.uniform1f(u.uMoonLight, moonLight);
      gl.uniform1f(u.uAtmos, this.opts.atmosphere ? 1 : 0);
      if (u.uPollution) gl.uniform1f(u.uPollution, this.opts.pollution);
      if (u.uCloud) gl.uniform1f(u.uCloud, this.opts.atmosphere ? this.opts.cloud : 0);
      if (u.uHorizon) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.horizonTex);
        gl.uniform1i(u.uHorizon, 0);
        gl.uniform1f(u.uDegPerPx, this.degPerPx(cam) / dpr);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    drawStars(cam, eph, sunAlt) {
      const ctx = this.ctx;
      const dpr = this.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.cssW, this.cssH);
      const lim = this.limitingMag(sunAlt);
      const darkness = this.opts.atmosphere ? clamp((-sunAlt - 6) / 12, 0, 1) * (1 - this.opts.cloud) : 1;
      const zoom = Math.sqrt(clamp(90 / this.view.fov, 0.6, 4));
      const pxPerDeg = 1 / this.degPerPx(cam);
      const W = this.cssW, Hh = this.cssH;
      const onScreen = (p, m = 40) => p && p[0] > -m && p[0] < W + m && p[1] > -m && p[1] < Hh + m;
      const M = eph.M;

      // 은하수 (격자 점마다 부드러운 빛 덩어리를 겹쳐 그림)
      if (this.opts.milkyWay && darkness > 0.05) {
        const mwAlpha = darkness * (1 - this.opts.pollution * 0.9) * (1 - 0.75 * this.moonLight) * 0.045;
        if (mwAlpha > 0.003) {
          ctx.globalCompositeOperation = 'lighter';
          const base = 1.2 * pxPerDeg * 3.2;
          for (const p of this.milkyWay) {
            const v = A.mulVec(M, p.v);
            if (v[2] < -0.1) continue;
            const z = v[0] * cam.f[0] + v[1] * cam.f[1] + v[2] * cam.f[2];
            const size = (base * 2) / (1 + z);
            const s = this.project(v, cam);
            if (!onScreen(s, size)) continue;
            ctx.globalAlpha = mwAlpha * p.lvl * this.extinctionFactor(v[2]);
            ctx.drawImage(this.mwSprite, s[0] - size / 2, s[1] - size / 2, size, size);
          }
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
      }

      // 고도·방위 격자
      if (this.opts.grid) this.drawGrid(ctx, cam);

      // 별자리 선
      if (this.opts.lines) {
        ctx.strokeStyle = this.opts.atmosphere && sunAlt > -6 ? 'rgba(150,190,255,0.25)' : 'rgba(120,170,255,0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const c of this.constellations) {
          for (const seg of c.lines) {
            let prev = null;
            for (const ev of seg) {
              const v = this.refractVec(A.mulVec(M, ev));
              const s = this.project(v, cam, -0.1);
              if (prev && s && Math.hypot(s[0] - prev[0], s[1] - prev[1]) < W * 1.5) {
                ctx.moveTo(prev[0], prev[1]);
                ctx.lineTo(s[0], s[1]);
              }
              prev = s;
            }
          }
        }
        ctx.stroke();
      }

      // 별
      for (const st of this.stars) {
        const v = this.refractVec(A.mulVec(M, st.v));
        if (v[2] < -0.05) continue;
        const s = this.project(v, cam);
        if (!onScreen(s, 10)) continue;
        const alt = Math.asin(v[2]) / DEG;
        const m = st.mag + this.extinctionMag(v[2]);
        if (m > lim + 0.3) continue;
        const delta = lim - m;
        const r = clamp(0.45 + 0.55 * Math.pow(Math.max(delta, 0) + 0.3, 0.85), 0.45, 6) * zoom;
        const a = clamp(delta / 1.5 + 0.35, 0.15, 1);
        const [cr, cg, cb] = st.rgb;
        if (st.mag < 1.6 && delta > 1) {
          const g = ctx.createRadialGradient(s[0], s[1], 0, s[0], s[1], r * 4);
          g.addColorStop(0, `rgba(${cr},${cg},${cb},${0.35 * a})`);
          g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          ctx.fillStyle = g;
          ctx.fillRect(s[0] - r * 4, s[1] - r * 4, r * 8, r * 8);
        }
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`;
        ctx.beginPath();
        ctx.arc(s[0], s[1], r, 0, Math.PI * 2);
        ctx.fill();
        if (st.mag < 5 && alt > this.horizonAlt(Math.atan2(v[0], v[1]) / DEG) - 0.2) {
          this.picks.push({ type: 'star', x: s[0], y: s[1], obj: st, v, mag: st.mag });
        }
      }

      // 태양·달·행성
      if (this.opts.planets) {
        for (const p of eph.planets) {
          const s = this.project(p.h, cam);
          if (!onScreen(s) || p.h[2] < -0.05) continue;
          const m = p.mag + this.extinctionMag(p.h[2]);
          if (m > lim + 0.5) continue;
          const r = clamp(1.2 + 0.7 * (lim - m), 1.5, 7) * zoom;
          ctx.fillStyle = p.color;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(s[0], s[1], r, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          this.picks.push({ type: 'planet', x: s[0], y: s[1], obj: p, v: p.h, mag: p.mag });
        }
      }
      this.drawSun(ctx, cam, eph, pxPerDeg);
      this.drawMoon(ctx, cam, eph, pxPerDeg);
    }

    extinctionMag(sinAlt) {
      if (!this.opts.atmosphere) return 0;
      const alt = Math.asin(clamp(sinAlt, -1, 1)) / DEG;
      const airmass = 1 / (Math.sin(Math.max(alt, -1) * DEG + 0) + 0.50572 * Math.pow(Math.max(alt, -1) + 6.07995, -1.6364));
      return 0.25 * (Math.min(airmass, 40) - 1);
    }

    extinctionFactor(sinAlt) {
      return Math.pow(10, -0.4 * this.extinctionMag(sinAlt));
    }

    drawSun(ctx, cam, eph, pxPerDeg) {
      if (eph.sun[2] < -0.02) return;
      const s = this.project(eph.sun, cam);
      if (!s) return;
      const r = Math.max(5, 0.27 * pxPerDeg);
      ctx.fillStyle = '#fff6dc';
      ctx.shadowColor = '#ffd27a';
      ctx.shadowBlur = 25;
      ctx.beginPath();
      ctx.arc(s[0], s[1], r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      this.picks.push({ type: 'sun', x: s[0], y: s[1], v: eph.sun, obj: { ko: '태양' } });
    }

    drawMoon(ctx, cam, eph, pxPerDeg) {
      const mv = eph.moon;
      if (mv[2] < -0.02) return;
      const s = this.project(mv, cam);
      if (!s) return;
      const r = Math.max(6, 0.26 * pxPerDeg * 1.2);
      // 화면에서 태양 쪽 방향
      const sun = eph.sun;
      const d = sun[0] * mv[0] + sun[1] * mv[1] + sun[2] * mv[2];
      const t = sun.map((x, i) => x - d * mv[i]);
      const tl = Math.hypot(...t) || 1;
      const p2 = this.project(mv.map((x, i) => x + (0.01 * t[i]) / tl), cam);
      const theta = p2 ? Math.atan2(p2[1] - s[1], p2[0] - s[0]) : 0;
      const k = eph.moonIllum;
      ctx.save();
      ctx.translate(s[0], s[1]);
      ctx.rotate(theta);
      ctx.fillStyle = 'rgba(28,32,44,0.95)';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      const e = r * (1 - 2 * k);
      ctx.fillStyle = '#f4f1e6';
      ctx.shadowColor = 'rgba(240,240,220,0.8)';
      ctx.shadowBlur = 18 * k;
      ctx.beginPath();
      ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
      ctx.ellipse(0, 0, Math.abs(e), r, 0, Math.PI / 2, -Math.PI / 2, e > 0);
      ctx.fill();
      ctx.restore();
      this.picks.push({ type: 'moon', x: s[0], y: s[1], v: mv, obj: { ko: '달' } });
    }

    drawGrid(ctx, cam) {
      ctx.strokeStyle = 'rgba(255,200,120,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const line = (pts) => {
        let prev = null;
        for (const v of pts) {
          const s = this.project(v, cam, -0.3);
          if (prev && s && Math.hypot(s[0] - prev[0], s[1] - prev[1]) < this.cssW) {
            ctx.moveTo(prev[0], prev[1]);
            ctx.lineTo(s[0], s[1]);
          }
          prev = s;
        }
      };
      for (let alt = 0; alt < 90; alt += 10) {
        const pts = [];
        for (let az = 0; az <= 360; az += 2) pts.push(A.altAzToVec(alt, az));
        line(pts);
      }
      for (let az = 0; az < 360; az += 15) {
        const pts = [];
        for (let alt = 0; alt <= 90; alt += 2) pts.push(A.altAzToVec(alt, az));
        line(pts);
      }
      ctx.stroke();
    }

    drawOverlay(cam, eph, sunAlt) {
      const ctx = this.octx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.cssW, this.cssH);
      const visible = (v) => {
        const alt = Math.asin(clamp(v[2], -1, 1)) / DEG;
        return alt > this.horizonAlt(Math.atan2(v[0], v[1]) / DEG);
      };
      ctx.textBaseline = 'middle';
      const day = this.opts.atmosphere && sunAlt > -6;

      // 겹치는 라벨은 건너뛴다 (먼저 놓인 것이 우선)
      const placed = [];
      const label = (text, x, y, align) => {
        const w = ctx.measureText(text).width;
        const x0 = align === 'center' ? x - w / 2 : x;
        const box = [x0 - 2, y - 8, x0 + w + 2, y + 8];
        if (placed.some((q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1])) return;
        placed.push(box);
        ctx.textAlign = align;
        ctx.fillText(text, x, y);
      };

      if (this.opts.planets) {
        ctx.font = '600 12px "Noto Sans KR", system-ui, sans-serif';
        for (const p of this.picks) {
          if (p.type === 'star' || !visible(p.v)) continue;
          ctx.fillStyle = p.type === 'planet' ? p.obj.color : '#fff3c4';
          label(p.obj.ko, p.x + 9, p.y + 10, 'left');
        }
      }

      if (this.opts.starNames) {
        ctx.font = '12px "Noto Sans KR", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,240,200,0.8)';
        const magLimit = this.view.fov > 120 ? 1.5 : this.view.fov > 60 ? 2.3 : 3.5;
        for (const p of this.picks) {
          if (p.type !== 'star' || !p.obj.name || p.mag > magLimit) continue;
          label(p.obj.name.ko, p.x + 6, p.y - 7, 'left');
        }
      }

      if (this.opts.conNames) {
        const minRank = this.view.fov > 120 ? 1 : this.view.fov > 70 ? 2 : 3;
        ctx.font = '500 13px "Noto Sans KR", system-ui, sans-serif';
        ctx.fillStyle = day ? 'rgba(220,235,255,0.55)' : 'rgba(150,190,255,0.75)';
        for (const c of this.constellations) {
          if (c.rank > minRank) continue;
          const v = this.refractVec(A.mulVec(eph.M, c.v));
          if (!visible(v)) continue;
          const s = this.project(v, cam, 0);
          if (s) label(c.ko, s[0], s[1], 'center');
        }
      }

      // 방위 표시
      ctx.textAlign = 'center';
      for (const [name, az] of CARDINALS) {
        const v = A.altAzToVec(this.horizonAlt(az) - 2.2, az);
        const s = this.project(v, cam, 0);
        if (!s) continue;
        const main = az % 90 === 0;
        ctx.font = (main ? '700 16px' : '500 12px') + ' "Noto Sans KR", system-ui, sans-serif';
        ctx.fillStyle = az === 0 ? 'rgba(255,120,110,0.95)' : 'rgba(255,215,150,0.85)';
        ctx.fillText(name, s[0], s[1] + (main ? 6 : 4));
      }

      if (this.selected) {
        const sel = this.picks.find((p) => p.obj === this.selected.obj);
        if (sel) {
          ctx.strokeStyle = 'rgba(255,220,120,0.9)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(sel.x, sel.y, 11, 0, Math.PI * 2);
          ctx.stroke();
          this.selected = sel;
        }
      }
    }

    pick(x, y) {
      let best = null, bestD = 16;
      for (const p of this.picks) {
        const d = Math.hypot(p.x - x, p.y - y) - (p.type === 'star' ? 0 : 4);
        if (d < bestD) { bestD = d; best = p; }
      }
      this.selected = best;
      return best;
    }

    constellationAt(v) {
      // 별자리 이름표 위치와 가장 가까운 별자리 (대략적 판정)
      let best = null, bestD = 1e9;
      for (const c of this.constellations) {
        const d = A.angularDistance(A.mulVec(this.eph.M, c.v), v);
        if (d < bestD) { bestD = d; best = c; }
      }
      return best;
    }
  }

  root.SkyView = SkyView;
})(window);
