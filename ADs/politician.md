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

### 2.0.1 Doações e despesas — `campaign_donation` / `campaign_expense` (mesmo crawler)

`receitas_candidatos_AAAA_BRASIL.csv` é, na verdade, uma linha por **recibo de
receita** (`SQ_RECEITA`) — a triplas de `campaign_org` é só a projeção
deduplicada dessas linhas. `accounts.py` faz uma única passada pelo arquivo e
alimenta as duas tabelas ao mesmo tempo (não baixa/lê o arquivo duas vezes).

```sql
campaign_donation (
  id, campaign_org_id -> campaign_org(id),        -- preenchido depois, por UPDATE (ver abaixo)
  cnpj, tse_candidacy_id, year,                    -- quem recebeu
  tse_receipt_id, receipt_number, document_id,     -- identificadores do TSE
  receipt_date, amount_cents, source, origin, species,
  donor_cpf_cnpj, donor_name, donor_name_rfb, donor_cnae,
  donor_state, donor_municipality, donor_tse_candidacy_id, donor_party_abbr,
  donor_person_id -> people(id),                   -- ver política de identidade abaixo
  donor_company_id -> companies(id),
  provenance_id -> parse(id), collected_at,
  UNIQUE (year, tse_receipt_id)
)
```

**`campaign_org_id` é preenchido depois de escrever as duas tabelas**, com um
`UPDATE ... SET campaign_org_id = (SELECT ... WHERE year/tse_candidacy_id/cnpj
casam)`. Evita duas passadas pelo CSV só para descobrir o id que o SQLite ainda
não tinha atribuído no meio da varredura.

**Política de identidade do doador — nunca cria `people` novo.** Um doador só
ganha `donor_person_id` quando já é um político conhecido: `SQ_CANDIDATO_DOADOR`
preenchido (outro candidato doando) resolvido contra `politician_history`, ou o
CPF do doador já existe em `people` (carregado uma vez em memória no início do
`run()`, sem criar linha nova). Um cidadão comum que doou uma vez fica só como
texto (`donor_cpf_cnpj` / `donor_name`) — não normalizamos identidade de quem
não é o objeto do sistema. CNPJ de doador (empresa, comitê partidário) entra em
`companies` com `kind = 'donor'` (get-or-create, mesmo padrão do CNPJ de
campanha).

**`campaign_expense` é o espelho, do lado da despesa.** Mesmo zip, arquivo
irmão (`despesas_contratadas_candidatos_AAAA_BRASIL.csv` — despesa
*contratada*, regime de competência), mesmo crawler, mesma passada por ano
(não dobra download). "Doador" vira "fornecedor" (`NR_CPF_CNPJ_FORNECEDOR`,
`SQ_CANDIDATO_FORNECEDOR`...), mesma política de identidade (nunca cria
`people`), mesmo `kind` novo em `companies` (`'supplier'`), mesmo mecanismo de
`campaign_org_id` via `UPDATE` depois. `UNIQUE (year, tse_expense_id)` na chave
`SQ_DESPESA`.

**`campaign_expense_payment` é o regime de caixa** (`despesas_pagas_candidatos_
AAAA_BRASIL.csv`) — quando a despesa foi *de fato paga*, às vezes em mais de
uma parcela (`SQ_PARCELAMENTO_DESPESA`). Esse arquivo é bem mais enxuto: **não
tem CNPJ, `SQ_CANDIDATO` nem fornecedor próprios** — só referencia de volta a
despesa contratada por `SQ_DESPESA`. Por isso não tem política de identidade
nenhuma (não é doador nem fornecedor, é só o pagamento). `campaign_expense_id`
é preenchido do mesmo jeito que `campaign_org_id`, só que casando por
`(year, tse_expense_id)` em vez de `(year, tse_candidacy_id, cnpj)`.
`UNIQUE (year, tse_expense_id, tse_installment_id)`.

### 2.1. Redes sociais declaradas — tabela `social_media` (crawler separado)

Desde a Res. TSE 23.610/2019 (art. 26-A), declarar redes sociais/site é parte do
RRC (Requerimento de Registro de Candidatura) — também não é coluna do
`consulta_cand`, é arquivo próprio:
`consulta_cand/rede_social_candidato_AAAA.zip`.

