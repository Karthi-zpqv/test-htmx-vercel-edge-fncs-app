// public/chessboard.js
// Minimal accessible chessboard for Chess Together: Pure JS (no deps, no chess.js).

(function (global) {
  // == Piece/Board Definitions ==
  // Piece strings: "wP", "bK", etc. 8x8 array or FEN string for board state.
  const INITIAL_BOARD = [
    ['bR', 'bN', 'bB', 'bQ', 'bK', 'bB', 'bN', 'bR'],
    ['bP', 'bP', 'bP', 'bP', 'bP', 'bP', 'bP', 'bP'],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    ['wP', 'wP', 'wP', 'wP', 'wP', 'wP', 'wP', 'wP'],
    ['wR', 'wN', 'wB', 'wQ', 'wK', 'wB', 'wN', 'wR']
  ];
  const PIECE_UNICODES = {
    wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
    bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟︎'
  };
  const FILES = 'abcdefgh';

  // == State/Utility Helpers ==

  function cloneBoard(bs) {
    return bs.map(r => r.slice());
  }

  // Returns object with {board: [8][8], turn: 'white'|'black', ...}
  function generateInitialBoard() {
    return {
      board: cloneBoard(INITIAL_BOARD),
      turn: 'white',
      castling: { wK: true, wQ: true, bK: true, bQ: true },
      enPassant: null,
      halfmove: 0,
      fullmove: 1
    };
  }

  // Map like 'e2' to [row, col]. White's 1st rank is row 7, Black's is row 0.
  function algebraicToCoords(square) {
    if (!square || square.length !== 2) return null;
    const file = square[0], rank = square[1];
    const col = FILES.indexOf(file);
    const row = 8 - parseInt(rank, 10);
    if (col < 0 || row < 0 || row > 7) return null;
    return [row, col];
  }
  function coordsToAlgebraic([row, col]) {
    return FILES[col] + (8 - row);
  }

  // == Move Logic/Validation (very minimal: only basic legal moves, no check logic) ==
  function isMoveLegal(from, to, boardState, color = null) {
    // boardState: {board, turn, ...}
    // Accepts: from ('e2'), to ('e4')
    if (!boardState || !boardState.board) return false;
    const fromPos = algebraicToCoords(from);
    const toPos = algebraicToCoords(to);
    if (!fromPos || !toPos) return false;
    const [fr, fc] = fromPos, [tr, tc] = toPos;
    const piece = boardState.board[fr][fc];
    if (!piece) return false;
    const turnColor = color || boardState.turn;
    if (piece[0] !== (turnColor === 'white' ? 'w' : 'b')) return false;
    // Disallow capture own piece
    const target = boardState.board[tr][tc];
    if (target && target[0] === piece[0]) return false;
    // Pawn Moves
    if (piece[1] === 'P') {
      const dir = piece[0] === 'w' ? -1 : 1;
      if (fc === tc && !target) {
        // Forward 1
        if (tr === fr + dir) return true;
        // Forward 2 from base rank
        if ((piece[0] === 'w' && fr === 6 || piece[0] === 'b' && fr === 1) && tr === fr + 2*dir && !boardState.board[fr + dir][fc]) return true;
      }
      // Captures
      if (Math.abs(tc - fc) === 1 && tr === fr + dir && target && target[0] !== piece[0]) return true;
      // En passant (not implemented)
      // Promotion is accepted; handled on backend
      return false;
    }
    // Knight
    if (piece[1] === 'N') {
      const dr = Math.abs(tr - fr), dc = Math.abs(tc - fc);
      return (dr === 1 && dc === 2) || (dr === 2 && dc === 1);
    }
    // Bishop
    if (piece[1] === 'B') {
      if (Math.abs(tr - fr) !== Math.abs(tc - fc)) return false;
      for (let i = 1; i < Math.abs(tr - fr); i++) {
        if (boardState.board[fr + i * Math.sign(tr - fr)][fc + i * Math.sign(tc - fc)]) return false;
      }
      return true;
    }
    // Rook
    if (piece[1] === 'R') {
      if (fr !== tr && fc !== tc) return false;
      if (fr === tr) {
        for (let c = Math.min(fc, tc)+1; c < Math.max(fc, tc); c++) {
          if (boardState.board[fr][c]) return false;
        }
        return true;
      }
      if (fc === tc) {
        for (let r = Math.min(fr, tr)+1; r < Math.max(fr, tr); r++) {
          if (boardState.board[r][fc]) return false;
        }
        return true;
      }
      return false;
    }
    // Queen
    if (piece[1] === 'Q') {
      // Combines bishop and rook
      if (fr === tr || fc === tc) return isMoveLegal(from, to, { board: boardState.board, turn: boardState.turn }, color='QROOK');
      if (Math.abs(tr - fr) === Math.abs(tc - fc)) return isMoveLegal(from, to, { board: boardState.board, turn: boardState.turn }, color='QBISHOP');
      return false;
    }
    // King
    if (piece[1] === 'K') {
      // Single step any direction
      if (Math.abs(tr-fr) <= 1 && Math.abs(tc-fc) <= 1) return true;
      // Castling minimal: backend enforces
      return false;
    }
    // For pseudo-piece type, do direct.
    if (color === 'QROOK') {
      // as rook logic
      if (fr !== tr && fc !== tc) return false;
      if (fr === tr) {
        for (let c = Math.min(fc, tc)+1; c < Math.max(fc, tc); c++) {
          if (boardState.board[fr][c]) return false;
        }
        return true;
      }
      if (fc === tc) {
        for (let r = Math.min(fr, tr)+1; r < Math.max(fr, tr); r++) {
          if (boardState.board[r][fc]) return false;
        }
        return true;
      }
    }
    if (color === 'QBISHOP') {
      if (Math.abs(tr - fr) !== Math.abs(tc - fc)) return false;
      for (let i = 1; i < Math.abs(tr - fr); i++) {
        if (boardState.board[fr + i * Math.sign(tr - fr)][fc + i * Math.sign(tc - fc)]) return false;
      }
      return true;
    }
    return false;
  }

  // Returns next board state (shallow; do not apply advanced rules)
  function getNextBoardState(move, boardState) {
    // move: {from: 'e2', to: 'e4'}
    if (!isMoveLegal(move.from, move.to, boardState)) return null;
    const state = JSON.parse(JSON.stringify(boardState));
    const from = algebraicToCoords(move.from), to = algebraicToCoords(move.to);
    if (!from || !to) return null;
    const [fr, fc] = from, [tr, tc] = to;
    // Move piece
    state.board[tr][tc] = state.board[fr][fc];
    state.board[fr][fc] = null;
    // Pawn promotion: always promote to queen in client (backend enforces options)
    if (
      state.board[tr][tc] &&
      state.board[tr][tc][1] === 'P' &&
      ((state.board[tr][tc][0] === 'w' && tr === 0) || (state.board[tr][tc][0] === 'b' && tr === 7))
    ) {
      state.board[tr][tc] = state.board[tr][tc][0] + 'Q';
    }
    // Swap turn
    state.turn = state.turn === 'white' ? 'black' : 'white';
    return state;
  }

  // == Board Rendering/Event Handling ==
  // opts: {yourColor, onMove(from, to), interactive}
  function renderChessBoard(container, boardState, opts) {
    if (!container || !boardState || !Array.isArray(boardState.board)) return;
    container.innerHTML = '';
    const { yourColor='white', interactive=true, onMove=null } = opts || {};
    const board = boardState.board;
    let selected = null; // [row, col]
    let possibleSquares = [];
    let isDragging = false, dragSource = null;
    // Arrange rows by color
    const rows = yourColor === 'white' ? [...Array(8).keys()] : [...Array(8).keys()].reverse();
    const cols = yourColor === 'white' ? [...Array(8).keys()] : [...Array(8).keys()].reverse();
    // Main table
    const table = document.createElement('table');
    table.className = 'border-collapse select-none chessboard-table';
    table.setAttribute('tabindex', '0');
    table.setAttribute('aria-label', 'Chessboard');
    table.style.width = table.style.height = '336px';
    // Render squares
    for (let r of rows) {
      const tr = document.createElement('tr');
      for (let c of cols) {
        const td = document.createElement('td');
        const sq = coordsToAlgebraic([r, c]);
        td.setAttribute('data-square', sq);
        td.setAttribute('tabindex', '0');
        td.className =
          ((r + c) % 2 === 0
            ? 'bg-emerald-50'
            : 'bg-emerald-200') +
          ' w-10 h-10 md:w-12 md:h-12 text-center align-middle relative chessboard-cell font-bold text-2xl cursor-pointer transition';
        if (
          selected &&
          r === selected[0] &&
          c === selected[1]
        ) {
          td.className += ' ring-2 ring-emerald-500';
        }
        if (possibleSquares.some(([pr, pc]) => pr === r && pc === c)) {
          td.className +=
            ' after:ring-2 after:ring-yellow-400 after:absolute after:inset-0 after:rounded-full';
        }
        const piece = board[r][c];
        if (piece) {
          const span = document.createElement('span');
          span.innerText = PIECE_UNICODES[piece] || '';
          span.className =
            piece[0] === 'w'
              ? 'text-gray-800'
              : 'text-gray-800 opacity-80 drop-shadow';
          if (interactive && ((yourColor === 'white' && piece[0] === 'w') || (yourColor === 'black' && piece[0] === 'b'))) {
            // Draggable
            span.setAttribute('draggable', 'true');
            span.className += ' cursor-grab';
            span.addEventListener('dragstart', (e) => {
              isDragging = true;
              dragSource = [r, c];
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', sq);
              td.classList.add('ring-2', 'ring-yellow-400');
            });
            span.addEventListener('dragend', () => {
              isDragging = false;
              dragSource = null;
              td.classList.remove('ring-2', 'ring-yellow-400');
            });
          }
          td.appendChild(span);
        }
        // Click/keyboard/tap-to-move
        if (interactive) {
          td.addEventListener('click', () => {
            handleSquareClick(r, c, piece);
          });
          td.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              handleSquareClick(r, c, piece);
              e.preventDefault();
            }
          });
          // Drop
          td.addEventListener('dragover', (e) => {
            if (isDragging) e.preventDefault();
          });
          td.addEventListener('drop', (e) => {
            if (dragSource) {
              const from = coordsToAlgebraic(dragSource);
              const to = sq;
              // Validate move from draggable
              if (typeof onMove === 'function') {
                onMove(from, to);
              }
              isDragging = false;
              dragSource = null;
            }
          });
        }
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    container.appendChild(table);
    // Keyboard/tap/click move select
    function handleSquareClick(r, c, piece) {
      if (!selected) {
        // Select a friendly piece
        if (
          piece &&
          ((yourColor === 'white' && piece[0] === 'w') ||
            (yourColor === 'black' && piece[0] === 'b'))
        ) {
          selected = [r, c];
          highlightPossibleMoves(r, c, piece);
        }
      } else {
        // Click destination (re-click same unselects)
        if (selected[0] === r && selected[1] === c) {
          selected = null;
          possibleSquares = [];
          renderChessBoard(container, boardState, opts);
        } else {
          // Try move from selected to this
          const from = coordsToAlgebraic(selected);
          const to = coordsToAlgebraic([r, c]);
          if (typeof onMove === 'function') {
            onMove(from, to);
          }
          selected = null;
          possibleSquares = [];
        }
      }
    }
    // Optionally highlight moves
    function highlightPossibleMoves(r, c, piece) {
      possibleSquares = [];
      for (let rr = 0; rr < 8; rr++) {
        for (let cc = 0; cc < 8; cc++) {
          if (isMoveLegal(coordsToAlgebraic([r, c]), coordsToAlgebraic([rr, cc]), boardState, yourColor))
            possibleSquares.push([rr, cc]);
        }
      }
      renderChessBoard(container, boardState, opts);
      // We reload so recursion ends here (don't highlight again)
    }
  }

  // Attach to window
  global.chessboard = {
    generateInitialBoard,
    isMoveLegal,
    getNextBoardState,
    renderChessBoard,
    algebraicToCoords,
    coordsToAlgebraic
  };
})(window);
