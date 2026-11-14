"use strict";

const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;

const $ = (id) => document.getElementById(id);
const elForm = $("form");
const elCnpj = $("cnpj");
const elBuscar = $("buscar");
const elMsg = $("msg");
const elHist = $("historico");
const elSugestoes = $("sugestoes");
const elSaida = $("saida");
const elCopiar = $("copiar");

let debounceTimer = null;

/** Busca sugestões de endereço com debounce de 300ms. */
function buscarEnderecoDebounce(query) {
 clearTimeout(debounceTimer);
 if (query.length < 3) {
 elSugestoes.replaceChildren();
 return;
 }
 debounceTimer = setTimeout(async () => {
 try {
 const sugestoes = await invoke("buscar_endereco", { query });
 renderizarSugestoes(sugestoes);
 } catch (e) {
 console.error(e);
 elSugestoes.replaceChildren();
 }
 }, 300);
}

function renderizarSugestoes(sugestoes) {
 elSugestoes.replaceChildren();
 for (const s of sugestoes.slice(0, 5)) {
 const li = document.createElement("li");
 li.tabIndex = 0;
 li.setAttribute("role", "option");
 const cep = s.context?.postcode?.name ?? "";
 li.innerHTML = `<strong>${s.name}</strong><small>${s.place_formatted}${cep ? " · CEP " + cep : ""}</small>`;
 const selecionar = () => {
 elCnpj.value = cep || s.name;
 elSugestoes.replaceChildren();
 if (cep) buscar(cep);
 };
 li.addEventListener("click", selecionar);
 li.addEventListener("keydown", (ev) => {
 if (ev.key === "Enter" || ev.key === " ") {
 ev.preventDefault();
 selecionar();
 }
 });
 elSugestoes.append(li);
 }
}

/** Rótulos dos campos conhecidos. Chave desconhecida aparece com o nome cru — nada é omitido. */
const LABELS = {
  cnpj: "CNPJ",
  cep: "CEP",
  street: "Logradouro",
  neighborhood: "Bairro",
  city: "Cidade",
  state: "UF",
  source: "Fonte",
  razao_social: "Razão social",
  nome_fantasia: "Nome fantasia",
  situacao_cadastral: "Situação cadastral",
  data_situacao_cadastral: "Data da situação cadastral",
  motivo_situacao_cadastral: "Motivo da situação cadastral",
  matriz_filial: "Matriz/Filial",
  data_inicio_atividade: "Início de atividade",
  natureza_juridica: "Natureza jurídica",
  codigo_natureza_juridica: "Código da natureza jurídica",
  porte_empresa: "Porte",
  capital_social: "Capital social",
  cnae_principal: "CNAE principal",
  cnaes: "CNAEs",
  cnaes_secundarios: "CNAEs secundários (códigos)",
  tipo_logradouro: "Tipo de logradouro",
  logradouro: "Logradouro",
  numero: "Número",
  complemento: "Complemento",
  bairro: "Bairro",
  cep: "CEP",
  uf: "UF",
  municipio: "Município",
  codigo_municipio: "Código do município",
  pais: "País",
  nome_cidade_exterior: "Cidade no exterior",
  codigo_pais: "Código do país",
  email: "E-mail",
  telefones: "Telefones",
  qualificacao_responsavel: "Qualificação do responsável",
  ente_federativo: "Ente federativo",
  opcao_simples: "Optante pelo Simples",
  data_opcao_simples: "Data de opção pelo Simples",
  data_exclusao_simples: "Data de exclusão do Simples",
  opcao_mei: "Optante pelo MEI",
  data_opcao_mei: "Data de opção pelo MEI",
  data_exclusao_mei: "Data de exclusão do MEI",
  situacao_especial: "Situação especial",
  data_situacao_especial: "Data da situação especial",
  QSA: "Quadro societário (QSA)",
  lgpd_anonimizado: "Dados anonimizados (LGPD)",
  updated_at: "Atualizado em",
  nome_socio: "Nome",
  cnpj_cpf_socio: "CPF/CNPJ",
  qualificacao_socio: "Qualificação",
  data_entrada_sociedade: "Entrada na sociedade",
  identificador_socio: "Identificador",
  representante_legal: "CPF do representante legal",
  nome_representante: "Nome do representante",
  qualificacao_representante: "Qualificação do representante",
  faixa_etaria: "Faixa etária",
  codigo: "Código",
  descricao: "Descrição",
  ddd: "DDD",
  is_fax: "Fax",
  is_principal: "Principal",
};

