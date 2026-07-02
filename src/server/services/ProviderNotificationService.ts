import { v4 as uuid } from "uuid";
import { execDml, queryOne, queryRows } from "../db/db";
import { features } from "../config";
import { WhatsAppProviderService, normalizePhone } from "./WhatsAppProviderService";

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

    // ── HOMOLOGACAO / DRY_RUN guard ─────────────────────────────────────────
    // Aplica a mesma trava de destino forçado do MessageTriggerService.
    // NUNCA chama o provider com o telefone real do montador em modo controlado.
    const globalModeRow = await queryOne<{ config_value: string }>(
      "SELECT CONFIG_VALUE FROM MONT_SYNC_CONFIG WHERE CONFIG_KEY = 'MESSAGE_TRIGGER_MODE'",
    ).catch(() => null);
    const globalMode = globalModeRow?.config_value ?? "DRY_RUN";

    // Feature flags + modo global determinam o que acontece
    const isDryRun =
      globalMode === "DRY_RUN" ||
      (!features.providerWhatsAppNotifications && !features.providerPushNotifications);

    let effectiveTo: string | null = null;
    let modoEnvio = "DRY_RUN";

    if (!isDryRun) {
      if (globalMode === "HOMOLOGACAO") {
        // Redireciona para CODCLI 347818 — bloqueia telefone original do montador
        const pilotCfg = await queryOne<{ config_value: string }>(
          "SELECT CONFIG_VALUE FROM MONT_SYNC_CONFIG WHERE CONFIG_KEY = 'HOMOLOGACAO_PILOT_PHONE'",
        ).catch(() => null);
        effectiveTo = pilotCfg?.config_value?.trim() ?? null;
        modoEnvio   = "HOMOLOGACAO";
        if (!effectiveTo) {
          console.warn("[ProviderNotification] HOMOLOGACAO sem HOMOLOGACAO_PILOT_PHONE configurado — simulando");
          modoEnvio = "DRY_RUN";
        }
      } else {
        // PRODUCAO: usa o telefone real do montador
        effectiveTo = normalizePhone(phone);
        modoEnvio   = "PRODUCAO";
      }
    }

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
        dryRun: modoEnvio !== "PRODUCAO" ? 1 : 0,
      },
    );

    if (modoEnvio === "DRY_RUN" || !effectiveTo) {
      return { status: "SIMULADO_DRY_RUN", notificationId };
    }

    // WhatsApp channel — effectiveTo já é o destino autorizado (original ou 347818)
    if (features.providerWhatsAppNotifications && effectiveTo) {
      const msgText =
        modoEnvio === "HOMOLOGACAO"
          ? `[TESTE MONTADOR — HOMOLOGAÇÃO]\nMontador original NÃO recebeu.\n────────────────\n${title}\n\n${body}`
          : `${title}\n\n${body}`;

      const wp = new WhatsAppProviderService();
      const result = await wp.send({ to: effectiveTo, text: msgText, modo: "PRODUCAO" });
      if (result.status === "ENVIADO") {
        await execDml(
          "UPDATE MONT_PROVIDER_NOTIFICATIONS SET SENT_AT = SYSTIMESTAMP WHERE ID = :id",
          { id: notificationId },
        );
      } else {
        console.error(`[ProviderNotification] WhatsApp send error (${modoEnvio}): ${result.error ?? result.status}`);
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
