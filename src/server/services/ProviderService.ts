import { v4 as uuid } from "uuid";
import { AppError } from "../errors";
import { execDml, queryOne, queryRows } from "../db/db";
import { json } from "../db/database";
import { isOracleEnabled } from "../db/oracle";
import { WinthorAdapter } from "../oracle/WinthorAdapter";
import { AuditService } from "./AuditService";

export class ProviderService {
  constructor(private readonly audit = new AuditService()) {}

  async register(input: Record<string, unknown>) {
    const id = uuid();

    // If no codfornec was provided and Oracle is available, insert into PCFORNEC
    let codfornec = input.codfornec ? String(input.codfornec) : null;
    if (!codfornec && isOracleEnabled()) {
      try {
        const wt = new WinthorAdapter();
        const newCode = await wt.insertSupplier({
          fornecedor: String(input.name ?? ""),
          fantasia:   input.tradeName  ? String(input.tradeName)  : undefined,
          cgc:        input.document   ? String(input.document).replace(/\D/g, "") : undefined,
          cidade:     input.city       ? String(input.city)       : undefined,
          estado:     input.uf         ? String(input.uf)         : undefined,
          cep:        input.cep        ? String(input.cep)        : undefined,
          telrep:     input.phone      ? String(input.phone).replace(/\D/g, "") : undefined,
          email:      input.email      ? String(input.email)      : undefined,
        });
        codfornec = String(newCode);
        console.log(`[ProviderService] Fornecedor inserido na PCFORNEC com CODFORNEC=${newCode}`);
      } catch (err) {
        // Non-fatal: PCFORNEC insert failure should not block MONT_PROVIDERS registration
        console.warn("[ProviderService] Falha ao inserir na PCFORNEC:", err instanceof Error ? err.message : err);
      }
    }

    await execDml(
      `INSERT INTO MONT_PROVIDERS
       (ID, NAME, DOCUMENT, PHONE, WHATSAPP, EMAIL, CITY, UF,
        REGIONS_JSON, SERVICE_TYPES_JSON, PRODUCT_TYPES_JSON, AVAILABILITY_JSON,
        CAPACITY_PER_DAY, STATUS, ACTIVE, CODFORNEC, PIX_KEY, PIX_KEY_TYPE)
       VALUES (:id, :name, :document, :phone, :whatsapp, :email, :city, :uf,
               :regions, :serviceTypes, :productTypes, :availability,
               :capacity, 'AGUARDANDO_ANALISE', 0, :codfornec, :pixKey, :pixKeyType)`,
      {
        id,
        name:         input.name,
        document:     input.document,
        phone:        input.phone,
        whatsapp:     input.whatsapp ?? input.phone,
        email:        input.email    ?? null,
        city:         input.city     ?? null,
        uf:           input.uf       ?? null,
        regions:      json(input.regions      ?? []),
        serviceTypes: json(input.serviceTypes ?? []),
        productTypes: json(input.productTypes ?? []),
        availability: json(input.availability ?? {}),
        capacity:     input.capacityPerDay ?? 1,
        codfornec,
        pixKey:     input.pixKey     ?? null,
        pixKeyType: input.pixKeyType ?? null,
      },
    );
    await this.audit.log({ action: "PROVIDER_REGISTERED", entityType: "provider", entityId: id, next: { ...input, codfornec } });
    return { id, codfornec };
  }

  async list() {
    return queryRows("SELECT * FROM MONT_PROVIDERS ORDER BY CREATED_AT DESC");
  }

  async approve(id: string, userId: string | undefined, justification: string) {
    const previous = await queryOne("SELECT * FROM MONT_PROVIDERS WHERE ID = :id", { id });
    await execDml(
      "UPDATE MONT_PROVIDERS SET STATUS = 'APROVADO', ACTIVE = 1, DOCUMENTS_VALIDATED = 1, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
      { id },
    );
    await execDml(
      "INSERT INTO MONT_PROVIDER_APPROVAL_LOGS (ID, PROVIDER_ID, ACTION, JUSTIFICATION, USER_ID) VALUES (:logId, :id, 'APROVADO', :justification, :userId)",
      { logId: uuid(), id, justification, userId: userId ?? null },
    );
    await this.audit.log({ actorUserId: userId, action: "PROVIDER_APPROVED", entityType: "provider", entityId: id, previous, next: { status: "APROVADO" }, justification });
    return { id, status: "APROVADO" };
  }

