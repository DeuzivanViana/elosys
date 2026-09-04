# AD — Banco de Confiabilidade (proveniência de dados)

**Status:** Aceita
**Relacionado:** [politician.md](politician.md), [imutabilidade.md](imutabilidade.md), [dados_derivados.md](dados_derivados.md)

## Princípio

> TODOS OS DADOS, SEM EXCEÇÃO, DEVEM TER UM "SOURCE" PÚBLICO E GOVERNAMENTAL
> PARA QUE OS USUÁRIOS CONSIGAM VALIDAR SE OS DADOS SÃO REAIS.

Não existe linha no banco sem ponteiro para a coleta que a originou. Um registro
sem proveniência é um bug, não um dado incompleto — a ingestão deve recusá-lo.

## Contexto

Os dados vêm de fontes heterogêneas (CSV zipado do TSE, APIs JSON da Receita/BrasilAPI,
API do CNJ, scraping de Diários Oficiais). Cada fonte tem cadência, formato e base
legal diferentes. O usuário final precisa conseguir dizer: *"este dado de 2024 veio
deste arquivo do TSE, baixado nesta data, com este hash"* — e, se quiser, rebaixar o
arquivo e conferir.

## Decisão

### 1. Cadeia de proveniência (nomes de tabela/coluna em inglês, como o schema)

```text
source  ──<  collection  ──<  collection_file  ──<  parse  ──<  record
```

| Tabela | O que é | Campos principais |
| --- | --- | --- |
| `source` | O órgão/dataset lógico | `id`, `name`, `agency`, `type` (csv/api/scraping), `base_url`, `legal_basis`, `notes` |
| `collection` | Um download/requisição concreto | `id`, `source_id`, `url`, `http_status`, `accessed_at` (UTC), `payload_sha256`, `size_bytes`, `content_type`, `collector_commit`, `notes` |
| `collection_file` | Um arquivo dentro da coleta (cada CSV do zip) | `id`, `collection_id`, `filename`, `sha256`, `size_bytes` |
| `parse` | Uma transformação do bruto em linhas | `id`, `collection_id`, `collection_file_id`, `parser_name`, `parser_commit`, `parser_version`, `rows_extracted`, `rows_rejected`, `run_at` |
| *(record)* | Qualquer linha de qualquer tabela de dados | FK `provenance_id` → aponta para `parse.id` (e por transitividade chega em `collection` e `source`) |

Toda linha de dado guarda `provenance_id`. Para chegar na URL basta
`record → parse → collection`. O `parse` no meio separa "o que baixamos" de "como
interpretamos" — se o parser tiver bug, conserta o código e rebuilda (ver
[imutabilidade.md](imutabilidade.md): o build é rewrite-only).

Além do banco, cada build escreve **`manifest.json`** (todas as `collection` +
`collection_file` com seus hashes) e o commita no git — é a âncora de integridade
e a entrada do `elosys verify`.

### 2. NÃO guardamos o arquivo bruto, NEM cópia verbatim das linhas

**Decisão (revista 2×).** Cogitou-se (a) arquivar o payload bruto em object storage
e (b) guardar a linha original de cada registro numa coluna `raw_data`.

- (a) **Descartado por custo:** o volume total previsto passa de **1 TB**.
- (b) **Descartado por redundância:** `raw_data` era ~1,45 GB de um `.db` de 2,5 GB
  e provava a mesma coisa que `collection_file.sha256` — um cético não confia mais
  na *nossa transcrição* do CSV do que no hash do arquivo. Quem quer conferir
  re-baixa o zip do TSE (`elosys verify` faz isso) e reprocessa. Se o parser
  larga um campo, isso é bug a corrigir + rebuild, não um problema de retenção.

O que `collection` registra é suficiente para o usuário refazer o caminho:

- `url` completa + `params` → o usuário rebaixa da fonte.
- `accessed_at` (UTC) → quando nós vimos aquilo.
- `payload_sha256` + `size_bytes` (e `collection_file.sha256` por CSV) → o usuário
  confere se o que baixou é idêntico ao que processamos.

**Riscos aceitos (documentar, não resolver agora):**

- Fonte que **republica** o arquivo na mesma URL (TSE/Transparência já fizeram):
  o hash do usuário não vai bater com o nosso e não teremos o original para exibir.
  Mitigação parcial: `collection.notes` registra se a fonte versiona por data/hash.
