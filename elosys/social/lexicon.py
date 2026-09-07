"""Léxico PT-BR de termos potencialmente pejorativos / discriminatórios.

PARA QUE SERVE
--------------
É um **filtro de recall**, não um classificador. A busca do X (`from:handle
(termo OR termo ...)`) usa este léxico só pra reduzir "todos os tweets da
conta" a "os que MERECEM ser lidos". A decisão sobre se o tweet é de fato
pejorativo — no contexto — é do humano, com a segunda opinião do DeepSeek
(`elosys/rules/social_review.py`). Aqui a régua é deliberadamente FROUXA:
melhor um falso positivo que o DeepSeek descarta do que perder o tweet.

Por isso a lista é grande e inclui:
  - termos que quase sempre são ataque (`weight="alta"`);
  - termos que dependem muito do contexto (`weight="media"`);
  - palavras neutras/idiomáticas/reapropriadas que só ofendem em certos usos
    (`weight="baixa"`) — ex.: "macaco", "nega", "viado" (usado por LGBT),
    "nordestino", "cigano", "japa". Entram porque queremos o recall; a
    coluna `weight` + o campo `note` orientam a triagem e o DeepSeek.

O que NÃO entra: xingamento político genérico ("ladrão", "corrupto",
"vagabundo" sem alvo de grupo, "mentiroso") — é universal na política
brasileira, ruído puro. E palavrão puro sem alvo ("porra", "merda").

Referências de datasets públicos de hate speech PT-BR usados como base:
HateBR, OLID-BR, ToLD-BR, HateBRXplain, além do glossário do "Manual de
Redação para a Diversidade" e de decisões do STF sobre injúria racial e
homotransfobia (ADI 26 / MI 4733).

ESTRUTURA
---------
LEXICON: dict[categoria, list[Termo]]
Termo = (texto, weight, note|None)
  texto  — string de busca. Se tem espaço, o query-builder põe entre aspas
           (match de frase exata no X).
  weight — "alta" | "media" | "baixa"
  note   — por que é ambíguo / o que checar (opcional)

`search_terms(min_weight=...)` devolve a lista achatada.
`build_queries(handle, ...)` monta as queries `from:` respeitando o limite
de ~512 chars do X.
"""

from __future__ import annotations

Termo = tuple[str, str, str | None]

# --------------------------------------------------------------------------
# LGBTfobia / homotransfobia
# --------------------------------------------------------------------------
_LGBTFOBIA: list[Termo] = [
    ("viado", "media", "insulto comum; usado tb por pessoas LGBT de forma reapropriada"),
    ("veado", "media", "grafia alternativa; tb o animal — DeepSeek decide"),
    ("viadinho", "alta", None),
    ("viadão", "alta", None),
    ("viadagem", "alta", None),
    ("bicha", "media", "insulto; reapropriado na comunidade; em PT-PT = fila"),
    ("bicha louca", "alta", None),
    ("bichinha", "media", None),
    ("boiola", "alta", None),
    ("boiolinha", "alta", None),
    ("baitola", "alta", "nordestino p/ homem gay"),
    ("bajitola", "alta", None),
    ("frango", "baixa", "gíria p/ gay passivo; tb comida/futebol"),
    ("maricas", "alta", None),
    ("maricão", "alta", None),
    ("fresco", "baixa", "'homem fresco' = afeminado; tb temperatura/comida"),
    ("frescura", "baixa", "context: 'frescura de viado'"),
    ("fruta", "baixa", "gíria p/ gay; tb comida"),
    ("traveco", "alta", "transfóbico"),
    ("traveca", "alta", None),
    ("tranny", "alta", None),
    ("he-she", "alta", None),
    ("aquilo ali", "baixa", "usado p/ desumanizar pessoa trans ('aquilo', 'isso')"),
    ("sapatão", "media", "lésbica; reapropriado tb"),
    ("sapata", "media", None),
    ("caminhoneira", "media", "lésbica masculinizada (pej.)"),
    ("machorra", "alta", None),
    ("desviado", "media", "'sexualmente desviado'"),
    ("aberração", "media", "context: pessoa LGBT como 'aberração'"),
    ("anormal", "baixa", "context: 'não é normal'"),
    ("doentio", "baixa", None),
    ("promíscuo", "baixa", None),
    ("sodomita", "alta", "religioso-pejorativo"),
    ("pederasta", "alta", "usado como equivalente pejorativo de homossexual"),
    ("homossexualismo", "media", "sufixo -ismo (patologização); termo correto é homossexualidade"),
    ("opção sexual", "media", "dogwhistle: sugere escolha; correto é orientação"),
    ("ideologia de gênero", "media", "dogwhistle anti-LGBT"),
    ("kit gay", "alta", "desinformação (Bolsonaro 2018)"),
    ("mamadeira de piroca", "alta", "hoax de campanha"),
    ("cura gay", "media", None),
    ("heterofobia", "media", "usado p/ minimizar LGBTfobia"),
    ("lgbtismo", "media", None),
    ("generismo", "media", None),
    ("doutrinação de gênero", "media", None),
    ("lacração", "baixa", "'pauta de lacração' — dogwhistle p/ pauta LGBT/racial"),
    ("agenda gay", "media", None),
    ("lobby gay", "media", None),
    ("ditadura gay", "media", None),
    ("família tradicional", "baixa", "dogwhistle quando usado p/ excluir; muito amplo"),
    ("princesinho", "baixa", None),
    ("mulherzinha", "media", "p/ homem, feminilizante-pejorativo"),
    ("homem de verdade", "baixa", "context: cobrança de masculinidade"),
    ("não é homem", "media", None),
    ("virou mulher", "baixa", None),
]

