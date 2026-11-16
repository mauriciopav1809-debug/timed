/* Leitura e previa sem alterar o estado do cronometro. Bibliotecas locais sob demanda. */
export const CAMPOS = [
  ['', 'Ignorar'], ['ord', 'Ordem'], ['num', 'Nº'], ['insc', 'Inscrição'],
  ['cav', 'Cavaleiro'], ['cavalo', 'Cavalo'], ['ent', 'Entidade'],
  ['eq', 'Equipe'], ['cat', 'Categoria']
];
const ALIASES = {
  ord: ['ordem', 'ord', 'o.e', 'oe', 'seq', 'partida'],
  num: ['nº', 'no', 'num', 'numero', 'dorsal', 'colete'],
  insc: ['inscricao', 'insc', 'codigo', 'id'],
  cav: ['cavaleiro', 'amazona', 'atleta', 'competidor', 'conjunto', 'nome'],
  cavalo: ['cavalo', 'animal', 'montaria'],
  ent: ['entidade', 'clube', 'om', 'unidade', 'organizacao'],
  eq: ['equipe', 'time'],
  cat: ['categoria', 'serie', 'prova', 'nivel']
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/º|°/g, 'o').replace(/[^a-z0-9]+/g, ' ').trim();

export function campo(s) {
  const n = norm(s);
  // Correspondencia exata antes de palavras: "nome do cavalo" nao e cavaleiro.
  for (const [key, words] of Object.entries(ALIASES)) {
    if (words.some(w => norm(w) === n)) return key;
  }
  const tokens = n.split(' ');
  if (tokens.includes('cavalo') || tokens.includes('montaria')) return 'cavalo';
  for (const [key, words] of Object.entries(ALIASES)) {
    if (words.some(w => tokens.includes(norm(w)))) return key;
  }
  return '';
}

export function analisar(rows) {
  rows = rows.map(row => Array.from(row, v => String(v ?? '').trim()));
  let cab = -1;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    if (new Set(rows[i].map(campo).filter(Boolean)).size >= 2) { cab = i; break; }
  }
  const width = rows.reduce((n, row) => Math.max(n, row.length), 0);
  const usados = new Set();
  const mapa = Array.from({length: width}, (_, i) => {
    const k = cab < 0 ? '' : campo(rows[cab][i]);
    if (!k || usados.has(k)) return '';
    usados.add(k);
    return k;
  });
  return {rows, cab, mapa};
}

export function interpretar(modelo, mapa = modelo.mapa) {
  const usados = mapa.filter(Boolean);
  if (!usados.includes('cav') && !usados.includes('cavalo')) return [];
  const rows = modelo.rows.slice(modelo.cab + 1);
  const result = [];
  for (const row of rows) {
    if (!row.some(s => s.trim())) continue;
    // Cabecalhos repetidos, inclusive em paginas seguintes do PDF.
    const iguais = row.reduce((n, v, i) => n + (mapa[i] && campo(v) === mapa[i] ? 1 : 0), 0);
    if (iguais >= 2 || (modelo.cab >= 0 && row.length === modelo.rows[modelo.cab].length &&
      row.every((v, i) => norm(v) === norm(modelo.rows[modelo.cab][i])))) continue;
    const c = {ord:'', num:'', insc:'', cav:'', cavalo:'', ent:'', eq:'', cat:''};
    mapa.forEach((k, i) => { if (k) c[k] = (row[i] || '').trim(); });
    if (c.cav || c.cavalo) result.push(c);
  }
  if (mapa.includes('ord')) {
    const numero = s => s.trim() && Number.isFinite(Number(s.replace(',', '.'))) ?
      Number(s.replace(',', '.')) : Infinity;
    result.sort((a, b) => numero(a.ord) - numero(b.ord));
  }
  return result;
}

// CSV com aspas, aspas duplicadas, quebras de linha dentro de celulas e BOM.
export function separar(texto, sep) {
  texto = texto.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === '"') {
      if (quoted && texto[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || cell === '') quoted = !quoted;
      else cell += c;
    } else if (!quoted && c === sep) { row.push(cell.trim()); cell = ''; }
    else if (!quoted && (c === '\r' || c === '\n')) {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      row.push(cell.trim()); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('Há aspas sem fechamento no texto. Confira o arquivo ou a lista colada.');
  row.push(cell.trim()); rows.push(row);
  return rows;
}

export function lerTexto(texto, csv = false) {
  const choices = csv ? [';', ',', '\t'] : ['\t', ';', '|'];
  let best = choices[0], score = -1;
  for (const sep of choices) {
    const rows = separar(texto, sep).filter(r => r.some(Boolean)).slice(0, 30);
    const counts = new Map();
    rows.forEach(r => { if (r.length > 1) counts.set(r.length, (counts.get(r.length) || 0) + 1); });
    const s = Math.max(0, ...[...counts].map(([len, count]) => count * 100 + len));
    if (s > score) { best = sep; score = s; }
  }
  return separar(texto, best);
}

let xlsxPromise;
export function carregarXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxPromise) xlsxPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./lib/xlsx.full.min.js', import.meta.url).href;
    script.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error('Falha ao carregar o leitor de planilhas.'));
    script.onerror = () => { script.remove(); xlsxPromise = null; reject(new Error('Não foi possível carregar o leitor de planilhas. Reabra o app online uma vez para preparar o uso offline.')); };
    document.head.appendChild(script);
  });
  return xlsxPromise;
}

