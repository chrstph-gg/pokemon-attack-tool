# PAT (Pokemon-Attack-Tool)

> Pick a Pokémon and instantly see which attack types are super effective, effective, neutral, not very effective or have no effect against it.

![Version](https://img.shields.io/badge/version-1.0.0-0b6e68)
![PHP](https://img.shields.io/badge/PHP-7.4%2B-777bb4)
![MySQL](https://img.shields.io/badge/MySQL-5.7%2B%20%7C%20MariaDB%2010.3%2B-00758f)
![License](https://img.shields.io/badge/license-MIT-3da639)

A small, fast web tool that combines a complete Pokémon list with the official type chart. Search for any Pokémon by name or National Dex number in six languages, and get its types plus the effectiveness of all 18 attack types, grouped from 4× down to 0×. Runs with a MySQL backend or entirely static without a database.

---

## Features

- **Complete Pokédex** - all 1025 Pokémon plus 106 forms with their own typing (regional forms, Megas, Rotom, Castform, Ogerpon and more).
- **Five-step damage scale** - Super effective (4×), Effective (2×), Neutral (1×), Not very effective (½× and ¼×, quarter damage marked separately) and No effect (0×).
- **Multilingual search** - every search covers all languages at once, regardless of the UI language: German, English, French, Japanese (kana, kanji and rōmaji), Korean and Chinese (simplified and traditional).
- **Forgiving input** - ignores case, accents (`flabebe` finds Flabébé), word order (`raichu alola`), full-width characters, and converts Hiragana to Katakana.
- **Multilingual UI** - German and English included, French, Japanese, Korean and Chinese prepared for translation. Pokémon and type names are already available in all six languages.
- **Accessible combobox** - full keyboard control (arrows, Page Up/Down, Enter, Escape), ARIA roles, screen reader announcements, IME-safe Enter for Japanese/Korean input.
- **Deep links** - `index.html#6` opens Charizard, `?lang=en` forces English.
- **Optional database** - MySQL/MariaDB via a small PHP API with ETag caching, automatic fallback to a static data file.
- **Apple-style dark UI** - system typography with size-specific tracking, translucent materials, ambient light tinted by the selected Pokémon's primary type, critically damped motion.
- **Editor-safe animations** - animations only run in a real browser, never in the Bootstrap Studio canvas.
- **Accessibility settings respected** - `prefers-reduced-motion`, `prefers-reduced-transparency` and `prefers-contrast`.

## Project Structure

```
index.html
assets/css/styles.css
assets/js/app.js
assets/js/i18n/            de.js, en.js, fr.js, ja.js, ko.js, zh.js
assets/data/pokedex.js     static fallback data (generated)
api/pokedex.php            JSON API reading from MySQL
api/config.sample.php      template for database credentials
database/01_schema.sql     tables
database/02_data.sql       data (generated)
tools/build_data.py        rebuilds 02_data.sql and pokedex.js
```

## Installation

### Static (no database)

1. Upload everything except `api/` and `database/` to any web host.
2. Disable the API request by adding this line in `index.html` right before `app.js`:

```html
<script>window.TC_CONFIG = { apiUrl: "" };</script>
```

That's it. The page also works when opened locally via `file://`.

### With MySQL / MariaDB

1. Create a database (`utf8mb4`) and import both SQL files in order:

```bash
mysql -u USER -p DATABASE < database/01_schema.sql
mysql -u USER -p DATABASE < database/02_data.sql
```

2. Copy `api/config.sample.php` to `api/config.php` and enter your credentials.
3. Upload everything to a web host with PHP 7.4+.

If the API is unreachable (no PHP, database down, local preview), the page automatically falls back to `assets/data/pokedex.js`.

## Usage & Testing

Open a Pokémon directly:

```
index.html#6        Charizard
index.html#10100    Alolan Raichu (forms use PokeAPI ids from 10001)
index.html?lang=en  force English UI
```

Test the API:

```bash
curl https://your-domain.tld/api/pokedex.php | head -c 300
```

Check ETag caching (second request should return `304`):

```bash
ETAG=$(curl -sI https://your-domain.tld/api/pokedex.php | grep -i etag | cut -d' ' -f2 | tr -d '\r')
curl -s -o /dev/null -w "%{http_code}\n" -H "If-None-Match: $ETAG" https://your-domain.tld/api/pokedex.php
```

Query matchups directly in SQL (example: Charizard, id 6):

```sql
SELECT t.slug AS attack_type,
       e1.factor_percent * COALESCE(e2.factor_percent, 100) / 10000 AS multiplier
FROM pokemon p
JOIN types t
JOIN type_efficacy e1 ON e1.attacking_type_id = t.id AND e1.defending_type_id = p.type1_id
LEFT JOIN type_efficacy e2 ON e2.attacking_type_id = t.id AND e2.defending_type_id = p.type2_id
WHERE p.id = 6
ORDER BY multiplier DESC, t.sort_order;
```

## Configuration

Override settings without touching `app.js` by defining `window.TC_CONFIG` before the script:

| Option | Default | Description |
| --- | --- | --- |
| `apiUrl` | `api/pokedex.php` | API endpoint. Empty string skips the API and uses the static data. |
| `fallbackScript` | `assets/data/pokedex.js` | Static data file. |
| `spriteUrl` | PokeAPI sprites on GitHub | Small images in the list. Empty string hides them. `{id}` is replaced. |
| `artworkUrl` | PokeAPI official artwork | Large image in the result. Empty string hides it. |
| `defaultLang` | `de` | Language used when no preference is detected. |
| `fallbackLang` | `en` | Used for missing translations. |
| `pageSize` | `60` | Number of list entries rendered per batch while scrolling. |

## Adding a Language

1. Open e.g. `assets/js/i18n/fr.js`.
2. Translate all empty strings. Untranslated strings fall back to English. Keep placeholders such as `{name}` unchanged.
3. Set `enabled: true` in the `_meta` block.

The language appears in the language picker automatically. The UI language is chosen from the URL, a saved preference or the browser language.

## Updating the Data

When new Pokémon are released:

```bash
python3 tools/build_data.py            # downloads the latest data
python3 tools/build_data.py ./csv      # or uses a local folder of CSV files
```

The script verifies the type chart, then rewrites `database/02_data.sql` and `assets/data/pokedex.js`. Static setups only need the new `pokedex.js`. Database setups re-import `02_data.sql`, which clears the tables itself.

## Notes & Limitations

> [!IMPORTANT]
> `app.js` must stay in the `<head>` **without** `defer`, so the classes are set before the first paint. Otherwise content may briefly flash in its hidden start state.

> [!NOTE]
> - **Abilities and items** such as Levitate, Flash Fire or Air Balloon can change effectiveness in battle. The tool shows type matchups only.
> - **Type chart** covers Generation 6 onwards (X/Y to today). Older games differ slightly (no Fairy type, Steel resisted Ghost and Dark).
> - **Dual types** are not stored but calculated by multiplying both single-type factors, exactly how dual type charts are derived.
> - **Forms** are included when their typing differs from the base form, plus all regional forms so they can be found by name. Totem and Gigantamax duplicates are skipped.
> - **Images** are hotlinked from the PokeAPI sprites repository on GitHub. Without internet, everything works except the images.

## Data Sources

- **Pokémon, forms and names in all languages:** [PokeAPI](https://github.com/PokeAPI/pokeapi) dataset (same content as the [PokéWiki Pokémon list](https://www.pokewiki.de/Pok%C3%A9mon-Liste), in machine-readable form).
- **Type chart:** [Pokémon Database](https://pokemondb.net/type), cross-checked against PokeAPI on every build.
- **Images:** [PokeAPI sprites](https://github.com/PokeAPI/sprites).

## Changelog

### 1.0.0
- Initial release: Pokémon selection with multilingual search, type badges and five-step damage scale.
- 1025 Pokémon plus 106 forms with names in six languages.
- MySQL schema, PHP JSON API with ETag caching, static fallback data.
- German and English UI, French, Japanese, Korean and Chinese prepared for translation.
- Dark UI with animations and accessibility media queries.
- Build script for data updates with automatic type chart verification.

## License

Code released under the [MIT License](https://opensource.org/licenses/MIT).

Pokémon and all related names are trademarks of Nintendo, Game Freak and The Pokémon Company. This is an unofficial fan project and is not affiliated with or endorsed by them.
