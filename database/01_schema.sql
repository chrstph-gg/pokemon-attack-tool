SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS languages (
  code         VARCHAR(10)  NOT NULL,
  native_name  VARCHAR(40)  NOT NULL,
  sort_order   TINYINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS types (
  id          TINYINT UNSIGNED NOT NULL,
  slug        VARCHAR(20)      NOT NULL,
  color       CHAR(7)          NOT NULL,
  sort_order  TINYINT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_types_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS type_names (
  type_id    TINYINT UNSIGNED NOT NULL,
  lang_code  VARCHAR(10)      NOT NULL,
  name       VARCHAR(40)      NOT NULL,
  PRIMARY KEY (type_id, lang_code),
  CONSTRAINT fk_tn_type FOREIGN KEY (type_id)   REFERENCES types (id)       ON DELETE CASCADE,
  CONSTRAINT fk_tn_lang FOREIGN KEY (lang_code) REFERENCES languages (code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS type_efficacy (
  attacking_type_id  TINYINT UNSIGNED  NOT NULL,
  defending_type_id  TINYINT UNSIGNED  NOT NULL,
  factor_percent     SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (attacking_type_id, defending_type_id),
  CONSTRAINT fk_te_att FOREIGN KEY (attacking_type_id) REFERENCES types (id) ON DELETE CASCADE,
  CONSTRAINT fk_te_def FOREIGN KEY (defending_type_id) REFERENCES types (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pokemon (
  id          INT UNSIGNED      NOT NULL,
  dex_no      SMALLINT UNSIGNED NOT NULL,
  slug        VARCHAR(60)       NOT NULL,
  is_default  TINYINT(1)        NOT NULL DEFAULT 1,
  sort_order  INT UNSIGNED      NOT NULL,
  type1_id    TINYINT UNSIGNED  NOT NULL,
  type2_id    TINYINT UNSIGNED  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pokemon_slug (slug),
  KEY ix_pokemon_dex (dex_no),
  CONSTRAINT fk_p_t1 FOREIGN KEY (type1_id) REFERENCES types (id),
  CONSTRAINT fk_p_t2 FOREIGN KEY (type2_id) REFERENCES types (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pokemon_names (
  pokemon_id  INT UNSIGNED NOT NULL,
  lang_code   VARCHAR(10)  NOT NULL,
  name        VARCHAR(100) NOT NULL,
  PRIMARY KEY (pokemon_id, lang_code),
  KEY ix_pn_name (name),
  CONSTRAINT fk_pn_p    FOREIGN KEY (pokemon_id) REFERENCES pokemon (id)     ON DELETE CASCADE,
  CONSTRAINT fk_pn_lang FOREIGN KEY (lang_code)  REFERENCES languages (code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pokemon_aliases (
  pokemon_id  INT UNSIGNED NOT NULL,
  label       VARCHAR(30)  NOT NULL,
  alias       VARCHAR(100) NOT NULL,
  PRIMARY KEY (pokemon_id, label),
  CONSTRAINT fk_pa_p FOREIGN KEY (pokemon_id) REFERENCES pokemon (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
