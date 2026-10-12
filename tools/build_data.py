#!/usr/bin/env python3
"""
PAT (Pokemon-Attack-Tool) - Data Generator
============================

Generates data from the open PokeAPI dataset (same content as the
Pokewiki Pokémon list: all Pokémon + names in DE/EN/FR/JA/KO/ZH)
and the type table from pokemondb.net:
  
../database/02_data.sql      -> Import into MySQL / MariaDB
  ../assets/data/pokedex.js    -> Fallback if the API is unavailable

Run (e.g., when new Pokémon are released):
  
python3 tools/build_data.py            # downloads the CSVs yourself
  python3 tools/build_data.py ./csv      # or uses a local folder

Dual types are NOT stored, but are multiplied from the single table
(this is exactly how pokemondb.net/type/dual is generated).
"""
import csv, io, json, os, sys, urllib.request
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_BASE = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/"
FILES = ["languages", "pokemon", "pokemon_species_names", "pokemon_types",
         "pokemon_forms", "pokemon_form_names", "types", "type_names", "type_efficacy"]

# ---------------------------------------------------------------- Sprachen
# Sprachen der App (Anzeige). PokeAPI-language-id -> unser Code.
APP_LANGS = [  # code, pokeapi id, Eigenname, (ungenutzt)
    ("de", 6,  "Deutsch",  1),
    ("en", 9,  "English",  1),
    ("fr", 5,  "Français", 0),
    ("ja", 11, "日本語",    0),
    ("ko", 3,  "한국어",    0),
    ("zh", 12, "简体中文",  0),
]
# Zusaetzliche Schreibweisen, die nur fuer die Suche dienen.
ALIAS_LANGS = {1: "ja-kana", 2: "ja-romaji", 4: "zh-hant"}

# ---------------------------------------------------------------- Typen
TYPE_ORDER = ["normal", "fire", "water", "electric", "grass", "ice", "fighting",
              "poison", "ground", "flying", "psychic", "bug", "rock", "ghost",
              "dragon", "dark", "steel", "fairy"]
TYPE_COLORS = {
    "normal": "#A8A77A", "fire": "#EE8130", "water": "#6390F0", "electric": "#F7D02C",
    "grass": "#7AC74C", "ice": "#96D9D6", "fighting": "#C22E28", "poison": "#A33EA1",
    "ground": "#E2BF65", "flying": "#A98FF3", "psychic": "#F95587", "bug": "#A6B91A",
    "rock": "#B6A136", "ghost": "#735797", "dragon": "#6F35FC", "dark": "#705746",
    "steel": "#B7B7CE", "fairy": "#D685AD",
}

# Typentabelle von https://pokemondb.net/type (Gen 6+), Angreifer = Zeile,
# Verteidiger = Spalte, gleiche Reihenfolge wie TYPE_ORDER.
# '.' = 1x, 'h' = 0.5x, '2' = 2x, '0' = 0x
POKEMONDB_CHART = {
    "normal":   "............h0..h.",
    "fire":     ".hh.22.....2h.h.2.",
    "water":    ".2h.h...2...2.h...",
    "electric": "..2hh...02....h...",
    "grass":    ".h2.h..h2h.h2.h.h.",
    "ice":      ".hh.2h..22....2.h.",
    "fighting": "2....2.h.hhh20.22h",
    "poison":   "....2..hh...hh..02",
    "ground":   ".2.2h..2.0.h2...2.",
    "flying":   "...h2.2....2h...h.",
    "psychic":  "......22..h....0h.",
    "bug":      ".h..2.hh.h2..h.2hh",
    "rock":     ".2...2h.h2.2....h.",
    "ghost":    "0.........2..2.h..",
    "dragon":   "..............2.h0",
    "dark":     "......h...2..2.h.h",
    "steel":    ".hhh.2......2...h2",
    "fairy":    ".h....2h......22h.",
}
SYM = {".": 100, "h": 50, "2": 200, "0": 0}

REGIONAL = ("-alola", "-galar", "-hisui", "-paldea")
SKIP_FORMS = ("-totem", "-gmax", "-cap")   # Duplikate ohne eigenen Typen-Nutzen