/** Ordem de exibição. Campos fora desta lista vão para o fim, com o nome cru. */
const ORDEM = [
  "cnpj", "razao_social", "nome_fantasia", "situacao_cadastral", "data_situacao_cadastral",
  "motivo_situacao_cadastral", "matriz_filial", "data_inicio_atividade", "natureza_juridica",
  "codigo_natureza_juridica", "porte_empresa", "capital_social", "cnae_principal", "cnaes",
  "cnaes_secundarios", "tipo_logradouro", "logradouro", "numero", "complemento", "bairro",
  "cep", "uf", "municipio", "codigo_municipio", "pais", "nome_cidade_exterior", "codigo_pais",
  "email", "telefones", "qualificacao_responsavel", "ente_federativo", "opcao_simples",
  "data_opcao_simples", "data_exclusao_simples", "opcao_mei", "data_opcao_mei",
  "data_exclusao_mei", "situacao_especial", "data_situacao_especial", "QSA",
  "lgpd_anonimizado", "updated_at",
];

const ORDEM_CEP = ["cep", "street", "neighborhood", "city", "state", "complement", "source"];

const LISTAS = { cnaes: "cnaes", telefones: "telefones", QSA: "qsa" };

const estado = { dados: null, formato: "md", texto: "" };

/** True quando o resultado é de CEP (tem CEP e não tem razão social). */
function ehCep(dados) {
  return Boolean(dados && dados.cep && !dados.razao_social && !dados.companyName);
}

/** Chip discreto quando a empresa tem menos de 6 meses desde data_inicio_atividade. */
function empresaNova(dados) {
  if (ehCep(dados) || !dados.data_inicio_atividade) return false;
  const inicio = new Date(`${dados.data_inicio_atividade}T00:00:00`);
  if (Number.isNaN(inicio.getTime())) return false;
  const diffMeses =
    (new Date().getFullYear() - inicio.getFullYear()) * 12 +
    (new Date().getMonth() - inicio.getMonth());
  return diffMeses < 6;
}

/** Linha de título do resultado: razão social no CNPJ, endereço no CEP. */
function titulo(dados) {
  if (ehCep(dados)) {
    const rua = [dados.street, dados.neighborhood, dados.city, dados.state].filter(Boolean).join(", ");
    return rua || `CEP ${mascararCep(dados.cep)}`;
  }
  return dados.razao_social ?? mascararCnpj(dados.cnpj);
}

