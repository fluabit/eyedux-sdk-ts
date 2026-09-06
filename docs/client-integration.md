# Guia de integração para TypeScript

Este guia explica como integrar o Eyedux a aplicações TypeScript ou JavaScript. O SDK usa `fetch` nativo, não depende de framework e funciona em Node.js 18+ ou em runtimes web compatíveis.

## Antes de começar

Você precisa de:

- Node.js 18 ou superior, ou um runtime com `fetch`, `AbortController` e `URLSearchParams`;
- uma API key criada no painel do Eyedux;
- o `project_id` do projeto que receberá os eventos.

A API key autentica a organização e deve ficar no backend ou em um secret manager. O SDK usa a base fixa `https://api.eyedux.com` e envia `Authorization: Bearer <api_key>` automaticamente.

## Instalação

```sh
npm install @eyedux/sdk
```

```ts
import { createEyeduxClient } from "@eyedux/sdk";
```

## Configuração recomendada

Mantenha os segredos fora do código:

```sh
export EYEDUX_API_KEY="sua-api-key"
export EYEDUX_PROJECT_ID="64f1a2b3c4d5e6f7a8b9c0d1"
```

Para uma configuração explícita, use `createEyeduxClientWithConfig`:

```ts
import { createEyeduxClientWithConfig } from "@eyedux/sdk";

export const eyedux = createEyeduxClientWithConfig({
  apiKey: process.env.EYEDUX_API_KEY ?? "",
  projectId: process.env.EYEDUX_PROJECT_ID ?? "",
  timeoutMs: 10_000,
  defaultMetadata: {
    service: "checkout-api",
    environment: process.env.NODE_ENV ?? "development",
  },
});
```

Esse construtor valida a API key e o projeto. Para ler somente a API key de `EYEDUX_API_KEY`, use `createEyeduxClientFromEnv`; o projeto ainda deve ser informado nas opções ou em cada evento.

Crie uma instância por configuração e reutilize-a durante a vida da aplicação.

## Enviando o primeiro evento

Com um projeto padrão configurado, `projectId` pode ser omitido da chamada:

```ts
import { EventEyeduxType } from "@eyedux/sdk";

const event = await eyedux.createEvent({
  type: "user.signup",
  typeGroup: "identity",
  eyeduxType: EventEyeduxType.SystemLog,
  properties: {
    user_id: "user_123",
    plan: "pro",
    source: "landing_page",
  },
});

console.log("evento criado:", event.id);
```

`properties` é o payload principal do evento e deve conter ao menos um valor serializável como JSON. `type` é obrigatório; `typeGroup`, `eyeduxType`, `metadata` e os objetos de referência são opcionais.

## Erros com diagnóstico

Use `emitError` para registrar uma falha sem alterar as propriedades fornecidas. O SDK adiciona `error`, `operation`, `source_file`, `source_line` e `source_function` quando a informação estiver disponível no stack trace do runtime.

```ts
try {
  await saveOrder(order);
} catch (error) {
  try {
    await eyedux.emitError({
      type: "order.error",
      error,
      operation: "save order",
      properties: { order_id: order.id },
    });
  } catch (telemetryError) {
    console.error("Falha ao registrar erro no Eyedux", telemetryError);
  }

  throw error;
}
```

`emitError` não substitui o erro original da aplicação. Para um fluxo próprio de criação de eventos, use `errorProperties` ou `errorPropertiesWithSourceSkip`.

Para eventos que não representam erros, use os atalhos por categoria:

```ts
await eyedux.emitWarning({
  type: "billing.warning",
  properties: { invoice_id: "inv_123" },
});
```

Também estão disponíveis `emitLog`, `emitDebug`, `emitInfo` e `emitMetric`.

## Timeout e cancelamento

O timeout padrão é 30 segundos e pode ser alterado em `timeoutMs`. Cada método assíncrono também aceita `AbortSignal`:

```ts
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5_000);

try {
  await eyedux.createEvent(
    {
      type: "payment.completed",
      properties: { payment_id: "pay_123" },
    },
    { signal: controller.signal },
  );
} finally {
  clearTimeout(timeout);
}
```

