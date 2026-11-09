#!/usr/bin/env python3
# assetkit.fetch_textures — CC0 PBR texture sets from ambientCG, cached locally with credits.
#
#   python3 scripts/blender/assetkit/fetch_textures.py plaster=PaintedPlaster017 brick=Bricks059 grass ...
#
# Each argument is `key[=AssetId]`. Without an id the key is used as a search query and the
# most popular match wins. Files land in ~/.cache/vsim-assets/ambientcg/<AssetId>/ (only image
# files are extracted from the zip — archives are untrusted input), and an index.json maps
# key -> {id, maps{color, normal, roughness, ao, displacement}, license, url} so builders can
# look textures up by role ("plaster", "roof_tiles", ...). ambientCG assets are CC0.
import io, json, os, re, sys, urllib.parse, urllib.request, zipfile

CACHE = os.path.expanduser("~/.cache/vsim-assets/ambientcg")
API = "https://ambientcg.com/api/v2/full_json"
UA = {"User-Agent": "vsim-assetkit/0.1"}
ROLE = {"Color": "color", "NormalGL": "normal", "Roughness": "roughness", "AmbientOcclusion": "ao",
        "Displacement": "displacement", "Opacity": "opacity", "Metalness": "metalness"}


def _get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def resolve(query):
    q = urllib.parse.urlencode({"type": "Material", "q": query, "limit": 1, "sort": "Popular", "include": "downloadData"})
    d = json.loads(_get(API + "?" + q))
    assets = d.get("foundAssets", [])
    if not assets:
        raise SystemExit("no ambientCG material for query %r" % query)
    return assets[0]["assetId"]


def fetch(asset_id, res="1K-JPG"):
    folder = os.path.join(CACHE, asset_id)
    maps = {}
    if os.path.isdir(folder):
        for f in os.listdir(folder):
            for suffix, role in ROLE.items():
                if re.search(r"_%s\.(jpg|png)$" % suffix, f):
                    maps[role] = os.path.join(folder, f)
        if "color" in maps:
            return maps
    os.makedirs(folder, exist_ok=True)
    data = _get("https://ambientcg.com/get?file=%s_%s.zip" % (asset_id, res))
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for info in z.infolist():
            name = os.path.basename(info.filename)          # flatten; never trust paths in the archive
            if not re.fullmatch(r"[A-Za-z0-9_\-.]+\.(jpg|png)", name):
                continue
            for suffix, role in ROLE.items():
                if re.search(r"_%s\.(jpg|png)$" % suffix, name):
                    out = os.path.join(folder, name)
                    with open(out, "wb") as fh:
                        fh.write(z.read(info))
                    maps[role] = out
    return maps


def main(args):
    os.makedirs(CACHE, exist_ok=True)
    idx_path = os.path.join(CACHE, "index.json")
    index = json.load(open(idx_path)) if os.path.exists(idx_path) else {}
    for a in args:
        key, _, aid = a.partition("=")
        aid = aid or resolve(key.replace("_", " "))
        try:
            maps = fetch(aid)
        except Exception as e:  # unknown id / moved asset: fall back to a search by role name
            print("  %s: %s (%s) -> searching %r" % (key, aid, e, key.replace("_", " ")))
            aid = resolve(key.replace("_", " ")); maps = fetch(aid)
        index[key] = {"id": aid, "maps": maps, "license": "CC0 1.0 (ambientCG)",
                      "url": "https://ambientcg.com/view?id=" + aid}
        print("%-12s %-22s %s" % (key, aid, ",".join(sorted(maps))))
    json.dump(index, open(idx_path, "w"), indent=2)
    print("index:", idx_path)


if __name__ == "__main__":
    main(sys.argv[1:])
