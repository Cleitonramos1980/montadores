export type FluxoPhaseKey =
  | "AGUARDANDO_MAPA_ESTOQUE"
  | "MAPA_EMITIDO_AGUARDANDO_SEPARACAO"
  | "EM_SEPARACAO_CONFERENCIA"
  | "CONFERIDO_AGUARDANDO_FATURAMENTO"
  | "FATURADO_AGUARDANDO_SAIDA"
  | "FINALIZADO";

export const FLUXO_PHASES: Array<{ key: FluxoPhaseKey; label: string; order: number }> = [
  { key: "AGUARDANDO_MAPA_ESTOQUE",           label: "1 - Aguardando Mapa/Estoque",            order: 1 },
  { key: "MAPA_EMITIDO_AGUARDANDO_SEPARACAO", label: "2 - Mapa Emitido / Aguardando Separação", order: 2 },
  { key: "EM_SEPARACAO_CONFERENCIA",          label: "3 - Em Separação / Conferência",           order: 3 },
  { key: "CONFERIDO_AGUARDANDO_FATURAMENTO",  label: "4 - Conferido / Aguardando Faturamento",  order: 4 },
  { key: "FATURADO_AGUARDANDO_SAIDA",         label: "5 - Faturado / Aguardando Saída",         order: 5 },
  { key: "FINALIZADO",                        label: "6 - Finalizado no Fluxo Operacional",     order: 6 },
];

export const FLUXO_PHASE_ORDER: Record<FluxoPhaseKey, number> = Object.fromEntries(
  FLUXO_PHASES.map((p) => [p.key, p.order]),
) as Record<FluxoPhaseKey, number>;

// Template bodies for the 5 active events (MAPA → FINALIZADO)
export const FLUXO_TEMPLATES: Partial<Record<FluxoPhaseKey, { subject: string; body: string }>> = {
  MAPA_EMITIDO_AGUARDANDO_SEPARACAO: {
    subject: "Pedido em preparação — nº {numero_pedido}",
    body:
      "Olá, {nome_cliente}! Seu pedido nº {numero_pedido} já está em preparação para separação. 📦\n\n" +
      "Vamos te avisar por aqui quando ele avançar para a próxima etapa.\n\n" +
      "Acompanhe seu pedido pelo link oficial:\n{link_pedido}\n\n" +
      "Atenção: a {nome_empresa} não solicita senha, código de segurança ou dados de cartão por WhatsApp. " +
      "Use apenas nossos canais oficiais: {dominio_oficial}",
  },
  EM_SEPARACAO_CONFERENCIA: {
    subject: "Pedido em separação — nº {numero_pedido}",
    body:
      "Olá, {nome_cliente}! Seu pedido nº {numero_pedido} está em separação e conferência. 📦\n\n" +
      "Estamos preparando tudo com cuidado para seguir para o faturamento.\n\n" +
      "Acompanhe os detalhes pelo link oficial:\n{link_pedido}",
  },
  CONFERIDO_AGUARDANDO_FATURAMENTO: {
    subject: "Pedido conferido — nº {numero_pedido}",
    body:
      "Olá, {nome_cliente}! Seu pedido nº {numero_pedido} foi conferido com sucesso. ✅\n\n" +
      "Agora ele está aguardando faturamento para seguir para a próxima etapa.\n\n" +
      "Acompanhe pelo link oficial:\n{link_pedido}",
  },
  FATURADO_AGUARDANDO_SAIDA: {
    subject: "Pedido faturado — nº {numero_pedido}",
    body:
      "Olá, {nome_cliente}! Seu pedido nº {numero_pedido} foi faturado com sucesso. ✅\n\n" +
      "Nota fiscal: {numero_nota}\n\n" +
      "Em breve avisaremos quando ele sair para entrega.\n\n" +
      "Acompanhe pelo link oficial:\n{link_pedido}",
  },
  FINALIZADO: {
    subject: "Pedido avançou para etapa final — nº {numero_pedido}",
    body:
      "Olá, {nome_cliente}! Seu pedido nº {numero_pedido} avançou para a etapa final do fluxo operacional. ✅\n\n" +
      "Se houver entrega ou montagem vinculada ao pedido, avisaremos você por aqui com as próximas informações.\n\n" +
      "Acompanhe pelo link oficial:\n{link_pedido}",
  },
};
