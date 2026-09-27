# EloSys — kit de design

Dark dashboard no espírito MagicUI/shadcn. Dark-only, bordas sólidas de 1px,
cantos arredondados, Inter + JetBrains Mono só nos números.

## Arquivos

- `tokens.css` — variáveis + camada de componentes. É a única folha de estilo.
- `PROMPT.md` — o briefing completo para colar no Claude Code.
- `exemplo.html` — página de referência renderizando cada componente.

## Uso

```html
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="tokens.css">
```

Nunca escreva um hex na aplicação: tudo sai de `var(--*)`.

## Regras que não são negociáveis

1. **Cor só aparece quando significa algo.** Verde = dinheiro entrando ou
   candidato eleito. Vermelho = alerta, ciclo de doação, não eleito.
   Violeta = marca e ação. Cinza para todo o resto.

2. **Severidade é a barra de 2px à esquerda do card**, nunca o fundo.
   Um painel com 40 sinais `high` de fundo vermelho é ilegível.

3. **Rótulos em caixa normal.** Nada de UPPERCASE com letter-spacing largo —
   é o que faz uma interface parecer vibecodada.

4. **Mono só para número.** CPF, CNPJ, datas, hashes, valores em R$.
   Texto corrido é sempre Inter.

5. **Todo dado tem selo de proveniência** (`.seal`): órgão, arquivo, URL,
   data de coleta, sha256. Colapsado por padrão, abaixo da seção.

6. **"Indício não é prova."** A ressalva vai dentro do card, em caixa
   tracejada (`.signal__note`), nunca em nota de rodapé.

7. **Veredito de IA ao lado da severidade, nunca no lugar dela.**
   Um sinal high com veredito plausível é informação útil.
