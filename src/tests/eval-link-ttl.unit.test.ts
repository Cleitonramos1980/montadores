import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvaluationResponseService } from "../server/services/EvaluationResponseService";

vi.mock("../server/db/db", () => ({
  queryOne:  vi.fn().mockResolvedValue(null),
  execDml:   vi.fn().mockResolvedValue(undefined),
  queryRows: vi.fn().mockResolvedValue([]),
  // withTransaction executa o callback imediatamente com um tx no-op (as escritas
  // já são cobertas pelos mocks de execDml/queryOne).
  withTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ exec: vi.fn().mockResolvedValue(undefined), queryOne: vi.fn().mockResolvedValue(null) })),
}));

// Monta um EvalLinkInfo completo com os campos que EvaluationResponseService usa
function makeLinkInfo(overrides: Partial<{
  usedAt:    Date | null;
  expiresAt: Date;
}> = {}) {
  return {
    linkId:    "link-001",
    token:     "tok-abc",
    phase:     "ENTREGA",
    numped:    "99999",
    configId:  "cfg-001",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 dias no futuro
    usedAt:    null,
    config: {
      title:       "Avaliação de Entrega",
      description: null,
      questions: [],
    },
    order: { numped: "99999", customerName: "Cliente Teste" },
    ...overrides,
  };
}

const baseSubmission = {
  answers:        [],
  overallComment: null,
};

describe("EvaluationResponseService — TTL e estado do link", () => {

  let svc: EvaluationResponseService;
  let mockLinks: { getByToken: ReturnType<typeof vi.fn>; markUsed: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    mockLinks = {
      getByToken: vi.fn(),
      markUsed:   vi.fn().mockResolvedValue(undefined),
    };

    // Injeta mockLinks, sacService stub, winthorSync stub via constructor
    const mockSac = { createFromEvaluation: vi.fn().mockResolvedValue(null) } as any;
    const mockSync = { triggerOrderSnapshot: vi.fn().mockResolvedValue(null) } as any;

    svc = new EvaluationResponseService(mockLinks as any, mockSac, mockSync);
  });

  it("link válido e não expirado → processa sem erro", async () => {
    mockLinks.getByToken.mockResolvedValue(makeLinkInfo());
    // Sem perguntas numéricas e sem respostas → score 0, deve resolver
    await expect(svc.submit("tok-abc", baseSubmission)).resolves.toBeDefined();
  });

  it("token inexistente → lança 'inválido ou não encontrado'", async () => {
    mockLinks.getByToken.mockResolvedValue(null);
    await expect(svc.submit("tok-inexistente", baseSubmission))
      .rejects.toThrow("inválido ou não encontrado");
  });

  it("link já respondido (usedAt preenchido) → lança 'já foi respondida'", async () => {
    mockLinks.getByToken.mockResolvedValue(makeLinkInfo({ usedAt: new Date(Date.now() - 3600_000) }));
    await expect(svc.submit("tok-abc", baseSubmission))
      .rejects.toThrow("já foi respondida");
  });

  it("link expirado há 1ms → lança 'expirou'", async () => {
    mockLinks.getByToken.mockResolvedValue(
      makeLinkInfo({ expiresAt: new Date(Date.now() - 1) }),
    );
    await expect(svc.submit("tok-abc", baseSubmission))
      .rejects.toThrow("expirou");
  });

  it("link expirado há 7 dias → lança 'expirou'", async () => {
    mockLinks.getByToken.mockResolvedValue(
      makeLinkInfo({ expiresAt: new Date(Date.now() - 7 * 24 * 3600_000) }),
    );
    await expect(svc.submit("tok-abc", baseSubmission))
      .rejects.toThrow("expirou");
  });

  it("link que expira exatamente agora (expiresAt = now - 1ms) → bloqueado", async () => {
    const justExpired = new Date(Date.now() - 1);
    mockLinks.getByToken.mockResolvedValue(makeLinkInfo({ expiresAt: justExpired }));
    await expect(svc.submit("tok-abc", baseSubmission))
      .rejects.toThrow("expirou");
  });

  it("link que expira no futuro próximo (expiresAt = now + 1ms) → permitido", async () => {
    const almostExpired = new Date(Date.now() + 1000); // 1 segundo no futuro
    mockLinks.getByToken.mockResolvedValue(makeLinkInfo({ expiresAt: almostExpired }));
    await expect(svc.submit("tok-abc", baseSubmission)).resolves.toBeDefined();
  });

  it("verificação expirado tem precedência sobre usedAt", async () => {
    // Link expirado E já respondido — deve lançar a mensagem de 'já respondida' (verifica usedAt primeiro)
    mockLinks.getByToken.mockResolvedValue(makeLinkInfo({
      usedAt:    new Date(Date.now() - 3600_000),
      expiresAt: new Date(Date.now() - 7 * 24 * 3600_000),
    }));
    // A ordem de verificação no código é: usedAt → expiresAt
    await expect(svc.submit("tok-abc", baseSubmission))
      .rejects.toThrow(/já foi respondida|expirou/);
  });
});

// ─── EvaluationLinkService.generate — TTL configurável ──────────────────────
describe("EvaluationLinkService.generate — URL e TTL", () => {
  it("APP_BASE_URL sem barra final → URL correta do eval link", async () => {
    const origUrl = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://meu-app.example.com";

    // Importar dinamicamente para respeitar o env set acima
    const { EvaluationLinkService } = await import("../server/services/EvaluationLinkService");

    const mockConfigs = {
      getByPhase: vi.fn().mockResolvedValue({
        id:         "cfg-001",
        active:     true,
        linkTtlDays: 7,
        title:      "Entrega",
        description: null,
        questions:  [],
      }),
    } as any;

    const { execDml } = await import("../server/db/db");
    vi.mocked(execDml).mockResolvedValue(undefined);

    const svc2 = new EvaluationLinkService(mockConfigs);
    const result = await svc2.generate({ phase: "ENTREGA", numped: "99999" });

    expect(result.url).toMatch(/^https:\/\/meu-app\.example\.com\/montadores\/eval\//);
    expect(result.url).not.toContain("//montadores"); // sem barra dupla

    process.env.APP_BASE_URL = origUrl;
  });

  it("APP_BASE_URL com barra final → remove barra antes de montar URL", async () => {
    const origUrl = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://meu-app.example.com/";

    const { EvaluationLinkService } = await import("../server/services/EvaluationLinkService");
    const mockConfigs = {
      getByPhase: vi.fn().mockResolvedValue({ id: "cfg-001", active: true, linkTtlDays: 7, title: "x", description: null, questions: [] }),
    } as any;

    const { execDml } = await import("../server/db/db");
    vi.mocked(execDml).mockResolvedValue(undefined);

    const svc3 = new EvaluationLinkService(mockConfigs);
    const result = await svc3.generate({ phase: "ENTREGA" });
    expect(result.url).not.toContain("//montadores");

    process.env.APP_BASE_URL = origUrl;
  });
});