function mascararCnpj(cnpj) {
  const d = String(cnpj ?? "").replace(/\D/g, "");
  if (d.length !== 14) return String(cnpj ?? "");
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function mascararCep(cep) {
  const d = String(cep ?? "").replace(/\D/g, "");
  if (d.length !== 8) return String(cep ?? "");
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** Formata pelos dígitos: 8 = CEP, 14 = CNPJ, outro tamanho fica como veio. */
function mascarar(valor) {
  const d = String(valor ?? "").replace(/\D/g, "");
  if (d.length === 8) return mascararCep(d);
  if (d.length === 14) return mascararCnpj(d);
  return String(valor ?? "");
}

function escalar(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return objetoInline(v);
  return String(v);
}

function objetoInline(o) {
  if ("descricao" in o && "codigo" in o) {
    const desc = o.descricao ?? "";
    return o.codigo ? `${desc} (código ${o.codigo})` : desc || "(vazio na resposta)";
  }
  return Object.entries(o)
    .map(([k, v]) => `${LABELS[k] ?? k}: ${escalar(v)}`)
    .join(" · ") || "(objeto vazio na resposta)";
}

function linhaTelefone(t) {
  const partes = [`(${t.ddd ?? ""}) ${t.numero ?? ""}`.trim()];
  if (t.is_fax === true) partes.push("fax");
  const sobra = Object.keys(t).filter((k) => !["ddd", "numero", "is_fax"].includes(k));
  for (const k of sobra) partes.push(`${LABELS[k] ?? k}: ${escalar(t[k])}`);
  return partes.join(" ");
}

/** Converte o JSON da API em blocos exibíveis, preservando todos os campos presentes. */
function blocos(dados) {
  const out = [];
  const usados = new Set();

  const push = (chave, bloco) => {
    usados.add(chave);
    out.push({ chave, rotulo: LABELS[chave] ?? chave, ...bloco });
  };

  for (const chave of ehCep(dados) ? ORDEM_CEP : ORDEM) {
    if (!(chave in dados)) continue;
    const valor = dados[chave];
    if (valor === null || valor === undefined) continue;

    if (LISTAS[chave] === "cnaes" && Array.isArray(valor) && valor.length) {
      push(chave, { tipo: "lista", itens: valor.map((c) => {
        const extras = Object.keys(c).filter((k) => !["codigo", "descricao", "is_principal"].includes(k));
        const linha = `${c.codigo ?? ""} — ${c.descricao ?? ""}${c.is_principal === true ? " (principal)" : ""}`;
        return [linha, ...extras.map((k) => `${LABELS[k] ?? k}: ${escalar(c[k])}`)];
      }) });
    } else if (LISTAS[chave] === "telefones" && Array.isArray(valor) && valor.length) {
      push(chave, { tipo: "lista", itens: valor.map((t) => [linhaTelefone(t)]) });
    } else if (LISTAS[chave] === "qsa" && Array.isArray(valor) && valor.length) {
      push(chave, { tipo: "subobjetos", itens: valor.map((s) => {
        const nome = s.nome_socio ?? "(sem nome)";
        const linhas = [];
        for (const [k, v] of Object.entries(s)) {
          if (k === "nome_socio" || v === null || v === undefined) continue;
          const txt = escalar(v);
          if (txt === "") continue;
          linhas.push(`${LABELS[k] ?? k}: ${txt}`);
        }
        return { titulo: nome, linhas };
      }) });
    } else if (Array.isArray(valor)) {
      push(chave, { tipo: "valor", texto: valor.map(escalar).join(", ") });
    } else if (chave === "cnpj" || chave === "cep") {
      // identificadores saem sempre mascarados, tanto no CNPJ quanto no endereço
      push(chave, { tipo: "valor", texto: mascarar(valor) });
    } else {
      push(chave, { tipo: "valor", texto: escalar(valor) });
    }
  }

  for (const [k, v] of Object.entries(dados)) {
    if (usados.has(k) || v === null || v === undefined) continue;
    out.push({ chave: k, rotulo: LABELS[k] ?? k, tipo: "valor", texto: escalar(v) });
  }

  return out.filter((b) => b.tipo !== "valor" || b.texto !== "");
}

function renderMarkdown(dados) {
  const linhas = [`# ${titulo(dados)}`, ""];
  for (const b of blocos(dados)) {
    const nome = b.rotulo;
    if (b.tipo === "valor") {
      linhas.push(`- **${nome}:** ${b.texto}`);
    } else if (b.tipo === "lista") {
      linhas.push("", `**${nome}:**`, "");
      for (const item of b.itens) linhas.push(`- ${item[0]}`, ...item.slice(1).map((l) => `  - ${l}`));
    } else {
      linhas.push("", `**${nome}:**`, "");
      b.itens.forEach((s, i) => {
        linhas.push(`${i + 1}. **${s.titulo}**`);
        for (const l of s.linhas) linhas.push(`   - ${l}`);
      });
    }
  }
  return linhas.join("\n").trimEnd() + "\n";
}

function renderTexto(dados) {
  const sep = "─".repeat(46);
  const linhas = [String(titulo(dados)).toUpperCase(), sep];
  for (const b of blocos(dados)) {
    const nome = b.rotulo;
    if (b.tipo === "valor") {
      linhas.push(`${nome}: ${b.texto}`);
    } else if (b.tipo === "lista") {
      linhas.push("", `${nome}:`);
      for (const item of b.itens) {
        linhas.push(`  - ${item[0]}`);
        for (const l of item.slice(1)) linhas.push(`      ${l}`);
      }
    } else {
      linhas.push("", `${nome}:`);
      b.itens.forEach((s, i) => {
        linhas.push(`  ${i + 1}. ${s.titulo}`);
        for (const l of s.linhas) linhas.push(`     ${l}`);
      });
    }
  }
  return linhas.join("\n").trimEnd() + "\n";
}

function atualizarSaida() {
  if (!estado.dados) return;
  estado.texto = estado.formato === "md" ? renderMarkdown(estado.dados) : renderTexto(estado.dados);
  const pre = document.createElement("pre");
  // Markdown é o formato copiado; no painel, remove a sintaxe para não exibir asteriscos crus.
  pre.textContent = estado.formato === "md"
    ? estado.texto.replace(/^# /, "").replace(/\*\*/g, "").replace(/^ {0,3}- /gm, "• ")
    : estado.texto;
  elSaida.replaceChildren(pre);
  if (empresaNova(estado.dados)) elSaida.append(chipEmpresaNova());
  elCopiar.classList.remove("copiado");
  elCopiar.textContent = "Copiar";
  elCopiar.disabled = false;
}

/** Chip "nova": empresa aberta há menos de 6 meses. */
function chipEmpresaNova() {
  const chip = document.createElement("span");
  chip.className = "chip-nova";
  chip.textContent = "nova";
  chip.title = `Aberta há menos de 6 meses (início em ${estado.dados.data_inicio_atividade})`;
  return chip;
}

function aviso(texto, tipo) {
  elMsg.textContent = texto;
  elMsg.className = tipo ?? "";
}

async function buscar(entrada) {
  aviso("Consultando…");
  elBuscar.disabled = true;
  try {
    const dados = await invoke("consultar", { entrada });
    estado.dados = dados;
    elCnpj.value = mascarar(dados.cnpj ?? dados.cep ?? entrada);
    atualizarSaida();
    aviso("");
    await carregarHistorico();
  } catch (e) {
    aviso(String(e), "erro");
  } finally {
    elBuscar.disabled = false;
  }
}

function dataCurta(ts) {
  try {
    return new Date(Number(ts)).toLocaleString(undefined, {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "";
  }
}

async function carregarHistorico() {
  let lista = [];
  try {
    lista = await invoke("historico");
  } catch (e) {
    console.error(e);
  }
  elHist.replaceChildren();
  for (const item of lista) {
    const li = document.createElement("li");
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.title = `Mostrar consulta de ${mascarar(item.chave)} (${dataCurta(item.ts)})`;
    li.textContent = `${mascarar(item.chave)} · ${dataCurta(item.ts)}`;
    const abrir = () => {
      estado.dados = item.dados;
      elCnpj.value = mascarar(item.chave);
      atualizarSaida();
      aviso(`Consulta de ${dataCurta(item.ts)} — dados salvos localmente.`, "ok");
      elSaida.focus();
    };
    li.addEventListener("click", abrir);
    li.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        abrir();
      }
    });
    elHist.append(li);
  }
}

function marcarCopiado() {
  elCopiar.textContent = "Copiado";
  elCopiar.classList.add("copiado");
  clearTimeout(marcarCopiado.t);
  marcarCopiado.t = setTimeout(() => {
    elCopiar.textContent = "Copiar";
    elCopiar.classList.remove("copiado");
  }, 1600);
}

async function copiar() {
  if (!estado.texto) return;
  try {
    await navigator.clipboard.writeText(estado.texto);
    marcarCopiado();
    aviso("Copiado para a área de transferência.", "ok");
  } catch {
    // fallback para WebViews sem permissão de clipboard
    const ta = document.createElement("textarea");
    ta.value = estado.texto;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (ok) marcarCopiado();
    aviso(ok ? "Copiado para a área de transferência." : "Não foi possível copiar.", ok ? "ok" : "erro");
  }
}

function fechar() {
  getCurrentWindow().hide().catch(() => {});
}

elForm.addEventListener("submit", (ev) => {
  ev.preventDefault();
  elSugestoes.replaceChildren();
  buscar(elCnpj.value);
});

// Autocomplete de endereço: dispara após 3+ caracteres com debounce
elCnpj.addEventListener("input", () => {
  const valor = elCnpj.value.trim();
  const soDigitos = valor.replace(/\D/g, "");
  // Se parece CNPJ/CEP completo ou quase, não busca endereço
  if (soDigitos.length >= 8 && /^[\d.\-\/\s]+$/.test(valor)) {
    elSugestoes.replaceChildren();
    return;
  }
  if (valor.length >= 3 && /[a-zA-ZÀ-ÿ]/.test(valor)) {
    buscarEnderecoDebounce(valor);
  } else {
    elSugestoes.replaceChildren();
  }
});

// Substitui lista de histórico por combobox compacto
async function carregarHistoricoCombobox() {
  let lista = [];
  try {
    lista = await invoke("historico");
  } catch (e) {
    console.error(e);
  }
  // Remove combobox anterior se existir
  const antigo = document.getElementById("historico-combobox");
  if (antigo) antigo.remove();
  elHist.replaceChildren();
  elHist.style.display = "none";

  if (!lista.length) return;

  const select = document.createElement("select");
  select.id = "historico-combobox";
  select.className = "historico-combobox";
  select.setAttribute("aria-label", "Histórico de consultas");

  const optPadrao = document.createElement("option");
  optPadrao.value = "";
  optPadrao.textContent = "Histórico recente...";
  optPadrao.disabled = true;
  optPadrao.selected = true;
  select.appendChild(optPadrao);

  lista.forEach((item, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    // Compatibilidade: usa 'cnpj' se 'chave' não existir (histórico antigo)
    const identificador = item.chave || item.cnpj;
    opt.textContent = `${mascarar(identificador)} · ${dataCurta(item.ts)}`;
    opt.dataset.item = JSON.stringify(item);
    select.appendChild(opt);
  });

  select.addEventListener("change", () => {
    const opt = select.options[select.selectedIndex];
    if (!opt || !opt.dataset.item) return;
    const item = JSON.parse(opt.dataset.item);
    estado.dados = item.dados;
    const identificador = item.chave || item.cnpj;
    elCnpj.value = mascarar(identificador);
    atualizarSaida();
    aviso(`Consulta de ${dataCurta(item.ts)} — dados salvos localmente.`, "ok");
    elSaida.focus();
    // Reset para permitir reselecionar
    select.selectedIndex = 0;
  });

  elHist.parentNode.insertBefore(select, elHist.nextSibling);
}

// Sobrescreve carregarHistorico para usar combobox
const _carregarHistoricoOriginal = carregarHistorico;
carregarHistorico = async function() {
  await carregarHistoricoCombobox();
};

for (const btn of document.querySelectorAll("[data-formato]")) {
  btn.addEventListener("click", () => {
    estado.formato = btn.dataset.formato;
    for (const b of document.querySelectorAll("[data-formato]")) {
      b.setAttribute("aria-pressed", String(b === btn));
    }
    atualizarSaida();
  });
}

elCopiar.addEventListener("click", copiar);
$("fechar").addEventListener("click", fechar);

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    if (elSugestoes.children.length > 0) {
      elSugestoes.replaceChildren();
    } else {
      fechar();
    }
  }
});

window.addEventListener("focus", () => {
  elCnpj.focus();
  elCnpj.select();
});

carregarHistorico();
elCnpj.focus();
