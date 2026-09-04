# Elosys — cruzamento de dados públicos de políticos brasileiros

Elosys monta, a partir de **fontes oficiais e públicas**, uma base de dados
consolidada de candidatos e eleitos brasileiros (2018–2026), cruzada por CPF/CNPJ,
para investigar relações entre políticos e levantar **indícios** de padrões
suspeitos (doação circular, fracionamento de doações, empresas de fachada,
enriquecimento incompatível).

> **Indício não é prova.** Nada aqui é acusação. O sistema gera *sinais de alerta*
> para serem checados por quem tem competência para isso (Ministério Público, TCU,
> Receita, COAF). Todo dado exibido aponta para o arquivo público de onde saiu, e
> qualquer pessoa pode re-baixar esse arquivo e conferir (`elosys verify`).

Fase atual: **só backend** — pipeline de coleta + banco SQLite. Sem interface.

Já coletado: **1,10 M candidaturas** (`consulta_cand` 2018–2026, ~876 k pessoas) e
**1,04 M CNPJs de campanha** (prestação de contas). Banco ~900 MB.

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

uv run elosys verify   --db elosys.db     # re-baixa as fontes e confere os hashes
uv run pytest                             # testes (usam fixtures, sem rede)
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
| `companies` | Empresa por CNPJ (hoje só CNPJs de campanha, `kind='campaign'`) | compartilhada |
| `campaign_org` | O CNPJ que cada candidatura abre para a campanha (Receita, natureza 409-4) | `tse-accounts` |
| `rejected_cpf` | CPFs descartados por ambiguidade (mesmo CPF em >1 título eleitoral, etc.) e o motivo | `tse-candidates` |
| `source` / `collection` / `collection_file` / `parse` | Proveniência: de qual órgão, qual URL, qual arquivo, qual hash, qual parser saiu cada linha | todos |

Toda linha de dado tem `provenance_id` → `parse` → `collection` → `source`.
"De onde veio isso?" é um `JOIN`.

## Os arquivos de log e auditoria

Cada execução de crawler escreve/atualiza, ao lado do `.db`:

- **`manifest.json`** — a lista de *todos* os arquivos baixados, com `url`,
  `accessed_at`, `sha256` do `.zip` e `sha256` de cada CSV dentro dele. **É a âncora
  de não repúdio**: você commita esse arquivo no git, e aí o histórico público do
  repositório prova o que foi coletado e quando. `elosys verify` re-baixa cada URL
  e compara os hashes com esse manifesto.
- **`tse_candidates_report.json`, `tse_accounts_report.json`** — o relatório daquela
  execução: linhas lidas por ano, CNPJs/candidaturas gerados, CPFs derrubados por
  ambiguidade (com o motivo), quantas linhas ficaram sem vínculo de identidade.

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
| [`dados_derivados.md`](ADs/dados_derivados.md) | Correlações e flags (doação circular, score) também têm proveniência: qual regra, qual versão, sobre quais linhas. Severidade só `low/medium/high`, nunca "confirmado". |

## Fontes de dados (todas oficiais/públicas)

| Fonte | O que traz | Estado |
|---|---|---|
| TSE — `consulta_cand` | Cadastro de candidaturas | ✅ coletado (2018–2026) |
| TSE — prestação de contas eleitorais | CNPJ de campanha; doações e despesas | ✅ CNPJ de campanha; doações pendentes |
| TSE — `bem_candidato` | Bens declarados no registro (base do sinal de patrimônio) | ⬜ pendente |
| TSE — DivulgaCandContas | Foto oficial por ano, certidões | ⬜ pendente |
| Receita Federal (BrasilAPI) | Quadro societário de CNPJ, data de abertura, capital | ⬜ pendente |
| CNJ — DataJud | Metadados de processos judiciais públicos | ⬜ pendente |
| Portal da Transparência | Contratos, convênios, emendas, sanções (CEIS/CNEP) | ⬜ pendente |
| Câmara / Senado — dados abertos | Mandatos em exercício, votações | ⬜ pendente |

**Não coletamos** (protegido / sigiloso): endereço residencial, telefone e e-mail
pessoal de candidatos; antecedentes fora de processo público; relatórios do COAF.

## Premissa legal e ética

- Todas as fontes são **públicas por determinação legal/judicial**.
- CPF de candidato: mascarado em 2024 (decisão do TSE por LGPD), revertido para 2026.
  A base de 2024 é reconciliada por título eleitoral — ver [`ADs/identidade.md`](ADs/identidade.md).
- O resultado é **indício, não prova**. O sistema gera sinais de alerta, não
  conclusões. Nada aqui deve virar acusação pública sem apuração formal.

## Próximos passos

1. Doações de campanha (`campaign_donation`) — mesmo arquivo do `tse-accounts`,
   volume maior, tabela própria.
2. Parser do layout legado do `consulta_cand` (2014/2016: CSV sem cabeçalho).
3. `bem_candidato` → `declared_assets`.
4. Cliente de CNPJ (BrasilAPI) → quadro societário em `companies` / `company_partners`.
5. Guardar os `.zip` do TSE num store por hash (mitiga perda de valor se a fonte
   republicar um arquivo alterado).
6. Primeira regra de detecção (doação circular) como job isolado, testável com
   dados sintéticos.
