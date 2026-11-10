# 4. Transactional Inbox and Outbox Patterns with SQS FIFO

Date: 2026-11-10  
Status: Accepted  

## Contexto
A publicação direta de eventos em mensageria (AWS SQS) antes ou imediatamente após o commit de uma transação financeira sofre do problema do *Dual Write*:
1. Se o evento é publicado antes do commit e o banco sofre rollback, a rede recebe um evento financeiro fantasma que nunca existiu no banco.
2. Se o evento é publicado após o commit e o processo morre antes da publicação, o evento é perdido para sempre.
3. Se um consumidor processa uma mensagem e o processo morre antes do ACK, a redelivery do broker causa débitos ou créditos duplicados.

## Decisão
Implementar os padrões **Transactional Inbox** e **Transactional Outbox**:
1. **Inbox:** Cada mensagem recebida do SQS é registrada na tabela `inbox_messages` com chave única `(consumer_name, message_id)` na **mesma transação SQL** que processa a aposta. Se a chave já existir, a transação é abortada e o ACK é emitido sem efeitos colaterais.
2. **Outbox:** Eventos como `WalletBalanceChanged` e `WagerTransactionProcessed` são gravados na tabela `outbox_messages` na mesma transação atômica das alterações de saldo.
3. **Outbox Publisher:** Um worker em background consome as mensagens pendentes utilizando `SELECT ... FOR UPDATE SKIP LOCKED` e publica no broker, com backoff exponencial para retries.

## Alternativas Descartadas
* **Publicação direta no controller ou service:** Rejeitado pelo risco de inconsistência em crashes parciais (Dual Write).
* **Confiança exclusiva na deduplicação do SQS FIFO:** Rejeitado porque a janela de deduplicação do SQS FIFO é de apenas 5 minutos (`ContentBasedDeduplication`), enquanto a deduplicação bancária deve ser persistente e determinística.

## Consequências
* **Positivas:** Consistência transacional estrita (at-least-once delivery com deduplicação at-most-once no destino).
* **Mitigação:** Pequena latência assíncrona entre o commit no banco e a publicação efetiva no broker pelo poller da outbox.
