"use strict";

const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;

const $ = (id) => document.getElementById(id);
const elForm = $("form");
const elCnpj = $("cnpj");
const elBuscar = $("buscar");
const elMsg = $("msg");
const elHist = $("historico");
const elSaida = $("saida");
const elCopiar = $("copiar");

/** Rótulos dos campos conhecidos. Chave desconhecida aparece com o nome cru — nada é omitido. */
const LABELS = {
  cnpj: "CNPJ",
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

const LISTAS = { cnaes: "cnaes", telefones: "telefones", QSA: "qsa" };

const estado = { dados: null, formato: "md", texto: "" };

function mascarar(cnpj) {
  const d = String(cnpj ?? "").replace(/\D/g, "");
  if (d.length !== 14) return String(cnpj ?? "");
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
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

  for (const chave of ORDEM) {
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
    } else {
      const txt = escalar(valor);
      push(chave, { tipo: "valor", texto: txt });
    }
  }

  for (const [k, v] of Object.entries(dados)) {
    if (usados.has(k) || v === null || v === undefined) continue;
    out.push({ chave: k, rotulo: LABELS[k] ?? k, tipo: "valor", texto: escalar(v) });
  }

  return out.filter((b) => b.tipo !== "valor" || b.texto !== "");
}

function renderMarkdown(dados) {
  const linhas = [`# ${dados.razao_social ?? mascarar(dados.cnpj)}`, ""];
  for (const b of blocos(dados)) {
    const nome = b.chave === "cnpj" ? `${b.rotulo} ${mascarar(dados.cnpj)}` : b.rotulo;
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
  const linhas = [String(dados.razao_social ?? "").toUpperCase(), sep];
  for (const b of blocos(dados)) {
    const nome = b.chave === "cnpj" ? `${b.rotulo} ${mascarar(dados.cnpj)}` : b.rotulo;
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
  elCopiar.classList.remove("copiado");
  elCopiar.textContent = "Copiar";
  elCopiar.disabled = false;
}

function aviso(texto, tipo) {
  elMsg.textContent = texto;
  elMsg.className = tipo ?? "";
}

async function buscar(cnpj) {
  aviso("Consultando…");
  elBuscar.disabled = true;
  try {
    const dados = await invoke("consultar", { cnpj });
    estado.dados = dados;
    elCnpj.value = mascarar(dados.cnpj ?? cnpj);
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
    li.title = `Mostrar consulta de ${mascarar(item.cnpj)} (${dataCurta(item.ts)})`;
    li.textContent = `${mascarar(item.cnpj)} · ${dataCurta(item.ts)}`;
    const abrir = () => {
      estado.dados = item.dados;
      elCnpj.value = mascarar(item.cnpj);
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
  buscar(elCnpj.value);
});

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
  if (ev.key === "Escape") fechar();
});

window.addEventListener("focus", () => {
  elCnpj.focus();
  elCnpj.select();
});

carregarHistorico();
elCnpj.focus();
