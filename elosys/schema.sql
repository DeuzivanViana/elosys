-- Elosys — SQLite schema.
--
-- Execution model: REWRITE-ONLY (see ADs/imutabilidade.md).
--   `elosys` builds the whole database in one run, from an empty file to the
--   finished `.db`. To refresh the data you delete the file and build again.
--   There is no incremental update, no append-only ledger, no in-place
--   correction: a wrong value is a parser bug -> fix the code, rebuild.
--   Non-repudiation comes from determinism + a published input manifest
--   (manifest.json, committed to git), not from triggers or a hash chain.
--
-- Conventions (see ADs/banco.md):
--   ids     -> INTEGER PRIMARY KEY (rowid alias)
--   dates   -> TEXT ISO-8601 UTC ('2026-09-03T12:00:00Z') or 'YYYY-MM-DD'
--   money   -> INTEGER (cents)
--   json    -> TEXT (json_* functions)
--   boolean -> INTEGER 0/1

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------
-- PROVENANCE: source -> collection -> collection_file -> parse -> record
-- (see ADs/confiabilidade.md). Every data row carries provenance_id -> parse.id.
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS source (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,          -- 'TSE - consulta_cand'
    agency      TEXT NOT NULL,          -- 'Tribunal Superior Eleitoral'
    type        TEXT NOT NULL,          -- 'csv' | 'api' | 'scraping'
    base_url    TEXT NOT NULL,
    legal_basis TEXT,                   -- rule/decision that makes the data public
    notes       TEXT,
    created_at  TEXT NOT NULL,
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS collection (
    id               INTEGER PRIMARY KEY,
    source_id        INTEGER NOT NULL REFERENCES source(id),
    url              TEXT NOT NULL,      -- full URL accessed
    http_status      INTEGER,
    accessed_at      TEXT NOT NULL,      -- when WE accessed it (UTC)
    payload_sha256   TEXT NOT NULL,      -- hash of the file as downloaded (the .zip)
    size_bytes       INTEGER NOT NULL,
    content_type     TEXT,
    collector_commit TEXT,               -- git SHA of the collecting code
    notes            TEXT
);
CREATE INDEX IF NOT EXISTS ix_collection_dedup ON collection (url, payload_sha256);

-- One file inside a collection (each CSV extracted from the .zip).
CREATE TABLE IF NOT EXISTS collection_file (
    id            INTEGER PRIMARY KEY,
    collection_id INTEGER NOT NULL REFERENCES collection(id),
    filename      TEXT NOT NULL,         -- 'consulta_cand_2022_BRASIL.csv'
    sha256        TEXT NOT NULL,
    size_bytes    INTEGER NOT NULL,
    UNIQUE (collection_id, filename)
);

CREATE TABLE IF NOT EXISTS parse (
    id                 INTEGER PRIMARY KEY,
    collection_id      INTEGER NOT NULL REFERENCES collection(id),
    collection_file_id INTEGER REFERENCES collection_file(id),  -- NULL = the whole collection
    parser_name        TEXT NOT NULL,    -- 'tse.candidates'
    parser_commit      TEXT,
    parser_version     TEXT NOT NULL,
    rows_extracted     INTEGER NOT NULL DEFAULT 0,
    rows_rejected      INTEGER NOT NULL DEFAULT 0,
    run_at             TEXT NOT NULL
);

-- Extra sources for a row (multi-source / per-field) — see ADs/confiabilidade.md §3.
-- Unused in this slice (single source); kept for campaign finance / photos later.
CREATE TABLE IF NOT EXISTS record_sources (
    table_name TEXT NOT NULL,
    record_id  INTEGER NOT NULL,
    field      TEXT,                     -- NULL = the whole row
    parse_id   INTEGER NOT NULL REFERENCES parse(id),
    PRIMARY KEY (table_name, record_id, field, parse_id)
);

-- ------------------------------------------------------------------
-- IDENTITY (see ADs/identidade.md)
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS people (
    id             INTEGER PRIMARY KEY,
    cpf            TEXT,                  -- 11 digits; may be NULL (2024 masked); NOT unique alone
    cpf_trusted    INTEGER NOT NULL DEFAULT 0,
    voter_id       TEXT,                  -- título eleitoral; primary match key
    canonical_name TEXT,
    created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_people_cpf      ON people (cpf) WHERE cpf IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_people_voter_id ON people (voter_id) WHERE voter_id IS NOT NULL;

-- CPF values dropped for being ambiguous (see promote step / ADs/identidade.md).
-- A dropped CPF is NULL on every politician_history row; this table records *why*.
CREATE TABLE IF NOT EXISTS rejected_cpf (
    cpf                TEXT PRIMARY KEY,
    reason             TEXT NOT NULL,   -- 'multiple_voter_ids' | 'voter_id_multiple_cpf'
    distinct_voter_ids INTEGER,
    distinct_names     INTEGER,
    recorded_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
    id         INTEGER PRIMARY KEY,
    cnpj       TEXT NOT NULL UNIQUE,     -- 14 digits
    legal_name TEXT,
    kind       TEXT,                     -- 'campaign' (natureza jurídica 409-4) | ...
    created_at TEXT NOT NULL
);

-- ------------------------------------------------------------------
-- DATA: campaign finance — prestação de contas eleitorais
-- Crawler: elosys/tse/accounts.py  (source 'TSE - prestacao_contas')
-- ------------------------------------------------------------------

-- The dedicated CNPJ each candidacy opens for the campaign (Receita natureza 409-4).
-- One row per (year, candidacy, cnpj). Sourced from receitas_candidatos_*.csv.
CREATE TABLE IF NOT EXISTS campaign_org (
    id               INTEGER PRIMARY KEY,
    company_id       INTEGER NOT NULL REFERENCES companies(id),
    person_id        INTEGER REFERENCES people(id),
    cnpj             TEXT NOT NULL,          -- NR_CNPJ_PRESTADOR_CONTA
    tse_candidacy_id TEXT,                   -- SQ_CANDIDATO -> politician_history
    accountant_id    TEXT,                   -- SQ_PRESTADOR_CONTAS
    year             INTEGER NOT NULL,
    candidate_cpf    TEXT,
    candidate_name   TEXT,
    normalized_name  TEXT,
    office           TEXT,
    party_abbr       TEXT,
    state            TEXT,
    provenance_id    INTEGER NOT NULL REFERENCES parse(id),
    collected_at     TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_campaign_org ON campaign_org (year, tse_candidacy_id, cnpj);
CREATE INDEX IF NOT EXISTS ix_campaign_org_person ON campaign_org (person_id);
CREATE INDEX IF NOT EXISTS ix_campaign_org_cnpj   ON campaign_org (cnpj);

-- ------------------------------------------------------------------
-- DATA: politician history (see ADs/politician.md)
-- One row per candidacy per election/round. No "current politician" row.
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS politician_history (
    id               INTEGER PRIMARY KEY,
    person_id        INTEGER NOT NULL REFERENCES people(id),

    -- identity as it came from the source (CPF already cleaned by promote)
    cpf              TEXT,               -- NULL when masked (2024) or dropped as ambiguous
    cpf_trusted      INTEGER NOT NULL,
    voter_id         TEXT,               -- NR_TITULO_ELEITORAL_CANDIDATO
    ballot_name      TEXT,               -- NM_URNA_CANDIDATO
    full_name        TEXT,
    normalized_name  TEXT,

    -- TSE natural key for the candidacy
    tse_candidacy_id TEXT,               -- SQ_CANDIDATO (unique per election/round)

    -- position in that election
    year             INTEGER NOT NULL,
    election_type    TEXT,
    round            INTEGER,
    office           TEXT,               -- DS_CARGO
    candidate_number TEXT,
    party_abbr       TEXT,
    party_name       TEXT,
    party_number     TEXT,
    state            TEXT,               -- SG_UF
    electoral_unit   TEXT,               -- SG_UE
    municipality     TEXT,               -- NM_UE (municipal offices)
    candidacy_status TEXT,               -- DS_SITUACAO_CANDIDATURA
    candidacy_status_detail TEXT,        -- DS_DETALHE_SITUACAO_CAND
    result           TEXT,               -- DS_SIT_TOT_TURNO (elected / not elected / ...)

    -- registry fields
    birth_date       TEXT,
    gender           TEXT,
    education        TEXT,
    marital_status   TEXT,
    race             TEXT,
    occupation       TEXT,

    provenance_id    INTEGER NOT NULL REFERENCES parse(id),
    collected_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ph_person      ON politician_history (person_id);
CREATE INDEX IF NOT EXISTS ix_ph_year_office ON politician_history (year, office, state);
CREATE INDEX IF NOT EXISTS ix_ph_voter_id    ON politician_history (voter_id) WHERE voter_id IS NOT NULL;
-- SQ_CANDIDATO repeats across rounds (same candidate in 1st and 2nd) and across years.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ph_candidacy
    ON politician_history (year, tse_candidacy_id, round)
    WHERE tse_candidacy_id IS NOT NULL;
