# EloSys — web (busca de candidatos)

App Next.js, **só leitura**. Não escreve no banco, não roda os crawlers — isso é
trabalho do pipeline Python em [`/elosys`](../README.md). Este app só abre
`../elosys.db` (SQLite, arquivo único) e serve busca + ficha do candidato.

## Rodando

```sh
npm install
npm run dev        # http://localhost:3000
```

Por padrão lê `../elosys.db` (a raiz do repo). Pra apontar outro arquivo:

```sh
ELOSYS_DB_PATH=/caminho/para/outro.db npm run dev
```

Se `elosys.db` não existir ainda, rode o pipeline Python primeiro (ver
[README raiz](../README.md#rodar-com-banco-de-dados)).

## Como está organizado

- `src/lib/db.ts` — abre o `.db` em modo **readonly** (`better-sqlite3`).
- `src/lib/queries.ts` — as consultas do app: `searchPeople` (busca por
  nome/CPF), `getPersonProfile` (candidaturas, CNPJ de campanha, redes
  sociais, sinais de alerta, totais de finança — cada linha com a
  proveniência `parse` → `collection` → `source`), `getTopSuppliers`
  (ranking de empresas por quanto receberam de campanhas, filtro por ano),
  `getEntityProfile` (ficha de um CPF/CNPJ que **não** é candidato: cadastro
  na Receita, quadro societário, totais de doação/pagamento, sanções
  CEIS/CNEP), `getFinancePage` (a lista paginada + com busca de
  doações/despesas — de um candidato ou de uma entidade — que alimenta
  `<FinanceTable>`), `candidatePersonId` (se um CPF/CNPJ é candidato ou CNPJ
  de campanha → o `people.id`, pra `/cpf` e `/cnpj` redirecionarem pra
  `/politico`), `getGraphIdentity` (junta CPF + CNPJ(s) de campanha numa só
  identidade — "juntar os 3"), `resolveGraphNode` (info de UM nó só — já
  canonicaliza CNPJ de campanha pro CPF) e `getGraphPaths` (dado o nó
  recém-adicionado + o que já está no grafo, todo caminho de distância ≤ 2
  entre eles: aresta direta, ou um intermediário em comum que entra como nó
  novo). Só os conectores voltam, nunca a vizinhança inteira; o front limita
  quantos materializa (`MAX_CONNECTORS`).
- `src/app/page.tsx` — home com busca + ranking de fornecedores.
- `src/app/politico/[id]/page.tsx` — ficha do candidato. Doações recebidas e
  despesas são `<FinanceTable>` (`src/components/finance-table.tsx`): tabela
  estilo shadcn — busca por nome, paginação, **cabeçalhos clicáveis pra
  ordenar** (nome/data/ano/valor/pago, asc↔desc), skeleton enquanto carrega,
  data de abertura da empresa contraparte quando temos. Bate em
  `/api/finance` → `getFinancePage`. Inclui também
  `src/components/politician-network.tsx`: usa os **mesmos** `EntityNode` /
  `FloatingEdge` / paleta do `/grafo` (é a fatia de distância 2 daquele
  mesmo grafo), com pan/zoom **limitados** (`translateExtent`) — só entre
  candidatos (`donor_person_id IS NOT NULL`), quem doou à esquerda, pra quem
  ele doou à direita, mais uma camada em cada direção.
- `src/components/skeleton.tsx` — o shimmer shadcn-style. Usado por
  `<FinanceTable>`, `<TopSuppliers>`, `<SearchBox>` e a busca do `/grafo`
  enquanto o fetch não volta.
- `src/app/cnpj/[cnpj]/page.tsx`, `src/app/cpf/[cpf]/page.tsx` — ficha de um
  CPF/CNPJ que **não** é candidato (doador, fornecedor, empresa sancionada):
  `src/components/entity-profile-view.tsx`, também com `<FinanceTable>`. Se
  o CPF é de um candidato, ou o CNPJ é de campanha, a página **redireciona
  pra `/politico/[id]`** — CPF, número de campanha e CNPJ de campanha são
  todos o mesmo candidato ("juntar os 3").
- `src/app/grafo/page.tsx` + `src/components/graph-canvas.tsx` — grafo
  interativo, renderizado com **React Flow** (`@xyflow/react`): pan/zoom,
  arrastar nó, minimapa. **Adicionar um nó só adiciona aquele nó** —
  nenhuma rede de doadores/fornecedores vem junto (um político grande podia
  trazer 600+ nós de uma vez e travar a aba). A cada adição, `getGraphPaths`
  procura **caminhos de distância ≤ 2** entre o nó novo e o que já está na
  tela: aresta direta, ou um intermediário em comum (que entra como nó novo
  com as duas arestas). O grafo cresce O(nós adicionados à mão), nunca
  O(tamanho da rede de um político). O front fica com no máximo
  `MAX_CONNECTORS` intermediários por adição (os que ligam mais nós, depois
  os de maior valor). Clicar num círculo só seleciona (painel de detalhes) —
  não expande mais nada. Arestas são **direcionadas** (seta = sentido do
  dinheiro) e "flutuantes" (`src/components/graph/floating-edge.tsx` —
  sempre aponta pro centro do outro nó, não pra um handle fixo).
  `src/lib/graph-cycles.ts` roda Tarjan (SCC) sobre o grafo atual a cada
  atualização; toda aresta que faz parte de um ciclo (doação circular: A
  paga B, B doa pra A, por exemplo) fica **vermelha e animada** — sem limite
  de tamanho de ciclo, só limitado pelo que já está carregado na tela.
  Layout via `d3-force`, só para nós novos — nós existentes ficam fixos
  (`fx`/`fy`) pra não brigar com o que o usuário arrastou; um viés
  horizontal (`forceX`) mantém **doadores à esquerda** e
  **fornecedores/pra-onde-foi-o-dinheiro à direita** quando a correlação
  encontra uma ligação. Um filtro de "movimentação mín./máx." na barra
  superior esconde arestas fora da faixa (e os nós que ficariam órfãos) sem
  perder o que já foi buscado. Um CNPJ de campanha e o CPF do candidato são
  **o mesmo nó** (`getGraphIdentity` canonicaliza tudo pro CPF) — aparece
  como a bolinha âmbar do político, com o nome dele.
- `src/app/sinais/doacao-circular/page.tsx` — lista os sinais da regra Python
  `elosys/rules/circular_donations.py` (ciclos de doação/despesa achados na
  base inteira, fora do web app — ver README raiz e `ADs/dados_derivados.md`),
  filtrável por severidade e **ordenável por valor movimentado ou tamanho do
  caminho** (`signal.amount_cents`/`signal.path_length`, exatos — não uma
  amostra), com link "ver no grafo" pra cada ciclo (abre
  `/grafo?add=cpf1,cpf2,...` já carregado) e, quando existe, o veredito da IA.
- `src/app/sinais/analise-ia/page.tsx` — lista as revisões de LLM
  (`signal_ai_review`, geradas por `elosys ai-review`): o que o modelo achou
  bizarro vs. plausível, com a explicação e os fatos que ele citou. Filtro
  por veredito e por regra. O veredito também aparece como selo na ficha do
  candidato e na lista de doações circulares.
- `src/components/provenance-tag.tsx` — o selo "fonte: ..." que aparece
  embaixo de cada seção; expande pra URL completa, data de coleta e sha256.
- `src/components/top-suppliers.tsx` — o ranking "empresas que mais faturaram
  com campanhas" (agrupa `campaign_expense` por CNPJ do fornecedor, não por
  nome — o nome varia de grafia entre anos/encoding, o CNPJ não).

## Por que cada campo mostra a fonte

Todo dado no `elosys.db` carrega `provenance_id → parse → collection → source`
(ver [`ADs/confiabilidade.md`](../ADs/confiabilidade.md)). O app só está
expondo esse rastro que já existe no banco — não inventa nada de proveniência
na camada web.

## Nota sobre `better-sqlite3`

Fixado em `^13.0.3` (não `^11` como antes). A `11.x` (e qualquer versão < 13)
usa a API antiga `node::ObjectWrap`; a partir do Node **24.19**, o binding
antigo dá `SIGABRT` no encerramento do processo — `Assertion failed: (env) !=
nullptr` dentro de `node::RemoveEnvironmentCleanupHook`, tipicamente logo
depois da primeira request (o GC finaliza um `Statement` depois que o
Environment do Node já foi destruído). A `13.x` migrou pra N-API e não tem
esse problema. Uma versão antiga da `13.x` teve um prebuild quebrado pra Node
22 no Windows (crash com `STATUS_ACCESS_VIOLATION` só de abrir `:memory:`) —
parece corrigido na `13.0.3`, mas se for mexer nessa dependência de novo,
teste sempre `node -e "new (require('better-sqlite3'))(':memory:')"` **e**
depois `npm run dev` com uso real por um minuto ou dois (o crash do Node 24
só aparece depois de servir pelo menos uma request, não na abertura).