# --------------------------------------------------------------------------
# Racismo — pessoas negras
# --------------------------------------------------------------------------
_RACISMO_NEGROS: list[Termo] = [
    ("macaco", "media", "injúria racial clássica; tb o animal / 'macaco de auditório'"),
    ("macaca", "media", None),
    ("macaquice", "alta", None),
    ("macacada", "alta", None),
    ("volta pra senzala", "alta", None),
    ("senzala", "media", None),
    ("crioulo", "alta", "injúria racial"),
    ("criolo", "alta", None),
    ("neguinho", "baixa", "muito usado como 'fulano/qualquer um'; racista em certos usos"),
    ("nega maluca", "media", None),
    ("preto safado", "alta", None),
    ("preto fedido", "alta", None),
    ("preto imundo", "alta", None),
    ("serviço de preto", "alta", "expressão racista"),
    ("coisa de preto", "alta", None),
    ("programa de índio", "media", "racismo anti-indígena, mas classificado aqui por uso comum"),
    ("a coisa tá preta", "baixa", "expressão idiomática de origem racista; muito ampla"),
    ("cabelo ruim", "media", None),
    ("cabelo de bombril", "alta", None),
    ("cabelo de picumã", "alta", None),
    ("pixaim", "baixa", "termo p/ cabelo crespo; pej. em certos usos, reapropriado em outros"),
    ("nariz de tomada", "alta", None),
    ("beiçola", "alta", None),
    ("beiçudo", "alta", None),
    ("tição", "alta", None),
    ("carvãozinho", "alta", None),
    ("urubu", "baixa", "usado p/ ofender pessoa negra; tb o animal"),
    ("raça inferior", "alta", None),
    ("sub-raça", "alta", None),
    ("subraça", "alta", None),
    ("raça maldita", "alta", None),
    ("mulata", "baixa", "termo controverso; 'mulata tipo exportação' é pej."),
    ("mulata tipo exportação", "alta", None),
    ("denegrir", "baixa", "etimologia debatida; muito amplo"),
    ("escurinho", "baixa", "diminutivo condescendente"),
    ("da cor do pecado", "media", None),
    ("café com leite", "baixa", None),
    ("cota é esmola", "media", "discurso anti-cotas"),
    ("racismo reverso", "media", "conceito usado p/ minimizar racismo"),
    ("racismo às avessas", "media", None),
    ("vitimismo", "baixa", "usado p/ deslegitimar denúncia de racismo; muito amplo"),
    ("mimimi", "baixa", "idem; amplíssimo"),
    ("playing the race card", "media", None),
    ("não sou racista mas", "media", None),
    ("lugar de preto", "alta", None),
    ("quando eu era racista", "media", None),
    ("branqueamento", "baixa", "context histórico"),
    ("escravos tinham comida e teto", "alta", "revisionismo escravista"),
    ("escravidão não foi tão ruim", "alta", None),
    ("deviam agradecer", "media", "context: 'negros deviam agradecer a escravidão'"),
]