// Primeiro agrupa por y, depois por x e pelos espacos entre os itens.
export function linhasPDF(items) {
  const lines = [];
  const sorted = items.filter(i => i.str?.trim()).map(i => ({
    text: i.str.trim(), x: i.transform[4], y: i.transform[5],
    w: i.width, h: Math.abs(i.height || i.transform[3] || 10)
  })).sort((a, b) => b.y - a.y || a.x - b.x);
  for (const item of sorted) {
    let line = lines.find(l => Math.abs(l.y - item.y) <= Math.max(2, Math.min(l.h, item.h) * .3));
    if (!line) { line = {y: item.y, h: item.h, items: []}; lines.push(line); }
    line.items.push(item);
  }
  return lines.map(line => {
    const cells = [];
    line.items.sort((a, b) => a.x - b.x).forEach(i => {
      const prev = cells[cells.length - 1];
      if (prev && i.x - prev.end < Math.max(8, i.h * .85)) {
        prev.text += ' ' + i.text; prev.end = Math.max(prev.end, i.x + i.w);
      } else cells.push({text: i.text, x: i.x, end: i.x + i.w});
    });
    return {items: line.items, cells};
  });
}

export async function lerPDF(buffer) {
  const pdfjs = await import('./lib/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./lib/pdf.worker.min.mjs', import.meta.url).href;
  const task = pdfjs.getDocument({data: new Uint8Array(buffer), isEvalSupported: false,
    useSystemFonts: true});
  let doc;
  try {
    doc = await task.promise;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      pages.push(linhasPDF(content.items));
      page.cleanup();
    }
    const lines = pages.flat();
    if (!lines.length) throw new Error('Este PDF é uma imagem (escaneado). Use a planilha original ou digite a lista.');
    // O cabecalho fornece as ancoras de coluna e preserva celulas vazias.
    const header = lines.slice(0, 15).find(l => new Set(l.cells.map(c => campo(c.text)).filter(Boolean)).size >= 2);
    if (!header) return lines.map(l => l.cells.map(c => c.text));
    return pages.flatMap(pageLines => {
      const local = pageLines.find(l => new Set(l.cells.map(c => campo(c.text)).filter(Boolean)).size >= 2);
      const anchors = local && local.cells.length === header.cells.length ? local.cells : header.cells;
      return pageLines.map(l => {
        const row = anchors.map(() => '');
        l.items.forEach(item => {
          let col = 0;
          for (let i = 1; i < anchors.length; i++) {
            if (item.x >= anchors[i].x - 4) col = i;
          }
          row[col] += (row[col] ? ' ' : '') + item.text;
        });
        return row;
      });
    });
  } catch (e) {
    if (e.name === 'PasswordException') throw new Error('Este PDF está protegido por senha. Use uma cópia sem proteção ou a planilha original.');
    throw e;
  } finally { if (doc) await doc.destroy(); else await task.destroy(); }
}

export async function lerArquivo(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const buffer = await file.arrayBuffer();
  if (ext === 'csv') {
    let text = new TextDecoder('utf-8').decode(buffer);
    if (text.includes('\uFFFD')) text = new TextDecoder('windows-1252').decode(buffer);
    return {rows: lerTexto(text, true)};
  }
  if (ext === 'pdf') return {rows: await lerPDF(buffer)};
  if (!['xlsx', 'xls', 'ods'].includes(ext)) throw new Error('Formato não aceito. Use XLSX, XLS, ODS, CSV ou PDF.');
  const XLSX = await carregarXLSX();
  let book;
  try { book = XLSX.read(buffer, {type: 'array'}); }
  catch (e) { throw new Error('Não foi possível ler a planilha. Confira se o arquivo é válido e não está protegido por senha.'); }
  if (!book.SheetNames.length) throw new Error('A planilha não possui abas.');
  const sheetRows = name => XLSX.utils.sheet_to_json(book.Sheets[name], {
    header: 1, defval: '', blankrows: true, raw: false
  });
  return {rows: sheetRows(book.SheetNames[0]), abas: book.SheetNames, sheetRows};
}

