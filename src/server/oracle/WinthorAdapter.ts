import { executeOracle, isOraclePoolInitialized } from "../db/oracle";
import { ServiceUnavailableError } from "../errors";

type AnyRow = Record<string, unknown>;

async function oq<T = AnyRow>(sql: string, binds: Record<string, unknown> = {}): Promise<T[]> {
  // Durante o boot (ex.: sem VPN) o pool ainda não subiu. Lançamos um erro
  // identificável (503) para o handler traduzir, em vez de um 500 cru do driver.
  if (!isOraclePoolInitialized()) {
    throw new ServiceUnavailableError("WinThor indisponível: pool Oracle não inicializado.");
  }
  const result = await executeOracle<T>(sql, binds);
  return (result.rows as T[] | undefined) ?? [];
}

function inBinds(ids: string[]): { clause: string; binds: Record<string, string> } {
  const clause = ids.map((_, i) => `:p${i}`).join(",");
  const binds = Object.fromEntries(ids.map((id, i) => [`p${i}`, id]));
  return { clause, binds };
}

export class WinthorAdapter {
  // ── PCCLIENT ─────────────────────────────────────────────────────────────
  async getCustomerById(codcli: string) {
    return oq(
      `SELECT CODCLI, CLIENTE, CGCENT, ENDERENT, MUNICENT, ESTENT, CEPENT,
              TELENT, TELCELENT, EMAIL, BLOQUEIO, DTCADASTRO
       FROM PCCLIENT WHERE CODCLI = :codcli`,
      { codcli },
    );
  }

  async searchCustomers(term: string) {
    return oq(
      `SELECT CODCLI, CLIENTE, CGCENT, MUNICENT, ESTENT, TELENT, EMAIL, BLOQUEIO
       FROM PCCLIENT
       WHERE UPPER(CLIENTE) LIKE UPPER(:term) OR CGCENT LIKE :term2
       FETCH FIRST 20 ROWS ONLY`,
      { term: `%${term}%`, term2: `%${term}%` },
    );
  }

  // ── PCPEDC ───────────────────────────────────────────────────────────────
  async getOrderByNumber(numped: string) {
    return oq(
      `SELECT p.NUMPED, p.CODCLI, p.CODFILIAL, p.CODUSUR, p.VLTOTAL,
              p.DATA, p.DTENTREGA, p.POSICAO, p.NUMCAR, p.CODTRANSP,
              p.DTFAT, p.CHAVENFE, p.TIPOVENDA,
              e.NOME AS NOME_VENDEDOR
       FROM PCPEDC p
       LEFT JOIN PCEMPR e ON e.CODUSUR = p.CODUSUR
       WHERE p.NUMPED = :numped`,
      { numped },
    );
  }

  async getOrdersUpdatedSince(date: Date, maxRows = 5000) {
    // Teto de linhas: um "since" muito antigo não pode varrer a PCPEDC inteira
    // (N+1 no scheduler). O clamp do próprio "since" é feito na rota.
    return oq(
      `SELECT p.NUMPED, p.CODCLI, p.CODFILIAL, p.VLTOTAL,
              p.DATA, p.DTENTREGA, p.POSICAO, p.NUMCAR, p.CODTRANSP
       FROM PCPEDC p
       WHERE p.DATA >= :since
       ORDER BY p.DATA DESC
       FETCH FIRST :maxRows ROWS ONLY`,
      { since: date, maxRows },
    );
  }

  async getOrdersByClient(codcli: string) {
    return oq(
      `SELECT NUMPED, CODCLI, CODFILIAL, VLTOTAL, DATA, DTENTREGA, POSICAO
       FROM PCPEDC WHERE CODCLI = :codcli
       ORDER BY DATA DESC FETCH FIRST 50 ROWS ONLY`,
      { codcli },
    );
  }

  // ── PCPEDI + PCPRODUT ────────────────────────────────────────────────────
  async getOrderItems(numped: string) {
    return oq(
      `SELECT i.NUMPED, i.NUMSEQ, i.CODPROD, i.QT, i.PVENDA, i.PTABELA,
              i.PERDESC, i.POSICAO,
              p.DESCRICAO, p.UNIDADE, p.PESOLIQ, p.PESOBRUTO,
              p.VLMAODEOBRA,
              CASE WHEN p.VLMAODEOBRA > 0 THEN 1 ELSE 0 END AS REQUER_MONTAGEM
       FROM PCPEDI i
       LEFT JOIN PCPRODUT p ON p.CODPROD = i.CODPROD
       WHERE i.NUMPED = :numped
       ORDER BY i.NUMSEQ`,
      { numped },
    );
  }