# --------------------------------------------------------------------------
# Racismo — povos indígenas
# --------------------------------------------------------------------------
_RACISMO_INDIGENAS: list[Termo] = [
    ("índio preguiçoso", "alta", None),
    ("muita terra pra pouco índio", "alta", None),
    ("índio não é gente", "alta", None),
    ("bugre", "alta", "termo racista p/ indígena"),
    ("bugres", "alta", None),
    ("silvícola", "media", "termo do antigo Estatuto do Índio, hoje pej."),
    ("pele-vermelha", "media", None),
    ("índio de verdade", "media", "denialismo: 'não é índio de verdade porque usa celular'"),
    ("índio de shopping", "alta", None),
    ("índio aculturado", "media", None),
    ("farsa indígena", "alta", None),
    ("índio de mentira", "alta", None),
    ("demarcação é bandidagem", "media", None),
    ("cheiro de índio", "alta", None),
    ("selvagem", "baixa", "context: povos indígenas como 'selvagens'"),
    ("primitivo", "baixa", None),
    ("tribo atrasada", "media", None),
    ("pardo fake", "media", "acusação genérica de fraude racial em cotas"),
    ("autodeclaração fraudulenta", "baixa", None),
]

# --------------------------------------------------------------------------
# Racismo — pessoas asiáticas
# --------------------------------------------------------------------------
_RACISMO_ASIATICOS: list[Termo] = [
    ("japa", "baixa", "muito usado sem intenção pej.; ofensivo em certos usos"),
    ("olho puxado", "media", None),
    ("olho de china", "alta", None),
    ("come cachorro", "alta", "estereótipo racista anti-asiático"),
    ("come morcego", "alta", "estereótipo pós-covid"),
    ("trouxe o vírus", "media", None),
    ("vírus chinês", "media", None),
    ("gripezinha chinesa", "media", None),
    ("xing ling", "baixa", "produto de má qualidade; usado tb contra pessoas"),
    ("xing-ling", "baixa", None),
    ("pastelzinho", "media", "context: contra descendente de asiático"),
    ("amarelo", "baixa", "context racial"),
    ("chinês safado", "alta", None),
    ("praga amarela", "alta", None),
    ("perigo amarelo", "alta", None),
]

# --------------------------------------------------------------------------
# Racismo / xenofobia — ciganos (povo Rom / Calon)
# --------------------------------------------------------------------------
_CIGANOS: list[Termo] = [
    ("cigano ladrão", "alta", None),
    ("cigano do dinheiro", "alta", None),
    ("trapaça de cigano", "alta", None),
    ("roubar que nem cigano", "alta", None),
    ("não seja cigano", "media", None),
    ("coisa de cigano", "media", None),
    ("cigano safado", "alta", None),
    ("acampamento cigano", "baixa", "context"),
]

# --------------------------------------------------------------------------
# Antissemitismo
# --------------------------------------------------------------------------
_ANTISSEMITISMO: list[Termo] = [
    ("judeu safado", "alta", None),
    ("judeu sovina", "alta", None),
    ("mão de vaca que nem judeu", "alta", None),
    ("economizar que nem judeu", "alta", None),
    ("nariz de judeu", "alta", None),
    ("judiaria", "baixa", "etimologia; muito amplo"),
    ("lobby judeu", "media", None),
    ("lobby sionista", "media", None),
    ("poder judaico", "media", None),
    ("banqueiros globalistas", "media", "dogwhistle antissemita"),
    ("globalismo", "baixa", "dogwhistle quando ligado a 'elite judaica'; amplo"),
    ("elite globalista", "media", None),
    ("nova ordem mundial", "baixa", "conspiração; amplo"),
    ("rothschild", "media", "conspiração antissemita"),
    ("soros comprou", "media", None),
    ("dinheiro do Soros", "media", None),
    ("povo escolhido", "baixa", "usado com ironia antissemita"),
    ("câmara de gás", "alta", "trivialização do Holocausto"),
    ("forno crematório", "alta", None),
    ("hitler tinha razão", "alta", None),
    ("hitler estava certo", "alta", None),
    ("faltou gás", "alta", None),
    ("holocausto foi mentira", "alta", "negacionismo"),
    ("holocausto não existiu", "alta", None),
    ("6 milhões é mentira", "alta", None),
    ("mito do holocausto", "alta", None),
    ("sinagoga de satanás", "alta", None),
]