Implementado em `elosys/tse/social.py` (`elosys tse-social`): varre
`rede_social_candidato_AAAA_BRASIL.csv` (uma linha por URL declarada) e guarda em
`social_media`, ligado por `SQ_CANDIDATO` (= `tse_candidacy_id`) direto — sem
fallback por CPF, porque a chave já vem no arquivo. `platform` é inferido da URL
por regex (facebook/instagram/x/youtube/tiktok/linkedin/whatsapp/telegram/kwai;
`website` para URL genérica; `other` caso não seja URL).

```sql
social_media (
  id, person_id -> people(id), tse_candidacy_id, year, state,
  platform, url, order_in_source,
  provenance_id -> parse(id), collected_at,
  UNIQUE (year, tse_candidacy_id, url)
)
```

Só a URL declarada entra — nada de raspar o perfil (seguidores, posts, contato).

### 2.2. Sanções federais — tabela `sanction` (fonte externa, CGU)

Primeira fonte que **não é do TSE**: CEIS (empresas/pessoas impedidas de
contratar com o governo) + CNEP (empresas punidas com multa por corrupção,
Lei 12.846/2013) do Portal da Transparência (CGU). Diferente de tudo que já
existe no banco, **não é histórico por eleição** — o portal só serve o
snapshot do dia atual (`download-de-dados/{ceis|cnep}/AAAAMMDD`); a data é
descoberta lendo a própria página de download (o mesmo valor que o botão
"Baixar" usaria), não assumida do relógio local.

Implementado em `elosys/transparencia/sanctions.py`
(`elosys transparencia-sanctions`, sem `--years`). CEIS e CNEP têm as mesmas
colunas exceto por `VALOR DA MULTA` (só no CNEP, inserida no meio) — o parser
lê por **posição**, não por nome de coluna, porque os nomes de coluna
acentuados têm risco de mojibake dependendo do terminal/pipe.

```sql
sanction (
  id, registry ('CEIS'|'CNEP'), sanction_code, person_type, cpf_cnpj,
  sanctioned_name, category, fine_amount_cents, start_date, end_date,
  sanctioning_agency, agency_sphere, legal_basis, ...,
  company_id -> companies(id), person_id -> people(id),
  provenance_id -> parse(id), collected_at,
  UNIQUE (registry, sanction_code)
)
```

**Mesma política de identidade de doador/fornecedor:** um CPF sancionado
**nunca cria `people` novo** — só linka se o CPF já existe (ou seja, se a
pessoa sancionada já é um político conhecido no banco). CNPJ sancionado
sempre vira `companies` (`kind = 'sanctioned'`, get-or-create) — companies já
é uma tabela compartilhada entre todas as fontes.

Rodado contra a base real: **25.535 sanções** (23.738 CEIS + 1.797 CNEP),
**9.822 empresas sancionadas**, **1.124 sanções já ligadas a um político
conhecido** por CPF. Cruzando CNPJ sancionado × `campaign_donation`/
`campaign_expense`: **474 empresas sancionadas** aparecem recebendo dinheiro
de campanha — candidato natural a virar uma segunda regra de detecção.

### 2.3. Cadastro de CNPJ — tabelas `company_registry` / `company_partner` (BrasilAPI)

**A única fonte deste projeto que não é rewrite-only.** Todas as outras são
arquivo único pra baixar; CNPJ da Receita é consulta individual rate-limited
(`brasilapi.com.br/api/cnpj/v1/{cnpj}`, proxy público da Receita Federal).
Com >1,3M CNPJs distintos em `companies`, rebaixar tudo a cada build é
inviável. `elosys/receita/cnpj.py` (`elosys receita-cnpj`) é por isso um
**cache incremental**: só busca CNPJ que ainda não tem linha em
`company_registry`, então pode ser rodado várias vezes ao longo do tempo pra
ir preenchendo o catálogo — cada linha individual continua auditável
(`provenance_id` → a URL exata da consulta + hash da resposta), só o
*conjunto* de linhas depende de quanto tempo você rodou, não de um arquivo
fixo. Como só dá pra cobrir uma fatia, a fila padrão (`--order money`)
ranqueia os CNPJs por **dinheiro movimentado** (recebido como fornecedor +
doado), e pula os CNPJs de comitê de campanha (409-4) — a data de fundação
de um comitê não diz nada. Um lote grande (`--limit 2000`+) amortiza o custo
(~50s) da varredura de ranking. A fonte definitiva, pra ter todas as
empresas, seria o dump de dados abertos de CNPJ da Receita (arquivos
mensais) — crawler ainda não feito.

