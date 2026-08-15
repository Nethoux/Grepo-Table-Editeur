// ==UserScript==
// @name         Grepolis - Editeur de tableaux BBCode
// @version      1.0
// @description  Edite et lit les tableaux [table] de Grepolis dans une grille type tableur
// @author       Azert
// @match        https://*.grepolis.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* =========================================================================
   *  Garde anti double-chargement (utile si on colle le script dans la console
   *  alors que Tampermonkey l'a deja injecte)
   * ====================================================================== */
  if (window.__GrepoBBTable) {
    window.__GrepoBBTable.toast('Editeur deja actif (Alt+T)');
    return;
  }

  const DEFAULT_ROWS = 5;
  const DEFAULT_COLS = 6;

  /* Grepolis attend des codes hexadecimaux : [color=#FF0000]texte[/color] */
  const SWATCHES = [
    ['#FF0000', 'Rouge'], ['#C00000', 'Rouge fonce'], ['#FF8000', 'Orange'],
    ['#FFD700', 'Or'], ['#00FF00', 'Vert clair'], ['#008000', 'Vert'],
    ['#00BFFF', 'Bleu ciel'], ['#0000FF', 'Bleu'], ['#800080', 'Violet'],
    ['#8B4513', 'Marron'], ['#808080', 'Gris'], ['#000000', 'Noir']
  ];
  const LIGHT_NAMES = new Set(['yellow', 'white', 'lime', 'aqua', 'cyan', 'gold', 'ivory', 'beige']);

  /* =========================================================================
   *  1. Utilitaires generiques
   * ====================================================================== */

  const escapeHtml = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const escapeAttr = (s) => escapeHtml(s).replace(/"/g, '&quot;');

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
  }

  /* =========================================================================
   *  2. Parseur / serialiseur BBCode
   *
   *  Format Grepolis :
   *    [table]
   *    [**]entete[|]entete[/**]      <- ligne d'entete (optionnelle)
   *    [*]cellule[|]cellule[/*]      <- ligne normale
   *    [/table]
   * ====================================================================== */

  function normalizeGrid(grid) {
    if (!grid.length) grid = [['']];
    const cols = Math.max(1, ...grid.map((r) => r.length));
    return grid.map((r) => {
      const row = r.slice(0, cols);
      while (row.length < cols) row.push('');
      return row.map((c) => (c == null ? '' : String(c)));
    });
  }

  function parseBBTable(src) {
    const m = /\[table\]([\s\S]*?)\[\/table\]/i.exec(src);
    const inner = m ? m[1] : src;
    const grid = [];
    let header = false;

    // Cas standard : lignes bien fermees [*]...[/*] ou [**]...[/**]
    const re = /\[(\*\*|\*)\]([\s\S]*?)\[\/\1\]/g;
    let mm;
    while ((mm = re.exec(inner)) !== null) {
      if (mm[1] === '**' && grid.length === 0) header = true;
      grid.push(mm[2].split('[|]').map((c) => c.trim()));
    }

    // Repli : lignes non fermees, une par ligne de texte
    if (!grid.length) {
      inner.split(/\r?\n/).forEach((line) => {
        const t = line.trim();
        if (!t) return;
        if (t.startsWith('[**]') && grid.length === 0) header = true;
        const clean = t.replace(/^\[\*\*?\]/, '').replace(/\[\/\*\*?\]$/, '');
        grid.push(clean.split('[|]').map((c) => c.trim()));
      });
    }

    return { grid: normalizeGrid(grid), header };
  }

  function serializeBBTable(grid, header) {
    const lines = ['[table]'];
    grid.forEach((row, i) => {
      const tag = header && i === 0 ? '**' : '*';
      lines.push('[' + tag + ']' + row.join('[|]') + '[/' + tag + ']');
    });
    lines.push('[/table]');
    return lines.join('\n');
  }

  function gridToTsv(grid) {
    return grid.map((r) => r.join('\t')).join('\n');
  }

  function tsvToGrid(text) {
    const rows = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
    return normalizeGrid(rows.map((r) => r.split('\t')));
  }

  /* Rendu approximatif du BBCode pour l'apercu */
  function bbToHtml(s) {
    return escapeHtml(s)
      .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<b>$1</b>')
      .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<i>$1</i>')
      .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>')
      .replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<s>$1</s>')
      .replace(/\[color=([#\w]+)\]([\s\S]*?)\[\/color\]/gi, '<span style="color:$1">$2</span>')
      .replace(/\[size=(\d+)\]([\s\S]*?)\[\/size\]/gi, '<span style="font-size:$1px">$2</span>')
      .replace(/\[town\]([\s\S]*?)\[\/town\]/gi, '<span class="bbtag t-town">&#127963; $1</span>')
      .replace(/\[player\]([\s\S]*?)\[\/player\]/gi, '<span class="bbtag t-player">&#128100; $1</span>')
      .replace(/\[ally\]([\s\S]*?)\[\/ally\]/gi, '<span class="bbtag t-ally">&#128737; $1</span>')
      .replace(/\[island\]([\s\S]*?)\[\/island\]/gi, '<span class="bbtag t-island">&#127965; $1</span>')
      .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, '<a href="$1" target="_blank" rel="noopener">$2</a>')
      .replace(/\[img\]([\s\S]*?)\[\/img\]/gi, '<img src="$1" style="max-height:22px;vertical-align:middle">');
  }

  /* =========================================================================
   *  3. Acces au textarea cible
   * ====================================================================== */

  function isUsableTextarea(el) {
    if (!el || el.tagName !== 'TEXTAREA') return false;
    if (el.disabled || el.readOnly) return false;
    if (el.closest && el.closest('#grepo-bbtable-host')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 80 && r.height > 24;
  }

  function setTextareaValue(ta, value, selStart, selEnd) {
    const desc = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(ta), 'value');
    if (desc && desc.set) desc.set.call(ta, value);
    else ta.value = value;

    try { ta.focus(); ta.setSelectionRange(selStart, selEnd); } catch (e) { /* ignore */ }

    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    const jq = window.jQuery || window.$;
    if (jq && jq.fn) {
      try { jq(ta).trigger('input').trigger('change'); } catch (e) { /* ignore */ }
    }
  }

  /* Retourne tous les blocs [table]...[/table] du texte */
  function findTableBlocks(text) {
    const re = /\[table\][\s\S]*?\[\/table\]/gi;
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    }
    return out;
  }

  /* Bloc a editer : celui sous le curseur, sinon dans la selection, sinon
     l'unique bloc du texte, sinon null (= nouveau tableau) */
  function pickBlock(ta) {
    const blocks = findTableBlocks(ta.value);
    if (!blocks.length) return null;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const at = blocks.find((b) => s >= b.start && s <= b.end);
    if (at) return at;
    const inSel = blocks.find((b) => b.start >= s && b.end <= e);
    if (inSel) return inSel;
    if (blocks.length === 1) return blocks[0];
    return blocks[0];
  }

  /* =========================================================================
   *  4. Styles de l'editeur (dans un shadow DOM, isole du CSS Grepolis)
   * ====================================================================== */

  const CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; font-family: "Segoe UI", Tahoma, sans-serif; }

.overlay {
  position: fixed; inset: 0; z-index: 2147483647;
  background: rgba(0,0,0,.55);
  display: flex; align-items: center; justify-content: center;
}
.modal {
  width: min(1280px, 96vw); height: min(860px, 94vh);
  background: #f3e7cd; color: #2c1d0c;
  border: 2px solid #6b4f2a; border-radius: 10px;
  box-shadow: 0 14px 46px rgba(0,0,0,.6);
  display: flex; flex-direction: column; overflow: hidden;
}
.head {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; background: linear-gradient(#8a6a3c, #6b4f2a);
  color: #ffeec8; font-weight: 700; font-size: 15px; flex: none;
}
.head .dims { font-weight: 400; font-size: 12px; opacity: .85; }
.head .spacer { flex: 1; }
.head .x {
  background: none; border: 0; color: #ffeec8; font-size: 20px;
  cursor: pointer; line-height: 1; padding: 0 4px;
}
.head .x:hover { color: #fff; }

.bar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
  padding: 6px 10px; background: #e3d3ae; border-bottom: 1px solid #b79a66; flex: none;
}
.bar .sep { width: 1px; height: 20px; background: #b79a66; margin: 0 5px; }
.bar label { font-size: 12px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }

/* --- selecteur de couleur --- */
.cw { position: relative; display: inline-block; }
.pop {
  display: none; position: absolute; top: calc(100% + 4px); left: 0; z-index: 20;
  background: #f8f1e0; border: 1px solid #6b4f2a; border-radius: 6px;
  padding: 8px; box-shadow: 0 6px 18px rgba(0,0,0,.35); width: 224px;
}
.pop.show { display: block; }
.pop .sws { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; margin-bottom: 8px; }
.pop .sw {
  height: 24px; border: 1px solid #6b4f2a; border-radius: 3px; cursor: pointer; padding: 0;
}
.pop .sw:hover { outline: 2px solid #2c1d0c; }
.pop .row { display: flex; align-items: center; gap: 5px; }
.pop .row input[type=color] {
  width: 34px; height: 26px; padding: 0; border: 1px solid #6b4f2a;
  border-radius: 3px; background: none; cursor: pointer;
}
.pop .tip { font-size: 10px; opacity: .7; margin-top: 6px; line-height: 1.4; }

button.b {
  border: 1px solid #8a6a3c; background: #f8f1e0; color: #2c1d0c;
  border-radius: 4px; padding: 4px 9px; font-size: 12px; cursor: pointer;
}
button.b:hover { background: #fff9ea; border-color: #6b4f2a; }
button.b:active { background: #e3d3ae; }
button.b.pri { background: #4a7c3f; border-color: #2f5628; color: #fff; font-weight: 600; }
button.b.pri:hover { background: #58913b; }
button.b.dan { background: #a34a3a; border-color: #7a3125; color: #fff; }
button.b.dan:hover { background: #bb5745; }
button.b.on { background: #8a6a3c; color: #ffeec8; }

.body { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.gridwrap { flex: 1; overflow: auto; padding: 10px; min-height: 120px; }

table.grid { border-collapse: separate; border-spacing: 0; }
table.grid th, table.grid td { padding: 0; border: 1px solid #b79a66; }
table.grid th { background: #e3d3ae; position: sticky; top: 0; z-index: 2; }
table.grid th.rowh { position: sticky; left: 0; z-index: 1; top: auto; }
table.grid th.corner { position: sticky; left: 0; top: 0; z-index: 3; }

.hdr { display: flex; align-items: center; gap: 2px; padding: 2px 4px; white-space: nowrap; }
.hdr .lbl { font-size: 11px; font-weight: 700; min-width: 16px; text-align: center; opacity: .8; }
.hdr .ops { display: flex; gap: 1px; opacity: 0; transition: opacity .12s; }
th:hover .hdr .ops { opacity: 1; }
.hdr .ops button {
  border: 0; background: #cbb789; color: #2c1d0c; cursor: pointer;
  font-size: 11px; line-height: 1; padding: 2px 3px; border-radius: 3px;
}
.hdr .ops button:hover { background: #8a6a3c; color: #fff; }
th.rowh .hdr { flex-direction: row; }

table.grid input.cell {
  border: 0; outline: 0; background: #fffdf6; color: #2c1d0c;
  font-size: 13px; padding: 4px 6px; width: 100%; min-width: 110px;
  font-family: Consolas, "Courier New", monospace;
}
table.grid input.cell:focus { background: #fff6d5; box-shadow: inset 0 0 0 2px #4a7c3f; }
tr.hrow input.cell { background: #efe3c4; font-weight: 700; }
tr.hrow input.cell:focus { background: #fff6d5; }

.panes { flex: none; border-top: 1px solid #b79a66; background: #ece0c4; }
.pane { display: none; padding: 8px 10px; max-height: 34vh; overflow: auto; }
.pane.show { display: block; }
.pane h4 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; opacity: .7; }
.pane textarea {
  width: 100%; height: 150px; font-family: Consolas, "Courier New", monospace;
  font-size: 12px; border: 1px solid #b79a66; border-radius: 4px; padding: 6px;
  background: #fffdf6; color: #2c1d0c; resize: vertical;
}
table.prev { border-collapse: collapse; background: #fffdf6; font-size: 13px; }
table.prev th, table.prev td { border: 1px solid #b79a66; padding: 4px 8px; }
table.prev th { background: #e3d3ae; }
.bbtag { padding: 1px 5px; border-radius: 3px; font-size: 12px; }
.t-town { background: #d8e8c8; } .t-player { background: #cfe0f2; }
.t-ally { background: #f2dfc8; } .t-island { background: #e6dcf2; }

.foot {
  display: flex; align-items: center; gap: 6px; flex: none;
  padding: 8px 12px; background: #e3d3ae; border-top: 1px solid #b79a66;
}
.foot .hint { flex: 1; font-size: 11px; opacity: .75; }

.toast {
  position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%);
  background: #2c1d0c; color: #ffeec8; padding: 8px 16px; border-radius: 6px;
  font-size: 13px; z-index: 2147483647; box-shadow: 0 4px 14px rgba(0,0,0,.4);
  pointer-events: none; opacity: 0; transition: opacity .2s;
}
.toast.show { opacity: 1; }

.chip {
  position: fixed; z-index: 2147483646;
  background: linear-gradient(#8a6a3c, #6b4f2a); color: #ffeec8;
  border: 1px solid #4a3418; border-radius: 4px;
  font: 600 11px "Segoe UI", sans-serif; padding: 3px 8px; cursor: pointer;
  box-shadow: 0 2px 6px rgba(0,0,0,.35); display: none; white-space: nowrap;
}
.chip:hover { background: linear-gradient(#a07e4a, #7d5d33); }
`;

  /* =========================================================================
   *  5. Hote shadow DOM + toast + pastille flottante
   * ====================================================================== */

  const host = document.createElement('div');
  host.id = 'grepo-bbtable-host';
  host.style.cssText = 'all:initial;position:static;';
  const root = host.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  root.appendChild(styleEl);
  (document.body || document.documentElement).appendChild(host);

  const toastEl = document.createElement('div');
  toastEl.className = 'toast';
  root.appendChild(toastEl);
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  const chip = document.createElement('button');
  chip.className = 'chip';
  chip.type = 'button';
  chip.textContent = 'Tableau BBCode';
  chip.title = 'Ouvrir l\'editeur de tableau (Alt+T)';
  root.appendChild(chip);

  let currentTA = null;

  function placeChip() {
    if (!currentTA || !document.contains(currentTA)) { chip.style.display = 'none'; return; }
    const r = currentTA.getBoundingClientRect();
    if (r.width < 60 || r.bottom < 0 || r.top > innerHeight) { chip.style.display = 'none'; return; }
    chip.style.display = 'block';
    const w = chip.offsetWidth || 110;
    chip.style.left = Math.max(4, r.right - w - 6) + 'px';
    chip.style.top = Math.max(4, r.top - 22) + 'px';
  }

  document.addEventListener('focusin', (e) => {
    if (isUsableTextarea(e.target)) { currentTA = e.target; placeChip(); }
  }, true);

  document.addEventListener('mouseover', (e) => {
    if (isUsableTextarea(e.target) && e.target !== currentTA && !editorOpen()) {
      currentTA = e.target; placeChip();
    }
  }, true);

  addEventListener('scroll', placeChip, true);
  addEventListener('resize', placeChip);
  setInterval(() => { if (chip.style.display === 'block' || currentTA) placeChip(); }, 400);

  // mousedown neutralise pour ne pas perdre le focus/selection du textarea
  chip.addEventListener('mousedown', (e) => e.preventDefault());
  chip.addEventListener('click', () => openEditor(currentTA));

  // Alt+T : Ctrl+Maj+T est reserve par le navigateur (rouvrir l'onglet ferme).
  // e.code plutot que e.key : independant de la disposition clavier.
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && (e.code === 'KeyT' || e.key === 't' || e.key === 'T')) {
      const ta = isUsableTextarea(document.activeElement) ? document.activeElement : currentTA;
      if (ta) { e.preventDefault(); e.stopPropagation(); openEditor(ta); }
    }
  }, true);

  /* =========================================================================
   *  6. Editeur
   * ====================================================================== */

  let overlay = null;
  let state = null;   // { grid, header, ta, block, active:{r,c}, history:[] }

  const editorOpen = () => !!overlay;

  function openEditor(ta) {
    if (overlay) return;
    if (!ta || !document.contains(ta)) { toast('Clique d\'abord dans une zone de texte'); return; }

    const block = pickBlock(ta);
    let grid, header;
    if (block) {
      const p = parseBBTable(block.text);
      grid = p.grid; header = p.header;
    } else {
      grid = Array.from({ length: DEFAULT_ROWS }, () => Array(DEFAULT_COLS).fill(''));
      header = true;
      for (let c = 0; c < DEFAULT_COLS; c++) grid[0][c] = String(c + 1);
    }

    state = { grid, header, ta, block, active: { r: 0, c: 0 }, history: [], dirty: false };
    buildUI();
    render();
    focusCell(0, 0);
  }

  function closeEditor(force) {
    if (!overlay) return;
    if (!force && state && state.dirty &&
        !confirm('Fermer sans inserer les modifications ?')) return;
    overlay.remove();
    overlay = null;
    state = null;
    if (currentTA && document.contains(currentTA)) { try { currentTA.focus(); } catch (e) { /* ignore */ } }
  }

  function buildUI() {
    overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
<div class="modal">
  <div class="head">
    <span>Editeur de tableau BBCode</span>
    <span class="dims" id="dims"></span>
    <span class="spacer"></span>
    <button class="x" data-act="cancel" title="Fermer (Echap)">&times;</button>
  </div>

  <div class="bar">
    <button class="b" data-act="add-row" title="Ajouter une ligne en bas">+ Ligne</button>
    <button class="b" data-act="add-col" title="Ajouter une colonne a droite">+ Colonne</button>
    <span class="sep"></span>
    <label><input type="checkbox" id="chk-header"> Ligne d'en-tete [**]</label>
    <span class="sep"></span>
    <button class="b" data-act="tag" data-open="[town]" data-close="[/town]" title="Ville">Ville</button>
    <button class="b" data-act="tag" data-open="[player]" data-close="[/player]" title="Joueur">Joueur</button>
    <button class="b" data-act="tag" data-open="[ally]" data-close="[/ally]" title="Alliance">Alliance</button>
    <button class="b" data-act="tag" data-open="[b]" data-close="[/b]"><b>G</b></button>
    <button class="b" data-act="tag" data-open="[i]" data-close="[/i]"><i>I</i></button>
    <span class="cw">
      <button class="b" data-act="color-menu" id="btn-color">Couleur &#9662;</button>
      <div class="pop" id="cpop">
        <div class="sws">${SWATCHES.map((s) =>
          '<button type="button" class="sw" data-act="color-set" data-hex="' + s[0] +
          '" title="' + s[1] + ' ' + s[0] + '" style="background:' + s[0] + '"></button>').join('')}</div>
        <div class="row">
          <input type="color" id="cpick" value="#FF0000" title="Couleur personnalisee">
          <button class="b" data-act="color-custom">Appliquer</button>
          <button class="b" data-act="color-clear">Enlever</button>
        </div>
        <div class="tip">Texte selectionne : seule la selection est coloree.<br>Rien de selectionne : toute la cellule.</div>
      </div>
    </span>
    <span class="sep"></span>
    <button class="b" data-act="undo" title="Annuler (Ctrl+Z)">Annuler</button>
    <button class="b" data-act="transpose" title="Inverser lignes et colonnes">Transposer</button>
    <button class="b" data-act="clean" title="Supprimer lignes et colonnes vides en fin de tableau">Nettoyer</button>
    <span class="sep"></span>
    <button class="b" data-act="copy-bb" title="Copier le BBCode">Copier BBCode</button>
    <button class="b" data-act="copy-tsv" title="Copier pour Excel">Copier Excel</button>
    <span class="sep"></span>
    <button class="b" data-act="pane-preview" id="tab-preview">Apercu</button>
    <button class="b" data-act="pane-source" id="tab-source">Source</button>
  </div>

  <div class="body">
    <div class="gridwrap" id="gridwrap"></div>
    <div class="panes">
      <div class="pane" id="pane-preview"><h4>Apercu</h4><div id="preview"></div></div>
      <div class="pane" id="pane-source">
        <h4>Source (BBCode ou colle depuis Excel) </h4>
        <textarea id="src" spellcheck="false"></textarea>
        <div style="margin-top:6px"><button class="b" data-act="apply-src">Charger dans la grille</button></div>
      </div>
    </div>
  </div>

  <div class="foot">
    <span class="hint">Tab / Entree : cellule suivante &nbsp;|&nbsp; Fleches : navigation &nbsp;|&nbsp; Ctrl+Entree : inserer &nbsp;|&nbsp; Echap : fermer &nbsp;|&nbsp; colle direct depuis Excel</span>
    <button class="b" data-act="cancel">Annuler</button>
    <button class="b pri" data-act="save">Inserer dans le message (Ctrl+Entree)</button>
  </div>
</div>`;
    root.appendChild(overlay);

    const chk = overlay.querySelector('#chk-header');
    chk.checked = state.header;
    chk.addEventListener('change', () => {
      pushHistory();
      state.header = chk.checked;
      state.dirty = true;
      render();
    });

    // Les boutons de la barre ne doivent pas voler le focus : la selection de
    // texte dans la cellule active doit survivre au clic (balises, couleurs).
    overlay.querySelector('.bar').addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) e.preventDefault();
    });

    overlay.addEventListener('click', onToolbarClick);
    overlay.addEventListener('keydown', onKeyDown, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeEditor(false); });

    // Le shadow DOM masque l'element focalise : sans cela Grepolis croit qu'aucun
    // champ n'est actif et declenche ses raccourcis clavier pendant la saisie.
    // La molette est bloquee de meme pour ne pas zoomer la carte du jeu.
    ['keydown', 'keypress', 'keyup', 'wheel'].forEach((t) => {
      overlay.addEventListener(t, (e) => e.stopPropagation());
    });

    const wrap = overlay.querySelector('#gridwrap');
    wrap.addEventListener('click', onGridClick);
    wrap.addEventListener('input', onCellInput);
    wrap.addEventListener('paste', onCellPaste, true);
    wrap.addEventListener('focusin', (e) => {
      if (e.target.classList.contains('cell')) {
        state.active = { r: +e.target.dataset.r, c: +e.target.dataset.c };
      }
    });
  }

  /* ------------------------------- rendu -------------------------------- */

  function render() {
    const g = state.grid;
    const rows = g.length, cols = g[0].length;

    let h = '<table class="grid"><thead><tr><th class="corner"><div class="hdr"><span class="lbl">#</span></div></th>';
    for (let c = 0; c < cols; c++) {
      h += '<th class="colh"><div class="hdr"><span class="lbl">' + (c + 1) + '</span><span class="ops">'
        + opBtn('&#9664;', 'col-left', c, 'Deplacer a gauche')
        + opBtn('&#43;', 'col-add', c, 'Inserer une colonne a droite')
        + opBtn('&times;', 'col-del', c, 'Supprimer la colonne')
        + opBtn('&#9654;', 'col-right', c, 'Deplacer a droite')
        + '</span></div></th>';
    }
    h += '</tr></thead><tbody>';

    for (let r = 0; r < rows; r++) {
      const isH = state.header && r === 0;
      h += '<tr' + (isH ? ' class="hrow"' : '') + '>';
      h += '<th class="rowh"><div class="hdr"><span class="lbl">' + (isH ? 'H' : r + 1) + '</span><span class="ops">'
        + opBtn('&#9650;', 'row-up', r, 'Monter')
        + opBtn('&#43;', 'row-add', r, 'Inserer une ligne dessous')
        + opBtn('&times;', 'row-del', r, 'Supprimer la ligne')
        + opBtn('&#9660;', 'row-down', r, 'Descendre')
        + '</span></div></th>';
      for (let c = 0; c < cols; c++) {
        h += '<td><input class="cell" type="text" spellcheck="false" data-r="' + r + '" data-c="' + c
          + '" value="' + escapeAttr(g[r][c]) + '"></td>';
      }
      h += '</tr>';
    }
    h += '</tbody></table>';

    overlay.querySelector('#gridwrap').innerHTML = h;
    overlay.querySelector('#dims').textContent = rows + ' lignes x ' + cols + ' colonnes';
    overlay.querySelector('#chk-header').checked = state.header;
    paintAll();
    refreshPanes();
  }

  function opBtn(label, act, i, title) {
    return '<button type="button" tabindex="-1" data-act="' + act + '" data-i="' + i
      + '" title="' + title + '">' + label + '</button>';
  }

  function refreshPanes() {
    const pv = overlay.querySelector('#pane-preview');
    if (pv.classList.contains('show')) {
      let h = '<table class="prev">';
      state.grid.forEach((row, r) => {
        const t = state.header && r === 0 ? 'th' : 'td';
        h += '<tr>' + row.map((c) => '<' + t + '>' + (bbToHtml(c) || '&nbsp;') + '</' + t + '>').join('') + '</tr>';
      });
      overlay.querySelector('#preview').innerHTML = h + '</table>';
    }
    const sp = overlay.querySelector('#pane-source');
    if (sp.classList.contains('show')) {
      overlay.querySelector('#src').value = serializeBBTable(state.grid, state.header);
    }
  }

  function focusCell(r, c) {
    const el = overlay.querySelector('input.cell[data-r="' + r + '"][data-c="' + c + '"]');
    if (el) {
      el.focus();
      const n = el.value.length;
      try { el.setSelectionRange(n, n); } catch (e) { /* ignore */ }
      state.active = { r, c };
    }
  }

  /* ----------------------------- historique ----------------------------- */

  function pushHistory() {
    state.history.push(JSON.stringify({ g: state.grid, h: state.header }));
    if (state.history.length > 60) state.history.shift();
  }

  function undo() {
    const s = state.history.pop();
    if (!s) { toast('Rien a annuler'); return; }
    const o = JSON.parse(s);
    state.grid = o.g;
    state.header = o.h;
    render();
    toast('Annule');
  }

  let typingTimer = null;
  function pushHistoryDebounced() {
    if (typingTimer) return;
    pushHistory();
    typingTimer = setTimeout(() => { typingTimer = null; }, 800);
  }

  /* ------------------------- evenements cellules ------------------------ */

  function onCellInput(e) {
    if (!e.target.classList.contains('cell')) return;
    pushHistoryDebounced();
    state.grid[+e.target.dataset.r][+e.target.dataset.c] = e.target.value;
    state.dirty = true;
    paintCell(e.target);
    refreshPanes();
  }

  function onCellPaste(e) {
    const el = e.target;
    if (!el.classList || !el.classList.contains('cell')) return;
    const txt = (e.clipboardData || window.clipboardData).getData('text');
    if (!txt || !/[\t\n]/.test(txt)) return;   // collage simple : comportement natif

    e.preventDefault();
    pushHistory();

    const r0 = +el.dataset.r, c0 = +el.dataset.c;
    const block = tsvToGrid(txt);

    const needRows = r0 + block.length;
    const needCols = c0 + block[0].length;
    while (state.grid.length < needRows) state.grid.push(Array(state.grid[0].length).fill(''));
    if (state.grid[0].length < needCols) {
      const add = needCols - state.grid[0].length;
      state.grid.forEach((row) => { for (let i = 0; i < add; i++) row.push(''); });
    }
    block.forEach((row, i) => row.forEach((v, j) => { state.grid[r0 + i][c0 + j] = v; }));

    state.dirty = true;
    render();
    focusCell(r0, c0);
    toast('Colle : ' + block.length + ' x ' + block[0].length);
  }

  function onKeyDown(e) {
    const el = e.target;
    const isCell = el.classList && el.classList.contains('cell');

    if (e.key === 'Escape') { e.preventDefault(); closeEditor(false); return; }
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); save(); return; }
    // Dans le champ Source, Ctrl+Z reste l'annulation native du textarea
    if (e.ctrlKey && (e.key === 'z' || e.key === 'Z') && el.id !== 'src') {
      e.preventDefault(); undo(); return;
    }
    if (!isCell) return;

    const r = +el.dataset.r, c = +el.dataset.c;
    const rows = state.grid.length, cols = state.grid[0].length;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;

    const go = (nr, nc) => {
      e.preventDefault();
      focusCell(Math.max(0, Math.min(rows - 1, nr)), Math.max(0, Math.min(cols - 1, nc)));
    };

    switch (e.key) {
      case 'Tab':
        e.preventDefault();
        if (e.shiftKey) {
          if (c > 0) focusCell(r, c - 1);
          else if (r > 0) focusCell(r - 1, cols - 1);
        } else if (c < cols - 1) focusCell(r, c + 1);
        else if (r < rows - 1) focusCell(r + 1, 0);
        else { addRow(rows - 1); focusCell(rows, 0); }
        break;
      case 'Enter':
        if (e.shiftKey) go(r - 1, c);
        else if (r < rows - 1) go(r + 1, c);
        else { e.preventDefault(); addRow(rows - 1); focusCell(rows, c); }
        break;
      case 'ArrowUp': go(r - 1, c); break;
      case 'ArrowDown': go(r + 1, c); break;
      case 'ArrowLeft': if (atStart) go(r, c - 1); break;
      case 'ArrowRight': if (atEnd) go(r, c + 1); break;
      default: break;
    }
  }

  /* -------------------------- operations grille ------------------------- */

  function addRow(after) {
    pushHistory();
    state.grid.splice(after + 1, 0, Array(state.grid[0].length).fill(''));
    state.dirty = true;
    render();
  }

  function addCol(after) {
    pushHistory();
    state.grid.forEach((row) => row.splice(after + 1, 0, ''));
    state.dirty = true;
    render();
  }

  function delRow(i) {
    if (state.grid.length <= 1) { toast('Il faut au moins une ligne'); return; }
    pushHistory();
    state.grid.splice(i, 1);
    state.dirty = true;
    render();
  }

  function delCol(i) {
    if (state.grid[0].length <= 1) { toast('Il faut au moins une colonne'); return; }
    pushHistory();
    state.grid.forEach((row) => row.splice(i, 1));
    state.dirty = true;
    render();
  }

  function moveRow(i, d) {
    const j = i + d;
    if (j < 0 || j >= state.grid.length) return;
    pushHistory();
    const [row] = state.grid.splice(i, 1);
    state.grid.splice(j, 0, row);
    state.dirty = true;
    render();
    focusCell(j, state.active.c);
  }

  function moveCol(i, d) {
    const j = i + d;
    if (j < 0 || j >= state.grid[0].length) return;
    pushHistory();
    state.grid.forEach((row) => { const [v] = row.splice(i, 1); row.splice(j, 0, v); });
    state.dirty = true;
    render();
    focusCell(state.active.r, j);
  }

  function transpose() {
    pushHistory();
    const g = state.grid;
    state.grid = g[0].map((_, c) => g.map((row) => row[c]));
    state.dirty = true;
    render();
  }

  function clean() {
    pushHistory();
    let g = state.grid.map((row) => row.map((c) => c.trim()));
    while (g.length > 1 && g[g.length - 1].every((c) => c === '')) g.pop();
    while (g[0].length > 1 && g.every((row) => row[row.length - 1] === '')) g.forEach((row) => row.pop());
    state.grid = normalizeGrid(g);
    state.dirty = true;
    render();
    toast('Nettoye');
  }

  function insertTag(open, close) {
    const el = activeCellInput();
    if (!el) { toast('Selectionne une cellule'); return; }
    pushHistory();
    const s = el.selectionStart, e = el.selectionEnd, v = el.value;
    el.value = v.slice(0, s) + open + v.slice(s, e) + close + v.slice(e);
    state.grid[state.active.r][state.active.c] = el.value;
    state.dirty = true;
    paintCell(el);
    el.focus();
    try { el.setSelectionRange(s + open.length, e + open.length); } catch (err) { /* ignore */ }
    refreshPanes();
  }

  /* ------------------------------ couleurs ------------------------------ */

  /* Retourne le code couleur si la cellule ENTIERE est enveloppee d'un [color=...] */
  function wholeCellColor(v) {
    const m = /^\s*\[color=(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\]([\s\S]*)\[\/color\]\s*$/.exec(v);
    return m && !/\[color=/i.test(m[2]) ? m[1] : null;
  }

  function isLightColor(c) {
    if (c[0] !== '#') return LIGHT_NAMES.has(c.toLowerCase());
    let h = c.slice(1);
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    if (h.length < 6) return false;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    // 0.68 : attrape le vert pur #00FF00 et le cyan, illisibles sur le parchemin
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.68;
  }

  /* Teinte l'input quand la cellule entiere porte une couleur (fond sombre si
     la couleur est trop claire pour le parchemin) */
  function paintCell(el) {
    const c = wholeCellColor(el.value);
    el.style.color = c || '';
    el.style.background = c && isLightColor(c) ? '#4a4a4a' : '';
  }

  function paintAll() {
    overlay.querySelectorAll('input.cell').forEach(paintCell);
  }

  const stripColor = (v) => v.replace(/\[color=[^\]]*\]/gi, '').replace(/\[\/color\]/gi, '');

  function activeCellInput() {
    const { r, c } = state.active;
    return overlay.querySelector('input.cell[data-r="' + r + '"][data-c="' + c + '"]');
  }

  function applyColor(hex) {
    const el = activeCellInput();
    if (!el) { toast('Selectionne une cellule'); return; }
    pushHistory();

    const s = el.selectionStart, e = el.selectionEnd, v = el.value;
    let caret;
    if (s !== e) {
      // selection partielle : on encadre uniquement la selection
      el.value = v.slice(0, s) + '[color=' + hex + ']' + v.slice(s, e) + '[/color]' + v.slice(e);
      caret = e + ('[color=' + hex + ']').length + 8;
    } else if (!v.trim()) {
      // cellule vide : balises pretes a remplir, curseur au milieu
      el.value = '[color=' + hex + '][/color]';
      caret = ('[color=' + hex + ']').length;
    } else {
      // toute la cellule : on retire d'abord les couleurs existantes
      const plain = stripColor(v);
      el.value = '[color=' + hex + ']' + plain + '[/color]';
      caret = el.value.length;
    }

    state.grid[state.active.r][state.active.c] = el.value;
    state.dirty = true;
    paintCell(el);
    closeColorPop();
    el.focus();
    try { el.setSelectionRange(caret, caret); } catch (err) { /* ignore */ }
    refreshPanes();
  }

  function clearColor() {
    const el = activeCellInput();
    if (!el) return;
    pushHistory();
    el.value = stripColor(el.value);
    state.grid[state.active.r][state.active.c] = el.value;
    state.dirty = true;
    paintCell(el);
    closeColorPop();
    el.focus();
    refreshPanes();
  }

  function toggleColorPop() {
    const p = overlay.querySelector('#cpop');
    p.classList.toggle('show');
    const el = activeCellInput();
    const cur = el && wholeCellColor(el.value);
    if (cur && cur[0] === '#' && cur.length === 7) overlay.querySelector('#cpick').value = cur;
  }

  function closeColorPop() {
    const p = overlay && overlay.querySelector('#cpop');
    if (p) p.classList.remove('show');
  }

  function applySource() {
    const txt = overlay.querySelector('#src').value;
    if (!txt.trim()) return;
    pushHistory();
    if (/\[table\]|\[\*\]|\[\|\]/i.test(txt)) {
      const p = parseBBTable(txt);
      state.grid = p.grid;
      state.header = p.header;
    } else {
      state.grid = tsvToGrid(txt);
    }
    state.dirty = true;
    render();
    toast('Grille chargee');
  }

  function togglePane(which) {
    const p = overlay.querySelector('#pane-' + which);
    const other = overlay.querySelector('#pane-' + (which === 'preview' ? 'source' : 'preview'));
    const on = !p.classList.contains('show');
    p.classList.toggle('show', on);
    other.classList.remove('show');
    overlay.querySelector('#tab-preview').classList.toggle('on', which === 'preview' && on);
    overlay.querySelector('#tab-source').classList.toggle('on', which === 'source' && on);
    refreshPanes();
  }

  /* ------------------------------ insertion ----------------------------- */

  function save() {
    const bb = serializeBBTable(state.grid, state.header);
    const ta = state.ta;

    if (!ta || !document.contains(ta)) {
      copyToClipboard(bb);
      toast('Zone de texte introuvable : BBCode copie dans le presse-papier');
      closeEditor(true);
      return;
    }

    const v = ta.value;
    let start, end;
    if (state.block) {
      // Le texte a pu changer entre-temps : on retrouve le bloc d'origine
      const idx = v.indexOf(state.block.text);
      if (idx >= 0) { start = idx; end = idx + state.block.text.length; }
      else { start = ta.selectionStart; end = ta.selectionEnd; }
    } else {
      start = ta.selectionStart;
      end = ta.selectionEnd;
    }

    const next = v.slice(0, start) + bb + v.slice(end);
    setTextareaValue(ta, next, start + bb.length, start + bb.length);
    toast('Tableau insere');
    closeEditor(true);
  }

  /* ------------------------------ clics UI ------------------------------ */

  function onToolbarClick(e) {
    const b = e.target.closest('button[data-act]');
    // tout clic hors du popover couleur (sauf son propre bouton) le referme
    if (!e.target.closest('#cpop') && (!b || b.dataset.act !== 'color-menu')) closeColorPop();
    if (!b || b.closest('#gridwrap')) return;
    const act = b.dataset.act;
    switch (act) {
      case 'color-menu': toggleColorPop(); break;
      case 'color-set': applyColor(b.dataset.hex); break;
      case 'color-custom': applyColor(overlay.querySelector('#cpick').value.toUpperCase()); break;
      case 'color-clear': clearColor(); break;
      case 'add-row': addRow(state.grid.length - 1); break;
      case 'add-col': addCol(state.grid[0].length - 1); break;
      case 'tag': insertTag(b.dataset.open, b.dataset.close); break;
      case 'undo': undo(); break;
      case 'transpose': transpose(); break;
      case 'clean': clean(); break;
      case 'copy-bb': copyToClipboard(serializeBBTable(state.grid, state.header)); toast('BBCode copie'); break;
      case 'copy-tsv': copyToClipboard(gridToTsv(state.grid)); toast('Copie (collable dans Excel)'); break;
      case 'pane-preview': togglePane('preview'); break;
      case 'pane-source': togglePane('source'); break;
      case 'apply-src': applySource(); break;
      case 'save': save(); break;
      case 'cancel': closeEditor(false); break;
      default: break;
    }
  }

  function onGridClick(e) {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const i = +b.dataset.i;
    switch (b.dataset.act) {
      case 'row-add': addRow(i); break;
      case 'row-del': delRow(i); break;
      case 'row-up': moveRow(i, -1); break;
      case 'row-down': moveRow(i, 1); break;
      case 'col-add': addCol(i); break;
      case 'col-del': delCol(i); break;
      case 'col-left': moveCol(i, -1); break;
      case 'col-right': moveCol(i, 1); break;
      default: break;
    }
  }

  /* =========================================================================
   *  7. API publique
   * ====================================================================== */

  window.__GrepoBBTable = {
    open: (ta) => openEditor(ta || currentTA || document.querySelector('textarea')),
    close: () => closeEditor(true),
    parse: parseBBTable,
    serialize: serializeBBTable,
    toast,
    version: '1.1.0'
  };

  toast('Editeur de tableaux BBCode actif - Alt+T dans une zone de texte');
})();