# --------------------------------------------------------------------------
# Intolerância religiosa (foco: religiões de matriz africana, islamofobia,
# ataques a católicos/evangélicos)
# --------------------------------------------------------------------------
_RELIGIAO: list[Termo] = [
    ("macumbeiro", "media", "pej. contra religiões afro; reapropriado tb"),
    ("macumba", "baixa", "termo genérico, pej. em muitos usos"),
    ("trabalho de macumba", "media", None),
    ("chute na macumba", "alta", "referência a agressão real a terreiros"),
    ("adorador do diabo", "alta", None),
    ("culto ao demônio", "alta", None),
    ("coisa do capeta", "baixa", None),
    ("encosto", "baixa", "context religioso pej."),
    ("pai de santo charlatão", "alta", None),
    ("terreiro de macumba", "media", None),
    ("religião de preto", "alta", None),
    ("feitiçaria", "baixa", None),
    ("bruxaria", "baixa", None),
    ("seita", "baixa", "context: 'seita' p/ religião minoritária"),
    ("muçulmano terrorista", "alta", None),
    ("islâmico terrorista", "alta", None),
    ("bomba no colete", "media", None),
    ("vai explodir", "baixa", "context islamofóbico"),
    ("jihadista", "baixa", "context"),
    ("religião do ódio", "media", "context: sobre o Islã"),
    ("crente burro", "alta", None),
    ("evangélico burro", "alta", None),
    ("evangélico fanático", "media", None),
    ("bíblia embaixo do braço", "baixa", None),
    ("carola", "media", None),
    ("beato", "baixa", None),
    ("papa-hóstia", "alta", None),
    ("comedor de hóstia", "alta", None),
    ("fanático religioso", "baixa", "muito amplo"),
    ("talibã evangélico", "media", None),
    ("bancada da bíblia", "baixa", "termo jornalístico neutro; pej. em certos usos"),
]

# --------------------------------------------------------------------------
# Misoginia / machismo
# --------------------------------------------------------------------------
_MISOGINIA: list[Termo] = [
    ("vagabunda", "media", "insulto de gênero quando dirigido a mulher"),
    ("vagaba", "media", None),
    ("piranha", "media", "tb o peixe — DeepSeek decide"),
    ("piriguete", "media", None),
    ("vaca", "baixa", "insulto; tb o animal / gordofobia"),
    ("cadela", "media", None),
    ("biscate", "alta", None),
    ("rapariga", "media", "no NE = prostituta (pej.)"),
    ("quenga", "alta", None),
    ("quengona", "alta", None),
    ("puta", "baixa", "palavrão comum; misógino quando dirigido a mulher"),
    ("putinha", "media", None),
    ("mulher da vida", "media", None),
    ("roda bolsa", "alta", None),
    ("galinha", "baixa", "context; tb o animal"),
    ("lugar de mulher é na cozinha", "alta", None),
    ("volta pro fogão", "alta", None),
    ("vai lavar louça", "alta", None),
    ("vai passar pano", "media", None),
    ("saiu da cozinha", "alta", None),
    ("mal comida", "alta", None),
    ("precisa de macho", "alta", None),
    ("precisando de rola", "alta", None),
    ("tá de TPM", "media", None),
    ("histérica", "media", "context de deslegitimar mulher"),
    ("descontrolada", "baixa", None),
    ("surtada", "baixa", None),
    ("louca", "baixa", "context: chamar mulher de louca p/ deslegitimar; amplo"),
    ("sexo frágil", "media", None),
    ("mulher no volante", "media", None),
    ("feminazi", "alta", None),
    ("feminismo é câncer", "alta", None),
    ("feminismo é lixo", "alta", None),
    ("ideologia feminista", "media", None),
    ("vitimismo feminino", "media", None),
    ("mimizenta", "baixa", None),
    ("presidenta", "baixa", "usado como chacota gramatical de gênero"),
    ("ficou feia", "baixa", None),
    ("baranga", "media", None),
    ("bagulho", "baixa", "context: aparência de mulher"),
    ("canhão", "media", "pej. p/ aparência de mulher"),
    ("dromedária", "media", None),
    ("não merece ser estuprada", "alta", "padrão de fala real (Bolsonaro/Maria do Rosário)"),
    ("nem se pagasse", "media", None),
    ("fraquejei", "media", "'fraquejei e veio mulher' — citação real"),
    ("cota de gênero", "baixa", "discurso contra; amplo"),
    ("solteirona", "media", None),
    ("encalhada", "media", None),
    ("ficou pra titia", "media", None),
    ("mãe solteira", "baixa", "context de julgamento moral"),
    ("periquita", "baixa", "gíria genital; context"),
    ("aborteira", "alta", None),
    ("assassina de bebês", "media", "context: sobre mulheres / aborto"),
]

