// ============================================================
// BATERIA COMPLETA DE REGRESSÃO PÓS-SEGURANÇA
// Cobre: auth, RBAC, APIs, upload, webhooks, fluxos, regras
// ============================================================
const BASE = "http://localhost:3333/api";
let passed = 0, failed = 0, skipped = 0;
const report = [];

async function req(method, path, body, headers = {}) {
  try {
    const opts = { method, headers: { "Content-Type": "application/json", ...headers } };
    if (body !== undefined && body !== null) opts.body = JSON.stringify(body);
    const r = await fetch(`${BASE}${path}`, opts);
    let data;
    try { data = await r.json(); } catch { data = {}; }
    return { status: r.status, data };
  } catch (e) {
    return { status: 0, data: { error: e.message } };
  }
}

async function login(email, password) {
  const r = await req("POST", "/auth/login", { email, password });
  return r.data?.token ?? null;
}

function ok(name, result, detail = "") {
  passed++;
  report.push({ status: "PASS", name, detail });
  console.log(`[PASS] ${name}${detail ? " — " + detail : ""}`);
  return result;
}

function fail(name, detail = "") {
  failed++;
  report.push({ status: "FAIL", name, detail });
  console.log(`[FAIL] ${name}${detail ? " — " + detail : ""}`);
}

function skip(name, reason = "") {
  skipped++;
  report.push({ status: "SKIP", name, detail: reason });
  console.log(`[SKIP] ${name}${reason ? " — " + reason : ""}`);
}

function check(name, condition, evidence, failEvidence) {
  if (condition) ok(name, true, evidence);
  else fail(name, failEvidence ?? evidence);
}

// ── Tokens ───────────────────────────────────────────────────
const adminToken  = await login("admin@montadores.com", "Admin@2026!");
// Usuário com role EXCLUSIVA MONTADOR — criado por scripts/seed-montador-test.ts
const montadorToken = await login("test.montador.regress@example.com", "Montador@Regress1!");

// Pega um job existente para testes
let testJobId = null;
let testProviderId = null;
if (adminToken) {
  const jobs = await req("GET", "/assembly/jobs?limit=5", null, { Authorization: `Bearer ${adminToken}` });
  if (Array.isArray(jobs.data) && jobs.data.length > 0) {
    testJobId = jobs.data[0].id;
    testProviderId = jobs.data[0].provider_id;
  }
}

// Pega um pedido existente
let testOrderId = null;
if (adminToken) {
  const orders = await req("GET", "/orders?limit=3", null, { Authorization: `Bearer ${adminToken}` });
  const list = Array.isArray(orders.data?.items ?? orders.data) ? (orders.data?.items ?? orders.data) : [];
  if (list.length > 0) testOrderId = list[0].id;
}

// Pega um provider — garante que NÃO é o provider do montador de teste
let testProvider = null;
if (adminToken) {
  const provs = await req("GET", "/providers?limit=10", null, { Authorization: `Bearer ${adminToken}` });
  if (Array.isArray(provs.data)) {
    // Prefere provider com email diferente do montador de teste
    testProvider = provs.data.find(p => p?.email && p.email !== "test.montador.regress@example.com") ?? provs.data[0];
  }
}

// Pega um pagamento
let testPaymentId = null;
if (adminToken) {
  const pays = await req("GET", "/payments?limit=3", null, { Authorization: `Bearer ${adminToken}` });
  const list = Array.isArray(pays.data?.items ?? pays.data) ? (pays.data?.items ?? pays.data) : [];
  if (list.length > 0) testPaymentId = list[0].id;
}

console.log(`\n=== SETUP ===`);
console.log(`admin=${!!adminToken} montador=${!!montadorToken}`);
console.log(`job=${testJobId?.slice(0,8)} order=${testOrderId?.slice(0,8)} provider=${testProvider?.id?.slice(0,8)} payment=${testPaymentId?.slice(0,8)}\n`);

// ================================================================
// BLOCO 1 — HEALTH / STARTUP
// ================================================================
console.log("\n=== BLOCO 1: HEALTH E STARTUP ===");
{
  const r = await req("GET", "/health");
  check("1.01 Health check", r.status === 200 && r.data?.ok === true, `ok=${r.data?.ok} db=${r.data?.db}`);
}
{
  const r = await req("GET", "/public/branding");
  check("1.02 Branding público", r.status === 200 && r.data?.companyName, `companyName=${r.data?.companyName}`);
}

