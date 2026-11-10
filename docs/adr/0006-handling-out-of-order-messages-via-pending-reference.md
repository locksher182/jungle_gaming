# 6. Handling Out-of-Order Messages via Pending Reference State

Date: 2026-11-10  
Status: Accepted  

## Contexto
Em sistemas distribuídos assíncronos, mensagens de compensação (`REFUND` ou `ROLLBACK`) podem trafegar por caminhos de rede mais rápidos ou serem redespachadas antes que a mensagem original de aposta (`BET`) seja persistida. Lançar `404 Not Found` nessas situações causa perda irrecuperável da intenção de compensação ou obriga o provedor externo a lidar com retries agressivos.

## Decisão
Introduzir o estado intermediário **`PENDING_REFERENCE`** na máquina de estados da transação:
1. Quando uma requisição de `REFUND` ou `ROLLBACK` referencia uma transação que ainda não existe no sistema, ela é persistida com status `PENDING_REFERENCE` e a resposta HTTP retorna código semântico `202 Accepted`.
2. A carteira não sofre alteração de saldo nesse momento.
3. Quando a transação original (`BET`) é persistida posteriormente, o background reconciler (`PendingReferenceReconciler`) detecta a referência satisfeita, revalida as invariantes (mesmo provedor, jogador, moeda, rodada e valor exato) e efetiva a reversão contábil.
4. Caso a transação original nunca chegue após a janela máxima de retries, a transação é transicionada para `REJECTED` com código `REFERENCE_NOT_FOUND`.

## Alternativas Descartadas
* **Rejeitar imediatamente com `404 Not Found`:** Rejeitado porque quebra o contrato de idempotência e compensação eventual entre provedores e a casa de apostas.
* **Bloquear a requisição HTTP em sleep/polling síncrono:** Rejeitado porque esgota o pool de conexões HTTP e threads do servidor sob alta carga.

## Consequências
* **Positivas:** Tolerância total a desordem em brokers distribuídos, preservação da intenção transacional e conciliação segura sem intervenção manual.
* **Mitigação:** Exige worker de reconciliação em background para drenar mensagens pendentes.

