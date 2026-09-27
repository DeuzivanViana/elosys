# Redesign do EloSys — dark dashboard estilo MagicUI/shadcn

Aplique um novo sistema visual em toda a aplicação. Dark-only. Nada de
gradientes decorativos, glassmorphism, emoji ou ícones inventados.

O arquivo `tokens.css` deste kit já contém todos os tokens e a camada de
componentes descrita abaixo. Importe-o e use `var(--*)` em tudo — nunca
escreva um hex na aplicação. `exemplo.html` mostra cada componente
renderizado; use como referência de markup.

## Tokens

```
--bg        #09090b   fundo da aplicação
--surface   #0b0b0e   painéis (sidebar)
--card      #131317   cards, linhas de tabela, inputs
--hover     #18181b   hover de item de lista
--active    #1c1c22   item de nav ativo
--border    #27272a   borda padrão (1px, sólida)
--border-2  #3f3f46   borda de ênfase / hover
--fg        #fafafa   texto principal
--fg-2      #d4d4d8   texto de corpo
--muted     #a1a1aa   texto secundário
--muted-2   #71717a   rótulos, metadados
--accent    #8b5cf6   marca, ação primária, coluna ordenada
--accent-2  #a78bfa   links, texto sobre fundo violeta
--green     #22c55e   dinheiro entrando, candidato eleito
--red       #ef4444   alerta, ciclo de doação, não eleito
```

Regra de cor: cor só aparece quando significa algo. Verde = entrada/eleito,
vermelho = alerta/ciclo/não-eleito, violeta = marca e ação. Nunca use fundo
colorido saturado em área grande — no máximo `rgba(139,92,246,0.12)` como
tinta de estado.

## Tipografia

Inter (400/500/600) para tudo. JetBrains Mono **apenas** para números,
CPF/CNPJ, datas, hashes e valores em R$ — com `font-variant-numeric:
tabular-nums`. Rótulos em caixa normal (sentence case), 11–12px, cor
`--muted-2`.

Proibido: UPPERCASE com letter-spacing largo. É o que dá cara de "terminal
vibecodado".

## Forma

Raio 16px no container de página, 12px em cards grandes, 8px em cards
pequenos/inputs/botões, 6px em badges e pills. Bordas sempre 1px sólidas em
`--border` — nunca branco com alpha. Sem sombras, exceto modais
(`0 24px 80px rgba(0,0,0,0.7)`).

## Componentes

1. **Card de sinal** (`.signal`) — fundo `--card`, borda 1px, e uma barra de
   2px na borda esquerda que carrega a severidade (`--red` high, `--accent`
   medium, `--muted-2` low). O card em si permanece neutro: nunca pinte o
   fundo inteiro por severidade, senão um painel com 40 sinais vira uma
   parede vermelha.

2. **Badge** (`.badge`) — texto 11px, borda 1px na cor do estado a 40% de
   alpha, texto na cor cheia, fundo transparente, raio 6px, padding 2px 7px.

3. **Selo de proveniência** (`.seal`) — `<details>` colapsado abaixo de cada
   seção: quadradinho 6px de estado à esquerda (verde = arquivo oficial
   íntegro, violeta = dado derivado/reconciliado, vermelho = fonte
   incompleta), linha mono 12px com órgão · arquivo · data · sha256
   truncado, chevron à direita que rotaciona 90° ao abrir. Aberto: grid de
   duas colunas com órgão, arquivo, URL, timestamp de coleta, sha256
   completo e nº de linhas.

4. **Tabela** (`.table`) — header em `--card` com rótulos 11px; coluna
   ordenada em `--accent` com seta cheia, demais em `--muted` com seta
   dupla; linhas separadas por 1px `--border`; linha que participa de um
   sinal ganha `.is-flagged` (fundo `rgba(239,68,68,0.05)`) e etiqueta mono
   na primeira célula.

5. **KPI** (`.kpis` / `.kpi`) — grid com `gap:1px` sobre fundo `--border` e
   `overflow:hidden` no container arredondado, gerando divisórias de 1px sem
   borda dupla. Rótulo 11px `--muted-2`, número 24–26px em mono.

6. **Sidebar** (`.sidebar` / `.navitem`) — 268px, fundo `--surface`, borda
   direita. Grupos com cabeçalho 11px `--muted-2`. Item: 13px, raio 6px,
   padding 7px 10px; ativo = fundo `--active` + texto `--fg`; hover =
   `--hover`. Contador à direita em mono 11px, vermelho só quando há
   severidade high pendente.

7. **Botões** (`.btn`) — primário: fundo `--accent`, texto `--fg`, raio 8px.
   Secundário: borda `--border`, fundo transparente, hover muda borda para
   `--border-2`. Foco: `outline: 2px solid var(--accent); outline-offset: 2px`.

## Layout

Sidebar fixa + área de conteúdo com topbar sticky (breadcrumb
"Grupo / Página" à esquerda, ações à direita) e `backdrop-filter: blur(8px)`.
Conteúdo com padding 28px e `max-width: 1400px`.

## Favoritos

Botão na topbar que alterna estrela vazia/cheia e salva `{id, label}` da
página atual em `localStorage` sob a chave `elosys.favorites`; a sidebar
renderiza uma seção "Favoritos" no topo (acima de todos os grupos) com cada
item removível por um × na linha. Command palette em ⌘K / Ctrl+K, Esc fecha.

## Princípios do produto que o design precisa carregar

- **"Indício não é prova"** — a ressalva vai *dentro* do card, em caixa
  tracejada (`.signal__note`), nunca em nota de rodapé. O subtítulo de cada
  painel de sinais explica o que a regra detecta e diz na mesma frase que o
  padrão pode ser legal.
- **Todo dado tem selo de proveniência** com órgão, URL, data de coleta e
  sha256, expansível.
- **Veredito de IA** (bizarro / inconclusivo / plausível) fica *ao lado* da
  severidade da regra, nunca no lugar dela. Um sinal high com veredito
  plausível é informação útil: a máquina discorda da regra e o leitor vê as
  duas.

## Tom do texto

Direto e curto. Uma frase por card explicando o achado, não um parágrafo.
Sem adjetivo, sem metadiscurso, sem "isso significa que...".