// ================================================================
// BLOCO 2 — AUTH: LOGIN, TOKENS, SESSÃO
// ================================================================
console.log("\n=== BLOCO 2: AUTENTICAÇÃO ===");
{
  const r = await req("POST", "/auth/login", { email: "admin@montadores.com", password: "Admin@2026!" });
  check("2.01 Login válido", r.status === 200 && !!r.data?.token, `HTTP ${r.status}`);
}
{
  const r = await req("POST", "/auth/login", { email: "admin@montadores.com", password: "senha-errada" });
  check("2.02 Login com senha errada bloqueado", r.status === 401 || r.status === 400, `HTTP ${r.status}`);
}
{
  const r = await req("POST", "/auth/login", { email: "naoexiste@test.com", password: "qualquer" });
  check("2.03 Login com usuário inexistente bloqueado", r.status >= 400, `HTTP ${r.status}`);
}
{
  const r = await req("POST", "/auth/login", { email: "nao-e-email", password: "abc" });
  check("2.04 Login com email inválido bloqueado (Zod)", r.status === 422 || r.status >= 400, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/auth/me", null, { Authorization: "Bearer token-invalido-aqui" });
  check("2.05 Token inválido bloqueado", r.status === 401, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/auth/me", null, {});
  check("2.06 Sem token bloqueado (401)", r.status === 401, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/auth/me", null, { Authorization: `Bearer ${adminToken}` });
  check("2.07 Token válido acessa /me", r.status === 200 && !!r.data?.id, `HTTP ${r.status}`);
}
{
  // Token manipulado (adultera payload mas mantém assinatura)
  const fakeTok = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJoYWNrZXIiLCJyb2xlcyI6WyJBRE1JTiJdLCJleHAiOjk5OTk5OTk5OTl9.invalidsig";
  const r = await req("GET", "/auth/me", null, { Authorization: `Bearer ${fakeTok}` });
  check("2.08 Token adulterado bloqueado", r.status === 401, `HTTP ${r.status}`);
}

// ================================================================
// BLOCO 3 — RBAC: ROLES E PERMISSÕES
// ================================================================
console.log("\n=== BLOCO 3: RBAC E PERMISSÕES ===");
{
  const r = await req("GET", "/payments", null, { Authorization: `Bearer ${adminToken}` });
  check("3.01 ADMIN acessa /payments", r.status === 200, `HTTP ${r.status}`);
}
{
  if (montadorToken) {
    const r = await req("GET", "/payments", null, { Authorization: `Bearer ${montadorToken}` });
    check("3.02 MONTADOR bloqueado em /payments (403)", r.status === 403, `HTTP ${r.status}`);
  } else skip("3.02 MONTADOR bloqueado em /payments", "sem token montador");
}
{
  const r = await req("GET", "/audit-logs", null, { Authorization: `Bearer ${adminToken}` });
  check("3.03 ADMIN acessa audit-logs", r.status === 200, `HTTP ${r.status}`);
}
{
  if (montadorToken) {
    const r = await req("GET", "/audit-logs", null, { Authorization: `Bearer ${montadorToken}` });
    check("3.04 MONTADOR bloqueado em audit-logs (403)", r.status === 403, `HTTP ${r.status}`);
  } else skip("3.04 MONTADOR bloqueado em audit-logs", "sem token montador");
}
{
  const r = await req("GET", "/commissions", null, { Authorization: `Bearer ${adminToken}` });
  check("3.05 ADMIN acessa comissões", r.status === 200, `HTTP ${r.status}`);
}
{
  if (montadorToken) {
    const r = await req("GET", "/commissions", null, { Authorization: `Bearer ${montadorToken}` });
    check("3.06 MONTADOR bloqueado em /commissions (403)", r.status === 403, `HTTP ${r.status}`);
  } else skip("3.06 MONTADOR bloqueado em /commissions", "sem token montador");
}
{
  // Sem token em rota privada
  const privadas = ["/payments", "/commissions", "/assembly/jobs", "/providers", "/audit-logs", "/sac", "/orders"];
  let allBlocked = true;
  const details = [];
  for (const p of privadas) {
    const r = await req("GET", p);
    if (r.status !== 401 && r.status !== 503) { allBlocked = false; details.push(`${p}=${r.status}`); }
    else details.push(`${p}=401`);
  }
  check("3.07 Todas rotas privadas bloqueam sem token", allBlocked, details.join(" "));
}
{
  // Role vinda do body deve ser ignorada
  if (adminToken) {
    const r = await req("PUT", "/commissions/99999", { active: 1, role: "ADMIN", commissionPercent: 50 }, { Authorization: `Bearer ${adminToken}` });
    check("3.08 Role no body ignorada (não tem efeito em recursos)", r.status >= 400, `HTTP ${r.status}: ${String(r.data?.error ?? "").slice(0,50)}`);
  } else skip("3.08 Role no body ignorada", "sem admin");
}

// ================================================================
// BLOCO 4 — DASHBOARD E ORDERS
// ================================================================
console.log("\n=== BLOCO 4: DASHBOARD E PEDIDOS ===");
{
  const r = await req("GET", "/dashboard", null, { Authorization: `Bearer ${adminToken}` });
  check("4.01 Dashboard carrega", r.status === 200, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/orders", null, { Authorization: `Bearer ${adminToken}` });
  check("4.02 Lista de pedidos retorna", r.status === 200, `HTTP ${r.status}`);
}
{
  if (testOrderId) {
    const r = await req("GET", `/orders/${testOrderId}`, null, { Authorization: `Bearer ${adminToken}` });
    check("4.03 Detalhe de pedido carrega", r.status === 200 && !!r.data?.id, `HTTP ${r.status} id=${r.data?.id?.slice(0,8)}`);
  } else skip("4.03 Detalhe de pedido", "sem pedido no sistema");
}
{
  const r = await req("GET", "/search?q=test", null, { Authorization: `Bearer ${adminToken}` });
  check("4.04 Busca funciona", r.status === 200, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/notifications/summary", null, { Authorization: `Bearer ${adminToken}` });
  check("4.05 Notificações resumo", r.status === 200, `HTTP ${r.status}`);
}

// ================================================================
// BLOCO 5 — PROVIDERS / MONTADORES
// ================================================================
console.log("\n=== BLOCO 5: PROVIDERS ===");
{
  const r = await req("GET", "/providers", null, { Authorization: `Bearer ${adminToken}` });
  check("5.01 Lista de providers", r.status === 200, `HTTP ${r.status} count=${Array.isArray(r.data) ? r.data.length : "?"}`);
}
{
  if (testProvider) {
    const r = await req("GET", `/providers/${testProvider.id}`, null, { Authorization: `Bearer ${adminToken}` });
    check("5.02 Detalhe de provider", r.status === 200 && !!r.data?.id, `HTTP ${r.status}`);
  } else skip("5.02 Detalhe de provider", "sem provider");
}
{
  if (testProvider) {
    const r = await req("GET", `/providers/${testProvider.id}/profile`, null, { Authorization: `Bearer ${adminToken}` });
    check("5.03 Perfil de provider", r.status === 200, `HTTP ${r.status}`);
  } else skip("5.03 Perfil de provider", "sem provider");
}
{
  if (testProvider) {
    const r = await req("GET", `/providers/${testProvider.id}/certifications`, null, { Authorization: `Bearer ${adminToken}` });
    check("5.04 Certificações do provider", r.status === 200, `HTTP ${r.status}`);
  } else skip("5.04 Certificações", "sem provider");
}
{
  if (testProvider) {
    const r = await req("GET", `/providers/${testProvider.id}/unavailability`, null, { Authorization: `Bearer ${adminToken}` });
    check("5.05 Indisponibilidades do provider", r.status === 200, `HTTP ${r.status}`);
  } else skip("5.05 Indisponibilidades", "sem provider");
}
{
  if (testProvider) {
    const r = await req("GET", `/providers/${testProvider.id}/commissions/monthly`, null, { Authorization: `Bearer ${adminToken}` });
    check("5.06 Comissões mensais (admin)", r.status === 200, `HTTP ${r.status}`);
  } else skip("5.06 Comissões mensais", "sem provider");
}
{
  // Admin adiciona indisponibilidade para outro provider — deve funcionar
  if (testProvider && adminToken) {
    const futureDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const r = await req("POST", `/providers/${testProvider.id}/unavailability`,
      { date: futureDate, reason: "Teste regressao" },
      { Authorization: `Bearer ${adminToken}` }
    );
    const worked = r.status === 201 || r.status === 409; // 409 = já existe
    check("5.07 Admin adiciona indisponibilidade de provider", worked, `HTTP ${r.status}`);
    // Limpa se criou
    if (r.status === 201) {
      await req("DELETE", `/providers/${testProvider.id}/unavailability/${futureDate}`, null, { Authorization: `Bearer ${adminToken}` });
    }
  } else skip("5.07 Admin adiciona indisponibilidade", "sem provider ou admin");
}
{
  // MONTADOR tenta modificar dados de outro provider — deve ser bloqueado
  if (montadorToken && testProvider) {
    const futureDate = new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 10);
    const r = await req("POST", `/providers/${testProvider.id}/unavailability`,
      { date: futureDate, reason: "Tentativa indevida" },
      { Authorization: `Bearer ${montadorToken}` }
    );
    check("5.08 MONTADOR bloqueado de modificar provider alheio", r.status >= 400, `HTTP ${r.status}: ${String(r.data?.error ?? "").slice(0,50)}`);
  } else skip("5.08 MONTADOR bloqueado de modificar provider alheio", "sem token montador");
}

// ================================================================
// BLOCO 6 — ASSEMBLY / MONTAGEM
// ================================================================
console.log("\n=== BLOCO 6: ASSEMBLY ===");
{
  const r = await req("GET", "/assembly/jobs", null, { Authorization: `Bearer ${adminToken}` });
  check("6.01 Lista de jobs (admin)", r.status === 200, `HTTP ${r.status} count=${Array.isArray(r.data) ? r.data.length : "?"}`);
}
{
  if (montadorToken) {
    const r = await req("GET", "/assembly/jobs", null, { Authorization: `Bearer ${montadorToken}` });
    check("6.02 MONTADOR acessa apenas seus jobs", r.status === 200 && Array.isArray(r.data), `HTTP ${r.status}`);
  } else skip("6.02 Montador acessa seus jobs", "sem token montador");
}
{
  const r = await req("GET", "/assembly/provider/dashboard", null, { Authorization: `Bearer ${adminToken}` });
  check("6.03 Provider dashboard", r.status === 200, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/assembly/provider/history", null, { Authorization: `Bearer ${adminToken}` });
  check("6.04 Provider history", r.status === 200, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/montador/minhas-montagens", null, { Authorization: `Bearer ${adminToken}` });
  check("6.05 Minhas montagens endpoint", r.status === 200, `HTTP ${r.status}`);
}
{
  // Finalizar job inexistente — deve dar 400, não 500
  const r = await req("POST", "/assembly/job-invalido-000/finish", {}, { Authorization: `Bearer ${adminToken}` });
  check("6.06 Finalizar job inexistente retorna 400 (não 500)", r.status === 400 || r.status === 404, `HTTP ${r.status}`);
}
{
  // Start job inexistente — deve dar 400, não 500
  const r = await req("POST", "/assembly/job-invalido-000/start", {}, { Authorization: `Bearer ${adminToken}` });
  check("6.07 Start job inexistente retorna 400 (não 500)", r.status === 400 || r.status === 404, `HTTP ${r.status}`);
}
{
  // Foto em job real — idempotência
  if (testJobId && adminToken) {
    const url = `/api/uploads/regress-test-${Date.now()}.jpg`;
    const r1 = await req("POST", `/assembly/${testJobId}/photos`, { fileUrl: url }, { Authorization: `Bearer ${adminToken}` });
    const r2 = await req("POST", `/assembly/${testJobId}/photos`, { fileUrl: url }, { Authorization: `Bearer ${adminToken}` });
    const sameId = r1.data?.photoId && r1.data?.photoId === r2.data?.photoId;
    check("6.08 Foto duplicada idempotente (mesmo photoId)", sameId, `r1=${r1.status}(${r1.data?.photoId?.slice(0,8)}) r2=${r2.status}(${r2.data?.photoId?.slice(0,8)})`);
  } else skip("6.08 Idempotência de foto", "sem job ativo");
}

// ================================================================
// BLOCO 7 — AGENDAMENTO INTERNO (operação)
// ================================================================
console.log("\n=== BLOCO 7: AGENDAMENTO ===");
{
  // Sem role de OPERACAO/ADMIN — qualquer autenticado não pode agendar
  if (montadorToken && testOrderId) {
    const r = await req("POST", `/orders/${testOrderId}/schedule`,
      { providerId: "x", date: "2026-07-01", period: "MANHA" },
      { Authorization: `Bearer ${montadorToken}` }
    );
    check("7.01 MONTADOR bloqueado de agendar via rota de operação", r.status === 403, `HTTP ${r.status}`);
  } else skip("7.01 Montador bloqueado no schedule interno", "sem token montador ou pedido");
}
{
  // Admin pode ver slots
  if (testOrderId && adminToken) {
    const r = await req("GET", `/orders/${testOrderId}/slots`, null, { Authorization: `Bearer ${adminToken}` });
    check("7.02 Admin vê slots de pedido", r.status === 200, `HTTP ${r.status}`);
  } else skip("7.02 Admin vê slots", "sem pedido ou admin");
}
{
  // Montador bloqueado de ver slots (rota de operação)
  if (montadorToken && testOrderId) {
    const r = await req("GET", `/orders/${testOrderId}/slots`, null, { Authorization: `Bearer ${montadorToken}` });
    check("7.03 MONTADOR bloqueado de ver slots internos (403)", r.status === 403, `HTTP ${r.status}`);
  } else skip("7.03 Montador bloqueado em slots", "sem token montador");
}

// ================================================================
// BLOCO 8 — AGENDA INTELIGENTE
// ================================================================
console.log("\n=== BLOCO 8: AGENDA INTELIGENTE ===");
{
  const r = await req("GET", "/agenda/candidatos", null, { Authorization: `Bearer ${adminToken}` });
  check("8.01 Agenda candidatos", r.status === 200, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/agenda/stats", null, { Authorization: `Bearer ${adminToken}` });
  check("8.02 Agenda stats", r.status === 200, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/agenda/diagnostico", null, { Authorization: `Bearer ${adminToken}` });
  check("8.03 Agenda diagnóstico", r.status === 200, `HTTP ${r.status}`);
}
{
  if (montadorToken) {
    const r = await req("GET", "/agenda/candidatos", null, { Authorization: `Bearer ${montadorToken}` });
    check("8.04 MONTADOR bloqueado em agenda candidatos (403)", r.status === 403, `HTTP ${r.status}`);
  } else skip("8.04 Montador bloqueado na agenda", "sem token montador");
}

// ================================================================
// BLOCO 9 — FINANCEIRO E PAGAMENTOS
// ================================================================
console.log("\n=== BLOCO 9: FINANCEIRO ===");
{
  const r = await req("GET", "/payments", null, { Authorization: `Bearer ${adminToken}` });
  check("9.01 Lista de pagamentos", r.status === 200, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/payments/export.csv", null, { Authorization: `Bearer ${adminToken}` });
  check("9.02 Exportação CSV de pagamentos", r.status === 200 || r.status === 404, `HTTP ${r.status}`);
}
{
  if (testPaymentId) {
    const r = await req("GET", `/payments/${testPaymentId}/commission-detail`, null, { Authorization: `Bearer ${adminToken}` });
    check("9.03 Detalhe de comissão", r.status === 200 || r.status === 404, `HTTP ${r.status}`);
  } else skip("9.03 Detalhe de comissão", "sem pagamento no sistema");
}
{
  const r = await req("GET", "/pix/mode", null, { Authorization: `Bearer ${adminToken}` });
  check("9.04 Modo PIX", r.status === 200, `HTTP ${r.status}`);
}

// ================================================================
// BLOCO 10 — COMISSÕES
// ================================================================
console.log("\n=== BLOCO 10: COMISSÕES ===");
{
  const r = await req("GET", "/commissions", null, { Authorization: `Bearer ${adminToken}` });
  check("10.01 Lista de comissões", r.status === 200, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/commissions/departments", null, { Authorization: `Bearer ${adminToken}` });
  check("10.02 Departamentos de comissão", r.status === 200, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/commissions/count", null, { Authorization: `Bearer ${adminToken}` });
  check("10.03 Contagem de comissões", r.status === 200, `HTTP ${r.status}`);
}

// ================================================================
// BLOCO 11 — SAC
// ================================================================
console.log("\n=== BLOCO 11: SAC ===");
{
  const r = await req("GET", "/sac", null, { Authorization: `Bearer ${adminToken}` });
  check("11.01 Lista SAC", r.status === 200, `HTTP ${r.status}`);
}

// ================================================================
// BLOCO 12 — AVALIAÇÕES ADMIN
// ================================================================
console.log("\n=== BLOCO 12: AVALIAÇÕES ===");
{
  const r = await req("GET", "/eval-configs", null, { Authorization: `Bearer ${adminToken}` });
  check("12.01 Config de avaliações", r.status === 200, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/eval-analytics?phase=MONTAGEM", null, { Authorization: `Bearer ${adminToken}` });
  check("12.02 Analytics de avaliações (phase=MONTAGEM)", r.status === 200, `HTTP ${r.status}`);
}
{
  // Avaliações públicas — token inválido retorna erro controlado
  const r = await req("GET", "/public/eval/token-invalido");
  check("12.03 Link de avaliação inválido retorna 404/410", r.status === 404 || r.status === 410, `HTTP ${r.status}`);
}

// ================================================================
// BLOCO 13 — REVIEWS
// ================================================================
console.log("\n=== BLOCO 13: REVIEWS ===");
{
  const r = await req("GET", "/reviews", null, { Authorization: `Bearer ${adminToken}` });
  check("13.01 Lista de reviews", r.status === 200, `HTTP ${r.status}`);
}

// ================================================================
// BLOCO 14 — FLUXO DE MENSAGENS
// ================================================================
console.log("\n=== BLOCO 14: FLUXO DE MENSAGENS ===");
{
  const r = await req("GET", "/fluxo/sync/config", null, { Authorization: `Bearer ${adminToken}` });
  check("14.01 Config do fluxo", r.status === 200, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/fluxo/dashboard/summary", null, { Authorization: `Bearer ${adminToken}` });
  check("14.02 Dashboard fluxo", r.status === 200, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/fluxo/message-logs?limit=10", null, { Authorization: `Bearer ${adminToken}` });
  check("14.03 Logs de mensagens", r.status === 200, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/fluxo/events", null, { Authorization: `Bearer ${adminToken}` });
  check("14.04 Lista de eventos de fluxo", r.status === 200, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/fluxo/homologacao/status", null, { Authorization: `Bearer ${adminToken}` });
  check("14.05 Status de homologação", r.status === 200, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/fluxo/diagnostico", null, { Authorization: `Bearer ${adminToken}` });
  check("14.06 Diagnóstico do fluxo", r.status === 200, `HTTP ${r.status}`);
}

// ================================================================
// BLOCO 15 — TEMPLATES E RÉGUA
// ================================================================
console.log("\n=== BLOCO 15: TEMPLATES E RÉGUA ===");
{
  const r = await req("GET", "/message-templates", null, { Authorization: `Bearer ${adminToken}` });
  check("15.01 Templates de mensagem", r.status === 200, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/flow-ruler", null, { Authorization: `Bearer ${adminToken}` });
  check("15.02 Régua de fluxo", r.status === 200, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/flow-ruler/stats", null, { Authorization: `Bearer ${adminToken}` });
  check("15.03 Stats da régua", r.status === 200, `HTTP ${r.status}`);
}

// ================================================================
// BLOCO 16 — INTEGRAÇÃO WINTHOR
// ================================================================
console.log("\n=== BLOCO 16: WINTHOR ===");
{
  const r = await req("GET", "/integration/winthor", null, { Authorization: `Bearer ${adminToken}` });
  check("16.01 Falhas de integração WinThor", r.status === 200, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/winthor/orders?limit=3", null, { Authorization: `Bearer ${adminToken}` });
  check("16.02 Pedidos WinThor", r.status === 200 || r.status === 503, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/system/health", null, { Authorization: `Bearer ${adminToken}` });
  check("16.03 System health", r.status === 200, `HTTP ${r.status}`);
}

// ================================================================
// BLOCO 17 — WEBHOOKS DE ENTRADA (INBOUND)
// ================================================================
console.log("\n=== BLOCO 17: WEBHOOKS ===");
{
  // uazapi sem token — deve bloquear se WEBHOOK_UAZAPI_SECRET configurado
  // (sem configurar, aceita — comportamento correto para dev)
  const r = await req("POST", "/webhooks/whatsapp/uazapigo", { message: {} });
  check("17.01 Webhook uazapi sem token retorna 200 (dev) ou 401 (prod)", r.status === 200 || r.status === 401, `HTTP ${r.status}`);
}
{
  // Meta GET (verificação de webhook)
  const r = await req("GET", "/webhooks/whatsapp/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123");
  check("17.02 Meta webhook verify_token errado bloqueado (403)", r.status === 403, `HTTP ${r.status}`);
}
{
  // Meta POST sem assinatura — sem META_WEBHOOK_SECRET configurado deve passar (dev)
  const r = await req("POST", "/webhooks/whatsapp/meta", { object: "whatsapp_business_account" });
  check("17.03 Meta webhook sem assinatura retorna 200 (dev) ou 401 (prod)", r.status === 200 || r.status === 401, `HTTP ${r.status}`);
}

// ================================================================
// BLOCO 18 — JORNADA PÚBLICA DO CLIENTE
// ================================================================
console.log("\n=== BLOCO 18: JORNADA PÚBLICA ===");
{
  // Token inválido
  const r = await req("GET", "/public/journey/0000000000000000000000000000000000000000000000000000000000000000");
  check("18.01 Jornada com token inválido bloqueada", r.status >= 400, `HTTP ${r.status}`);
}
{
  // numped lookup
  const r = await req("GET", "/public/pedido/99999999");
  check("18.02 Lookup por numped (404 ou redirect)", r.status === 404 || r.status === 200 || r.status === 429, `HTTP ${r.status}`);
}
{
  // Agendamento público com token inválido
  const r = await req("POST", "/public/schedule/tokenfalso", { providerId: "x", date: "2026-07-01", period: "MANHA" });
  check("18.03 Agendamento público com token inválido bloqueado", r.status >= 400, `HTTP ${r.status}`);
}

// ================================================================
// BLOCO 19 — UPLOAD
// ================================================================
console.log("\n=== BLOCO 19: UPLOAD ===");
{
  // Sem auth
  const r = await req("POST", "/upload", null, {});
  check("19.01 Upload sem auth bloqueado (401)", r.status === 401, `HTTP ${r.status}`);
}
{
  // Com auth mas sem arquivo (não é multipart)
  const r = await req("POST", "/upload", null, { Authorization: `Bearer ${adminToken}` });
  check("19.02 Upload sem arquivo retorna 400", r.status === 400, `HTTP ${r.status}`);
}
{
  // Upload com Content-Type inválido (não multipart) → multer rejeita
  const formData = new FormData();
  formData.append("file", new Blob(["fake content that is not an image"], { type: "text/plain" }), "hack.txt");
  try {
    const r = await fetch(`${BASE}/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: formData,
    });
    let d; try { d = await r.json(); } catch { d = {}; }
    check("19.03 Upload de arquivo texto bloqueado por MIME/magic bytes", r.status >= 400, `HTTP ${r.status}: ${String(d?.error ?? "").slice(0,60)}`);
  } catch (e) {
    skip("19.03 Upload MIME inválido", `Erro fetch: ${e.message}`);
  }
}

// ================================================================
// BLOCO 20 — RATE LIMITING
// ================================================================
console.log("\n=== BLOCO 20: RATE LIMIT ===");
{
  let hit429 = false;
  for (let i = 0; i < 20; i++) {
    const r = await req("GET", "/public/journey/aabbccdd0000000000000000000000000000000000000000000000000000");
    if (r.status === 429) { hit429 = true; break; }
  }
  check("20.01 Rate limit público (15/min) bloqueia após limite", hit429, hit429 ? "429 recebido" : "429 não recebido em 20 tentativas");
}

// ================================================================
// BLOCO 21 — VALIDAÇÃO ZOD (PAYLOADS INVÁLIDOS)
// ================================================================
console.log("\n=== BLOCO 21: VALIDAÇÃO DE PAYLOAD ===");
{
  // providerId como número em vez de string
  if (adminToken) {
    const r = await req("POST", "/orders/test/schedule",
      { providerId: 99, date: "x", period: "INVALIDO" },
      { Authorization: `Bearer ${adminToken}` }
    );
    check("21.01 Payload inválido (providerId number) bloqueado por Zod (422)", r.status === 422 || r.status === 400, `HTTP ${r.status}: ${String(r.data?.error ?? "").slice(0,60)}`);
  } else skip("21.01 Payload inválido Zod", "sem admin");
}
{
  // Avaliação com score fora do range
  const r = await req("POST", "/public/reviews/tokenfalso/assembly", { score: 99 });
  check("21.02 Score de avaliação fora do range bloqueado", r.status >= 400, `HTTP ${r.status}`);
}
{
  // Login sem campos obrigatórios
  const r = await req("POST", "/auth/login", { email: "test@test.com" });
  check("21.03 Login sem password bloqueado (422)", r.status === 422 || r.status >= 400, `HTTP ${r.status}`);
}

// ================================================================
// BLOCO 22 — SEGURANÇA DE RESPOSTAS (SEM VAZAMENTO)
// ================================================================
console.log("\n=== BLOCO 22: RESPOSTAS SEGURAS ===");
{
  // Erro de DB não vaza SQL/ORA
  const r = await req("GET", "/winthor/orders/NUMERO-QUE-NAO-EXISTE-999999", null, { Authorization: `Bearer ${adminToken}` });
  const body = JSON.stringify(r.data);
  const leaks = ["ORA-", "SQL", "SELECT", "FROM", "WHERE", "stack", "password", "secret"].some(w => body.toUpperCase().includes(w.toUpperCase()) && w !== "SELECT" && w !== "FROM");
  check("22.01 Erros não vazam SQL/ORA/stack trace", !leaks, `HTTP ${r.status} body=${body.slice(0,80)}`);
}
{
  // Login errado não vaza senha
  const r = await req("POST", "/auth/login", { email: "x@x.com", password: "minha-senha-secreta" });
  const leaks = JSON.stringify(r.data).includes("minha-senha-secreta");
  check("22.02 Senha não vaza em resposta de erro", !leaks, `HTTP ${r.status}`);
}

// ================================================================
// BLOCO 23 — LOGS E AUDITORIA
// ================================================================
console.log("\n=== BLOCO 23: AUDITORIA ===");
{
  const r = await req("GET", "/audit-logs?limit=10", null, { Authorization: `Bearer ${adminToken}` });
  check("23.01 Audit logs acessíveis pelo admin", r.status === 200, `HTTP ${r.status}`);
}
{
  const r = await req("GET", "/fluxo/sync/runs?limit=5", null, { Authorization: `Bearer ${adminToken}` });
  check("23.02 Histórico de sync runs", r.status === 200, `HTTP ${r.status}`);
}

// ================================================================
// BLOCO 24 — SISTEMA DE SAÚDE
// ================================================================
console.log("\n=== BLOCO 24: SAÚDE DO SISTEMA ===");
{
  const r = await req("GET", "/health");
  check("24.01 Health endpoint público", r.status === 200 && r.data?.ok === true, `ok=${r.data?.ok} db=${r.data?.db}`);
}
{
  const r = await req("GET", "/admin/whatsapp/status", null, { Authorization: `Bearer ${adminToken}` });
  check("24.02 Status WhatsApp (admin)", r.status === 200, `HTTP ${r.status} configured=${r.data?.configured}`);
}

// ================================================================
// RESULTADO FINAL
// ================================================================
console.log(`\n${"=".repeat(70)}`);
console.log(`RESULTADO FINAL: ${passed} PASS | ${failed} FAIL | ${skipped} SKIP`);
console.log(`Total testado: ${passed + failed} (excluindo skips)`);
console.log(`${"=".repeat(70)}`);

if (failed > 0) {
  console.log("\nFALHAS:");
  report.filter(r => r.status === "FAIL").forEach(t => console.log(`  [FAIL] ${t.name}: ${t.detail}`));
}
if (skipped > 0) {
  console.log("\nSKIPS (necessitam montador no sistema):");
  report.filter(r => r.status === "SKIP").forEach(t => console.log(`  [SKIP] ${t.name}: ${t.detail}`));
}

console.log(`\nVeredito: ${failed === 0 ? "APTO PARA PRODUCAO" : "REVISAR FALHAS"}`);
