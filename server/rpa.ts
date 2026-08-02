import { chromium } from "playwright";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { RpaDisparo, RpaConfig } from "@shared/schema";

const CHROMIUM_PATH = "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium";

function nowBR() {
  return new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

// ─────────────────────────────────────────────────────────────
// Helper: try multiple XPaths and return the first that works
// ─────────────────────────────────────────────────────────────
async function findElement(
  page: any,
  xpaths: string[],
  timeout = 8000,
  addLog?: (msg: string) => void
) {
  for (let i = 0; i < xpaths.length; i++) {
    const xpath = xpaths[i];
    addLog?.(`  Tentando XPath ${i + 1}/${xpaths.length}: ${xpath.slice(0, 80)}...`);
    try {
      const el = page.locator(`xpath=${xpath}`).first();
      await el.waitFor({ state: "visible", timeout });
      addLog?.(`  ✔ XPath ${i + 1} encontrado.`);
      return el;
    } catch {
      addLog?.(`  ✘ XPath ${i + 1} não encontrado (timeout ${timeout}ms).`);
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Screenshot on error — saved to /tmp for debugging
// ─────────────────────────────────────────────────────────────
async function screenshotOnError(page: any, stepName: string, addLog: (msg: string) => void) {
  try {
    const path = join(tmpdir(), `rpa_error_${stepName.replace(/\s+/g, "_")}_${Date.now()}.png`);
    await page.screenshot({ path, fullPage: true });
    addLog(`  📸 Screenshot salvo: ${path}`);
  } catch {
    addLog(`  📸 Não foi possível salvar screenshot.`);
  }
}

// ─────────────────────────────────────────────────────────────
// Main automation
// ─────────────────────────────────────────────────────────────
export async function executeRpaDisparo(
  disparo: RpaDisparo,
  config: RpaConfig,
  onLog: (line: string) => void
): Promise<void> {
  const addLog = (msg: string) => {
    const line = `[${nowBR()}] ${msg}`;
    console.log(`[RPA] ${line}`);
    onLog(line);
  };

  const step = (num: number, name: string) => {
    addLog(`${"─".repeat(50)}`);
    addLog(`▶ ETAPA ${num}: ${name}`);
  };

  let tmpFile: string | null = null;
  let browser: any = null;
  let page: any = null;

  try {
    // ──────────────────────────────────────────────────────
    // INIT: Abrir navegador
    // ──────────────────────────────────────────────────────
    addLog(`${"═".repeat(50)}`);
    addLog(`RPA iniciado — Disparo: "${disparo.nome}"`);
    addLog(`Canal: ${disparo.canal} | Template: ${disparo.template}`);
    addLog(`Data/Hora agendada: ${disparo.data} ${disparo.horario}`);
    if (disparo.variaveis.length > 0) addLog(`Variáveis: ${disparo.variaveis.join(", ")}`);
    addLog(`${"═".repeat(50)}`);

    addLog("Verificando executável do Chromium...");
    const execPath = existsSync(CHROMIUM_PATH) ? CHROMIUM_PATH : undefined;
    addLog(execPath ? `✔ Chromium encontrado: ${execPath}` : "⚠ Usando Chromium padrão do Playwright");

    addLog("Iniciando navegador headless...");
    browser = await chromium.launch({
      executablePath: execPath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions"],
    });
    addLog("✔ Navegador iniciado.");

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
    page = await context.newPage();

    // Captura erros do console da página
    page.on("console", (msg: any) => {
      if (msg.type() === "error") addLog(`  [Página] Console error: ${msg.text()}`);
    });
    page.on("pageerror", (err: any) => {
      addLog(`  [Página] JS error: ${err?.message}`);
    });

    // ──────────────────────────────────────────────────────
    // ETAPA 1: LOGIN
    // ──────────────────────────────────────────────────────
    step(1, "LOGIN NA PLATAFORMA");

    addLog(`Abrindo URL: ${config.url}`);
    try {
      await page.goto(config.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      addLog(`✔ Página carregada. URL atual: ${page.url()}`);
      addLog(`  Título: ${await page.title()}`);
    } catch (e: any) {
      throw new Error(`Falha ao abrir a URL "${config.url}": ${e?.message}`);
    }
    await page.waitForTimeout(2000);

    // Campo e-mail
    addLog("Procurando campo de e-mail...");
    const emailEl = await findElement(page, [
      `//*[@id=":r3q:"]`,
      `/html/body/div/div/div/main/div/div/div[2]/div/form/div[1]/div/input`,
      `//input[@type="email"]`,
      `//input[contains(@placeholder,"mail") or contains(@placeholder,"E-mail")]`,
    ], 8000, addLog);
    if (!emailEl) {
      await screenshotOnError(page, "email_nao_encontrado", addLog);
      throw new Error("Campo de e-mail não encontrado. Verifique se a URL está correta e a página carregou.");
    }
    await emailEl.fill(config.email);
    addLog(`✔ E-mail preenchido: ${config.email}`);

    // Campo senha
    addLog("Procurando campo de senha...");
    const senhaEl = await findElement(page, [
      `//*[@id=":r3r:"]`,
      `/html/body/div/div/div/main/div/div/div[2]/div/form/div[2]/div/input`,
      `//input[@type="password"]`,
    ], 8000, addLog);
    if (!senhaEl) {
      await screenshotOnError(page, "senha_nao_encontrada", addLog);
      throw new Error("Campo de senha não encontrado.");
    }
    await senhaEl.fill(config.senha);
    addLog("✔ Senha preenchida.");

    // Botão login
    addLog("Procurando botão de login...");
    const loginBtn = await findElement(page, [
      `/html/body/div/div/div/main/div/div/div[2]/div/form/button`,
      `//button[@type="submit"]`,
      `//button[contains(text(),"Entrar") or contains(text(),"Login") or contains(text(),"Acessar")]`,
    ], 8000, addLog);
    if (!loginBtn) {
      await screenshotOnError(page, "login_btn_nao_encontrado", addLog);
      throw new Error("Botão de login não encontrado.");
    }
    await loginBtn.click();
    addLog("✔ Botão de login clicado.");
    addLog("Aguardando carregamento pós-login (3s)...");
    await page.waitForTimeout(3000);
    addLog(`✔ URL após login: ${page.url()}`);
    addLog(`  Título: ${await page.title()}`);

    // ──────────────────────────────────────────────────────
    // ETAPA 2: NAVEGAR AO MÓDULO DE DISPAROS
    // ──────────────────────────────────────────────────────
    step(2, "NAVEGAR AO MÓDULO DE DISPAROS");

    addLog("Procurando item 'Disparos' no menu lateral...");
    const menuDisparos = await findElement(page, [
      `/html/body/div[1]/div/div[2]/div/div/div[2]/ul/a[13]/div/span`,
      `//a[contains(@href,"disparo") or contains(@href,"Disparo")]`,
      `//*[contains(text(),"Disparo") and (self::span or self::a or self::li)]`,
    ], 20000, addLog);
    if (!menuDisparos) {
      await screenshotOnError(page, "menu_disparos_nao_encontrado", addLog);
      throw new Error("Item 'Disparos' não encontrado no menu lateral. Verifique se o login foi bem-sucedido.");
    }
    await menuDisparos.click();
    addLog("✔ Menu Disparos clicado.");
    await page.waitForTimeout(2000);
    addLog(`  URL atual: ${page.url()}`);

    addLog("Procurando botão 'Criar novo disparo'...");
    const btnNovo = await findElement(page, [
      `/html/body/div[1]/div/div[2]/main/div/div/div/div/div/div/div/div[1]/div[2]/div[2]/button[2]/span`,
      `//button[contains(@class,"primary") and (contains(text(),"Novo") or contains(text(),"Criar"))]`,
      `//*[contains(text(),"Novo Disparo") or contains(text(),"Criar Disparo")]`,
    ], 15000, addLog);
    if (!btnNovo) {
      await screenshotOnError(page, "btn_novo_disparo_nao_encontrado", addLog);
      throw new Error("Botão 'Novo disparo' não encontrado na tela de Disparos.");
    }
    await btnNovo.click();
    addLog("✔ Botão 'Novo disparo' clicado.");
    await page.waitForTimeout(1500);

    addLog("Procurando opção 'Importar base'...");
    const importarBase = await findElement(page, [
      `/html/body/div[4]/div[3]/div/div/div/form/ul/li[2]/button`,
      `/html/body/div[3]/div[3]/div/div/div/form/ul/li[2]/button`,
      `//button[contains(text(),"Import") or contains(text(),"Base") or contains(text(),"Arquivo")]`,
      `//li[2]//button`,
    ], 15000, addLog);
    if (!importarBase) {
      await screenshotOnError(page, "importar_base_nao_encontrado", addLog);
      throw new Error("Opção 'Importar base' não encontrada no popup. Verifique se o popup abriu corretamente.");
    }
    await importarBase.click();
    addLog("✔ Opção 'Importar base' clicada.");
    await page.waitForTimeout(1000);

    // ──────────────────────────────────────────────────────
    // ETAPA 3: UPLOAD DO ARQUIVO
    // ──────────────────────────────────────────────────────
    step(3, "UPLOAD DO ARQUIVO CSV");

    if (disparo.arquivoConteudo) {
      addLog(`Arquivo: ${disparo.arquivoNome ?? "base.csv"}`);
      addLog(`Tamanho do conteúdo: ${disparo.arquivoConteudo.length} caracteres`);
      tmpFile = join(tmpdir(), `rpa_${disparo.id}_${Date.now()}.csv`);
      writeFileSync(tmpFile, disparo.arquivoConteudo, "utf8");
      addLog(`✔ Arquivo temporário criado: ${tmpFile}`);

      addLog("Procurando input de arquivo (file chooser)...");
      try {
        const [fileChooser] = await Promise.all([
          page.waitForEvent("filechooser", { timeout: 10000 }),
          (async () => {
            // Try hidden input first
            const fileInput = page.locator(`xpath=//input[@type="file"]`).first();
            const isVisible = await fileInput.isVisible().catch(() => false);
            if (isVisible) {
              addLog("  Encontrado input type=file visível, clicando...");
              await fileInput.click();
            } else {
              addLog("  Input type=file oculto, procurando botão de upload...");
              const uploadBtn = await findElement(page, [
                `//button[contains(text(),"Selecionar") or contains(text(),"Upload") or contains(text(),"Importar") or contains(text(),"Arquivo")]`,
                `//label[contains(@class,"upload") or contains(@for,"file")]`,
              ], 5000, addLog);
              if (uploadBtn) await uploadBtn.click();
              else throw new Error("Nenhum botão de upload encontrado");
            }
          })(),
        ]);
        await fileChooser.setFiles(tmpFile);
        addLog("✔ Arquivo enviado via file chooser.");
      } catch (e: any) {
        await screenshotOnError(page, "upload_arquivo", addLog);
        throw new Error(`Falha no upload do arquivo: ${e?.message}`);
      }
      addLog("Aguardando processamento do arquivo (3s)...");
      await page.waitForTimeout(3000);
    } else {
      addLog("⚠ AVISO: Nenhum arquivo CSV fornecido. Pulando upload.");
    }

    // ──────────────────────────────────────────────────────
    // ETAPA 4: MAPEAMENTO DE CAMPOS
    // ──────────────────────────────────────────────────────
    step(4, "MAPEAMENTO DE CAMPOS");

    const fieldRows = [
      `/html/body/div[4]/div[3]/div/div/div/form/div[2]/div[1]`,
      `/html/body/div[4]/div[3]/div/div/div/form/div[2]/div[2]`,
      `/html/body/div[4]/div[3]/div/div/div/form/div[2]/div[3]`,
      `/html/body/div[4]/div[3]/div/div/div/form/div[2]/div[4]`,
    ];

    // First check if the table actually appeared
    addLog("Verificando se tabela de mapeamento apareceu...");
    const tabelaOk = await findElement(page, [
      `/html/body/div[4]/div[3]/div/div/div/form/div[2]`,
      `/html/body/div[3]/div[3]/div/div/div/form/div[2]`,
    ], 8000, addLog);
    if (!tabelaOk) {
      await screenshotOnError(page, "tabela_mapeamento_nao_encontrada", addLog);
      addLog("⚠ Tabela de mapeamento não encontrada — pode indicar que o upload falhou.");
    }

    for (let i = 0; i < fieldRows.length; i++) {
      const rowNum = i + 1;
      addLog(`  Campo ${rowNum}/4:`);
      try {
        const labelXpath = `${fieldRows[i]}/div[1]/div/p`;
        addLog(`    Lendo nome da coluna... XPath: ${labelXpath}`);
        const labelEl = page.locator(`xpath=${labelXpath}`);
        let colName = "";
        try {
          await labelEl.waitFor({ state: "visible", timeout: 5000 });
          colName = ((await labelEl.textContent()) ?? "").trim();
          addLog(`    ✔ Coluna identificada: "${colName}"`);
        } catch {
          colName = `campo_${rowNum}`;
          addLog(`    ⚠ Não encontrou o nome da coluna, usando fallback: "${colName}"`);
        }

        const mappingXpath = `${fieldRows[i]}/div[2]/div`;
        addLog(`    Clicando no campo de mapeamento... XPath: ${mappingXpath}`);
        const mappingEl = await findElement(page, [mappingXpath], 5000, addLog);
        if (!mappingEl) {
          addLog(`    ⚠ Campo de mapeamento ${rowNum} não encontrado, pulando.`);
          continue;
        }
        await mappingEl.click();
        await page.waitForTimeout(500);

        addLog(`    Digitando "${colName}" e pressionando Enter...`);
        const inputEl = page.locator(`xpath=${mappingXpath}//input`).first();
        try {
          await inputEl.waitFor({ state: "visible", timeout: 3000 });
          await inputEl.fill(colName);
        } catch {
          addLog(`    ⚠ Input não encontrado dentro do dropdown, usando keyboard.type...`);
          await page.keyboard.type(colName);
        }
        await page.keyboard.press("Enter");
        await page.waitForTimeout(500);
        addLog(`    ✔ Campo ${rowNum} mapeado.`);
      } catch (e: any) {
        addLog(`    ✘ ERRO no campo ${rowNum}: ${e?.message ?? String(e)}`);
      }
    }

    addLog("Clicando em 'Avançar' após mapeamento...");
    const avancarMapeamento = await findElement(page, [
      `/html/body/div[4]/div[3]/div/div/div/form/div[3]/button[2]`,
      `/html/body/div[3]/div[3]/div/div/div/form/div[3]/button[2]`,
      `//button[contains(text(),"Avançar") or contains(text(),"Próximo") or contains(text(),"Next")]`,
    ], 10000, addLog);
    if (!avancarMapeamento) {
      await screenshotOnError(page, "avancar_mapeamento_nao_encontrado", addLog);
      throw new Error("Botão 'Avançar' não encontrado após mapeamento.");
    }
    await avancarMapeamento.click();
    addLog("✔ Avançado para etapa de canal.");
    await page.waitForTimeout(1500);

    // ──────────────────────────────────────────────────────
    // ETAPA 5: SELEÇÃO DE CANAL
    // ──────────────────────────────────────────────────────
    step(5, `SELEÇÃO DE CANAL: "${disparo.canal}"`);

    addLog("Procurando campo de busca do canal...");
    const canalInput = await findElement(page, [
      `/html/body/div[4]/div[3]/div/div/div/form/div[1]/div/div/div/input`,
      `/html/body/div[3]/div[3]/div/div/div/form/div[1]/div/div/div/input`,
      `//input[contains(@placeholder,"canal") or contains(@placeholder,"Canal")]`,
    ], 10000, addLog);
    if (!canalInput) {
      await screenshotOnError(page, "canal_input_nao_encontrado", addLog);
      throw new Error("Campo de busca do canal não encontrado.");
    }
    await canalInput.fill(disparo.canal);
    addLog(`✔ Canal digitado: "${disparo.canal}"`);
    addLog("Aguardando resultados (1s)...");
    await page.waitForTimeout(1000);

    addLog("Procurando primeiro resultado do canal...");
    const canalResult = await findElement(page, [
      `/html/body/div[4]/div[3]/div/div/div/form/div[2]/div`,
      `/html/body/div[3]/div[3]/div/div/div/form/div[2]/div`,
      `//div[contains(@class,"option") or contains(@class,"result") or contains(@class,"item")]`,
    ], 8000, addLog);
    if (!canalResult) {
      await screenshotOnError(page, "canal_resultado_nao_encontrado", addLog);
      throw new Error(`Nenhum resultado encontrado para o canal "${disparo.canal}". Verifique o nome exato.`);
    }
    const canalText = await canalResult.textContent().catch(() => "?");
    addLog(`✔ Selecionando canal: "${canalText?.trim()}"`);
    await canalResult.click();
    await page.waitForTimeout(800);

    addLog("Clicando em 'Avançar' após canal...");
    const avancarCanal = await findElement(page, [
      `/html/body/div[4]/div[3]/div/div/div/form/div[3]/button[2]`,
      `/html/body/div[3]/div[3]/div/div/div/form/div[3]/button[2]`,
      `//button[contains(text(),"Avançar") or contains(text(),"Próximo")]`,
    ], 10000, addLog);
    if (!avancarCanal) {
      await screenshotOnError(page, "avancar_canal_nao_encontrado", addLog);
      throw new Error("Botão 'Avançar' não encontrado após seleção de canal.");
    }
    await avancarCanal.click();
    addLog("✔ Avançado para etapa de template.");
    await page.waitForTimeout(1500);

    // ──────────────────────────────────────────────────────
    // ETAPA 6: SELEÇÃO DE TEMPLATE
    // ──────────────────────────────────────────────────────
    step(6, `SELEÇÃO DE TEMPLATE: "${disparo.template}"`);

    addLog("Procurando campo de busca do template...");
    const templateInput = await findElement(page, [
      `/html/body/div[4]/div[3]/div/div/div/form/div[1]/div[2]/div/div/input`,
      `/html/body/div[3]/div[3]/div/div/div/form/div[1]/div[2]/div/div/input`,
      `//input[contains(@placeholder,"template") or contains(@placeholder,"Template")]`,
    ], 10000, addLog);
    if (!templateInput) {
      await screenshotOnError(page, "template_input_nao_encontrado", addLog);
      throw new Error("Campo de busca do template não encontrado.");
    }
    await templateInput.fill(disparo.template);
    addLog(`✔ Template digitado: "${disparo.template}"`);
    await page.waitForTimeout(1000);

    addLog("Procurando primeiro resultado do template...");
    const templateResult = await findElement(page, [
      `/html/body/div[4]/div[3]/div/div/div/form/div[2]/div/div/div[1]`,
      `/html/body/div[3]/div[3]/div/div/div/form/div[2]/div/div/div[1]`,
      `/html/body/div[4]/div[3]/div/div/div/form/div[2]/div`,
    ], 8000, addLog);
    if (!templateResult) {
      await screenshotOnError(page, "template_resultado_nao_encontrado", addLog);
      throw new Error(`Nenhum resultado encontrado para o template "${disparo.template}". Verifique o nome exato.`);
    }
    const templateText = await templateResult.textContent().catch(() => "?");
    addLog(`✔ Selecionando template: "${templateText?.trim()}"`);
    await templateResult.click();
    await page.waitForTimeout(800);

    // ──────────────────────────────────────────────────────
    // ETAPA 7: VARIÁVEIS DO TEMPLATE
    // ──────────────────────────────────────────────────────
    step(7, `VARIÁVEIS DO TEMPLATE (${disparo.variaveis.length} variável(is))`);

    if (disparo.variaveis.length === 0) {
      addLog("Nenhuma variável definida, pulando etapa.");
    } else {
      const varXpaths = [
        `/html/body/div[4]/div[3]/div/div/div/form/div[2]/div/div/div[1]/div[4]/div[1]/div/div/div/div/input`,
        `/html/body/div[4]/div[3]/div/div/div/form/div[2]/div/div/div[1]/div[4]/div[2]/div/div/div/div/input`,
        `/html/body/div[4]/div[3]/div/div/div/form/div[2]/div/div/div[1]/div[4]/div[3]/div/div/div/div/input`,
      ];

      for (let i = 0; i < disparo.variaveis.length; i++) {
        if (i >= varXpaths.length) {
          addLog(`⚠ Só há ${varXpaths.length} XPath(s) de variável configurados, pulando variável ${i + 1}.`);
          break;
        }
        const varVal = disparo.variaveis[i];
        addLog(`  Variável ${i + 1}: "${varVal}"`);

        addLog(`    Procurando dropdown da variável ${i + 1}...`);
        const varEl = await findElement(page, [varXpaths[i]], 10000, addLog);
        if (!varEl) {
          await screenshotOnError(page, `variavel_${i + 1}_nao_encontrada`, addLog);
          addLog(`    ⚠ Dropdown da variável ${i + 1} não encontrado, pulando.`);
          continue;
        }

        addLog(`    Clicando no dropdown...`);
        await varEl.click();
        await page.waitForTimeout(400);

        // Try to click matching option first
        addLog(`    Procurando opção "${varVal}" na lista...`);
        const optionEl = page.locator(`[class*="option"]:has-text("${varVal}"), [class*="item"]:has-text("${varVal}"), li:has-text("${varVal}")`).first();
        let optionFound = false;
        try {
          await optionEl.waitFor({ state: "visible", timeout: 3000 });
          await optionEl.click();
          optionFound = true;
          addLog(`    ✔ Opção "${varVal}" selecionada via dropdown.`);
        } catch {
          addLog(`    Opção não encontrada no dropdown, tentando digitar e pressionar Enter...`);
          try {
            await varEl.fill(varVal);
            await page.waitForTimeout(300);
            // Try clicking option again after typing
            try {
              await optionEl.waitFor({ state: "visible", timeout: 2000 });
              await optionEl.click();
              optionFound = true;
              addLog(`    ✔ Opção "${varVal}" selecionada após digitar.`);
            } catch {
              await page.keyboard.press("Enter");
              addLog(`    ✔ Enter pressionado para variável ${i + 1}.`);
            }
          } catch (e2: any) {
            addLog(`    ✘ ERRO ao preencher variável ${i + 1}: ${e2?.message ?? String(e2)}`);
          }
        }
        await page.waitForTimeout(400);
      }
    }

    addLog("Clicando em 'Avançar' após variáveis...");
    const avancarVars = await findElement(page, [
      `/html/body/div[4]/div[3]/div/div/div/form/div[3]/button[2]`,
      `/html/body/div[3]/div[3]/div/div/div/form/div[3]/button[2]`,
      `//button[contains(text(),"Avançar") or contains(text(),"Próximo")]`,
    ], 10000, addLog);
    if (!avancarVars) {
      await screenshotOnError(page, "avancar_variaveis_nao_encontrado", addLog);
      throw new Error("Botão 'Avançar' não encontrado após variáveis.");
    }
    await avancarVars.click();
    addLog("✔ Avançado para configuração final.");
    await page.waitForTimeout(1500);

    // ──────────────────────────────────────────────────────
    // ETAPA 8: CONFIGURAÇÃO FINAL
    // ──────────────────────────────────────────────────────
    step(8, "CONFIGURAÇÃO FINAL (nome, data/hora, fila)");

    const [year, month, day] = disparo.data.split("-");
    const dateTimeStr = `${day}/${month}/${year} ${disparo.horario}`;

    addLog(`Preenchendo nome: "${disparo.nome}"`);
    const nomeEl = await findElement(page, [
      `/html/body/div[4]/div[3]/div/div/div/form/div[1]/div[1]/div/div[1]/div/input`,
      `/html/body/div[3]/div[3]/div/div/div/form/div[1]/div[1]/div/div[1]/div/input`,
      `//input[contains(@placeholder,"nome") or contains(@placeholder,"Nome") or contains(@placeholder,"name")]`,
    ], 10000, addLog);
    if (!nomeEl) {
      await screenshotOnError(page, "nome_disparo_nao_encontrado", addLog);
      throw new Error("Campo 'Nome do disparo' não encontrado na configuração final.");
    }
    await nomeEl.fill(disparo.nome);
    addLog(`✔ Nome preenchido: "${disparo.nome}"`);

    addLog(`Preenchendo data/hora: "${dateTimeStr}"`);
    const dtEl = await findElement(page, [
      `/html/body/div[4]/div[3]/div/div/div/form/div[1]/div[2]/div/div/div/input`,
      `/html/body/div[3]/div[3]/div/div/div/form/div[1]/div[2]/div/div/div/input`,
      `//input[contains(@placeholder,"DD/MM") or contains(@placeholder,"data") or contains(@type,"datetime")]`,
    ], 10000, addLog);
    if (!dtEl) {
      await screenshotOnError(page, "data_hora_nao_encontrado", addLog);
      throw new Error("Campo de data/hora não encontrado na configuração final.");
    }
    await dtEl.fill(dateTimeStr);
    addLog(`✔ Data/hora preenchida: "${dateTimeStr}"`);
    await page.waitForTimeout(500);

    if (disparo.fila) {
      addLog(`Selecionando fila: "${disparo.fila}"`);
      const filaEl = await findElement(page, [
        `/html/body/div[4]/div[3]/div/div/div/form/div[1]/div[6]/div/div/div`,
        `/html/body/div[3]/div[3]/div/div/div/form/div[1]/div[6]/div/div/div`,
      ], 8000, addLog);
      if (!filaEl) {
        addLog("⚠ Campo de fila não encontrado, pulando.");
      } else {
        await filaEl.click();
        await page.waitForTimeout(500);
        const filaOpt = page.locator(`[class*="option"]:has-text("${disparo.fila}"), li:has-text("${disparo.fila}")`).first();
        try {
          await filaOpt.waitFor({ state: "visible", timeout: 3000 });
          await filaOpt.click();
          addLog(`✔ Fila "${disparo.fila}" selecionada.`);
        } catch {
          addLog(`  Opção não encontrada, digitando e pressionando Enter...`);
          const filaInput = await findElement(page, [
            `/html/body/div[4]/div[3]/div/div/div/form/div[1]/div[6]/div/div/div//input`,
            `/html/body/div[3]/div[3]/div/div/div/form/div[1]/div[6]/div/div/div//input`,
          ], 3000, addLog);
          if (filaInput) {
            await filaInput.fill(disparo.fila);
            await page.keyboard.press("Enter");
            addLog(`✔ Fila "${disparo.fila}" digitada e Enter pressionado.`);
          } else {
            addLog(`⚠ Input da fila não encontrado, pulando.`);
          }
        }
      }
    }

    // ──────────────────────────────────────────────────────
    // ETAPA 9: SALVAR
    // ──────────────────────────────────────────────────────
    step(9, "SALVAR DISPARO");

    addLog("Procurando botão 'Salvar'...");
    const salvarBtn = await findElement(page, [
      `/html/body/div[4]/div[3]/div/div/div/form/div[2]/button[2]`,
      `/html/body/div[3]/div[3]/div/div/div/form/div[2]/button[2]`,
      `//button[contains(text(),"Salvar") or contains(text(),"Confirmar") or contains(text(),"Criar")]`,
    ], 10000, addLog);
    if (!salvarBtn) {
      await screenshotOnError(page, "btn_salvar_nao_encontrado", addLog);
      throw new Error("Botão 'Salvar' não encontrado na etapa final.");
    }
    await salvarBtn.click();
    addLog("✔ Botão 'Salvar' clicado.");
    addLog("Aguardando confirmação (3s)...");
    await page.waitForTimeout(3000);
    addLog(`  URL após salvar: ${page.url()}`);
    addLog(`  Título: ${await page.title()}`);

    addLog(`${"═".repeat(50)}`);
    addLog("✅ DISPARO CRIADO COM SUCESSO NA PLATAFORMA ConnectaCX!");
    addLog(`${"═".repeat(50)}`);

    await context.close();

  } catch (error: any) {
    addLog(`${"═".repeat(50)}`);
    addLog(`❌ FALHA NA AUTOMAÇÃO`);
    addLog(`Mensagem: ${error?.message ?? String(error)}`);
    if (page) {
      addLog(`URL no momento do erro: ${page.url?.() ?? "desconhecida"}`);
      await screenshotOnError(page, "erro_final", addLog);
    }
    addLog(`${"═".repeat(50)}`);
    throw error;
  } finally {
    if (browser) {
      try { await browser.close(); addLog("Navegador fechado."); } catch {}
    }
    if (tmpFile && existsSync(tmpFile)) {
      try { unlinkSync(tmpFile); addLog(`Arquivo temporário removido: ${tmpFile}`); } catch {}
    }
  }
}
