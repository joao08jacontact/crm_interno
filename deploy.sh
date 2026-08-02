#!/bin/bash
# =============================================================================
# deploy.sh — Atualiza o código sem perder os dados do servidor
# Uso: bash deploy.sh
# =============================================================================

set -e  # para se qualquer comando falhar

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[deploy]${NC} $1"; }
warn() { echo -e "${YELLOW}[aviso]${NC}  $1"; }
err()  { echo -e "${RED}[erro]${NC}   $1"; exit 1; }

# ── 1. Backup do app-state (segurança extra) ─────────────────────────────────
if [ -f "app-state.json" ]; then
  BACKUP="app-state.backup.$(date +%Y%m%d_%H%M%S).json"
  cp app-state.json "$BACKUP"
  log "Backup criado: $BACKUP"
fi

# ── 2. Puxa as mudanças de código ────────────────────────────────────────────
log "Baixando atualizações..."
git pull || err "Falha no git pull. Verifique a conexão ou conflitos."

# ── 3. Instala dependências novas (só se package-lock mudou) ─────────────────
log "Verificando dependências..."
npm install --prefer-offline

# ── 4. Build de produção ──────────────────────────────────────────────────────
log "Fazendo build..."
npm run build

# ── 5. Reinicia o servidor ────────────────────────────────────────────────────
if command -v pm2 &>/dev/null; then
  APP_NAME=$(pm2 list --no-color 2>/dev/null | grep -oP '(?<=│ )\S+(?= +│ +\S+ +│ +online)' | head -1)
  if [ -n "$APP_NAME" ]; then
    log "Reiniciando via pm2: $APP_NAME"
    pm2 restart "$APP_NAME"
  else
    warn "pm2 encontrado mas nenhum processo 'online'. Suba com: pm2 start ecosystem.config.js"
  fi
else
  warn "pm2 não encontrado."
  warn "Reinicie manualmente: pkill -f 'node dist' && npm run start"
fi

log "Deploy concluído!"
echo ""
echo "  Dados preservados: app-state.json, pbi-state.json"
echo "  Backups de hoje:   $(ls app-state.backup.*.json 2>/dev/null | tail -3 | tr '\n' ' ')"
