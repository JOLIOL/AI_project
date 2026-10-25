#!/usr/bin/env python3
"""d3-celestial 데이터(BSD-3, Olaf Frohn)를 앱에서 쓰는 압축 형식(data/sky-data.js)으로 변환한다.

사용법:
    npm pack d3-celestial && tar xzf d3-celestial-*.tgz
    python3 tools/build_data.py package/data data/sky-data.js
"""
import json
import math
import sys
from pathlib import Path


def ra360(ra):
    return round(ra % 360.0, 3)


def load(src, name):
    return json.loads((src / name).read_text(encoding="utf-8"))


def build_stars(src):
    stars = []
    for f in load(src, "stars.6.json")["features"]:
        ra, dec = f["geometry"]["coordinates"]
        p = f["properties"]
        try:
            bv = round(float(p.get("bv") or 0.6), 2)
        except ValueError:
            bv = 0.6
        stars.append([f["id"], ra360(ra), round(dec, 3), round(p["mag"], 2), bv])
    stars.sort(key=lambda s: s[3])  # 밝은 별부터
    return stars


def build_star_names(src, stars):
    names = load(src, "starnames.json")
    mags = {s[0]: s[3] for s in stars}
    out = {}
    for hip, n in names.items():
        hip = int(hip)
        if hip in mags and mags[hip] <= 3.5 and (n.get("ko") or n.get("name")):
            out[hip] = {"ko": n.get("ko") or n["name"], "en": n.get("name", ""),
                        "b": n.get("bayer", ""), "c": n.get("c", "")}
    return out


def build_constellations(src):
    lines = {}
    for f in load(src, "constellations.lines.json")["features"]:
        lines[f["id"]] = [[[ra360(ra), round(dec, 3)] for ra, dec in seg]
                          for seg in f["geometry"]["coordinates"]]
    cons = []
    for f in load(src, "constellations.json")["features"]:
        p = f["properties"]
        ra, dec = f["geometry"]["coordinates"]
        cons.append({"id": f["id"], "ko": p.get("ko") or p["name"], "en": p["name"],
                     "ra": ra360(ra), "dec": round(dec, 2), "rank": int(p.get("rank", 3)),
                     "lines": lines.get(f["id"], [])})
    return cons


def point_in_rings(x, y, rings):
    inside = False
    for ring in rings:
        n = len(ring)
        j = n - 1
        for i in range(n):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
    return inside


def build_milky_way(src, step=1.2):
    """은하수 다각형(5단계 밝기)을 거의 등면적 격자 점 [ra, dec, 밝기]로 샘플링한다."""
    levels = []
    for f in load(src, "mw.json")["features"]:
        rings = [ring for poly in f["geometry"]["coordinates"] for ring in poly]
        boxes = []
        for ring in rings:
            xs = [p[0] for p in ring]
            ys = [p[1] for p in ring]
            boxes.append((min(xs), max(xs), min(ys), max(ys)))
        levels.append((rings, boxes))
    pts = []
    dec = -90 + step / 2
    while dec < 90:
        dra = step / max(math.cos(math.radians(dec)), 0.05)
        ra = -180 + dra / 2
        while ra < 180:
            level = 0
            for rings, boxes in levels:
                cand = [r for r, b in zip(rings, boxes) if b[0] <= ra <= b[1] and b[2] <= dec <= b[3]]
                if cand and point_in_rings(ra, dec, cand):
                    level += 1
            if level:
                pts.append([ra360(ra), round(dec, 2), level])
            ra += dra
        dec += step
    return pts


def main():
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    stars = build_stars(src)
    data = {
        "stars": stars,
        "starNames": build_star_names(src, stars),
        "constellations": build_constellations(src),
        "milkyWay": build_milky_way(src),
    }
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    dst.write_text(
        "// 자동 생성 파일: tools/build_data.py 로 만듦. 원본 데이터: d3-celestial (BSD-3, Olaf Frohn)\n"
        "window.SKY_DATA=" + body + ";\n", encoding="utf-8")
    print(f"stars={len(stars)} names={len(data['starNames'])} "
          f"constellations={len(data['constellations'])} milkyway={len(data['milkyWay'])} "
          f"size={dst.stat().st_size // 1024}KB")


if __name__ == "__main__":
    main()
