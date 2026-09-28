"use strict";

const STORAGE_KEY = "strongbox_html5_v1";
const MAX_LEVEL = 50;

const LEVELS = Object.fromEntries(
  Array.from({ length: MAX_LEVEL }, (_, i) => {
    const level = i + 1;
    const block = Math.floor(i / 10) + 1;

    let digits = 2;

    if (block === 2) {
      digits = 3;
    } else if (block === 3 || block === 4) {
      digits = 4;
    } else if (block === 5) {
      digits = 5;
    }

    return [
      level,
      {
        time: 55 - (i % 10) * 5,
        digits,
        reward: 10,
        block
      }
    ];
  })
);

const BLOCKS = {
  1: {
    from: 1,
    to: 10,
    title: "SACO DE DINERO",
    reward: 200,
    image: "assets/saco-dinero.png"
  },
  2: {
    from: 11,
    to: 20,
    title: "LINGOTE DE PLATA",
    reward: 300,
    image: "assets/lingote-plata.png"
  },
  3: {
    from: 21,
    to: 30,
    title: "LINGOTE DE ORO",
    reward: 400,
    image: "assets/lingote-oro.png"
  },
  4: {
    from: 31,
    to: 40,
    title: "ESMERALDAS",
    reward: 500,
    image: "assets/esmeraldas.png"
  },
  5: {
    from: 41,
    to: 50,
    title: "DIAMANTE",
    reward: 600,
    image: "assets/diamante.png"
  }
};

const $ = (selector) => document.querySelector(selector);

const coins = (value) => {
  return `${new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 0
  }).format(Number(value) || 0)} ClicCoin`;
};

let state = loadState();

let timerId = null;
let pendingView = "home";

let game = {
  level: 1,
  target: "",
  board: [],
  revealed: [],
  progress: 0,
  attempts: 0,
  finished: false,
  timeLeft: 55
};

let audioCtx = null;

let gamePaused = false;
let gameMuted = false;

const GM_MAX_AD_RETRIES = 2;
const GM_AD_RETRY_DELAY = 1500;

/* =========================
   AUDIO
========================= */

function initAudio() {
  if (!audioCtx) {
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }

  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch((error) => {
      console.warn("No se pudo reanudar el audio:", error);
    });
  }
}

function muteGameAudio() {
  gameMuted = true;

  if (audioCtx && audioCtx.state === "running") {
    audioCtx.suspend().catch((error) => {
      console.warn("No se pudo suspender el audio:", error);
    });
  }

  document.querySelectorAll("audio, video").forEach((media) => {
    media.muted = true;
  });
}

function resumeGameAudio() {
  gameMuted = false;

  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch((error) => {
      console.warn("No se pudo reanudar el audio:", error);
    });
  }

  document.querySelectorAll("audio, video").forEach((media) => {
    media.muted = false;
  });
}

function tone(
  frequency,
  duration,
  type = "sine",
  volume = 0.045,
  delay = 0
) {
  if (!audioCtx || gameMuted) {
    return;
  }

  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  const startTime = audioCtx.currentTime + delay;
  const endTime = startTime + duration;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startTime);

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

  oscillator.connect(gain).connect(audioCtx.destination);

  oscillator.start(startTime);
  oscillator.stop(endTime + 0.02);
}

function playPress() {
  tone(115, 0.07, "square", 0.035);
  tone(78, 0.09, "sine", 0.025, 0.035);
}

function playWrong() {
  tone(180, 0.09, "sawtooth", 0.04);
  tone(105, 0.16, "sawtooth", 0.035, 0.07);
}

function playWin() {
  [523, 659, 784, 1047].forEach((frequency, index) => {
    tone(frequency, 0.18, "sine", 0.055, index * 0.09);
  });
}

function playTimeout() {
  [260, 220, 180, 140].forEach((frequency, index) => {
    tone(frequency, 0.2, "triangle", 0.05, index * 0.14);
  });
}

function animatePrizeImages() {
  document.querySelectorAll(".block-icon-img").forEach((image, index) => {
    image.style.setProperty("--delay", `${index * 70}ms`);
    image.classList.add("prize-float");
  });
}

/* =========================
   ESTADO LOCAL
========================= */

