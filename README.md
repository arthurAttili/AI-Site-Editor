# aiSiteEditor

Extensão Chrome (Manifest V3) que edita qualquer elemento de qualquer site em linguagem natural, pelo botão direito.

## O que faz

Clique com o botão direito em qualquer elemento de qualquer página, escreva o que você quer mudar (cor, texto, tamanho, o que for) e a extensão traduz o pedido em alterações reais no DOM daquela página, na hora. Tudo fica registrado no Console, é possível desfazer, e as alterações podem virar um preset reaplicável no site.

## Instalação

1. Abra `chrome://extensions`
2. Ligue "Modo do desenvolvedor" (canto superior direito)
3. Clique em "Carregar sem compactação" e escolha a pasta deste repositório

Não há build step — é JS puro, carregado direto. As dependências do `npm` são só para rodar os testes (ver Desenvolvimento).

## Configurar o provedor de IA

Abra as Opções da extensão (ícone da extensão → "Opções", ou pelo botão ⚙ no painel/sidebar) e escolha um provedor:

- **Claude (Anthropic)** — chave em https://console.anthropic.com/settings/keys
- **Gemini (Google)** — chave em https://aistudio.google.com/apikey
- **OpenAI** — chave em https://platform.openai.com/api-keys
- **Compatível com OpenAI** — mesmo formato de API, com atalhos prontos para:
  - OpenRouter — chave em https://openrouter.ai/keys
  - Groq — chave em https://console.groq.com/keys
  - DeepSeek, Mistral, xAI (Grok), Together AI — cada um com sua própria chave, preenchendo URL base e modelo manualmente se não usar um atalho
  - Ollama (local, sem chave) — instale em https://ollama.com
  - LM Studio (local, sem chave) — instale em https://lmstudio.ai

Em cada provedor: cole a chave no campo (o botão "Mostrar"/"Ocultar" alterna a visibilidade), ajuste o modelo se quiser e clique em "Testar conexão". Para OpenAI e para o provedor compatível, "Listar modelos" busca os modelos disponíveis na conta.

Outras opções da página:
- **Idioma das respostas** — idioma em que o modelo deve responder/resumir (padrão `pt-BR`)
- **Posição do aviso** — onde o banner de "site modificado" aparece: Rodapé ou Topo

Clique em "Salvar" para gravar.

## Como usar

1. Clique com o botão direito em qualquer elemento da página e escolha **"Editar com IA"** — o painel flutuante abre com aquele elemento já selecionado e o ponteiro vira uma **mira**, como o inspetor do DevTools (F12): o elemento sob o mouse ganha um contorno laranja com o rótulo `tag#id.classe` e o tamanho. Um **clique** troca a seleção por aquele elemento e desliga a mira; **Shift+clique** adiciona o elemento à seleção e mantém a mira ligada; **Esc** cancela.
2. A mira também liga e desliga pelo botão **⌖** no cabeçalho do painel e pelo botão **"Selecionar elemento"** no popup da extensão (ícone na toolbar) — o popup fecha sozinho para o mouse chegar à página.
3. Com o painel aberto e a mira desligada, **Shift+clique** em outros elementos da página adiciona ou remove cada um da seleção atual (clicar de novo no mesmo elemento com Shift o tira da seleção).
   - O painel pode ser **arrastado pelo cabeçalho** para qualquer canto da tela; a posição escolhida vale até a página ser recarregada.
   - O botão **⧉** do cabeçalho abre o editor em uma **janela separada** do Chrome (útil quando o painel cobre o que você quer editar, ou para trabalhar com dois monitores). A janela mostra a mesma seleção, o mesmo histórico e os mesmos botões; o botão **"Selecionar elemento na página"** liga a mira na aba, e **"Voltar para a página"** fecha a janela e traz o painel de volta. Fechar a janela pelo X encerra a edição, como o × do painel.
4. Escreva o pedido na caixa de texto (ex.: "deixe o botão vermelho e maior") e clique em **Aplicar** (ou Ctrl/Cmd+Enter).
   - O elemento selecionado é a **referência** do pedido, não um limite: a IA recebe também um esboço da estrutura da página (uma linha por elemento, com ids, classes e o texto de cada um, marcando os selecionados) e pode alterar só aquele elemento, os irmãos dele, a seção inteira ou a página toda, conforme o que você pedir. "Deixe este botão vermelho" muda só o botão; "deixe todos os botões como este" ou "todos os títulos da página em azul" mudam todos de uma vez, de preferência com uma única regra de CSS em vez de elemento por elemento.
