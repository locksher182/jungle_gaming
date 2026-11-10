# 5. Concurrency Isolation and Locking Per WalletId

Date: 2026-11-10  
Status: Accepted

## Contexto

Em cenários de apostas com alto volume, múltiplos eventos podem disputar a mesma carteira simultaneamente (cenário de _Hot Wallet_), ou milhares de jogadores podem apostar ao mesmo tempo em carteiras diferentes. O uso de locks globais compartilhados causa gargalos massivos de throughput, enquanto a ausência de locks causa _lost updates_ e saldo negativo.

## Decisão

Adotar o `walletId` como a unidade atômica e exclusiva de isolamento de concorrência:

1. Toda operação de mutação adquire bloqueio pessimista a nível de linha no registro da carteira: `SELECT * FROM wallets WHERE id = $1 FOR UPDATE`.
2. Carteiras distintas prosseguem em paralelo com máxima concorrência e sem contenção.
3. Requisições simultâneas na mesma carteira são enfileiradas e processadas de forma serializada pelo próprio PostgreSQL, garantindo que o saldo seja verificado e deduzido atomicamente.

## Alternativas Descartadas

- **Lock global em nível de aplicação (Mutex / Semaphore in-memory):** Rejeitado porque falha categoricamente quando existem múltiplas instâncias da aplicação ($\ge 3$).
- **Lock na tabela inteira (`LOCK TABLE wallets`):** Rejeitado porque paralisa o processamento de todos os jogadores para alterar uma única carteira.
- **Optimistic Lock exclusivo com version check (`UPDATE ... WHERE version = x`):** Embora útil em leitura massiva, em cenários severos de _Hot Wallet_ gera taxas excessivas de abort/retry em transações financeiras, sobrecarregando a CPU com reprocessamentos. O lock pessimista com `FOR UPDATE` serializa perfeitamente no banco.

## Consequências

- **Positivas:** Prevenção absoluta de _lost updates_, escalabilidade horizontal em múltiplos nós ($\ge 3$ instâncias) e alta vazão entre carteiras diferentes.
- **Mitigação:** Requer que as transações sejam mantidas curtas para não prender a linha da carteira por tempo prolongado.
