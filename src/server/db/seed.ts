import { v4 as uuid } from "uuid";
import { initOraclePool, closeOraclePool } from "./oracle";
import { ensureMontadoresTables } from "./initTables";
import { execDml, queryOne } from "./db";
import { json } from "./database";
import { roles } from "../../shared/domain";
import { AuthService } from "../services/AuthService";

await initOraclePool();
await ensureMontadoresTables();

// ── Roles ───────────────────────────────────────────────────────────────────
for (const role of roles) {
  const exists = await queryOne("SELECT 1 AS X FROM MONT_ROLES WHERE NAME = :name", { name: role });
  if (!exists) {
    await execDml("INSERT INTO MONT_ROLES (ID, NAME) VALUES (:id, :name)", { id: uuid(), name: role });
    console.log(`[seed] Role: ${role}`);
  }
}

// ── Admin user ───────────────────────────────────────────────────────────────
const adminEmail = process.env.ADMIN_EMAIL ?? "admin@montadores.com";
const adminPassword = process.env.ADMIN_PASSWORD ?? "Admin@2026!";
const adminExists = await queryOne("SELECT ID FROM MONT_USERS WHERE LOWER(EMAIL) = LOWER(:email)", { email: adminEmail });
if (!adminExists) {
  const auth = new AuthService();
  const { id } = await auth.createUser({ name: "Administrador", email: adminEmail, password: adminPassword, role: "ADMIN" });
  const gestorRole = await queryOne<{ id: string }>("SELECT ID FROM MONT_ROLES WHERE NAME = 'GESTOR'", {});
  if (gestorRole) {
    await execDml("INSERT INTO MONT_USER_ROLES (USER_ID, ROLE_ID) VALUES (:u, :r)", { u: id, r: gestorRole.id });
  }
  console.log(`[seed] Admin criado: ${adminEmail} / ${adminPassword}`);
}

// ── Demo provider ────────────────────────────────────────────────────────────
const providerExists = await queryOne(
  "SELECT 1 AS X FROM MONT_PROVIDERS WHERE DOCUMENT = :doc",
  { doc: "12345678900" },
);
if (!providerExists) {
  await execDml(
    `INSERT INTO MONT_PROVIDERS
     (ID, NAME, DOCUMENT, PHONE, WHATSAPP, EMAIL, CITY, UF,
      REGIONS_JSON, SERVICE_TYPES_JSON, PRODUCT_TYPES_JSON, AVAILABILITY_JSON,
      CAPACITY_PER_DAY, STATUS, DOCUMENTS_VALIDATED, ACTIVE)
     VALUES (:id, :name, :doc, :phone, :whatsapp, :email, :city, :uf,
             :regions, :serviceTypes, :productTypes, :availability,
             :capacity, 'APROVADO', 1, 1)`,
    {
      id: uuid(),
      name: "Montador Aprovado Demo",
      doc: "12345678900",
      phone: "11988887777",
      whatsapp: "11988887777",
      email: "montador@example.com",
      city: "São Paulo",
      uf: "SP",
      regions: json(["Centro", "Zona Sul"]),
      serviceTypes: json(["MONTAGEM"]),
      productTypes: json(["MOVEIS"]),
      availability: json({ weekdays: [1, 2, 3, 4, 5], periods: ["MANHA", "TARDE"] }),
      capacity: 3,
    },
  );
  console.log("[seed] Montador demo criado.");
}

// ── Message templates ─────────────────────────────────────────────────────────
// Upsert via MERGE — safe to re-run; only updates BODY/SUBJECT/RECIPIENT/CTA fields,
// preserving any manual customizations to ACTIVE flag.
type TemplateInput = {
  eventType: string;
  recipient: "CLIENTE" | "FORNECEDOR" | "INTERNO";
  channel?: string;
  subject: string;
  body: string;
  ctaLabel?: string;
  ctaUrlVar?: string;
  antifraudeType?: string;
  resendAllowed?: number;
  resendAfterH?: number;
  maxResends?: number;
  sendHourStart?: number;
  sendHourEnd?: number;
};