5. O histórico de pedidos aparece no painel, cada um com um botão **Desfazer**. Os botões **Desfazer tudo** e **Refazer tudo** agem sobre todo o histórico da sessão.
6. Todo pedido gera um grupo recolhido no Console do DevTools, com o prefixo `[Editor IA] Pedido #N — "texto do pedido"`, mostrando as operações pedidas e as alterações de fato aplicadas (ou o aviso, se alguma operação não encontrou o alvo).
7. Na aba **Elements** do DevTools existe uma sub-aba **"Editor IA"**: mostra o elemento atualmente inspecionado, tem um botão **"Usar elemento selecionado"** (usa o `$0` do DevTools como alvo) e espelha o mesmo histórico de pedidos da página, com os mesmos botões de desfazer.
8. Ao final da revisão, clique em **Copiar log** (no rodapé do painel, da janela separada ou da sidebar do DevTools). A extensão copia um relatório em Markdown com tudo o que foi pedido nesta sessão, pronto para colar no Claude Code (ou outra IA) que trabalha no código-fonte/homolog do site. O relatório traz, para cada pedido: o seu texto original, como a IA resolveu, o elemento alvo (seletor estável, caminho de ancestrais e o HTML antes e depois) e cada operação aplicada no DOM, com os valores antigos e novos. Pedidos desfeitos ficam de fora; presets já aplicados na página entram numa seção própria. É o fluxo pensado para reunião com cliente: os ajustes são feitos na hora, ao vivo na página, e depois viram uma única solicitação de código com um copiar e colar.

## Presets e o aviso de site modificado

No painel (botão **"Salvar preset deste site"**) ou na sidebar do DevTools (botão **"Salvar preset"**) você pode salvar o conjunto de alterações atuais como um preset daquele site (por origem — `https://exemplo.com`, por exemplo). Um preset salvo **não é aplicado sozinho**: ele só volta a ser aplicado se você ligar **"Auto-aplicar"** para aquele preset no popup da extensão (clique no ícone da extensão na toolbar).

Quando um preset com auto-aplicar está ativo, a página muda assim que carrega, e:

- Um banner (ou pílula, depois de "Minimizar") aparece na tela avisando: "⚠ Você está vendo uma versão MODIFICADA por você deste site — preset '...' (N alterações). Não é o site original."
- O badge da extensão na toolbar mostra **MOD** (vermelho)
- O Console registra um aviso (`console.warn`) de que a página está modificada
- O banner oferece **"Ver original"** (reverte visualmente as alterações e troca o badge para **ORIG**, cinza) e **"Desligar auto-aplicar"** (some as alterações desse preset a partir do próximo carregamento)

Esse aviso **não pode ser desligado** enquanto há alterações ativas — dá para minimizá-lo numa pílula pequena, mas nunca escondê-lo por completo. Isso é proposital: o objetivo é que você nunca confunda uma versão do site modificada por você com o site de verdade.

Cada preset listado no popup tem também um botão **"Copiar log"**: ele copia o mesmo relatório em Markdown do passo 8 de "Como usar", mas para aquele preset — os pedidos que o geraram, com seletores, HTML antes/depois e as operações — sem precisar reabrir a página nem refazer a sessão. Presets salvos por versões anteriores da extensão não guardaram o histórico dos pedidos; para eles o relatório lista só as operações finais e avisa que os valores anteriores não foram registrados.

## Privacidade

O que é enviado ao provedor de IA escolhido, a cada pedido (montado em `lib/prompt.js` a partir de `lib/serialize.js`):

- **o texto do seu pedido**;
- **a URL e o título da página** — a URL completa, com caminho e query string;
- **para cada elemento selecionado**: o seletor CSS estável, um rótulo curto, a cadeia de até 5 ancestrais (ex.: `body > div.wrap > nav`) e um resumo dos estilos computados (`display`, `position`, `color`, `background-color`, `font-size`, `font-family`, `font-weight`, `padding`, `margin`, `width`, `height`, `border`, `border-radius`);
- **um trecho do HTML de cada elemento selecionado**: o `outerHTML` com os descendentes além do 3º nível colapsados em `…` e corte em 4000 caracteres;
- **o histórico da sessão**: os últimos 10 pedidos desta aba, cada um com o texto do pedido e o resumo do resultado.