function loadState() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || "null"
    );

    const source =
      saved && typeof saved === "object"
        ? saved
        : {
            currentLevel: 1,
            balance: 0,
            best: 0
          };

    return {
      currentLevel: Math.min(
        MAX_LEVEL,
        Math.max(1, Number(source.currentLevel) || 1)
      ),
      balance: Math.max(0, Number(source.balance) || 0),
      best: Math.max(0, Number(source.best) || 0)
    };
  } catch (error) {
    console.warn("No se pudo cargar el progreso:", error);

    return {
      currentLevel: 1,
      balance: 0,
      best: 0
    };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  updateUI();
  animatePrizeImages();
}

function currentBlock(level = state.currentLevel) {
  return Math.floor((level - 1) / 10) + 1;
}

/* =========================
   INTERFAZ
========================= */

function updateUI() {
  const level = state.currentLevel;

  const sessionStatus = $("#session-status");
  if (sessionStatus) {
    sessionStatus.textContent = `Nivel ${level}`;
  }

  const homeBalance = $("#home-balance");
  if (homeBalance) {
    homeBalance.textContent = coins(state.balance);
  }

  const homeLevel = $("#home-level");
  if (homeLevel) {
    homeLevel.textContent = state.currentLevel;
  }

  const homeLevelProgress = $("#home-level-progress");
  if (homeLevelProgress) {
    homeLevelProgress.textContent = `${state.currentLevel} / ${MAX_LEVEL}`;
  }

  const progressBar = $(".home-progress i");

  if (progressBar) {
    const percentage = Math.max(
      2,
      (state.currentLevel / MAX_LEVEL) * 100
    );

    progressBar.style.setProperty("--progress", `${percentage}%`);
  }

  const progressLabel = $("#progress-label");
  if (progressLabel) {
    progressLabel.textContent = `Nivel ${level} de ${MAX_LEVEL}`;
  }

  const bestLabel = $("#best-label");
  if (bestLabel) {
    bestLabel.textContent = coins(state.best);
  }

  const accountLevel = $("#account-level");
  if (accountLevel) {
    accountLevel.textContent = `${level} / ${MAX_LEVEL}`;
  }

  const accountBalance = $("#account-balance");
  if (accountBalance) {
    accountBalance.textContent = coins(state.balance);
  }

  const accountBest = $("#account-best");
  if (accountBest) {
    accountBest.textContent = coins(state.best);
  }

  renderLevels();
}

function renderLevels() {
  const wrapper = $("#levels-grid");

  if (!wrapper) {
    return;
  }

  wrapper.innerHTML = "";

  const level = state.currentLevel;
  const config = LEVELS[level];
  const blockNumber = currentBlock(level);
  const block = BLOCKS[blockNumber];

  const card = document.createElement("button");

  card.type = "button";
  card.className = "level-card current";

  card.innerHTML = `
    <span class="level-num">${level}</span>
    <div>
      <b>Nivel ${level}</b>
      <small>
        Bloque ${blockNumber} · ⏱ ${config.time}s · 🔢 ${config.digits} cifras
      </small>
      <small>Recompensa: +${coins(config.reward)}</small>
    </div>
    <span class="level-arrow">JUGAR →</span>
  `;

  card.onclick = () => {
    startGame(level);
  };

  wrapper.appendChild(card);

  const prize = document.createElement("div");

  prize.className = "block-prize";

  prize.innerHTML = `
    <img
      class="block-icon-img"
      src="${block.image}"
      alt="${block.title}"
    >
    <div class="block-prize-copy">
      <b>Bloque ${blockNumber}: ${block.title}</b>
      <small>
        Niveles ${block.from}–${block.to} · Premio especial:
        <strong>+${coins(block.reward)}</strong>
      </small>
    </div>
  `;

  wrapper.appendChild(prize);

  const note = document.createElement("p");

  note.className = "level-progress";

  note.textContent =
    level === MAX_LEVEL
      ? "Nivel 50 · último desafío · 5 bloques disponibles"
      : `Nivel actual: ${level} de 50 · Bloque ${blockNumber} de 5`;

  wrapper.appendChild(note);
}

/* =========================
   NAVEGACIÓN
========================= */

function show(id) {
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.remove("active");
  });

  const view = $(`#${id}`);

  if (view) {
    view.classList.add("active");
  }

  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === id);
  });

  if (id === "home" || id === "account") {
    updateUI();
  }
}

