# aiSiteEditor — extensão Chrome de edição de sites com IA

Data: 2026-09-13 · Autor: Arthur Attili (com Claude) · Status: em revisão

## 1. Objetivo

Editar um ou vários elementos de qualquer site em linguagem natural, direto do
botão direito do mouse, para otimizar o dia a dia. As alterações aparecem na
hora, ficam registradas no Console do DevTools, podem ser desfeitas e podem ser
salvas como preset do site. **Nunca pode haver dúvida de que o site exibido foi
modificado pelo próprio usuário.**

Fora de escopo nesta versão: sincronizar presets entre máquinas, publicar na
Chrome Web Store, editar sites que re-renderizam o DOM continuamente (SPAs
agressivas) além de um botão "Reaplicar".

## 2. Decisões já tomadas

| Decisão | Escolha |
|---|---|
| Provedor de IA | Claude, Gemini, OpenAI e qualquer API compatível com OpenAI (OpenRouter, Groq, DeepSeek, Mistral, xAI, Together, Ollama, LM Studio…), selecionável nas opções |
| Onde digitar o pedido | Painel flutuante na página **e** sidebar "Editor IA" na aba Elements |
| Persistência | Presets por site; auto-aplicar no reload é **opcional e desligado por padrão** |
| Aviso de site modificado | Obrigatório e permanente enquanto houver alteração ativa (banner/pílula, badge no ícone, aviso no Console) |
| Pasta / visibilidade | `Publicos\aiSiteEditor`, repositório público com README |
| Stack | Manifest V3, JS puro, sem etapa de build (mesmo padrão do yt-transcriptor); testes com `node:test` + jsdom |

## 3. Fluxos de uso

### 3.1 Editar pelo botão direito
1. Usuário clica com o botão direito em um elemento e escolhe **"Editar com IA"**.
2. O content script já guardou o alvo do último `contextmenu`; destaca o elemento e abre o painel flutuante ao lado.
3. Shift+clique em outros elementos adiciona/remove da seleção (chips no painel). O pedido também pode citar elementos em linguagem natural ("todos os botões desse menu").
4. Usuário digita o pedido e envia. O painel mostra "pensando…", o provedor responde com operações estruturadas, a extensão aplica na hora.
5. Cada pedido vira um item no histórico do painel com botão **Desfazer** e vira um `console.group` no Console do site.
6. Pedidos seguintes na mesma sessão têm o contexto dos anteriores ("agora um pouco maior").

### 3.2 Editar pela aba Elements
1. Com o DevTools aberto, a sidebar **Editor IA** (aba Elements) mostra o elemento selecionado (`$0`) e o mesmo campo de pedido.
2. "Usar elemento selecionado" transfere `$0` para a seleção do content script; o resto do fluxo é idêntico ao 3.1 (a aplicação e o log acontecem sempre no content script).
3. A sidebar espelha o histórico e permite desfazer.

### 3.3 Salvar e reaplicar preset
1. No painel, **"Salvar preset deste site"** pede um nome e grava as operações ativas com seletores estáveis (não os marcadores temporários).
2. Auto-aplicar nasce **desligado**. Toast: "Preset salvo. Ele não será aplicado sozinho; ligue 'auto-aplicar' no popup se quiser."
3. Popup da extensão (por site atual): lista presets, botão **Aplicar agora**, chave **Auto-aplicar**, **Remover**, e **Ver original** quando o site está modificado.
4. Ao carregar um site com preset em auto-aplicar, o content script aplica após `document_idle`, registra no Console com `console.warn` e exibe o aviso de site modificado.

### 3.4 Aviso de site modificado (regra inegociável)
Sempre que houver ao menos uma operação ativa (da sessão ou de preset):
- **Banner** fixo (topo ou rodapé, configurável) em Shadow DOM: "⚠ Você está vendo uma versão MODIFICADA por você deste site — preset 'X' (4 alterações). Não é o site original." Botões: **Ver original** (alterna todas as operações), **Editar**, **Desligar auto-aplicar** (quando veio de preset), **Minimizar**.
- Minimizado vira uma **pílula** fixa no canto ("✎ Modificado por você · 4") que reabre o banner. Não existe estado "oculto".
- **Badge** vermelho "MOD" no ícone da extensão para aquela aba.
- `console.warn` no carregamento e a cada aplicação.
Quando todas as operações são desfeitas ou "Ver original" está ativo, o banner muda para "Você está vendo o site ORIGINAL (4 alterações suas desligadas)" para deixar claro o estado.