```sql
company_registry (
  id, company_id -> companies(id), cnpj, legal_name, trade_name,
  opened_at,               -- data_inicio_atividade
  registry_status,         -- ATIVA / BAIXADA / ...
  legal_nature, primary_cnae, share_capital_cents, size, city, state,
  provenance_id -> parse(id), collected_at,
  UNIQUE (company_id)
)

company_partner (          -- quadro societário (qsa)
  id, company_id -> companies(id), cnpj, partner_name,
  partner_doc_masked,      -- CPF do sócio vem MASCARADO pela fonte ("***498538**")
  role, entry_date,
  provenance_id -> parse(id), collected_at
)
```

**`company_partner.person_id` não existe de propósito.** O CPF do sócio vem
mascarado (só 6 dígitos do meio) — nunca dá pra bater deterministicamente
contra `people.cpf` (11 dígitos completos). Bater por nome sozinho violaria
a política de identidade do projeto (ADs/identidade.md). O nome do sócio
fica só como texto pra conferência humana.

Demo real: 139 CNPJs (maiores doadores/fornecedores + cruzamento com
sanção), 0 erros, 211 sócios. Achado divertido: os CNPJs de campanha vêm
literalmente nomeados pelo candidato ("ELEICAO 2022 LUIZ INACIO LULA DA
SILVA PRESIDENTE") e ficam `BAIXADA` depois da eleição.

### 3. Bens declarados — "quanto foi declarado" (implementado)

Dataset próprio do TSE: `bem_candidato_AAAA.zip`
(`cdn.tse.jus.br/estatistica/sead/odsele/bem_candidato/`). É o patrimônio declarado
**no registro da candidatura** — um candidato tem N bens por eleição, cada um com
tipo (imóvel, veículo, aplicação financeira, participação societária...), descrição e
valor declarado. É a base do sinal "enriquecimento patrimonial incompatível" (README).

Implementado em `elosys/tse/assets.py` (`elosys tse-assets`, 2014–2026 — mesmo
layout com cabeçalho em todos os anos, igual `consulta_cand`). **Tabela
separada, não coluna em `politician_history`** (relação 1:N e o valor por bem
importa):

```sql
declared_assets (
  id             INTEGER PRIMARY KEY,
  person_id      INTEGER REFERENCES people(id),              -- via SQ_CANDIDATO; NULL se não achar
  history_id     INTEGER REFERENCES politician_history(id),   -- a candidatura do ano
  tse_candidacy_id TEXT NOT NULL,      -- SQ_CANDIDATO
  year           INTEGER NOT NULL,
  asset_order    INTEGER,              -- NR_ORDEM_BEM_CANDIDATO
  asset_type     TEXT,                 -- DS_TIPO_BEM_CANDIDATO
  description    TEXT,
  value_cents    INTEGER,              -- VR_BEM_CANDIDATO em centavos (ver banco.md)
  source_updated_at TEXT,              -- DT_ULT_ATUAL_BEM_CANDIDATO
  provenance_id  INTEGER NOT NULL REFERENCES parse(id),
  collected_at   TEXT NOT NULL,
  UNIQUE (year, tse_candidacy_id, asset_order)
)
```

Vista útil: `SUM(value_cents) por person_id, year` → série temporal do patrimônio
declarado, comparável entre eleições e contra doações recebidas / renda.

Observações:

- Valores são **nominais do ano** — a regra de detecção decide se deflaciona (IPCA)
  ou compara nominal. Guardamos como veio.
- **Esse arquivo não tem CPF nenhum** — só `SQ_CANDIDATO`. Diferente de
  `campaign_org`/`social_media`, não existe fallback por CPF possível; se a
  candidatura não estiver em `politician_history` no mesmo ano, `person_id` e
  `history_id` ficam `NULL` (por isso a coluna é `REFERENCES`, não `NOT NULL`
  como o desenho original desta AD previa — ajustado depois de implementar).
- Bens vêm só do **registro de candidatura**. Quem não foi candidato num ano não tem
  declaração naquele ano — os "buracos" na série são esperados.
- Rodado contra a base real: **3.249.719 bens declarados**, 1.022.327
  candidaturas, 99,99994% linkados a pessoa, **R$ 445,5 bilhões** em valor
  total declarado (nominal, sem deflação). Já dá pra ver outlier grosseiro
  nos dados brutos (um candidato só declarou R$ 12,1 bilhões em 2024 — quase
  certamente erro de digitação do próprio candidato/cartório, não é algo que
  o Elosys corrige, só reporta como veio).

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

### 5. Foto oficial — `candidate_photo` (elosys/tse/photo_urls.py)

Implementado, como exceção deliberada — ver o comentário longo em schema.sql
acima de `candidate_photo`. Curto: o Portal de Dados Abertos só tem as fotos
empacotadas num zip por (ano, UF), sem URL individual; a API de busca do
DivulgaCandContas (`GET rest/v1/candidatura/pesquisar?cpf=...`) tem `fotoUrl`
direto, então o crawler usa essa — busca por CPF (match exato, sem risco de
homônimo), uma requisição por pessoa cobrindo todos os anos dela de uma vez.

Só a URL fica no banco — nunca a imagem. A web app usa a URL do TSE direto
como `<img src>`; nada é baixado nem guardado localmente.

⚠️ **Risco aceito conscientemente:** é a mesma API interna que este documento
originalmente evitava por ser frágil ("muda de layout e some entre ciclos").
Se `fotoUrl` quebrar, a tabela só para de preencher — nada mais depende dela.

**Cobertura parcial por design:** é uma API de lookup, não um arquivo em lote —
`run()` é incremental (`--limit`, `--years`, `--workers` para paralelizar via
thread pool). Cobrir todo mundo é lento (dias), então roda-se aos poucos,
priorizando por ano de candidatura mais recente.

## Consequências

- "Linha do tempo de um político" = `SELECT ... WHERE person_id = ? ORDER BY year`.
- Nenhuma query pode assumir `cpf` não-nulo. Todo JOIN por pessoa passa por `person_id`.
- O build roda todas as fontes no mesmo run, do zero: cadastro (`consulta_cand`),
  bens (`bem_candidato`), CNPJ/contas (prestação de contas), redes sociais
  (`rede_social_candidato`), foto (DivulgaCandContas).
- **Escopo: coletamos todas as candidaturas, sem exceção** (vereadores, suplentes
  incluídos — ~450k linhas em 2024). Sem filtro por cargo.
- **Layout:** cabeçalho `CD_*/DS_*/NM_*` para todos os anos, 2014–2026. O TSE
  reprocessou 2014/2016 e os republica no formato atual (não é mais o layout
  legado sem cabeçalho que uma versão antiga desta AD supunha) — só com menos
  colunas (ex.: sem `DS_DETALHE_SITUACAO_CAND` em 2014). `_g()` já tolera
  coluna ausente (`-> None`), então o mesmo parser cobre os 7 anos.

## Pontos em aberto

- ⚠️ **Nome exato dos arquivos/colunas** de "CNPJ concedidos" e da prestação de
  contas 2024 — validar na primeira coleta real e fixar o layout no código do parser.
- ⚠️ **Colisão de `voter_id + name`.** Homônimos que mudaram de título, ou
  OCR/encoding sujo no nome. Precisamos de uma fila de reconciliação manual
  (`cpf_trusted = 0` + sem match confiante) — ver [identidade.md](identidade.md).
- ⚠️ **Deflação de valores de bens** (IPCA) é decisão da regra de detecção, não do
  schema — guardamos nominal.
- ✅ ~~Mapear a API interna do DivulgaCandContas para as fotos por ano~~ — feito em
  `elosys/tse/photo_urls.py` (§5): busca por CPF exato, só guarda a URL (hotlink
  direto do CDN do TSE, sem baixar/armazenar a imagem). Rodado pra 2026: 20.762/
  20.762 pessoas, 0 erros.