function gameIsActive() {
  const gameView = $("#game");

  return (
    gameView &&
    gameView.classList.contains("active") &&
    !game.finished
  );
}

function navigateTo(id) {
  if (id === "game") {
    show(id);
    return;
  }

  if (gameIsActive()) {
    openLeaveConfirm(id);
    return;
  }

  show(id);
}

function openLeaveConfirm(next) {
  pendingView = next || "home";

  const leaveModal = $("#leave-modal");

  if (leaveModal) {
    leaveModal.classList.add("show");
  }
}

function closeLeaveConfirm() {
  pendingView = "home";

  const leaveModal = $("#leave-modal");

  if (leaveModal) {
    leaveModal.classList.remove("show");
  }
}

function stopTimer() {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}

function leaveGame() {
  const next = pendingView || "home";

  closeLeaveConfirm();
  stopTimer();

  game.finished = true;

  show(next);
}

/* =========================
   LÓGICA DEL JUEGO
========================= */

function randomTarget(config) {
  let target = "";

  for (let i = 0; i < config.digits; i++) {
    target +=
      i === 0
        ? String(1 + Math.floor(Math.random() * 9))
        : String(Math.floor(Math.random() * 10));
  }

  return target;
}

function buildBoard(target) {
  const requiredDigits = target.split("");
  const usedDigits = new Set(requiredDigits);
  const filler = [];

  for (
    let digit = 0;
    digit <= 9 &&
    filler.length < 16 - requiredDigits.length;
    digit++
  ) {
    if (!usedDigits.has(String(digit))) {
      filler.push(String(digit));
    }
  }

  while (filler.length < 16 - requiredDigits.length) {
    filler.push(String(Math.floor(Math.random() * 10)));
  }

  const board = [...requiredDigits, ...filler];

  for (let i = board.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [board[i], board[j]] = [board[j], board[i]];
  }

  return board;
}

function startGame(level) {
  if (level !== state.currentLevel) {
    return;
  }

  initAudio();

  const config = LEVELS[level];

  closeModal();
  closeLeaveConfirm();
  stopTimer();

  game = {
    level,
    target: randomTarget(config),
    board: [],
    revealed: [],
    progress: 0,
    attempts: 0,
    finished: false,
    timeLeft: config.time
  };

  game.board = buildBoard(game.target);

  show("game");

  const gameMode = $("#game-mode");

  if (gameMode) {
    gameMode.textContent =
      `NIVEL ${level} · BLOQUE ${config.block} · ${config.time} SEGUNDOS`;
  }

  const targetNumber = $("#target-number");

  if (targetNumber) {
    targetNumber.textContent = game.target;
  }

  const gameBlockIcon = $("#game-block-icon");

  if (gameBlockIcon) {
    gameBlockIcon.src = BLOCKS[config.block].image;
    gameBlockIcon.alt =
      `Premio: ${BLOCKS[config.block].title}`;
  }

  const gameBlockLabel = $("#game-block-label");

  if (gameBlockLabel) {
    gameBlockLabel.textContent = `BLOQUE ${config.block}`;
  }

  const gameBlockTitle = $("#game-block-title");

  if (gameBlockTitle) {
    gameBlockTitle.textContent = BLOCKS[config.block].title;
  }

  const attempts = $("#attempts");

  if (attempts) {
    attempts.textContent = "0";
  }

  const status = $("#game-status");

  if (status) {
    status.textContent = "Buscando";
  }

  const reward = $("#game-reward");

  if (reward) {
    reward.textContent =
      `Acierto: +${coins(config.reward)} · ` +
      `Fallo: −${coins(config.reward)} · ` +
      "Bono de bloque al completar cada 10 niveles";
  }

  const balance = $("#balance");

  if (balance) {
    balance.textContent = coins(state.balance);
  }

  updateTimerUI();
  renderBoard();

  if (!gamePaused) {
    startTimer();
  }

  // CrazyGames: el juego empieza a contar gameplay SOLO después
  // de que el tablero ya esté visible. Nunca bloquea el botón JUGAR.
  crazyGameplayStart();
}

function formatTime(seconds) {
  return `00:${String(seconds).padStart(2, "0")}`;
}

