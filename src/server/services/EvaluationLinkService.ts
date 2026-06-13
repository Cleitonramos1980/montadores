import { randomBytes } from "node:crypto";
import { v4 as uuid } from "uuid";
import { execDml, queryOne } from "../db/db";
import { EvaluationConfigService } from "./EvaluationConfigService";

export type EvalLinkInfo = {
  linkId: string;
  token: string;
  phase: string;
  numped: string | null;
  configId: string;
  expiresAt: Date;
  usedAt: Date | null;
  config: {
    title: string;
    description: string | null;
    questions: Array<{
      id: string;
      position: number;
      type: string;
      label: string;
      required: boolean;
      minLabel: string | null;
      maxLabel: string | null;
      options: string[] | null;
    }>;
  };
  order: {
    numped: string | null;
    customerName: string | null;
  };
};

export class EvaluationLinkService {
  constructor(private readonly evalConfigs = new EvaluationConfigService()) {}

  async generate(params: {
    phase: string;
    orderId?: string;
    assemblyJobId?: string;
    numped?: string;
    codcli?: string;
    userId?: string;
  }): Promise<{ linkId: string; token: string; url: string }> {
    const config = await this.evalConfigs.getByPhase(params.phase);
    if (!config) {
      throw new Error(`Não há configuração de avaliação ativa para a fase ${params.phase}. Configure primeiro em Avaliações > Configuração.`);
    }
    if (!config.active) {
      throw new Error(`Configuração de avaliação para a fase ${params.phase} está inativa.`);
    }

    const token = randomBytes(32).toString("hex");
    const linkId = uuid();
    const expiresAt = new Date(Date.now() + config.linkTtlDays * 24 * 60 * 60 * 1000);

    await execDml(
      `INSERT INTO MONT_EVAL_LINKS
         (ID, TOKEN, CONFIG_ID, ORDER_ID, ASSEMBLY_JOB_ID, NUMPED, CODCLI, PHASE, EXPIRES_AT, CREATED_BY)
       VALUES
         (:id, :token, :configId, :orderId, :assemblyJobId, :numped, :codcli, :phase,
          :expiresAt, :userId)`,
      {
        id: linkId,
        token,
        configId: config.id,
        orderId: params.orderId ?? null,
        assemblyJobId: params.assemblyJobId ?? null,
        numped: params.numped ?? null,
        codcli: params.codcli ?? null,
        phase: params.phase,
        expiresAt: expiresAt.toISOString(),
        userId: params.userId ?? null,
      },
    );

    return { linkId, token, url: `/montadores/eval/${token}` };
  }

  async getByToken(token: string): Promise<EvalLinkInfo | null> {
    const link = await queryOne<any>(
      `SELECT ID, TOKEN, CONFIG_ID, ORDER_ID, ASSEMBLY_JOB_ID, NUMPED, CODCLI,
              PHASE, EXPIRES_AT, USED_AT
       FROM MONT_EVAL_LINKS WHERE TOKEN = :token`,
      { token },
    );
    if (!link) return null;

    const config = await this.evalConfigs.getById(link.config_id as string);
    if (!config) return null;

    const customerName = await this._resolveCustomerName(
      link.order_id as string | null,
      link.codcli as string | null,
    );

    return {
      linkId: link.id as string,
      token: link.token as string,
      phase: link.phase as string,
      numped: link.numped as string | null,
      configId: link.config_id as string,
      expiresAt: new Date(link.expires_at as string),
      usedAt: link.used_at ? new Date(link.used_at as string) : null,
      config: {
        title: config.title,
        description: config.description ?? null,
        questions: (config.questions ?? []).map((q) => ({
          id: q.id,
          position: q.position,
          type: q.type,
          label: q.label,
          required: q.required,
          minLabel: q.minLabel,
          maxLabel: q.maxLabel,
          options: q.options,
        })),
      },
      order: {
        numped: link.numped as string | null,
        customerName,
      },
    };
  }

  async markUsed(linkId: string): Promise<void> {
    await execDml(
      "UPDATE MONT_EVAL_LINKS SET USED_AT = SYSTIMESTAMP WHERE ID = :id AND USED_AT IS NULL",
      { id: linkId },
    );
  }

  private async _resolveCustomerName(
    orderId: string | null,
    codcli: string | null,
  ): Promise<string | null> {
    if (orderId) {
      const order = await queryOne<{ customer_id: string }>(
        "SELECT CUSTOMER_ID FROM MONT_ORDERS WHERE ID = :id",
        { id: orderId },
      );
      if (order?.customer_id) {
        const cust = await queryOne<{ name: string }>(
          "SELECT NAME FROM MONT_CUSTOMERS WHERE ID = :id",
          { id: order.customer_id },
        );
        if (cust?.name) return cust.name;
      }
    }
    if (codcli) {
      const cust = await queryOne<{ name: string }>(
        "SELECT NAME FROM MONT_CUSTOMERS WHERE CODCLI = :codcli",
        { codcli },
      ).catch(() => null);
      if (cust?.name) return cust.name;
    }
    return null;
  }
}
