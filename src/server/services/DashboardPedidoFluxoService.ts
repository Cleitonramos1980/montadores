import { queryRows, queryOne } from "../db/db";
import { OrderSnapshotService } from "./OrderSnapshotService";

export class DashboardPedidoFluxoService {
  constructor(private readonly snapshots = new OrderSnapshotService()) {}

  async getSummary() {
    const [phaseCounts, eventConfigs, lastRun] = await Promise.all([
      this.snapshots.dashboardSummary(),
      queryRows<{ event_key: string; label: string; ativo_dashboard: number; ativo_mensagem: number; modo_envio: string }>(
        `SELECT EVENT_KEY, LABEL, ATIVO_DASHBOARD, ATIVO_MENSAGEM, MODO_ENVIO
         FROM MONT_FLUXO_EVENT_CONFIG
         ORDER BY EVENT_KEY`,
      ),
      queryOne<{ iniciado_em: Date; pedidos_encontrados: number; eventos_gerados: number; msgs_simuladas: number; msgs_enviadas: number; run_status: string }>(
        `SELECT INICIADO_EM, PEDIDOS_ENCONTRADOS, EVENTOS_GERADOS,
                MSGS_SIMULADAS, MSGS_ENVIADAS, RUN_STATUS
         FROM MONT_SYNC_RUNS
         ORDER BY INICIADO_EM DESC
         FETCH FIRST 1 ROW ONLY`,
      ),
    ]);

    const configByKey = Object.fromEntries(eventConfigs.map((e) => [e.event_key, e]));

    return {
      phases: phaseCounts.map((p) => ({
        ...p,
        ativoDashboard: Number(configByKey[p.key]?.ativo_dashboard ?? 1) === 1,
        ativoMensagem:  Number(configByKey[p.key]?.ativo_mensagem  ?? 0) === 1,
        modoEnvio:      configByKey[p.key]?.modo_envio ?? "DRY_RUN",
      })),
      lastRun: lastRun ?? null,
    };
  }

  async getByPhase(key: string, page: number, pageSize: number) {
    return this.snapshots.listByPhase(key, page, pageSize);
  }

  async getByNumped(numped: string) {
    return this.snapshots.getDetail(numped);
  }

  async getEventConfigs() {
    return queryRows<{
      event_key: string;
      label: string;
      ativo_dashboard: number;
      ativo_mensagem: number;
      modo_envio: string;
      telefones_teste: string | null;
      observacao: string | null;
      atualizado_em: Date;
    }>(
      `SELECT EVENT_KEY, LABEL, ATIVO_DASHBOARD, ATIVO_MENSAGEM, MODO_ENVIO,
              TELEFONES_TESTE, OBSERVACAO, ATUALIZADO_EM
       FROM MONT_FLUXO_EVENT_CONFIG
       ORDER BY EVENT_KEY`,
    );
  }

  async updateEventConfig(
    key: string,
    patch: {
      ativo_dashboard?: number;
      ativo_mensagem?: number;
      modo_envio?: string;
      telefones_teste?: string;
      observacao?: string;
    },
  ): Promise<void> {
    const setClauses: string[] = [];
    const binds: Record<string, unknown> = { key };

    if (patch.ativo_dashboard !== undefined) { setClauses.push("ATIVO_DASHBOARD = :ativoDashboard"); binds.ativoDashboard = patch.ativo_dashboard; }
    if (patch.ativo_mensagem  !== undefined) { setClauses.push("ATIVO_MENSAGEM = :ativoMensagem");   binds.ativoMensagem  = patch.ativo_mensagem; }
    if (patch.modo_envio      !== undefined) { setClauses.push("MODO_ENVIO = :modoEnvio");           binds.modoEnvio      = patch.modo_envio; }
    if (patch.telefones_teste !== undefined) { setClauses.push("TELEFONES_TESTE = :telesTeste");     binds.telesTeste     = patch.telefones_teste; }
    if (patch.observacao      !== undefined) { setClauses.push("OBSERVACAO = :observacao");          binds.observacao     = patch.observacao; }

    if (setClauses.length === 0) return;
    setClauses.push("ATUALIZADO_EM = SYSTIMESTAMP");

    const { execDml } = await import("../db/db");
    await execDml(
      `UPDATE MONT_FLUXO_EVENT_CONFIG SET ${setClauses.join(", ")} WHERE EVENT_KEY = :key`,
      binds,
    );
  }
}
