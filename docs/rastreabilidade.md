# Matriz de rastreabilidade

| Ação | Front-end | API | Service | Banco | Evento | Auditoria |
| --- | --- | --- | --- | --- | --- | --- |
| Criar pedido demo | Dashboard | `POST /api/orders/demo` | `OrderService.createDemoOrder` | `customers_snapshot`, `orders_snapshot`, `order_items_snapshot`, `public_tokens` | `PEDIDO_CRIADO`, `MONTAGEM_NECESSARIA` | `EventService` registra evento auditado |
| Gerar link do cliente | Detalhe do pedido | `POST /api/orders/:id/public-token` | `TokenService.create` | `public_tokens` | Não crítico | Pendente para versão RBAC completa |
| Abrir jornada pública | Portal cliente | `GET /api/public/journey/:token` | `TokenService.validate`, `OrderService.detail` | `public_tokens`, snapshots, timeline | Não gera evento | Acesso público pode receber log dedicado |
| Cadastrar montador | Cadastro público | `POST /api/providers` | `ProviderService.register` | `providers` | Não crítico | `PROVIDER_REGISTERED` |
| Aprovar montador | Aprovação | `POST /api/providers/:id/approve` | `ProviderService.approve` | `providers`, `provider_approval_logs` | Não crítico | `PROVIDER_APPROVED` |
| Reprovar montador | Aprovação | `POST /api/providers/:id/reject` | `ProviderService.reject` | `providers`, `provider_approval_logs` | Não crítico | `PROVIDER_REJECTED` |
| Listar slots | Agenda | `GET /api/orders/:id/slots` | `SchedulingService.availableSlots` | `providers` | Não gera evento | Não sensível |
| Agendar montagem | Agenda | `POST /api/orders/:id/schedule` | `SchedulingService.schedule` | `assembly_schedules`, `assembly_jobs`, `provider_payments` | `MONTAGEM_AGENDADA` | Evento auditado |
| Iniciar montagem | API/app montador | `POST /api/assembly/:jobId/start` | `AssemblyService.start` | `assembly_jobs` | `MONTAGEM_INICIADA` | Evento auditado |
| Anexar foto | API/app montador | `POST /api/assembly/:jobId/photos` | `AssemblyService.addPhoto` | `assembly_photos` | `FOTOS_MONTAGEM_ANEXADAS` | Evento auditado |
| Finalizar montagem | API/app montador | `POST /api/assembly/:jobId/finish` | `AssemblyService.finish` | `assembly_jobs`, `provider_payments` | `MONTAGEM_FINALIZADA` | Evento auditado |
| Avaliar montagem | Avaliação/API | `POST /api/orders/:id/reviews/assembly` | `ReviewService.reviewAssembly` | `customer_reviews`, `provider_payments`, `sac_cases` | `AVALIACAO_CLIENTE_RECEBIDA`, `PAGAMENTO_LIBERADO` ou `SAC_CASO_ABERTO` | Evento/SAC auditados |
| Ver painel de avaliações | Avaliações | `GET /api/reviews` | `ReviewService.list` | `customer_reviews`, snapshots, montadores | Não gera evento | Leitura operacional |
| Configurar mensagem por fase | Mensagens | `PUT /api/message-templates/:eventType` | `MessageTemplateService.upsert` | `message_templates` | Não gera evento | `MESSAGE_TEMPLATE_SAVED` |
| Ver régua do fluxo | Régua de Fluxo | `GET /api/flow-ruler` | `FlowService.ruler` | `orders_snapshot`, `order_events`, `order_timeline` | Não gera evento | Leitura operacional |
| Abrir SAC manual | Detalhe do pedido | `POST /api/orders/:id/sac` | `SacService.open` | `sac_cases`, `provider_payments` | `SAC_CASO_ABERTO` | `SAC_OPENED` |
| Programar pagamento | Financeiro | `POST /api/payments/:id/program` | `PaymentService.program` | `provider_payments` | Pendente para evento dedicado | `PAYMENT_PROGRAMMED` |
| Sincronizar WinThor | Integração | `POST /api/integration/winthor/orders/:numped/sync` | `WinthorSyncService.syncOrder` | snapshots, `winthor_sync_logs`, `integration_failures` | `PEDIDO_SINCRONIZADO` ou log de erro | Evento auditado em sucesso |
