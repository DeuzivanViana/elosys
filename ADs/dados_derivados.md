# AD — Proveniência de dados derivados (correlações e regras de detecção)

**Status:** Aceita — regras implementadas (`disproportionate_expense`,
`circular_donations`, `candidate_supplier_partner`) + duas camadas opcionais
de triagem por LLM: `ai_review` sobre sinais financeiros (§1.3) e
`social_review` sobre discurso em rede social (§1.4).
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

O SQL real está em `elosys/schema.sql` (`rule_run`/`signal`/`signal_actor`/
`signal_evidence`) — o bloco acima é o desenho original; a única diferença é
`signal_actor.role` como `NOT NULL` (toda linha de ator já sabe seu papel).

### 1.1. Primeira regra: `disproportionate_expense` ("despesa desproporcional")

`elosys/rules/disproportionate_expense.py` — roda com `elosys
rule-disproportionate-expense`. v1.0, deliberadamente simples: uma lista de
palavras-chave de item barato (caneta, adesivo, crachá...) + dois limiares de
valor (`medium` ≥ R$ 5.000, `high` ≥ R$ 50.000) contra
`campaign_expense.description`. Rodada contra a base real: **22.269 sinais**
(1.232 `high`, 21.037 `medium`), maior caso: R$ 2.504.200,00 em "PRAGÕES, BIG
HAND, PERFURADO, PRAGUINHA, ADESIVO".

O TSE não publica quantidade nesse arquivo, só o valor total contratado — a
regra não calcula preço unitário, só sinaliza "valor alto pra categoria
tipicamente barata". Uma v2 com outlier estatístico por `DS_ORIGEM_DESPESA`
(comparar contra a mediana da categoria) fica em aberto — ver Pontos em aberto.

### 1.2. Segunda regra: `circular_donations` ("doação circular")

`elosys/rules/circular_donations.py` — roda com `elosys
rule-circular-donations --db elosys.db [--max-depth N] [--max-fanout N]`, ou
direto: `python -m elosys.rules.circular_donations`. Diferente da primeira
regra (uma passada sobre uma tabela), esta constrói um grafo dirigido sobre a
base inteira (doações: doador → candidato; despesas: candidato → fornecedor,
resolvidos pelo CPF/CNPJ real via `campaign_org.person_id`, pulando o CNPJ de
campanha) e busca **ciclos** — dinheiro que sai de uma campanha e volta pra
mesma cadeia.

Método: Tarjan (SCC, iterativo, O(V+E)) primeiro pra descartar tudo que não
pode estar em ciclo nenhum; dentro de cada componente fortemente conectado,
DFS limitado em profundidade (`max_depth`, default **5** nós) enumera os
ciclos simples. Um `max_fanout` (default 400) evita explosão combinatória em
nós-hub (conta de partido, grande comitê) — a busca não ramifica *através*
deles, só registra que ficaram de fora.

Rodada contra a base real: grafo de **5.350.221 nós / 7.658.959 arestas**
(a partir de ~5M doações + ~8M despesas), Tarjan em 12s, **108.400 ciclos**
encontrados em 10.5s de enumeração (402.986 ramificações por nó-hub
puladas). Severidade: `high` se o ciclo tem até 3 nós, `medium` acima disso.
Escrever os sinais (uma consulta de nomes + atores + evidência por ciclo)
foi a parte mais lenta: ~22 minutos pra 108.400 sinais, já que cada um bate
no banco várias vezes; ficou registrado como ponto de otimização futura (ver
Pontos em aberto) mas não bloqueou o resultado.

`v1.1` adicionou um piso `min_amount_cents` (default R$ 1.000,00) direto na
regra: um ciclo cujo `total_amount` fica abaixo do piso não gera sinal
nenhum (nem bate no banco). Rodando de novo contra a base real: dos mesmos
108.400 ciclos, **9.658 ficaram abaixo do piso** e foram descartados —
**98.742 sinais gerados** (54.714 `high`, 44.028 `medium`), ~8,9% a menos
que antes, sem perder nenhum ciclo que já fosse relevante por valor.

