# AD — Tabela mestra `people` e resolução de identidade

**Status:** Aceita (resolução determinística implementada; reconciliação fina pendente)
**Relacionado:** [politician.md](politician.md), [confiabilidade.md](confiabilidade.md)

> Nomes de tabela/coluna em inglês (ver [banco.md](banco.md)); texto em português.

## Contexto

O README define CPF/CNPJ como chave de cruzamento e manda toda tabela ter FK para
uma `people` (por CPF) e/ou `companies` (por CNPJ). Mas:

- Em 2024 o CPF vem mascarado — não dá para usar como PK.
- CPF em fonte pública tem erro de digitação, dígito verificador quebrado, campo
  trocado com o do doador.
- "São a mesma pessoa?" é uma **afirmação nossa**, derivada.

Como o build é rewrite-only (ver [imutabilidade.md](imutabilidade.md)), a
identidade é recalculada do zero a cada execução. Não precisa de tabela de
histórico de decisões — a decisão está no código + nos arquivos de entrada.

## Decisão

### 1. PK é surrogate, nunca o CPF/CNPJ

```sql
people (
  id             INTEGER PRIMARY KEY,   -- surrogate estável dentro de um build
  cpf            TEXT,                  -- pode ser NULL; NÃO é único sozinho
  cpf_trusted    INTEGER NOT NULL,      -- 0/1
  voter_id       TEXT,                  -- título eleitoral; chave primária de match
  canonical_name TEXT,
  created_at     TEXT NOT NULL
)

companies (
  id           INTEGER PRIMARY KEY,
  cnpj         TEXT,
  legal_name   TEXT,
  created_at   TEXT NOT NULL
)
```

Todas as tabelas de dado apontam para `people.id` / `companies.id`, não para o CPF.
`people` carrega direto os dois identificadores fortes (`cpf`, `voter_id`), cada um
com índice parcial. **Não há tabela `person_identifier`** — ela só se justifica
quando várias fontes trouxerem identificadores conflitantes e houver reconciliação
manual; fica adiada (ver "Pendente").

```sql
rejected_cpf (                          -- CPFs derrubados por ambiguidade (§3)
  cpf                TEXT PRIMARY KEY,
  reason             TEXT NOT NULL,      -- 'multiple_voter_ids' | 'voter_id_multiple_cpf'
  distinct_voter_ids INTEGER,
  distinct_names     INTEGER,
  recorded_at        TEXT NOT NULL
)
```

`rejected_cpf` responde "por que a `politician_history.cpf` desta linha é NULL —
mascarada (2024) ou derrubada por ambiguidade?". O mesmo conteúdo sai também no
`run_report.json`.

### 2. Duas passadas SQL no build (staging → promote)

Implementado em `elosys/tse/candidates.py`.

1. **Stage** — cada CSV é parseado para `stg_candidate` (`CREATE TEMP TABLE`, só na
   conexão do build), com CPF/título como vieram. Nada de identidade ainda.
2. **Promote** — roda **depois de todos os anos**, com visão global:
   - marca **CPFs ambíguos** e os descarta (vira `NULL` em toda linha; o valor cai
     em `rejected_cpf`). Ambíguo =
     - um CPF ligado a **mais de um `voter_id`** distinto, ou
     - um CPF cujo `voter_id` também carrega outros CPFs (typo dos dois lados).
   - resolve identidade (§3) e insere as linhas em `politician_history`.
   - dropa a tabela de staging.

Descartar CPF ambíguo é decisão firme ("na dúvida, não afirma"): vale mais errar
pra menos (duas linhas viram duas pessoas por título) do que fundir duas pessoas
reais num CPF errado da fonte. Medido em 2018–2026: ~35 CPFs, ~63 linhas.

### 3. Ordem de matching (determinística)

`elosys/identity.py`, chamado pelo promote (CPF já limpo):

1. `voter_id` já em alguma `people` → aquela pessoa.
2. senão, CPF válido já em alguma `people` → aquela pessoa.
3. senão → cria `people` nova.

Depois, `UPDATE people SET cpf = ? WHERE id = ? AND cpf IS NULL` (e idem
`voter_id`): uma pessoa criada só com título ganha o CPF quando ele aparece noutro
ano. É assim que a candidatura de 2024 (só título) herda o CPF de 2026.

**Pendente** (job posterior, versionado como regra):

- CPF ausente + `normalized_name` igual + mesma UF + anos plausíveis → match fraco
  → **fila de revisão manual**, não junta automático.
- Merge/split manual → aí sim entra uma tabela de afirmações (`person_identifier`)
  com `origin='manual'`, reconstruída/aplicada a cada build.
- FTS5 sobre `normalized_name` para busca de homônimos.

### 4. Empresas

CNPJ público é confiável (não mascarado). Matching por CNPJ direto. O trabalho aqui
é o **quadro societário** vindo da Receita/BrasilAPI, cujos sócios pessoa física
precisam ser ligados a `people` — e a Receita traz o sócio com CPF parcialmente
mascarado (`***.456.789-**`). Match por máscara + nome vira afirmação de
baixa/média confiança (fila de revisão, não junta sozinho).

## Consequências

- Nenhum JOIN por CPF cru no código de aplicação — sempre por `person_id`.
- `people.id` só é estável **dentro de um build**; rebuild pode renumerar. Quem
  cita uma pessoa externamente cita `cpf`/`voter_id`, não `people.id`.
- Existe estado "pessoa provisória" (só título, sem CPF, sem match forte). As
  regras de detecção precisam rebaixar severidade nesses casos.
- Reprocessar identidade = rebuild. Sem merge/split incremental.

## Pontos em aberto

- ⚠️ Precisamos de UI de revisão manual já no backend-only? Talvez um subcomando
  do CLI que lista a fila (pessoas só-título sem match) e grava decisões num
  arquivo versionado que o próximo build aplica.
- ⚠️ `canonical_name`: qual variante vence quando há várias grafias? Proposta: a
  mais recente de fonte de alta confiança.
- ⚠️ Colisão de `voter_id` (pessoa que trocou de título entre eleições, ou
  encoding sujo no nome). Hoje o build trata título como identificador estável.
