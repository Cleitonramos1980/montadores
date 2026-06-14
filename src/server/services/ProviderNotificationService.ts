import { randomBytes } from "node:crypto";
import { v4 as uuid } from "uuid";
import { execDml, queryOne, queryRows } from "../db/db";
import { features } from "../config";

export type ProviderNotificationType = "NOVA_MONTAGEM_AGENDADA_MONTADOR";

export type ProviderNotificationResult = {
  status:
    | "SIMULADO_DRY_RUN"
    | "CRIADO"
    | "IGNORADO_DUPLICIDADE"
    | "IGNORADO_MONTADOR_INATIVO"
    | "IGNORADO_MONTADOR_NAO_APROVADO"
    | "IGNORADO_SEM_TELEFONE";
  notificationId?: string;
  reason?: string;
};

export class ProviderNotificationService {
  async notifyNewJob(params: {
    providerId: string;
    assemblyJobId: string;
    numped: string;
    scheduledDate: string;
    scheduledPeriod: string;
    customerName: string;
  }): Promise<ProviderNotificationResult> {
    const { providerId, assemblyJobId, numped, scheduledDate, scheduledPeriod, customerName } = params;

    // 1. Check provider exists and is active/approved
    const provider = await queryOne<{
      id: string;
      name: string;
      phone: string | null;
      whatsapp: string | null;
      status: string;
      active: number;
    }>(
      "SELECT ID, NAME, PHONE, WHATSAPP, STATUS, ACTIVE FROM MONT_PROVIDERS WHERE ID = :id",
      { id: providerId },
    );

    if (!provider) {
      return { status: "IGNORADO_MONTADOR_INATIVO", reason: "Montador não encontrado" };
    }
    if (Number(provider.active) === 0) {
      return { status: "IGNORADO_MONTADOR_INATIVO", reason: "Montador inativo" };
    }
    if (provider.status !== "APROVADO") {
      return { status: "IGNORADO_MONTADOR_NAO_APROVADO", reason: `Status: ${provider.status}` };
    }

    const phone = provider.whatsapp || provider.phone;
    if (!phone) {
      return { status: "IGNORADO_SEM_TELEFONE", reason: "Montador sem telefone cadastrado" };
    }

    // 2. Idempotency check
    const idempotencyKey = `notif:nova-montagem:${assemblyJobId}`;
    const existing = await queryOne<{ id: string }>(
      "SELECT ID FROM MONT_PROVIDER_NOTIFICATIONS WHERE IDEMPOTENCY_KEY = :key",
      { key: idempotencyKey },
    );
    if (existing) {
      return { status: "IGNORADO_DUPLICIDADE", notificationId: existing.id, reason: "Já notificado (idempotência)" };
    }

    const periodLabel = scheduledPeriod === "MANHA" ? "manhã" : "tarde";
    const dateFormatted = (() => {
      try {
        return new Date(scheduledDate + "T12:00:00").toLocaleDateString("pt-BR", {
          weekday: "long", day: "2-digit", month: "long",
        });
      } catch {
        return scheduledDate;
      }
    })();

    const title = "Nova montagem agendada";
    const body = `Pedido ${numped} — ${customerName}\n${dateFormatted} (${periodLabel})\nAcesse o app para ver detalhes.`;

    // Real channel dispatch (only when feature flags enabled)
    // ENABLE_PROVIDER_WHATSAPP_NOTIFICATIONS=true → send via WhatsApp provider
    // ENABLE_PROVIDER_PUSH_NOTIFICATIONS=true → send push notification
    // Both flags false → DRY_RUN only (system policy default)
    const isDryRun = !features.providerWhatsAppNotifications && !features.providerPushNotifications;

    const notificationId = uuid();
    await execDml(
      `INSERT INTO MONT_PROVIDER_NOTIFICATIONS
         (ID, PROVIDER_ID, TYPE, TITLE, BODY, ASSEMBLY_JOB_ID, NUMPED, IDEMPOTENCY_KEY, DRY_RUN, CREATED_AT)
       VALUES
         (:id, :providerId, :type, :title, :body, :assemblyJobId, :numped, :key, :dryRun, SYSTIMESTAMP)`,
      {
        id: notificationId,
        providerId,
        type: "NOVA_MONTAGEM_AGENDADA_MONTADOR" satisfies ProviderNotificationType,
        title,
        body,
        assemblyJobId,
        numped,
        key: idempotencyKey,
        dryRun: isDryRun ? 1 : 0,
      },
    );

    if (isDryRun) {
      return { status: "SIMULADO_DRY_RUN", notificationId };
    }

    // WhatsApp channel (configure WHATSAPP_API_URL + WHATSAPP_API_TOKEN to activate)
    if (features.providerWhatsAppNotifications) {
      const apiUrl  = process.env.WHATSAPP_API_URL;
      const apiToken = process.env.WHATSAPP_API_TOKEN;
      if (apiUrl && apiToken) {
        try {
          await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` },
            body: JSON.stringify({ to: phone.replace(/\D/g, ""), message: `${title}\n\n${body}` }),
          });
          await execDml(
            "UPDATE MONT_PROVIDER_NOTIFICATIONS SET SENT_AT = SYSTIMESTAMP WHERE ID = :id",
            { id: notificationId },
          );
        } catch (err) {
          console.error("[ProviderNotification] WhatsApp send error:", err);
        }
      } else {
        console.warn("[ProviderNotification] WHATSAPP_API_URL/TOKEN não configurados — notificação não enviada.");
      }
    }

    return { status: "CRIADO", notificationId };
  }

  async listForProvider(providerId: string, unreadOnly = false): Promise<unknown[]> {
    const where = unreadOnly
      ? "WHERE PROVIDER_ID = :id AND READ_AT IS NULL"
      : "WHERE PROVIDER_ID = :id";
    return queryRows(
      `SELECT ID, TYPE, TITLE, BODY, NUMPED, ASSEMBLY_JOB_ID, READ_AT, DRY_RUN, CREATED_AT
       FROM MONT_PROVIDER_NOTIFICATIONS
       ${where}
       ORDER BY CREATED_AT DESC
       FETCH FIRST 50 ROWS ONLY`,
      { id: providerId },
    );
  }

  async markRead(notificationId: string, providerId: string): Promise<boolean> {
    const row = await queryOne<{ id: string }>(
      "SELECT ID FROM MONT_PROVIDER_NOTIFICATIONS WHERE ID = :id AND PROVIDER_ID = :prov AND READ_AT IS NULL",
      { id: notificationId, prov: providerId },
    );
    if (!row) return false;
    await execDml(
      "UPDATE MONT_PROVIDER_NOTIFICATIONS SET READ_AT = SYSTIMESTAMP WHERE ID = :id",
      { id: notificationId },
    );
    return true;
  }

  async unreadCount(providerId: string): Promise<number> {
    const row = await queryOne<{ cnt: number }>(
      "SELECT COUNT(*) AS CNT FROM MONT_PROVIDER_NOTIFICATIONS WHERE PROVIDER_ID = :id AND READ_AT IS NULL",
      { id: providerId },
    );
    return Number(row?.cnt ?? 0);
  }
}
