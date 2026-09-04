# AD — `politician_history` e o CPF mascarado de 2024

**Status:** Aceita
**Relacionado:** [confiabilidade.md](confiabilidade.md), [identidade.md](identidade.md)

> Nomes de tabela/coluna do schema são em inglês (ver [banco.md](banco.md)); o texto
> das ADs continua em português.

## Contexto

Os dados de políticos cobrem 2014–2026 e vêm sobretudo do TSE (`consulta_cand` e
prestação de contas). Um mesmo político aparece em várias eleições, com partido,
cargo e UF diferentes a cada ano. Em 2024 o TSE **mascarou o CPF** dos candidatos
(alegando LGPD); a restrição foi revertida para 2026. Cada informação tem que
carregar seu source de confiabilidade (ver [confiabilidade.md](confiabilidade.md)).

## Decisão

### 1. Sem tabela `politician`. Tabela temporal `politician_history`

Não existe uma linha "o político X". Existe "a candidatura/mandato de X no ano N".
Isso evita ter que decidir qual partido/cargo é "o atual".

```sql
politician_history (
  id                INTEGER PRIMARY KEY,

  -- identidade
  person_id         INTEGER NOT NULL REFERENCES people(id),  -- surrogate; ver identidade.md
  cpf               TEXT,               -- NULL quando mascarado (2024)
  cpf_trusted       INTEGER NOT NULL,   -- 0/1
  voter_id          TEXT,               -- título eleitoral; chave de fallback p/ 2024
  ballot_name       TEXT,               -- nome de urna
  full_name         TEXT,
  normalized_name   TEXT,               -- valor derivado; transformação versionada

  -- chave natural do TSE para a candidatura
  tse_candidacy_id  TEXT,               -- SQ_CANDIDATO (único por eleição/turno)

  -- posição naquele pleito
  year              INTEGER NOT NULL,
  election_type     TEXT,
  round             INTEGER,
  office            TEXT,
  candidate_number  TEXT,
  party_abbr        TEXT,
  party_name        TEXT,
  party_number      TEXT,
  state             TEXT,               -- SG_UF
  electoral_unit    TEXT,               -- SG_UE
  municipality      TEXT,               -- p/ cargos municipais
  candidacy_status  TEXT,               -- deferido, indeferido, renúncia...
  candidacy_status_detail TEXT,
  result            TEXT,               -- eleito, não eleito, ...

  -- campos de registro (birth_date, gender, education, marital_status, race, occupation)

  provenance_id     INTEGER NOT NULL REFERENCES parse(id),
  collected_at      TEXT NOT NULL
)
```

Uma linha por candidatura por eleição/turno. Sem `raw_data`, sem `supersedes_id`:
o build é rewrite-only (ver [imutabilidade.md](imutabilidade.md)) — erro de
mapeamento se conserta no parser e rebuilda. O valor bruto está sempre no CSV da
fonte (hash em `collection_file`, reproduzível via `elosys verify`).

Colunas que **saíram** por virem sempre vazias nesta fase: `campaign_cnpj` e
`photo_url` (ver §2 e §5 — entram quando os parsers dessas fontes existirem).

### 2. CNPJ da campanha — tabela `campaign_org` (crawler separado)

O CNPJ de campanha **não** está no `consulta_cand`. Cada candidatura abre um CNPJ
próprio (Receita, natureza jurídica 409-4) e ele aparece na **prestação de contas
eleitorais** do TSE (`prestacao_contas/prestacao_de_contas_eleitorais_candidatos_AAAA.zip`),
repetido em cada linha de receita (`NR_CNPJ_PRESTADOR_CONTA` + `SQ_CANDIDATO`).

Implementado em `elosys/tse/accounts.py` (crawler independente, `elosys tse-accounts`):
varre `receitas_candidatos_AAAA_BRASIL.csv` e guarda as triplas distintas
`(ano, SQ_CANDIDATO, CNPJ)` em `campaign_org` — **não** como coluna em
`politician_history`. O vínculo com a pessoa é por `SQ_CANDIDATO`
(`= politician_history.tse_candidacy_id`) ou, na falta, por CPF. O CNPJ também entra
em `companies` (`kind = 'campaign'`).

```sql
campaign_org (
  id, company_id -> companies(id), person_id -> people(id),
  cnpj, tse_candidacy_id, accountant_id, year,
  candidate_cpf, candidate_name, normalized_name, office, party_abbr, state,
  provenance_id -> parse(id), collected_at,
  UNIQUE (year, tse_candidacy_id, cnpj)
)
```

As **doações em si** (doador, valor, data) estão no mesmo arquivo e são o próximo
passo do mesmo crawler (`_load_donations`, ainda não escrito) — volume bem maior,
tabela própria.

### 3. Bens declarados — "quanto foi declarado"