async function upsertTemplate(t: TemplateInput) {
  const id = uuid();
  await execDml(
    `MERGE INTO MONT_MSG_TEMPLATES tgt
     USING (SELECT :eventType AS EVENT_TYPE FROM DUAL) src
     ON (tgt.EVENT_TYPE = src.EVENT_TYPE)
     WHEN MATCHED THEN UPDATE SET
       RECIPIENT        = :recipient,
       CHANNEL          = :channel,
       SUBJECT          = :subject,
       BODY             = :body,
       CTA_LABEL        = :ctaLabel,
       CTA_URL_VAR      = :ctaUrlVar,
       ANTIFRAUDE_TYPE  = :antifraudeType,
       RESEND_ALLOWED   = :resendAllowed,
       RESEND_AFTER_H   = :resendAfterH,
       MAX_RESENDS      = :maxResends,
       SEND_HOUR_START  = :sendHourStart,
       SEND_HOUR_END    = :sendHourEnd
     WHEN NOT MATCHED THEN INSERT
       (ID, EVENT_TYPE, RECIPIENT, CHANNEL, SUBJECT, BODY,
        CTA_LABEL, CTA_URL_VAR, ANTIFRAUDE_TYPE,
        RESEND_ALLOWED, RESEND_AFTER_H, MAX_RESENDS,
        SEND_HOUR_START, SEND_HOUR_END, ACTIVE)
     VALUES
       (:id, :eventType, :recipient, :channel, :subject, :body,
        :ctaLabel, :ctaUrlVar, :antifraudeType,
        :resendAllowed, :resendAfterH, :maxResends,
        :sendHourStart, :sendHourEnd, 1)`,
    {
      id,
      eventType:       t.eventType,
      recipient:       t.recipient,
      channel:         t.channel ?? "WHATSAPP",
      subject:         t.subject,
      body:            t.body,
      ctaLabel:        t.ctaLabel        ?? null,
      ctaUrlVar:       t.ctaUrlVar       ?? null,
      antifraudeType:  t.antifraudeType  ?? null,
      resendAllowed:   t.resendAllowed   ?? 0,
      resendAfterH:    t.resendAfterH    ?? null,
      maxResends:      t.maxResends      ?? 0,
      sendHourStart:   t.sendHourStart   ?? 8,
      sendHourEnd:     t.sendHourEnd     ?? 21,
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BIBLIOTECA COMPLETA — 56 templates
// Baseada no case Amazon Brazil WhatsApp + boas práticas de régua transacional
// ─────────────────────────────────────────────────────────────────────────────

const templates: TemplateInput[] = [

  // ══════════════════════════════════════════════════════════════════════════
  // BLOCO 1 — PEDIDO & PAGAMENTO (para o cliente)
  // ══════════════════════════════════════════════════════════════════════════

  {
    eventType: "PEDIDO_CRIADO",
    recipient: "CLIENTE",
    subject: "Pedido {{numped}} recebido com sucesso",
    body:
      "Olá, {{cliente}}! 👋 Recebemos seu pedido *#{{numped}}* e já estamos cuidando de tudo.\n\n" +
      "Acompanhe cada etapa em tempo real pelo link abaixo:\n{{link_jornada}}\n\n" +
      "Qualquer dúvida, fale com a gente. Obrigado pela confiança! 🏪",
    ctaLabel: "Ver minha jornada",
    ctaUrlVar: "{{link_jornada}}",
  },

  {
    eventType: "PEDIDO_PAGAMENTO_APROVADO",
    recipient: "CLIENTE",
    subject: "Pagamento aprovado — pedido {{numped}}",
    body:
      "Ótima notícia, {{cliente}}! ✅ O pagamento do pedido *#{{numped}}* foi aprovado.\n\n" +
      "Agora é só aguardar — vamos separar seus produtos e avisar cada passo.\n\n" +
      "Acompanhe: {{link_jornada}}",
    ctaLabel: "Acompanhar pedido",
    ctaUrlVar: "{{link_jornada}}",
  },

  {
    eventType: "PEDIDO_PAGAMENTO_RECUSADO",
    recipient: "CLIENTE",
    subject: "Pagamento não autorizado — pedido {{numped}}",
    body:
      "Olá, {{cliente}}. Identificamos que o pagamento do pedido *#{{numped}}* não foi autorizado.\n\n" +
      "Isso pode ocorrer por saldo insuficiente, limite excedido ou dados incorretos.\n\n" +
      "Acesse o link abaixo para tentar novamente ou escolher outra forma de pagamento:\n{{link_jornada}}\n\n" +
      "Se precisar de ajuda, entre em contato: {{telefone_sac}}",
    ctaLabel: "Tentar novamente",
    ctaUrlVar: "{{link_jornada}}",
  },

  {
    eventType: "PEDIDO_CANCELADO_PAGAMENTO",
    recipient: "CLIENTE",
    subject: "Pedido {{numped}} cancelado — pagamento",
    body:
      "Olá, {{cliente}}. Infelizmente o pedido *#{{numped}}* foi cancelado após tentativas sem sucesso no pagamento.\n\n" +
      "Caso queira refazer o pedido, acesse nosso site: {{dominio_oficial}}\n\n" +
      "Ficou com dúvidas? Fale conosco: {{telefone_sac}}",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BLOCO 2 — SEPARAÇÃO & FATURAMENTO
  // ══════════════════════════════════════════════════════════════════════════

  {
    eventType: "SEPARACAO_INICIADA",
    recipient: "CLIENTE",
    subject: "Pedido {{numped}} em separação",
    body:
      "Olá, {{cliente}}! 📦 Seu pedido *#{{numped}}* já está sendo separado no nosso estoque.\n\n" +
      "Em breve ele será conferido e despachado para você.\n\n" +
      "Acompanhe: {{link_jornada}}",
    ctaLabel: "Ver status",
    ctaUrlVar: "{{link_jornada}}",
  },

  {
    eventType: "CONFERENCIA_FINALIZADA",
    recipient: "CLIENTE",
    subject: "Pedido {{numped}} conferido e pronto",
    body:
      "Uhuul, {{cliente}}! 🎉 Seu pedido *#{{numped}}* foi conferido e está pronto para expedição.\n\n" +
      "Acompanhe: {{link_jornada}}",
    ctaLabel: "Acompanhar pedido",
    ctaUrlVar: "{{link_jornada}}",
  },

  {
    eventType: "FATURADO",
    recipient: "CLIENTE",
    subject: "Nota fiscal emitida — pedido {{numped}}",
    body:
      "Olá, {{cliente}}! 📄 A nota fiscal do pedido *#{{numped}}* foi emitida.\n\n" +
      "Seu pedido está sendo preparado para entrega. Fique atento — avisaremos quando sair.\n\n" +
      "Acompanhe: {{link_jornada}}",
    ctaLabel: "Ver jornada",
    ctaUrlVar: "{{link_jornada}}",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BLOCO 3 — ENTREGA
  // ══════════════════════════════════════════════════════════════════════════

  {
    eventType: "SAIU_PARA_ENTREGA",
    recipient: "CLIENTE",
    subject: "Seu pedido {{numped}} saiu para entrega!",
    body:
      "{{cliente}}, boas notícias! 🚚 Seu pedido *#{{numped}}* saiu para entrega hoje!\n\n" +
      "Fique em casa para receber. Acompanhe em tempo real:\n{{link_jornada}}\n\n" +
      "_Atenção: nossos entregadores nunca solicitam pagamentos ou dados bancários. Em caso de dúvida, contate-nos: {{telefone_sac}}_",
    ctaLabel: "Acompanhar entrega",
    ctaUrlVar: "{{link_jornada}}",
    antifraudeType: "ENTREGADOR",
  },

  {
    eventType: "PEDIDO_EM_ROTA",
    recipient: "CLIENTE",
    subject: "Entregador a caminho — pedido {{numped}}",
    body:
      "{{cliente}}, o entregador está a caminho! 📍 Seu pedido *#{{numped}}* está próximo de você.\n\n" +
      "Certifique-se de que alguém esteja no endereço para receber.\n\n" +
      "Rastreie agora: {{link_jornada}}",
    ctaLabel: "Ver localização",
    ctaUrlVar: "{{link_jornada}}",
  },

  {
    eventType: "ENTREGA_REALIZADA",
    recipient: "CLIENTE",
    subject: "Pedido {{numped}} entregue com sucesso!",
    body:
      "{{cliente}}, seu pedido *#{{numped}}* foi entregue! 🎉\n\n" +
      "Esperamos que tudo esteja perfeito. Como foi a nossa entrega?\n{{link_jornada}}\n\n" +
      "_Nota: {{nome_empresa}} nunca solicita pagamentos adicionais após a entrega. Desconfie de cobranças não previstas: {{telefone_sac}}_",
    ctaLabel: "Avaliar entrega",
    ctaUrlVar: "{{link_jornada}}",
    antifraudeType: "POS_ENTREGA",
  },

  {
    eventType: "TENTATIVA_ENTREGA_FRUSTRADA",
    recipient: "CLIENTE",
    subject: "Tentativa de entrega do pedido {{numped}}",
    body:
      "Olá, {{cliente}}. Tentamos entregar o pedido *#{{numped}}*, mas não encontramos ninguém no endereço.\n\n" +
      "Acesse o link abaixo para reagendar ou atualizar seu endereço de entrega:\n{{link_jornada}}\n\n" +
      "Pedidos sem nova tentativa em 3 dias úteis poderão ser devolvidos ao estoque.",
    ctaLabel: "Reagendar entrega",
    ctaUrlVar: "{{link_jornada}}",
    resendAllowed: 1,
    resendAfterH: 24,
    maxResends: 2,
  },

  {
    eventType: "ENTREGA_REAGENDADA",
    recipient: "CLIENTE",
    subject: "Entrega reagendada — pedido {{numped}}",
    body:
      "{{cliente}}, sua entrega foi reagendada com sucesso! 📅\n\n" +
      "Novo prazo para o pedido *#{{numped}}*: em breve você receberá a confirmação da data.\n\n" +
      "Acompanhe: {{link_jornada}}",
    ctaLabel: "Ver detalhes",
    ctaUrlVar: "{{link_jornada}}",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BLOCO 4 — AVALIAÇÕES DE ATENDIMENTO E ENTREGA
  // ══════════════════════════════════════════════════════════════════════════

  {
    eventType: "ATENDIMENTO_AVALIACAO_ENVIADA",
    recipient: "CLIENTE",
    subject: "Como foi seu atendimento? — pedido {{numped}}",
    body:
      "Olá, {{cliente}}! Seu pedido *#{{numped}}* está em andamento.\n\n" +
      "Gostaríamos de saber como foi o atendimento até agora. Sua opinião nos ajuda a melhorar:\n{{link_jornada}}\n\n" +
      "Leva menos de 1 minuto! ⭐",
    ctaLabel: "Avaliar atendimento",
    ctaUrlVar: "{{link_jornada}}",
    sendHourStart: 9,
    sendHourEnd: 20,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BLOCO 5 — MONTAGEM (cliente)
  // ══════════════════════════════════════════════════════════════════════════

  {
    eventType: "MONTAGEM_NECESSARIA",
    recipient: "CLIENTE",
    subject: "Seu pedido inclui montagem — pedido {{numped}}",
    body:
      "Olá, {{cliente}}! 🔧 Seu pedido *#{{numped}}* inclui o serviço de montagem profissional.\n\n" +
      "Em breve entraremos em contato para agendar. Fique atento!\n\n" +
      "Acompanhe: {{link_jornada}}",
    ctaLabel: "Ver detalhes",
    ctaUrlVar: "{{link_jornada}}",
  },

  {
    eventType: "LINK_AGENDAMENTO_ENVIADO",
    recipient: "CLIENTE",
    subject: "Agende sua montagem — pedido {{numped}}",
    body:
      "{{cliente}}, é hora de agendar sua montagem! 📅\n\n" +
      "Clique no link abaixo, escolha o dia e horário que melhor combinam com você:\n{{link_jornada}}\n\n" +
      "O link é válido por 48 horas. Após esse prazo, entre em contato: {{telefone_sac}}\n\n" +
      "_Atenção: este link é pessoal e intransferível. {{nome_empresa}} nunca pede senha ou dados bancários para agendamento._",
    ctaLabel: "Agendar montagem",
    ctaUrlVar: "{{link_jornada}}",
    antifraudeType: "LINK_PESSOAL",
    resendAllowed: 1,
    resendAfterH: 24,
    maxResends: 1,
  },

  {
    eventType: "MONTAGEM_AGENDADA",
    recipient: "CLIENTE",
    subject: "Montagem agendada — pedido {{numped}}",
    body:
      "Perfeito, {{cliente}}! ✅ Sua montagem está confirmada.\n\n" +
      "📅 Data: *{{data_montagem}}*\n" +
      "🔧 Montador: *{{montador}}*\n" +
      "📦 Pedido: *#{{numped}}*\n\n" +
      "Certifique-se de que o local de montagem esteja livre e acessível.\n\n" +
      "Gerenciar agendamento: {{link_jornada}}",
    ctaLabel: "Ver agendamento",
    ctaUrlVar: "{{link_jornada}}",
  },

  {
    eventType: "LEMBRETE_MONTAGEM_24H",
    recipient: "CLIENTE",
    subject: "Lembrete: montagem amanhã — pedido {{numped}}",
    body:
      "{{cliente}}, lembrete importante! ⏰\n\n" +
      "Sua montagem está marcada para *amanhã, {{data_montagem}}*.\n" +
      "Montador: *{{montador}}*\n\n" +
      "Prepare o ambiente:\n" +
      "• Livre o espaço onde o produto será montado\n" +
      "• Tenha alguém maior de 18 anos no local\n" +
      "• Certifique-se de que o produto já foi entregue\n\n" +
      "Precisa reagendar? Acesse: {{link_jornada}}",
    ctaLabel: "Gerenciar montagem",
    ctaUrlVar: "{{link_jornada}}",
    sendHourStart: 16,
    sendHourEnd: 20,
  },

  {
    eventType: "LEMBRETE_MONTAGEM_DIA",
    recipient: "CLIENTE",
    subject: "Montagem hoje — pedido {{numped}}",
    body:
      "Bom dia, {{cliente}}! ☀️ A montagem do seu pedido *#{{numped}}* é *hoje, {{data_montagem}}*!\n\n" +
      "O montador *{{montador}}* está a caminho. Certifique-se de estar em casa.\n\n" +
      "_Lembre-se: nossos montadores são identificados por crachá e nunca solicitam pagamentos extras._\n\n" +
      "Acompanhe: {{link_jornada}}",
    ctaLabel: "Acompanhar chegada",
    ctaUrlVar: "{{link_jornada}}",
    antifraudeType: "MONTADOR",
    sendHourStart: 7,
    sendHourEnd: 9,
  },

  {
    eventType: "MONTADOR_CHEGOU",
    recipient: "CLIENTE",
    subject: "Montador chegou — pedido {{numped}}",
    body:
      "{{cliente}}, o montador *{{montador}}* acaba de chegar no seu endereço! 🔔\n\n" +
      "Por favor, receba-o para dar início ao serviço do pedido *#{{numped}}*.\n\n" +
      "Acompanhe: {{link_jornada}}",
    ctaLabel: "Ver detalhes",
    ctaUrlVar: "{{link_jornada}}",
  },

  {
    eventType: "MONTAGEM_INICIADA",
    recipient: "CLIENTE",
    subject: "Montagem iniciada — pedido {{numped}}",
    body:
      "{{cliente}}, a montagem do pedido *#{{numped}}* começou! 🔧\n\n" +
      "Montador: *{{montador}}*\n\n" +
      "Acompanhe o andamento em tempo real:\n{{link_jornada}}",
    ctaLabel: "Acompanhar montagem",
    ctaUrlVar: "{{link_jornada}}",
  },

  {
    eventType: "MONTAGEM_FINALIZADA",
    recipient: "CLIENTE",
    subject: "Montagem concluída — pedido {{numped}}",
    body:
      "{{cliente}}, a montagem está pronta! 🎉\n\n" +
      "O montador *{{montador}}* finalizou o serviço do pedido *#{{numped}}*.\n\n" +
      "Confira o resultado e confirme que tudo está de acordo antes de assinar o término.\n\n" +
      "Acompanhe: {{link_jornada}}",
    ctaLabel: "Confirmar conclusão",
    ctaUrlVar: "{{link_jornada}}",
  },

  {
    eventType: "FOTOS_MONTAGEM_ANEXADAS",
    recipient: "CLIENTE",
    subject: "Fotos da montagem disponíveis — pedido {{numped}}",
    body:
      "Olá, {{cliente}}! As fotos da montagem do pedido *#{{numped}}* foram registradas pelo montador.\n\n" +
      "Você pode visualizá-las e confirmar o serviço pelo link:\n{{link_jornada}}",
    ctaLabel: "Ver fotos",
    ctaUrlVar: "{{link_jornada}}",
  },

  {
    eventType: "LINK_AVALIACAO_MONTAGEM_ENVIADO",
    recipient: "CLIENTE",
    subject: "Como foi a montagem? — pedido {{numped}}",
    body:
      "{{cliente}}, esperamos que você tenha adorado o resultado! ⭐\n\n" +
      "Nos conte como foi a montagem do pedido *#{{numped}}*. Sua avaliação é muito importante:\n{{link_jornada}}\n\n" +
      "Leva menos de 1 minuto.",
    ctaLabel: "Avaliar montagem",
    ctaUrlVar: "{{link_jornada}}",
    sendHourStart: 9,
    sendHourEnd: 20,
  },

  {
    eventType: "AVALIACAO_CLIENTE_RECEBIDA",
    recipient: "CLIENTE",
    subject: "Obrigado pela avaliação — pedido {{numped}}",
    body:
      "Obrigado, {{cliente}}! Recebemos sua avaliação do pedido *#{{numped}}*. 🙏\n\n" +
      "Seu feedback nos ajuda a melhorar continuamente. Esperamos atendê-lo novamente em breve!\n\n" +
      "{{nome_empresa}} — {{dominio_oficial}}",
  },

  {
    eventType: "MONTAGEM_APROVADA_CLIENTE",
    recipient: "CLIENTE",
    subject: "Montagem aprovada — pedido {{numped}}",
    body:
      "Que ótimo, {{cliente}}! 🌟 Você aprovou a montagem do pedido *#{{numped}}*.\n\n" +
      "Seu serviço está encerrado. Obrigado por escolher a {{nome_empresa}}!\n\n" +
      "Acompanhe sua jornada completa: {{link_jornada}}",
    ctaLabel: "Ver jornada",
    ctaUrlVar: "{{link_jornada}}",
  },

  {
    eventType: "MONTAGEM_REPROVADA_CLIENTE",
    recipient: "CLIENTE",
    subject: "Montagem reprovada — pedido {{numped}}",
    body:
      "Olá, {{cliente}}. Recebemos a informação de que a montagem do pedido *#{{numped}}* não atendeu às suas expectativas.\n\n" +
      "Nossa equipe de SAC entrará em contato em até 24 horas para resolver a situação.\n\n" +
      "Protocolo: *{{protocolo_sac}}*\n\n" +
      "Se preferir, fale conosco agora: {{telefone_sac}}",
  },

  {
    eventType: "MONTAGEM_REAGENDADA_SAC",
    recipient: "CLIENTE",
    subject: "Montagem reagendada pelo SAC — pedido {{numped}}",
    body:
      "{{cliente}}, sua montagem do pedido *#{{numped}}* foi reagendada pelo nosso SAC.\n\n" +
      "📅 Nova data: *{{data_montagem}}*\n\n" +
      "Para mais detalhes ou alterações, acesse:\n{{link_jornada}}\n\n" +
      "Protocolo: *{{protocolo_sac}}*",
    ctaLabel: "Ver agendamento",
    ctaUrlVar: "{{link_jornada}}",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BLOCO 6 — SAC (cliente)
  // ══════════════════════════════════════════════════════════════════════════

  {
    eventType: "RECLAMACAO_CLIENTE_ABERTA",
    recipient: "CLIENTE",
    subject: "Reclamação registrada — protocolo {{protocolo_sac}}",
    body:
      "Olá, {{cliente}}. Recebemos sua solicitação referente ao pedido *#{{numped}}*.\n\n" +
      "📋 Protocolo de atendimento: *{{protocolo_sac}}*\n\n" +
      "Nossa equipe analisará o caso e retornará em até 48 horas úteis.\n\n" +
      "Acompanhe: {{link_jornada}}\n\n" +
      "Para urgências: {{telefone_sac}}",
    ctaLabel: "Acompanhar caso",
    ctaUrlVar: "{{link_jornada}}",
  },

  {
    eventType: "SAC_CASO_ABERTO",
    recipient: "CLIENTE",
    subject: "Caso SAC aberto — protocolo {{protocolo_sac}}",
    body:
      "Olá, {{cliente}}. Um caso de atendimento foi aberto para o pedido *#{{numped}}*.\n\n" +
      "📋 Protocolo: *{{protocolo_sac}}*\n\n" +
      "Você será notificado a cada atualização. Acompanhe pelo link:\n{{link_jornada}}\n\n" +
      "SAC: {{telefone_sac}}",
    ctaLabel: "Acompanhar SAC",
    ctaUrlVar: "{{link_jornada}}",
  },

  {
    eventType: "SAC_EM_ANALISE",
    recipient: "CLIENTE",
    subject: "Seu caso está em análise — protocolo {{protocolo_sac}}",
    body:
      "Olá, {{cliente}}. Sua solicitação do pedido *#{{numped}}* está em análise.\n\n" +
      "📋 Protocolo: *{{protocolo_sac}}*\n\n" +
      "Nossa equipe está trabalhando para resolver o quanto antes. Você receberá uma atualização em breve.\n\n" +
      "Acompanhe: {{link_jornada}}",
    ctaLabel: "Ver andamento",
    ctaUrlVar: "{{link_jornada}}",
  },

  {
    eventType: "SAC_SOLICITOU_INFO",
    recipient: "CLIENTE",
    subject: "SAC solicita informações — protocolo {{protocolo_sac}}",
    body:
      "Olá, {{cliente}}. O nosso SAC precisa de algumas informações adicionais para resolver o caso do pedido *#{{numped}}*.\n\n" +
      "📋 Protocolo: *{{protocolo_sac}}*\n\n" +
      "Por favor, responda pelo link ou entre em contato:\n{{link_jornada}}\n\n" +
      "SAC: {{telefone_sac}}",
    ctaLabel: "Responder SAC",
    ctaUrlVar: "{{link_jornada}}",
    resendAllowed: 1,
    resendAfterH: 48,
    maxResends: 1,
  },

  {
    eventType: "SAC_APROVOU_LIBERACAO",
    recipient: "CLIENTE",
    subject: "SAC aprovou sua solicitação — protocolo {{protocolo_sac}}",
    body:
      "Boa notícia, {{cliente}}! ✅ O SAC aprovou a resolução do caso do pedido *#{{numped}}*.\n\n" +
      "📋 Protocolo: *{{protocolo_sac}}*\n\n" +
      "Acompanhe os próximos passos:\n{{link_jornada}}",
    ctaLabel: "Ver resolução",
    ctaUrlVar: "{{link_jornada}}",
  },

  {
    eventType: "SAC_REPROVOU_LIBERACAO",
    recipient: "CLIENTE",
    subject: "SAC não aprovou liberação — protocolo {{protocolo_sac}}",
    body:
      "Olá, {{cliente}}. Após análise, o SAC não aprovou a liberação solicitada para o pedido *#{{numped}}*.\n\n" +
      "📋 Protocolo: *{{protocolo_sac}}*\n\n" +
      "Nossa equipe entrará em contato para explicar os próximos passos.\n\n" +
      "Dúvidas: {{telefone_sac}}",
  },

  {
    eventType: "SAC_ENCERROU_CASO",
    recipient: "CLIENTE",
    subject: "Caso encerrado — protocolo {{protocolo_sac}}",
    body:
      "Olá, {{cliente}}. O caso do pedido *#{{numped}}* foi encerrado.\n\n" +
      "📋 Protocolo: *{{protocolo_sac}}*\n\n" +
      "Esperamos ter resolvido sua solicitação. Caso precise de algo mais, estamos à disposição:\n{{telefone_sac}}",
  },

  {
    eventType: "JORNADA_ENCERRADA",
    recipient: "CLIENTE",
    subject: "Sua jornada foi concluída — pedido {{numped}}",
    body:
      "{{cliente}}, sua jornada com o pedido *#{{numped}}* chegou ao fim! 🎊\n\n" +
      "Esperamos que tudo tenha superado suas expectativas.\n\n" +
      "Ficou com dúvidas ou precisa de suporte? Fale conosco:\n{{telefone_sac}}\n\n" +
      "Obrigado por escolher a {{nome_empresa}}. Até a próxima! 🏪",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BLOCO 7 — MONTADOR / FORNECEDOR
  // ══════════════════════════════════════════════════════════════════════════

  {
    eventType: "MONTADOR_NOTIFICADO",
    recipient: "FORNECEDOR",
    subject: "Nova montagem atribuída — pedido {{numped}}",
    body:
      "Olá, *{{fornecedor}}*! 🔧 Uma nova montagem foi atribuída a você.\n\n" +
      "📦 Pedido: *#{{numped}}*\n" +
      "📅 Data: *{{data_montagem}}*\n\n" +
      "Acesse o app para ver os detalhes do serviço, endereço e instruções:\n{{link_app}}\n\n" +
      "Confirme o recebimento respondendo esta mensagem.",
    ctaLabel: "Ver montagem",
    ctaUrlVar: "{{link_app}}",
  },

  {
    eventType: "MONTADOR_LEMBRETE_DIA",
    recipient: "FORNECEDOR",
    subject: "Lembrete: você tem montagem hoje — pedido {{numped}}",
    body:
      "Bom dia, *{{fornecedor}}*! ☀️ Lembrete: você tem uma montagem *hoje, {{data_montagem}}*.\n\n" +
      "📦 Pedido: *#{{numped}}*\n\n" +
      "Verifique o endereço e materiais antes de sair. Detalhes no app:\n{{link_app}}",
    ctaLabel: "Ver detalhes",
    ctaUrlVar: "{{link_app}}",
    sendHourStart: 7,
    sendHourEnd: 9,
  },

  {
    eventType: "MONTADOR_SERVICO_REAGENDADO",
    recipient: "FORNECEDOR",
    subject: "Serviço reagendado — pedido {{numped}}",
    body:
      "Olá, *{{fornecedor}}*. O serviço do pedido *#{{numped}}* foi reagendado.\n\n" +
      "📅 Nova data: *{{data_montagem}}*\n\n" +
      "Verifique sua agenda e confirme no app:\n{{link_app}}",
    ctaLabel: "Confirmar nova data",
    ctaUrlVar: "{{link_app}}",
  },

  {
    eventType: "MONTADOR_SERVICO_CANCELADO",
    recipient: "FORNECEDOR",
    subject: "Serviço cancelado — pedido {{numped}}",
    body:
      "Olá, *{{fornecedor}}*. Informamos que o serviço do pedido *#{{numped}}* foi cancelado.\n\n" +
      "Não haverá necessidade de comparecimento.\n\n" +
      "Para esclarecimentos, entre em contato com nossa equipe:\n{{telefone_sac}}",
  },

  {
    eventType: "MONTADOR_CLIENTE_ALTEROU",
    recipient: "FORNECEDOR",
    subject: "Cliente alterou agendamento — pedido {{numped}}",
    body:
      "Atenção, *{{fornecedor}}*! ⚠️ O cliente alterou o agendamento do pedido *#{{numped}}*.\n\n" +
      "📅 Nova data: *{{data_montagem}}*\n\n" +
      "Confirme a disponibilidade no app:\n{{link_app}}",
    ctaLabel: "Confirmar disponibilidade",
    ctaUrlVar: "{{link_app}}",
  },

  {
    eventType: "MONTADOR_FOTOS_PENDENTES",
    recipient: "FORNECEDOR",
    subject: "Fotos pendentes — pedido {{numped}}",
    body:
      "Olá, *{{fornecedor}}*. As fotos da montagem do pedido *#{{numped}}* ainda não foram enviadas.\n\n" +
      "📸 O envio das fotos é obrigatório para concluir o serviço e liberar o pagamento.\n\n" +
      "Envie agora pelo app:\n{{link_app}}",
    ctaLabel: "Enviar fotos",
    ctaUrlVar: "{{link_app}}",
    resendAllowed: 1,
    resendAfterH: 4,
    maxResends: 3,
  },

  {
    eventType: "MONTADOR_MONTAGEM_FINALIZADA",
    recipient: "FORNECEDOR",
    subject: "Montagem concluída confirmada — pedido {{numped}}",
    body:
      "Parabéns, *{{fornecedor}}*! 🎉 A montagem do pedido *#{{numped}}* foi registrada como concluída.\n\n" +
      "O pagamento será processado conforme aprovação do cliente e políticas vigentes.\n\n" +
      "Veja o histórico no app:\n{{link_app}}",
    ctaLabel: "Ver histórico",
    ctaUrlVar: "{{link_app}}",
  },

  {
    eventType: "MONTADOR_MONTAGEM_REPROVADA",
    recipient: "FORNECEDOR",
    subject: "Montagem reprovada pelo cliente — pedido {{numped}}",
    body:
      "Olá, *{{fornecedor}}*. O cliente reprovou a montagem do pedido *#{{numped}}*.\n\n" +
      "O SAC entrará em análise. Aguarde contato da nossa equipe para orientações.\n\n" +
      "Detalhes no app:\n{{link_app}}",
    ctaLabel: "Ver detalhes",
    ctaUrlVar: "{{link_app}}",
  },

  {
    eventType: "MONTADOR_SAC_ANALISE",
    recipient: "FORNECEDOR",
    subject: "SAC em análise — pedido {{numped}}",
    body:
      "Olá, *{{fornecedor}}*. O pedido *#{{numped}}* está em análise pelo SAC.\n\n" +
      "O pagamento será processado após a conclusão da análise.\n\n" +
      "Acompanhe no app:\n{{link_app}}",
    ctaLabel: "Acompanhar SAC",
    ctaUrlVar: "{{link_app}}",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BLOCO 8 — PAGAMENTOS (fornecedor)
  // ══════════════════════════════════════════════════════════════════════════

  {
    eventType: "PAGAMENTO_AGUARDANDO_APROVACAO",
    recipient: "FORNECEDOR",
    subject: "Pagamento em análise — pedido {{numped}}",
    body:
      "Olá, *{{fornecedor}}*. O pagamento referente à montagem do pedido *#{{numped}}* está em análise.\n\n" +
      "💰 Valor: R$ {{valor}}\n\n" +
      "Você receberá uma notificação assim que for aprovado. Em média, o processo leva 1 dia útil.\n\n" +
      "Dúvidas: {{telefone_sac}}",
  },

  {
    eventType: "PAGAMENTO_BLOQUEADO",
    recipient: "FORNECEDOR",
    subject: "Pagamento bloqueado — pedido {{numped}}",
    body:
      "Olá, *{{fornecedor}}*. O pagamento do pedido *#{{numped}}* foi temporariamente bloqueado.\n\n" +
      "💰 Valor: R$ {{valor}}\n\n" +
      "Isso pode ocorrer por pendências no serviço ou análise do SAC. Entre em contato para esclarecimentos:\n{{telefone_sac}}",
  },

  {
    eventType: "PAGAMENTO_LIBERADO",
    recipient: "FORNECEDOR",
    subject: "Pagamento aprovado e liberado — pedido {{numped}}",
    body:
      "Boa notícia, *{{fornecedor}}*! ✅ O pagamento do pedido *#{{numped}}* foi aprovado e liberado.\n\n" +
      "💰 Valor: R$ {{valor}}\n\n" +
      "O valor será processado pelo financeiro em breve.",
  },

  {
    eventType: "PAGAMENTO_ENVIADO_FINANCEIRO",
    recipient: "FORNECEDOR",
    subject: "Pagamento encaminhado ao financeiro — pedido {{numped}}",
    body:
      "Olá, *{{fornecedor}}*. O pagamento do pedido *#{{numped}}* foi encaminhado ao financeiro para processamento.\n\n" +
      "💰 Valor: R$ {{valor}}\n\n" +
      "Em breve você receberá a confirmação da data de pagamento.",
  },

  {
    eventType: "PAGAMENTO_PROGRAMADO",
    recipient: "FORNECEDOR",
    subject: "Pagamento programado — pedido {{numped}}",
    body:
      "Olá, *{{fornecedor}}*. Seu pagamento referente à montagem do pedido *#{{numped}}* está programado!\n\n" +
      "💰 Valor: R$ {{valor}}\n" +
      "📅 Previsão de pagamento: *{{data_pagamento}}*\n\n" +
      "O depósito será feito via PIX na chave cadastrada.",
  },

  {
    eventType: "PAGAMENTO_REALIZADO",
    recipient: "FORNECEDOR",
    subject: "Pagamento realizado — pedido {{numped}}",
    body:
      "Olá, *{{fornecedor}}*! ✅ Seu pagamento foi realizado com sucesso.\n\n" +
      "📦 Pedido: *#{{numped}}*\n" +
      "💰 Valor: R$ {{valor}}\n" +
      "📅 Data: *{{data_pagamento}}*\n\n" +
      "Obrigado pelo excelente serviço! Continue fazendo parte da nossa equipe. 💪\n\n" +
      "Dúvidas sobre o pagamento: {{telefone_sac}}",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BLOCO 9 — ERROS / SISTEMA (interno)
  // ══════════════════════════════════════════════════════════════════════════

  {
    eventType: "INTEGRACAO_WINTHOR_ERRO",
    recipient: "INTERNO",
    subject: "[ERRO] Falha na integração WinThor — pedido {{numped}}",
    body:
      "⚠️ Falha na integração com o WinThor para o pedido *#{{numped}}*.\n\n" +
      "Verifique os logs e tente sincronizar manualmente se necessário.",
  },

  {
    eventType: "MENSAGEM_ERRO_ENVIO",
    recipient: "INTERNO",
    subject: "[ERRO] Falha no envio de mensagem — pedido {{numped}}",
    body:
      "⚠️ Falha ao enviar mensagem para o cliente/fornecedor referente ao pedido *#{{numped}}*.\n\n" +
      "Verifique o canal de envio e tente novamente.",
  },

];

let inserted = 0;
let updated = 0;
for (const t of templates) {
  const before = await queryOne<{ id: string }>(
    "SELECT ID FROM MONT_MSG_TEMPLATES WHERE EVENT_TYPE = :et",
    { et: t.eventType },
  );
  await upsertTemplate(t);
  if (before) {
    updated++;
  } else {
    inserted++;
    console.log(`[seed] Template inserido: ${t.eventType} → ${t.recipient}`);
  }
}
console.log(`[seed] Templates: ${inserted} inseridos, ${updated} atualizados.`);

// ── Fluxo WinThor event config ───────────────────────────────────────────────
const FLUXO_EVENTS = [
  { key: "AGUARDANDO_MAPA_ESTOQUE",            label: "1 - Aguardando Mapa/Estoque",             ativoDash: 1, ativoMsg: 0 },
  { key: "MAPA_EMITIDO_AGUARDANDO_SEPARACAO",  label: "2 - Mapa Emitido / Aguardando Separação", ativoDash: 1, ativoMsg: 1 },
  { key: "EM_SEPARACAO_CONFERENCIA",           label: "3 - Em Separação / Conferência",           ativoDash: 1, ativoMsg: 1 },
  { key: "CONFERIDO_AGUARDANDO_FATURAMENTO",   label: "4 - Conferido / Aguardando Faturamento",  ativoDash: 1, ativoMsg: 1 },
  { key: "FATURADO_AGUARDANDO_SAIDA",          label: "5 - Faturado / Aguardando Saída",         ativoDash: 1, ativoMsg: 1 },
  { key: "FINALIZADO",                         label: "6 - Finalizado no Fluxo Operacional",     ativoDash: 1, ativoMsg: 1 },
] as const;

for (const ev of FLUXO_EVENTS) {
  await execDml(
    `MERGE INTO MONT_FLUXO_EVENT_CONFIG tgt
     USING DUAL ON (tgt.EVENT_KEY = :key)
     WHEN NOT MATCHED THEN INSERT
       (EVENT_KEY, LABEL, ATIVO_DASHBOARD, ATIVO_MENSAGEM, MODO_ENVIO, ATUALIZADO_EM)
     VALUES
       (:key, :label, :ativoDash, :ativoMsg, 'DRY_RUN', SYSTIMESTAMP)`,
    { key: ev.key, label: ev.label, ativoDash: ev.ativoDash, ativoMsg: ev.ativoMsg },
  );
}
console.log("[seed] MONT_FLUXO_EVENT_CONFIG: 6 eventos configurados.");

// ── Sync config defaults ─────────────────────────────────────────────────────
const SYNC_CONFIGS: Array<{ key: string; value: string }> = [
  { key: "MESSAGE_TRIGGER_MODE", value: "DRY_RUN" },
  { key: "CONDVENDA_DEFAULT",    value: "8" },
  { key: "SYNC_DAYS_BACK",       value: "7" },
];

for (const cfg of SYNC_CONFIGS) {
  await execDml(
    `MERGE INTO MONT_SYNC_CONFIG tgt
     USING DUAL ON (tgt.CONFIG_KEY = :key)
     WHEN NOT MATCHED THEN INSERT (CONFIG_KEY, CONFIG_VALUE, ATUALIZADO_EM)
     VALUES (:key, :val, SYSTIMESTAMP)`,
    { key: cfg.key, val: cfg.value },
  );
}
console.log("[seed] MONT_SYNC_CONFIG: configurações padrão inseridas.");

console.log("[seed] Seed Oracle concluído.");

await closeOraclePool();
