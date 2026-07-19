// MÓDULO DESATIVADO — código morto mantido apenas como stub inerte.
//
// A fila offline dependia de um service worker (public/sw.js) que NÃO é registrado
// (ver src/client/main.tsx) e nenhuma parte do client importa este arquivo. Para
// remover o risco latente (cache preso / envio fantasma), as funções foram
// neutralizadas: não há mais postMessage para nenhum SW. Envio de rede é feito
// diretamente pelos chamadores via lib/api.ts.
//
// Mantido como arquivo vazio de lógica porque a remoção física do arquivo não é
// possível neste ambiente; pode ser apagado com segurança (nada o referencia).

export {};
