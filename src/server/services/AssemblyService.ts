import { v4 as uuid } from "uuid";
import { execDml, queryOne, withTransaction } from "../db/db";
import { AppError, ForbiddenError } from "../errors";
import { canTransition, type AssemblyStatus } from "./AssemblyStateMachine";
import { EventService } from "./EventService";

export class AssemblyService {
  constructor(private readonly events = new EventService()) {}

  // requestingProviderId: pass the caller's provider ID when user is MONTADOR.
  // Pass null to skip ownership check (ADMIN / GESTOR callers).
  async start(jobId: string, requestingProviderId: string | null = null) {
    const job = await queryOne<{ id: string; order_id: string; numped: string; codcli: string; provider_id: string; status: string }>(
      `SELECT a.ID, a.ORDER_ID, a.PROVIDER_ID, a.STATUS, o.NUMPED, o.CODCLI
       FROM MONT_ASSEMBLY_JOBS a
       JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
       WHERE a.ID = :jobId`,
      { jobId },
    );
    if (!job) throw new AppError("Montagem não encontrada.", 404, "NOT_FOUND");
    if (requestingProviderId !== null && job.provider_id !== requestingProviderId) {
      throw new ForbiddenError("Você não tem permissão para operar esta montagem.");
    }
    // Só pode iniciar uma montagem AGENDADA (impede reabrir uma já em execução/finalizada).
    // Guarda centralizada na máquina de estados (AGENDADA → EM_EXECUCAO).
    if (!canTransition(job.status as AssemblyStatus, "EM_EXECUCAO")) {
      throw new AppError(`Montagem no estado ${job.status} não pode ser iniciada.`, 409, "CONFLICT");
    }

    // Atômico: status do job + status do pedido gravam juntos.
    await withTransaction(async (tx) => {
      await tx.exec(
        "UPDATE MONT_ASSEMBLY_JOBS SET STATUS = 'EM_EXECUCAO', STARTED_AT = SYSTIMESTAMP, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id AND STATUS = 'AGENDADA'",
        { id: jobId },
      );
      await tx.exec(
        "UPDATE MONT_ORDERS SET CURRENT_STATUS = 'MONTAGEM_INICIADA', UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
        { id: job.order_id },
      );
    });

    await this.events.emit({
      type: "MONTAGEM_INICIADA",
      orderId: job.order_id,
      numped: job.numped,
      codcli: job.codcli,
      assemblyId: jobId,
      providerId: job.provider_id,
      origin: "MONTADOR",
      metadata: { description: "Montador iniciou a execução.", visibleToCustomer: true },
      idempotencyKey: `montagem-iniciada:${jobId}`,
    });

    return { jobId, status: "EM_EXECUCAO" };
  }

  async addPhoto(jobId: string, fileUrl: string, photoType = "EVIDENCIA", requestingProviderId: string | null = null) {
    const job = await queryOne<{ order_id: string; numped: string; codcli: string; provider_id: string }>(
      `SELECT a.ORDER_ID, a.PROVIDER_ID, o.NUMPED, o.CODCLI
       FROM MONT_ASSEMBLY_JOBS a
       JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
       WHERE a.ID = :jobId`,
      { jobId },
    );
    if (!job) throw new AppError("Montagem não encontrada.", 404, "NOT_FOUND");
    if (requestingProviderId !== null && job.provider_id !== requestingProviderId) {
      throw new ForbiddenError("Você não tem permissão para operar esta montagem.");
    }

    const photoId = uuid();
    await execDml(
      "INSERT INTO MONT_ASSEMBLY_PHOTOS (ID, ASSEMBLY_JOB_ID, FILE_URL, PHOTO_TYPE) VALUES (:id, :jobId, :fileUrl, :photoType)",
      { id: photoId, jobId, fileUrl, photoType },
    );

    await this.events.emit({
      type: "FOTOS_MONTAGEM_ANEXADAS",
      orderId: job.order_id,
      numped: job.numped,
      codcli: job.codcli,
      assemblyId: jobId,
      providerId: job.provider_id,
      origin: "MONTADOR",
      metadata: { description: "Foto obrigatória anexada.", fileUrl },
      idempotencyKey: `foto:${jobId}:${fileUrl}`,
    });

    return { photoId };
  }

  async finish(jobId: string, requestingProviderId: string | null = null) {
    const job = await queryOne<{ id: string; order_id: string; numped: string; codcli: string; provider_id: string; status: string }>(
      `SELECT a.ID, a.ORDER_ID, a.PROVIDER_ID, a.STATUS, o.NUMPED, o.CODCLI
       FROM MONT_ASSEMBLY_JOBS a
       JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
       WHERE a.ID = :jobId`,
      { jobId },
    );
    if (!job) throw new AppError("Montagem não encontrada.", 404, "NOT_FOUND");
    if (requestingProviderId !== null && job.provider_id !== requestingProviderId) {
      throw new ForbiddenError("Você não tem permissão para operar esta montagem.");
    }
    // Só finaliza uma montagem EM_EXECUCAO. Impede refinalizar (que regrediria o
    // pagamento já bloqueado/liberado/pago de volta a AGUARDANDO_AVALIACAO_CLIENTE).
    // Guarda centralizada na máquina de estados (EM_EXECUCAO → FINALIZADA).
    if (!canTransition(job.status as AssemblyStatus, "FINALIZADA")) {
      throw new AppError(`Montagem no estado ${job.status} não pode ser finalizada.`, 409, "CONFLICT");
    }

    const photos = await queryOne<{ value: number }>(
      "SELECT COUNT(*) AS VALUE FROM MONT_ASSEMBLY_PHOTOS WHERE ASSEMBLY_JOB_ID = :jobId",
      { jobId },
    );
    if (Number(photos?.value ?? 0) < 1) throw new Error("Montagem não pode ser finalizada sem fotos obrigatórias.");

    // Atômico. O UPDATE do pagamento é condicional (só do estado inicial) para NUNCA
    // reverter um pagamento já bloqueado por SAC/avaliação, liberado ou pago.
    await withTransaction(async (tx) => {
      await tx.exec(
        "UPDATE MONT_ASSEMBLY_JOBS SET STATUS = 'FINALIZADA', FINISHED_AT = SYSTIMESTAMP, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id AND STATUS = 'EM_EXECUCAO'",
        { id: jobId },
      );
      await tx.exec(
        "UPDATE MONT_PROVIDER_PAYMENTS SET STATUS = 'AGUARDANDO_AVALIACAO_CLIENTE', UPDATED_AT = SYSTIMESTAMP WHERE ASSEMBLY_JOB_ID = :jobId AND STATUS = 'AGUARDANDO_FINALIZACAO'",
        { jobId },
      );
      await tx.exec(
        "UPDATE MONT_ORDERS SET CURRENT_STATUS = 'MONTAGEM_FINALIZADA', UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
        { id: job.order_id },
      );
    });

    await this.events.emit({
      type: "MONTAGEM_FINALIZADA",
      orderId: job.order_id,
      numped: job.numped,
      codcli: job.codcli,
      assemblyId: jobId,
      providerId: job.provider_id,
      origin: "MONTADOR",
      metadata: { description: "Montagem finalizada com evidências fotográficas.", visibleToCustomer: true },
      idempotencyKey: `montagem-finalizada:${jobId}`,
    });

    return { jobId, status: "FINALIZADA" };
  }
}