function updateTimerUI() {
  const timer = $("#game-timer");

  if (!timer) {
    return;
  }

  timer.textContent = formatTime(game.timeLeft);

  timer.classList.toggle(
    "warning",
    game.timeLeft <= 15 && game.timeLeft > 5
  );

  timer.classList.toggle("danger", game.timeLeft <= 5);
}

function startTimer() {
  stopTimer();

  if (
    gamePaused ||
    game.finished ||
    game.timeLeft <= 0
  ) {
    return;
  }

  timerId = setInterval(() => {
    if (game.finished || gamePaused) {
      stopTimer();
      return;
    }

    game.timeLeft = Math.max(0, game.timeLeft - 1);

    updateTimerUI();

    if (game.timeLeft === 0) {
      timeExpired();
    }
  }, 1000);
}

function renderBoard() {
  const boardElement = $("#board");

  if (!boardElement) {
    return;
  }

  boardElement.innerHTML = "";

  for (let index = 0; index < 16; index++) {
    const button = document.createElement("button");

    button.className = "cell";
    button.type = "button";
    button.setAttribute("aria-label", `Casilla ${index + 1}`);

    if (game.revealed.includes(index)) {
      button.classList.add("revealed");
      button.dataset.digit = game.board[index];
    } else {
      button.innerHTML =
        '<img src="assets/moneda.svg" alt="Número oculto">';
    }

    button.onclick = () => pick(index, button);

    boardElement.appendChild(button);
  }
}

function revealCell(index, digit, error = false) {
  game.revealed = game.revealed.filter((item) => item !== index);
  game.revealed.push(index);

  const button = $("#board")?.children[index];

  if (!button) {
    return;
  }

  button.classList.add(error ? "error-reveal" : "revealed");
  button.dataset.digit = digit;
  button.innerHTML = "";
}

function applyLocalResult(success) {
  const config = LEVELS[game.level];

  if (success) {
    let delta = config.reward;

    state.balance += config.reward;

    let blockBonus = 0;

    if (game.level % 10 === 0) {
      blockBonus = BLOCKS[config.block].reward;
      state.balance += blockBonus;
      delta += blockBonus;
    }

    state.best = Math.max(state.best, state.balance);

    const previousLevel = game.level;

    state.currentLevel = Math.min(
      MAX_LEVEL,
      previousLevel + 1
    );

    saveState();

    return {
      delta,
      blockBonus
    };
  }

  state.balance = Math.max(
    0,
    state.balance - config.reward
  );

  saveState();

  return {
    delta: -config.reward,
    blockBonus: 0
  };
}

/* =========================
   MODALES
========================= */

function finishModal(
  title,
  eyebrow,
  text,
  delta = 0,
  buttonText = "CONTINUAR",
  icon = "🪙"
) {
  const modalIcon = $("#modal-icon");
  const modalEyebrow = $("#modal-eyebrow");
  const modalTitle = $("#modal-title");
  const modalText = $("#modal-text");
  const modalBalance = $("#modal-balance");
  const modalAction = $("#modal-action");
  const modal = $("#modal");

  if (modalIcon) {
    modalIcon.textContent = icon;
  }

  if (modalEyebrow) {
    modalEyebrow.textContent = eyebrow;
  }

  if (modalTitle) {
    modalTitle.textContent = title;
  }

  if (modalText) {
    modalText.textContent = text;
  }

  if (modalBalance) {
    modalBalance.textContent = delta
      ? `${delta > 0 ? "+" : ""}${coins(Math.abs(delta))} · ` +
        `Saldo: ${coins(state.balance)}`
      : coins(state.balance);
  }

  if (modalAction) {
    modalAction.textContent = buttonText;
  }

  if (modal) {
    modal.classList.add("show");
  }

  // Anuncio midgame después de mostrar el resultado.
  // Se ejecuta de forma asíncrona para no bloquear la interfaz.
  setTimeout(() => crazyShowMidgameAd("resultado"), 300);
}

function closeModal() {
  const modal = $("#modal");

  if (modal) {
    modal.classList.remove("show");
  }
}

/* =========================
   FINAL DEL NIVEL
========================= */

