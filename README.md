# Distributed Wagering Processor (`junglegaming/backend-challenge`)

Motor de processamento distribuído de apostas de alta performance construído com **Bun 1.x**, **TypeScript**, **NestJS**, **PostgreSQL** e **AWS SQS**.

---

## 🚀 Quickstart

### Pré-requisitos
* [Bun 1.x](https://bun.sh)
* [Docker & Docker Compose](https://www.docker.com/) (opcional para rodar PostgreSQL e LocalStack em containers)

### Instalação de Dependências
```bash
bun install
```

### Executar Verificação de Tipos (TypeScript Strict)
```bash
bun run typecheck
```

### Executar a Bateria Completa de Testes
```bash
bun test
```

> **Nota:** Todos os testes unitários, testes de integração de banco (com DDL real, CHECK constraints, UNIQUE constraints e triggers de imutabilidade) e os 8 cenários concorrentes rodam com banco PostgreSQL real embutido (`@electric-sql/pglite` / WASM) e não necessitam de mocks de banco.

---

## 🐳 Subindo Infraestrutura Local (Docker Compose)

Para subir o banco de dados PostgreSQL e o AWS SQS LocalStack:

```bash
docker compose up -d
```

* **PostgreSQL:** `localhost:5432` (banco `jg_db`, usuário `jg_user`, senha `jg_password`)
* **LocalStack (SQS):** `http://localhost:4566`
  * Filas FIFO criadas automaticamente: `wager-transactions.fifo` e `wager-transactions-dlq.fifo`

---

## 📡 Endpoints da API HTTP

### 1. Criar Carteira
`POST /wallets`
```json
{
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "initialBalance": { "amount": "1000.00", "currency": "BRL" }
}
```
* Status: `201 Created`

### 2. Processar Transação de Aposta
`POST /wagering/transactions`  
Header: `Idempotency-Key: provider-a:transaction-123`
```json
{
  "providerId": "provider-a",
  "externalTransactionId": "transaction-123",
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "walletId": "0192f291-27dd-7d3f-8071-5f8685deef37",
  "roundId": "round-987",
  "gameId": "fortune-chimp",
  "kind": "BET",
  "money": { "amount": "25.00", "currency": "BRL" }
}
```
* Retornos Semânticos:
  * `200 OK`: Transação processada ou replay idempotente legítimo.
  * `202 Accepted`: Aceito em `PENDING_REFERENCE` (quando `REFUND` ou `ROLLBACK` chega antes da `BET`).
  * `409 Conflict`: Mesma `Idempotency-Key` reenviada com payload divergente.
  * `422 Unprocessable Entity`: Saldo insuficiente ou regras de negócio violadas.

### 3. Reconciliação Contábil da Carteira
`POST /wallets/:walletId/reconciliation`
* Audita `storedBalance` contra o saldo reconstruído pela soma estrita dos lançamentos do ledger.

### 4. Extrato com Paginação por Cursor
`GET /wallets/:walletId/ledger?cursor=...&limit=50`
* Paginação opaca e determinística baseada em cursor (sem `OFFSET`).

### 5. Health Checks
* `GET /health/live`
* `GET /health/ready`

---

## 🧪 Estrutura de Testes

```
tests/
├── unit/
│   ├── money.spec.ts             # Precisão decimal, 2 casas, moedas ISO, imutabilidade
│   ├── wallet.spec.ts            # Agregado Wallet, factories estáticas, saldo >= 0, versionamento
│   ├── wager-transaction.spec.ts # Máquina de estados, terminais imutáveis, regras REFUND/ROLLBACK
│   ├── ledger-entry.spec.ts      # Imutabilidade estrita e verificação isBalanced()
│   ├── canonical-hash.spec.ts    # Hash canônico ordenado (replay vs conflito 409)
│   ├── inbox-outbox.spec.ts      # Deduplicação no Inbox e retry com backoff no Outbox
│   └── integration-events.spec.ts# Envelopes tipados de eventos de integração
├── integration/
│   └── integration-suite.spec.ts # CHECK (balance >= 0), UNIQUE, trigger de ledger, atomicidade
└── concurrency/
    └── concurrency-scenarios.spec.ts # Os 8 cenários obrigatórios de concorrência e injeção de falhas
```
