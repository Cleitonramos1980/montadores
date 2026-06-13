import { v4 as uuid } from "uuid";
import { execDml, queryOne, queryRows } from "../db/db";

export type MessageLogStatus =
  | "SIMULADO_DRY_RUN"
  | "ENVIADO"
  | "ERRO"
  | "IGNORADO_DUPLICIDADE"
  | "IGNORADO_EVENTO_INATIVO"
  | "IGNORADO_SEM_TELEFONE"
  | "IGNORADO_FORA_DO_MODELO"
  | "IGNORADO_TEMPLATE_INATIVO"
  | "IGNORADO_REGRA_NAO_VALIDADA"
  | "IGNORADO_SEM_PRODUTO_COMISSAO_MONTAGEM";

export type MessageLogEntry = {
  numped: string;
  codcli: string;
  eventKey: string;
  templateId?: string | null;
  destino?: string | null;
  canal?: string;
  status: MessageLogStatus;
  payload?: Record<string, unknown>;
  erro?: string | null;
  idempotencyKey?: string | null;
  modoEnvio: string;
};

export type MessageLogFilters = {
  numped?: string;
  eventKey?: string;
  status?: string;
  page?: number;
  pageSize?: number;
};

export class MessageLogService {
  async log(entry: MessageLogEntry): Promise<{ id: string; duplicate: boolean }> {
    const id = uuid();
    try {
      await execDml(
        `INSERT INTO MONT_MESSAGE_LOGS
         (ID, NUMPED, CODCLI, EVENT_KEY, TEMPLATE_ID, DESTINO, CANAL,
          STATUS, PAYLOAD, ERRO, IDEMPOTENCY_KEY, MODO_ENVIO, ENVIADO_EM, CRIADO_EM)
         VALUES
         (:id, :numped, :codcli, :eventKey, :templateId, :destino, :canal,
          :status, :payload, :erro, :idempotencyKey, :modoEnvio,
          CASE WHEN :status2 = 'ENVIADO' THEN SYSTIMESTAMP ELSE NULL END,
          SYSTIMESTAMP)`,
        {
          id,
          numped:        entry.numped,
          codcli:        entry.codcli,
          eventKey:      entry.eventKey,
          templateId:    entry.templateId ?? null,
          destino:       entry.destino ?? null,
          canal:         entry.canal ?? "WHATSAPP",
          status:        entry.status,
          payload:       entry.payload ? JSON.stringify(entry.payload) : null,
          erro:          entry.erro ?? null,
          idempotencyKey: entry.idempotencyKey ?? null,
          modoEnvio:     entry.modoEnvio,
          status2:       entry.status,
        },
      );
      return { id, duplicate: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ORA-00001") || msg.includes("unique constraint")) {
        return { id: "", duplicate: true };
      }
      throw err;
    }
  }

  async checkIdempotency(idempotencyKey: string): Promise<boolean> {
    const row = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) AS CNT FROM MONT_MESSAGE_LOGS
       WHERE IDEMPOTENCY_KEY = :key AND STATUS = 'ENVIADO'`,
      { key: idempotencyKey },
    );
    return Number(row?.cnt ?? 0) > 0;
  }

  async list(filters: MessageLogFilters = {}): Promise<{ rows: unknown[]; total: number }> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const where: string[] = [];
    const whereBind: Record<string, unknown> = {};

    if (filters.numped)   { where.push("NUMPED = :numped");      whereBind.numped    = filters.numped; }
    if (filters.eventKey) { where.push("EVENT_KEY = :eventKey"); whereBind.eventKey  = filters.eventKey; }
    if (filters.status)   { where.push("STATUS = :status");      whereBind.status    = filters.status; }

    const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
    const listBind = { ...whereBind, offset, pageSize };

    const [rows, countRow] = await Promise.all([
      queryRows(
        `SELECT ID, NUMPED, CODCLI, EVENT_KEY, TEMPLATE_ID, DESTINO, CANAL,
                STATUS, ERRO, IDEMPOTENCY_KEY, MODO_ENVIO, ENVIADO_EM, CRIADO_EM
         FROM MONT_MESSAGE_LOGS
         ${whereClause}
         ORDER BY CRIADO_EM DESC
         OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY`,
        listBind,
      ),
      queryOne<{ total: number }>(
        `SELECT COUNT(*) AS TOTAL FROM MONT_MESSAGE_LOGS ${whereClause}`,
        whereBind,
      ),
    ]);

    return { rows, total: Number(countRow?.total ?? 0) };
  }

  async getById(id: string): Promise<unknown> {
    return queryOne(
      "SELECT * FROM MONT_MESSAGE_LOGS WHERE ID = :id",
      { id },
    );
  }
}
