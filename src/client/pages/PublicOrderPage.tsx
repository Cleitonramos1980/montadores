// DESATIVADO — página órfã de consulta pública de pedido por número sequencial.
//
// Motivo: não é roteada em App.tsx e chamava um endpoint inexistente
// (GET /public/pedido/:numped). Consultar pedido por número sequencial, sem token,
// seria um IDOR (qualquer um enumeraria pedidos alheios). O acompanhamento público
// legítimo é feito por CustomerJourneyPage via token de jornada (/montadores/jornada-publica/:token).
//
// Mantido apenas como stub inerte para preservar o import/export sem nenhuma chamada
// de rede nem acesso a dados. Pode ser removido fisicamente com `git rm` quando conveniente.

export function PublicOrderPage(_props: { numped: string }) {
  return null;
}
