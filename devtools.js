// devtools.js — página do DevTools (`devtools_page` no manifest). Só existe
// pra registrar a sidebar "Editor IA" dentro da aba Elements; nenhuma lógica
// mora aqui, tudo o que fala com a porta/estado vive em sidebar.js (a página
// que `pane.setPage` carrega). Script clássico, sem import — a API
// `chrome.devtools.*` só existe nesta página especial do DevTools.
chrome.devtools.panels.elements.createSidebarPane("Editor IA", (pane) => {
  pane.setPage("sidebar.html");
});