- **APIs não são reprodutíveis** (Receita, CNJ, Câmara): a resposta muda. Para essas,
  `payload_sha256` prova apenas o que *nós* recebemos, não permite reverificação
  independente. Aceitável — a alternativa (arquivar tudo) é o que estamos evitando.
- Se no futuro isso virar problema, dá para arquivar **seletivamente** só os
  payloads de API e de scraping (pequenos, não reprodutíveis) e continuar sem
  guardar os CSVs gigantes do TSE. Fica como TODO.

### 3. Proveniência no nível da linha, com associação para multi-fonte

- **Padrão:** cada linha aponta para **um** `parse` via `provenance_id`.
- **Quando uma linha combina fontes** (ex.: cadastro do `consulta_cand` + foto do
  DivulgaCandContas na mesma `politician_history`): não empilhar dois IDs num campo.
  Usar a tabela de associação:

  ```sql
  record_sources (
    table_name TEXT,        -- 'politician_history'
    record_id  INTEGER,
    field      TEXT,        -- NULL = a linha toda; 'photo_url' = só aquele campo
    parse_id   INTEGER REFERENCES parse(id),
    PRIMARY KEY (table_name, record_id, field, parse_id)
  )
  ```

  `provenance_id` na própria linha continua existindo e aponta para a fonte
  **primária** (a que define a identidade da linha). `record_sources` cobre o resto.
- **Proveniência por campo** (`field` não-NULL) só onde há valor real em jogo:
  foto oficial, bens declarados, `value_cents` de doação. Não vamos rastrear campo
  a campo de tudo — é overhead sem ganho.
- `record_sources` está no schema mas **não é usada nesta fatia** (fonte única);
  entra com a 2ª fonte (contas de campanha, foto).

### 4. Toda transformação registra sua versão

Normalização de nome, tentativa de desmascarar CPF, dedução de UF etc. são feitas
no parser, e o `parser_commit`/`parser_version` da `parse` identifica a versão da
transformação. Como o build é rewrite-only, "refazer com outra versão" = trocar o
código e rebuildar — o valor bruto está sempre no arquivo da fonte (hash em
`collection_file`), reproduzível via `elosys verify`.

### 5. Correlações também têm source

Toda linha de doação, sociedade, nomeação, parentesco carrega `provenance_id`.
A proveniência de **dados derivados** (a flag "doação circular", o score) é tratada
em [dados_derivados.md](dados_derivados.md).

## Consequências

- **Storage enxuto:** um arquivo SQLite (ver [banco.md](banco.md)). Sem object
  storage no MVP — não guardamos payload.
- **Ingestão mais cara:** todo coletor tem que registrar uma `collection` antes de
  escrever dado, e todo parser tem que abrir um `parse`. Padronizado no módulo
  `elosys.provenance` para não reimplementar.
- **Auditável de ponta a ponta:** dá para responder "de onde veio isso?" com um JOIN
  (`record → parse → collection → source`) e entregar ao usuário `url + accessed_at +
  sha256` para ele refazer o download e conferir — ou rodar `elosys verify`.
- O build inteiro é reproduzível a partir do `manifest.json` commitado.
- **Limitação conhecida:** não conseguimos provar o conteúdo de uma coleta antiga se
  a fonte alterar o arquivo — ver Riscos aceitos em §2.

## Pontos em aberto

- **Timestamp criptográfico externo (OpenTimestamps / TSA RFC 3161): descartado.**
  `accessed_at` é o relógio do nosso coletor. Aceitamos esse modelo de confiança —
  a rastreabilidade vem de `url + hash + manifesto commitado`, não de prova externa
  de data.
- ⚠️ **Arquivamento seletivo depois do MVP.** Guardar só os payloads pequenos e
  não reprodutíveis (respostas de API, páginas de scraping); nunca os CSVs do TSE.
  Reavaliar quando o volume de dados não reprodutíveis for conhecido.
- **Nota de implementação:** o `download()` usa `curl_cffi` com `impersonate="chrome"`
  — o Akamai Bot Manager do TSE barra por fingerprint TLS/JA3 qualquer cliente
  Python "cru" (`requests`/`urllib`/`curl`), independente de User-Agent ou IP.
  Se ainda assim vier 403, o coletor ingere de um arquivo baixado manualmente no
  navegador e posto no dir temporário.
- Documentar por fonte, no campo `base_legal`, a norma/decisão que torna o dado público.
