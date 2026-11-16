/* Backup separado do cronometro. Nenhuma credencial e colocada no estado S. */
(function () {
  'use strict';
  var KEY = 'timed_sync';
  var ERROS = {
    codigo_em_uso: 'Este código já está em uso. Escolha outro ou restaure a prova existente.',
    nao_encontrado: 'Prova não encontrada. Confira o código e a senha.',
    senha_invalida: 'Senha incorreta. Confira a senha do backup.',
    dados_grandes: 'Esta prova excede o tamanho aceito pelo backup online. Exporte um arquivo JSON para guardar os dados.',
    erro_interno: 'O servidor não conseguiu concluir o backup. Tente novamente.',
    codigo_invalido: 'Código inválido. Use de 4 a 20 caracteres: letras, números e hífen.',
    senha_curta: 'A senha precisa ter pelo menos 4 caracteres.',
    acao_invalida: 'O servidor não reconheceu a operação. Confira a configuração do backend.',
    rede: 'Sem conexão com o servidor. Os dados continuam no aparelho e o envio permanece pendente.',
    resposta_invalida: 'O servidor devolveu uma resposta inválida. O backup permanece pendente.'
  };
  var CONFLITO = 'Esta prova foi alterada em outro aparelho. Restaurar a versão da nuvem ou manter a deste aparelho?';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c];
  }); }
  function revOK(n) { return Number.isSafeInteger(n) && n >= 0 && n < Number.MAX_SAFE_INTEGER; }
  function objeto(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  /* Aceita o estado antigo e o envelope de arquivo TIMED, sem aceitar estruturas
     que quebrem calc/byId. A ordem e os timestamps dos eventos sao preservados. */
  function validar(raw) {
    if (objeto(raw) && raw.app === 'TIMED') {
      if (raw.formato !== 1) throw new Error('Versão de arquivo de backup não suportada.');
      raw = raw.dados;
    }
    if (!objeto(raw) || !objeto(raw.cfg) || !Array.isArray(raw.list)) {
      throw new Error('Backup inválido: faltam os dados da prova ou a lista de conjuntos.');
    }
    var cfg = {nome:'', ext:3000, vel:450, tc:'', int:120, som:true, dark:false, serie:'pers'};
    ['nome', 'tc', 'serie'].forEach(function (k) {
      if (raw.cfg[k] !== undefined) {
        if (typeof raw.cfg[k] !== 'string') throw new Error('Backup inválido: campo de configuração '+k+'.');
        cfg[k] = raw.cfg[k];
      }
    });
    ['ext', 'vel', 'int'].forEach(function (k) {
      if (raw.cfg[k] !== undefined) {
        if (typeof raw.cfg[k] !== 'number' || !Number.isFinite(raw.cfg[k]) || raw.cfg[k] < (k === 'int' ? 15 : 0)) {
          throw new Error('Backup inválido: valor de '+k+'.');
        }
        cfg[k] = raw.cfg[k];
      }
    });
    ['som', 'dark'].forEach(function (k) {
      if (raw.cfg[k] !== undefined) {
        if (typeof raw.cfg[k] !== 'boolean') throw new Error('Backup inválido: campo '+k+'.');
        cfg[k] = raw.cfg[k];
      }
    });
    var ids = new Set();
    var list = raw.list.map(function (c) {
      if (!objeto(c) || typeof c.id !== 'string' || !c.id || ids.has(c.id) || !Array.isArray(c.ev)) {
        throw new Error('Backup inválido: conjunto sem identificação válida, repetido ou sem eventos.');
      }
      ids.add(c.id);
      var item = {id:c.id, num:'', cav:'', cavalo:''};
      ['num', 'cav', 'cavalo', 'ord', 'insc', 'ent', 'eq', 'cat'].forEach(function (k) {
        if (c[k] !== undefined) {
          if (typeof c[k] !== 'string') throw new Error('Backup inválido: campo '+k+' de um conjunto.');
          item[k] = c[k];
        }
      });
      item.ev = c.ev.map(function (e) {
        if (!objeto(e) || typeof e.k !== 'string' || !/^[LPRCF]$/.test(e.k) || typeof e.t !== 'number' ||
          !Number.isFinite(e.t) || e.t < 0 || e.t > 8640000000000000) {
          throw new Error('Backup inválido: evento ou horário de cronometragem inválido.');
        }
        return {k:e.k, t:e.t};
      });
      return item;
    });
    return {cfg:cfg, list:list};
  }

  function criar(op) {
    var url = op.url, sync = {ativo:false, rev:0, pendente:false};
    var entrada = {codigo:'', senha:''}, aviso = '', avisoArquivo = '', armazenamento = '';
    var timer = null, ocupado = false, pausado = false, epoca = 0, mudancas = 0;
    var controle = null, lendoArquivo = false;
    try {
      var saved = JSON.parse(localStorage.getItem(KEY));
      if (objeto(saved) && saved.ativo && typeof saved.codigo === 'string' &&
        typeof saved.senha === 'string' && revOK(saved.rev)) {
        sync = {
          ativo:true, codigo:saved.codigo, senha:saved.senha, rev:saved.rev,
          pendente:!!saved.pendente, sincronizadoEm:Number(saved.sincronizadoEm) || 0,
          erro:typeof saved.erro === 'string' ? saved.erro : '',
          conflitoRev:revOK(saved.conflitoRev) ? saved.conflitoRev : null
        };
        entrada = {codigo:sync.codigo, senha:sync.senha};
      }
    } catch (e) { armazenamento = 'Não foi possível ler a configuração do backup neste navegador.'; }

    function persistir() {
      try { localStorage.setItem(KEY, JSON.stringify(sync)); armazenamento = ''; }
      catch (e) { armazenamento = 'Não foi possível guardar a configuração do backup. Não feche a aba antes de exportar um arquivo JSON.'; }
    }
    function mensagemErro(code) { return ERROS[code] || 'Não foi possível concluir o backup. Tente novamente.'; }
    function bloqueado() {
      return sync.conflitoRev != null || ['senha_invalida','codigo_invalido','senha_curta',
        'acao_invalida','dados_grandes','nao_encontrado'].includes(sync.erro);
    }
    function indicador() {
      if (!url || !sync.ativo) return {texto:'SALVO NO APARELHO', classe:''};
      if (sync.erro === 'senha_invalida') return {texto:'ERRO DE SENHA', classe:'bad'};
      if (sync.pendente || sync.conflitoRev != null) return {texto:'PENDENTE', classe:'wa'};
      var d = new Date(sync.sincronizadoEm);
      return {texto:'SINCRONIZADO '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'), classe:'ok'};
    }
    function atualizarUI() {
      var pill = document.querySelector('#sync'), i = indicador();
      if (pill) { pill.textContent = i.texto; pill.className = 'pill sync '+i.classe; }
      var message = document.querySelector('#backup-msg');
      if (message) message.textContent = armazenamento || aviso ||
        (sync.erro ? mensagemErro(sync.erro) : (sync.ativo ? 'Backup ativo: '+sync.codigo+'.' : 'O backup online ainda não está ativo.'));
      var fileMessage = document.querySelector('#backup-arquivo-msg');
      if (fileMessage) fileMessage.textContent = avisoArquivo;
      document.querySelectorAll('[data-backup="criar"],[data-backup="carregar"],[data-backup="senha"]').forEach(function (b) {
        b.disabled = ocupado || pausado;
      });
      document.querySelectorAll('[data-backup="desativar"]').forEach(function (b) { b.hidden = !sync.ativo; });
      document.querySelectorAll('[data-backup="senha"]').forEach(function (b) { b.hidden = sync.erro !== 'senha_invalida'; });
      var conflict = document.querySelector('#sync-conflito');
      if (conflict) {
        var visible = !!url && sync.ativo && sync.conflitoRev != null;
        conflict.hidden = !visible;
        if (visible && !conflict.childElementCount) {
          conflict.innerHTML = '<p>'+CONFLITO+'</p><div class="row">'+
            '<button class="sm" data-backup="nuvem">Restaurar a versão da nuvem</button>'+
            '<button class="sm" data-backup="manter">Manter a deste aparelho</button></div>';
        }
        conflict.querySelectorAll('button').forEach(function (b) { b.disabled = ocupado || pausado; });
      }
    }
    function onlineHTML() {
      if (!url) return '<div class="sec">BACKUP ONLINE</div><section class="card" style="margin-top:8px"><p>Backup online não configurado</p></section>';
      return '<div class="sec">BACKUP ONLINE</div><section class="card" style="margin-top:8px">'+
        '<label for="backup-codigo">Código da prova</label><input id="backup-codigo" type="text" maxlength="20" autocapitalize="characters" autocomplete="off" value="'+esc(entrada.codigo)+'">'+
        '<label for="backup-senha">Senha</label><input id="backup-senha" type="password" autocomplete="off" value="'+esc(entrada.senha)+'">'+
        '<p class="mu" style="font-size:13px">Use de 4 a 20 letras, números ou hífen no código e pelo menos 4 caracteres na senha. A senha é guardada somente neste navegador, separada da prova e dos arquivos exportados.</p>'+
        '<div class="row"><button class="sm" data-backup="criar">Ativar backup desta prova</button>'+
        '<button class="sm" data-backup="carregar">Restaurar de outro aparelho</button></div>'+
        '<button class="sm full" style="margin-top:10px" data-backup="senha" hidden>Atualizar senha e tentar novamente</button>'+
        '<button class="sm full" style="margin-top:10px" data-backup="desativar" hidden>Desativar backup neste aparelho</button>'+
        '<p id="backup-msg" role="status" aria-live="polite"></p></section>';
    }
    function arquivoHTML() {
      return '<div class="sec">ARQUIVO DE BACKUP</div><section class="card" style="margin-top:8px">'+
        '<div class="row"><button class="sm" data-backup="exportar">Exportar backup (.json)</button>'+
        '<button class="sm" data-backup="importar">Importar backup (.json)</button></div>'+
        '<input id="backup-json" type="file" accept=".json,application/json" hidden>'+
        '<p class="mu" style="font-size:13px">Funciona sem internet. O arquivo contém a prova, os conjuntos e todos os eventos, sem a senha do backup online.</p>'+
        '<p id="backup-arquivo-msg" role="status" aria-live="polite"></p></section>';
    }
    function agendar() {
      clearTimeout(timer); timer = null;
      if (url && sync.ativo && sync.pendente && !bloqueado()) timer = setTimeout(enviar, 2000);
    }
    function alterado() {
      mudancas++;
      if (sync.ativo) {
        sync.rev++; sync.pendente = true;
        if (sync.erro === 'dados_grandes') sync.erro = '';
        persistir(); agendar();
      }
      atualizarUI();
    }
    async function pedir(payload) {
      controle = new AbortController();
      var abort = controle;
      var timeout = setTimeout(function () { abort.abort(); }, 15000);
      try {
        var response = await fetch(url, {method:'POST', body:JSON.stringify(payload), signal:abort.signal});
        if (!response.ok) throw new Error('rede');
        var result;
        try { result = await response.json(); } catch (e) { throw new Error('resposta_invalida'); }
        if (!objeto(result) || typeof result.ok !== 'boolean' ||
          (!result.ok && (typeof result.erro !== 'string' || !result.erro))) {
          throw new Error('resposta_invalida');
        }
        return result;
      } finally { clearTimeout(timeout); if (controle === abort) controle = null; }
    }
    function redeErro(e) { return e.message === 'resposta_invalida' ? e.message : 'rede'; }
    async function enviar() {
      clearTimeout(timer); timer = null;
      if (!url || !sync.ativo || !sync.pendente || ocupado || pausado || bloqueado()) return;
      if (!navigator.onLine) { sync.erro = 'rede'; persistir(); atualizarUI(); return; }
      ocupado = true; aviso = '';
      var ep = epoca, rev = sync.rev;
      atualizarUI();
      try {
        var r = await pedir({acao:'salvar', codigo:sync.codigo, senha:sync.senha, dados:op.obter(), rev:rev});
        if (ep !== epoca) return;
        if (r.ok) {
          var aceita = revOK(r.rev) ? r.rev : rev;
          sync.pendente = sync.rev !== rev;
          sync.rev = Math.max(sync.rev, aceita + (sync.pendente ? 1 : 0));
          sync.sincronizadoEm = Date.now(); sync.erro = ''; aviso = '';
        } else if (r.erro === 'versao_antiga' && revOK(r.rev)) {
          sync.conflitoRev = r.rev; sync.erro = ''; sync.pendente = true;
        } else {
          sync.erro = r.erro === 'versao_antiga' ? 'resposta_invalida' : r.erro;
        }
        persistir();
      } catch (e) {
        if (ep === epoca) { sync.erro = redeErro(e); persistir(); }
      } finally {
        ocupado = false; atualizarUI();
        // Alteracoes durante o envio exigem outro envio; falhas esperam online/30 s.
        if (ep === epoca && sync.pendente && !sync.erro && sync.conflitoRev == null) agendar();
      }
    }
    function credenciais() {
      var codigo = entrada.codigo.toUpperCase().trim(), senha = entrada.senha;
      if (!/^[A-Z0-9-]{4,20}$/.test(codigo)) throw new Error(ERROS.codigo_invalido);
      if (senha.length < 4) throw new Error(ERROS.senha_curta);
      return {codigo:codigo, senha:senha};
    }
    function desativar() {
      epoca++; clearTimeout(timer);
      if (controle) controle.abort();
      sync = {ativo:false, rev:0, pendente:false};
      entrada = {codigo:'', senha:''};
      persistir(); atualizarUI();
      ['backup-codigo','backup-senha'].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; });
    }
    async function ativar() {
      if (!url || ocupado || pausado) return;
      var c;
      try { c = credenciais(); } catch (e) { aviso = e.message; atualizarUI(); return; }
      ocupado = true; var seq = mudancas, ep = epoca;
      aviso = 'Ativando backup, aguarde.'; atualizarUI();
      try {
        var r = await pedir({acao:'criar', codigo:c.codigo, senha:c.senha, dados:op.obter()});
        if (ep !== epoca) return;
        if (!r.ok) { aviso = mensagemErro(r.erro); return; }
        var rev = revOK(r.rev) ? r.rev : 0;
        sync = {ativo:true, codigo:c.codigo, senha:c.senha, rev:rev + (mudancas - seq),
          pendente:mudancas !== seq, sincronizadoEm:Date.now(), erro:'', conflitoRev:null};
        aviso = 'Backup ativado para '+c.codigo+'.'; persistir(); agendar();
      } catch (e) { if (ep === epoca) aviso = 'Não foi possível ativar o backup. Confira a conexão. Os dados locais foram preservados.'; }
      finally { ocupado = false; atualizarUI(); }
    }

    // Confirmacao em dois toques somente depois de ler e validar os dados.
    function confirmarSubstituicao(dados, titulo, detalhe, aceitar, cancelar) {
      var dialog = document.createElement('dialog'), armed = false, t = null;
      dialog.className = 'importacao'; dialog.id = 'backup-confirmacao';
      dialog.setAttribute('aria-labelledby', 'backup-confirmacao-titulo');
      dialog.innerHTML = '<h2 id="backup-confirmacao-titulo">'+esc(titulo)+'</h2>'+
        '<p>'+esc(dados.cfg.nome || 'Prova sem nome')+': '+dados.list.length+' conjuntos.</p>'+
        '<p>'+esc(detalhe)+'</p><p>Os conjuntos e tempos locais serão substituídos. Exporte um arquivo JSON antes se precisar guardá-los.</p>'+
        '<div class="row"><button class="sm" id="backup-cancelar">Cancelar</button>'+
        '<button class="sm" id="backup-substituir">Substituir os dados locais</button></div>'+
        '<p id="backup-confirmacao-erro" role="alert"></p>';
      document.body.appendChild(dialog); dialog.showModal();
      var button = dialog.querySelector('#backup-substituir');
      function close() { clearTimeout(t); dialog.close(); dialog.remove(); }
      function cancel() { close(); cancelar(); }
      dialog.addEventListener('cancel', function (e) { e.preventDefault(); cancel(); });
      dialog.querySelector('#backup-cancelar').onclick = cancel;
      button.onclick = function () {
        if (!armed) {
          armed = true; button.classList.add('conf'); button.textContent = 'Toque de novo para substituir';
          t = setTimeout(function () { armed = false; button.classList.remove('conf'); button.textContent = 'Substituir os dados locais'; }, 4000);
          return;
        }
        try { aceitar(); close(); }
        catch (e) { dialog.querySelector('#backup-confirmacao-erro').textContent = 'Não foi possível salvar a restauração no aparelho. Os dados anteriores foram preservados.'; }
      };
    }
    async function carregar(nuvem) {
      if (!url || ocupado || pausado) return;
      var c;
      try { c = nuvem ? {codigo:sync.codigo, senha:sync.senha} : credenciais(); }
      catch (e) { aviso = e.message; atualizarUI(); return; }
      pausado = true; ocupado = true; clearTimeout(timer);
      var ep = epoca, modal = false;
      aviso = 'Consultando a versão da nuvem, aguarde.'; atualizarUI();
      try {
        var r = await pedir({acao:'carregar', codigo:c.codigo, senha:c.senha});
        if (ep !== epoca) return;
        if (!r.ok) { aviso = mensagemErro(r.erro); return; }
        if (!revOK(r.rev)) throw new Error('Revisão do backup inválida.');
        var dados = validar(r.dados);
        modal = true;
        confirmarSubstituicao(dados, 'Restaurar da nuvem',
          'Código '+c.codigo+', revisão '+r.rev+'. Confirme em dois toques.',
          function () {
            // Evita religar uma prova restaurada a credenciais antigas se a
            // gravacao seguinte falhar ou a pagina for encerrada.
            localStorage.removeItem(KEY);
            op.aplicar(dados);
            epoca++;
            sync = {ativo:true, codigo:c.codigo, senha:c.senha, rev:r.rev, pendente:false,
              sincronizadoEm:Date.now(), erro:'', conflitoRev:null};
            entrada = {codigo:c.codigo, senha:c.senha};
            aviso = 'Prova restaurada da nuvem.'; pausado = false; persistir();
            op.renderizar(); atualizarUI();
          },
          function () { pausado = false; aviso = 'Restauração cancelada. Dados locais preservados.'; agendar(); atualizarUI(); });
      } catch (e) {
        if (ep === epoca) aviso = e.message.startsWith('Backup inválido') || e.message.startsWith('Revisão') ?
          e.message : 'Não foi possível carregar a prova. Confira a conexão. Os dados locais foram preservados.';
      } finally {
        ocupado = false;
        if (!modal) { pausado = false; agendar(); }
        atualizarUI();
      }
    }
    function manter() {
      if (ocupado || pausado || sync.conflitoRev == null) return;
      sync.rev = sync.conflitoRev + 1; sync.conflitoRev = null;
      sync.erro = ''; sync.pendente = true; aviso = '';
      persistir(); atualizarUI(); enviar();
    }
    function corrigirSenha() {
      if (ocupado || pausado) return;
      try {
        var c = credenciais();
        if (c.codigo !== sync.codigo) throw new Error('Para outro código, use Restaurar de outro aparelho ou ative uma nova prova.');
        sync.senha = c.senha; sync.erro = ''; sync.pendente = true;
        persistir(); aviso = ''; atualizarUI(); enviar();
      } catch (e) { aviso = e.message; atualizarUI(); }
    }
    function exportar() {
      var dados = op.obter(), d = new Date(), pad = function (n) { return String(n).padStart(2,'0'); };
      var data = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'-'+pad(d.getHours())+pad(d.getMinutes())+pad(d.getSeconds());
      var nome = (dados.cfg.nome || 'prova').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80) || 'prova';
      var blob = new Blob([JSON.stringify({app:'TIMED', formato:1, versaoApp:op.versao,
        exportadoEm:d.toISOString(), dados:dados}, null, 2)], {type:'application/json;charset=utf-8'});
      var href = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = href; a.download = 'TIMED-'+nome+'-'+data+'.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(href); }, 60000);
      avisoArquivo = 'Arquivo de backup exportado, sem código ou senha do backup online.'; atualizarUI();
    }
    async function importar(file) {
      if (!file || pausado || lendoArquivo || document.querySelector('#backup-confirmacao')) return;
      lendoArquivo = true;
      var dados;
      try {
        if (file.size > 20 * 1024 * 1024) throw new Error('O arquivo de backup é muito grande (limite de 20 MB).');
        var raw;
        try { raw = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); }
        catch (e) { throw new Error('O arquivo não contém um JSON válido. Nenhum dado foi alterado.'); }
        dados = validar(raw);
      } catch (e) { avisoArquivo = e.message; atualizarUI(); return; }
      finally { lendoArquivo = false; }
      if (pausado || document.querySelector('#backup-confirmacao')) return;
      pausado = true; clearTimeout(timer); atualizarUI();
      confirmarSubstituicao(dados, 'Importar arquivo de backup',
        'O backup online será desativado neste aparelho para não sobrescrever outra prova. Confirme em dois toques.',
        function () {
          localStorage.removeItem(KEY);
          op.aplicar(dados);
          desativar(); pausado = false;
          avisoArquivo = 'Arquivo restaurado. Backup online desativado neste aparelho.';
          op.renderizar(); atualizarUI();
        },
        function () { pausado = false; avisoArquivo = 'Importação cancelada. Dados locais preservados.'; agendar(); atualizarUI(); });
    }
    document.addEventListener('input', function (e) {
      if (e.target.id === 'backup-codigo') {
        entrada.codigo = e.target.value.toUpperCase(); e.target.value = entrada.codigo;
      }
      if (e.target.id === 'backup-senha') entrada.senha = e.target.value;
    });
    document.addEventListener('change', function (e) {
      if (e.target.id === 'backup-json') { var f = e.target.files[0]; e.target.value = ''; importar(f); }
    });
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-backup]');
      if (!b || b.disabled) return;
      switch (b.dataset.backup) {
      case 'criar': ativar(); break;
      case 'carregar': carregar(false); break;
      case 'nuvem': carregar(true); break;
      case 'manter': manter(); break;
      case 'senha': corrigirSenha(); break;
      case 'desativar': desativar(); aviso = 'Backup desativado neste aparelho. A cópia da nuvem não foi apagada.'; atualizarUI(); break;
      case 'exportar': exportar(); break;
      case 'importar': document.querySelector('#backup-json').click(); break;
      }
    });
    window.addEventListener('online', enviar);
    setInterval(function () { if (!timer) enviar(); }, 30000);
    agendar();
    return {alterado:alterado, onlineHTML:onlineHTML, arquivoHTML:arquivoHTML, atualizarUI:atualizarUI};
  }
  window.TIMEDBackup = {criar:criar, validar:validar};
})();
