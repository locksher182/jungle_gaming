# Especificação de Testes como Contratos Comportamentais (Testing Contracts)

Este documento atua como a especificação formal e imutável dos contratos comportamentais cobertos pela suite de testes (`bun test`). Qualquer alteração futura de código (feita por humanos ou por IA) deve preservar integralmente estes contratos.

---

## 1. Matriz de Contratos de Domínio (Unitários)

### 1.1 `Money` Value Object

- **Arquivo:** `tests/unit/money.spec.ts`
- **Invariantes:**
  - **Precisão:** Toda quantia possui exatamente 2 casas decimais. Quantias com mais de 2 casas (`"25.001"`) lançam `DomainError`.
  - **Contrato de Entrada:** Rejeita valores negativos em criação inicial, `NaN`, `Infinity`, string vazia e notação científica (`"1e2"`).
  - **Isolamento de Moedas:** Operações aritméticas (`add`, `subtract`) e de comparação (`isLessThan`, `equals`) entre moedas distintas lançam `DomainError`.
  - **Imutabilidade:** Nenhuma operação altera a instância chamadora; uma nova instância de `Money` é retornada.

### 1.2 Agregado `Wallet`

- **Arquivo:** `tests/unit/wallet.spec.ts`
- **Invariantes:**
  - **Versionamento Estrito:** A versão da carteira inicia em `1` e é incrementada **exclusivamente quando o saldo muda** (`debit`, `credit`).
  - **Não-Negatividade:** Débito que excederia o saldo disponível lança `DomainError("INSUFFICIENT_FUNDS")` e preserva o saldo e a versão sem alteração.
  - **Reidratação:** A factory `rehydrate()` restaura o estado sem reexecutar validações de transição de saldo.

### 1.3 `WalletLedgerEntry`

- **Arquivo:** `tests/unit/ledger-entry.spec.ts`
- **Invariantes:**
  - **Balanço Aritmético:** O método `isBalanced()` valida estritamente:
    $$\text{balanceBefore} - \text{money} == \text{balanceAfter} \quad (\text{para } \texttt{DEBIT})$$
    $$\text{balanceBefore} + \text{money} == \text{balanceAfter} \quad (\text{para } \texttt{CREDIT})$$
  - Se a equação falhar, `create()` lança `DomainError`.

### 1.4 `WagerTransaction`

- **Arquivo:** `tests/unit/wager-transaction.spec.ts`
- **Invariantes:**
  - **Estados Terminais:** Uma vez em `PROCESSED`, `REJECTED` ou `FAILED`, nenhuma transição subsequente é permitida (lança `DomainError`).
  - **Referência Obrigatória:** Operações de `REFUND` e `ROLLBACK` exigem obrigatoriamente `referenceExternalTransactionId`.
  - **Replay vs Conflito:** O método `matchesPayload(hash)` valida a igualdade do payload canônico.

### 1.5 Higiene de Contexto & Sanitização de Logs

- **Arquivo:** `tests/unit/logger-sanitizer.spec.ts`
- **Invariantes:**
  - Strings de conexão no formato `postgres://user:password@host` têm as credenciais mascaradas para `postgres://user:***@host`.
  - Qualquer objeto de telemetria contendo chaves como `password`, `secret`, `token`, `authorization`, `apiKey`, `cardNumber` tem os valores substituídos por `***MASKED***`.

---

## 2. Contratos de Banco de Dados e Integração

- **Arquivo:** `tests/integration/integration-suite.spec.ts`

| Contrato                           | Pré-condição                                                          | Ação                                                                  | Pós-condição / Comportamento Esperado                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **DDL 1: Saldo $\ge 0$**           | Tabela `wallets` ativa com constraint `check_wallet_balance_positive` | Tentativa de `INSERT` com saldo $< 0$                                 | Banco rejeita a inserção via violação da constraint `CHECK`.                                                          |
| **DDL 2: Unicidade Carteira**      | Carteira existente para `(playerId, currency)`                        | Tentativa de criar segunda carteira com mesmo `playerId` e `currency` | Banco rejeita via violação da constraint `UNIQUE`.                                                                    |
| **DDL 3: Imutabilidade do Ledger** | Registro existente em `wallet_ledger`                                 | Tentativa de `UPDATE` ou `DELETE` no registro                         | Trigger `trg_prevent_ledger_modification` aborta a operação com erro explícito.                                       |
| **Atomicidade Transacional**       | Carteira com saldo inicial R$ 100                                     | Transação inicia débito e lança erro antes do commit                  | Rollback completo: saldo permanece R$ 100 e nenhum ledger/outbox é salvo.                                             |
| **Reconciliação Contábil**         | Operações registradas na carteira                                     | Execução do caso de uso `ReconcileWalletUseCase`                      | `consistent == true` quando `storedBalance == soma(ledger)`. Se houver adulteração direta, `anomalyDetected == true`. |
| **Conflito de Idempotência**       | Transação salva com chave $K$ e payload $P_1$                         | Nova requisição com mesma chave $K$ e payload $P_2$ divergente        | Lança `DomainError` com código `IDEMPOTENCY_CONFLICT` (HTTP 409).                                                     |

---

## 3. Contratos de Concorrência e Resiliência

- **Arquivo:** `tests/concurrency/concurrency-scenarios.spec.ts`

### Cenário 1: 50 Apostas Idênticas em Paralelo

- **Contrato:** 50 requisições simultâneas com a mesma `Idempotency-Key` e mesmo payload resultam em **exatamente 1 débito**, 1 resposta original e 49 replays idênticos. Nenhuma duplicação no ledger.

### Cenário 2: Hot Wallet (R$ 100 com 2 apostas de R$ 80)

- **Contrato:** Duas apostas concorrentes disputando a mesma carteira. Exatamente uma é aprovada (`PROCESSED`), exatamente uma é rejeitada (`REJECTED` com `INSUFFICIENT_FUNDS`), saldo final R$ 20.00 e apenas 1 lançamento no ledger.

### Cenário 3: Paralelismo entre Carteiras Distintas

- **Contrato:** Múltiplas carteiras distintas processadas em paralelo sem locks globais de tabela e sem deadlocks.

### Cenário 4: Execução com Múltiplas Instâncias ($\ge 3$)

- **Contrato:** Três instâncias simuladas intercalando apostas e vitórias na mesma carteira sem corrupção de estado ou _lost updates_.

### Cenário 5: Injeção de Falha (Crash entre Commit e ACK)

- **Contrato:** Mensagem SQS processada e comitada no banco. O worker é "morto" antes do ACK no SQS. Na redelivery da mensagem, o Transactional Inbox intercepta a mensagem repetida, confirma que já foi processada, comita nada na carteira e emite ACK com segurança.

### Cenário 6: Publishers Concorrentes na Outbox

- **Contrato:** Dois workers publicadores competindo sobre a tabela `outbox_messages` com `SKIP LOCKED` drenam exatamente o total de mensagens enfileiradas sem duplicações de disparo.

### Cenário 7: Mensagens Fora de Ordem (`REFUND` antes da `BET`)

- **Contrato:** `REFUND` recebido antes da `BET` entra em `PENDING_REFERENCE` (HTTP 202). Quando a `BET` é registrada posteriormente, o `PendingReferenceReconciler` reprocessa o refund e efetiva o crédito contábil.

### Cenário 8: Invariante Final

- **Contrato:** Após todas as baterias de operações de teste:
  $$\forall \text{ wallet} \in \text{Database}, \quad \text{wallet.balance} == \sum_{e \in \text{ledger}} \text{direction}(e) \times e.\text{money}$$
