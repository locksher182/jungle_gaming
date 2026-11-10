# 3. Database-Level Invariants and Ledger Immutability

Date: 2026-11-10  
Status: Accepted  

## Contexto
Restrições de negócio aplicadas exclusivamente em código de aplicação são vulneráveis a falhas de concorrência, bugs em novas rotas, queries de manutenção manuais ou acessos diretos ao banco de dados por ferramentas analíticas. As regras do sistema exigem garantia contra saldo negativo, unicidade de carteira e imutabilidade total dos lançamentos do ledger contábil.

## Decisão
Impor as regras mais críticas diretamente no DDL do PostgreSQL:
1. `CHECK (balance >= 0)` na tabela `wallets` para assegurar que nenhuma race condition resulte em saldo negativo.
2. `UNIQUE (player_id, currency)` na tabela `wallets` para impedir a criação acidental de múltiplas carteiras para o mesmo par jogador-moeda.
3. Trigger PostgreSQL `trg_prevent_ledger_modification` na tabela `wallet_ledger` que aborta qualquer comando `UPDATE` ou `DELETE` com uma exceção explícita no nível do motor do banco.

## Alternativas Descartadas
* **Validação apenas em `if (wallet.balance < amount)` na camada de serviço:** Rejeitado porque sob alta concorrência sem bloqueio ou em bugs de transação, o banco aceitaria estado inconsistente.
* **Soft delete com flag `deleted_at` no ledger:** Rejeitado porque o ledger contábil financeiro é append-only por definição regulatória; nenhum lançamento contábil deve ser marcado como excluído ou alterado.

## Consequências
* **Positivas:** Defesa em profundidade; mesmo que o código da aplicação falhe, o banco de dados rejeita anomalias financeiras.
* **Mitigação:** Requer que testes de integração e migrações executem em banco relacional compatível com PostgreSQL e PL/pgSQL.