## 4. Arquitetura

```
aiSiteEditor/
  manifest.json
  background.js          # service worker (module): menu de contexto, relay, chamadas de IA, badge
  content.js             # script clássico; importa lib/ via chrome.runtime.getURL
  devtools.html/.js      # registra a sidebar na aba Elements
  sidebar.html/.js/.css  # UI da sidebar Editor IA
  popup.html/.js         # gestor de presets do site atual
  options.html/.js       # provedor, chaves, modelos, idioma, posição do banner
  lib/
    ops.js               # validar, aplicar e desfazer operações
    selector.js          # seletor CSS estável para um elemento
    serialize.js         # elemento → contexto enxuto para o prompt
    sanitize.js          # remove <script>, on*= e javascript: de HTML vindo da IA
    prompt.js            # system prompt, mensagem do usuário e JSON Schema das operações
    providers/index.js   # registro de provedores e catálogo de atalhos (URL base + modelo padrão)
    providers/claude.js  # monta a requisição e interpreta a resposta da Anthropic
    providers/gemini.js  # idem para o Gemini
    providers/openai.js  # OpenAI e qualquer endpoint compatível (chat/completions)
    storage.js           # settings e presets em chrome.storage.local
    logger.js            # formatação dos grupos no Console
    ui/panel.js          # painel flutuante (Shadow DOM)
    ui/indicator.js      # banner + pílula de site modificado
  icons/
  test/                  # node:test + jsdom sobre lib/
  package.json           # só devDependencies (jsdom)
  README.md
```

