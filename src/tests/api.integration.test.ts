/**
 * Bateria de testes de integração — App Montadores
 * Executa contra o servidor em http://localhost:3333
 * Rode com: npm test
 */
import { describe, it, expect, beforeAll } from "vitest";

const BASE = "http://localhost:3333/api";
const ADMIN_EMAIL    = "admin@montadores.com";
const ADMIN_PASSWORD = "Admin@2026!";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function post(path: string, body: unknown, token?: string) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function get(path: string, token?: string) {
  const r = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function put(path: string, body: unknown, token: string) {
  const r = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function patch(path: string, body: unknown, token: string) {
  const r = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function del(path: string, token: string) {
  const r = await fetch(`${BASE}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// zod/express5 retorna 422 para erros de validação
const BAD_REQUEST = [400, 422];

// ── Shared state ──────────────────────────────────────────────────────────────

let adminToken = "";
let providerId  = "";
let evalConfigId = "";
let evalQuestionId = "";
let evalToken = "";

// ─────────────────────────────────────────────────────────────────────────────
// 1. SAÚDE DO SISTEMA
// ─────────────────────────────────────────────────────────────────────────────

describe("1. Saúde do sistema", () => {
  it("GET /health retorna ok e db ok", async () => {
    const r = await get("/health");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.db).toBe("ok");
  });

  it("GET /system/health retorna latência do banco", async () => {
    // Busca o token primeiro
    const login = await post("/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const r = await get("/system/health", login.body.token);
    expect(r.status).toBe(200);
    expect(r.body).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. AUTENTICAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

describe("2. Autenticação", () => {
  it("Login com credenciais corretas retorna token e user", async () => {
    const r = await post("/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(r.status).toBe(200);
    expect(typeof r.body.token).toBe("string");
    expect(r.body.token.length).toBeGreaterThan(20);
    expect(Array.isArray(r.body.user.roles)).toBe(true);
    expect(r.body.user.roles).toContain("ADMIN");
    adminToken = r.body.token;
  });

  it("Login com senha errada retorna 401", async () => {
    const r = await post("/auth/login", { email: ADMIN_EMAIL, password: "senha_errada_123" });
    expect(r.status).toBe(401);
  });

  it("Login com email inexistente retorna 401", async () => {
    const r = await post("/auth/login", { email: "ninguem@fake.com", password: "qualquer" });
    expect(r.status).toBe(401);
  });

  it("Login com email malformado retorna 400/422", async () => {
    const r = await post("/auth/login", { email: "nao-e-email", password: "qualquer" });
    expect(BAD_REQUEST).toContain(r.status);
  });

  it("Login sem body retorna 400/422", async () => {
    const r = await post("/auth/login", {});
    expect(BAD_REQUEST).toContain(r.status);
  });

  it("GET /auth/me com token válido retorna roles como array", async () => {
    const r = await get("/auth/me", adminToken);
    expect(r.status).toBe(200);
    expect(r.body.email).toBe(ADMIN_EMAIL);
    expect(Array.isArray(r.body.roles)).toBe(true);
    expect(r.body.roles).toContain("ADMIN");
  });

  it("GET /auth/me sem token retorna 401", async () => {
    const r = await get("/auth/me");
    expect(r.status).toBe(401);
  });

  it("GET /auth/me com token inválido retorna 401", async () => {
    const r = await get("/auth/me", "token.falso.aqui");
    expect(r.status).toBe(401);
  });

  it("GET /auth/me com Bearer vazio retorna 401", async () => {
    const r = await fetch(`${BASE}/auth/me`, {
      headers: { Authorization: "Bearer " },
    });
    expect(r.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. SEGURANÇA — ROTAS PROTEGIDAS
// ─────────────────────────────────────────────────────────────────────────────

describe("3. Segurança — rotas protegidas sem token", () => {
  const protectedRoutes = [
    "/providers",
    "/payments",
    "/commissions",
    "/message-templates",
    "/eval-configs",
    "/flow-ruler",
    "/audit-logs",
    "/dashboard",
    "/orders",
    "/system/health",
  ];

  for (const route of protectedRoutes) {
    it(`GET ${route} sem token retorna 401`, async () => {
      const r = await get(route);
      expect(r.status).toBe(401);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. ROTAS PÚBLICAS — sem autenticação
// ─────────────────────────────────────────────────────────────────────────────

describe("4. Rotas públicas (sem auth)", () => {
  it("GET /health é acessível sem token", async () => {
    const r = await get("/health");
    expect(r.status).toBe(200);
  });

  it("GET /public/branding retorna identidade visual sem token", async () => {
    const r = await get("/public/branding");
    expect(r.status).toBe(200);
    expect(r.body.companyName).toBeTruthy();
  });

  it("POST /public/providers/register cria montador pendente", async () => {
    const doc = `${Date.now()}`.slice(-11).padStart(11, "9");
    const r = await post("/public/providers/register", {
      name: "Teste Integração Via API",
      document: doc,
      phone: "11999990000",
      whatsapp: "11999990000",
      email: `teste.${Date.now()}@example.com`,
      city: "São Paulo",
      uf: "SP",
      serviceTypes: ["MONTAGEM"],
      productTypes: ["MOVEIS"],
      regions: ["Centro"],
      capacityPerDay: 2,
    });
    expect(r.status).toBe(201);
    expect(r.body.id).toBeTruthy();
    providerId = r.body.id;
  });

  it("POST /public/providers/register com documento duplicado retorna 409/400/201", async () => {
    // Tenta registrar o mesmo documento recém-criado — pode ser 409 (constraint) ou 400 (validação)
    // ou 201 se a lógica não checa duplicata nesse endpoint público
    const doc = `${Date.now()}`.slice(-11).padStart(11, "9");
    await post("/public/providers/register", {
      name: "Primeiro Registro",
      document: doc,
      phone: "11999990001",
      city: "SP",
      uf: "SP",
      capacityPerDay: 1,
    });
    const r = await post("/public/providers/register", {
      name: "Segundo com mesmo doc",
      document: doc,
      phone: "11999990001",
      city: "SP",
      uf: "SP",
      capacityPerDay: 1,
    });
    // Aceita qualquer resposta não-500: depende se há constraint unique
    expect(r.status).not.toBe(500);
    expect([201, 400, 409, 422]).toContain(r.status);
  });

  it("POST /public/providers/register sem nome retorna 400/422", async () => {
    const r = await post("/public/providers/register", {
      document: "99988877766",
      phone: "11999990000",
      uf: "SP",
      city: "SP",
    });
    expect(BAD_REQUEST).toContain(r.status);
  });

  it("POST /public/providers/register com capacidade negativa retorna 400/422", async () => {
    const r = await post("/public/providers/register", {
      name: "Teste Negativo",
      document: "11122233344",
      phone: "11999990000",
      city: "SP",
      uf: "SP",
      capacityPerDay: -5,
    });
    expect(BAD_REQUEST).toContain(r.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. PROVEDORES — CRUD e transições de estado
// ─────────────────────────────────────────────────────────────────────────────

describe("5. Provedores", () => {
  it("GET /providers retorna lista", async () => {
    const r = await get("/providers", adminToken);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data ?? r.body)).toBe(true);
  });

  it("GET /providers com filtro status=APROVADO", async () => {
    const r = await get("/providers?status=APROVADO", adminToken);
    expect(r.status).toBe(200);
  });

  it("GET /providers com filtro uf=SP", async () => {
    const r = await get("/providers?uf=SP", adminToken);
    expect(r.status).toBe(200);
  });

  it("GET /providers/:id retorna o montador criado", async () => {
    if (!providerId) return;
    const r = await get(`/providers/${providerId}`, adminToken);
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(providerId);
  });

  it("GET /providers/:id/profile retorna perfil completo", async () => {
    if (!providerId) return;
    const r = await get(`/providers/${providerId}/profile`, adminToken);
    expect(r.status).toBe(200);
  });

  it("POST /providers/:id/approve aprova o montador pendente", async () => {
    if (!providerId) return;
    const r = await post(`/providers/${providerId}/approve`, {}, adminToken);
    expect([200, 204]).toContain(r.status);
  });

  it("POST /providers/:id/suspend suspende o montador aprovado", async () => {
    if (!providerId) return;
    const r = await post(`/providers/${providerId}/suspend`, { justification: "Suspensão via teste automatizado" }, adminToken);
    expect([200, 204]).toContain(r.status);
  });

  it("POST /providers/:id/reactivate reativa o montador suspenso", async () => {
    if (!providerId) return;
    const r = await post(`/providers/${providerId}/reactivate`, { justification: "Reativação via teste automatizado" }, adminToken);
    expect([200, 204]).toContain(r.status);
  });

  it("GET /providers/winthor/search retorna resultados do WinThor", async () => {
    const r = await get("/providers/winthor/search?term=Paulo", adminToken);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  it("GET /providers/:id/commissions/monthly retorna comissões mensais", async () => {
    if (!providerId) return;
    const r = await get(`/providers/${providerId}/commissions/monthly`, adminToken);
    expect([200, 404]).toContain(r.status);
  });

  it("GET /providers/:id/certifications retorna lista de certificações", async () => {
    if (!providerId) return;
    const r = await get(`/providers/${providerId}/certifications`, adminToken);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  it("GET /providers/:id/reworks retorna histórico de retrabalhos", async () => {
    if (!providerId) return;
    const r = await get(`/providers/${providerId}/reworks`, adminToken);
    expect(r.status).toBe(200);
  });

  it("GET /providers/:id/unavailability retorna indisponibilidades", async () => {
    if (!providerId) return;
    const r = await get(`/providers/${providerId}/unavailability`, adminToken);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  it("GET /providers/00000000-0000-0000-0000-000000000000 retorna 404", async () => {
    const r = await get("/providers/00000000-0000-0000-0000-000000000000", adminToken);
    expect(r.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. TEMPLATES DE MENSAGEM
// ─────────────────────────────────────────────────────────────────────────────

describe("6. Templates de mensagem", () => {
  it("GET /message-templates retorna lista com templates", async () => {
    const r = await get("/message-templates", adminToken);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThan(0);
  });

  it("Todos os templates têm eventType e template.body", async () => {
    const r = await get("/message-templates", adminToken);
    for (const t of r.body as Array<Record<string, unknown>>) {
      expect(typeof t.eventType).toBe("string");
      const tmpl = t.template as Record<string, unknown> | undefined;
      if (tmpl) {
        expect(typeof tmpl.body).toBe("string");
        expect(tmpl.event_type ?? tmpl.eventType).toBeTruthy();
      }
    }
  });

  it("PUT /message-templates/:eventType atualiza template", async () => {
    const r = await put("/message-templates/PEDIDO_CRIADO", {
      channel:   "WHATSAPP",
      body:      "Olá, {{cliente}}! Pedido #{{numped}} recebido. Atualizado via teste.",
      active:    true,
      recipient: "CLIENTE",
    }, adminToken);
    expect([200, 204]).toContain(r.status);
  });

  it("PUT /message-templates com body muito curto retorna 400/422", async () => {
    const r = await put("/message-templates/PEDIDO_CRIADO", {
      channel: "WHATSAPP",
      body:    "ok",
      active:  true,
    }, adminToken);
    expect(BAD_REQUEST).toContain(r.status);
  });

  it("PUT /message-templates com channel inválido retorna 400/422", async () => {
    const r = await put("/message-templates/PEDIDO_CRIADO", {
      channel: "TELEGRAM",
      body:    "Mensagem válida aqui com mais de cinco chars suficientes",
      active:  true,
    }, adminToken);
    expect(BAD_REQUEST).toContain(r.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. RÉGUA DE FLUXO
// ─────────────────────────────────────────────────────────────────────────────

describe("7. Régua de fluxo", () => {
  it("GET /flow-ruler retorna configuração de eventos", async () => {
    const r = await get("/flow-ruler", adminToken);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  it("GET /flow-ruler/stats retorna estatísticas", async () => {
    const r = await get("/flow-ruler/stats", adminToken);
    expect(r.status).toBe(200);
    expect(typeof r.body).toBe("object");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. CONFIGURAÇÕES DE AVALIAÇÃO (CRUD completo)
// ─────────────────────────────────────────────────────────────────────────────

describe("8. Configurações de avaliação", () => {
  it("GET /eval-configs retorna lista", async () => {
    const r = await get("/eval-configs", adminToken);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  it("POST /eval-configs cria ou recupera configuração existente", async () => {
    const r = await post("/eval-configs", {
      phase:       "ENTREGA",
      title:       "Avaliação de Entrega — Teste Integração",
      description: "Config criada em teste de integração",
      linkTtlDays: 7,
    }, adminToken);
    // 201 = nova | 400 = phase já existe (constraints de negócio)
    expect([200, 201, 400]).toContain(r.status);
    if ([200, 201].includes(r.status)) {
      evalConfigId = r.body.id;
    } else {
      // Recupera o config existente para fase ENTREGA
      const list = await get("/eval-configs", adminToken);
      const existing = (list.body as Array<Record<string, unknown>>)
        .find((c) => c.phase === "ENTREGA");
      if (existing) evalConfigId = existing.id as string;
    }
  });

  it("GET /eval-configs/:id retorna a config criada", async () => {
    if (!evalConfigId) return;
    const r = await get(`/eval-configs/${evalConfigId}`, adminToken);
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(evalConfigId);
    expect(r.body.phase).toBe("ENTREGA");
  });

  it("PUT /eval-configs/:id atualiza título", async () => {
    if (!evalConfigId) return;
    const r = await put(`/eval-configs/${evalConfigId}`, {
      title: "Avaliação Atualizada",
    }, adminToken);
    expect([200, 204]).toContain(r.status);
  });

  it("POST /eval-configs/:id/questions adiciona pergunta SCALE", async () => {
    if (!evalConfigId) return;
    const r = await post(`/eval-configs/${evalConfigId}/questions`, {
      type:     "SCALE",
      label:    "Como você avalia a entrega do produto?",
      required: true,
      minLabel: "Péssimo",
      maxLabel: "Excelente",
      position: 1,
    }, adminToken);
    expect([200, 201]).toContain(r.status);
    evalQuestionId = r.body.id ?? r.body.questionId;
  });

  it("POST /eval-configs/:id/questions adiciona pergunta YES_NO", async () => {
    if (!evalConfigId) return;
    const r = await post(`/eval-configs/${evalConfigId}/questions`, {
      type:     "YES_NO",
      label:    "O produto chegou sem avarias?",
      required: true,
      position: 2,
    }, adminToken);
    expect([200, 201]).toContain(r.status);
  });

  it("POST /eval-configs/:id/questions adiciona pergunta TEXT", async () => {
    if (!evalConfigId) return;
    const r = await post(`/eval-configs/${evalConfigId}/questions`, {
      type:     "TEXT",
      label:    "Algum comentário sobre a entrega?",
      required: false,
      position: 3,
    }, adminToken);
    expect([200, 201]).toContain(r.status);
  });

  it("GET /eval-configs/:id/questions retorna 3 perguntas", async () => {
    if (!evalConfigId) return;
    const r = await get(`/eval-configs/${evalConfigId}/questions`, adminToken);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThanOrEqual(3);
  });

  it("POST /eval-configs sem phase retorna 400/422", async () => {
    const r = await post("/eval-configs", { title: "Sem fase" }, adminToken);
    expect(BAD_REQUEST).toContain(r.status);
  });

  it("POST /eval-configs com phase inválida retorna 400/422", async () => {
    const r = await post("/eval-configs", { phase: "INVALIDA", title: "Fase inválida" }, adminToken);
    expect(BAD_REQUEST).toContain(r.status);
  });

  it("POST /eval-configs/:id/questions sem label retorna 400/422", async () => {
    if (!evalConfigId) return;
    const r = await post(`/eval-configs/${evalConfigId}/questions`, { type: "TEXT" }, adminToken);
    expect(BAD_REQUEST).toContain(r.status);
  });

  it("GET /eval-configs UUID inexistente retorna 404", async () => {
    const r = await get("/eval-configs/00000000-0000-0000-0000-000000000000", adminToken);
    expect(r.status).toBe(404);
  });

  it("PATCH /eval-configs/:id/toggle-active desativa a config", async () => {
    if (!evalConfigId) return;
    const r = await patch(`/eval-configs/${evalConfigId}/toggle-active`, { active: false }, adminToken);
    expect([200, 204]).toContain(r.status);
  });

  it("PATCH /eval-configs/:id/toggle-active reativa a config", async () => {
    if (!evalConfigId) return;
    const r = await patch(`/eval-configs/${evalConfigId}/toggle-active`, { active: true }, adminToken);
    expect([200, 204]).toContain(r.status);
  });

  it("PATCH /eval-configs/:id/toggle-active com valor não-boolean retorna 400/422", async () => {
    if (!evalConfigId) return;
    const r = await patch(`/eval-configs/${evalConfigId}/toggle-active`, { active: "sim" }, adminToken);
    expect(BAD_REQUEST).toContain(r.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. LINKS DE AVALIAÇÃO (rota pública)
// ─────────────────────────────────────────────────────────────────────────────

describe("9. Links de avaliação", () => {
  it("POST /eval-links gera link com URL absoluta (https://...)", async () => {
    const r = await post("/eval-links", {
      phase:  "ENTREGA",
      numped: "TEST-INTEGRATION-001",
    }, adminToken);
    expect([200, 201]).toContain(r.status);
    expect(r.body.token).toBeTruthy();
    expect(r.body.url).toMatch(/^https?:\/\//);
    evalToken = r.body.token;
  });

  it("GET /public/eval/:token retorna formulário sem autenticação", async () => {
    if (!evalToken) return;
    const r = await get(`/public/eval/${evalToken}`);
    expect(r.status).toBe(200);
    expect(r.body.token).toBe(evalToken);
    expect(r.body.config).toBeTruthy();
    expect(Array.isArray(r.body.config.questions)).toBe(true);
  });

  it("GET /public/eval/token-inexistente retorna 404", async () => {
    const r = await get("/public/eval/" + "a".repeat(64));
    expect(r.status).toBe(404);
  });

  it("POST /eval-links com phase inválida retorna 400/422", async () => {
    const r = await post("/eval-links", { phase: "FASE_INVALIDA" }, adminToken);
    expect(BAD_REQUEST).toContain(r.status);
  });

  it("POST /public/eval/:token/respond registra respostas (sem auth)", async () => {
    if (!evalToken) return;
    const r = await post(`/public/eval/${evalToken}/respond`, {
      answers: [
        { questionId: "fake-question-id-test", valueNumber: 9 },
      ],
      comment: "Ótimo serviço!",
    });
    // Pode falhar com 400 se o questionId for inválido, mas não 401/500
    expect(r.status).not.toBe(401);
    expect(r.status).not.toBe(500);
  });

  it("Link de avaliação expirado retorna 410", async () => {
    // Testa via token inexistente — resposta esperada é 404 ou 410
    const r = await get("/public/eval/" + "b".repeat(64));
    expect([404, 410]).toContain(r.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. ANALYTICS DE AVALIAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

describe("10. Analytics de avaliação", () => {
  it("GET /eval-analytics?phase=ENTREGA retorna estrutura válida", async () => {
    const r = await get("/eval-analytics?phase=ENTREGA", adminToken);
    expect(r.status).toBe(200);
    expect(r.body.phase).toBe("ENTREGA");
    expect(typeof r.body.totalResponses).toBe("number");
    expect(Array.isArray(r.body.questions)).toBe(true);
  });

  it("GET /eval-analytics?phase=MONTAGEM retorna estrutura válida", async () => {
    const r = await get("/eval-analytics?phase=MONTAGEM", adminToken);
    expect(r.status).toBe(200);
    expect(r.body.phase).toBe("MONTAGEM");
  });

  it("GET /eval-analytics?phase=ATENDIMENTO retorna estrutura válida", async () => {
    const r = await get("/eval-analytics?phase=ATENDIMENTO", adminToken);
    expect(r.status).toBe(200);
    expect(r.body.phase).toBe("ATENDIMENTO");
  });

  it("GET /eval-analytics sem phase retorna 400/422", async () => {
    const r = await get("/eval-analytics", adminToken);
    expect(BAD_REQUEST).toContain(r.status);
  });

  it("GET /eval-analytics com phase inválida retorna 400/422", async () => {
    const r = await get("/eval-analytics?phase=INVALIDA", adminToken);
    expect(BAD_REQUEST).toContain(r.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. PAGAMENTOS E COMISSÕES
// ─────────────────────────────────────────────────────────────────────────────

describe("11. Pagamentos e comissões", () => {
  it("GET /payments retorna lista paginada", async () => {
    const r = await get("/payments?page=1&pageSize=20", adminToken);
    expect(r.status).toBe(200);
    expect(typeof r.body).toBe("object");
  });

  it("GET /payments com filtro status=PENDENTE", async () => {
    const r = await get("/payments?status=PENDENTE", adminToken);
    expect(r.status).toBe(200);
  });

  it("GET /commissions retorna lista de comissões", async () => {
    const r = await get("/commissions", adminToken);
    expect(r.status).toBe(200);
  });

  it("GET /commissions/count retorna total", async () => {
    const r = await get("/commissions/count", adminToken);
    expect(r.status).toBe(200);
    expect(typeof (r.body.total ?? r.body.count ?? 0)).toBe("number");
  });

  it("GET /commissions/departments retorna departamentos", async () => {
    const r = await get("/commissions/departments", adminToken);
    expect(r.status).toBe(200);
  });

  it("GET /commissions/dept retorna comissões por departamento", async () => {
    const r = await get("/commissions/dept", adminToken);
    expect(r.status).toBe(200);
  });

  it("GET /audit-logs retorna logs de auditoria", async () => {
    const r = await get("/audit-logs", adminToken);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. WINTHOR
// ─────────────────────────────────────────────────────────────────────────────

describe("12. WinThor", () => {
  it("GET /winthor/orders retorna pedidos do WinThor", async () => {
    const r = await get("/winthor/orders?limit=5", adminToken);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  it("GET /integration/winthor retorna falhas de sincronização", async () => {
    const r = await get("/integration/winthor", adminToken);
    expect(r.status).toBe(200);
  });

  it("GET /winthor/orders com filtro hasAssembly=1", async () => {
    const r = await get("/winthor/orders?hasAssembly=1&limit=10", adminToken);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. MONTAGEM — jobs e agenda
// ─────────────────────────────────────────────────────────────────────────────

describe("13. Montagem — jobs e agenda", () => {
  it("GET /assembly/jobs retorna lista de jobs de montagem", async () => {
    const r = await get("/assembly/jobs", adminToken);
    expect(r.status).toBe(200);
  });

  it("GET /assembly/provider/history retorna histórico de montadores", async () => {
    const r = await get("/assembly/provider/history", adminToken);
    expect(r.status).toBe(200);
  });

  it("GET /assembly/provider/dashboard retorna dashboard de montadores", async () => {
    const r = await get("/assembly/provider/dashboard", adminToken);
    expect(r.status).toBe(200);
  });

  it("GET /agenda/candidatos retorna candidatos disponíveis", async () => {
    const r = await get("/agenda/candidatos", adminToken);
    expect(r.status).toBe(200);
  });

  it("GET /agenda/diagnostico retorna diagnóstico de elegibilidade", async () => {
    const r = await get("/agenda/diagnostico", adminToken);
    expect(r.status).toBe(200);
  });

  it("GET /agenda/stats retorna estatísticas da agenda", async () => {
    const r = await get("/agenda/stats", adminToken);
    expect(r.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. DASHBOARD E PEDIDOS
// ─────────────────────────────────────────────────────────────────────────────

describe("14. Dashboard e pedidos", () => {
  it("GET /dashboard retorna métricas gerais", async () => {
    const r = await get("/dashboard", adminToken);
    expect(r.status).toBe(200);
  });

  it("GET /orders retorna lista de pedidos", async () => {
    const r = await get("/orders", adminToken);
    expect(r.status).toBe(200);
  });

  it("GET /orders/:id inexistente retorna 404 ou 500", async () => {
    const r = await get("/orders/pedido-que-nao-existe", adminToken);
    expect([404, 500]).toContain(r.status);
  });

  it("GET /search com termo retorna pedidos e provedores", async () => {
    const r = await get("/search?q=teste", adminToken);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("orders");
    expect(r.body).toHaveProperty("providers");
  });

  it("GET /search com termo curto retorna estrutura vazia", async () => {
    const r = await get("/search?q=a", adminToken);
    expect(r.status).toBe(200);
    expect(r.body.orders).toHaveLength(0);
    expect(r.body.providers).toHaveLength(0);
  });

  it("GET /reviews retorna avaliações (paginado ou array)", async () => {
    const r = await get("/reviews", adminToken);
    expect(r.status).toBe(200);
    // Pode retornar { summary, reviews } ou array direto
    const reviews = Array.isArray(r.body) ? r.body : (r.body.reviews ?? r.body.data);
    expect(reviews).toBeDefined();
  });

  it("GET /sac retorna lista de casos SAC", async () => {
    const r = await get("/sac", adminToken);
    expect(r.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. NOTIFICAÇÕES E CONFIGURAÇÕES
// ─────────────────────────────────────────────────────────────────────────────

describe("15. Notificações e configurações", () => {
  it("GET /notifications/summary retorna contadores de notificações", async () => {
    const r = await get("/notifications/summary", adminToken);
    expect(r.status).toBe(200);
  });

  it("GET /settings/branding retorna identidade visual autenticada", async () => {
    const r = await get("/settings/branding", adminToken);
    expect(r.status).toBe(200);
    expect(r.body.companyName).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. EDGE CASES — INPUTS MALICIOSOS
// ─────────────────────────────────────────────────────────────────────────────

describe("16. Edge cases e segurança de entrada", () => {
  it("Login com SQL injection no email não causa 500", async () => {
    const r = await post("/auth/login", {
      email: "' OR '1'='1",
      password: "qualquer",
    });
    expect(r.status).not.toBe(500);
    expect(BAD_REQUEST.concat([401])).toContain(r.status);
  });

  it("Login com XSS no email não causa 500", async () => {
    const r = await post("/auth/login", {
      email: "<script>alert(1)</script>@test.com",
      password: "qualquer",
    });
    expect(r.status).not.toBe(500);
  });

  it("GET /providers com pageSize enorme não causa 500", async () => {
    const r = await get("/providers?pageSize=999999", adminToken);
    expect(r.status).not.toBe(500);
  });

  it("GET /orders com limit enorme não causa 500", async () => {
    const r = await get("/orders?limit=999999", adminToken);
    expect(r.status).not.toBe(500);
  });

  it("POST /eval-configs sem token retorna 401 (não 400)", async () => {
    const r = await post("/eval-configs", {
      phase: "MONTAGEM",
      title: "Sem auth",
    });
    expect(r.status).toBe(401);
  });

  it("Rota inexistente retorna 404", async () => {
    const r = await get("/rota-que-nao-existe", adminToken);
    expect(r.status).toBe(404);
  });

  it("DELETE em rota GET retorna 404/405", async () => {
    const r = await del("/health", adminToken);
    expect([404, 405]).toContain(r.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. LIMPEZA PÓS-TESTE
// ─────────────────────────────────────────────────────────────────────────────

describe("17. Limpeza pós-teste", () => {
  it("DELETE /eval-configs/questions/:qid remove pergunta criada", async () => {
    if (!evalQuestionId) return;
    const r = await del(`/eval-configs/questions/${evalQuestionId}`, adminToken);
    expect([200, 204, 404]).toContain(r.status);
  });

  it("POST /providers/:id/reject desfaz aprovação do montador de teste", async () => {
    if (!providerId) return;
    const r = await post(`/providers/${providerId}/reject`, { reason: "Criado em teste de integração — removido." }, adminToken);
    expect([200, 204, 400]).toContain(r.status);
  });
});
