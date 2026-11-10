# 2. Immutable Money Value Object with Arbitrary Precision

Date: 2026-11-10  
Status: Accepted  

## Contexto
O JavaScript utiliza IEEE 754 (ponto flutuante de precisão dupla) para o tipo `number`, o que causa erros de arredondamento clássicos em operações financeiras (por exemplo, `0.1 + 0.2 !== 0.3`). Em sistemas de apostas, discrepâncias de frações de centavos geram falhas contábeis eliminatórias e vulnerabilidades de exploração.

## Decisão
Implementar o Value Object `Money` utilizando a biblioteca de precisão arbitrária `decimal.js`.
1. A representação serializada utiliza sempre string decimal com escala fixa de exatamente 2 casas (ex: `"25.00"`).
2. O contrato de entrada rejeita notação científica, `NaN`, `Infinity`, strings vazias e valores negativos.
3. Operações aritméticas (`add`, `subtract`, `negate`) geram novas instâncias imutáveis, garantindo que o objeto original permaneça inalterado.
4. Qualquer tentativa de operar quantias de moedas diferentes (`currency mismatch`) lança imediatamente um `DomainError`.

## Alternativas Descartadas
* **`number` nativo do JavaScript:** Rejeitado terminantemente por imprecisão inerente a pontos flutuantes.
* **Inteiros representando centavos (`cents` em bigint):** Embora evite erros de ponto flutuante, complica a interoperabilidade com contratos externos e não encapsula validações monetárias de moedas ISO de forma tão semântica quanto um Value Object dedicado.

## Consequências
* **Positivas:** Correção financeira absoluta, impossibilidade de criar valores monetários inválidos ou operar moedas distintas acidentalmente.
* **Mitigação:** Requer serialização/desserialização explícita nas bordas do sistema (DTOs de entrada e saída).