export async function abrir({file, texto = '', temLista, confirmar}) {
  if (document.querySelector('#importacao')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'importacao'; dialog.className = 'importacao';
  dialog.setAttribute('aria-labelledby', 'imp-titulo');
  dialog.innerHTML = '<h2 id="imp-titulo">Importar conjuntos</h2><p role="status">Lendo os dados, aguarde.</p><button class="sm" id="imp-cancelar">Cancelar</button>';
  document.body.appendChild(dialog);
  dialog.showModal();
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dialog.querySelector('#imp-cancelar').onclick = close;
  let source;
  try { source = file ? await lerArquivo(file) : {rows: lerTexto(texto)}; }
  catch (e) {
    if (!dialog.isConnected) return;
    dialog.querySelector('[role=status]').textContent = e.message.startsWith('Este PDF') ||
      e.message.startsWith('Não foi') || e.message.startsWith('Há aspas') ||
      e.message.startsWith('Formato') || e.message.startsWith('A planilha') ? e.message :
      'Não foi possível ler este arquivo. Confira o formato e tente novamente.';
    return;
  }
  if (!dialog.isConnected) return;
  let modelo, mapa;
  const loadRows = rows => { modelo = analisar(rows); mapa = modelo.mapa.slice(); };
  loadRows(source.rows);
  dialog.innerHTML = '<h2 id="imp-titulo">Prévia da importação</h2><p>'+esc(file?.name || 'Texto colado')+'</p>'+
    (source.abas?.length > 1 ? '<label for="imp-aba">Aba da planilha</label><select id="imp-aba">'+source.abas.map(n => '<option>'+esc(n)+'</option>').join('')+'</select>' : '')+
    '<p id="imp-aviso"></p><div class="imap" id="imp-mapa"></div>'+
    (temLista ? '<label for="imp-modo">Lista atual</label><select id="imp-modo"><option value="acrescentar">Acrescentar ao fim</option><option value="substituir">Substituir a lista</option></select><p class="mu">Substituir remove os conjuntos e tempos atuais. Acrescentar preserva os dados existentes.</p>' : '')+
    '<p id="imp-contagem" role="status" aria-live="polite"></p><div class="tw" id="imp-tabela"></div>'+
    '<p class="mu">A prévia mostra até 20 conjuntos. Sem número, o app numera ao confirmar.</p>'+
    '<div class="row"><button class="sm" id="imp-cancelar">Cancelar</button><button class="sm" id="imp-confirmar">Confirmar importação</button></div>';
  const q = sel => dialog.querySelector(sel);
  function update() {
    const selected = mapa.filter(Boolean);
    const duplicate = new Set(selected).size !== selected.length;
    const rows = interpretar(modelo, mapa);
    q('#imp-contagem').textContent = duplicate ? 'Cada campo deve ser escolhido em apenas uma coluna.' :
      !selected.includes('cav') && !selected.includes('cavalo') ? 'Escolha a coluna Cavaleiro ou Cavalo para continuar.' :
      rows.length === 1 ? '1 conjunto será importado' : rows.length+' conjuntos serão importados';
    q('#imp-confirmar').disabled = duplicate || !rows.length;
    const fields = CAMPOS.filter(([key]) => key && selected.includes(key));
    q('#imp-tabela').innerHTML = '<table><thead><tr>'+fields.map(([, label]) => '<th>'+label+'</th>').join('')+
      '</tr></thead><tbody>'+rows.slice(0, 20).map(c => '<tr>'+fields.map(([key]) => '<td>'+esc(c[key])+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
  }
  function mappingUI() {
    q('#imp-aviso').textContent = modelo.cab < 0 ?
      'Cabeçalho não reconhecido. A primeira linha será um dado. Escolha o significado de cada coluna.' :
      'Cabeçalho encontrado na linha '+(modelo.cab + 1)+'. Confira o mapeamento antes de confirmar.';
    q('#imp-mapa').innerHTML = mapa.map((key, i) => {
      const example = modelo.rows[modelo.cab < 0 ? 0 : modelo.cab]?.[i] || '';
      return '<div><label for="imp-col-'+i+'">Coluna '+(i + 1)+'</label><small>'+esc(example || '(vazia)')+'</small><select id="imp-col-'+i+'" data-col="'+i+'">'+
        CAMPOS.map(([k, label]) => '<option value="'+k+'"'+(k === key ? ' selected' : '')+'>'+label+'</option>').join('')+'</select></div>';
    }).join('');
    q('#imp-mapa').onchange = e => {
      if (e.target.dataset.col == null) return;
      mapa[Number(e.target.dataset.col)] = e.target.value; update();
    };
    update();
  }
  q('#imp-aba')?.addEventListener('change', e => {
    loadRows(source.sheetRows(e.target.value)); mappingUI();
  });
  q('#imp-cancelar').onclick = close;
  q('#imp-confirmar').onclick = () => {
    if (q('#imp-confirmar').disabled) return;
    const rows = interpretar(modelo, mapa);
    const modo = q('#imp-modo')?.value || 'acrescentar';
    confirmar(rows, modo);
    close();
  };
  mappingUI();
}
