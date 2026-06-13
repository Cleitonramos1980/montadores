import { v4 as uuid } from "uuid";
import { execDml, queryOne } from "../db/db";
import { EventService } from "./EventService";

export class AssemblyService {
  constructor(private readonly events = new EventService()) {}

  async start(jobId: string) {
    const job = await queryOne<{ id: string; order_id: string; numped: string; codcli: string; provider_id: string }>(
      `SELECT a.ID, a.ORDER_ID, a.PROVIDER_ID, o.NUMPED, o.CODCLI
       FROM MONT_ASSEMBLY_JOBS a
       JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
       WHERE a.ID = :jobId`,
      { jobId },
    );
    if (!job) throw new Error("Montagem não encontrada.");

    await execDml(
      "UPDATE MONT_ASSEMBLY_JOBS SET STATUS = 'EM_EXECUCAO', STARTED_AT = SYSTIMESTAMP, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
      { id: jobId },
    );

    await execDml(
      "UPDATE MONT_ORDERS SET CURRENT_STATUS = 'MONTAGEM_INICIADA', UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
      { id: job.order_id },
    );

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

  async addPhoto(jobId: string, fileUrl: string, photoType = "EVIDENCIA") {
    const photoId = uuid();
    await execDml(
      "INSERT INTO MONT_ASSEMBLY_PHOTOS (ID, ASSEMBLY_JOB_ID, FILE_URL, PHOTO_TYPE) VALUES (:id, :jobId, :fileUrl, :photoType)",
      { id: photoId, jobId, fileUrl, photoType },
    );

    const job = await queryOne<{ order_id: string; numped: string; codcli: string; provider_id: string }>(
      `SELECT a.ORDER_ID, a.PROVIDER_ID, o.NUMPED, o.CODCLI
       FROM MONT_ASSEMBLY_JOBS a
       JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
       WHERE a.ID = :jobId`,
      { jobId },
    );

    if (job) {
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
    }

    return { photoId };
  }

  async finish(jobId: string) {
    const photos = await queryOne<{ value: number }>(
      "SELECT COUNT(*) AS VALUE FROM MONT_ASSEMBLY_PHOTOS WHERE ASSEMBLY_JOB_ID = :jobId",
      { jobId },
    );
    if (Number(photos?.value ?? 0) < 2) throw new Error("Adicione ao menos 2 fotos de evidência antes de finalizar.");

    const job = await queryOne<{ id: string; order_id: string; numped: string; codcli: string; provider_id: string }>(
      `SELECT a.ID, a.ORDER_ID, a.PROVIDER_ID, o.NUMPED, o.CODCLI
       FROM MONT_ASSEMBLY_JOBS a
       JOIN MONT_ORDERS o ON o.ID = a.ORDER_ID
       WHERE a.ID = :jobId`,
      { jobId },
    );
    if (!job) throw new Error("Montagem não encontrada.");

    await execDml(
      "UPDATE MONT_ASSEMBLY_JOBS SET STATUS = 'FINALIZADA', FINISHED_AT = SYSTIMESTAMP, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
      { id: jobId },
    );
    await execDml(
      "UPDATE MONT_PROVIDER_PAYMENTS SET STATUS = 'AGUARDANDO_AVALIACAO_CLIENTE', UPDATED_AT = SYSTIMESTAMP WHERE ASSEMBLY_JOB_ID = :jobId",
      { jobId },
    );
    await execDml(
      "UPDATE MONT_ORDERS SET CURRENT_STATUS = 'MONTAGEM_FINALIZADA', UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
      { id: job.order_id },
    );

    // Auto-recalculate commission based on PCPEDI items
    const paymentRow = await queryOne<{ id: string }>(
      "SELECT ID FROM MONT_PROVIDER_PAYMENTS WHERE ASSEMBLY_JOB_ID = :jobId",
      { jobId },
    );
    if (paymentRow) {
      try {
        const { CommissionCalculationService } = await import("./CommissionCalculationService");
        await new CommissionCalculationService().calculateForPayment(paymentRow.id);
      } catch (err) {
        console.warn(`[AssemblyService] Comissão não calculada: ${(err as Error).message}`);
      }
    }

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
