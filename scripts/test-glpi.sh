#!/bin/bash
# =====================================================
# Teste de conectividade com a API do GLPI
# =====================================================
# Uso: bash scripts/test-glpi.sh
#
# Este script testa se o GLPI está acessível e se os
# tokens (App-Token e User-Token) estão funcionando.
# Execute antes de rodar o sistema para validar a conexão.
# =====================================================

set -e

if [ -f .env ]; then
  export $(grep -v '^#' .env | grep -v '^\s*$' | xargs)
fi

GLPI_URL="${GLPI_API_URL:-}"
APP_TOKEN="${GLPI_APP_TOKEN:-}"
USER_TOKEN="${GLPI_USER_TOKEN:-}"

echo "========================================"
echo " Teste de Conectividade GLPI"
echo "========================================"
echo ""

if [ -z "$GLPI_URL" ]; then
  echo "[ERRO] GLPI_API_URL nao esta definida."
  echo "       Configure no arquivo .env ou como variavel de ambiente."
  echo "       Exemplo: GLPI_API_URL=https://chamados.exemplo.com.br/apirest.php"
  exit 1
fi

if [ -z "$APP_TOKEN" ]; then
  echo "[ERRO] GLPI_APP_TOKEN nao esta definido."
  echo "       Crie um App-Token em: GLPI > Configurar > Geral > API"
  exit 1
fi

if [ -z "$USER_TOKEN" ]; then
  echo "[ERRO] GLPI_USER_TOKEN nao esta definido."
  echo "       Gere em: GLPI > Administracao > Usuarios > [usuario] > Configuracoes"
  exit 1
fi

echo "[INFO] URL:        $GLPI_URL"
echo "[INFO] App-Token:  ${APP_TOKEN:0:8}..."
echo "[INFO] User-Token: ${USER_TOKEN:0:8}..."
echo ""

echo "[1/3] Testando acesso ao endpoint..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$GLPI_URL" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "000" ]; then
  echo "[ERRO] Nao foi possivel conectar em $GLPI_URL"
  echo "       Verifique se a URL esta correta e se o servidor esta acessivel."
  exit 1
fi

echo "[OK]   Endpoint acessivel (HTTP $HTTP_CODE)"
echo ""

echo "[2/3] Testando initSession com os tokens..."
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -H "Content-Type: application/json" \
  -H "App-Token: $APP_TOKEN" \
  -H "Authorization: user_token $USER_TOKEN" \
  "$GLPI_URL/initSession" 2>/dev/null)

BODY=$(echo "$RESPONSE" | head -n -1)
STATUS=$(echo "$RESPONSE" | tail -n 1)

echo "[INFO] HTTP Status: $STATUS"
echo "[INFO] Resposta:    $BODY"
echo ""

if [ "$STATUS" = "200" ]; then
  echo "[OK]   Sessao iniciada com sucesso!"
  SESSION_TOKEN=$(echo "$BODY" | grep -o '"session_token":"[^"]*"' | cut -d'"' -f4)
  if [ -n "$SESSION_TOKEN" ]; then
    echo "[OK]   Session Token: ${SESSION_TOKEN:0:12}..."
    echo ""
    echo "[3/3] Encerrando sessao de teste..."
    curl -s -o /dev/null \
      -H "App-Token: $APP_TOKEN" \
      -H "Session-Token: $SESSION_TOKEN" \
      "$GLPI_URL/killSession" 2>/dev/null
    echo "[OK]   Sessao encerrada."
  fi
  echo ""
  echo "========================================"
  echo " RESULTADO: TUDO OK!"
  echo " O sistema pode se conectar ao GLPI."
  echo "========================================"
  exit 0
else
  echo "[ERRO] Falha ao iniciar sessao."
  echo ""
  if echo "$BODY" | grep -q "ERROR_WRONG_APP_TOKEN_PARAMETER"; then
    echo "       CAUSA: App-Token invalido ou API nao habilitada."
    echo ""
    echo "       SOLUCAO:"
    echo "       1. Acesse o GLPI pelo navegador"
    echo "       2. Va em Configurar > Geral > API"
    echo "       3. Ative: Habilitar API REST"
    echo "       4. Ative: Permitir App-Token"
    echo "       5. Ative: Permitir login por token"
    echo "       6. Crie um novo App-Token e copie sem espacos"
    echo "       7. Atualize GLPI_APP_TOKEN no .env"
  elif echo "$BODY" | grep -q "ERROR_GLPI_LOGIN"; then
    echo "       CAUSA: User-Token invalido ou usuario sem permissao."
    echo ""
    echo "       SOLUCAO:"
    echo "       1. Acesse o GLPI pelo navegador"
    echo "       2. Va em Administracao > Usuarios > [usuario]"
    echo "       3. Na aba Configuracoes, gere um novo token"
    echo "       4. Confirme que o usuario tem perfil Tecnico ou Admin"
    echo "       5. Atualize GLPI_USER_TOKEN no .env"
  else
    echo "       Resposta inesperada. Verifique a URL e os tokens."
  fi
  echo ""
  echo "========================================"
  echo " RESULTADO: FALHA"
  echo " Corrija os itens acima antes de rodar."
  echo "========================================"
  exit 1
fi
