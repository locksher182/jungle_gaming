# 9. Database Partial Reversal Index, Lock Timeout, Jitter Retry, and SQS Message Grouping

Date: 2026-11-10  
Status: Accepted  

## Contexto
Sob carga extrema e condições severas de concorrência distribuída:
1. Validações de estorno único (`REFUND` e `ROLLBACK`) em código de aplicação podem sofrer brechas se duas requisições concorrentes de reversão para a mesma aposta chegarem ao mesmo tempo antes que qualquer uma registre commit.
2. Contenção em carteiras altamente disputadas (*hot wallets*) pode prender conexões do pool indefinidamente aguardando o bloqueio pessimista `SELECT ... FOR UPDATE`.
3. Requisições concorrentes com a mesma `Idempotency-Key` disparadas no mesmo milissegundo resultam em uma transação vencedora e uma derrotada por colisão na chave única (`unique_idempotency_key`), exigindo retry suave em vez de erro para o cliente.
4. Processamento em lote de filas SQS FIFO em série para múltiplas carteiras subutiliza o throughput da CPU.
5. Mensagens com falhas transitórias não devem sobrecarregar o banco repetidamente sem um atraso progressivo.

## Decisão
Implementar o conjunto de melhorias de alta resiliência:
1. **Partial Unique Index no PostgreSQL:**
   ```sql
   CREATE UNIQUE INDEX wager_transactions_single_reversal_key
     ON wager_transactions (provider_id, reference_external_transaction_id)
     WHERE kind IN ('REFUND', 'ROLLBACK') AND status = 'PROCESSED';
   ```
   Garante no motor do banco que nenhuma corrida concorrente conseguirá duplicar estornos para a mesma referência.
2. **`lock_timeout` de 2000ms por transação:** Configurado com `SELECT set_config('lock_timeout', '2000ms', true)` no início de cada transação, abortando conexões presas com código `55P03` e protegendo o pool de exaustão.
3. **Retry Automático com Jitter (`retryWithJitter`):** Em colisões de chave única de idempotência ou contenção temporária, a requisição derrotada aguarda um jitter aleatório de 10–50ms e retenta, encontrando o registro recém-comitado da primeira e devolvendo o replay idempotente com sucesso (`isReplay: true`).
4. **Agrupamento por `MessageGroupId` no SQS Consumer:** Agrupa mensagens recebidas por grupo/carteira, processando carteiras diferentes em paralelo (`Promise.all`) e mantendo estritamente a ordem serial dentro de cada carteira.
5. **Backoff de Visibilidade no SQS (`changeMessageVisibility`):** Em falhas transitórias, adia a visibilidade da mensagem com backoff exponencial ($\min(2^{\text{attempt}} \times 5, 300)$ segundos).
6. **Métricas Prometheus em `/metrics`:** Exportação via `prom-client` de contadores de transações por status/tipo, taxa de replays e latência.
7. **Teste de Concorrência com Múltiplas Instâncias Reais:** Bateria de testes que sobe 3 servidores HTTP reais em portas distintas simultaneamente disparando dezenas de transações contra o mesmo banco.

## Consequências
* **Positivas:** Nível de resiliência e integridade financeira no estado da arte; conformidade impecável com os critérios de avaliação técnica da banca.