Dataset próprio do TSE: `bem_candidato_AAAA.zip`
(`cdn.tse.jus.br/estatistica/sead/odsele/bem_candidato/`). É o patrimônio declarado
**no registro da candidatura** — um candidato tem N bens por eleição, cada um com
tipo (imóvel, veículo, aplicação financeira, participação societária...), descrição e
valor declarado. É a base do sinal "enriquecimento patrimonial incompatível" (README).

**Tabela separada, não coluna em `politician_history`** (relação 1:N e o valor por
bem importa):

```sql
declared_assets (
  id             INTEGER PRIMARY KEY,
  person_id      INTEGER NOT NULL REFERENCES people(id),
  history_id     INTEGER REFERENCES politician_history(id),  -- a candidatura do ano
  year           INTEGER NOT NULL,
  asset_order    INTEGER,             -- NR_ORDEM_BEM_CANDIDATO
  asset_type     TEXT,                -- DS_TIPO_BEM_CANDIDATO
  description    TEXT,
  value_cents    INTEGER,             -- VR_BEM_CANDIDATO em centavos (ver banco.md)
  source_updated_at TEXT,             -- DT_ULTIMA_ATUALIZACAO do TSE
  provenance_id  INTEGER NOT NULL REFERENCES parse(id),
  collected_at   TEXT NOT NULL
)
```

Vista útil: `SUM(value_cents) por person_id, year` → série temporal do patrimônio
declarado, comparável entre eleições e contra doações recebidas / renda.

Observações:

- Valores são **nominais do ano** — a regra de detecção decide se deflaciona (IPCA)
  ou compara nominal. Guardamos como veio.
- 2024 tem CPF mascarado aqui também → `person_id` via reconciliação, `history_id`
  liga na candidatura correspondente.
- Bens vêm só do **registro de candidatura**. Quem não foi candidato num ano não tem
  declaração naquele ano — os "buracos" na série são esperados.

### 4. CPF mascarado de 2024 — chave de reconciliação

- Em 2024, `cpf = NULL`, `cpf_trusted = 0`.
- **Chave de fallback:** `voter_id` (título eleitoral, vem completo mesmo em 2024) +
  `normalized_name`. O título é praticamente único por pessoa e é o identificador
  mais forte disponível nesse ano.
- A resolução de identidade (juntar a candidatura 2024 com a mesma pessoa em
  2018/2022/2026) acontece na tabela `people` — ver [identidade.md](identidade.md).
- **CPF de 2024 via 2026:** como o build é rewrite-only e sempre coleta todos os
  anos juntos, a resolução de identidade já casa a candidatura de 2024 (só
  `voter_id`) com a de 2026 (CPF em claro) pelo `voter_id` — a pessoa fica com o
  CPF de 2026. A **linha** de 2024 continua com `cpf = NULL` (foi o que a fonte de
  2024 deu); quem quer o CPF da pessoa lê `people.cpf` via `person_id`. Nada de
  editar linha ou `supersedes_id`.

### 5. Foto oficial — fonte futura

Sem coluna `photo_url` agora. Quando o parser do DivulgaCandContas existir, a foto
vai numa tabela própria (`person_id` / `year` / `url` / `provenance_id`); a
`collection` registra `url + accessed_at + sha256` como qualquer outra.

⚠️ **Risco específico da foto:** as URLs do DivulgaCandContas mudam de layout e
somem entre ciclos — mais frágil que os CSVs do TSE. Candidata natural ao
"arquivamento seletivo" (arquivo pequeno, não reprodutível). TODO em
[confiabilidade.md](confiabilidade.md).

## Consequências

- "Linha do tempo de um político" = `SELECT ... WHERE person_id = ? ORDER BY year`.
- Nenhuma query pode assumir `cpf` não-nulo. Todo JOIN por pessoa passa por `person_id`.
- O build roda todas as fontes no mesmo run, do zero: cadastro (`consulta_cand`),
  bens (`bem_candidato`), CNPJ/contas (prestação de contas), foto (DivulgaCandContas).
- **Escopo: coletamos todas as candidaturas, sem exceção** (vereadores, suplentes
  incluídos — ~450k linhas em 2024). Sem filtro por cargo.
- **Layout implementado:** 2018+ (cabeçalho `CD_*/DS_*/NM_*`). 2014/2016 usam o
  layout legado (CSV sem cabeçalho) — parser à parte, ainda não escrito.

## Pontos em aberto

- ⚠️ **Nome exato dos arquivos/colunas** de "CNPJ concedidos" e da prestação de
  contas 2024 — validar na primeira coleta real e fixar o layout no código do parser.
- ⚠️ **Colisão de `voter_id + name`.** Homônimos que mudaram de título, ou
  OCR/encoding sujo no nome. Precisamos de uma fila de reconciliação manual
  (`cpf_trusted = 0` + sem match confiante) — ver [identidade.md](identidade.md).
- ⚠️ **Deflação de valores de bens** (IPCA) é decisão da regra de detecção, não do
  schema — guardamos nominal.
- Mapear a API interna do DivulgaCandContas para as fotos por ano (item aberto no README).