Nenhum outro pedaço da página é lido ou transmitido: nada fora dos elementos que você selecionou, nem cookies, nem `localStorage`, nem formulários. Mas atenção ao que **está** dentro do que você seleciona — se o elemento selecionado contiver dados pessoais, eles vão junto no HTML. A URL também vai inteira, então evite editar páginas cuja query string carregue token ou identificador.

As chaves de API ficam apenas em `chrome.storage.local`, no seu computador, e são usadas exclusivamente para chamar o endpoint do provedor escolhido — a extensão não tem servidor próprio nem telemetria.

## Limitações

- **SPAs que re-renderizam** podem perder as alterações aplicadas quando o framework substitui o DOM — nesse caso é preciso reaplicar o pedido (ou o preset).
- **Presets dependem de seletores CSS**, que podem parar de bater se o site mudar sua marcação; quando isso acontece, o Console mostra quantas operações do preset foram de fato aplicadas (ex.: "aplicado: 3/5 operações") e avisa quais seletores não foram encontrados.
- **Páginas fora de `http(s)`** (`chrome://`, `file://`, `chrome-extension://`, a Chrome Web Store) mostram "Esta página não pode ser editada" no popup, e o menu de contexto não abre o editor nelas.
- **Documentos que não são HTML** — PDF no visualizador do Chrome, imagem aberta direto, XML — estão numa URL `http(s)` normal, então o popup **não** mostra "Esta página não pode ser editada": o content script simplesmente não se instala neles e o popup mostra "Extensão não carregada nesta aba".
- **A sidebar do DevTools** precisa que o content script já esteja carregado na aba — em abas abertas antes de instalar/recarregar a extensão, a primeira ação (menu de contexto ou abrir o popup) injeta o script automaticamente.
- **Atalhos de teclado da página** — o painel para a propagação das teclas digitadas na caixa de texto, para que atalhos de uma letra do site (YouTube: "k" pausa o vídeo; GitHub: "s" abre a busca) não engulam o que você escreve. Isso cobre os sites comuns, que registram os atalhos no `document`/`window` na fase de bolha; um site que capture as teclas na fase de captura ainda pode interceptá-las — nesse caso use **"Abrir em janela separada"**, que fica fora da página.
- **Botões do popup** — o popup mostra "Conectando à página…" enquanto pede o estado da aba; se a página não responder, injeta o content script e tenta de novo algumas vezes (cerca de 3 s no total). Se ainda assim falhar, mostra "Extensão não carregada nesta aba" com o motivo e um botão **"Tentar de novo"**. Depois de recarregar a própria extensão em `chrome://extensions`, as abas já abertas precisam de um F5. Repare que **"Ver original"** e **"Desfazer tudo"** ficam propositalmente desabilitados enquanto não há nenhuma alteração ativa na aba; os botões dos presets ("Aplicar agora", "Copiar log", "Remover") funcionam mesmo sem a página responder.

## Desenvolvimento

```
npm install
npm test
```

`npm install` só é necessário aqui: instala `jsdom` e mais nada que a extensão carregue em tempo de execução.

Sem build step: JS puro (ES modules), Node 24, testes com `node --test` e `jsdom`. Para testar mudanças na extensão em si, carregue-a sem compactação (ver Instalação) e recarregue a extensão em `chrome://extensions` a cada alteração de código.

## Checklist manual de QA

