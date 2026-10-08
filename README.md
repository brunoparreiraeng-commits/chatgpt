# Pilar — Materiais, seção e estabilidade

Aplicação web experimental de pilares retangulares. Permite informar **fck do concreto, fyk do aço e armadura periférica**, calcular uma **curva interativa Mx–My para uma força normal fixa** e estudar separadamente a flambagem elástica de Euler.

O cenário inicial mantém **9 × 30 cm e 6 m livres sem travamento**, com fck = 30 MPa, fyk = 500 MPa e seis barras de 10 mm. Esses dados são exemplos editáveis, não uma solução de projeto. Os esforços começam em zero.

## Baixar e abrir

1. Abra [brunoparreiraeng-commits/chatgpt](https://github.com/brunoparreiraeng-commits/chatgpt).
2. Clique em **Code → Download ZIP** e extraia o arquivo.
3. Entre na pasta extraída e abra **pilar-offline.html** com duplo clique.

O HTML contém os estilos, os motores de cálculo e o gráfico. Não requer Node.js, servidor ou Internet. Para desenvolvimento, instale Node.js 20 ou superior, entre na pasta que contém `package.json` e execute:

```sh
npm start
```

O servidor usa a porta 3000; `PORT` e `HOST` são configuráveis. Não há dependências externas nem necessidade de `npm install`. No ambiente da nuvem, o checkout está em `/workspace/chatgpt`.

## Usar o gráfico

Informe dimensões, materiais, diâmetro das barras, distância face–centro e quantidade de barras em cada face. Clique em **Atualizar análise** depois de mudar as entradas. O multiplicador de ações atua em N, Mx e My antes de calcular a curva e marcar a demanda.

A abscissa do gráfico é **My**, a ordenada é **Mx**, como na imagem de referência. O contorno azul depende de N, dos materiais, da geometria e das barras. A classificação do ponto representa apenas sua posição relativa à curva ideal da seção. Os controles interativos permitem inspecionar valores e ajustar a visualização. JSON e impressão registram os dados e as hipóteses do cenário calculado.

Passe o cursor no gráfico para consultar Mx, My, N e a profundidade da linha neutra. Use a roda do mouse para ampliar e **Restaurar vista** para voltar à escala inicial. Clique ou arraste para alterar os momentos; com o gráfico em foco, use as setas do teclado (Shift aumenta o passo). A curva é recalculada ao confirmar os esforços.

O botão de exemplo carrega uma seção **40 × 40 cm, 12 barras de 20 mm, d′ = 5 cm, fck = 30 MPa e N = 3.000 kN**, com comprimento livre de 8 m e apoios articulados idealizados. A quantidade de aço produz taxa de aproximadamente **2,36%**, como na imagem. As entradas do exemplo são uma demonstração; a correspondência numérica completa com o PCalc não foi validada.

## Materiais e armaduras

- fck: 20 a 50 MPa; fyk: 200 a 600 MPa; Es: 150 a 250 GPa.
- fcd = fck/γc; fyd = fyk/γs. Os coeficientes são editáveis, com valores iniciais γc = 1,4 e γs = 1,15.
- O concreto não resiste à tração. Em compressão, o diagrama é parábola–retângulo, com pico **0,85 fcd**, deformação de patamar **2‰** e deformação extrema em flexão **3,5‰**.
- O aço é elastoplástico, com σs = limite(Es εs, −fyd, fyd), e limite de deformação de tração de **10‰** na família de estados utilizada.
- As barras têm o mesmo diâmetro e distribuição simétrica no perímetro. Com nx e ny barras por face, o total é **2nx + 2ny − 4**; os cantos são contados uma vez.
- **d′ é a distância da face do concreto ao centro da barra**, não o cobrimento nominal. A implementação verifica se as barras cabem na seção e se seus círculos não se sobrepõem. Não verifica cobrimentos ou espaçamentos normativos, estribos ou detalhamento de obra.

## Cálculo do contorno da seção

O motor utiliza compatibilidade de deformações: seções planas permanecem planas, e a deformação varia linearmente na seção. Para cada orientação do plano de deformações, busca a profundidade da linha neutra que equilibra a força normal informada. A integração de concreto por fibras e de aço por barras fornece:

- N = ∫ σ dA;
- Mx = ∫ σ y dA;
- My = ∫ σ x dA.

O concreto deslocado pelas barras é descontado pela tensão calculada no centro de cada barra. A integração por ponto médio usa, na interface, **36 × 36 fibras** e o contorno tem **72 orientações**. Essa discretização introduz erro numérico; o contorno não é uma elipse ajustada.

Na compressão parcial, a deformação do canto comprimido é limitada a 3,5‰ e a da barra mais tracionada a −10‰. Na compressão total, o plano passa por deformação de 2‰ a 3/7 da profundidade projetada, aproximando-se de compressão uniforme a 2‰. Os domínios e verificações completos de uma norma não foram implementados.

A força de compressão uniforme máxima do modelo usa a área líquida de concreto e a tensão de aço correspondente a **2‰**, que pode estar abaixo de fyd. Se N ultrapassar esse limite, não se gera uma curva. Na compressão uniforme máxima, o contorno é tratado como degenerado. Para momentos nulos, o fator radial é indefinido e exportado como `null`.

Compressão é positiva. O PCalc pode apresentar compressão com sinal negativo; não copie o sinal automaticamente. A direção do plano de deformações também não é, em geral, a direção do vetor de momentos.

## Euler e tensões elásticas

Este módulo é independente da curva de concreto armado. Recebe E diretamente, com hipótese inicial de **25 GPa**; não estima E a partir de fck nem a rigidez de uma seção fissurada. Para b = bx e h = by:

- A = b h; Ix = b h³/12; Iy = h b³/12;
- r = √(I/A); Le = K L; λ = Le/r;
- Ncr = π² η E I / Le²;
- σ(x,y) = N/A + Mx y/Ix + My x/Iy, sempre com esforços de primeira ordem;
- amplificação demonstrativa = 1/(1 − N/Ncr), somente se N < Ncr nos dois eixos.

η é a fração de rigidez informada, aplicada apenas a Euler. Não representa automaticamente fissuração ou fluência e não altera a curva de interação ou as tensões na seção bruta. O ponto de momentos ampliados no gráfico é opcional e identificado como hipótese do modelo de Euler. Se qualquer eixo atingir Ncr, ambas as amplificações ficam indefinidas.

## Limites

**O contorno é uma aproximação de seção, não uma verificação completa de um pilar.** Estar dentro dele não demonstra segurança para uma obra, especialmente para seções estreitas e comprimentos livres grandes. Ncr não é carga admissível ou resistência de cálculo de concreto armado.

O coeficiente adicional por dimensão reduzida **γn não é aplicado**, conforme o escopo experimental solicitado. Essa escolha não autoriza dimensões de 9 cm e não indica conformidade normativa.

Não se implementou o método geral de análise não linear do pilar do PCalc, a distribuição de esforços e deslocamentos ao longo de sua altura, combinações normativas, fluência, imperfeições, ligações, estabilidade global, fundações, verificações de serviço ou detalhamento. A tração do concreto é desprezada na seção; não há análise da evolução de fissuras. Para projeto e execução, é necessária análise completa por engenheiro habilitado.

O motor é uma implementação própria. Não reutiliza código compilado do PCalc nem afirma produzir resultados equivalentes ao programa ou atender a uma edição da NBR 6118.

## Desenvolvimento e validação

```sh
npm test
npm run check
npm run build:offline
```

Depois de mudar os fontes, gere novamente `pilar-offline.html`. O construtor inclui os módulos em escopos isolados, valida dependências locais e não modifica os fontes. A versão de desenvolvimento e o HTML offline usam os mesmos motores.

Os testes verificam valores analíticos, equilíbrio axial, leis de material, posições de barras, simetria, rotação de eixos, convergência de malha, limites axiais e entradas inválidas. Esses testes verificam a implementação matemática descrita; não validam um projeto estrutural real.