Falhas de transporte, cancelamento, timeout ou resposta JSON inválida lançam `EyeduxRequestError`, com a causa original em `error.cause`.

## Referências e correlação

Use `externalObject` para associar o evento a uma entidade do sistema de origem. Use `correlationObject` para agrupar eventos, como os de uma mesma sessão ou checkout:

```ts
await eyedux.createEvent({
  type: "order.paid",
  properties: { amount: 14990, currency: "BRL" },
  externalObject: {
    id: "order_01HX92K",
    property: "orderId",
  },
  correlationObject: {
    id: "checkout_abc123",
    property: "checkoutId",
  },
});
```

`defaultMetadata` é adequado para contexto compartilhado. A metadata enviada por evento tem precedência sobre o valor padrão. Da mesma forma, `projectId` no evento sobrescreve o projeto padrão do cliente.

## Idempotência com `externalObject`

Quando um `externalObject.id` já está associado a outro evento, a API retorna `409`. Para tratar uma operação como idempotente, busque o evento existente:

```ts
import { isExternalObjectConflict } from "@eyedux/sdk";

const externalId = "order_01HX92K";

let event;
try {
  event = await eyedux.createEvent({
    type: "order.paid",
    properties: { order_id: externalId },
    externalObject: { id: externalId, property: "orderId" },
  });
} catch (error) {
  if (!isExternalObjectConflict(error)) throw error;
  event = await eyedux.findEventByExternalId(externalId);
}

console.log("evento confirmado:", event.id);
```

Use esse padrão somente quando a repetição do ID externo representar a mesma operação de negócio.

## Consultando eventos

```ts
const events = await eyedux.listEvents({
  type: "order.paid",
  correlationId: "checkout_abc123",
});

const event = await eyedux.findEventByExternalId("order_01HX92K");
```

Os filtros são cumulativos. Quando não há resultados, `listEvents` retorna `[]`.

## Tratamento de erros

Há dois grupos principais de erros:

- `EyeduxValidationError`: configuração inválida, como API key, projeto ou ID externo vazios;
- `EyeduxAPIError`: resposta da API com `statusCode`, `code`, `apiMessage` e, para `429`, `retryAfter` em segundos.

```ts
import { EyeduxAPIError, isNotFound, isRateLimited } from "@eyedux/sdk";

try {
  await eyedux.findEventByExternalId("order_01HX92K");
} catch (error) {
  if (isNotFound(error)) return;

  if (isRateLimited(error)) {
    console.log(`Tente novamente em ${error.retryAfter ?? 1}s`);
  }

  if (error instanceof EyeduxAPIError) {
    console.error(error.statusCode, error.code, error.apiMessage);
  }

  throw error;
}
```

Também estão disponíveis `isAuthError`, `isConflict` e `isExternalObjectConflict`. O SDK não implementa retry automático; essa política pertence à aplicação integradora.

## Checklist de produção

- [ ] API key armazenada em secret manager ou variável de ambiente.
- [ ] Projeto configurado explicitamente.
- [ ] Uma instância do SDK reutilizada pela aplicação.
- [ ] Timeout e cancelamento adequados ao handler ou worker.
- [ ] `properties` sem dados sensíveis desnecessários.
- [ ] `externalObject` definido quando o evento precisa ser idempotente.
- [ ] Tratamento separado para autenticação, conflitos, not-found e rate limit.
- [ ] Retry implementado no worker ou serviço, com backoff e limite.

## Publicação com GitHub Pages

Este repositório publica a documentação com GitHub Pages e GitHub Actions. Para habilitar:

1. Faça push da branch `main` para o GitHub.
2. Abra **Settings > Pages** no repositório.
3. Em **Build and deployment > Source**, selecione **GitHub Actions**.
4. Faça push para `main` ou execute o workflow **Build and deploy documentation to GitHub Pages** manualmente.

O Pages hospeda apenas a documentação estática. Ele não executa o SDK e não é um local seguro para expor API keys.

## Próximo documento

- [Referência completa da API](api-reference.md)