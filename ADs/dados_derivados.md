# AD — Proveniência de dados derivados (correlações e regras de detecção)

**Status:** Proposta
**Relacionado:** [confiabilidade.md](confiabilidade.md), [imutabilidade.md](imutabilidade.md)

> Nomes de tabela/coluna em inglês (ver [banco.md](banco.md)); texto em português.

## Contexto

Correlações (sócios em comum, doadores em comum, parentesco) e flags de detecção
(doação circular, fracionamento, patrimônio incompatível) **não vêm de nenhuma
fonte** — são produzidas pelo nosso código sobre os dados coletados. O README é
explícito: o resultado é **indício, não prova**, e deve ser "sinal de alerta", não
conclusão. Para não repúdio, um sinal de alerta precisa ser tão auditável quanto um
dado bruto: qual regra, qual versão, sobre quais linhas.

## Decisão

### 1. Toda saída derivada referencia entradas + regra + execução

SQLite não tem array, então os "conjuntos" (pessoas, empresas, evidências de um
sinal) são tabelas filhas.

```sql
rule_run (
  id              INTEGER PRIMARY KEY,
  rule            TEXT NOT NULL,        -- 'circular_donation'
  rule_version    TEXT NOT NULL,        -- 'v1.2'
  code_commit     TEXT NOT NULL,        -- git SHA
  params          TEXT,                 -- JSON: limiares usados
  run_at          TEXT,
  rows_generated  INTEGER
)

signal (
  id            INTEGER PRIMARY KEY,
  rule_run_id   INTEGER NOT NULL REFERENCES rule_run(id),
  type          TEXT,
  severity      TEXT,                   -- low / medium / high — nunca "confirmado"
  explanation   TEXT                    -- texto legível do porquê
)

signal_actor (                          -- quem está no sinal
  signal_id INTEGER NOT NULL REFERENCES signal(id),
  type      TEXT NOT NULL,              -- 'person' | 'company'
  actor_id  INTEGER NOT NULL,          -- people.id ou companies.id
  role      TEXT                       -- 'donor', 'recipient', 'partner'...
)

signal_evidence (                       -- linhas de dado que alimentaram o sinal
  signal_id  INTEGER NOT NULL REFERENCES signal(id),
  table_name TEXT NOT NULL,            -- 'campaign_donations'
  record_id  INTEGER NOT NULL,
  PRIMARY KEY (signal_id, table_name, record_id)
)
```

As linhas em `signal_evidence` apontam para tabelas com `provenance_id` — então de
um sinal chega-se, por transitividade, a todas as URLs/arquivos de origem. Um sinal
sem nenhuma linha em `signal_evidence` é inválido.

### 2. Regras são jobs isolados, versionados e testáveis

Cada regra: um módulo, uma versão semântica própria, testes com **dados sintéticos**
antes de rodar na base real (já previsto no README). As regras rodam como parte do
build (rewrite-only): mudou a regra, rebuilda — os sinais são recalculados do zero.

### 3. Reprodutibilidade

Dado o `manifest.json` do build (fontes + hashes), o `code_commit` e os `params`
do `rule_run`, qualquer pessoa reconstrói o banco e reroda a regra, chegando no
mesmo conjunto de sinais. Esse é o teste de aceitação de "não repúdio de dado
derivado".

### 4. Linguagem

`severity` só assume `low|medium|high`. Proibido `confirmado`, `culpado`, `crime`. A
camada de apresentação (fase futura) exibe sempre o disclaimer do README e o caminho
até as fontes.

## Consequências

- Cada regra carrega o custo de registrar execução + evidências. Padronizar numa
  base comum (`elosys.rules`).
- Recalcular tudo é sempre possível e barato de auditar.
- Score agregado por político (se existir) é ele próprio uma regra derivada de sinais
  — mesma disciplina.

## Pontos em aberto

- ⚠️ Score consolidado por político entra no MVP ou só sinais individuais primeiro?
- ⚠️ Sinais que dependem de dado com `cpf_trusted = 0` devem ser rebaixados de
  severidade automaticamente? Proposta: sim, teto de `medium`.
