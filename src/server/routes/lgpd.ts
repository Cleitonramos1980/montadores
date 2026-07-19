import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireRole } from "../middleware/auth";
import { execDml, queryOne } from "../db/db";
import { AppError } from "../errors";
import { AuditService } from "../services/AuditService";
import { LgpdExportService } from "../services/LgpdExportService";
import { asyncRoute, param } from "../utils/route";

// Endpoints de titularidade de dados (LGPD). Anonimização preserva CODCLI e vínculos
// de pedido (retenção fiscal/operacional), removendo apenas os dados pessoais.
export const lgpdRouter = Router();
lgpdRouter.use(authMiddleware);

const onlyAdmin = requireRole("ADMIN", "GESTOR");
const audit = new AuditService();
const exporter = new LgpdExportService();

// POST /api/lgpd/customers/:id/anonymize  { reason }
lgpdRouter.post("/lgpd/customers/:id/anonymize", onlyAdmin, asyncRoute(async (req, res) => {
  const id = param(req.params.id);
  const { reason } = z.object({ reason: z.string().min(3).max(500) }).parse(req.body);

  const cust = await queryOne<{ id: string; codcli: string; name: string }>(
    "SELECT ID, CODCLI, NAME FROM MONT_CUSTOMERS WHERE ID = :id", { id });
  if (!cust) throw new AppError("Cliente não encontrado.", 404, "NOT_FOUND");

  const tag = `ANONIMIZADO-${cust.codcli}`;
  await execDml(
    `UPDATE MONT_CUSTOMERS
        SET NAME = :tag, PHONE = NULL, DOCUMENT = NULL, EMAIL = NULL,
            ADDRESS_JSON = '{}', UPDATED_AT = SYSTIMESTAMP
      WHERE ID = :id`,
    { tag, id });

  // Trilha obrigatória para prestação de contas (LGPD art. 37).
  await audit.log({
    actorUserId: req.user?.sub,
    action: "LGPD_ANONYMIZE",
    entityType: "customer",
    entityId: cust.id,
    justification: `${reason} | por ${req.user?.email ?? "?"}`,
    ip: req.ip,
  });

  res.json({ ok: true, anonymized: cust.codcli });
}));

// GET /api/lgpd/customers/:id/export
// Portabilidade de dados pessoais (LGPD art. 18). Reúne, SOMENTE-LEITURA, os
// dados do titular em um JSON estruturado. Restrito a ADMIN/GESTOR (onlyAdmin)
// e sob autenticação (authMiddleware aplicado no router).
lgpdRouter.get("/lgpd/customers/:id/export", onlyAdmin, asyncRoute(async (req, res) => {
  const id = param(req.params.id);
  const data = await exporter.exportCustomerData(id);

  // Trilha obrigatória: exportação de dados pessoais é evento auditável.
  await audit.log({
    actorUserId: req.user?.sub,
    action: "LGPD_EXPORT",
    entityType: "customer",
    entityId: id,
    justification: `Exportação de dados pessoais por ${req.user?.email ?? "?"}`,
    ip: req.ip,
  });

  res.json(data);
}));
