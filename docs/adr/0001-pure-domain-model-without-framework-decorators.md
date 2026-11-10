# 1. Pure Domain Model Without Framework or ORM Decorators

Date: 2026-11-10  
Status: Accepted  

## Contexto
O domínio de um processador de transações financeiras e apostas distribuídas exige integridade lógica estrita, encapsulamento de invariantes e separação clara entre regras de negócio e detalhes de infraestrutura (banco de dados, frameworks HTTP, ORMs). Muitas soluções acoplam decorators como `@Entity()`, `@Column()`, ou decorators do NestJS diretamente nas entidades, gerando acoplamento direto com o ciclo de vida do framework e violando o princípio do Domain-Driven Design (DDD) puro.

## Decisão
Manter todas as classes do diretório `src/domain/` puras, sem decorators de ORM ou NestJS.
1. Construtores são `private`.
2. A criação e restauração são feitas exclusivamente por factories estáticas (`create`, `from`, `rehydrate`).
3. Estado interno é protegido por atributos privados e exposto apenas por *getters* imutáveis, eliminando setters públicos.
4. O mapeamento relacional é realizado externamente pela camada de infraestrutura (`src/infrastructure/database/`).

## Alternativas Descartadas
* **TypeORM/MikroORM com decorators inline nas entidades de domínio:** Rejeitado porque introduz acoplamento a bibliotecas externas no core do negócio, prejudica a portabilidade e expõe setters que enfraquecem as invariantes de domínio.
* **Modelo anêmico com interfaces puras + services com lógica procedural:** Rejeitado porque dispersa a lógica de transição de estado e validação aritmética, facilitando a ocorrência de inconsistências.

## Consequências
* **Positivas:** Domínio 100% testável em memória sem mocks, garantia de invariantes invioláveis, separação estrita de responsabilidades (Hexagonal / Clean Architecture).
* **Mitigação:** Exige mapeamento manual ou explícito de DDL/schemas na camada de repositórios SQL.
