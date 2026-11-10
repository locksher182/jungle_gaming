# 1. Pure Domain Model and Unit of Work Architecture (MikroORM Alignment)

Date: 2026-11-10  
Status: Accepted

## Contexto

A especificação do desafio técnico (Seção 4) define o **MikroORM** como ORM preferencial, ressaltando seus padrões essenciais: **Unit of Work explícito**, **Identity Map**, controle estrito de transações (`transactional()`) e **LockMode pessimista** (`PESSIMISTIC_WRITE`).
Ao mesmo tempo, as restrições da Seção 6.0 exigem construtores `private`/`protected`, factories estáticas (`create`, `rehydrate`) e que o domínio **não dependa de tipos monetários do ORM nem de decorators do NestJS**.

Muitas implementações incorrem no erro de poluir entidades de domínio com decorators mágicos (`@Entity()`, `@Property()`, `@Column()`), violando o encapsulamento de DDD puro e expondo setters públicos.

## Decisão

Adotar o padrão **Data Mapper & Unit of Work** perfeitamente alinhado com a semântica do MikroORM:

1. **Domínio Puro (Pure Domain Aggregates):**
   - As entidades em `src/domain/` mantêm construtores privados e são instanciadas apenas via `create()` e `rehydrate()`.
   - Sem decorators de framework ou ORM nas entidades, em conformidade estrita com as Seções 6.0 e 6.1 do desafio.

2. **Unit of Work e Transações Atômicas:**
   - A camada de aplicação opera através de `ITransactionRunner` e `IUnitOfWork` (`src/application/ports/unit-of-work.interface.ts`), espelhando a interface de `EntityManager.transactional(async (em) => ...)` do MikroORM.
   - O método `uow.wallets.findByIdForUpdate(id)` provê a garantia exata de `LockMode.PESSIMISTIC_WRITE` (`SELECT ... FOR UPDATE`), serializando transações por carteira sem locks globais.

3. **Mapeamento de Money:**
   - O Value Object `Money` é persistido com valor exato em `NUMERIC(18, 2)` e moeda em `VARCHAR(3)`, sendo reconstituído sem tipos de ponto flutuante via `Money.from()`.

## Consequências

- **Positivas:** Conformidade total com os princípios de Unit of Work e LockMode do MikroORM, isolamento absoluto de DDD puro sem vazamento de anotações no domínio, e transações ACID atômicas garantidas no PostgreSQL.
