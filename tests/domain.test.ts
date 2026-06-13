import { describe, expect, it } from "vitest";
import { eventTypes, paymentStatuses, providerStatuses, roles } from "../src/shared/domain";

describe("domain contracts", () => {
  it("contains mandatory journey roles and statuses", () => {
    expect(roles).toContain("ADMIN");
    expect(roles).toContain("MONTADOR");
    expect(providerStatuses).toContain("APROVADO");
    expect(providerStatuses).toContain("BLOQUEADO");
    expect(paymentStatuses).toContain("LIBERADO");
    expect(paymentStatuses).toContain("BLOQUEADO");
  });

  it("contains core post-sale event types", () => {
    expect(eventTypes).toContain("PEDIDO_CRIADO");
    expect(eventTypes).toContain("MONTAGEM_FINALIZADA");
    expect(eventTypes).toContain("AVALIACAO_CLIENTE_RECEBIDA");
    expect(eventTypes).toContain("SAC_CASO_ABERTO");
    expect(eventTypes).toContain("PAGAMENTO_LIBERADO");
    expect(eventTypes).toContain("INTEGRACAO_WINTHOR_ERRO");
  });
});
