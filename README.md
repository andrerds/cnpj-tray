# cnpj-tray

Consulta rápida de CNPJ e CEP pela bandeja do sistema. Tauri 2 + Rust + WebView nativa — sem Electron.

## Uso

Clique no ícone da bandeja para abrir o painel. Digite o CNPJ ou o CEP (com ou sem máscara) e pressione Enter. O app descobre o tipo pelo número de dígitos: 14 = CNPJ, 8 = CEP.

- CNPJ: aceita `00000000000191` e `00.000.000/0001-91`; pontos, barras, hífens e espaços são removidos. Zeros à esquerda são preservados.
- CEP: aceita `01310100` e `01310-100`; sai sempre mascarado como `01310-100`.
- Saída em Markdown ou TXT, com botão **Copiar** para o formato selecionado.
- As 5 consultas mais recentes ficam salvas localmente, com os dados retornados. Clicar numa entrada mostra os dados salvos na hora, sem nova consulta.
- `Esc` ou `✕` fecha o painel; o app continua na bandeja.
- Menu da bandeja (clique direito): **Abrir painel** e **Sair**.

Duas requisições de rede, e nenhuma outra:

| Consulta | Endpoint |
|---|---|
| CNPJ | `GET https://api.opencnpj.org/{cnpj}` |
| CEP | `GET https://public-utilities.rmscorretora.com.br/api/cep/{cep}` |

Não há telemetria.

O histórico fica em `historico.json` dentro da pasta de configuração do app (`~/.config/cnpj-tray/` no Linux, `~/Library/Application Support/cnpj-tray/` no macOS, `%APPDATA%\cnpj-tray\` no Windows). Histórico corrompido é descartado, não recuperado.

## Desenvolvimento

```bash
npm install          # instala o Tauri CLI (@tauri-apps/cli)
npm run tauri dev    # executa em modo de desenvolvimento
npm run tauri build  # gera o bundle de produção
```

Só há uma dependência de desenvolvimento: `@tauri-apps/cli`. O backend usa apenas `tauri`, `serde`, `serde_json` e `reqwest` (rustls, sem OpenSSL do sistema).

## Estrutura

```
src/            frontend estático (index.html, style.css, main.js) — sem bundler
src-tauri/src/  backend Rust: comandos consultar/historico, bandeja, posicionamento do painel
src-tauri/icons/ ícones do app e o ícone monocromático da bandeja
```

A chamada HTTP é feita no Rust, não na WebView: evita CORS, permite tratar status, timeout e JSON inválido com mensagens específicas, e guarda o payload exato no histórico.

## Limitações por sistema

**macOS**
- Ícone na menu bar como *template image* (segue o tema claro/escuro) e `ActivationPolicy::Accessory` — sem ícone no Dock.
- Fechar o painel esconde a janela em vez de encerrar o app.
- Abrir o app pelo Finder/Launchpad mostra o painel de imediato, já posicionado sob o ícone da menu bar; o clique no ícone continua sendo o caminho normal.
- O painel usa `set_visible_on_all_workspaces` para aparecer sobre apps em tela cheia.
- Cliques sintéticos (CGEvent, AppleScript) **não** disparam `TrayIconEvent::Click` em `NSStatusItem`. Clique real com o mouse funciona. Eventos de `Enter`/`Move`/`Leave` chegam normalmente.

**Windows**
- Ícone na área de notificação. O painel é posicionado a partir do retângulo do ícone; sem ícones fixados, o clique pode cair na bandeja recolhida.

**Linux**
- `TrayIconEvent::Click` é **não suportado** no Tauri 2 para Linux. O handler do clique esquerdo não dispara; use o menu da bandeja (**Abrir painel**).
- O `rect` do ícone frequentemente não é informado no Linux. Nesse caso o painel usa o ponto do clique; se nem isso existir, abre no canto padrão do monitor.
- Requer `webkit2gtk` e, para a bandeja, `libayatana-appindicator3` (ou `libappindicator3`) instalados no sistema.

## API

**CNPJ** — `https://api.opencnpj.org/{cnpj}` devolve JSON com os dados cadastrais. A resposta é exibida integralmente: campos desconhecidos aparecem ao final com o nome cru, então nada é omitido. Valores vazios vêm como `(vazio na resposta)` para não sumirem da saída.

**CEP** — `https://public-utilities.rmscorretora.com.br/api/cep/{cep}` (serviço *Public Utilities* da RMS Corretora) devolve `{ data, cached }`; o app usa apenas `data`, com logradouro, bairro, cidade, UF e complemento.

Erros tratados: caractere inválido, quantidade de dígitos diferente de 8 ou 14, todos os dígitos iguais no CNPJ, falha de conexão, timeout de 20 s, HTTP 400/404/429/5xx e resposta que não seja JSON válido. No serviço de utilidades a mensagem de erro do corpo (`error.message`) é repassada ao painel.