# --------------------------------------------------------------------------
# Capacitismo (deficiência física, intelectual, transtornos mentais)
# --------------------------------------------------------------------------
_CAPACITISMO: list[Termo] = [
    ("retardado", "alta", None),
    ("retardada", "alta", None),
    ("retardo mental", "alta", None),
    ("mongoloide", "alta", None),
    ("mongolóide", "alta", None),
    ("mongol", "media", "tb gentílico da Mongólia"),
    ("síndrome de down", "baixa", "ofensivo só quando usado como xingamento"),
    ("downzinho", "alta", None),
    ("tem down", "media", None),
    ("débil mental", "alta", None),
    ("débil", "media", None),
    ("tantã", "media", None),
    ("lelé da cuca", "media", None),
    ("avariado", "baixa", None),
    ("com defeito de fábrica", "media", None),
    ("aleijado", "media", "pej.; tb uso descritivo antigo"),
    ("aleijada", "media", None),
    ("manco", "baixa", "tb verbo"),
    ("coxo", "baixa", None),
    ("perneta", "media", None),
    ("maneta", "media", None),
    ("zarolho", "media", None),
    ("caolho", "media", None),
    ("cego que não enxerga", "baixa", "context: metáfora ofensiva"),
    ("surdo que não escuta", "baixa", None),
    ("fala com a parede", "baixa", None),
    ("mudo", "baixa", "context"),
    ("gagueja", "baixa", "context de zombaria"),
    ("autista", "baixa", "usado como xingamento; muito comum online"),
    ("tá no espectro", "media", "zombaria"),
    ("toma remédio tarja preta", "media", None),
    ("tomou lítio", "media", None),
    ("precisa se internar", "baixa", None),
    ("hospício", "baixa", "context: 'devia estar no hospício'"),
    ("manicômio", "baixa", None),
    ("camisa de força", "baixa", None),
    ("doente mental", "media", "usado como insulto"),
    ("psicopata", "baixa", "clínico; usado como insulto"),
    ("esquizofrênico", "baixa", "usado como insulto"),
    ("bipolar", "baixa", "usado como insulto ('governo bipolar')"),
    ("surto psicótico", "baixa", None),
    ("anão", "baixa", "pessoa com nanismo; tb uso figurado ('anão moral')"),
    ("anã", "baixa", None),
    ("nanico", "baixa", None),
    ("baixinho complexado", "media", None),
    ("napoleão", "baixa", "'complexo de napoleão'"),
    ("gordo e feio", "baixa", None),
]