  async reject(id: string, userId: string | undefined, justification: string) {
    const previous = await queryOne("SELECT * FROM MONT_PROVIDERS WHERE ID = :id", { id });
    await execDml(
      "UPDATE MONT_PROVIDERS SET STATUS = 'REPROVADO', ACTIVE = 0, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
      { id },
    );
    await execDml(
      "INSERT INTO MONT_PROVIDER_APPROVAL_LOGS (ID, PROVIDER_ID, ACTION, JUSTIFICATION, USER_ID) VALUES (:logId, :id, 'REPROVADO', :justification, :userId)",
      { logId: uuid(), id, justification, userId: userId ?? null },
    );
    await this.audit.log({ actorUserId: userId, action: "PROVIDER_REJECTED", entityType: "provider", entityId: id, previous, next: { status: "REPROVADO" }, justification });
    return { id, status: "REPROVADO" };
  }

  async suspend(id: string, userId: string | undefined, justification: string) {
    if (!justification?.trim()) throw new Error("Justificativa obrigatória para suspensão.");
    const previous = await queryOne("SELECT * FROM MONT_PROVIDERS WHERE ID = :id", { id });
    if (!previous) throw new AppError("Montador não encontrado.", 404, "NOT_FOUND");
    await execDml(
      "UPDATE MONT_PROVIDERS SET STATUS = 'SUSPENSO', ACTIVE = 0, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
      { id },
    );
    await execDml(
      "INSERT INTO MONT_PROVIDER_APPROVAL_LOGS (ID, PROVIDER_ID, ACTION, JUSTIFICATION, USER_ID) VALUES (:logId, :id, 'SUSPENSO', :justification, :userId)",
      { logId: uuid(), id, justification, userId: userId ?? null },
    );
    await this.audit.log({ actorUserId: userId, action: "PROVIDER_SUSPENDED", entityType: "provider", entityId: id, previous, next: { status: "SUSPENSO" }, justification });
    return { id, status: "SUSPENSO" };
  }

  async reactivate(id: string, userId: string | undefined, justification: string) {
    if (!justification?.trim()) throw new Error("Justificativa obrigatória para reativação.");
    const previous = await queryOne("SELECT STATUS FROM MONT_PROVIDERS WHERE ID = :id", { id });
    if (!previous) throw new AppError("Montador não encontrado.", 404, "NOT_FOUND");
    await execDml(
      "UPDATE MONT_PROVIDERS SET STATUS = 'APROVADO', ACTIVE = 1, UPDATED_AT = SYSTIMESTAMP WHERE ID = :id",
      { id },
    );
    await execDml(
      "INSERT INTO MONT_PROVIDER_APPROVAL_LOGS (ID, PROVIDER_ID, ACTION, JUSTIFICATION, USER_ID) VALUES (:logId, :id, 'REATIVADO', :justification, :userId)",
      { logId: uuid(), id, justification, userId: userId ?? null },
    );
    await this.audit.log({ actorUserId: userId, action: "PROVIDER_REACTIVATED", entityType: "provider", entityId: id, previous, next: { status: "APROVADO" }, justification });
    return { id, status: "APROVADO" };
  }

  async getById(id: string) {
    const provider = await queryOne("SELECT * FROM MONT_PROVIDERS WHERE ID = :id", { id });
    if (!provider) throw new AppError("Montador não encontrado.", 404, "NOT_FOUND");
    const logs = await queryRows(
      "SELECT * FROM MONT_PROVIDER_APPROVAL_LOGS WHERE PROVIDER_ID = :id ORDER BY CREATED_AT DESC",
      { id },
    );
    return { ...provider, logs };
  }
}
