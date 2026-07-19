import { v4 as uuid } from "uuid";
import { AppError } from "../errors";
import { execDml, queryOne, queryRows } from "../db/db";
import { json, parseJson } from "../db/database";
import { EventService } from "./EventService";
import { TokenService } from "./TokenService";

export class OrderService {
  constructor(
    private readonly events = new EventService(),
    private readonly tokens = new TokenService(),
  ) {}

  async createDemoOrder() {
    const customerId = uuid();
    const orderId = uuid();
    const suffix = String(Date.now()).slice(-6);
    const codcli = `10${suffix}`;
    const numped = String(Math.floor(Date.now() / 1000));

    await execDml(
      `INSERT INTO MONT_CUSTOMERS (ID, CODCLI, NAME, PHONE, DOCUMENT, EMAIL, ADDRESS_JSON)
       VALUES (:id, :codcli, :name, :phone, :document, :email, :address)`,
      {
        id: customerId,
        codcli,
        name: `Cliente Exemplo ${suffix}`,
        phone: "11999990000",
        document: "00000000000",
        email: `cliente.${suffix}@example.com`,
        address: json({ street: "Rua das Montagens, 100", city: "São Paulo", uf: "SP" }),
      },
    );

    await execDml(
      `INSERT INTO MONT_ORDERS
       (ID, NUMPED, CODCLI, CUSTOMER_ID, BRANCH, SELLER, CITY, UF, TOTAL_AMOUNT, CURRENT_STATUS, HAS_ASSEMBLY)
       VALUES (:id, :numped, :codcli, :customerId, '01', 'VENDEDOR LARA', 'São Paulo', 'SP', 1890, 'PEDIDO_CRIADO', 1)`,
      { id: orderId, numped, codcli, customerId },
    );

    await execDml(
      `INSERT INTO MONT_ORDER_ITEMS (ID, ORDER_ID, PRODUCT_ID, DESCRIPTION, QUANTITY, REQUIRES_ASSEMBLY, ASSEMBLY_COST)
       VALUES (:id, :orderId, 'MOVEL-001', 'Guarda-roupa casal', 1, 1, 120)`,
      { id: uuid(), orderId },
    );

    await this.events.emit({
      type: "PEDIDO_CRIADO",
      orderId,
      numped,
      codcli,
      origin: "SISTEMA",
      metadata: { description: "Pedido de demonstração criado para validar a jornada." },
      idempotencyKey: `pedido-criado:${numped}`,
    });
    await this.events.emit({
      type: "MONTAGEM_NECESSARIA",
      orderId,
      numped,
      codcli,
      origin: "SISTEMA",
      metadata: { description: "Itens do pedido exigem montagem." },
      idempotencyKey: `montagem-necessaria:${numped}`,
    });

    const token = await this.tokens.create(orderId, "JORNADA_CLIENTE");
    return { orderId, numped, token };
  }

  async list(filters: Record<string, string | undefined>) {
    const limit = Math.min(Number(filters.limit ?? 100), 500);
    const offset = Number(filters.offset ?? 0);

    return queryRows(
      `SELECT o.*, c.NAME AS CUSTOMER_NAME, c.PHONE AS CUSTOMER_PHONE
       FROM MONT_ORDERS o
       JOIN MONT_CUSTOMERS c ON c.ID = o.CUSTOMER_ID
       WHERE (:status IS NULL OR o.CURRENT_STATUS = :status)
       ORDER BY o.CREATED_AT DESC
       OFFSET :offset ROWS FETCH FIRST :limit ROWS ONLY`,
      { status: filters.status ?? null, limit, offset },
    );
  }

  async detail(id: string) {
    const order = await queryOne<Record<string, unknown>>(
      `SELECT o.*, c.NAME AS CUSTOMER_NAME, c.PHONE AS CUSTOMER_PHONE,
              c.EMAIL AS CUSTOMER_EMAIL, c.ADDRESS_JSON
       FROM MONT_ORDERS o
       JOIN MONT_CUSTOMERS c ON c.ID = o.CUSTOMER_ID
       WHERE o.ID = :id OR o.NUMPED = :id`,
      { id },
    );
    if (!order) throw new AppError("Pedido não encontrado.", 404, "NOT_FOUND");
    const orderId = String(order.id);

    const [items, timeline, reviews, sacCases, payments, audit] = await Promise.all([
      queryRows("SELECT * FROM MONT_ORDER_ITEMS WHERE ORDER_ID = :id", { id: orderId }),
      queryRows("SELECT * FROM MONT_ORDER_TIMELINE WHERE ORDER_ID = :id ORDER BY CREATED_AT ASC", { id: orderId }),
      queryRows("SELECT * FROM MONT_CUSTOMER_REVIEWS WHERE ORDER_ID = :id ORDER BY CREATED_AT DESC", { id: orderId }),
      queryRows("SELECT * FROM MONT_SAC_CASES WHERE ORDER_ID = :id ORDER BY CREATED_AT DESC", { id: orderId }),
      queryRows(
        `SELECT p.* FROM MONT_PROVIDER_PAYMENTS p
         JOIN MONT_ASSEMBLY_JOBS a ON a.ID = p.ASSEMBLY_JOB_ID
         WHERE a.ORDER_ID = :id`,
        { id: orderId },
      ),
      queryRows(
        `SELECT * FROM MONT_AUDIT_LOGS
         WHERE ENTITY_ID = :id OR ENTITY_TYPE = 'order_event'
         ORDER BY CREATED_AT DESC FETCH FIRST 50 ROWS ONLY`,
        { id: orderId },
      ),
    ]);

    return {
      ...order,
      address: parseJson(order.address_json, {}),
      items,
      timeline,
      reviews,
      sacCases,
      payments,
      audit,
    };
  }