# --------------------------------------------------------------------------
# Xenofobia (estrangeiros / imigrantes)
# --------------------------------------------------------------------------
_XENOFOBIA: list[Termo] = [
    ("volta pro seu país", "alta", None),
    ("vai pra Venezuela", "media", "tb crítica política legítima; DeepSeek decide"),
    ("vai pra Cuba", "media", None),
    ("vai pra Coreia do Norte", "media", None),
    ("venezuelano safado", "alta", None),
    ("venezuelano vagabundo", "alta", None),
    ("invasão venezuelana", "media", None),
    ("eles vêm roubar emprego", "media", None),
    ("imigrante traz doença", "alta", None),
    ("fecha a fronteira pra essa gente", "media", None),
    ("boliviano explorado", "baixa", "context"),
    ("bolita", "alta", "pej. p/ boliviano"),
    ("bugre paraguaio", "alta", None),
    ("produto paraguaio", "baixa", "= falsificado; usado tb contra pessoas"),
    ("muambeiro", "baixa", None),
    ("gringo folgado", "media", None),
    ("carcamano", "media", "pej. p/ italiano (arcaico)"),
    ("turco da prestação", "media", None),
    ("polaca", "baixa", "= prostituta (context histórico da imigração)"),
    ("haitiano", "baixa", "context de ataque"),
    ("refugiado é problema", "media", None),
    ("não é bem-vindo aqui", "baixa", None),
    ("raça estrangeira", "alta", None),
]

# --------------------------------------------------------------------------
# Regionalismo (preconceito entre regiões do Brasil)
# --------------------------------------------------------------------------
_REGIONALISMO: list[Termo] = [
    ("paraíba", "baixa", "em SP, pej. p/ nordestino; tb o estado"),
    ("cabeça chata", "alta", None),
    ("cabeça de melão", "alta", None),
    ("nordestino burro", "alta", None),
    ("nordestino preguiçoso", "alta", None),
    ("baiano preguiçoso", "alta", None),
    ("baianada", "alta", "'fazer uma baianada' = trapalhada"),
    ("fazer uma baianada", "alta", None),
    ("culpa do Nordeste", "media", None),
    ("o Nordeste elegeu", "baixa", "context de responsabilização coletiva"),
    ("bolsa esmola do Nordeste", "media", None),
    ("gado do Nordeste", "media", None),
    ("nordeste atrasado", "media", None),
    ("seca da miséria", "baixa", None),
    ("come farinha", "baixa", None),
    ("pau de arara", "media", None),
    ("retirante", "baixa", "context pej."),
    ("flagelado", "baixa", None),
    ("o Sul é meu país", "media", "separatismo"),
    ("república de Curitiba", "baixa", None),
    ("separa o Sul", "media", None),
    ("nordeste não é Brasil", "alta", None),
    ("deviam se separar", "baixa", None),
    ("carioca malandro", "media", None),
    ("paulista arrogante", "media", None),
    ("mineiro come quieto", "baixa", None),
    ("bicho do mato", "baixa", None),
    ("jeca", "baixa", None),
    ("jeca tatu", "baixa", None),
    ("caipira ignorante", "media", None),
    ("roceiro", "baixa", None),
    ("matuto", "baixa", None),
    ("tabaréu", "baixa", None),
    ("pé vermelho", "baixa", None),
    ("pé rapado", "baixa", None),
    ("brega", "baixa", "context: cultura nordestina como 'brega'"),
]

# --------------------------------------------------------------------------
# Aporofobia (ódio/desprezo a pessoas pobres)
# --------------------------------------------------------------------------
_APOROFOBIA: list[Termo] = [
    ("favelado", "media", "pej. quando usado como classe/insulto"),
    ("favelada", "media", None),
    ("gentinha", "alta", None),
    ("gentalha", "alta", None),
    ("ralé", "alta", None),
    ("raia miúda", "alta", None),
    ("escória", "alta", None),
    ("plebe", "media", None),
    ("maloqueiro", "media", None),
    ("pé de chinelo", "media", None),
    ("descamisado", "baixa", None),
    ("bolsa preguiça", "media", None),
    ("bolsa esmola", "media", None),
    ("bolsa vagabundo", "alta", None),
    ("vive às custas do Estado", "baixa", None),
    ("parasita do Estado", "media", None),
    ("não quer trabalhar", "baixa", "context: pobres como preguiçosos; amplo"),
    ("prefere o auxílio", "baixa", None),
    ("pobre não sabe votar", "alta", None),
    ("voto de cabresto", "baixa", "termo analítico; pej. em certos usos"),
    ("curral eleitoral", "baixa", None),
    ("gado", "baixa", "'gado' político; desumanizante mas amplíssimo"),
    ("povão ignorante", "media", None),
    ("burrice do povo", "baixa", None),
    ("pobre de direita é como", "baixa", "context de deboche de classe"),
    ("mendigo", "baixa", "context de insulto"),
    ("morador de rua é vagabundo", "alta", None),
    ("higienização", "baixa", "context: remoção de pop. de rua"),
    ("esses pobres", "baixa", None),
    ("classe C fedida", "alta", None),
    ("aeroporto virou rodoviária", "media", "deboche classista"),
    ("shopping de pobre", "media", None),
]