Interface: `/sinais/doacao-circular` no app web lista os sinais (filtro por
severidade, **ordenável por severidade/valor movimentado/tamanho do
caminho**, paginado) com um link "ver no grafo" que abre `/grafo?add=...`
já com os CPFs/CNPJs do ciclo carregados.

`signal` ganhou duas colunas genéricas (não específicas da regra, qualquer
outra pode usar): `amount_cents` (valor exato do ciclo — soma de TODAS as
transações de cada aresta, não só a amostra de `signal_evidence`) e
`path_length` (nº de nós do ciclo). Como `signal` já existia populado, a
migração é uma `ALTER TABLE ADD COLUMN` idempotente em `db.py::_migrate` —
`create_schema()` já roda ela toda vez, então um banco antigo se atualiza
sozinho na próxima execução de qualquer crawler/regra.

O maior ciclo por valor na base real: **R$ 177.776.963,25**, entre o diretório
nacional do PT, Lula, um CNPJ e outra candidata — número alto porque a conta
nacional de um partido naturalmente acumula fluxo com centenas de campanhas;
não é por si só incomum, é exatamente o tipo de caso que pede o "indício, não
prova" e uma checagem manual pra dizer se é notável.

### 1.3. Camada de triagem por LLM: `ai-review`

`elosys/rules/ai_review.py` — roda com `elosys ai-review`, opcional, precisa
de `DEEPSEEK_API_KEY` no ambiente (nunca em arquivo). 108k sinais de doação
circular é volume demais pra um humano varrer, e a maioria "faz sentido".
Este job passa os fatos de cada sinal (o resumo + as entidades com partido/
cargo/UF + as transações com valor e ano; ou, pra despesa desproporcional, o
item + categoria + fornecedor + candidato) pra um modelo barato e pede um
JSON: `verdict` (bizarro / plausivel / inconclusivo), `confianca`,
`explicacao`, `fatos`. Tudo isso + o **prompt exato** + a resposta crua
ficam em `signal_ai_review` (um por sinal+modelo).

Não é rewrite-only e **não é uma regra** (sem `rule_run`): é um cache
incremental — roda de novo pra cobrir mais sinais, `--refresh` re-revisa.
`--order tight` prioriza ciclos curtos (2-3 nós, mais suspeitos que os loops
longos dominados por repasse partidário); `--order amount` pega os de maior
valor (que o modelo tende a chamar de plausíveis — serve de sanidade).
`--min-amount-brl` corta o ruído dos ciclos de R$ 20.

O system prompt é explícito: os sinais **não são acusação**, `bizarro`
significa "vale conferir", nunca "é culpado". A primeira versão do prompt
mandava "na dúvida use inconclusivo" e o modelo obedeceu literalmente —
**541 revisões, zero `bizarro`**, tudo em inconclusivo/plausível, triagem
inútil. A v2 pede um veredito de priorização decisivo: se há UM fato
concreto que dificulta a explicação simples (ciclo fechado entre pessoas sem
partido em comum, fornecedor de ramo alheio, valor uma ordem de grandeza
fora), diga `bizarro` e nomeie o fato; `inconclusivo` só quando os fatos não
apontam pra lado nenhum. Rodando refresh com a v2 (`--refresh`): num teste
de 8 ciclos deu 2 `bizarro` (confiança alta), 5 `plausivel`, 1
`inconclusivo`.

Isso NÃO substitui o "indício, não prova" — só adiciona a opinião de uma
máquina (que também erra) ao lado do sinal, com o raciocínio exposto pra
conferência. Interface: `/sinais/analise-ia`, e o veredito aparece como selo
na ficha do candidato e na lista de doações circulares.

### 1.4. Discurso público em rede social: `social-x` + `social-review`