  async getProductsWithAssembly(productIds: string[]) {
    if (productIds.length === 0) return [];
    const { clause, binds } = inBinds(productIds);
    return oq(
      `SELECT CODPROD, DESCRICAO, VLMAODEOBRA, PESOLIQ, PESOBRUTO, UNIDADE
       FROM PCPRODUT WHERE CODPROD IN (${clause}) AND VLMAODEOBRA > 0`,
      binds,
    );
  }

  async getProductsAssemblyRequirement(productIds: string[]) {
    if (productIds.length === 0) return [];
    const { clause, binds } = inBinds(productIds);
    return oq(
      `SELECT CODPROD, DESCRICAO, VLMAODEOBRA
       FROM PCPRODUT WHERE CODPROD IN (${clause})`,
      binds,
    );
  }

  // ── PCNFSAID ─────────────────────────────────────────────────────────────
  async getInvoiceByOrder(numped: string) {
    return oq(
      `SELECT NUMTRANSVENDA, NUMNOTA, SERIE, ESPECIE, DTSAIDA,
              CODCLI, NUMPED, CODFILIAL, TIPOVENDA, DTENTREGA, DTCANHOTO, CHAVENFE
       FROM PCNFSAID WHERE NUMPED = :numped
       ORDER BY DTSAIDA DESC`,
      { numped },
    );
  }

  async getInvoiceByKey(chavenfe: string) {
    return oq(
      `SELECT NUMTRANSVENDA, NUMNOTA, SERIE, ESPECIE, DTSAIDA,
              CODCLI, NUMPED, CODFILIAL, DTENTREGA, DTCANHOTO, CHAVENFE
       FROM PCNFSAID WHERE CHAVENFE = :chavenfe`,
      { chavenfe },
    );
  }

  // ── PCMOV ─────────────────────────────────────────────────────────────────
  async getStockMovementsByOrder(numped: string) {
    return oq(
      `SELECT CODPROD, CODOPER, QT, PUNIT, CODFILIAL, STATUS,
              DTMOV, NUMPED, NUMTRANSVENDA, QTSALDOEST
       FROM PCMOV WHERE NUMPED = :numped
       ORDER BY DTMOV`,
      { numped },
    );
  }

  // ── PCEMPR ────────────────────────────────────────────────────────────────
  async getEmployeeByUsur(codusur: string) {
    return oq(
      `SELECT MATRICULA, NOME, NOME_GUERRA, CODUSUR, CODFILIAL,
              FUNCAO, EMAIL, CELULAR, SITUACAO, TIPOMOTORISTA
       FROM PCEMPR WHERE CODUSUR = :codusur`,
      { codusur },
    );
  }

  async getDrivers() {
    return oq(
      `SELECT MATRICULA, NOME, NOME_GUERRA, CODUSUR, CODFILIAL,
              FUNCAO, CELULAR, TIPOMOTORISTA
       FROM PCEMPR
       WHERE TIPOMOTORISTA IS NOT NULL AND SITUACAO = 'A'`,
    );
  }

  // ── PCFORNEC ──────────────────────────────────────────────────────────────
  async getTransporterById(codfornec: string) {
    return oq(
      `SELECT CODFORNEC, FORNECEDOR, FANTASIA, CGC, EMAIL,
              CIDADE, ESTADO, CEP, TELREP, EREDESPACHO, BLOQUEIO
       FROM PCFORNEC WHERE CODFORNEC = :codfornec`,
      { codfornec },
    );
  }

  async searchTransporters(term: string) {
    return oq(
      `SELECT CODFORNEC, FORNECEDOR, FANTASIA, CGC, CIDADE, ESTADO, EREDESPACHO
       FROM PCFORNEC
       WHERE (UPPER(FORNECEDOR) LIKE UPPER(:term) OR UPPER(FANTASIA) LIKE UPPER(:term2))
         AND BLOQUEIO = 'N'
       FETCH FIRST 20 ROWS ONLY`,
      { term: `%${term}%`, term2: `%${term}%` },
    );
  }

  async nextCodfornec(): Promise<number> {
    // RISCO: MAX+1 é sujeito a corrida (dois inserts simultâneos geram o mesmo
    // código). O correto no ERP é uma SEQUENCE (ex.: PCFORNEC_SEQ.NEXTVAL).
    // Só é chamado quando ERP_WRITE_ENABLED='true' (escrita no ERP habilitada).
    const rows = await oq<{ maxcode: number }>(
      "SELECT NVL(MAX(CODFORNEC), 0) + 1 AS MAXCODE FROM PCFORNEC",
    );
    return Number(rows[0]?.maxcode ?? 1);
  }

