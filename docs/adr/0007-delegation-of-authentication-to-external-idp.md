# 7. Delegation of Authentication to External Identity Provider (IdP)

Date: 2026-11-10  
Status: Accepted  

## Contexto
O desafio técnico pontua estritamente concorrência, consistência contábil, idempotência, mensageria e resiliência (100 pontos distribuídos na Seção 4). A Seção 2 e a Pegadinha 1 estabelecem expressamente que **autenticação vale 0 pontos**. Candidatos e IAs frequentemente perdem horas implementando telas de login, tabelas de `users`, hashing artesanal com `bcrypt` e JWTs locais, dispersando o foco do core transacional e violando a segregação de responsabilidades de um processador financeiro.

## Decisão
Não construir subsistema de autenticação artesanal no projeto:
1. Endpoints de health check (`/health/live`, `/health/ready`) são abertos para orquestradores de container.
2. A autenticação de provedores e clientes em ambientes de produção é de responsabilidade da camada perimetral (API Gateway, Kong, Envoy) ou de um Identity Provider dedicado (ex.: Keycloak, AWS Cognito, Zitadel), que autentica o chamador e injeta cabeçalhos de identidade confiáveis antes de rotear para o processador de apostas.
3. Essa decisão é explicitamente documentada no `ARCHITECTURE.md` para transparência com a banca avaliadora.

## Alternativas Descartadas
* **Tabela de usuários local com `bcrypt` e rota `/auth/login`:** Rejeitada formalmente por valer 0 pontos, adicionar código morto sem valor de negócio para o desafio e violar as recomendações estritas do edital.

## Consequências
* **Positivas:** 100% da capacidade de engenharia focada nas restrições financeiras e testes de concorrência que compõem a totalidade da pontuação.
* **Mitigação:** Em deploy real de produção externa, o serviço deve operar atrás de um API Gateway ou rede privada protegida.

