"""Build src/data/locations.json and src/data/mlat-grid.json.

Magnetic latitude is AACGM-v2 (corrected geomagnetic) at ground level, computed with the
`aacgmv2` Python package. Re-run once a year or so; the values drift slowly.

    pip install aacgmv2
    python3 scripts/build_locations.py 2026-11-17
"""
import datetime as dt
import json
import math
import pathlib
import sys

import aacgmv2

EPOCH = dt.datetime.strptime(sys.argv[1], "%Y-%m-%d") if len(sys.argv) > 1 else dt.datetime(2026, 11, 17)
ROOT = pathlib.Path(__file__).resolve().parent.parent

# Equatorward edge of the aurora (magnetic latitude) for Kp 0..9, NOAA SWPC.
KP_BOUNDARY = [66.5, 64.5, 62.4, 60.4, 58.3, 56.3, 54.2, 52.2, 50.1, 48.1]
EASY_MARGIN = 5.0  # NOAA: easily visible with the edge 4-5 degrees poleward of you
FAR_MARGIN = 9.0   # NOAA: up to about 1000 km away when bright and conditions are right

REGIONS = [
    ("tasmania", "Tasmania", "AU"),
    ("victoria", "Victoria", "AU"),
    ("south-australia", "South Australia", "AU"),
    ("western-australia", "Western Australia", "AU"),
    ("nsw-act-queensland", "New South Wales, ACT and Queensland", "AU"),
    ("new-zealand", "New Zealand", "NZ"),
]

# slug, name, region slug, state/area label, lat, lon, IANA time zone, featured on the home page
LOCATIONS = [
    ("hobart", "Hobart", "tasmania", "Tasmania", -42.88, 147.33, "Australia/Hobart", True),
    ("launceston", "Launceston", "tasmania", "Tasmania", -41.44, 147.14, "Australia/Hobart", True),
    ("devonport", "Devonport", "tasmania", "Tasmania", -41.18, 146.35, "Australia/Hobart", False),
    ("burnie", "Burnie", "tasmania", "Tasmania", -41.05, 145.91, "Australia/Hobart", False),
    ("strahan", "Strahan", "tasmania", "Tasmania", -42.15, 145.33, "Australia/Hobart", False),
    ("bruny-island", "Bruny Island", "tasmania", "Tasmania", -43.36, 147.33, "Australia/Hobart", False),
    ("cockle-creek", "Cockle Creek", "tasmania", "Tasmania", -43.58, 146.89, "Australia/Hobart", False),
    ("melbourne", "Melbourne", "victoria", "Victoria", -37.81, 144.96, "Australia/Melbourne", True),
    ("geelong", "Geelong", "victoria", "Victoria", -38.15, 144.36, "Australia/Melbourne", False),
    ("phillip-island", "Phillip Island", "victoria", "Victoria", -38.49, 145.23, "Australia/Melbourne", False),
    ("apollo-bay", "Apollo Bay", "victoria", "Victoria", -38.76, 143.67, "Australia/Melbourne", False),
    ("warrnambool", "Warrnambool", "victoria", "Victoria", -38.38, 142.48, "Australia/Melbourne", False),
    ("portland", "Portland", "victoria", "Victoria", -38.34, 141.60, "Australia/Melbourne", False),
    ("wilsons-promontory", "Wilsons Promontory", "victoria", "Victoria", -39.03, 146.32, "Australia/Melbourne", False),
    ("adelaide", "Adelaide", "south-australia", "South Australia", -34.93, 138.60, "Australia/Adelaide", True),
    ("victor-harbor", "Victor Harbor", "south-australia", "South Australia", -35.55, 138.62, "Australia/Adelaide", False),
    ("kangaroo-island", "Kangaroo Island", "south-australia", "South Australia", -35.66, 137.64, "Australia/Adelaide", False),
    ("mount-gambier", "Mount Gambier", "south-australia", "South Australia", -37.83, 140.78, "Australia/Adelaide", False),
    ("perth", "Perth", "western-australia", "Western Australia", -31.95, 115.86, "Australia/Perth", True),
    ("margaret-river", "Margaret River", "western-australia", "Western Australia", -33.95, 115.07, "Australia/Perth", False),
    ("augusta", "Augusta", "western-australia", "Western Australia", -34.32, 115.16, "Australia/Perth", False),
    ("albany", "Albany", "western-australia", "Western Australia", -35.02, 117.88, "Australia/Perth", False),
    ("esperance", "Esperance", "western-australia", "Western Australia", -33.86, 121.89, "Australia/Perth", False),
    ("sydney", "Sydney", "nsw-act-queensland", "New South Wales", -33.87, 151.21, "Australia/Sydney", True),
    ("canberra", "Canberra", "nsw-act-queensland", "Australian Capital Territory", -35.28, 149.13, "Australia/Sydney", True),
    ("brisbane", "Brisbane", "nsw-act-queensland", "Queensland", -27.47, 153.03, "Australia/Brisbane", True),
    ("invercargill", "Invercargill", "new-zealand", "Southland", -46.41, 168.35, "Pacific/Auckland", False),
    ("stewart-island", "Stewart Island", "new-zealand", "Southland", -46.90, 168.13, "Pacific/Auckland", False),
    ("dunedin", "Dunedin", "new-zealand", "Otago", -45.87, 170.50, "Pacific/Auckland", True),
    ("queenstown", "Queenstown", "new-zealand", "Otago", -45.03, 168.66, "Pacific/Auckland", True),
    ("wanaka", "Wānaka", "new-zealand", "Otago", -44.70, 169.13, "Pacific/Auckland", False),
    ("te-anau", "Te Anau", "new-zealand", "Southland", -45.41, 167.72, "Pacific/Auckland", False),
    ("lake-tekapo", "Lake Tekapo", "new-zealand", "Canterbury", -44.00, 170.48, "Pacific/Auckland", False),
    ("christchurch", "Christchurch", "new-zealand", "Canterbury", -43.53, 172.64, "Pacific/Auckland", True),
    ("wellington", "Wellington", "new-zealand", "Wellington", -41.29, 174.78, "Pacific/Auckland", True),
    ("auckland", "Auckland", "new-zealand", "Auckland", -36.85, 174.76, "Pacific/Auckland", True),
]