  /**
   * Escrita no ERP (PCFORNEC) — DESLIGADA por padrão. WinThor é somente leitura;
   * só grava se ERP_WRITE_ENABLED === 'true'. Sem a flag, retorna null e o
   * fornecedor fica apenas em MONT_PROVIDERS (codfornec pendente).
   */
  async insertSupplier(data: {
    fornecedor: string;
    fantasia?: string;
    cgc?: string;
    cidade?: string;
    estado?: string;
    cep?: string;
    telrep?: string;
    email?: string;
    eredespacho?: string;
  }): Promise<number | null> {
    if (process.env.ERP_WRITE_ENABLED !== "true") {
      return null;
    }
    const codfornec = await this.nextCodfornec();
    await oq(
      `INSERT INTO PCFORNEC
         (CODFORNEC, FORNECEDOR, FANTASIA, CGC, CIDADE, ESTADO,
          CEP, TELREP, EMAIL, EREDESPACHO, BLOQUEIO)
       VALUES
         (:codfornec, :fornecedor, :fantasia, :cgc, :cidade, :estado,
          :cep, :telrep, :email, :eredespacho, 'N')`,
      {
        codfornec,
        fornecedor: data.fornecedor,
        fantasia:   data.fantasia   ?? data.fornecedor,
        cgc:        data.cgc        ?? null,
        cidade:     data.cidade     ?? null,
        estado:     data.estado     ?? null,
        cep:        data.cep        ?? null,
        telrep:     data.telrep     ?? null,
        email:      data.email      ?? null,
        eredespacho: data.eredespacho ?? "N",
      },
    );
    return codfornec;
  }

  async searchSuppliers(term: string) {
    const isCode = /^\d+$/.test(term.trim());
    return oq(
      `SELECT CODFORNEC, FORNECEDOR, FANTASIA, CGC, EMAIL,
              CIDADE, ESTADO, CEP, TELREP, EREDESPACHO, BLOQUEIO
       FROM PCFORNEC
       WHERE ${isCode
         ? "TO_CHAR(CODFORNEC) LIKE :code OR CGC LIKE :cgc"
         : "UPPER(FORNECEDOR) LIKE UPPER(:nome) OR UPPER(FANTASIA) LIKE UPPER(:nome2) OR CGC LIKE :cgc"}
       ORDER BY FORNECEDOR
       FETCH FIRST 30 ROWS ONLY`,
      isCode
        ? { code: `%${term}%`, cgc: `%${term}%` }
        : { nome: `%${term}%`, nome2: `%${term}%`, cgc: `%${term}%` },
    );
  }

  // ── PCCARREG ──────────────────────────────────────────────────────────────
  async getCargoByNumber(numcar: string) {
    return oq(
      `SELECT NUMCAR, DTSAIDA, DTFECHA, DTRETORNO, CODMOTORISTA, CODVEICULO,
              TOTPESO, TOTVOLUME, VLTOTAL, DESTINO, DTINICIALPEND, DTFINALPEND,
              CODFILIALSAIDA
       FROM PCCARREG WHERE NUMCAR = :numcar`,
      { numcar },
    );
  }

  async getCargosByDate(date: Date) {
    return oq(
      `SELECT NUMCAR, DTSAIDA, DTFECHA, CODMOTORISTA, VLTOTAL, DESTINO
       FROM PCCARREG WHERE TRUNC(DTSAIDA) = TRUNC(:dt)
       ORDER BY DTSAIDA`,
      { dt: date },
    );
  }

  // ── Legacy status helpers (POSICAO) ──────────────────────────────────────
  async getOrderStatus(numped: string) {
    return oq(
      `SELECT NUMPED, POSICAO, DTFAT, DTENTREGA, NUMCAR
       FROM PCPEDC WHERE NUMPED = :numped`,
      { numped },
    );
  }

  async getDeliveryStatus(numped: string) {
    return this.getOrderStatus(numped);
  }

  async getSeparationStatus(numped: string) {
    return this.getOrderStatus(numped);
  }

  async getConferenceStatus(numped: string) {
    return this.getOrderStatus(numped);
  }

  async getBillingStatus(numped: string) {
    return this.getOrderStatus(numped);
  }
}
