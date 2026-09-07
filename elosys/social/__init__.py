"""Coleta e análise de discurso público declarado (redes sociais).

Identidade das contas vem de `social_media` (TSE rede_social_candidato,
declaração obrigatória desde a Res. 23.610/2019) — nunca de adivinhação de
handle. O conteúdo é efêmero (pode ser apagado), então a coleta arquiva o
payload cru + sha256 + retrieved_at: o hash prova que não editamos depois, o
commit no git data "tínhamos isso nesta data". Ver ADs/confiabilidade.md.

Nada aqui é conclusão. Um tweet sinalizado é "vale ler", nunca "é racista".
"""