# Namensmuster fuer Formen, die in der Quelle nicht in jeder Sprache
# einen fertigen Namen haben. {b} = Name der Grundform.
REGION_PATTERN = {
    "alola":  {"de": "Alola-{b}",  "en": "Alolan {b}",   "fr": "{b} d’Alola",
               "ja": "{b}（アローラのすがた）", "ko": "{b}(알로라의 모습)", "zh": "{b}（阿罗拉的样子）"},
    "galar":  {"de": "Galar-{b}",  "en": "Galarian {b}", "fr": "{b} de Galar",
               "ja": "{b}（ガラルのすがた）", "ko": "{b}(가라르의 모습)", "zh": "{b}（伽勒尔的样子）"},
    "hisui":  {"de": "Hisui-{b}",  "en": "Hisuian {b}",  "fr": "{b} de Hisui",
               "ja": "{b}（ヒスイのすがた）", "ko": "{b}(히스이의 모습)", "zh": "{b}（洗翠的样子）"},
    "paldea": {"de": "Paldea-{b}", "en": "Paldean {b}",  "fr": "{b} de Paldea",
               "ja": "{b}（パルデアのすがた）", "ko": "{b}(팔데아의 모습)", "zh": "{b}（帕底亚的样子）"},
}
FORM_SUFFIX = {
    "combat-breed": {"de": "Gefechtsrasse", "en": "Combat Breed", "fr": "Race Combative",
                     "ja": "コンバット種", "ko": "컴뱃종", "zh": "斗战种"},
    "blaze-breed":  {"de": "Flammenrasse", "en": "Blaze Breed", "fr": "Race Flamboyante",
                     "ja": "ブレイズ種", "ko": "블레이즈종", "zh": "火炽种"},
    "aqua-breed":   {"de": "Flutenrasse", "en": "Aqua Breed", "fr": "Race Aquatique",
                     "ja": "ウォーター種", "ko": "워터종", "zh": "水澜种"},
    "zen":          {"de": "Trance", "en": "Zen Mode", "fr": "Mode Transe",
                     "ja": "ダルマモード", "ko": "달마모드", "zh": "达摩模式"},
}
MEGA_PATTERN = {"de": "Mega-{b}{s}", "en": "Mega {b}{s}", "fr": "Méga-{b}{s}",
                "ja": "メガ{b}{s}", "ko": "메가{b}{s}", "zh": "超级{b}{s}"}


def load(src):
    data = {}
    for f in FILES:
        if src:
            with open(os.path.join(src, f + ".csv"), encoding="utf-8") as fh:
                text = fh.read()
        else:
            text = urllib.request.urlopen(CSV_BASE + f + ".csv").read().decode("utf-8")
        data[f] = list(csv.DictReader(io.StringIO(text)))
    return data


