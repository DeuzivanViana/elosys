"""Detection rules (see ADs/dados_derivados.md).

Each rule is its own module: a `run(con) -> dict` entrypoint, a `RULE_NAME` /
`RULE_VERSION`, and its own thresholds as module-level constants recorded
into `rule_run.params`. A rule never touches another rule's signals — it
deletes and regenerates only the rows tagged with its own `rule` name
(rewrite-only, like every crawler).

Nothing here is a conclusion. `signal.severity` is only low/medium/high and
`signal.explanation` must read as a question to check, never an accusation —
see the README's "indício não é prova" section.
"""