### 4.1 Responsabilidades
- **background.js**: cria o item "Editar com IA" (`contexts: ["all"]`); ao clicar envia `OPEN_EDITOR` para a aba. Recebe `AI_REQUEST` do content script, lê settings, chama o provedor e devolve `{ok, result}` ou `{ok:false, error}`. Faz relay entre sidebar do DevTools (porta `aise-devtools` com `tabId`) e content script. Atualiza badge por aba a partir de `STATE_CHANGED`.
- **content.js**: dono do estado da página (seleção, sessão, operações ativas, presets aplicados). Aplica e desfaz operações, escreve no Console, mostra painel e indicador, lê presets no carregamento.
- **sidebar.js**: UI espelho. Obtém `$0` via `chrome.devtools.inspectedWindow.eval` marcando o elemento com `data-aise-pick`, depois pede ao content script para adotá-lo.
- **providers/**: funções puras `buildRequest(settings, prompt) → {url, headers, body}` e `parseResponse(json) → {summary, ops}` para serem testáveis sem rede. O `fetch` fica em uma função fina no background.

### 4.2 Formato das operações (contrato com a IA)
Objeto plano, todos os campos string e obrigatórios (vazio quando não se aplica), para funcionar igual no JSON Schema estrito da Anthropic e no `responseSchema` do Gemini:

```json
{
  "summary": "Botão principal vermelho e 20% maior",
  "ops": [
    {"op":"setStyle","selector":"[data-aise-id=\"s1\"]","name":"background-color","value":"#c62828","position":""},
    {"op":"setStyle","selector":"[data-aise-id=\"s1\"]","name":"font-size","value":"1.2em","position":""}
  ]
}
```

| op | selector | name | value | position |
|---|---|---|---|---|
| setStyle | alvo | propriedade CSS | valor | — |
| setAttr / removeAttr | alvo | atributo | valor / — | — |
| addClass / removeClass | alvo | — | classe | — |
| setText | alvo | — | texto | — |
| setHTML | alvo | — | HTML (sanitizado) | — |
| insertHTML | referência | — | HTML (sanitizado) | beforebegin/afterbegin/beforeend/afterend |
| remove | alvo | — | — | — |
| injectCSS | — | — | CSS completo | — |

Regras no system prompt: um `setStyle` por propriedade; usar `[data-aise-id]` para os elementos selecionados; `injectCSS` quando a mudança vale para um padrão de elementos; nunca `<script>`; responder no idioma configurado; `summary` em uma frase.

### 4.3 Aplicação e desfazer
`applyOp(op, root=document)` resolve `querySelectorAll(selector)` (ou `[document.head]` para injectCSS), aplica em cada nó e devolve um registro `{op, matched, inverse}`. Inversos: valor anterior do estilo inline/atributo, classe anterior, `innerHTML`/`textContent` anteriores, nó removido com pai e irmão seguinte, nós inseridos, `<style data-aise>` criado. `undo(record)` aplica o inverso. Seletor sem correspondência gera aviso, não erro.

### 4.4 Seletores estáveis
`stableSelector(el)`: `#id` se único → `tag.classe(s)` se único → caminho `tag:nth-of-type(n)` até o primeiro ancestral com id ou até `body`. Ao salvar preset, `[data-aise-id="sN"]` é trocado pelo seletor estável do elemento; seletores livres escritos pela IA ficam como estão.

### 4.5 Contexto enviado à IA
Por elemento selecionado: marcador `sN`, tag, seletor estável, `outerHTML` com filhos além da profundidade 3 colapsados e limite de 4.000 caracteres, subconjunto de estilos computados (display, position, color, background-color, font-size, font-family, font-weight, padding, margin, width, height, border, border-radius) e a cadeia de ancestrais (tag + id/classes) até 5 níveis. Mais: URL, título, os últimos 10 pedidos da sessão com seus `summary`. Nada de cookies, formulários preenchidos ou texto fora dos elementos selecionados e seus ancestrais.

### 4.6 Provedores
Todos implementam a mesma interface pura: `buildRequest(settings, {system, messages, schema}) → {url, headers, body}` e `parseResponse(json) → {summary, ops, model}`. O `fetch` fica no background.

- **Claude**: `POST https://api.anthropic.com/v1/messages`, cabeçalhos `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`, `anthropic-beta: server-side-fallback-2026-07-01`. Corpo: `model` (padrão `claude-opus-5`), `max_tokens: 16000`, `fallbacks: "default"`, `system`, `messages`, `output_config.format = {type:"json_schema", schema}`. Verificar `stop_reason` (`refusal` vira erro legível) antes de ler `content[0].text`.
- **Gemini**: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=…` (padrão `gemini-3.7-flash`, o mesmo do yt-transcriptor), `systemInstruction`, `generationConfig: {responseMimeType:"application/json", responseSchema}`.
- **OpenAI**: `POST https://api.openai.com/v1/chat/completions`, `Authorization: Bearer`, `response_format: {type:"json_schema", json_schema:{name, schema, strict:true}}`. Modelo padrão configurável nas opções (campo livre, sem lista fixa).
- **Compatível com OpenAI**: mesmo módulo do OpenAI com `baseUrl` livre. As opções trazem atalhos que preenchem URL base e modelo sugerido: OpenRouter (`https://openrouter.ai/api/v1`), Groq (`https://api.groq.com/openai/v1`), DeepSeek (`https://api.deepseek.com/v1`), Mistral (`https://api.mistral.ai/v1`), xAI (`https://api.x.ai/v1`), Together (`https://api.together.xyz/v1`), Ollama (`http://localhost:11434/v1`, sem chave), LM Studio (`http://localhost:1234/v1`, sem chave). Se o servidor rejeitar `response_format` com `json_schema`, o módulo tenta de novo com `{type:"json_object"}` e por fim sem `response_format`, sempre validando o JSON localmente.
- O `manifest.json` declara `host_permissions` para os provedores hospedados e `http://localhost/*`; uma URL base fora dessa lista pede permissão em tempo de execução via `chrome.permissions.request` na tela de opções.
- Opções têm botão **Testar conexão** e, quando o provedor expõe `GET /models`, botão **Listar modelos**.

### 4.7 Mensagens (runtime)
| Mensagem | De → Para | Conteúdo |
|---|---|---|
| OPEN_EDITOR | background → content | — |
| PICK_MARKED | sidebar → background → content | adota `[data-aise-pick]` como seleção |
| REQUEST_EDIT | sidebar → background → content | `{text}` |
| AI_REQUEST / resposta | content → background | `{system, messages, schema}` → `{ok, summary, ops, provider, model, ms}` |
| UNDO / REDO_ALL / UNDO_ALL / REAPPLY | popup ou sidebar → content | `{requestId?}` |
| SAVE_PRESET / APPLY_PRESET | popup ou painel → content | `{name}` / `{presetId}` |
| STATE_CHANGED | content → background → sidebar, popup | `{selection, history, activeCount, presetsApplied, originalMode}` |

### 4.8 Armazenamento (`chrome.storage.local`)
```
settings: { provider, language, indicatorPosition,
            providers: { claude:{apiKey,model}, gemini:{apiKey,model}, openai:{apiKey,model},
                         compat:{baseUrl,apiKey,model,presetId} } }
presets:  { [origin]: [ { id, name, ops, autoApply, createdAt, updatedAt } ] }
```
Chaves nunca saem do storage local; o repositório público não contém segredo algum.

## 5. Formato do log no Console
```
▶ [Editor IA] Pedido #3 — "deixe o botão vermelho e maior"
    alvos: s1 = button.btn-primary
    provedor: claude · claude-opus-5 · 2,1 s
    ✔ setStyle button.btn-primary background-color: "" → "#c62828"
    ✔ setStyle button.btn-primary font-size: "" → "1.2em"
    ⚠ selector ".menu a" não encontrou elementos
    resumo: Botão principal vermelho e 20% maior
```
Desfazer, aplicação de preset e erros do provedor também entram como grupos próprios. Ao carregar site com preset: `console.warn("[Editor IA] Este site está MODIFICADO por você: preset 'X' — 4 alterações. Use 'Ver original' no banner.")`.

## 6. Tratamento de erros
- Sem chave configurada → painel abre as opções com aviso.
- HTTP 401/403 → "chave inválida"; 429 → "limite do provedor, tente de novo"; 5xx e rede → "provedor indisponível". Nada é aplicado.
- JSON fora do contrato → tenta extrair o primeiro bloco `{…}`; se falhar, mostra a resposta bruta no painel e no Console.
- `stop_reason: refusal` (Claude) → mensagem clara, sem aplicar.
- Seletor não encontrado no reload → banner mostra "3 de 4 aplicadas" e o Console lista os faltantes.
- Página sem permissão de injeção (chrome://, Web Store) → menu mostra aviso via notificação do background.

## 7. Segurança e privacidade
- HTML vindo da IA passa por `sanitize` (remove `<script>`, atributos `on*`, `javascript:`).
- Painel e banner em Shadow DOM com `z-index` máximo, sem vazar CSS do site.
- README declara o que é enviado ao provedor (trecho de HTML dos elementos selecionados, URL e título).

## 8. Testes
- `npm test` (`node --test`, jsdom): ops (aplicar/desfazer cada tipo, seletor sem match), selector (id único, classes, nth-of-type, estabilidade após remoção de irmão), sanitize, serialize (limites de profundidade e tamanho), prompt (schema válido, contexto de sessão), providers (requisição montada por provedor, parse de resposta, `refusal` no Claude, fallback de `response_format` no compatível, JSON com lixo em volta), storage (troca de marcador por seletor estável ao salvar).
- Checklist manual no README: carregar descompactada, botão direito em example.com, editar 2 elementos com Shift, desfazer, ver Console, sidebar no Elements com `$0`, salvar preset, ligar auto-aplicar, recarregar e conferir banner + badge + warn, "Ver original", desligar auto-aplicar.

## 9. Alternativas descartadas
- **SDK oficial com bundler (esbuild)**: obriga `npm run build` antes de carregar a extensão e foge do padrão das suas extensões; `fetch` direto resolve com dois arquivos pequenos.
- **Executar a edição dentro do DevTools (inspectedWindow.eval)**: perderia o fluxo pelo botão direito sem DevTools aberto e o Console não teria o log no contexto do site.
- **Reaplicar presets sempre**: descartado por você; vira confusão entre site original e modificado.