def sql(v):
    if v is None:
        return "NULL"
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def main():
    d = load(sys.argv[1] if len(sys.argv) > 1 else None)
    lang_by_id = {c[1]: c[0] for c in APP_LANGS}

    # ---------------- Typen + Tabelle
    type_by_pid = {int(r["id"]): r["identifier"] for r in d["types"]}
    chart = {a: {} for a in TYPE_ORDER}
    for a in TYPE_ORDER:
        row = POKEMONDB_CHART[a]
        assert len(row) == 18, a
        for i, t in enumerate(TYPE_ORDER):
            chart[a][t] = SYM[row[i]]
    # Abgleich mit PokeAPI
    diffs = 0
    for r in d["type_efficacy"]:
        a, t = type_by_pid.get(int(r["damage_type_id"])), type_by_pid.get(int(r["target_type_id"]))
        if a in chart and t in chart:
            if chart[a][t] != int(r["damage_factor"]):
                diffs += 1
                print("ABWEICHUNG", a, t, chart[a][t], r["damage_factor"])
    print(f"Typentabelle pokemondb vs. PokeAPI: {diffs} Abweichungen")

    type_names = defaultdict(dict)
    for r in d["type_names"]:
        t = type_by_pid.get(int(r["type_id"]))
        lid = int(r["local_language_id"])
        if t in chart and lid in lang_by_id:
            type_names[t][lang_by_id[lid]] = r["name"]

    # ---------------- Pokémon
    species_names = defaultdict(dict)   # species -> lang -> name
    species_alias = defaultdict(dict)
    for r in d["pokemon_species_names"]:
        sid, lid = int(r["pokemon_species_id"]), int(r["local_language_id"])
        if lid in lang_by_id:
            species_names[sid][lang_by_id[lid]] = r["name"]
        elif lid in ALIAS_LANGS and r["name"]:
            species_alias[sid][ALIAS_LANGS[lid]] = r["name"]

    ptypes = defaultdict(list)
    for r in sorted(d["pokemon_types"], key=lambda r: int(r["slot"])):
        ptypes[int(r["pokemon_id"])].append(type_by_pid[int(r["type_id"])])

    default_form = {}  # pokemon_id -> form_id
    for r in d["pokemon_forms"]:
        if r["is_default"] == "1":
            default_form[int(r["pokemon_id"])] = int(r["id"])
    form_names = defaultdict(dict)   # form_id -> lid -> (form_name, pokemon_name)
    for r in d["pokemon_form_names"]:
        form_names[int(r["pokemon_form_id"])][int(r["local_language_id"])] = (r["form_name"], r["pokemon_name"])

    pokemon = d["pokemon"]
    default_types = {int(p["species_id"]): ptypes[int(p["id"])] for p in pokemon if p["is_default"] == "1"}

    entries = []
    for p in pokemon:
        pid, sid = int(p["id"]), int(p["species_id"])
        types = ptypes.get(pid)
        if not types or any(t not in chart for t in types):
            continue
        is_default = p["is_default"] == "1"
        slug = p["identifier"]
        if not is_default and any(x in slug for x in SKIP_FORMS):
            continue
        if not is_default:
            # Nur Formen aufnehmen, die fuer die Typen-Frage relevant sind:
            # andere Typen als die Grundform, oder Regionalformen (findbar per Suche).
            if types == default_types.get(sid) and not any(x in slug for x in REGIONAL):
                continue
        names, alias = {}, dict(species_alias[sid])
        fn = form_names.get(default_form.get(pid), {})
        for code, lid, _, _ in APP_LANGS:
            base = species_names[sid].get(code)
            if is_default or not fn:
                name = base
            else:
                form_name, full = fn.get(lid, ("", ""))
                if full:
                    name = full
                elif form_name and base and (base in form_name or form_name.startswith("Mega")
                                             or "メガ" in form_name or "메가" in form_name or "超级" in form_name):
                    name = form_name if base in form_name else f"{base} ({form_name})"
                elif form_name and base:
                    name = f"{base} ({form_name})"
                else:
                    en = fn.get(9, ("", ""))
                    name = (f"{base} ({en[0]})" if base and en[0] else en[1] or base)
            region = next((r[1:] for r in REGIONAL if r in slug), None)
            if not is_default and base and region:
                if code in ("de", "ja", "ko", "zh") or not name or "(" in name:
                    name = REGION_PATTERN[region][code].format(b=base)
                    suf = next((v[code] for k, v in FORM_SUFFIX.items() if slug.endswith(k)), None)
                    if suf:
                        name += f" ({suf})"
            elif not is_default and base and "-mega" in slug and (not name or "(" in name):
                tail = slug.split("-mega", 1)[1].strip("-").upper()
                name = MEGA_PATTERN[code].format(b=base, s=(" " + tail) if tail else "")
            if name:
                names[code] = name
        if not is_default:
            # Reine Formbezeichnungen ("アローラのすがた") taugen nicht als Suchbegriff.
            alias = {k: v for k, v in alias.items()}
            for lid, label in ALIAS_LANGS.items():
                full = fn.get(lid, ("", ""))
                if full[1]:
                    alias[label + "-form"] = full[1]
        entries.append({
            "id": pid, "no": sid, "slug": slug, "def": 1 if is_default else 0,
            "order": sid * 100000 + (0 if is_default else int(p["order"] or 0) + 1),
            "t": types, "n": names, "a": alias,
        })
    entries.sort(key=lambda e: (e["order"], e["id"]))
    for i, e in enumerate(entries):
        e["order"] = i + 1

    missing = [(e["slug"], c) for e in entries for c in ("de", "en") if c not in e["n"]]
    print(f"{len(entries)} Einträge ({sum(e['def'] for e in entries)} Pokémon + "
          f"{sum(1 - e['def'] for e in entries)} Formen), fehlende DE/EN-Namen: {missing[:10]}")

    # ---------------- assets/data/pokedex.js
    payload = {
        "version": len(entries),
        "languages": [{"code": c, "name": n} for c, _, n, _ in APP_LANGS],
        "types": [{"id": t, "color": TYPE_COLORS[t], "n": type_names[t]} for t in TYPE_ORDER],
        "chart": [[chart[a][t] for t in TYPE_ORDER] for a in TYPE_ORDER],
        "pokemon": [{"id": e["id"], "no": e["no"], "t": e["t"], "n": e["n"],
                     **({"a": list(dict.fromkeys(e["a"].values()))} if e["a"] else {})}
                    for e in entries],
    }
    os.makedirs(os.path.join(ROOT, "assets", "data"), exist_ok=True)
    with open(os.path.join(ROOT, "assets", "data", "pokedex.js"), "w", encoding="utf-8") as fh:
        fh.write("/* Automatisch erzeugt von tools/build_data.py - nicht von Hand bearbeiten.\n"
                 "   Fallback-Daten, falls api/pokedex.php nicht erreichbar ist. */\n")
        fh.write("window.TC_POKEDEX=")
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write(";\n")

    # ---------------- database/02_data.sql
    out = ["-- Automatisch erzeugt von tools/build_data.py",
           "SET NAMES utf8mb4;", "SET FOREIGN_KEY_CHECKS = 0;",
           *[f"TRUNCATE TABLE {t};" for t in ("pokemon_aliases", "pokemon_names", "pokemon",
                                              "type_efficacy", "type_names", "types", "languages")],
           "SET FOREIGN_KEY_CHECKS = 1;", ""]

    def insert(table, cols, rows, chunk=400):
        for i in range(0, len(rows), chunk):
            vals = ",\n".join("(" + ",".join(sql(v) for v in r) + ")" for r in rows[i:i + chunk])
            out.append(f"INSERT INTO {table} ({','.join(cols)}) VALUES\n{vals};")

    insert("languages", ["code", "native_name", "sort_order"],
           [(c, n, i + 1) for i, (c, _, n, _) in enumerate(APP_LANGS)])
    insert("types", ["id", "slug", "color", "sort_order"],
           [(i + 1, t, TYPE_COLORS[t], i + 1) for i, t in enumerate(TYPE_ORDER)])
    tid = {t: i + 1 for i, t in enumerate(TYPE_ORDER)}
    insert("type_names", ["type_id", "lang_code", "name"],
           [(tid[t], c, type_names[t][c]) for t in TYPE_ORDER for c, *_ in APP_LANGS if c in type_names[t]])
    insert("type_efficacy", ["attacking_type_id", "defending_type_id", "factor_percent"],
           [(tid[a], tid[t], chart[a][t]) for a in TYPE_ORDER for t in TYPE_ORDER])
    insert("pokemon", ["id", "dex_no", "slug", "is_default", "sort_order", "type1_id", "type2_id"],
           [(e["id"], e["no"], e["slug"], e["def"], e["order"], tid[e["t"][0]],
             tid[e["t"][1]] if len(e["t"]) > 1 else None) for e in entries])
    insert("pokemon_names", ["pokemon_id", "lang_code", "name"],
           [(e["id"], c, n) for e in entries for c, n in e["n"].items()])
    insert("pokemon_aliases", ["pokemon_id", "label", "alias"],
           [(e["id"], k, v) for e in entries for k, v in e["a"].items()])
    with open(os.path.join(ROOT, "database", "02_data.sql"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(out) + "\n")
    print("fertig.")


if __name__ == "__main__":
    main()
