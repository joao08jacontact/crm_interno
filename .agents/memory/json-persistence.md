---
name: Persistência JSON Universal
description: Como a persistência de dados funciona no MemStorage — padrão app-state.json com debounce
---

# Persistência JSON Universal em MemStorage

## A Regra
Todo dado do MemStorage é salvo em `./app-state.json` automaticamente após qualquer escrita, usando debounce de 500ms. O arquivo carrega ao iniciar o servidor.

**Why:** O sistema usava MemStorage (perde tudo ao reiniciar). A solução escolhida foi estender o padrão `pbi-state.json` (já existente) para cobrir TODOS os dados, sem precisar de banco de dados.

**How to apply:**
- Qualquer novo método de escrita no MemStorage DEVE chamar `this.scheduleSave()` ao final
- `scheduleSave()` debounce 500ms → chama `saveAppState()` que serializa tudo para `app-state.json`
- `loadAppState()` é chamado no construtor e carrega tudo
- `app-state.json` e `pbi-state.json` estão no `.gitignore`
- Se quiser migrar para PostgreSQL externo, usar `EXTERNAL_DB_URL` como variável de ambiente
- Módulo `fs` é importado via `import fs from "fs"` no topo de storage.ts (ESM — não usar require())

## Dados Persistidos
Absolutamente tudo: tasks, taskExceptions (Set serializado como array), analistas, solicitantes, ticketResponsibles, slaConfig, glpiConfig, projetos, etapas, disparos, disparoCanais, disparoTemplates, disparoConfig, rpaConfig, rpaDisparos, rpaCanais, rpaTemplates, reguaConfig, reguaRotinas, reguaLogs, pythonAgentConfig, pythonScripts, pythonExecutions, dbConfig, dbTimestampConfigs, pbiConfig, pbiDatasets, pbiOperacoes, automacoes, bis, bases, canvasNodes, canvasEdges.

## Cuidados
- `taskExceptions` usa `Map<string, Set<string>>` — serializa como `[key, Array.from(set)][]`
- `ticketResponsibles` usa `Map<number, ...>` — chaves ficam como string no JSON, re-parsear com `Number(k)` no load
- `bis.createdAt` e `automacoes.createdAt` são `Date` — reconstruir com `new Date(b.createdAt)` no load
- Usuário admin padrão só é criado se `analistas.size === 0` após o load (não sobrescreve dados salvos)
