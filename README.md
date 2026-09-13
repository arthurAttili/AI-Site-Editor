# aiSiteEditor

Extensão Chrome (Manifest V3) que edita qualquer elemento de qualquer site em linguagem natural, pelo botão direito.

## O que faz

Clique com o botão direito em qualquer elemento de qualquer página, escreva o que você quer mudar (cor, texto, tamanho, o que for) e a extensão traduz o pedido em alterações reais no DOM daquela página, na hora. Tudo fica registrado no Console, é possível desfazer, e as alterações podem virar um preset reaplicável no site.

## Instalação

1. `npm install`
2. Abra `chrome://extensions`
3. Ligue "Modo do desenvolvedor" (canto superior direito)
4. Clique em "Carregar sem compactação" e escolha a pasta deste repositório

Não há build step — é JS puro, carregado direto.

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

1. Clique com o botão direito em qualquer elemento da página e escolha **"Editar com IA"** — o painel flutuante abre com aquele elemento já selecionado.
2. Com o painel aberto, **Shift+clique** em outros elementos da página adiciona ou remove cada um da seleção atual (clicar de novo no mesmo elemento com Shift o tira da seleção).
3. Escreva o pedido na caixa de texto (ex.: "deixe o botão vermelho e maior") e clique em **Aplicar** (ou Ctrl/Cmd+Enter).
4. O histórico de pedidos aparece no painel, cada um com um botão **Desfazer**. Os botões **Desfazer tudo** e **Refazer tudo** agem sobre todo o histórico da sessão.
5. Todo pedido gera um grupo recolhido no Console do DevTools, com o prefixo `[Editor IA] Pedido #N — "texto do pedido"`, mostrando as operações pedidas e as alterações de fato aplicadas (ou o aviso, se alguma operação não encontrou o alvo).
6. Na aba **Elements** do DevTools existe uma sub-aba **"Editor IA"**: mostra o elemento atualmente inspecionado, tem um botão **"Usar elemento selecionado"** (usa o `$0` do DevTools como alvo) e espelha o mesmo histórico de pedidos da página, com os mesmos botões de desfazer.

## Presets e o aviso de site modificado

No painel (botão **"Salvar preset deste site"**) ou na sidebar do DevTools (botão **"Salvar preset"**) você pode salvar o conjunto de alterações atuais como um preset daquele site (por origem — `https://exemplo.com`, por exemplo). Um preset salvo **não é aplicado sozinho**: ele só volta a ser aplicado se você ligar **"Auto-aplicar"** para aquele preset no popup da extensão (clique no ícone da extensão na toolbar).

Quando um preset com auto-aplicar está ativo, a página muda assim que carrega, e:

- Um banner (ou pílula, depois de "Minimizar") aparece na tela avisando: "⚠ Você está vendo uma versão MODIFICADA por você deste site — preset '...' (N alterações). Não é o site original."
- O badge da extensão na toolbar mostra **MOD** (vermelho)
- O Console registra um aviso (`console.warn`) de que a página está modificada
- O banner oferece **"Ver original"** (reverte visualmente as alterações e troca o badge para **ORIG**, cinza) e **"Desligar auto-aplicar"** (some as alterações desse preset a partir do próximo carregamento)

Esse aviso **não pode ser desligado** enquanto há alterações ativas — dá para minimizá-lo numa pílula pequena, mas nunca escondê-lo por completo. Isso é proposital: o objetivo é que você nunca confunda uma versão do site modificada por você com o site de verdade.

## Privacidade

O que é enviado ao provedor de IA escolhido, a cada pedido:
- o texto do seu pedido
- uma serialização enxuta do HTML dos elementos selecionados (`outerHTML` com profundidade e tamanho limitados — ver `lib/serialize.js`)
- um resumo curto do histórico de pedidos anteriores da sessão, para dar contexto

Nada mais da página é enviado. As chaves de API ficam apenas em `chrome.storage.local`, no seu computador, e são usadas exclusivamente para chamar o endpoint do provedor escolhido — a extensão não tem servidor próprio nem telemetria.

## Limitações

- **SPAs que re-renderizam** podem perder as alterações aplicadas quando o framework substitui o DOM — nesse caso é preciso reaplicar o pedido (ou o preset).
- **Presets dependem de seletores CSS**, que podem parar de bater se o site mudar sua marcação; quando isso acontece, o Console mostra quantas operações do preset foram de fato aplicadas (ex.: "aplicado: 3/5 operações") e avisa quais seletores não foram encontrados.
- **Páginas onde extensões não podem rodar** (`chrome://`, a Chrome Web Store, o visualizador de PDF do Chrome) mostram "Esta página não pode ser editada" no popup, e o menu de contexto não abre o editor nelas.
- **A sidebar do DevTools** precisa que o content script já esteja carregado na aba — em abas abertas antes de instalar/recarregar a extensão, a primeira ação (menu de contexto ou abrir o popup) injeta o script automaticamente.

## Desenvolvimento

```
npm install
npm test
```

Sem build step: JS puro (ES modules), Node 24, testes com `node --test` e `jsdom`. Para testar mudanças na extensão em si, carregue-a sem compactação (ver Instalação) e recarregue a extensão em `chrome://extensions` a cada alteração de código.

## Checklist manual de QA

- [ ] Carregar a extensão sem compactação em `chrome://extensions`
- [ ] Ir a `https://example.com`, clicar com o botão direito em um elemento e escolher "Editar com IA"
- [ ] Selecionar 2 elementos com Shift+clique e editar os dois em um único pedido
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
- [ ] Abrir o popup numa aba que já estava aberta antes de instalar/recarregar a extensão e conferir que o content script é injetado no primeiro uso

## Licença

MIT — veja o arquivo `LICENSE`.
