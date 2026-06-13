import { v4 as uuid } from "uuid";
import { execDml, queryOne, queryRows } from "../db/db";
import { json } from "../db/database";
import { WinthorAdapter } from "../oracle/WinthorAdapter";
import { EventService } from "./EventService";
import { IntegrationLogService } from "./IntegrationLogService";

/** Maps WinThor POSICAO codes to human-readable labels for timeline. */
function posicaoLabel(posicao: string): string {
  const map: Record<string, string> = {
    F: "Faturado",
    L: "Liberado",
    E: "Em separação",
    Q: "Em conferência",
    C: "Cancelado",
    B: "Bloqueado",
    T: "Transferência",
  };
  const code = posicao.trim().toUpperCase();
  return map[code] ?? `Status ${code || "Em aberto"}`;
}

export class WinthorSyncService {
  constructor(
    private readonly adapter = new WinthorAdapter(),
    private readonly logs = new IntegrationLogService(),
    private readonly events = new EventService(),
  ) {}

  // ── Public API ────────────────────────────────────────────────────────────

  async syncOrder(numped: string, userId?: string) {
    const start = Date.now();
    try {
      // 1. Order header (PCPEDC + PCEMPR join)
      const orderRows = await this.adapter.getOrderByNumber(numped);
      if (orderRows.length === 0) throw new Error("Pedido não localizado no WinThor.");
      const wOrder = orderRows[0] as Record<string, unknown>;

      const codcliRaw = wOrder.CODCLI;
      // Oracle NUMBER 0 and NULL both arrive as falsy — treat 0 as valid code "0"
      let codcli = codcliRaw != null && codcliRaw !== "" ? String(codcliRaw) : "";
      const posicao = String(wOrder.POSICAO ?? "").trim().toUpperCase();

      // Fallback: when PCPEDC.CODCLI is NULL, try MONT_AGENDA_CANDIDATOS for this NUMPED
      let agendaFallback: { codcli: string | null; nome_cliente: string | null; telefone: string | null } | null = null;
      if (!codcli) {
        agendaFallback = await queryOne<{ codcli: string | null; nome_cliente: string | null; telefone: string | null }>(
          "SELECT CODCLI, NOME_CLIENTE, TELEFONE FROM MONT_AGENDA_CANDIDATOS WHERE NUMPED = :numped",
          { numped },
        ).catch(() => null);
        if (agendaFallback?.codcli) codcli = agendaFallback.codcli;
      }

      // Last resort: synthetic key so the order is still schedulable
      if (!codcli) codcli = `SEM_COD_${numped}`;

      // 2. Sync customer from PCCLIENT (with agenda fallback data if needed)
      const { customerId, city, uf } = await this.syncCustomer(codcli, agendaFallback);

      // 3. Items from PCPEDI + PCPRODUT (assembly flag via VLMAODEOBRA)
      const items = (await this.adapter.getOrderItems(numped)) as Record<string, unknown>[];
      const hasAssembly = items.some((i) => Number(i.REQUER_MONTAGEM) === 1);
      const assemblyItemCount = items.filter((i) => Number(i.REQUER_MONTAGEM) === 1).length;

      // 4. Invoice from PCNFSAID
      const invoiceRows = await this.adapter.getInvoiceByOrder(numped);
      const invoice = (invoiceRows[0] as Record<string, unknown> | undefined) ?? null;

      // 5. Cargo from PCCARREG (if NUMCAR present in order)
      let cargo: Record<string, unknown> | null = null;
      if (wOrder.NUMCAR) {
        const cargoRows = await this.adapter.getCargoByNumber(String(wOrder.NUMCAR));
        cargo = (cargoRows[0] as Record<string, unknown> | undefined) ?? null;
      }

      // 6. Transporter from PCFORNEC (if CODTRANSP present)
      let transporter: Record<string, unknown> | null = null;
      if (wOrder.CODTRANSP) {
        const transpRows = await this.adapter.getTransporterById(String(wOrder.CODTRANSP));
        transporter = (transpRows[0] as Record<string, unknown> | undefined) ?? null;
      }

      // 7. Upsert MONT_ORDERS
      const { orderId, isNew } = await this.upsertOrder({
        numped,
        codcli,
        customerId,
        branch: String(wOrder.CODFILIAL ?? ""),
        seller: String(wOrder.NOME_VENDEDOR ?? ""),
        city,
        uf,
        totalAmount: Number(wOrder.VLTOTAL ?? 0),
        hasAssembly: hasAssembly ? 1 : 0,
        oraclePayload: json({ order: wOrder, invoice, cargo, transporter }),
      });

      // 8. Re-sync order items (delete + insert to handle quantity/price changes)
      await execDml("DELETE FROM MONT_ORDER_ITEMS WHERE ORDER_ID = :orderId", { orderId });
      for (const item of items) {
        const productId = this.s(item.CODPROD, "SEM_CODPROD");
        const description = this.s(item.DESCRICAO, "Produto sem descrição");
        await execDml(
          `INSERT INTO MONT_ORDER_ITEMS
           (ID, ORDER_ID, PRODUCT_ID, DESCRIPTION, QUANTITY, REQUIRES_ASSEMBLY, ASSEMBLY_COST)
           VALUES (:id, :orderId, :productId, :description, :quantity, :requiresAssembly, :assemblyCost)`,
          {
            id: uuid(),
            orderId,
            productId,
            description,
            quantity: Number(item.QT ?? 0),
            requiresAssembly: Number(item.REQUER_MONTAGEM ?? 0),
            assemblyCost: Number(item.VLMAODEOBRA ?? 0),
          },
        );
      }

      // 9. Emit events (idempotent — duplicates are skipped)

      // Always emit sync event with current posicao
      await this.events.emit({
        type: "PEDIDO_SINCRONIZADO",
        orderId,
        numped,
        codcli,
        origin: "WINTHOR",
        userId,
        metadata: {
          description: `Pedido sincronizado do WinThor. Status: ${posicaoLabel(posicao)}.`,
          posicao,
          isNew,
        },
        idempotencyKey: `winthor-sync:${numped}:${posicao || "open"}`,
      });

      // POSICAO 'F' = faturado → NF emitida
      if (posicao === "F") {
        await this.events.emit({
          type: "FATURADO",
          orderId,
          numped,
          codcli,
          origin: "WINTHOR",
          userId,
          metadata: { description: "Nota fiscal emitida no WinThor.", visibleToCustomer: true },
          idempotencyKey: `faturado:${numped}`,
        });
      }

      // Cargo with DTSAIDA → saiu para entrega
      if (cargo?.DTSAIDA) {
        await this.events.emit({
          type: "SAIU_PARA_ENTREGA",
          orderId,
          numped,
          codcli,
          origin: "WINTHOR",
          userId,
          metadata: {
            description: `Pedido saiu para entrega. Carregamento ${cargo.NUMCAR}.`,
            visibleToCustomer: true,
            numcar: cargo.NUMCAR,
            destino: cargo.DESTINO,
          },
          idempotencyKey: `saiu-entrega:${numped}:${cargo.NUMCAR}`,
        });
      }

      // DTCANHOTO set on invoice → entrega confirmada
      if (invoice?.DTCANHOTO) {
        await this.events.emit({
          type: "ENTREGA_REALIZADA",
          orderId,
          numped,
          codcli,
          origin: "WINTHOR",
          userId,
          metadata: {
            description: "Entrega confirmada pelo canhoto assinado.",
            visibleToCustomer: true,
            dtCanhoto: invoice.DTCANHOTO,
          },
          idempotencyKey: `entrega-realizada:${numped}`,
        });
      }

      // Items require assembly
      if (hasAssembly) {
        await this.events.emit({
          type: "MONTAGEM_NECESSARIA",
          orderId,
          numped,
          codcli,
          origin: "WINTHOR",
          metadata: {
            description: `${assemblyItemCount} item(s) do pedido requer(em) montagem.`,
            assemblyItemCount,
          },
          idempotencyKey: `montagem-necessaria:${numped}`,
        });
      }

      await this.logs.record({
        syncType: "PEDIDO",
        numped,
        queryName: "syncOrder",
        status: "SUCESSO",
        elapsedMs: Date.now() - start,
        origin: userId ? "MANUAL" : "JOB",
        userId,
      });

      return {
        orderId,
        isNew,
        hasAssembly,
        itemCount: items.length,
        assemblyItemCount,
        hasInvoice: !!invoice,
        hasCargo: !!cargo,
        deliveryConfirmed: !!invoice?.DTCANHOTO,
        posicao,
      };
    } catch (error) {
      await this.logs.record({
        syncType: "PEDIDO",
        numped,
        queryName: "syncOrder",
        status: "ERRO",
        errorMessage: (error as Error).message,
        elapsedMs: Date.now() - start,
        origin: userId ? "MANUAL" : "JOB",
        userId,
      });
      // Best-effort: emit integration error event so dashboard/alerts can react
      try {
        await this.events.emit({
          type: "INTEGRACAO_WINTHOR_ERRO",
          numped,
          origin: "WINTHOR",
          userId,
          metadata: { description: `Erro na sincronização WinThor: ${(error as Error).message}`, numped },
          idempotencyKey: `winthor-erro:${numped}:${Date.now()}`,
        });
      } catch {
        // Swallow — original error is re-thrown below
      }
      throw error;
    }
  }

