#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, LogicalPosition, Manager, Rect, WebviewWindow,
};

const API_CNPJ: &str = "https://api.opencnpj.org/";
const API_UTIL: &str = "https://public-utilities.rmscorretora.com.br/api/";
const MAX_HISTORICO: usize = 5;

#[derive(Serialize, Deserialize, Clone)]
struct Consulta {
    /// "cnpj" ou "cep"
    #[serde(default = "tipo_cnpj")]
    tipo: String,
    /// CNPJ (14 dígitos) ou CEP (8 dígitos), sem máscara
    #[serde(alias = "cnpj")]
    chave: String,
    /// epoch em milissegundos; formatado no painel conforme o locale do sistema
    ts: u64,
    dados: serde_json::Value,
}

fn tipo_cnpj() -> String {
    "cnpj".to_string()
}

/// Aceita CNPJ ou CEP com ou sem máscara e devolve apenas os dígitos.
fn so_digitos(entrada: &str) -> Result<String, String> {
    let invalido = entrada.chars().find(|c| !c.is_ascii_digit() && !matches!(c, '.' | '/' | '-' | ' ' | '\t'));
    if let Some(c) = invalido {
        return Err(format!("Caractere inválido: '{c}'. Use apenas números, ponto, barra, hífen ou espaço."));
    }
    let digitos: String = entrada.chars().filter(char::is_ascii_digit).collect();
    if digitos.is_empty() {
        return Err("Digite um CNPJ (14 dígitos) ou um CEP (8 dígitos).".to_string());
    }
    Ok(digitos)
}

fn validar_cnpj(digitos: &str) -> Result<(), String> {
    if digitos.bytes().all(|b| b == digitos.as_bytes()[0]) {
        return Err("CNPJ inválido: todos os dígitos são iguais.".to_string());
    }
    Ok(())
}

fn caminho_historico(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|d| d.join("historico.json"))
        .map_err(|e| format!("Não localizei a pasta de configuração do app: {e}"))
}

fn ler_historico(app: &AppHandle) -> Vec<Consulta> {
    let Ok(p) = caminho_historico(app) else { return vec![] };
    match std::fs::read_to_string(&p) {
        // ponytail: histórico corrompido é descartado em vez de recuperado; não há dado de valor a salvar aqui
        Ok(txt) => serde_json::from_str(&txt).unwrap_or_default(),
        Err(_) => vec![],
    }
}

fn gravar_historico(app: &AppHandle, hist: &[Consulta]) -> Result<(), String> {
    let p = caminho_historico(app)?;
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Não consegui criar {dir:?}: {e}"))?;
    }
    let txt = serde_json::to_string_pretty(hist).map_err(|e| format!("Falha ao serializar histórico: {e}"))?;
    std::fs::write(&p, txt).map_err(|e| format!("Não consegui gravar o histórico em {p:?}: {e}"))
}

