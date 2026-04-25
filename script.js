const socket = io('https://node.tcicerodev.com'); 
//const socket = io('http://127.0.0.1:3000');

let currentRoom = null;
let isHost = false;
let boardLetters = [];
let isDragging = false;
let currentPath = [];
let selectedCells = new Set();
let currentWordStr = '';

const boardEl = document.getElementById('board');
const currentWordEl = document.getElementById('currentWord');
const feedbackFlash = document.getElementById('feedbackFlash');
const wordInput = document.getElementById('wordInput');


// ====================== SOCKET EVENT HANDLERS ======================

socket.on('roomCreated', ({ roomId, game }) => {
  currentRoom = roomId;
  isHost = true;
  enterWaitingScreen(roomId, game.players);
});

socket.on('playerJoined', (game) => {
  // This now properly updates the waiting screen for ALL players (including new joiners)
  if (currentRoom) {
    enterWaitingScreen(currentRoom, game.players);
  } else {
    // Fallback for very first joiner (rare)
    updatePlayers(game.players);
  }
});

socket.on('gameStarted', ({ board }) => {
  document.getElementById('waitingSection').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
  document.getElementById('preGameBoard').classList.add('hidden');
  document.getElementById('boardContainer').classList.remove('hidden');
  
  renderBoard(board);
  document.body.classList.add('playing');
});

socket.on('timerUpdate', (time) => {
  document.getElementById('timer').textContent = time;
});

socket.on('wordAccepted', ({ playerId, word, score }) => {
  if (playerId === socket.id) {
    addToMyWords(word);
    document.getElementById('myScore').innerHTML = `Score: <span class="text-yellow-400">${score}</span>`;
    showFeedback(true);        // ← Green flash
  }
});

socket.on('wordRejected', ({ word, reason }) => {
  showFeedback(false);         // ← Red flash
  
  // Optional: still show the rejection reason briefly
  currentWordEl.style.color = '#ef4444';
  currentWordEl.textContent = reason ? reason.substring(0, 25) : 'Invalid';
  setTimeout(() => {
    currentWordEl.style.color = '';
    currentWordEl.textContent = '';
  }, 800);
});

socket.on('roundEnded', ({ players }) => {
  document.body.classList.remove('playing');
  showScreen('results');
  renderFinalScores(players);
  
  // Show "Play Again" to host, "Waiting" to others
  document.getElementById('hostResetArea').classList.toggle('hidden', !isHost);
  document.getElementById('guestWaitArea').classList.toggle('hidden', isHost);
});

socket.on('roomReset', (game) => {
  // 1. Clear local UI state
  document.getElementById('myWords').innerHTML = '';
  document.getElementById('myWordCount').textContent = '0';
  document.getElementById('myScore').innerHTML = 'Score: <span class="text-yellow-400">0</span>';
  
  // 2. Hide results and go back to waiting screen
  document.getElementById('results').classList.add('hidden');
  enterWaitingScreen(currentRoom, game.players);
});

socket.on('error', (msg) => {
  alert(msg);
});

// ====================== UI FUNCTIONS ======================

function showScreen(screen) {
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('game').classList.add('hidden');
  document.getElementById('results').classList.add('hidden');
  document.getElementById(screen).classList.remove('hidden');
}

function enterWaitingScreen(roomId, players) {
  showScreen('lobby');
  document.getElementById('createJoinSection').classList.add('hidden');
  
  const waitingSection = document.getElementById('waitingSection');
  waitingSection.classList.remove('hidden');
  
  document.getElementById('displayRoomId').textContent = roomId;
  document.getElementById('roomId').textContent = roomId;
  
  updatePlayers(players);
  
  // Only the host sees the Start button
  document.getElementById('startBtn').classList.toggle('hidden', !isHost);
}

function updatePlayers(players = []) {
// Target both the list in the lobby and the list in the active game
  const gameList = document.getElementById('playersList');
  const waitingList = document.getElementById('waitingPlayersList');
  
  // Create the HTML for the player cards
  const html = players.map(p => `
    <li class="flex justify-between items-center bg-zinc-800 px-5 py-4 rounded-2xl border border-zinc-700/50">
      <span class="text-lg font-medium">${p.name}</span>
      <span class="font-bold text-2xl text-yellow-400">${p.score || 0}</span>
    </li>
  `).join('');

  // Update both elements if they exist
  if (gameList) gameList.innerHTML = html;
  if (waitingList) waitingList.innerHTML = html;
}

function createRoom() {
  const name = document.getElementById('name').value.trim() || `Player${Math.floor(Math.random()*999)}`;
  socket.emit('createRoom', name);
}

function joinRoom() {
  let roomId = document.getElementById('roomIdInput').value.trim().toLowerCase();
  const name = document.getElementById('name').value.trim() || `Player${Math.floor(Math.random()*999)}`;
  
  if (!roomId) {
    alert("Please enter a room code");
    return;
  }
  
  currentRoom = roomId;   // Set early so playerJoined can catch it
  socket.emit('joinRoom', { roomId, playerName: name });
}

function copyInviteLink() {
  if (!currentRoom) return;
  const inviteLink = `${window.location.origin}?room=${currentRoom}`;
  
  navigator.clipboard.writeText(inviteLink).then(() => {
    const btn = event.currentTarget;
    const orig = btn.innerHTML;
    btn.innerHTML = '✅ Link Copied!';
    setTimeout(() => btn.innerHTML = orig, 2000);
  });
}

