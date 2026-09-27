# Elosys — cruzamento de dados públicos de políticos brasileiros

Elosys monta, a partir de **fontes oficiais e públicas**, uma base de dados
consolidada de candidatos e eleitos brasileiros (2014–2026), cruzada por CPF/CNPJ,
para investigar relações entre políticos e levantar **indícios** de padrões
suspeitos (doação circular, fracionamento de doações, empresas de fachada,
enriquecimento incompatível).

> **Indício não é prova.** Nada aqui é acusação. O sistema gera *sinais de alerta*
> para serem checados por quem tem competência para isso (Ministério Público, TCU,
> Receita, COAF). Todo dado exibido aponta para o arquivo público de onde saiu, e
> qualquer pessoa pode re-baixar esse arquivo e conferir (`elosys verify`).

Backend: pipeline de coleta em Python + banco SQLite (`elosys.db`). Frontend:
app Next.js só-leitura em [`/web`](web/README.md) — busca candidato e mostra a
ficha completa com a fonte de cada campo.

Já coletado: **1,63 M candidaturas** (`consulta_cand` 2014–2026, ~1,18 M pessoas),
**1,04 M CNPJs de campanha**, **5,16 M doações** (R$ 26,7 bilhões, quem doou pra
cada CNPJ e quanto), **9,47 M despesas contratadas** (R$ 16,2 bilhões, pra quem
a campanha pagou), **10,89 M pagamentos** (R$ 18,85 bilhões, regime de caixa —
quando o dinheiro de fato saiu), **841 mil redes sociais declaradas** por
candidatura (Facebook/Instagram/X/site, obrigatório desde 2018), **25,5 mil
sanções federais** CEIS/CNEP (474 empresas sancionadas já cruzam com doador/
fornecedor de campanha) e **3,25 M bens declarados** (R$ 445,5 bilhões,
patrimônio no registro de candidatura). Banco ~11,7 GB.

---

## Como funciona, em uma frase

Cada fonte de dados tem um **crawler independente** (`elosys/tse/*.py`). Rodar um
crawler apaga as tabelas dele e reconstrói tudo do zero a partir dos arquivos do
governo. O banco é um artefato descartável; a prova de integridade fica no
`manifest.json`, versionado no git.

## Rodando

