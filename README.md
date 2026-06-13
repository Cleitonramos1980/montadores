# App Montadores

Plataforma de jornada pós-venda inteligente para pedidos, entrega, montagem, avaliação, SAC, financeiro e integração Oracle/WinThor.

## Auditoria inicial

O workspace estava vazio, contendo apenas `.git`. Não havia código do Projeto Lara para herdar componentes, autenticação, permissões ou padrão Oracle. Por isso esta primeira versão cria uma arquitetura do zero, mantendo compatibilidade conceitual com Lara:

- React + TypeScript + Vite no front-end.
- Node.js + TypeScript + Express no back-end.
- SQLite local via `node:sqlite` para persistência de desenvolvimento.
- Adapter Oracle/WinThor isolado em `src/server/oracle`.
- Credenciais Oracle exclusivamente por variáveis de ambiente.
- Serviços de eventos, timeline, auditoria, tokens públicos, agenda, montagem, avaliação, SAC, financeiro e integração.

## Como rodar

```bash
npm install
npm run seed
npm run dev
```

URLs:

- Front-end: http://localhost:5173/montadores/dashboard
- API: http://localhost:3333/api/health

## Variáveis de ambiente

Copie `.env.example` para `.env` quando precisar configurar o ambiente.

- `PORT`
- `APP_BASE_URL`
- `DATABASE_FILE`
- `ORACLE_USER`
- `ORACLE_PASSWORD`
- `ORACLE_CONNECT_STRING`
- `ORACLE_POOL_MIN`
- `ORACLE_POOL_MAX`
- `ORACLE_POOL_INCREMENT`
- `PUBLIC_TOKEN_TTL_HOURS`
- `JWT_SECRET`

## Telas criadas

- `/montadores/dashboard`
- `/montadores/pedidos`
- `/montadores/pedidos/:id`
- `/montadores/jornada-publica/:token`
- `/montadores/agenda`
- `/montadores/cadastro`
- `/montadores/prestadores`
- `/montadores/aprovacao`
- `/montadores/avaliacoes`
- `/montadores/mensagens`
- `/montadores/regua-fluxo`
- `/montadores/sac`
- `/montadores/financeiro`
- `/montadores/integracao-winthor`

## APIs criadas

- `GET /api/health`
- `GET /api/dashboard`
- `POST /api/orders/demo`
- `GET /api/orders`
- `GET /api/orders/:id`
- `POST /api/orders/:id/public-token`
- `GET /api/public/journey/:token`
- `POST /api/providers`
- `GET /api/providers`
- `POST /api/providers/:id/approve`
- `POST /api/providers/:id/reject`
- `GET /api/orders/:id/slots`
- `POST /api/orders/:id/schedule`
- `POST /api/assembly/:jobId/start`
- `POST /api/assembly/:jobId/photos`
- `POST /api/assembly/:jobId/finish`
- `POST /api/orders/:id/reviews/assembly`
- `GET /api/reviews`
- `GET /api/message-templates`
- `PUT /api/message-templates/:eventType`
- `GET /api/flow-ruler`
- `GET /api/sac`
- `POST /api/orders/:id/sac`
- `GET /api/payments`
- `POST /api/payments/:id/release`
- `POST /api/payments/:id/program`
- `GET /api/integration/winthor`
- `POST /api/integration/winthor/orders/:numped/sync`

## Validação manual

Fluxo positivo:

1. Abra `/montadores/dashboard`.
2. Clique em `Criar pedido demo`.
3. Gere o link do cliente no detalhe do pedido.
4. Acesse `/montadores/agenda` e agende uma montagem.
5. Via API, inicie montagem, anexe foto, finalize e avalie com nota 10.
6. Confirme timeline, pagamento liberado e dashboard atualizado.

Fluxo negativo:

1. Tente finalizar montagem sem foto.
2. A API deve retornar erro: `Montagem não pode ser finalizada sem fotos obrigatórias.`
3. Avalie montagem com nota de 0 a 6.
4. O sistema deve abrir SAC e bloquear pagamento.

## Limitações conhecidas

- A autenticação real e RBAC completo ainda precisam ser conectados ao padrão Lara quando o projeto base estiver disponível.
- A integração Oracle/WinThor está implementada como adapter real, mas depende de credenciais, schema e validação de campos reais do WinThor.
- Upload de arquivos usa `fileUrl`; falta plugar storage real.
- Mensageria tem tabelas e eventos-base, mas falta provider real de WhatsApp/SMS/e-mail.
- Jobs incrementais ainda precisam ser agendados.
- A UI cobre o fluxo principal; módulos de logs/auditoria dedicados ainda podem ganhar telas próprias.
