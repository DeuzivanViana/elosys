-- Elosys SQLite schema.

PRAGMA foreign_keys = ON;

-- PROVENANCE: source -> collection -> collection_file -> parse -> record

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

CREATE TABLE IF NOT EXISTS record_sources (
    table_name TEXT NOT NULL,
    record_id  INTEGER NOT NULL,
    field      TEXT,                     -- NULL = the whole row
    parse_id   INTEGER NOT NULL REFERENCES parse(id),
    PRIMARY KEY (table_name, record_id, field, parse_id)
);

-- IDENTITY (see ADs/identidade.md)

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
CREATE INDEX IF NOT EXISTS ix_people_canonical_name ON people (canonical_name);

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

-- DATA: campaign finance - prestação de contas eleitorais

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

CREATE TABLE IF NOT EXISTS campaign_donation (
    id                     INTEGER PRIMARY KEY,
    campaign_org_id        INTEGER REFERENCES campaign_org(id),  -- backfilled after campaign_org; see accounts.py
    cnpj                   TEXT NOT NULL,     -- NR_CNPJ_PRESTADOR_CONTA (recipient campaign)
    tse_candidacy_id       TEXT,              -- SQ_CANDIDATO (recipient)
    year                   INTEGER NOT NULL,
    tse_receipt_id         TEXT,              -- SQ_RECEITA
    receipt_number         TEXT,              -- NR_RECIBO_DOACAO
    document_id            TEXT,              -- NR_DOCUMENTO_DOACAO
    receipt_date           TEXT,              -- DT_RECEITA, ISO
    amount_cents           INTEGER,           -- VR_RECEITA
    source                 TEXT,              -- DS_FONTE_RECEITA (recursos próprios, doações, partido...)
    origin                 TEXT,              -- DS_ORIGEM_RECEITA (pessoa física/jurídica/partido...)
    species                TEXT,              -- DS_ESPECIE_RECEITA (PIX, cheque, transferência...)
    donor_cpf_cnpj         TEXT,              -- NR_CPF_CNPJ_DOADOR, raw digits (11 or 14)
    donor_name             TEXT,              -- NM_DOADOR, as declared
    donor_name_rfb         TEXT,              -- NM_DOADOR_RFB, per Receita registry
    donor_cnae             TEXT,              -- DS_CNAE_DOADOR, when donor is a company
    donor_state             TEXT,             -- SG_UF_DOADOR
    donor_municipality      TEXT,             -- NM_MUNICIPIO_DOADOR
    donor_tse_candidacy_id  TEXT,             -- SQ_CANDIDATO_DOADOR, when donor is a candidate
    donor_party_abbr        TEXT,             -- SG_PARTIDO_DOADOR
    donor_person_id        INTEGER REFERENCES people(id),     -- only when donor is a known candidate
    donor_company_id       INTEGER REFERENCES companies(id),  -- only when donor_cpf_cnpj has 14 digits
    provenance_id           INTEGER NOT NULL REFERENCES parse(id),
    collected_at             TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_campaign_donation ON campaign_donation (year, tse_receipt_id);
CREATE INDEX IF NOT EXISTS ix_campaign_donation_org        ON campaign_donation (campaign_org_id);
CREATE INDEX IF NOT EXISTS ix_campaign_donation_candidacy  ON campaign_donation (year, tse_candidacy_id);
CREATE INDEX IF NOT EXISTS ix_campaign_donation_donor_doc  ON campaign_donation (donor_cpf_cnpj);
CREATE INDEX IF NOT EXISTS ix_campaign_donation_donor_person ON campaign_donation (donor_person_id) WHERE donor_person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_campaign_donation_donor_company ON campaign_donation (donor_company_id) WHERE donor_company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_campaign_donation_donor_name ON campaign_donation (donor_name) WHERE donor_company_id IS NULL;

CREATE TABLE IF NOT EXISTS campaign_expense (
    id                        INTEGER PRIMARY KEY,
    campaign_org_id           INTEGER REFERENCES campaign_org(id),
    cnpj                      TEXT NOT NULL,     -- NR_CNPJ_PRESTADOR_CONTA (paying campaign)
    tse_candidacy_id          TEXT,              -- SQ_CANDIDATO (who spent it)
    year                      INTEGER NOT NULL,
    tse_expense_id            TEXT,              -- SQ_DESPESA
    document_type             TEXT,              -- DS_TIPO_DOCUMENTO (nota fiscal, fatura...)
    document_number           TEXT,              -- NR_DOCUMENTO
    expense_date              TEXT,              -- DT_DESPESA, ISO
    amount_cents              INTEGER,           -- VR_DESPESA_CONTRATADA
    origin                    TEXT,              -- DS_ORIGEM_DESPESA (categoria do gasto)
    description                TEXT,             -- DS_DESPESA
    supplier_cpf_cnpj          TEXT,             -- NR_CPF_CNPJ_FORNECEDOR, raw digits (11 or 14)
    supplier_name               TEXT,            -- NM_FORNECEDOR, as declared
    supplier_name_rfb            TEXT,           -- NM_FORNECEDOR_RFB, per Receita registry
    supplier_type                 TEXT,          -- DS_TIPO_FORNECEDOR (pessoa física/jurídica)
    supplier_cnae                  TEXT,         -- DS_CNAE_FORNECEDOR
    supplier_state                  TEXT,        -- SG_UF_FORNECEDOR
    supplier_municipality             TEXT,      -- NM_MUNICIPIO_FORNECEDOR
    supplier_tse_candidacy_id         TEXT,      -- SQ_CANDIDATO_FORNECEDOR, when supplier is a candidate
    supplier_party_abbr               TEXT,      -- SG_PARTIDO_FORNECEDOR
    supplier_person_id        INTEGER REFERENCES people(id),     -- only when supplier is a known candidate
    supplier_company_id       INTEGER REFERENCES companies(id),  -- only when supplier_cpf_cnpj has 14 digits
    provenance_id              INTEGER NOT NULL REFERENCES parse(id),
    collected_at                TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_campaign_expense ON campaign_expense (year, tse_expense_id);
CREATE INDEX IF NOT EXISTS ix_campaign_expense_org        ON campaign_expense (campaign_org_id);
CREATE INDEX IF NOT EXISTS ix_campaign_expense_candidacy  ON campaign_expense (year, tse_candidacy_id);
CREATE INDEX IF NOT EXISTS ix_campaign_expense_supplier_doc ON campaign_expense (supplier_cpf_cnpj);
CREATE INDEX IF NOT EXISTS ix_campaign_expense_supplier_person ON campaign_expense (supplier_person_id) WHERE supplier_person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_campaign_expense_supplier_company ON campaign_expense (supplier_company_id) WHERE supplier_company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_campaign_expense_supplier_name ON campaign_expense (supplier_name) WHERE supplier_company_id IS NULL;
CREATE INDEX IF NOT EXISTS ix_campaign_expense_supplier_rank
    ON campaign_expense (supplier_cpf_cnpj) WHERE supplier_company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_campaign_expense_supplier_rank_year
    ON campaign_expense (year, supplier_cpf_cnpj) WHERE supplier_company_id IS NOT NULL;

-- Rebuild after every accounts.py ingest:
--   DELETE FROM pessoa_fisica_search;
--   INSERT INTO pessoa_fisica_search (cpf, name)
--   SELECT cpf, max(name) FROM (
--     SELECT donor_cpf_cnpj AS cpf, donor_name AS name FROM campaign_donation
--       WHERE donor_company_id IS NULL AND donor_cpf_cnpj IS NOT NULL
--         AND length(donor_cpf_cnpj) = 11 AND donor_name IS NOT NULL
--     UNION ALL
--     SELECT supplier_cpf_cnpj AS cpf, supplier_name AS name FROM campaign_expense
--       WHERE supplier_company_id IS NULL AND supplier_cpf_cnpj IS NOT NULL
--         AND length(supplier_cpf_cnpj) = 11 AND supplier_name IS NOT NULL
--   ) GROUP BY cpf;
CREATE VIRTUAL TABLE IF NOT EXISTS pessoa_fisica_search USING fts5(cpf UNINDEXED, name);

CREATE TABLE IF NOT EXISTS campaign_expense_payment (
    id                    INTEGER PRIMARY KEY,
    campaign_expense_id   INTEGER REFERENCES campaign_expense(id),  -- backfilled via SQ_DESPESA
    tse_expense_id        TEXT,              -- SQ_DESPESA (-> campaign_expense)
    tse_installment_id    TEXT,              -- SQ_PARCELAMENTO_DESPESA
    accountant_id         TEXT,              -- SQ_PRESTADOR_CONTAS
    year                  INTEGER NOT NULL,
    state                 TEXT,              -- SG_UF
    document_type         TEXT,              -- DS_TIPO_DOCUMENTO
    document_number       TEXT,              -- NR_DOCUMENTO
    payment_date          TEXT,              -- DT_PAGTO_DESPESA, ISO
    amount_cents          INTEGER,           -- VR_PAGTO_DESPESA
    source                TEXT,              -- DS_FONTE_DESPESA
    origin                TEXT,              -- DS_ORIGEM_DESPESA
    nature                TEXT,              -- DS_NATUREZA_DESPESA
    species               TEXT,              -- DS_ESPECIE_RECURSO
    description           TEXT,              -- DS_DESPESA
    provenance_id         INTEGER NOT NULL REFERENCES parse(id),
    collected_at          TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_campaign_expense_payment
    ON campaign_expense_payment (year, tse_expense_id, tse_installment_id);
CREATE INDEX IF NOT EXISTS ix_campaign_expense_payment_expense
    ON campaign_expense_payment (campaign_expense_id);

-- DATA: declared social media - rede_social_candidato

CREATE TABLE IF NOT EXISTS social_media (
    id               INTEGER PRIMARY KEY,
    person_id        INTEGER REFERENCES people(id),
    tse_candidacy_id TEXT NOT NULL,          -- SQ_CANDIDATO -> politician_history
    year             INTEGER NOT NULL,
    state            TEXT,                   -- SG_UF
    platform         TEXT NOT NULL,          -- 'facebook' | 'instagram' | 'x' | 'youtube' | 'tiktok' | 'website' | 'other'
    url              TEXT NOT NULL,          -- DS_URL, as declared
    order_in_source  INTEGER,                -- NR_ORDEM_REDE_SOCIAL
    provenance_id    INTEGER NOT NULL REFERENCES parse(id),
    collected_at     TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_social_media ON social_media (year, tse_candidacy_id, url);
CREATE INDEX IF NOT EXISTS ix_social_media_person ON social_media (person_id);

-- DATA: politician history (see ADs/politician.md)

CREATE TABLE IF NOT EXISTS politician_history (
    id               INTEGER PRIMARY KEY,
    person_id        INTEGER NOT NULL REFERENCES people(id),

    cpf              TEXT,               -- NULL when masked (2024) or dropped as ambiguous
    cpf_trusted      INTEGER NOT NULL,
    voter_id         TEXT,               -- NR_TITULO_ELEITORAL_CANDIDATO
    ballot_name      TEXT,               -- NM_URNA_CANDIDATO
    full_name        TEXT,
    normalized_name  TEXT,

    tse_candidacy_id TEXT,               -- SQ_CANDIDATO (unique per election/round)

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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ph_candidacy
    ON politician_history (year, tse_candidacy_id, round)
    WHERE tse_candidacy_id IS NOT NULL;

-- DERIVED DATA: detection rules (see ADs/dados_derivados.md)

CREATE TABLE IF NOT EXISTS rule_run (
    id             INTEGER PRIMARY KEY,
    rule           TEXT NOT NULL,          -- 'disproportionate_expense'
    rule_version   TEXT NOT NULL,          -- '1.0'
    code_commit    TEXT,                   -- git SHA of the code that ran
    params         TEXT,                   -- JSON: thresholds/keywords used
    run_at         TEXT NOT NULL,
    rows_generated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_rule_run_rule ON rule_run (rule);

CREATE TABLE IF NOT EXISTS signal (
    id           INTEGER PRIMARY KEY,
    rule_run_id  INTEGER NOT NULL REFERENCES rule_run(id),
    type         TEXT NOT NULL,             -- 'cheap_item_high_value'
    severity     TEXT NOT NULL,             -- 'low' | 'medium' | 'high'
    explanation  TEXT NOT NULL,             -- human-readable, in the same signal row
    amount_cents INTEGER,                   -- optional: money the signal is about, for sorting -- meaning is rule-specific (a single expense, a total cycle, ...); NULL if not applicable
    path_length  INTEGER                    -- optional: node count for a chain/cycle-shaped signal (circular_donations); NULL if not applicable
);
CREATE INDEX IF NOT EXISTS ix_signal_rule_run ON signal (rule_run_id);

CREATE TABLE IF NOT EXISTS signal_actor (
    signal_id INTEGER NOT NULL REFERENCES signal(id),
    type      TEXT NOT NULL,               -- 'person' | 'company'
    actor_id  INTEGER NOT NULL,            -- people.id or companies.id
    role      TEXT NOT NULL,               -- 'candidate' | 'supplier' | 'donor' | ...
    PRIMARY KEY (signal_id, type, actor_id, role)
);
CREATE INDEX IF NOT EXISTS ix_signal_actor_actor ON signal_actor (type, actor_id);

CREATE TABLE IF NOT EXISTS signal_evidence (
    signal_id  INTEGER NOT NULL REFERENCES signal(id),
    table_name TEXT NOT NULL,              -- 'campaign_expense'
    record_id  INTEGER NOT NULL,
    PRIMARY KEY (signal_id, table_name, record_id)
);

CREATE TABLE IF NOT EXISTS signal_ai_review (
    id                INTEGER PRIMARY KEY,
    signal_id         INTEGER NOT NULL REFERENCES signal(id),
    model             TEXT NOT NULL,        -- 'deepseek-chat'
    reviewed_at       TEXT NOT NULL,
    verdict           TEXT NOT NULL,        -- 'bizarro' | 'plausivel' | 'inconclusivo'
    confidence        TEXT,                 -- 'baixa' | 'media' | 'alta'
    explanation       TEXT NOT NULL,        -- the model's reasoning, pt-BR
    facts             TEXT,                 -- JSON array: the concrete points the model cited
    prompt            TEXT NOT NULL,        -- the exact user prompt sent, for audit
    raw_response      TEXT NOT NULL,        -- full model completion
    tokens_prompt     INTEGER,
    tokens_completion INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_signal_ai_review ON signal_ai_review (signal_id, model);
CREATE INDEX IF NOT EXISTS ix_signal_ai_review_verdict ON signal_ai_review (verdict);

-- DATA: federal sanctions registry - CEIS + CNEP

CREATE TABLE IF NOT EXISTS sanction (
    id                    INTEGER PRIMARY KEY,
    registry              TEXT NOT NULL,      -- 'CEIS' | 'CNEP'
    sanction_code         TEXT NOT NULL,      -- CODIGO DA SANCAO
    person_type           TEXT,               -- 'F' | 'J'
    cpf_cnpj              TEXT NOT NULL,      -- digits only (11 or 14)
    sanctioned_name       TEXT,               -- NOME DO SANCIONADO
    sanctioned_name_reported TEXT,            -- NOME INFORMADO PELO ORGAO SANCIONADOR
    legal_name            TEXT,               -- RAZAO SOCIAL - CADASTRO RECEITA
    trade_name            TEXT,               -- NOME FANTASIA - CADASTRO RECEITA
    process_number        TEXT,
    category              TEXT,               -- CATEGORIA DA SANCAO
    fine_amount_cents      INTEGER,           -- VALOR DA MULTA (CNEP only)
    start_date              TEXT,             -- DATA INICIO SANCAO, ISO
    end_date                  TEXT,           -- DATA FINAL SANCAO, ISO
    publication_date            TEXT,         -- ISO
    publication                   TEXT,
    publication_detail              TEXT,
    final_judgment_date               TEXT,   -- DATA DO TRANSITO EM JULGADO, ISO
    scope                               TEXT, -- ABRANGENCIA DA SANCAO
    sanctioning_agency                   TEXT,
    agency_state                          TEXT,
    agency_sphere                          TEXT,  -- FEDERAL | ESTADUAL | MUNICIPAL
    legal_basis                             TEXT, -- long free text, kept as-is
    source_data_date                         TEXT,
    source_origin                             TEXT,
    notes                                      TEXT,
    company_id            INTEGER REFERENCES companies(id),  -- only when cpf_cnpj has 14 digits
    person_id             INTEGER REFERENCES people(id),     -- only when CPF already in `people`
    provenance_id          INTEGER NOT NULL REFERENCES parse(id),
    collected_at             TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sanction ON sanction (registry, sanction_code);
CREATE INDEX IF NOT EXISTS ix_sanction_cpf_cnpj ON sanction (cpf_cnpj);
CREATE INDEX IF NOT EXISTS ix_sanction_company ON sanction (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_sanction_person ON sanction (person_id) WHERE person_id IS NOT NULL;

-- DATA: parliamentary earmarks (emendas parlamentares) - Portal da Transparência

CREATE TABLE IF NOT EXISTS parliamentary_earmark (
    id                 INTEGER PRIMARY KEY,
    earmark_code       TEXT NOT NULL,        -- Código da Emenda
    year               INTEGER NOT NULL,     -- Ano da Emenda
    earmark_type       TEXT,                 -- Tipo de Emenda
    author_code        TEXT,                 -- Código do Autor da Emenda (source's own id, not ours)
    author_name        TEXT,                 -- Nome do Autor da Emenda, as published
    author_person_id   INTEGER REFERENCES people(id),  -- name match only; see comment above
    author_match_basis TEXT,                 -- 'nome_deputado_federal' | 'nome_senador' | NULL (no match)
    locality           TEXT,                 -- Localidade de aplicação do recurso
    state              TEXT,                 -- UF
    municipality        TEXT,
    function_name         TEXT,              -- Nome Função
    subfunction_name         TEXT,           -- Nome Subfunção
    program_name                TEXT,        -- Nome Programa
    action_name                    TEXT,     -- Nome Ação
    committed_cents      INTEGER,            -- Valor Empenhado
    paid_cents             INTEGER,          -- Valor Pago
    provenance_id            INTEGER NOT NULL REFERENCES parse(id),
    collected_at                TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_parliamentary_earmark ON parliamentary_earmark (earmark_code, year, locality);
CREATE INDEX IF NOT EXISTS ix_parliamentary_earmark_author
    ON parliamentary_earmark (author_person_id) WHERE author_person_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS parliamentary_earmark_beneficiary (
    id                    INTEGER PRIMARY KEY,
    earmark_code          TEXT NOT NULL,     -- Código da Emenda (joins parliamentary_earmark.earmark_code)
    author_code           TEXT,              -- Código do Autor da Emenda, kept for convenience
    year_month            TEXT,              -- Ano/Mês, as published ('202609')
    beneficiary_doc       TEXT NOT NULL,     -- Código do Favorecido, digits only (11 CPF or 14 CNPJ)
    beneficiary_name      TEXT,
    beneficiary_type      TEXT,              -- Tipo Favorecido ('Pessoa Física' | 'Pessoa Jurídica')
    beneficiary_company_id INTEGER REFERENCES companies(id),  -- deterministic CNPJ match
    state                 TEXT,              -- UF Favorecido
    municipality          TEXT,              -- Município Favorecido
    amount_cents          INTEGER NOT NULL,  -- Valor Recebido
    provenance_id         INTEGER NOT NULL REFERENCES parse(id),
    collected_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_earmark_beneficiary_code ON parliamentary_earmark_beneficiary (earmark_code);
CREATE INDEX IF NOT EXISTS ix_earmark_beneficiary_company
    ON parliamentary_earmark_beneficiary (beneficiary_company_id) WHERE beneficiary_company_id IS NOT NULL;

-- DATA: declared assets - bem_candidato (see ADs/politician.md §3)

CREATE TABLE IF NOT EXISTS declared_assets (
    id                INTEGER PRIMARY KEY,
    person_id         INTEGER REFERENCES people(id),             -- via tse_candidacy_id; NULL if unmatched
    history_id        INTEGER REFERENCES politician_history(id), -- the (year, candidacy) row, if found
    tse_candidacy_id  TEXT NOT NULL,      -- SQ_CANDIDATO
    year              INTEGER NOT NULL,
    state             TEXT,               -- SG_UF
    asset_order       INTEGER,            -- NR_ORDEM_BEM_CANDIDATO
    asset_type        TEXT,               -- DS_TIPO_BEM_CANDIDATO
    description       TEXT,               -- DS_BEM_CANDIDATO
    value_cents       INTEGER,            -- VR_BEM_CANDIDATO
    source_updated_at TEXT,               -- DT_ULT_ATUAL_BEM_CANDIDATO, ISO
    provenance_id     INTEGER NOT NULL REFERENCES parse(id),
    collected_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_declared_assets
    ON declared_assets (year, tse_candidacy_id, asset_order);
CREATE INDEX IF NOT EXISTS ix_declared_assets_person  ON declared_assets (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_declared_assets_history ON declared_assets (history_id) WHERE history_id IS NOT NULL;

-- DATA: candidate photo URLs (see ADs/politician.md §5)

CREATE TABLE IF NOT EXISTS candidate_photo (
    id                INTEGER PRIMARY KEY,
    person_id         INTEGER REFERENCES people(id),             -- via tse_candidacy_id; NULL if unmatched
    history_id        INTEGER REFERENCES politician_history(id), -- the (year, candidacy) row, if found
    tse_candidacy_id  TEXT NOT NULL,      -- SQ_CANDIDATO
    year              INTEGER NOT NULL,
    photo_url         TEXT NOT NULL,      -- fotoUrl, as returned by the search API
    provenance_id     INTEGER NOT NULL REFERENCES parse(id),
    collected_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_candidate_photo ON candidate_photo (year, tse_candidacy_id);
CREATE INDEX IF NOT EXISTS ix_candidate_photo_person ON candidate_photo (person_id) WHERE person_id IS NOT NULL;

-- DATA: CNPJ registry enrichment - Receita Federal, via BrasilAPI

CREATE TABLE IF NOT EXISTS company_registry (
    id                   INTEGER PRIMARY KEY,
    company_id           INTEGER NOT NULL REFERENCES companies(id),
    cnpj                 TEXT NOT NULL,
    legal_name           TEXT,          -- razao_social
    trade_name           TEXT,          -- nome_fantasia
    opened_at            TEXT,          -- data_inicio_atividade, ISO
    registry_status      TEXT,          -- descricao_situacao_cadastral (ATIVA, BAIXADA...)
    registry_status_date TEXT,          -- data_situacao_cadastral, ISO
    legal_nature         TEXT,          -- natureza_juridica
    primary_cnae         TEXT,          -- cnae_fiscal_descricao
    share_capital_cents  INTEGER,       -- capital_social
    size                 TEXT,          -- porte
    city                 TEXT,          -- municipio
    state                TEXT,          -- uf
    provenance_id        INTEGER NOT NULL REFERENCES parse(id),
    collected_at          TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_company_registry ON company_registry (company_id);

CREATE TABLE IF NOT EXISTS company_partner (
    id                INTEGER PRIMARY KEY,
    company_id        INTEGER NOT NULL REFERENCES companies(id),
    cnpj              TEXT NOT NULL,
    partner_name      TEXT NOT NULL,
    partner_doc_masked TEXT,           -- cnpj_cpf_do_socio, as masked by the source
    role              TEXT,            -- qualificacao_socio
    entry_date        TEXT,            -- data_entrada_sociedade, ISO
    provenance_id     INTEGER NOT NULL REFERENCES parse(id),
    collected_at      TEXT NOT NULL,
    UNIQUE (company_id, partner_name, entry_date)
);
CREATE INDEX IF NOT EXISTS ix_company_partner_company ON company_partner (company_id);

CREATE TABLE IF NOT EXISTS candidate_supplier_partner (
    id                   INTEGER PRIMARY KEY,
    person_id            INTEGER NOT NULL REFERENCES people(id),
    company_id           INTEGER NOT NULL REFERENCES companies(id),
    company_partner_id   INTEGER NOT NULL REFERENCES company_partner(id),  -- the exact qsa row (its own provenance)
    match_basis          TEXT NOT NULL,   -- 'nome_e_6_digitos'
    partner_role         TEXT,            -- Administrador / Sócio / ...
    partner_since        TEXT,            -- entry_date, ISO
    payments_total_cents INTEGER NOT NULL DEFAULT 0,   -- everything this company got from ANY campaign
    payments_count       INTEGER NOT NULL DEFAULT 0,
    payer_candidacies    INTEGER NOT NULL DEFAULT 0,   -- distinct campaigns that paid it
    paid_by_self         INTEGER NOT NULL DEFAULT 0,   -- 1 if the partner-candidate's OWN campaign is one of them
    computed_at          TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_csp ON candidate_supplier_partner (person_id, company_id);
CREATE INDEX IF NOT EXISTS ix_csp_person ON candidate_supplier_partner (person_id);
CREATE INDEX IF NOT EXISTS ix_csp_amount ON candidate_supplier_partner (payments_total_cents);

-- DISCURSO PÚBLICO EM REDES SOCIAIS (conteúdo efêmero)

CREATE TABLE IF NOT EXISTS social_account (
    id                      INTEGER PRIMARY KEY,
    person_id               INTEGER REFERENCES people(id),
    network                 TEXT NOT NULL,          -- 'x'
    handle                  TEXT NOT NULL,          -- normalizado: minúsculo, sem @, sem querystring
    handle_declared         TEXT,                   -- a URL/handle exatamente como declarada ao TSE
    external_id             TEXT,                   -- id numérico da conta na plataforma, se resolvido
    declared_provenance_id  INTEGER REFERENCES parse(id),  -- a linha de parse do social_media/TSE
    source_id               INTEGER REFERENCES source(id),
    status                  TEXT,                   -- active | not_found | suspended | protected | error | pending
    first_seen_at           TEXT NOT NULL,
    last_crawled_at         TEXT,
    UNIQUE (network, handle)
);
CREATE INDEX IF NOT EXISTS ix_social_account_person ON social_account (person_id);

CREATE TABLE IF NOT EXISTS social_post (
    id                    INTEGER PRIMARY KEY,
    social_account_id     INTEGER NOT NULL REFERENCES social_account(id),
    external_id           TEXT NOT NULL,            -- id do tweet
    kind                  TEXT NOT NULL,            -- 'post' | 'reply' | 'quote'
    lang                  TEXT,
    text                  TEXT NOT NULL,            -- só texto; imagens ignoradas de propósito
    in_reply_to_external  TEXT,
    reply_to_handle       TEXT,                     -- a quem respondeu (contexto; a UI redige se for pessoa privada)
    posted_at             TEXT,
    like_count            INTEGER,
    repost_count          INTEGER,
    reply_count           INTEGER,
    url                   TEXT,                     -- https://x.com/<handle>/status/<id>
    matched_terms         TEXT,                     -- JSON: quais termos do léxico o texto casou
    matched_query         TEXT,                     -- a query `from:` exata que retornou a linha
    apify_run_id          TEXT,
    raw_json              TEXT NOT NULL,            -- o item do scraper, verbatim
    raw_sha256            TEXT NOT NULL,            -- hash do item cru — a prova de que não editamos depois
    retrieved_at          TEXT NOT NULL,
    UNIQUE (social_account_id, external_id)
);
CREATE INDEX IF NOT EXISTS ix_social_post_account ON social_post (social_account_id);

CREATE TABLE IF NOT EXISTS social_post_review (
    id                 INTEGER PRIMARY KEY,
    social_post_id     INTEGER NOT NULL REFERENCES social_post(id),
    model              TEXT NOT NULL,
    reviewed_at        TEXT NOT NULL,
    categories         TEXT,        -- JSON: categorias que o modelo apontou (lgbtfobia, racismo, ...)
    severity           TEXT,        -- low | medium | high — nunca "confirmado"
    is_offensive       INTEGER,     -- 0/1: a conclusão do modelo
    quote              TEXT,        -- o trecho EXATO que o modelo está apontando
    explanation        TEXT,
    prompt             TEXT,
    raw_response       TEXT,
    tokens_prompt      INTEGER,
    tokens_completion  INTEGER,
    UNIQUE (social_post_id, model)
);
CREATE INDEX IF NOT EXISTS ix_social_post_review_sev ON social_post_review (severity);