fn cliente() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(concat!("cnpj-tray/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("Falha ao iniciar o cliente HTTP: {e}"))
}

async fn buscar_json(url: &str, host: &str) -> Result<serde_json::Value, String> {
    let resp = cliente()?.get(url).send().await.map_err(|e| {
        if e.is_timeout() {
            "A consulta passou de 20 segundos e foi cancelada.".to_string()
        } else if e.is_connect() {
            format!("Não foi possível conectar a {host}. Verifique a conexão.")
        } else {
            format!("Falha de rede: {e}")
        }
    })?;

    let status = resp.status().as_u16();
    let corpo = resp.text().await.map_err(|e| format!("Falha ao ler a resposta: {e}"))?;

    if status != 200 {
        // o serviço de utilidades devolve { error: { message } }; uso a mensagem quando existir
        let detalhe = serde_json::from_str::<serde_json::Value>(&corpo)
            .ok()
            .and_then(|v| v["error"]["message"].as_str().map(str::to_string));
        return Err(match status {
            400 => detalhe.unwrap_or_else(|| "A API rejeitou o valor enviado (HTTP 400).".to_string()),
            404 => "Não encontrado na base.".to_string(),
            429 => "Muitas consultas em pouco tempo (HTTP 429). Aguarde e tente de novo.".to_string(),
            s if s >= 500 => format!("A API está instável (HTTP {s}). Tente novamente em instantes."),
            s => format!("A API respondeu HTTP {s}."),
        });
    }

    serde_json::from_str(&corpo).map_err(|_| "A resposta da API não é um JSON válido.".to_string())
}

fn guardar(app: &AppHandle, tipo: &str, chave: &str, dados: &serde_json::Value) {
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let mut hist = ler_historico(app);
    hist.retain(|c| !(c.tipo == tipo && c.chave == chave));
    hist.insert(0, Consulta { tipo: tipo.to_string(), chave: chave.to_string(), ts, dados: dados.clone() });
    hist.truncate(MAX_HISTORICO);
    if let Err(e) = gravar_historico(app, &hist) {
        // a consulta em si deu certo; falha de disco não deve esconder o resultado
        eprintln!("aviso: {e}");
    }
}

/// Consulta CNPJ (14 dígitos) ou CEP (8 dígitos), escolhendo o endpoint pela contagem.
#[tauri::command]
async fn consultar(app: AppHandle, entrada: String) -> Result<serde_json::Value, String> {
    let digitos = so_digitos(&entrada)?;

    let (tipo, url) = match digitos.len() {
        14 => {
            validar_cnpj(&digitos)?;
            ("cnpj", format!("{API_CNPJ}{digitos}"))
        }
        8 => ("cep", format!("{API_UTIL}cep/{digitos}")),
        n => {
            return Err(format!(
                "Informe 14 dígitos para CNPJ ou 8 para CEP — recebi {n}."
            ))
        }
    };

    let host = if tipo == "cnpj" { "api.opencnpj.org" } else { "public-utilities.rmscorretora.com.br" };
    let mut dados = buscar_json(&url, host).await?;

    // o serviço de utilidades embrulha o resultado em { data, cached }
    if tipo == "cep" {
        dados = dados.get("data").cloned().unwrap_or(dados);
    }

    guardar(&app, tipo, &digitos, &dados);
    Ok(dados)
}

#[tauri::command]
fn historico(app: AppHandle) -> Vec<Consulta> {
    ler_historico(&app)
}

/// Posiciona o painel logo abaixo do ícone da bandeja (ou acima, se a bandeja estiver na base).
fn posicionar(win: &WebviewWindow, rect: Rect) {
    let Ok(escala) = win.scale_factor() else { return };
    let Ok(tam) = win.outer_size() else { return };

    let pos = rect.position.to_physical::<f64>(escala);
    let size = rect.size.to_physical::<f64>(escala);

    // rect vem em pixels físicos; centro horizontal do ícone e base dele.
    // Quando o backend não informa o rect (comum no Linux), usa o próprio ponto do clique.
    let (cx, cy) = if size.width > 0.0 {
        (pos.x + size.width / 2.0, pos.y + size.height)
    } else {
        (pos.x, pos.y)
    };

    let ponto = tauri::PhysicalPosition::new(cx, cy).to_logical::<f64>(escala);
    let largura = tam.to_logical::<f64>(escala).width;
    let altura = tam.to_logical::<f64>(escala).height;

    let monitor = win.current_monitor().ok().flatten().or_else(|| win.primary_monitor().ok().flatten());
    let (mx, my, mw, mh) = match monitor {
        Some(m) => {
            let p = m.position().to_logical::<f64>(escala);
            let s = m.size().to_logical::<f64>(escala);
            (p.x, p.y, s.width, s.height)
        }
        None => (0.0, 0.0, 1440.0, 900.0),
    };

    let margem = 8.0;
    let x = (ponto.x - largura / 2.0).clamp(mx + margem, (mx + mw - largura - margem).max(mx + margem));
    let abaixo = ponto.y + 6.0;
    let y = if abaixo + altura <= my + mh - margem {
        abaixo
    } else {
        (ponto.y - altura - 6.0).max(my + margem)
    };

    let _ = win.set_position(LogicalPosition::new(x, y));
}

fn alternar_painel(win: &WebviewWindow, rect: Rect) {
    if win.is_visible().unwrap_or(false) {
        let _ = win.hide();
    } else {
        posicionar(win, rect);
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![consultar, historico])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let win = app
                .get_webview_window("main")
                .ok_or("janela principal não encontrada")?;

            // o painel precisa aparecer também sobre apps em tela cheia, como um item de barra de menus
            #[cfg(target_os = "macos")]
            let _ = win.set_visible_on_all_workspaces(true);
            let win_clone = win.clone();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = win_clone.hide();
                }
            });

            let abrir = MenuItem::with_id(app, "abrir", "Abrir painel", true, None::<&str>)?;
            let sair = MenuItem::with_id(app, "sair", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&abrir, &sair])?;

            let tray = TrayIconBuilder::with_id("bandeja")
                .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
                .tooltip("CNPJ / CEP · consulta rápida")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, evento| match evento.id().as_ref() {
                    "abrir" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "sair" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, evento| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        rect,
                        ..
                    } = &evento
                    {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            alternar_painel(&w, *rect);
                        }
                    }
                })
                .build(app)?;

            // no macOS o ícone da bandeja deve ser monocromático e seguir o tema do sistema
            #[cfg(target_os = "macos")]
            tray.set_icon_as_template(true)?;

            // Aberto pelo Finder/Launchpad não há evento de clique na bandeja: mostra o painel
            // já posicionado sob o ícone, para o app nunca parecer que não abriu.
            if let Ok(Some(rect)) = tray.rect() {
                posicionar(&win, rect);
            }
            let _ = win.show();
            let _ = win.set_focus();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o app");
}