  async syncOrdersBatch(since: Date, userId?: string) {
    const orderRows = await this.adapter.getOrdersUpdatedSince(since);
    const results = { success: 0, errors: 0, total: orderRows.length };

    for (const row of orderRows as Record<string, unknown>[]) {
      const numped = String(row.NUMPED ?? "");
      if (!numped) continue;
      try {
        await this.syncOrder(numped, userId);
        results.success++;
      } catch {
        results.errors++;
      }
    }

    return results;
  }

  async failures() {
    const [failures, logs] = await Promise.all([
      queryRows("SELECT * FROM MONT_INTEGRATION_FAILURES WHERE RESOLVED_AT IS NULL ORDER BY CREATED_AT DESC FETCH FIRST 100 ROWS ONLY"),
      queryRows("SELECT * FROM MONT_WINTHOR_SYNC_LOGS ORDER BY CREATED_AT DESC FETCH FIRST 100 ROWS ONLY"),
    ]);
    return { failures, logs };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** In Oracle, empty string '' binds as NULL. Use this for every NOT NULL VARCHAR2 column. */
  private s(val: unknown, fallback: string): string {
    const v = val != null ? String(val).trim() : "";
    return v || fallback;
  }

  private async syncCustomer(
    codcli: string,
    fallback?: { codcli: string | null; nome_cliente: string | null; telefone: string | null } | null,
  ): Promise<{ customerId: string; city: string; uf: string }> {
    if (!codcli || codcli.trim() === "") throw new Error("CODCLI inválido ou nulo — não é possível criar o cliente.");

    // Try to fetch from WinThor PCCLIENT — skip if codcli is a synthetic key
    let wc: Record<string, unknown> | null = null;
    if (!codcli.startsWith("SEM_COD_")) {
      const clientRows = await this.adapter.getCustomerById(codcli).catch(() => []);
      wc = (clientRows[0] as Record<string, unknown> | undefined) ?? null;
    }

    const name = this.s(wc?.CLIENTE ?? fallback?.nome_cliente, "Cliente WinThor");
    const phone = wc?.TELENT || wc?.TELCELENT || fallback?.telefone
      ? String(wc?.TELENT ?? wc?.TELCELENT ?? fallback?.telefone ?? "")
      : null;
    const document = wc?.CGCENT ? String(wc.CGCENT) : null;
    const email = wc?.EMAIL ? String(wc.EMAIL) : null;
    const city = String(wc?.MUNICENT ?? "");
    const uf = String(wc?.ESTENT ?? "");
    const address = json({
      street: wc?.ENDERENT ?? "",
      city,
      uf,
      cep: wc?.CEPENT ?? "",
    });

    const existing = await queryOne<{ id: string }>(
      "SELECT ID FROM MONT_CUSTOMERS WHERE CODCLI = :codcli",
      { codcli },
    );

    if (existing) {
      await execDml(
        `UPDATE MONT_CUSTOMERS
         SET NAME = :name, PHONE = :phone, DOCUMENT = :document,
             EMAIL = :email, ADDRESS_JSON = :address, UPDATED_AT = SYSTIMESTAMP
         WHERE CODCLI = :codcli`,
        { name, phone: phone || null, document: document || null, email, address, codcli },
      );
      return { customerId: existing.id, city, uf };
    }

    const id = uuid();
    await execDml(
      `INSERT INTO MONT_CUSTOMERS (ID, CODCLI, NAME, PHONE, DOCUMENT, EMAIL, ADDRESS_JSON)
       VALUES (:id, :codcli, :name, :phone, :document, :email, :address)`,
      { id, codcli, name, phone: phone || null, document: document || null, email, address },
    );
    return { customerId: id, city, uf };
  }

  private async upsertOrder(data: {
    numped: string;
    codcli: string;
    customerId: string;
    branch: string;
    seller: string;
    city: string;
    uf: string;
    totalAmount: number;
    hasAssembly: number;
    oraclePayload: string;
  }): Promise<{ orderId: string; isNew: boolean }> {
    const existing = await queryOne<{ id: string }>(
      "SELECT ID FROM MONT_ORDERS WHERE NUMPED = :numped",
      { numped: data.numped },
    );

    if (existing) {
      await execDml(
        `UPDATE MONT_ORDERS
         SET CODCLI = :codcli, CUSTOMER_ID = :customerId, BRANCH = :branch,
             SELLER = :seller, CITY = :city, UF = :uf, TOTAL_AMOUNT = :totalAmount,
             HAS_ASSEMBLY = :hasAssembly, ORACLE_PAYLOAD_JSON = :payload,
             UPDATED_AT = SYSTIMESTAMP
         WHERE NUMPED = :numped`,
        {
          codcli: data.codcli,
          customerId: data.customerId,
          branch: data.branch,
          seller: data.seller,
          city: data.city,
          uf: data.uf,
          totalAmount: data.totalAmount,
          hasAssembly: data.hasAssembly,
          payload: data.oraclePayload,
          numped: data.numped,
        },
      );
      return { orderId: existing.id, isNew: false };
    }

    const orderId = uuid();
    await execDml(
      `INSERT INTO MONT_ORDERS
       (ID, NUMPED, CODCLI, CUSTOMER_ID, BRANCH, SELLER, CITY, UF,
        TOTAL_AMOUNT, CURRENT_STATUS, HAS_ASSEMBLY, ORACLE_PAYLOAD_JSON)
       VALUES (:id, :numped, :codcli, :customerId, :branch, :seller, :city, :uf,
               :totalAmount, 'PEDIDO_SINCRONIZADO', :hasAssembly, :payload)`,
      {
        id: orderId,
        numped: data.numped,
        codcli: data.codcli,
        customerId: data.customerId,
        branch: data.branch,
        seller: data.seller,
        city: data.city,
        uf: data.uf,
        totalAmount: data.totalAmount,
        hasAssembly: data.hasAssembly,
        payload: data.oraclePayload,
      },
    );
    return { orderId, isNew: true };
  }
}
