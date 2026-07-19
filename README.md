# App Montadores

Plataforma de jornada pós-venda inteligente para pedidos, entrega, montagem, avaliação, SAC, financeiro e integração Oracle/WinThor.

## Auditoria inicial

O workspace estava vazio, contendo apenas `.git`. Não havia código do Projeto Lara para herdar componentes, autenticação, permissões ou padrão Oracle. Por isso esta primeira versão cria uma arquitetura do zero, mantendo compatibilidade conceitual com Lara:

- React + TypeScript + Vite no front-end.
- Node.js + TypeScript + Express no back-end.
- Persistência de produção nas tabelas Oracle `MONT_*` (o arquivo SQLite é legado — ver "Persistência e dados").
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

## Persistência e dados

A persistência efetiva do sistema vive nas tabelas Oracle com prefixo `MONT_*`
(schema criado de forma idempotente por `src/server/db/initTables.ts` no boot).

- O arquivo `.sqlite` (`DATABASE_FILE`) é **legado** e não é a fonte de verdade em
  produção — não faça backup dele esperando conteúdo atual.
- A integração WinThor é **somente leitura**; nunca é destino de escrita.
- As migrações versionadas em `src/server/db/migrationRunner.ts` e
  `allMigrations.ts` **não** rodam no boot atual (o schema vive em `initTables.ts`);
  permanecem apenas como infraestrutura de referência/testes.

## Backup e recuperação de desastre

Backup lógico das tabelas `MONT_*` (um JSON por tabela + `_manifest.json`), sem
exigir DBA/`expdp`. O script lê tudo dentro de uma transação `READ ONLY`, então o
snapshot é consistente entre tabelas.

### Rodar um backup

```bash
npm run backup
```

Requer no ambiente: `ORACLE_USER`, `ORACLE_PASSWORD`, `ORACLE_CONNECT_STRING`
(o script falha rápido com mensagem clara se faltar alguma). A saída vai para
`backups/<timestamp>/`. Esse diretório está no `.gitignore` e **contém dados
pessoais (LGPD)** — trate como sensível: acesso restrito, retenção controlada e,
de preferência, cópia criptografada fora da máquina.

### Agendar backups

- **Windows (Agendador de Tarefas):** crie uma tarefa diária que executa, no
  diretório do projeto, `npm run backup`. Aponte "Iniciar em" para a raiz do
  projeto e garanta que as variáveis Oracle estejam no ambiente do usuário/serviço
  que roda a tarefa (ou carregue o `.env` antes).
- **Linux (cron):** ex.: backup diário às 02:00 —
  `0 2 * * * cd /caminho/app-montadores && npm run backup >> backups/cron.log 2>&1`

Retenção sugerida: manter os últimos N diretórios `backups/*` e remover os mais
antigos periodicamente (script externo/rotina de limpeza).

### Restaurar (runbook)

Cada `<tabela>.json` é um array de linhas no formato de objeto do Oracle
(colunas em MAIÚSCULAS). Restauração é uma operação manual e deliberada — não há
comando automático para evitar sobrescrita acidental de produção. Procedimento:

1. **Confirme o alvo.** Aponte para o schema correto (`ORACLE_CONNECT_STRING`) e
   confirme que é o ambiente que você pretende restaurar. Nunca restaure em
   produção sem janela e aprovação.
2. **Garanta o schema.** Suba a aplicação uma vez (ou rode o boot) para que
   `initTables` crie as tabelas `MONT_*` vazias, se ainda não existirem.
3. **Carregue os dados** do `backups/<timestamp>/` desejado, tabela por tabela,
   respeitando dependências de chave (pais antes de filhos). Use `INSERT` a partir
   do JSON via um script pontual/`sqlldr`/ferramenta de sua preferência.
4. **Valide** contra o `_manifest.json` (contagem de linhas por tabela) e faça
   verificações de sanidade no app (dashboard, pedidos, timeline).

### Recuperação de desastre (resumo)

1. Provisione uma instância Oracle e configure as variáveis de ambiente.
2. Suba a aplicação para que `initTables` recrie o schema `MONT_*`.
3. Restaure o backup lógico mais recente (passos acima).
4. A integração WinThor é somente leitura e se reconecta por configuração — nada a
   restaurar ali.
5. Rode o smoke test manual (ver "Validação manual") antes de reabrir ao uso.

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