  /**
   * DTO público enxuto para a jornada do cliente (link público, sem auth).
   * Diferente de detail(): NÃO expõe audit, payments, sacCases, e-mail, telefone
   * ou endereço — apenas o mínimo para o cliente acompanhar o pedido.
   */
  async detailPublic(id: string) {
    const order = await queryOne<Record<string, unknown>>(
      `SELECT o.ID, o.NUMPED, o.CURRENT_STATUS, o.HAS_ASSEMBLY,
              c.NAME AS CUSTOMER_NAME
       FROM MONT_ORDERS o
       JOIN MONT_CUSTOMERS c ON c.ID = o.CUSTOMER_ID
       WHERE o.ID = :id OR o.NUMPED = :id`,
      { id },
    );
    if (!order) throw new AppError("Pedido não encontrado.", 404, "NOT_FOUND");
    const orderId = String(order.id);

    const [items, timeline] = await Promise.all([
      queryRows<Record<string, unknown>>(
        "SELECT DESCRIPTION, QUANTITY, REQUIRES_ASSEMBLY FROM MONT_ORDER_ITEMS WHERE ORDER_ID = :id",
        { id: orderId },
      ),
      queryRows<Record<string, unknown>>(
        `SELECT TITLE, CREATED_AT FROM MONT_ORDER_TIMELINE
         WHERE ORDER_ID = :id AND VISIBLE_TO_CUSTOMER = 1
         ORDER BY CREATED_AT ASC`,
        { id: orderId },
      ),
    ]);

    // Apenas o primeiro nome, para não expor o nome completo do cliente.
    const fullName = String(order.customer_name ?? "").trim();
    const firstName = fullName ? fullName.split(/\s+/)[0] : null;

    return {
      numped: order.numped ?? null,
      customer_name: firstName,
      current_status: order.current_status ?? null,
      has_assembly: order.has_assembly ?? null,
      timeline,
      items,
    };
  }

  async dashboard() {
    const metric = async (sql: string, binds: Record<string, unknown> = {}) => {
      const row = await queryOne<{ value: number }>(sql, binds);
      return Number(row?.value ?? 0);
    };

    const [
      monitored, createdToday, withAssembly,
      awaitingSchedule, scheduled, inExecution, finished, awaitingReview,
      sacOpen, sacResolved,
      blocked, released, programmed, paid,
      failures,
    ] = await Promise.all([
      metric("SELECT COUNT(*) AS VALUE FROM MONT_ORDERS"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_ORDERS WHERE TRUNC(CREATED_AT) = TRUNC(SYSDATE)"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_ORDERS WHERE HAS_ASSEMBLY = 1"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_ASSEMBLY_JOBS WHERE STATUS = 'AGUARDANDO_AGENDAMENTO'"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_ASSEMBLY_SCHEDULES WHERE STATUS = 'AGENDADA'"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_ASSEMBLY_JOBS WHERE STATUS = 'EM_EXECUCAO'"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_ASSEMBLY_JOBS WHERE STATUS = 'FINALIZADA'"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_PROVIDER_PAYMENTS WHERE STATUS = 'AGUARDANDO_AVALIACAO_CLIENTE'"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_SAC_CASES WHERE STATUS IN ('ABERTO','EM_ANALISE')"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_SAC_CASES WHERE STATUS IN ('RESOLVIDO','ENCERRADO')"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_PROVIDER_PAYMENTS WHERE STATUS = 'BLOQUEADO'"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_PROVIDER_PAYMENTS WHERE STATUS = 'LIBERADO'"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_PROVIDER_PAYMENTS WHERE STATUS = 'PROGRAMADO'"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_PROVIDER_PAYMENTS WHERE STATUS = 'PAGO'"),
      metric("SELECT COUNT(*) AS VALUE FROM MONT_INTEGRATION_FAILURES WHERE RESOLVED_AT IS NULL"),
    ]);

    return {
      orders: { monitored, createdToday, withAssembly },
      assembly: { awaitingSchedule, scheduled, inExecution, finished, awaitingReview },
      sac: { open: sacOpen, resolved: sacResolved },
      finance: { blocked, released, programmed, paid },
      integration: { failures },
    };
  }
}
