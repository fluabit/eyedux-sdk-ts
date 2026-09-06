# Eyedux SDK para TypeScript

SDK oficial e framework-agnostic do Eyedux para projetos TypeScript e
JavaScript. O pacote usa a implementação nativa de `fetch` e não possui
dependências de runtime.

## Requisitos

- Node.js 18 ou superior; ou
- um runtime web com `fetch`, `AbortController` e `URLSearchParams`.

O SDK pode ser usado diretamente em browsers, React e React Native. Nesses
ambientes, a API key ficará acessível a quem usar a aplicação. Para chaves
privilegiadas, a prática recomendada é enviar os eventos por um backend
controlado pela aplicação.

## Instalação

```sh
npm install @eyedux/sdk
```

## Uso rápido

```ts
import { EventEyeduxType, createEyeduxClient } from "@eyedux/sdk";

const eyedux = createEyeduxClient("sua-api-key", {
  projectId: "64f1a2b3c4d5e6f7a8b9c0d1",
});

const event = await eyedux.createEvent({
  type: "user.signup",
  eyeduxType: EventEyeduxType.SystemLog,
  properties: { plan: "pro", source: "landing_page" },
});

console.log(event.id);
```

## Configuração

```ts
const eyedux = createEyeduxClient("sua-api-key", {
  projectId: "64f1a2b3c4d5e6f7a8b9c0d1",
  timeoutMs: 10_000,
  defaultMetadata: {
    service: "billing-api",
    environment: "production",
  },
});
```

As opções disponíveis são:

| Opção | Descrição | Padrão |
| --- | --- | --- |
| `projectId` | Projeto usado quando o evento não informa um | vazio |
| `timeoutMs` | Timeout de cada request em milissegundos | `30000` |
| `defaultMetadata` | Metadata adicionada a todos os eventos | vazio |
| `fetch` | Implementação customizada de `fetch` | `globalThis.fetch` |

Metadata informada no evento sobrescreve chaves de `defaultMetadata`. Os mapas
recebidos pelo SDK são copiados e não são modificados.

Para configuração explícita, `apiKey` e `projectId` são obrigatórios:

```ts
import { createEyeduxClientWithConfig } from "@eyedux/sdk";

const eyedux = createEyeduxClientWithConfig({
  apiKey: "sua-api-key",
  projectId: "64f1a2b3c4d5e6f7a8b9c0d1",
  timeoutMs: 2_000,
});
```

Em runtimes Node.js, a chave também pode vir de `EYEDUX_API_KEY`:

```ts
import { createEyeduxClientFromEnv } from "@eyedux/sdk";

const eyedux = createEyeduxClientFromEnv({
  projectId: "64f1a2b3c4d5e6f7a8b9c0d1",
});
```

## Eventos

### Criar

```ts
const event = await eyedux.createEvent({
  projectId: "64f1a2b3c4d5e6f7a8b9c0d1", // sobrescreve o default
  type: "order.paid",
  typeGroup: "billing",
  properties: { amount: 12990, currency: "BRL" },
  externalObject: {
    id: "order_123",
    property: "orderId",
  },
  correlationObject: {
    id: "checkout_456",
    property: "checkoutId",
  },
  metadata: { region: "sa-east-1" },
});
```

Datas em `event.timestamp` e `event.createdAt` são strings RFC 3339, iguais às
recebidas da API.

### Listar

```ts
const allEvents = await eyedux.listEvents();

const filteredEvents = await eyedux.listEvents({
  type: "order.paid",
  correlationId: "checkout_456",
});
```

Os filtros são opcionais e cumulativos. Uma consulta sem resultados retorna
sempre `[]`.

### Buscar por ID externo

```ts
const event = await eyedux.findEventByExternalId("order_123");
```

## Categorias predefinidas

`EventEyeduxType` expõe as categorias aceitas pela plataforma:

- `SystemError` (`system-error`)
- `SystemWarning` (`system-warning`)
- `SystemLog` (`system-log`)
- `SystemDebug` (`system-debug`)
- `SystemInfo` (`system-info`)
- `SystemMetric` (`system-metric`)

Os atalhos `emitWarning`, `emitLog`, `emitDebug`, `emitInfo` e `emitMetric`
preenchem a categoria automaticamente:

```ts
await eyedux.emitMetric({
  type: "queue.depth",
  properties: { queue: "emails", count: 42 },
});
```

## Diagnóstico de erros

`emitError` adiciona `error`, `operation`, `source_file`, `source_line` e
`source_function` às propriedades. A captura da origem usa o stack trace do
runtime e é best-effort. O mapa original não é alterado.

```ts
try {
  await saveOrder(order);
} catch (error) {
  await eyedux.emitError({
    type: "order.error",
    error,
    operation: "save order",
    properties: { order_id: order.id },
  });
  throw error;
}
```

Wrappers podem usar `sourceSkip` para ignorar frames adicionais. Para montar as
propriedades sem emitir um evento, use `errorProperties` ou
`errorPropertiesWithSourceSkip`.

## Tratamento de erros

Respostas de erro da API lançam `EyeduxAPIError`, que expõe `statusCode`,
`code`, `apiMessage` e, em respostas `429`, `retryAfter` em segundos.

```ts
import { EyeduxAPIError, isNotFound, isRateLimited } from "@eyedux/sdk";

try {
  await eyedux.findEventByExternalId("order_123");
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

Também estão disponíveis `isConflict`, `isExternalObjectConflict` e
`isAuthError`. O SDK não faz retry automático; essa política pertence à
aplicação integradora.

Erros de configuração lançam `EyeduxValidationError`. Falhas de transporte,
cancelamento, timeout ou JSON inválido lançam `EyeduxRequestError` com a causa
original em `error.cause`.

## Cancelamento

Todos os métodos assíncronos aceitam `AbortSignal` em um segundo argumento:

```ts
const controller = new AbortController();

const request = eyedux.listEvents({}, { signal: controller.signal });
controller.abort();

await request;
```

## Desenvolvimento

```sh
npm install
npm run check
```

`npm run check` executa typecheck, testes e build ESM/CJS com declarações de
tipo.