Requer [uv](https://docs.astral.sh/uv/) (gerencia Python e dependências).

```sh
uv sync                                   # instala tudo

# cada crawler é independente — rode na ordem que quiser
uv run elosys tse-candidates --db elosys.db     # cadastro de candidaturas (TSE consulta_cand)
uv run elosys tse-accounts   --db elosys.db     # CNPJ de campanha (TSE prestação de contas)
uv run elosys tse-social     --db elosys.db     # redes sociais declaradas (TSE rede_social_candidato)
uv run elosys tse-assets     --db elosys.db     # bens declarados (TSE bem_candidato)
uv run elosys transparencia-sanctions --db elosys.db  # CEIS/CNEP (Portal da Transparência, sem --years)
uv run elosys receita-cnpj --db elosys.db --limit 500  # cadastro de CNPJ (BrasilAPI; incremental, prioriza fornecedor/doador por $ recebido)

uv run elosys verify   --db elosys.db     # re-baixa as fontes e confere os hashes
uv run pytest                             # testes (usam fixtures, sem rede)

# regras de detecção rodam depois, sobre o que já foi coletado
uv run elosys rule-disproportionate-expense --db elosys.db
uv run elosys rule-circular-donations --db elosys.db          # demora (~15 min na base real, ver ADs/dados_derivados.md)

# cruzamento: candidato sócio de empresa que recebeu pagamento de campanha
uv run elosys candidate-supplier-partner --db elosys.db       # precisa de quadro societário (receita-cnpj)

# opcional: segunda opinião de LLM sobre os sinais (rotineiro vs. bizarro)
export DEEPSEEK_API_KEY=sk-...                                 # NUNCA commitar a chave
uv run elosys ai-review --db elosys.db --limit 100 --order tight

# opcional: discurso público no X de contas declaradas ao TSE (ver ADs/dados_derivados.md §1.4)
export APIFY_TOKEN=apify_api_...                               # NUNCA commitar
uv run elosys social-x     --db elosys.db --scope federal      # coleta (léxico como filtro)
uv run elosys social-review --db elosys.db --limit 5000        # triagem por LLM (rotineiro vs. pejorativo)
```

Sem `--years`, cada crawler processa todos os anos suportados (2018, 2020, 2022,
2024, 2026). Os arquivos do TSE são grandes (a prestação de contas passa de 1 GB por
ano); o download vai para `dados_tmp/` e é apagado depois de processado.

**Cada crawler é rewrite-only:** ao rodar, ele apaga as tabelas que possui e as
reconstrói. A tabela passa a conter **exatamente os anos que você passou** em
`--years` — então para ter todos os anos, rode sem `--years` (ou liste todos).
Para um estado 100% limpo: `rm elosys.db` e rode os crawlers de novo.

> Se um download der HTTP 403: o filtro anti-bot da fonte (Akamai) barrou. Baixe o
> `.zip` no navegador, jogue em `dados_tmp/` com o nome que o log mostrou, e rode o
> crawler de novo — ele usa o arquivo local.

## O que fica no banco

| Tabela | O que é | Crawler |
|---|---|---|
| `politician_history` | Uma linha por candidatura por eleição (nome, partido, cargo, UF, situação, resultado, dados de registro) | `tse-candidates` |
| `people` | Pessoa (chave surrogate; `cpf`/`voter_id` como identificadores) — todo JOIN por pessoa passa aqui, nunca por CPF cru | compartilhada |
| `companies` | Empresa por CNPJ (`kind`: campaign/donor/supplier/sanctioned) | compartilhada |
| `campaign_org` | O CNPJ que cada candidatura abre para a campanha (Receita, natureza 409-4) | `tse-accounts` |
| `campaign_donation` | Cada doação recebida: quem doou (CPF/CNPJ, nome), quanto, quando, por qual via | `tse-accounts` |
| `campaign_expense` | Cada despesa contratada: pra quem a campanha pagou, quanto, por qual serviço | `tse-accounts` |
| `campaign_expense_payment` | Quando cada despesa foi de fato paga (pode ser em parcelas) | `tse-accounts` |
| `social_media` | Redes sociais/site declarados no registro da candidatura (URL + rede detectada) | `tse-social` |
| `declared_assets` | Bens declarados no registro da candidatura (tipo, descrição, valor) | `tse-assets` |
| `company_registry` / `company_partner` | Data de abertura, situação cadastral e sócios de um CNPJ | `receita-cnpj` (incremental) |
| `sanction` | CEIS/CNEP: quem está impedido de contratar com o governo ou punido por corrupção | `transparencia-sanctions` |
| `rejected_cpf` | CPFs descartados por ambiguidade (mesmo CPF em >1 título eleitoral, etc.) e o motivo | `tse-candidates` |
| `source` / `collection` / `collection_file` / `parse` | Proveniência: de qual órgão, qual URL, qual arquivo, qual hash, qual parser saiu cada linha | todos |
| `rule_run` / `signal` / `signal_actor` / `signal_evidence` | Sinais de alerta gerados por regras de detecção (não vêm de nenhuma fonte — ver [`ADs/dados_derivados.md`](ADs/dados_derivados.md)) | `rule-disproportionate-expense`, `rule-circular-donations` |
| `signal_ai_review` | Segunda opinião de um LLM sobre cada sinal (rotineiro vs. bizarro), com a resposta e o prompt salvos verbatim | `ai-review` (opcional, precisa de `DEEPSEEK_API_KEY`) |
| `candidate_supplier_partner` | Candidato que aparece no quadro societário de empresa que recebeu pagamento de campanha (match nome + 6 dígitos do CPF — **não** determinístico) | `candidate-supplier-partner` |

Toda linha de dado tem `provenance_id` → `parse` → `collection` → `source`.
"De onde veio isso?" é um `JOIN`.

## Sinais de alerta (regras de detecção)

Diferente das tabelas acima, `rule_run`/`signal`/`signal_actor`/`signal_evidence`
**não vêm de nenhuma fonte** — são geradas pelo nosso código sobre os dados já
coletados. Mesma disciplina de proveniência: toda linha em `signal_evidence`
aponta pra uma linha real (que por sua vez tem seu próprio `provenance_id`), e
`severity` só existe como `low`/`medium`/`high` — nunca "confirmado" ou
"fraude". Ver [`ADs/dados_derivados.md`](ADs/dados_derivados.md).

**Primeira regra: `disproportionate_expense`** ("despesa desproporcional") —
item tipicamente barato (caneta, adesivo, crachá...) contratado por valor alto
em `campaign_expense.description`. Rodada contra a base real: **22.269
sinais** (1.232 `high` ≥ R$ 50 mil, 21.037 `medium` ≥ R$ 5 mil). Maior caso:
**R$ 2.504.200,00** em "PRAGÕES, BIG HAND, PERFURADO, PRAGUINHA, ADESIVO". O
TSE não publica quantidade nesse arquivo, só o valor total — a regra não
calcula preço unitário, só sinaliza "valor alto pra uma categoria
tipicamente barata". Pode ser lote grande, item não detalhado na descrição,
ou erro de digitação — por isso é indício, não prova.

**Segunda regra: `circular_donations`** ("doação circular") — constrói um
grafo dirigido (doador → candidato, candidato → fornecedor) sobre a base
inteira e usa Tarjan (SCC) + DFS limitado em profundidade (padrão: 5 nós)
pra achar ciclos: dinheiro que sai de uma campanha e volta pra mesma cadeia.
Rodada contra a base real: grafo de **5,35M nós / 7,66M arestas**, **108.400
ciclos encontrados** (63.556 `high` ≤ 3 nós, 44.844 `medium`). Interface em
[`/sinais/doacao-circular`](web/src/app/sinais/doacao-circular/page.tsx) —
filtro por severidade, **ordenável por valor movimentado ou tamanho do
caminho** — com link direto pro grafo interativo. Mesma disciplina: indício,
não prova — pode ser coincidência de coligação, ressarcimento, ou merecer
checagem manual.

**Cruzamento: `candidate_supplier_partner`** — candidato que aparece no
quadro societário de uma empresa que recebeu pagamento de campanha. O CPF do
sócio vem mascarado da Receita, então o match é `normalize(nome) ==
canonical_name` **E** os 6 dígitos visíveis do CPF batendo — **não é
identidade confirmada** (fica fora de `people`/`signal_actor`, rotulado
"possível"). Ambíguos (2+ pessoas batendo) são descartados. Rodado contra a
base real: **533 vínculos possíveis** (R$ 197,9 mi movimentados nessas
empresas), **66** onde a própria campanha do candidato pagou a empresa dele
(gráfica própria imprimindo material de campanha, escritório de advocacia
próprio, etc.). Interface em
[`/sinais/socio-fornecedor`](web/src/app/sinais/socio-fornecedor/page.tsx).

**Camada opcional: `ai-review`** (`elosys/rules/ai_review.py`) — passa os
fatos de cada sinal de doação circular / despesa desproporcional pra um LLM
barato (DeepSeek) e pergunta: *rotineiro* ou *genuinamente estranho*? A
resposta, a explicação, os fatos citados e o **prompt exato** ficam salvos em
`signal_ai_review` (um por sinal+modelo), pra um humano poder conferir o
raciocínio do modelo contra os dados. Incremental (não rewrite-only): roda de
novo pra revisar mais, `--refresh` re-revisa. Ordena por valor (`--order
amount`, pega os casos de conta-de-partido que o modelo tende a achar
plausíveis) ou por ciclo mais curto (`--order tight`). Chave via
`DEEPSEEK_API_KEY` no ambiente — **nunca commitada**. Interface em
[`/sinais/analise-ia`](web/src/app/sinais/analise-ia/page.tsx). Continua
sendo indício — agora com a opinião de uma máquina, que também erra.

## Os arquivos de log e auditoria

Cada execução de crawler escreve/atualiza, ao lado do `.db`:

- **`manifest.json`** — a lista de *todos* os arquivos baixados, com `url`,
  `accessed_at`, `sha256` do `.zip` e `sha256` de cada CSV dentro dele. **É a âncora
  de não repúdio**: você commita esse arquivo no git, e aí o histórico público do
  repositório prova o que foi coletado e quando. `elosys verify` re-baixa cada URL
  e compara os hashes com esse manifesto.
- **`tse_candidates_report.json`, `tse_accounts_report.json`, `tse_social_report.json`**
  — o relatório daquela execução: linhas lidas por ano, CNPJs/candidaturas/URLs
  gerados, CPFs derrubados por ambiguidade (com o motivo), quantas linhas ficaram
  sem vínculo de identidade.

Além disso, **o próprio console é um log**: cada crawler imprime a URL, o tamanho e
o hash do arquivo, o progresso da leitura linha a linha, e um resumo por ano.

## Conceitos de arquitetura (ADs)

As decisões estão em [`ADs/`](ADs/), uma por assunto. Resumo:

| AD | Ideia central |
|---|---|
| [`confiabilidade.md`](ADs/confiabilidade.md) | **Não repúdio.** Nenhuma linha existe sem apontar para a coleta que a originou. Não guardamos o arquivo bruto — guardamos `URL + data + SHA256`, e você re-baixa para conferir. |
| [`imutabilidade.md`](ADs/imutabilidade.md) | **Rewrite-only.** O banco é reconstruído do zero a cada execução. A garantia contra "editar o passado" é o `manifest.json` commitado + build determinístico, não triggers nem hash chain. |
| [`banco.md`](ADs/banco.md) | **SQLite**, arquivo único, sem servidor. Convenções de tipo (datas ISO em UTC, dinheiro em centavos, nomes de tabela/coluna em inglês). |
| [`identidade.md`](ADs/identidade.md) | Identidade é **afirmação nossa**, não dado da fonte. Match determinístico por título eleitoral e CPF. Na dúvida (CPF ambíguo), **não afirma** — descarta o CPF e registra o porquê. |
| [`politician.md`](ADs/politician.md) | Sem tabela "o político X"; só "a candidatura de X no ano N" (`politician_history`). CPF mascarado de 2024 tratado por título eleitoral. `campaign_org` para o CNPJ de campanha. |
| [`dados_derivados.md`](ADs/dados_derivados.md) | Correlações e flags (`disproportionate_expense`, `circular_donations`) também têm proveniência: qual regra, qual versão, sobre quais linhas. Severidade só `low/medium/high`, nunca "confirmado". |

## Fontes de dados (todas oficiais/públicas)

| Fonte | O que traz | Estado |
|---|---|---|
| TSE — `consulta_cand` | Cadastro de candidaturas | ✅ coletado (2014–2026) |
| TSE — prestação de contas eleitorais | CNPJ de campanha; doações e despesas | ✅ coletado (CNPJ, doações, despesas contratadas e pagas) |
| TSE — `rede_social_candidato` | Redes sociais/site declarados no registro (obrigatório desde a Res. 23.610/2019) | ✅ coletado (2018–2026) |
| X/Twitter (via Apify) | Posts/replies de contas **declaradas ao TSE**, filtrados por léxico e triados por LLM (`social-x` + `social-review`, ver ADs/dados_derivados.md §1.4) | ✅ eleitos federais |
| TSE — `bem_candidato` | Bens declarados no registro (base do sinal de patrimônio) | ✅ coletado (2014–2026) |
| TSE — `foto_cand` (DivulgaCandContas, busca por CPF) | Foto oficial por candidatura | ✅ coletado (parcial, incremental — ver ADs/politician.md §5) |
| TSE — DivulgaCandContas | Certidões criminais | ⬜ pendente |
| Receita Federal (BrasilAPI) | Quadro societário de CNPJ, data de abertura, capital | ✅ coletado (incremental — não é rewrite-only, ver ADs/politician.md §2.3) |
| CNJ — DataJud | Metadados de processos judiciais públicos | ⛔ inviável pela API pública — ver nota abaixo |
| Portal da Transparência — CEIS/CNEP | Empresas/pessoas impedidas de contratar com o governo ou punidas por corrupção | ✅ coletado (snapshot diário) |
| Portal da Transparência — contratos/emendas | Contratos, convênios, emendas parlamentares | ⬜ pendente |
| Câmara / Senado — dados abertos | Mandatos em exercício, votações, cota parlamentar (CEAP) | ⬜ pendente |

**Não coletamos** (protegido / sigiloso): endereço residencial, telefone e e-mail
pessoal de candidatos; antecedentes fora de processo público; relatórios do COAF.

### Por que "quantidade de processos judiciais por candidato" não dá pra fazer (hoje)

Pesquisamos a API Pública do DataJud (CNJ) especificamente pra isso. Conclusão:
**os documentos que ela devolve não têm nome, CPF nem CNPJ das partes** — só
metadado processual (`numeroProcesso`, `tribunal`, `classe`, `assuntos`,
`orgaoJulgador`, `movimentos`, datas). O glossário oficial da API
([datajud-wiki.cnj.jus.br/api-publica/glossario](https://datajud-wiki.cnj.jus.br/api-publica/glossario/))
não lista nenhum campo de parte — é proposital, por sigilo (Portaria CNJ
160/2020). Sem CPF/nome no índice, **não dá pra buscar "todos os processos do
candidato X"** por essa API; ela só serve se você já sabe o número do
processo, ou quer estatística agregada (quantos processos por classe/tribunal
no geral), não "quantos processos tem essa pessoa".

A alternativa real seria raspar a consulta processual pública de cada tribunal
(TJ/TRF/TRT etc.) individualmente por nome — 90+ tribunais, sem padrão comum de
resposta, boa parte também mascara ou omite nome em processos sigilosos, e é
exatamente o tipo de fonte "não reprodutível" que já discutimos em
[`ADs/confiabilidade.md`](ADs/confiabilidade.md) §2. Não está no radar de
próximos passos por isso — é trabalho de raspagem massivo pra um retorno
incerto, não uma tarde de crawler.

## Premissa legal e ética

- Todas as fontes são **públicas por determinação legal/judicial**.
- CPF de candidato: mascarado em 2024 (decisão do TSE por LGPD), revertido para 2026.
  A base de 2024 é reconciliada por título eleitoral — ver [`ADs/identidade.md`](ADs/identidade.md).
- O resultado é **indício, não prova**. O sistema gera sinais de alerta, não
  conclusões. Nada aqui deve virar acusação pública sem apuração formal.

## Próximos passos

1. Continuar rodando `receita-cnpj` em lotes (atualizado em 2026-09-23 — os
   números abaixo mudam a cada rodada, conferir com as queries em
   `elosys.db` antes de citar de novo). A fila prioriza por dinheiro
   recebido/doado (`--order money`, padrão), então a cobertura em **R$ já
   está bem mais alta que em CNPJs**: **18.628** CNPJs enriquecidos
   (`company_registry`) de **382.595** fornecedores distintos (~4,9% em
   contagem) cobrem **70,8% do valor total pago a fornecedores CNPJ** (R$
   7,15 bi de R$ 10,10 bi). Sobra uma cauda longa de ~366 mil CNPJs de baixo
   valor individual — é rate-limited (1 request por CNPJ), então cada lote
   fecha a lacuna que resta em R$ mais devagar que em contagem. A fonte
   definitiva seria o dump de dados abertos de CNPJ da Receita (todas as
   empresas de uma vez, sem rate limit).
2. Guardar os `.zip` do TSE num store por hash (mitiga perda de valor se a fonte
   republicar um arquivo alterado).
3. `disproportionate_expense` v2: outlier estatístico por categoria de despesa
   (mediana), além do léxico fixo de palavras-chave.
4. **Teto de gastos de campanha (limite legal) por candidatura.** Hoje a ficha
   do candidato já compara **recebido em doações × despesas contratadas ×
   pago** (`getPersonProfile().finance`, ver `web/src/lib/queries.ts` e os
   KPIs em `/politico/[id]`) — isso já está pronto. O que falta é o **teto
   oficial do TSE** (valor máximo que a lei permite gastar naquela
   candidatura/cargo/UF) pra comparar "quanto gastou" contra "quanto podia
   gastar", não só contra "quanto arrecadou". O TSE publica esse limite
   separadamente (fora do `consulta_cand` e da prestação de contas já
   coletados) — precisa de um crawler novo (`elosys/tse/*.py`) pra achar e
   parsear esse arquivo antes de dar pra prometer o dado.
5. Regra "fornecedor/doador sancionado" — cruzar `sanction` × `campaign_donation`/
   `campaign_expense` (já sabemos que bate: 474 empresas sancionadas em comum).