Fonte diferente do resto (não é arquivo do governo): posts do X/Twitter de
contas **declaradas pelo próprio candidato ao TSE** (`social_media`, vindo de
`rede_social_candidato`, obrigatório desde a Res. 23.610/2019). O crawler
`elosys/social/x_posts.py` (comando `elosys social-x`, precisa de
`APIFY_TOKEN`) NUNCA adivinha handle — parte da URL declarada.

**Léxico como filtro de recall.** `elosys/social/lexicon.py` — ~470 termos
PT-BR que PODEM ser pejorativos (homofobia, racismo, misoginia, capacitismo,
xenofobia, regionalismo, antissemitismo, intolerância religiosa, aporofobia,
gordofobia, etarismo, desumanização), com peso `alta`/`media`/`baixa`. A
busca do X (`from:<handle> (termo OR termo ...)`) só arquiva os posts que
casam algum termo — reduz "todos os tweets" a "os que merecem leitura". É
deliberadamente FROUXO: `baixa` inclui palavra neutra/idiomática/reapropriada
("macaco", "viado", "nordestino") — melhor um falso positivo que o
`social-review` descarta do que perder o tweet. **O léxico é o teto de
recall**: ódio codificado sem palavra-chave nunca é coletado.

**Não repúdio de conteúdo efêmero.** Um tweet pode ser apagado — não dá pra
"re-baixar e conferir o hash" como nos arquivos do TSE. Por isso `social-x`
NÃO entra no `manifest.json` / `elosys verify`. A âncora é o payload cru do
scraper + `raw_sha256` + `retrieved_at` gravados INLINE em `social_post`,
mais o commit do git que registrou a linha. Um tweet apagado fica no banco
rotulado "arquivado em DD/MM/AAAA".

**`social-review` (`elosys/rules/social_review.py`, precisa de
`DEEPSEEK_API_KEY`).** Espelha o `ai-review`: passa o texto de cada post
sinalizado pro LLM e pergunta se, PELO CONTEXTO, aquilo ataca um grupo
protegido (ou é xingamento desumanizante a uma pessoa) — ou se é uso
legítimo (literal, citação, denúncia do próprio preconceito, reapropriação,
palavrão genérico). Devolve `ofensivo` (bool), `categorias`, `severity`
(low/medium/high — nunca "confirmado"), `trecho` verbatim e `explicacao`.
Incremental, `--refresh` re-revisa, roda em paralelo (`--workers`). Só julga
as palavras do autor — numa reply, o tweet-pai é só contexto.

Contra a base real (749 contas de eleitos federais, ~39 mil posts
arquivados): a maior parte dos sinais cai em `desumanização` +
`xingamento_pessoal` ("verme", "parasita", "lixo") — bate-boca político de
todos os lados, não preconceito de grupo. A UI separa esses das categorias
de grupo protegido. Continua indício: a tela sempre mostra o trecho literal
+ link pro tweet vivo, com selo "classificação automática, pode errar".

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
- ⚠️ `disproportionate_expense` v2: outlier estatístico por `DS_ORIGEM_DESPESA`
  (mediana da categoria) além do léxico de palavras-chave fixo — pega desproporção
  fora da lista de itens baratos, não só "caneta cara".
- ✅ ~~`circular_donations` v2: piso mínimo de valor NA REGRA~~ — `v1.1` adicionou
  `min_amount_cents` (default R$ 1.000,00, `--min-amount-brl` pra ajustar); um
  ciclo abaixo do piso não gera sinal nenhum, nem bate no banco. 108.400 → 98.742
  sinais na base real (ver §1.2).
- ✅ ~~`circular_donations`: escrita lenta~~ — cache de nomes/atores/evidência por
  todo o write phase (não só por ciclo) levou de ~22 min pra **~13,5 min** pros
  mesmos 108.400 sinais. Ainda mais lento que construir o grafo (~2 min) — o
  gargalo agora é puramente volume de `INSERT`/`SELECT` individuais; um batch real
  via `executemany` sobre TODOS os sinais de uma vez (não só a evidência de cada
  um) é o próximo passo se `max_depth` subir.
