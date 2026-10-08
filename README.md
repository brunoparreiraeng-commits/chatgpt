# Pilar — Laboratório elástico

Primeira versão web para explorar uma seção retangular de pilar, apoios idealizados, esforços e flambagem de Euler. O cenário inicial tem seção **9 × 30 cm e comprimento livre de 6 m nos dois eixos**, conforme solicitado. Os esforços começam em zero: é preciso informar as cargas do cenário. Os apoios articulados iniciais e E = 25 GPa são hipóteses editáveis, não propriedades verificadas da estrutura.

## Executar

### Baixar pelo GitHub

1. Abra [brunoparreiraeng-commits/chatgpt](https://github.com/brunoparreiraeng-commits/chatgpt).
2. Clique em **Code → Download ZIP** e extraia o arquivo baixado.
3. Entre na pasta extraída e abra **pilar-offline.html** com duplo clique.

### Abrir sem instalação

Abra `pilar-offline.html` com duplo clique e escolha seu navegador. Esse arquivo reúne a interface e o motor de cálculo e não precisa de Node.js, servidor ou acesso à Internet. As mesmas hipóteses e limitações do modelo experimental continuam valendo.

Para atualizar o arquivo único depois de modificar os fontes, execute `node scripts/build-offline.mjs`. O arquivo HTML gerado deve acompanhar os demais arquivos na distribuição.

### Executar a versão de desenvolvimento

Requer Node.js 20 ou superior. Não há dependências externas nem instalação de pacotes.

```sh
cd /workspace/chatgpt
npm start
```

O servidor usa a porta 3000; `PORT` e `HOST` podem ser configurados. Abra a aplicação no navegador em uma máquina com acesso ao servidor. Para conferir a implementação:

Se você baixou um ZIP, extraia-o, entre na pasta que contém `package.json` no terminal e execute `npm start` com Node.js instalado. O servidor inicia na porta 3000 da sua máquina. O pacote contém os mesmos arquivos de código e testes usados no ambiente da nuvem.

```sh
npm test
npm run check
```

O cálculo acontece no navegador. A interface permite editar geometria, comprimentos livres, fatores de comprimento efetivo K, módulo elástico, fração de rigidez EI, esforços e fator de carga. É possível exportar os dados/resultados em JSON e imprimir o relatório pelo navegador.

## Modelo e convenções

O eixo x atravessa a seção na direção da dimensão bx; o eixo y, na direção by. Mx é o momento em torno de x; My é o momento em torno de y. Compressão e tensões compressivas são positivas. Os momentos podem ter qualquer sinal. Todas as contas usam SI internamente.

Para b = bx e h = by:

- A = b h;
- Ix = b h³ / 12; Iy = h b³ / 12;
- rx = √(Ix/A); ry = √(Iy/A);
- comprimento efetivo em cada eixo: Le = K L;
- esbeltez em cada eixo: λ = Le/r;
- força crítica elástica ideal: Ncr = π² η E I / Le²;
- tensões elásticas de primeira ordem: σ(x,y) = N/A + Mx y/Ix + My x/Iy;
- amplificação ilustrativa: 1/(1 − N/Ncr), apenas se N estiver abaixo de Ncr **nos dois eixos**.

A fração η modifica a rigidez utilizada em Euler. Não representa automaticamente fissuração ou fluência e não modifica a inércia geométrica utilizada nas tensões de primeira ordem. O fator global de carga multiplica N, Mx e My; não substitui critérios de combinações de ações ou coeficientes normativos. A amplificação é uma relação ilustrativa de um modelo idealizado, não uma análise geral de segunda ordem para vínculos e diagramas quaisquer.

O coeficiente adicional por dimensão reduzida γn não é aplicado. Essa escolha não indica conformidade normativa nem demonstra que uma dimensão inferior à permitida pela norma possa ser adotada. Não há extrapolação de regras normativas para 9 cm.

## Limites dos resultados

**Esta aplicação não dimensiona nem autoriza o uso de pilares em uma obra.** Ncr não é carga admissível ou resistência de cálculo de concreto armado. Não há determinação de resistência última, verificação de armaduras, fissuração, fluência, imperfeições geométricas, vínculos reais, estabilidade global, ligações, fundações ou atendimento à NBR 6118.

A opção de comprimento livre deve corresponder aos travamentos reais. Não se considera um pavimento ou uma ligação como travamento apenas por existir. Os fatores K descrevem condições clássicas idealizadas; sua seleção não comprova o comportamento da ligação.

Uma amplificação indefinida sinaliza que o modelo não fornece equilíbrio estável para a carga informada. Tensões de primeira ordem continuam sendo valores aritméticos de seção e não comprovam que a estrutura suporte a carga.

Antes de qualquer uso em projeto residencial, um engenheiro habilitado precisa estabelecer o modelo físico, verificar todos os estados limites e requisitos aplicáveis e assumir a responsabilidade pelo projeto.

## Origem e validação

A implementação do motor é própria, com as fórmulas acima; não reutiliza código compilado do PCalc. A análise estática do arquivo recebido identificou uma referência à NBR 6118 (2013), mas esta aplicação não afirma seguir essa edição ou qualquer outra.

Os testes verificam valores analíticos, conversões de unidades, os dois eixos de flexão, influência de comprimentos e vínculos, sinais de momentos e comportamento no limite de Euler. Esses testes verificam a implementação matemática descrita e não constituem validação de um projeto estrutural real.

Para evoluir o produto, será necessário definir materiais/armaduras, modelos constitutivos, ações e combinações, critérios particulares rastreáveis e casos de referência para uma análise estrutural completa.
