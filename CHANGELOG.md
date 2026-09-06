# Changelog

Todas as alterações relevantes deste projeto serão documentadas neste arquivo.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e o projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [0.1.0] - 2026-09-06

### Adicionado

- Cliente Eyedux baseado em `fetch`, sem dependências de runtime.
- Criação e listagem de eventos e busca por ID externo.
- Categorias de evento tipadas e métodos de emissão por categoria.
- Diagnóstico padronizado de erros com captura best-effort da origem.
- Erros estruturados, helpers de classificação e suporte a `Retry-After`.
- Timeout configurável, cancelamento com `AbortSignal` e `fetch` injetável.