- [ ] Carregar a extensão sem compactação em `chrome://extensions`
- [ ] Ir a `https://example.com`, clicar com o botão direito em um elemento e escolher "Editar com IA": o painel abre e o ponteiro vira mira
- [ ] Passar o mouse sobre outros elementos (contorno + rótulo acompanham), clicar em um e conferir que a seleção trocou e a mira desligou
- [ ] Ligar a mira pelo botão ⌖ do painel, juntar um 2º elemento com Shift+clique e editar os dois em um único pedido
- [ ] Ligar a mira pelo botão "Selecionar elemento" do popup e cancelar com Esc
- [ ] Arrastar o painel pelo cabeçalho até a borda da tela (não pode sair da viewport), fechar e reabrir com o botão direito: reabre na posição escolhida
- [ ] Clicar em ⧉ no painel: abre a janela separada com a seleção atual; usar "Selecionar elemento na página", escolher outro elemento e conferir que a janela volta ao foco com o chip atualizado
- [ ] Enviar um pedido pela janela separada e conferir que a alteração aparece na página e no histórico da janela; "Voltar para a página" fecha a janela e reabre o painel flutuante com o mesmo histórico
- [ ] Fechar a janela separada pelo X do sistema: a seleção some da página (mesmo efeito do × do painel)
- [ ] Abrir as Opções no modo escuro do Chrome: só a seção do provedor escolhido aparece e os dropdowns ficam legíveis
- [ ] Desfazer um dos pedidos pelo painel
- [ ] Conferir o grupo do pedido no Console (`[Editor IA] Pedido #N — "..."`)
- [ ] Abrir o DevTools → aba Elements → sidebar "Editor IA", selecionar um nó na árvore, usar "Usar elemento selecionado" e enviar um pedido por ali
- [ ] Salvar um preset a partir do painel ou da sidebar
- [ ] Abrir o popup da extensão e ligar "Auto-aplicar" para esse preset
- [ ] Recarregar a página e conferir: banner aparece, badge da toolbar mostra "MOD", Console mostra o aviso de site modificado
- [ ] Clicar em "Ver original" e conferir que o badge muda para "ORIG"
- [ ] Desligar o auto-aplicar e recarregar a página → site volta ao original
- [ ] Nas Opções: configurar pelo menos um provedor real, clicar em "Testar conexão"
- [ ] Nas Opções: usar "Listar modelos" com um provedor compatível com OpenAI (ou OpenAI)
- [ ] Nas Opções: mudar "Posição do aviso" para Topo e confirmar que o banner muda de posição
- [ ] Sem chave configurada: tentar um pedido e conferir a mensagem amigável pedindo para configurar a chave
- [ ] Com chave errada: tentar um pedido e conferir a mensagem de erro de autenticação
- [ ] Clicar em "Desligar auto-aplicar" pelo banner do indicador sem nunca ter aberto o painel nesta sessão, e conferir que o toast de confirmação aparece mesmo assim
- [ ] Conferir que o histórico de pedidos da sidebar do DevTools espelha corretamente o histórico do painel da página
- [ ] Sem nenhum pedido na sessão, clicar em "Copiar log" no painel: aparece o toast "Nenhum pedido nesta sessão ainda."
- [ ] Depois de dois pedidos (um deles desfeito), clicar em "Copiar log" no painel, colar num editor e conferir: cabeçalho com site/página/data, seção "Contexto para quem for aplicar", só o pedido ativo listado (com "1 desfeito(s), omitido(s)"), seletor, caminho, HTML antes/depois e as operações com valores antigos → novos
- [ ] Clicar em "Copiar log" na janela separada (⧉) e na sidebar do DevTools: o botão vira "Copiado ✓" por um instante e o conteúdo colado é o mesmo do painel
- [ ] Abrir o popup numa aba que já estava aberta antes de instalar/recarregar a extensão e conferir que o content script é injetado no primeiro uso
- [ ] Selecionar um único botão e pedir "deixe todos os botões da página com este mesmo estilo, fundo azul": todos os botões mudam (não só o selecionado) e o Console mostra uma operação `injectCSS` ou um seletor por classe, não uma operação por botão
- [ ] Selecionar o mesmo botão e pedir "deixe este botão vermelho": só ele muda
- [ ] Abrir o popup numa aba `chrome://` ou na loja do Chrome: "Extensão não carregada nesta aba" aparece com o motivo e o botão "Tentar de novo"; numa aba normal recém-recarregada o status passa de "Conectando à página…" para o estado da aba sem precisar clicar em nada
- [ ] Numa aba com a página respondendo, os botões "Ver original" e "Desfazer tudo" só habilitam depois do primeiro pedido aplicado
- [ ] Passar o mouse sobre os botões do painel, do popup, da janela separada, da sidebar e das Opções: cada botão levanta com sombra e o primário fica mais claro; ao clicar ele "afunda"; botões desabilitados não reagem; Tab pelo teclado mostra o anel laranja de foco
- [ ] Logo depois de "Copiar log" ou "Salvar preset" (enquanto o toast ainda está sobre o rodapé), clicar em "Salvar preset deste site": o clique passa pelo toast e o prompt do nome abre
- [ ] Num vídeo do YouTube, abrir o painel e digitar "k", "j", "f" e "m" na caixa de texto: as letras aparecem e o vídeo não pausa nem muda de volume/tela cheia; Esc ainda fecha o painel e Ctrl+Enter ainda envia
- [ ] No popup, clicar em "Copiar log" de um preset salvo nesta versão: o botão vira "Copiado ✓" e o conteúdo colado traz os pedidos que geraram o preset (com HTML antes/depois); num preset salvo por uma versão anterior, o relatório lista só as operações e avisa que o histórico não foi registrado

## Licença

MIT — veja o arquivo `LICENSE`.