def mlat(lat, lon):
    lon = lon - 360 if lon > 180 else lon
    m, _, _ = aacgmv2.convert_latlon(lat, lon, 0, EPOCH, method_code="G2A")
    return float(m)


def kp_needed(abs_mlat, margin):
    for kp, edge in enumerate(KP_BOUNDARY):
        if edge <= abs_mlat + margin:
            return kp
    return None


def bearing_to_aurora(lat, lon):
    """True bearing of the steepest rise in |magnetic latitude|: the way to the nearest part of the oval."""
    d = 0.5
    north = (abs(mlat(lat + d, lon)) - abs(mlat(lat - d, lon))) / (2 * d * 111.2)
    east = (abs(mlat(lat, lon + d)) - abs(mlat(lat, lon - d))) / (2 * d * 111.2 * math.cos(math.radians(lat)))
    return round(math.degrees(math.atan2(east, north)) % 360)


out = []
for slug, name, region, area, lat, lon, tz, featured in LOCATIONS:
    m = mlat(lat, lon)
    a = abs(m)
    out.append({
        "slug": slug, "name": name, "region": region, "area": area,
        "country": next(c for s, _, c in REGIONS if s == region),
        "lat": lat, "lon": lon, "tz": tz, "featured": featured,
        "mlat": round(m, 1),
        "kpFaint": kp_needed(a, FAR_MARGIN),
        "kpVisible": kp_needed(a, EASY_MARGIN),
        "kpOverhead": kp_needed(a, 0.0),
        "bearing": bearing_to_aurora(lat, lon),
    })

data = {
    "epoch": EPOCH.strftime("%Y-%m-%d"),
    "model": f"AACGM-v2 (aacgmv2 {aacgmv2.__version__}), ground level",
    "kpBoundary": KP_BOUNDARY,
    "easyMarginDeg": EASY_MARGIN,
    "farMarginDeg": FAR_MARGIN,
    "regions": [{"slug": s, "name": n, "country": c} for s, n, c in REGIONS],
    "locations": out,
}
(ROOT / "src/data/locations.json").write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")

# Coarse grid for visitors who use their own coordinates (bilinear interpolation in the browser).
LAT0, LAT1, LON0, LON1, STEP = -56, -8, 110, 190, 2
lats = list(range(LAT0, LAT1 + 1, STEP))
lons = list(range(LON0, LON1 + 1, STEP))
grid = [[round(mlat(la, lo), 2) for lo in lons] for la in lats]
(ROOT / "src/data/mlat-grid.json").write_text(json.dumps({
    "epoch": data["epoch"], "lat0": LAT0, "lon0": LON0, "step": STEP,
    "rows": len(lats), "cols": len(lons), "values": grid,
}, separators=(",", ":")) + "\n")


def interp(lat, lon):
    y = (lat - LAT0) / STEP
    x = (lon - LON0) / STEP
    i, j = int(math.floor(y)), int(math.floor(x))
    fy, fx = y - i, x - j
    g = grid
    return (g[i][j] * (1 - fx) + g[i][j + 1] * fx) * (1 - fy) + (g[i + 1][j] * (1 - fx) + g[i + 1][j + 1] * fx) * fy


worst = max(abs(interp(l["lat"], l["lon"]) - mlat(l["lat"], l["lon"])) for l in out)
print(f"{len(out)} locations, grid {len(lats)}x{len(lons)}, worst interpolation error {worst:.3f} deg")
for l in out:
    print(f"{l['name']:20s} mlat {l['mlat']:6.1f}  faint {l['kpFaint']}  visible {l['kpVisible']}  overhead {l['kpOverhead']}  bearing {l['bearing']}")