function requestRestart() {
  if (isHost && currentRoom) {
    socket.emit('restartGame', currentRoom);
  }
}

function startGame() {
  if (currentRoom && isHost) {
    socket.emit('startGame', currentRoom);
  }
}

// ====================== BOARD DRAG LOGIC ======================
// (unchanged from previous version - kept for completeness)

function renderBoard(board) {
  boardLetters = board.flat();
  boardEl.innerHTML = '';
  
  board.forEach((row, r) => {
    row.forEach((letter, c) => {
      const btn = document.createElement('button');
      btn.textContent = letter;
      btn.dataset.index = r * 4 + c;
      
      btn.addEventListener('mousedown', startDrag);
      btn.addEventListener('touchstart', startDrag, { passive: false });
      btn.addEventListener('mouseenter', continueDrag);
      btn.addEventListener('touchmove', continueDrag, { passive: false });
      
      boardEl.appendChild(btn);
    });
  });
}

function getCellIndex(e) {
  const touch = e.touches ? e.touches[0] : e;
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  return el && el.dataset.index !== undefined ? parseInt(el.dataset.index) : -1;
}

function startDrag(e) {
  e.preventDefault();
  isDragging = true;
  currentPath = [];
  selectedCells.clear();
  currentWordStr = '';
  const idx = parseInt(e.currentTarget.dataset.index);
  if (idx >= 0) selectCell(idx);
}

function continueDrag(e) {
  if (!isDragging) return;
  e.preventDefault();
  const idx = getCellIndex(e);
  if (idx >= 0 && !selectedCells.has(idx)) {
    if (currentPath.length === 0 || isAdjacent(currentPath.at(-1), idx)) {
      selectCell(idx);
    }
  }
}

function isAdjacent(a, b) {
  const ra = Math.floor(a/4), ca = a % 4;
  const rb = Math.floor(b/4), cb = b % 4;
  return Math.abs(ra - rb) <= 1 && Math.abs(ca - cb) <= 1;
}

function selectCell(idx) {
  currentPath.push(idx);
  selectedCells.add(idx);
  const cell = boardEl.querySelector(`button[data-index="${idx}"]`);
  if (cell) cell.classList.add('selected');
  currentWordStr += boardLetters[idx];
  currentWordEl.textContent = currentWordStr;
}

function endDrag() {
  if (!isDragging) return;
  isDragging = false;

  if (currentWordStr.length >= 3) {
    socket.emit('submitWord', { roomId: currentRoom, word: currentWordStr });
  }

  document.querySelectorAll('#board button').forEach(b => b.classList.remove('selected'));
  currentWordEl.textContent = '';
  currentPath = [];
  selectedCells.clear();
  currentWordStr = '';
}

document.addEventListener('mouseup', endDrag);
document.addEventListener('touchend', endDrag);
document.addEventListener('mouseleave', endDrag);

wordInput.addEventListener('keypress', e => {
  if (e.key === 'Enter' && currentRoom) {
    const word = wordInput.value.trim().toUpperCase();
    if (word.length >= 3) {
      socket.emit('submitWord', { roomId: currentRoom, word });
      wordInput.value = '';
    }
  }
});

function addToMyWords(word) {
  const list = document.getElementById('myWords');
  const li = document.createElement('li');
  li.textContent = word;
  li.className = "py-1 px-3 bg-zinc-800 rounded-2xl";
  list.appendChild(li);
  document.getElementById('myWordCount').textContent = list.children.length;
}

function renderFinalScores(players) {
  let html = '';
  players.sort((a, b) => (b.score || 0) - (a.score || 0));
  players.forEach((p, i) => {
    html += `
      <div class="bg-zinc-900 rounded-3xl p-6 flex justify-between items-center ${i === 0 ? 'ring-2 ring-yellow-400' : ''}">
        <div class="flex items-center gap-4">
          <span class="text-3xl">${i === 0 ? '🏆' : (i+1) + '.'}</span>
          <div>
            <div class="text-2xl">${p.name}</div>
            <div class="text-sm text-zinc-400">${p.words ? p.words.length : 0} words</div>
          </div>
        </div>
        <div class="text-5xl font-bold text-yellow-400">${p.score || 0}</div>
      </div>`;
  });
  document.getElementById('finalScores').innerHTML = html;
}

function showFeedback(isValid) {
  feedbackFlash.classList.remove('hidden', 'green', 'red');
  feedbackFlash.classList.add(isValid ? 'green' : 'red');
  
  // Trigger reflow then fade in
  feedbackFlash.offsetHeight;
  feedbackFlash.style.opacity = '1';

  setTimeout(() => {
    feedbackFlash.style.opacity = '0';
    setTimeout(() => {
      feedbackFlash.classList.add('hidden');
      feedbackFlash.classList.remove('green', 'red');
    }, 300);
  }, 180); // short flash
}

// Auto-fill room from invite link ?room=xxx
window.onload = () => {
  const params = new URLSearchParams(window.location.search);
  const roomFromUrl = params.get('room');
  if (roomFromUrl) {
    document.getElementById('roomIdInput').value = roomFromUrl;
  }
};