# AD — Banco de dados: SQLite

**Status:** Aceita
**Relacionado:** [confiabilidade.md](confiabilidade.md), [imutabilidade.md](imutabilidade.md)

## Contexto

O README cogitava Postgres ou SQLite. Decidido: **SQLite**, arquivo único.

Justificativa:

- Não guardamos payload bruto nem cópia verbatim das linhas (ver
  [confiabilidade.md](confiabilidade.md) §2). Sem a coluna `raw_data`, o
  `consulta_cand` 2018–2026 (~1,1M linhas) cabe em **~1 GB** de `.db`.
- Carga é **um build em lote + leitura analítica pesada**. O build é rewrite-only
  (ver [imutabilidade.md](imutabilidade.md)): roda uma vez, do zero. Um escritor,
  muitos leitores depois. É o cenário em que SQLite vai bem.
- Zero infraestrutura: o entregável desta fase é a pipeline + o `.db` + o
  `manifest.json`. Qualquer um baixa o arquivo e roda as queries — e reconstrói do
  zero se quiser. Reforça o não repúdio (base auditável offline).
- Sem servidor, sem porta, sem tuning de conexão.

Migrar para Postgres depois é possível (SQL padrão, `sqlite3 → pg_dump`-like), mas
não é meta agora.

## Decisão

### 1. Configuração

- **WAL mode** (`PRAGMA journal_mode=WAL`) — leitores não bloqueiam o escritor.
- `PRAGMA foreign_keys=ON` em toda conexão (SQLite não força FK por padrão).
- `PRAGMA synchronous=NORMAL` (suficiente com WAL para carga em lote).
- Um único processo escritor. Jobs de ETL rodam em série ou coordenados por lock de
  aplicação — não paralelizar escrita.
- Conexões de consulta/regra abrem com `PRAGMA query_only=ON`.

### 2. Idioma e convenções de tipo

Nomes de tabela e coluna do schema são **em inglês** (`source`, `collection`,
`people`, `politician_history`, `provenance_id`, ...). Termos de domínio brasileiros
ficam como estão (`cpf`, `cnpj`, `tse`, `voter_id` para título eleitoral). O texto
das ADs continua em português.

Tipos, em SQLite:

| Tipo lógico | Em SQLite | Observação |
| --- | --- | --- |
| id / PK | `INTEGER PRIMARY KEY` | alias de `rowid`, autoincrementa |
| timestamp | `TEXT` | ISO-8601 UTC, ex. `2026-09-03T12:00:00Z` (`*_at`) |
| data | `TEXT` | `YYYY-MM-DD` |
| dinheiro | `INTEGER` | **centavos** (`*_cents`), nunca `REAL` |
| json | `TEXT` | funções `json_*` do SQLite |
| booleano | `INTEGER` | `0` / `1` (`*_trusted`, `cpf_trusted`, ...) |
| array | **tabela de junção** | SQLite não tem array — ver §3 |

### 3. Arrays viram tabelas de junção

Um "conjunto" dentro de uma linha vira tabela filha. Ex. (em
[dados_derivados.md](dados_derivados.md)): os atores e as evidências de um `signal`
são `signal_actor(signal_id, ...)` e `signal_evidence(signal_id, table_name,
record_id)`.

### 4. Sem append-only no banco — rewrite-only

SQLite não tem papéis nem permissões, e não precisamos. O banco é um artefato de
build descartável (ver [imutabilidade.md](imutabilidade.md)):

- **Sem triggers de imutabilidade.** As tabelas são mutáveis durante o build (o
  `promote` faz `UPDATE`/`DELETE`). Consumidores abrem com `PRAGMA query_only=ON`.
- O staging é `CREATE TEMP TABLE` — não entra no `.db` entregue.
- A âncora de integridade é o **`manifest.json` commitado no git** + `elosys
  verify`, não o arquivo `.db` nem hash chain.
- Implementação em `elosys/db.py` (`connect(write=...)`, `create_schema`) e no
  `promote` de `elosys/tse/candidates.py`.

### 5. Full-text / normalização de nome

Busca por nome (reconciliação de identidade) usará a extensão **FTS5** do SQLite numa
tabela virtual espelhando `politician_history.normalized_name`. Sem dependência
externa. (Ainda não criada — a resolução inline atual casa por igualdade exata.)

## Consequências

- Nada de recursos Postgres-only: sem `GENERATED ALWAYS`, sem índices parciais com
  expressões complexas (SQLite tem índice parcial simples, ok), sem tipos array,
  sem `SERIAL` (usar `INTEGER PRIMARY KEY`).
- Escrita concorrente é limitação real — o desenho do ETL tem que assumir escritor único.
- Backup = copiar o arquivo (com o banco fechado ou via `VACUUM INTO`).
- Distribuir a base é `scp` de um arquivo.

## Pontos em aberto

- ⚠️ Tamanho projetado do `.db` depois de todas as fontes — reestimar quando as
  doações entrarem (volume bem maior que candidatos).
- ⚠️ Migração de schema **não é problema** enquanto for rewrite-only: mudou o
  schema → `schema.sql` novo → rebuild. Só vira questão se algum dia o build
  passar a ser incremental.
- ⚠️ Se a análise de rede (grafo de relações) crescer muito, pode pedir um passo
  fora do SQLite (ex.: exportar para um processador de grafo). Não é problema do MVP.