function timeExpired() {
  if (game.finished) {
    return;
  }

  initAudio();
  playTimeout();

  game.finished = true;
  stopTimer();
  crazyGameplayStop();

  const status = $("#game-status");

  if (status) {
    status.textContent = "TIEMPO AGOTADO";
  }

  const result = applyLocalResult(false);


  finishModal(
    "Clave no descubierta",
    "TIEMPO AGOTADO",
    `No descubriste la clave del Nivel ${game.level}. ` +
      "Debes repetir el mismo nivel." +
      (state.balance === 0
        ? " Tu saldo virtual llegó a 0."
        : ""),
    result.delta,
    "REINTENTAR NIVEL",
    "⏱️"
  );
}

function pick(index, button) {
  if (
    game.finished ||
    game.revealed.includes(index) ||
    game.timeLeft <= 0 ||
    gamePaused
  ) {
    return;
  }

  initAudio();

  game.attempts++;

  const digit = game.board[index];

  playPress();
  revealCell(index, digit);

  const attempts = $("#attempts");

  if (attempts) {
    attempts.textContent = game.attempts;
  }

  if (digit === game.target[game.progress]) {
    game.progress++;

    const status = $("#game-status");

    if (status) {
      status.textContent = "Correcto";
    }

    if (game.progress === game.target.length) {
      game.finished = true;
      stopTimer();
      crazyGameplayStop();

      playWin();

      const previousLevel = game.level;
      const result = applyLocalResult(true);
      const block = BLOCKS[LEVELS[previousLevel].block];

    
      if (previousLevel === MAX_LEVEL) {
        finishModal(
          "¡STRONGBOX COMPLETADO!",
          "💎 NIVEL 50 SUPERADO",
          "Descubriste la última clave y completaste " +
            "los 5 bloques. ¡Ahora puedes volver a empezar " +
            "para intentar superar tu récord!",
          result.delta,
          "VOLVER AL MENÚ",
          "💎"
        );
      } else if (previousLevel % 10 === 0) {
        finishModal(
          `¡Bloque ${block.title} completado!`,
          "🏆 BLOQUE COMPLETADO",
          `Has dominado los niveles ${block.from} al ${block.to}. ` +
            `Premio especial: +${coins(block.reward)}. ` +
            `El Nivel ${state.currentLevel} ya está disponible.`,
          result.delta,
          "SIGUIENTE NIVEL",
          "🏆"
        );
      } else {
        finishModal(
          `¡Nivel ${previousLevel} superado!`,
          "🔓 NIVEL DESBLOQUEADO",
          `Clave ${game.target} descubierta. ` +
            `Recompensa: +${coins(LEVELS[previousLevel].reward)}. ` +
            `Ahora está disponible el Nivel ${state.currentLevel}.`,
          result.delta,
          "SIGUIENTE NIVEL",
          "🪙"
        );
      }
    }
  } else {
    playWrong();

    const status = $("#game-status");

    if (status) {
      status.textContent = "Incorrecto";
    }

    button.classList.remove("revealed");
    button.classList.add("error-reveal");

    setTimeout(() => {
      if (!game.finished) {
        game.revealed = [];
        game.progress = 0;

        renderBoard();

        const currentStatus = $("#game-status");

        if (currentStatus) {
          currentStatus.textContent = "Buscando";
        }
      }
    }, 700);
  }
}

/* =========================
   REINICIO DE PROGRESO
========================= */

function resetProgress() {
  if (gameIsActive()) {
    openLeaveConfirm("home");
    return;
  }

  if (!confirm("¿Seguro que quieres borrar todo el progreso local?")) {
    return;
  }

  localStorage.removeItem(STORAGE_KEY);

  state = loadState();

  updateUI();
  show("home");
}

/* =========================
   EVENTOS DE LA INTERFAZ
========================= */

const playHomeButton = $("#play-home");

if (playHomeButton) {
  playHomeButton.onclick = () => {
    console.log("[STRONGBOX] PLAY clicado por el jugador");
    initAudio();

    startGame(state.currentLevel);
  };
}

document.querySelectorAll(".nav-btn").forEach((button) => {
  button.addEventListener("click", () => {
    navigateTo(button.dataset.view);
  });
});

document.querySelectorAll("[data-back]").forEach((button) => {
  button.addEventListener("click", () => {
    navigateTo("home");
  });
});

const modalAction = $("#modal-action");

