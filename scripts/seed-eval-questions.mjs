// seed-eval-questions.mjs — run with: node scripts/seed-eval-questions.mjs
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const BASE = "http://localhost:3333/api";

async function main() {
  // Login
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@montadores.com", password: "Admin@2026!" }),
  });
  const { token } = await loginRes.json();
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  async function addQ(configId, body) {
    const r = await fetch(`${BASE}/eval-configs/${configId}/questions`, {
      method: "POST",
      headers: h,
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`addQ failed: ${r.status} ${await r.text()}`);
  }

  // ── ATENDIMENTO ────────────────────────────────────────────────────────────
  const atId = "f0033cd7-79c3-4be5-8e42-04361d93dd23";

  await addQ(atId, {
    type: "SCALE", position: 1, required: true,
    minLabel: "Muito ruim", maxLabel: "Excelente",
    label: "De 0 a 10, qual nota você dá para o atendimento recebido na Rodrigues Colchões?",
  });
  await addQ(atId, {
    type: "SCALE", position: 2, required: true,
    minLabel: "Nada claras", maxLabel: "Muito claras",
    label: "As informações sobre produto, preço, prazo de entrega e montagem foram explicadas com clareza?",
  });
  await addQ(atId, {
    type: "SCALE", position: 3, required: true,
    minLabel: "Discordo totalmente", maxLabel: "Concordo totalmente",
    label: "O atendente foi educado, atencioso e demonstrou interesse em ajudar você?",
  });
  await addQ(atId, {
    type: "YES_NO", position: 4, required: true,
    label: "Você se sentiu seguro(a) e bem orientado(a) para finalizar sua compra?",
  });
  await addQ(atId, {
    type: "TEXT", position: 5, required: false,
    label: "Deseja deixar algum comentário sobre o atendimento recebido?",
  });
  console.log("ATENDIMENTO: 5 perguntas ✓");

  // ── ENTREGA ────────────────────────────────────────────────────────────────
  const enId = "368546e9-cc7f-4c55-8b3a-12875653b9b6";

  await addQ(enId, {
    type: "SCALE", position: 1, required: true,
    minLabel: "Muito ruim", maxLabel: "Excelente",
    label: "De 0 a 10, qual nota você dá para a entrega do seu pedido?",
  });
  await addQ(enId, {
    type: "SCALE", position: 2, required: true,
    minLabel: "Muito atrasada", maxLabel: "No prazo exato",
    label: "A entrega aconteceu dentro do prazo ou horário combinado?",
  });
  await addQ(enId, {
    type: "YES_NO", position: 3, required: true,
    label: "O produto chegou em boas condições, sem avarias aparentes na embalagem ou no item?",
  });
  await addQ(enId, {
    type: "SCALE", position: 4, required: true,
    minLabel: "Nenhum cuidado", maxLabel: "Muito cuidadosa",
    label: "A equipe de entrega teve cuidado ao manusear o produto na sua residência?",
  });
  await addQ(enId, {
    type: "TEXT", position: 5, required: false,
    label: "Deseja informar algum problema com a entrega ou deixar uma observação?",
  });
  console.log("ENTREGA: 5 perguntas ✓");

  // ── MONTAGEM ───────────────────────────────────────────────────────────────
  const moId = "326283d5-24bf-4279-b7c9-057a6b4c5f10";

  await addQ(moId, {
    type: "SCALE", position: 1, required: true,
    minLabel: "Muito ruim", maxLabel: "Excelente",
    label: "De 0 a 10, qual nota você dá para o serviço de montagem realizado?",
  });
  await addQ(moId, {
    type: "SCALE", position: 2, required: true,
    minLabel: "Muito atrasado", maxLabel: "Pontual",
    label: "O montador chegou no dia e horário combinado?",
  });
  await addQ(moId, {
    type: "SCALE", position: 3, required: true,
    minLabel: "Discordo totalmente", maxLabel: "Concordo totalmente",
    label: "O produto ficou montado corretamente, firme, alinhado e pronto para uso?",
  });
  await addQ(moId, {
    type: "SCALE", position: 4, required: true,
    minLabel: "Nenhum cuidado", maxLabel: "Muito cuidadoso",
    label: "O montador teve cuidado com o produto, com sua casa e deixou o local organizado após o serviço?",
  });
  await addQ(moId, {
    type: "SINGLE_CHOICE", position: 5, required: true,
    options: ["Sim, aprovo a montagem", "Não, quero registrar uma reclamação"],
    label: "Você aprova a montagem realizada ou deseja registrar alguma reclamação?",
  });
  console.log("MONTAGEM: 5 perguntas ✓");

  console.log("\nTodas as perguntas inseridas com sucesso!");
}

main().catch((e) => { console.error(e); process.exit(1); });