# --------------------------------------------------------------------------
# Gordofobia
# --------------------------------------------------------------------------
_GORDOFOBIA: list[Termo] = [
    ("baleia", "media", "insulto; tb o animal"),
    ("baleia franca", "alta", None),
    ("hipopótamo", "media", None),
    ("elefanta", "media", None),
    ("foca", "baixa", "context de aparência; tb o animal"),
    ("gorda nojenta", "alta", None),
    ("gordo nojento", "alta", None),
    ("gorda porca", "alta", None),
    ("bola de banha", "alta", None),
    ("banha ambulante", "alta", None),
    ("toucinho", "baixa", None),
    ("rolha de poço", "media", "baixo e gordo"),
    ("parece grávida", "media", None),
    ("buchudo", "baixa", None),
    ("pança de chope", "baixa", None),
    ("barril", "baixa", None),
    ("planeta", "baixa", "context: 'tem gravidade própria'"),
    ("come igual a um porco", "alta", None),
    ("obeso mórbido", "baixa", "clínico; ofensivo como insulto"),
    ("vai estourar", "baixa", None),
]

# --------------------------------------------------------------------------
# Etarismo (idosos) e sorofobia (pessoas com HIV / doenças estigmatizadas)
# --------------------------------------------------------------------------
_ETARISMO_SAUDE: list[Termo] = [
    ("velho caduco", "alta", None),
    ("véio gagá", "alta", None),
    ("caquético", "media", None),
    ("múmia", "baixa", None),
    ("fóssil", "baixa", None),
    ("jurássico", "baixa", None),
    ("dinossauro", "baixa", "context: 'dinossauro da política' — amplo"),
    ("data de validade vencida", "media", None),
    ("já era", "baixa", None),
    ("cheiro de velho", "media", None),
    ("senil", "media", None),
    ("gagá", "media", None),
    ("demente", "baixa", "context de insulto"),
    ("aposenta essa múmia", "alta", None),
    ("vai jogar dominó", "media", None),
    ("peça de museu", "baixa", None),
    ("aidético", "alta", None),
    ("tem aids", "media", "context de ataque"),
    ("cara de tuberculoso", "media", None),
    ("leproso", "media", None),
    ("lázaro", "baixa", None),
    ("pestilento", "media", None),
    ("peste ambulante", "media", None),
]

# --------------------------------------------------------------------------
# Desumanização genérica (metáforas que retiram humanidade — só as fortes)
# --------------------------------------------------------------------------
_DESUMANIZACAO: list[Termo] = [
    ("verme", "media", "'esses vermes'; tb uso brando"),
    ("vermes", "media", None),
    ("raça de víboras", "alta", None),
    ("cobra criada", "baixa", None),
    ("ratazana", "media", None),
    ("rato imundo", "media", None),
    ("barata", "baixa", "context: 'esmagar como barata'"),
    ("esmagar como barata", "alta", None),
    ("praga", "baixa", "amplo"),
    ("peste", "baixa", "amplo"),
    ("parasita", "media", None),
    ("sanguessuga", "media", None),
    ("lixo humano", "alta", None),
    ("lixo da sociedade", "alta", None),
    ("escória da humanidade", "alta", None),
    ("esterco", "media", None),
    ("estrume", "media", None),
    ("câncer da sociedade", "alta", None),
    ("tumor social", "alta", None),
    ("erva daninha", "media", None),
    ("aberração da natureza", "alta", None),
    ("abominação", "media", None),
    ("sub-humano", "alta", None),
    ("subumano", "alta", None),
    ("raça maldita", "alta", None),
    ("não são gente", "alta", None),
    ("não merecem viver", "alta", None),
    ("deviam ser exterminados", "alta", None),
    ("limpeza social", "alta", None),
    ("faxina étnica", "alta", None),
    ("bandido bom é bandido morto", "baixa", "slogan comum; context"),
    ("tinha que morrer", "baixa", "amplo; context"),
    ("merecia morrer", "media", None),
    ("bala na cabeça", "baixa", "context"),
    ("devia tomar um tiro", "media", None),
]