if (modalAction) {
  modalAction.onclick = () => {
    const finishedLevel = game.level;

    closeModal();

    if (finishedLevel === MAX_LEVEL) {
      show("home");
      return;
    }

    startGame(state.currentLevel);
  };
}

const stayGameButton = $("#stay-game");

if (stayGameButton) {
  stayGameButton.onclick = closeLeaveConfirm;
}

const confirmLeaveButton = $("#confirm-leave");

if (confirmLeaveButton) {
  confirmLeaveButton.onclick = leaveGame;
}

const resetProgressButton = $("#reset-progress");

if (resetProgressButton) {
  resetProgressButton.onclick = resetProgress;
}

const resetProgressButton2 = $("#reset-progress-2");

if (resetProgressButton2) {
  resetProgressButton2.onclick = resetProgress;
}

/* =========================
   INICIO
========================= */

updateUI();

/* =========================
   CRAZYGAMES SDK (AISLADO)
========================= */

let crazySdkReady = false;
let crazyInitPromise = null;

function crazyGameplayStart() {
  const start = () => {
    try {
      const gameView = document.querySelector("#game");
      if (
        crazySdkReady &&
        gameView &&
        gameView.classList.contains("active") &&
        !game?.finished &&
        window.CrazyGames?.SDK?.game?.gameplayStart
      ) {
        window.CrazyGames.SDK.game.gameplayStart();
        console.log("[CRAZY] gameplayStart");
      }
    } catch (e) {
      console.warn("[CRAZY] gameplayStart ignorado:", e);
    }
  };

  if (crazySdkReady) {
    start();
  } else if (crazyInitPromise) {
    crazyInitPromise.then(start).catch(() => {});
  }
}

function crazyGameplayStop() {
  try {
    if (crazySdkReady && window.CrazyGames?.SDK?.game?.gameplayStop) {
      window.CrazyGames.SDK.game.gameplayStop();
      console.log("[CRAZY] gameplayStop");
    }
  } catch (e) {
    console.warn("[CRAZY] gameplayStop ignorado:", e);
  }
}

function crazyShowMidgameAd(source) {
  const request = () => {
    if (!crazySdkReady || !window.CrazyGames?.SDK?.ad?.requestAd) {
      console.log(`[CRAZY] ${source}: anuncio no disponible.`);
      return;
    }

    try {
    crazyGameplayStop();
    window.CrazyGames.SDK.ad.requestAd("midgame", {
      adStarted: () => {
        console.log("[CRAZY] anuncio iniciado");
        muteGameAudio();
      },
      adError: (error) => {
        console.warn("[CRAZY] error de anuncio:", error);
        resumeGameAudio();
      },
      adFinished: () => {
        console.log("[CRAZY] anuncio terminado");
        resumeGameAudio();
      }
      });
    } catch (e) {
      console.warn("[CRAZY] anuncio ignorado:", e);
      resumeGameAudio();
    }
  };

  if (crazySdkReady) {
    request();
  } else if (crazyInitPromise) {
    crazyInitPromise.then(request).catch(() => {});
  } else {
    console.log(`[CRAZY] ${source}: SDK aún no inicializado.`);
  }
}

async function initCrazyGames() {
  if (crazyInitPromise) return crazyInitPromise;

  crazyInitPromise = (async () => {
    try {
      if (!window.CrazyGames?.SDK) {
        console.warn("[CRAZY] SDK no disponible; STRONGBOX continúa.");
        return false;
      }

      await window.CrazyGames.SDK.init();
      crazySdkReady = true;
      console.log("[CRAZY] SDK inicializado.");

      const gameApi = window.CrazyGames.SDK.game;
      if (gameApi?.addSettingsChangeListener) {
        gameApi.addSettingsChangeListener((settings) => {
          if (settings?.muteAudio) muteGameAudio();
          else resumeGameAudio();
        });
      }

      if (gameApi?.loadingStop) gameApi.loadingStop();
      return true;
    } catch (e) {
      console.warn("[CRAZY] SDK falló; STRONGBOX continúa:", e);
      return false;
    }
  })();

  return crazyInitPromise;
}

// El SDK se inicia después de registrar TODOS los eventos del juego.
// Nunca se usa como requisito para que JUGAR abra el tablero.
initCrazyGames();
