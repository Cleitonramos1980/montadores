import { queryOne, queryRows } from "../db/db";
import { AppError } from "../errors";

// Exportação/portabilidade de dados pessoais (LGPD art. 18, II e V).
// Reúne, SOMENTE-LEITURA, os dados pessoais do titular (cliente) espalhados
// pelas tabelas MONT_* e devolve um JSON estruturado. Não altera nenhum dado.
// Complementa a anonimização já existente em routes/lgpd.ts.

type CustomerRow = {
  id: string;
  codcli: string;
  name: string;
  phone: string | null;
  document: string | null;
  email: string | null;
  address_json: unknown;
  created_at: unknown;
  updated_at: unknown;
};

export type LgpdExport = {
  exportedAt: string;
  subject: {
    id: string;
    codcli: string;
    name: string;
    phone: string | null;
    document: string | null;
    email: string | null;
    address: unknown;
    createdAt: unknown;
    updatedAt: unknown;
  };
  orders: unknown[];
  reviews: unknown[];
  sacCases: unknown[];
  messages: unknown[];
  timeline: unknown[];
};

// CLOBs de endereço voltam como string; parseia defensivamente para objeto.
function parseAddress(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? null;
  try { return JSON.parse(raw); } catch { return raw; }
}

export class LgpdExportService {
  /**
   * Monta o pacote de portabilidade para um titular (cliente) pelo seu ID interno.
   * Lança 404 se o cliente não existir. Todas as consultas são de leitura.
   */
  async exportCustomerData(customerId: string): Promise<LgpdExport> {
    const cust = await queryOne<CustomerRow>(
      `SELECT ID, CODCLI, NAME, PHONE, DOCUMENT, EMAIL, ADDRESS_JSON, CREATED_AT, UPDATED_AT
         FROM MONT_CUSTOMERS WHERE ID = :id`,
      { id: customerId },
    );
    if (!cust) throw new AppError("Cliente não encontrado.", 404, "NOT_FOUND");

    // Subquery reutilizada: todos os pedidos do titular.
    const ordersOfCustomer = "SELECT ID FROM MONT_ORDERS WHERE CUSTOMER_ID = :id";

    const orders = await queryRows(
      `SELECT ID, NUMPED, CODCLI, BRANCH, SELLER, CITY, UF,
              TOTAL_AMOUNT, CURRENT_STATUS, HAS_ASSEMBLY, CREATED_AT, UPDATED_AT
         FROM MONT_ORDERS WHERE CUSTOMER_ID = :id ORDER BY CREATED_AT`,
      { id: customerId },
    );

    const reviews = await queryRows(
      `SELECT ID, ORDER_ID, SERVICE_TYPE, SCORE, CLASSIFICATION,
              REVIEW_COMMENT, COMPLAINT_REASON, CREATED_AT
         FROM MONT_CUSTOMER_REVIEWS
        WHERE ORDER_ID IN (${ordersOfCustomer}) ORDER BY CREATED_AT`,
      { id: customerId },
    );

    const sacCases = await queryRows(
      `SELECT ID, ORDER_ID, STATUS, REASON, DESCRIPTION, CREATED_AT, UPDATED_AT
         FROM MONT_SAC_CASES
        WHERE ORDER_ID IN (${ordersOfCustomer}) ORDER BY CREATED_AT`,
      { id: customerId },
    );

    const messages = await queryRows(
      `SELECT ID, ORDER_ID, CHANNEL, RECIPIENT, STATUS, CREATED_AT
         FROM MONT_MSG_LOGS
        WHERE ORDER_ID IN (${ordersOfCustomer}) ORDER BY CREATED_AT`,
      { id: customerId },
    );

    const timeline = await queryRows(
      `SELECT ID, ORDER_ID, TITLE, DESCRIPTION, VISIBLE_TO_CUSTOMER, CREATED_AT
         FROM MONT_ORDER_TIMELINE
        WHERE ORDER_ID IN (${ordersOfCustomer}) ORDER BY CREATED_AT`,
      { id: customerId },
    );

    return {
      exportedAt: new Date().toISOString(),
      subject: {
        id: cust.id,
        codcli: cust.codcli,
        name: cust.name,
        phone: cust.phone,
        document: cust.document,
        email: cust.email,
        address: parseAddress(cust.address_json),
        createdAt: cust.created_at,
        updatedAt: cust.updated_at,
      },
      orders,
      reviews,
      sacCases,
      messages,
      timeline,
    };
  }
}