LEXICON: dict[str, list[Termo]] = {
    "lgbtfobia": _LGBTFOBIA,
    "racismo_negros": _RACISMO_NEGROS,
    "racismo_indigenas": _RACISMO_INDIGENAS,
    "racismo_asiaticos": _RACISMO_ASIATICOS,
    "ciganos": _CIGANOS,
    "antissemitismo": _ANTISSEMITISMO,
    "intolerancia_religiosa": _RELIGIAO,
    "misoginia": _MISOGINIA,
    "capacitismo": _CAPACITISMO,
    "xenofobia": _XENOFOBIA,
    "regionalismo": _REGIONALISMO,
    "aporofobia": _APOROFOBIA,
    "gordofobia": _GORDOFOBIA,
    "etarismo_saude": _ETARISMO_SAUDE,
    "desumanizacao": _DESUMANIZACAO,
}

_WEIGHT_RANK = {"baixa": 0, "media": 1, "alta": 2}


def all_terms() -> list[tuple[str, str, str, str | None]]:
    """(categoria, termo, weight, note) achatado, sem duplicatas de termo."""
    seen: set[str] = set()
    out: list[tuple[str, str, str, str | None]] = []
    for cat, termos in LEXICON.items():
        for texto, weight, note in termos:
            key = texto.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append((cat, texto, weight, note))
    return out


def search_terms(min_weight: str = "baixa", categories: list[str] | None = None) -> list[str]:
    """Só os textos de busca, filtrando por peso mínimo e (opcional) categoria."""
    floor = _WEIGHT_RANK[min_weight]
    cats = set(categories) if categories else None
    out: list[str] = []
    for cat, texto, weight, _ in all_terms():
        if cats and cat not in cats:
            continue
        if _WEIGHT_RANK[weight] >= floor:
            out.append(texto)
    return out


def _as_query_token(texto: str) -> str:
    return f'"{texto}"' if " " in texto else texto


def build_queries(
    handle: str,
    *,
    min_weight: str = "baixa",
    categories: list[str] | None = None,
    max_len: int = 480,
    extra: str = "-filter:retweets",
) -> list[str]:
    """Monta as queries `from:<handle> (t OR t OR ...)` respeitando ~512 chars
    do X. Retorna uma lista (a busca é feita em várias partes)."""
    handle = handle.lstrip("@")
    prefix = f"from:{handle} "
    suffix = f" {extra}".rstrip()
    budget = max_len - len(prefix) - len(suffix) - len("()")
    tokens = [_as_query_token(t) for t in search_terms(min_weight, categories)]

    queries: list[str] = []
    cur: list[str] = []
    cur_len = 0
    for tok in tokens:
        add = len(tok) + (4 if cur else 0)  # ' OR '
        if cur and cur_len + add > budget:
            queries.append(f"{prefix}({' OR '.join(cur)}){suffix}")
            cur, cur_len = [], 0
            add = len(tok)
        cur.append(tok)
        cur_len += add
    if cur:
        queries.append(f"{prefix}({' OR '.join(cur)}){suffix}")
    return queries


if __name__ == "__main__":
    terms = all_terms()
    by_cat: dict[str, int] = {}
    by_w: dict[str, int] = {}
    for cat, _, w, _n in terms:
        by_cat[cat] = by_cat.get(cat, 0) + 1
        by_w[w] = by_w.get(w, 0) + 1
    print(f"{len(terms)} termos únicos")
    print("por categoria:", dict(sorted(by_cat.items(), key=lambda x: -x[1])))
    print("por peso:", by_w)
    q = build_queries("exemplo_handle")
    print(f"\n{len(q)} queries por conta (min_weight=baixa). Primeira:\n{q[0]}")
