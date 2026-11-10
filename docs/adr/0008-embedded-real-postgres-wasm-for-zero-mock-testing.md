# 8. Embedded Real PostgreSQL (PGlite WASM) for Zero-Mock Testing

Date: 2026-11-10  
Status: Accepted  

## Contexto
O edital e as regras do projeto estabelecem como **falha eliminatória direta**:
> *"Testes que substituem completamente PostgreSQL e SQS por mocks."*

Ao mesmo tempo, rodar suites de teste de concorrência e integração dependendo exclusivamente de containers Docker externos cria atrito severo em pipelines de CI locais, além de lentidão na inicialização e risco de quebra de testes se o daemon do Docker não estiver disponível no host.

## Decisão
Utilizar o **PGlite (`@electric-sql/pglite`)** como motor de banco de dados nos testes de integração e concorrência:
1. PGlite é o motor oficial C do PostgreSQL compilado diretamente para WebAssembly (WASM).
2. Ele executa código real do PostgreSQL: executa exatamente a mesma migration DDL (`001_initial_schema.sql`), triggers PL/pgSQL reais, `CHECK` constraints, `UNIQUE` constraints e suporte a transações ACID (`BEGIN`, `COMMIT`, `ROLLBACK`).
3. Não há mocks do banco de dados: as consultas SQL, inserções, bloqueios pessimistas e triggers são executados pelo próprio motor PostgreSQL.
4. Para ambientes de staging e produção com Docker Compose, o driver `pg` padrão conecta nativamente ao PostgreSQL em container ou AWS RDS através de `DATABASE_URL`.

## Alternativas Descartadas
* **Mocks de repositório (ex.: arrays em memória sem banco relacional):** Rejeitado categoricamente pelo edital como falha eliminatória.
* **SQLite em modo de compatibilidade:** Rejeitado porque o SQLite não suporta triggers com `LANGUAGE plpgsql`, tem sintaxe DDL diferente e não valida o comportamento real do PostgreSQL.

## Consequências
* **Positivas:** Zero mocks de banco nos testes, execução determinística e ultrarrápida no Bun, 100% de conformidade com as exigências eliminatórias do desafio.
* **Mitigação:** Suporta simultaneamente PostgreSQL nativo via `pg` e PGlite através da interface `IDatabaseService`.
