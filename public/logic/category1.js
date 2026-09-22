/* Anon Wheel — multiplayer party game (HTML/CSS/JS)
   UI (placeholder): /public/ui/category1/  — replace markup/CSS/assets there.
   This file is logic only; keep element ids listed in /public/ui/CONTRACT.md.
   Architecture:
   - DATABASE: rooms + players (scoped by room code / ?room=ABC123)
   - REALTIME postgres_changes: everyone sees the same players in a room
   - BROADCAST: spin / questions / phase game events (not one giant shared player list)
*/

(() => {
  "use strict";

  const QUESTION_SECONDS = 3 * 60;
  const ANSWER_SECONDS = 60;
  const BUZZ_REVEAL_MS = 1200;
  const MAX_SKIPS = 3;
  /**
   * TARGET chain length ≈ this fraction of participants (floored), min 2.
   * Tunable without touching Mode 1. Examples with 0.6:
   * 3→2, 4→2, 5→3, 6→3, 7→4, 8→4, 9→5, 10→5
   */
  const TARGET_CHAIN_RATIO = 0.6;
  const TARGET_MIN_PLAYERS = 3;
  const TARGET_REVEAL_MS = 1600;

  const SUPABASE_URL = window.SUPABASE_CONFIG?.url || "";
  const SUPABASE_KEY = window.SUPABASE_CONFIG?.publishableKey || "";

  if (!window.supabase || !SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Supabase config missing. Check supabase-config.js and the Supabase CDN script.");
  }

  const supabaseClient = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY, {
    db: { schema: "category_one" },
  });
  const db = () => supabaseClient.schema("category_one");
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const screens = {
    home: $("#screen-home"),
    lobby: $("#screen-lobby"),
    questions: $("#screen-questions"),
    game: $("#screen-game"),
    target: $("#screen-target"),
    wildcard: $("#screen-wildcard"),
    finals: $("#screen-finals"),
    end: $("#screen-end"),
  };

  const els = {
    homeForm: $("#home-form"),
    playerName: $("#player-name"),
    roomCode: $("#room-code"),
    btnCreate: $("#btn-create"),
    btnJoin: $("#btn-join"),
    homeError: $("#home-error"),
    lobbyCode: $("#lobby-code"),
    lobbyRoomChip: $("#lobby-room-chip"),
    btnCopyLink: $("#btn-copy-link"),
    hostRoomCode: $("#host-room-code"),
    hostRoomCodeValue: $("#host-room-code-value"),
    playerList: $("#player-list"),
    lobbyStatus: $("#lobby-status"),
    btnStartQuestions: $("#btn-start-questions"),
    lobbyHint: $("#lobby-hint"),
    questionTimer: $("#question-timer"),
    questionForm: $("#question-form"),
    questionInput: $("#question-input"),
    questionFeedback: $("#question-feedback"),
    questionCount: $("#question-count"),
    finalsQuestionCount: $("#finals-question-count"),
    myQuestions: $("#my-questions"),
    ideasPanel: $("#ideas-panel"),
    ideasWheel: $("#ideas-wheel"),
    ideasReel: $("#ideas-reel"),
    scoreStrip: $("#score-strip"),
    wheelCanvas: $("#wheel-canvas"),
    wheelCaption: $("#wheel-caption"),
    actionPanel: $("#action-panel"),
    finalistAName: $("#finalist-a-name"),
    finalistBName: $("#finalist-b-name"),
    finalistAScore: $("#finalist-a-score"),
    finalistBScore: $("#finalist-b-score"),
    buzzerMain: $("#buzzer-main"),
    buzzerHint: $("#buzzer-hint"),
    finalsTimer: $("#finals-timer"),
    finalsQuestion: $("#finals-question"),
    finalsPhaseLabel: $("#finals-phase-label"),
    finalsControls: $("#finals-controls"),
    endTitle: $("#end-title"),
    endSub: $("#end-sub"),
    revealPanel: $("#reveal-panel"),
    revealList: $("#reveal-list"),
    standings: $("#standings"),
    btnPlayAgain: $("#btn-play-again"),
    kickedOverlay: $("#kicked-overlay"),
    toast: $("#toast"),
    btnLeaveRoom: $("#btn-leave-room"),
    btnLeaveLobby: $("#btn-leave-lobby"),
    confirmOverlay: $("#confirm-overlay"),
    confirmEyebrow: $("#confirm-eyebrow"),
    confirmTitle: $("#confirm-title"),
    confirmMessage: $("#confirm-message"),
    confirmCancel: $("#confirm-cancel"),
    confirmOk: $("#confirm-ok"),
    targetStage: $("#target-stage"),
    wildcardStage: $("#wildcard-stage"),
  };

  // Editorial palette — matches iso-theme guy accents
  const WHEEL_COLORS = [
    "#b83a3a",
    "#2f4f9b",
    "#4a7a45",
    "#2a7d7a",
    "#c4a35a",
    "#a85a6e",
    "#c46a3a",
    "#5a5a8a",
  ];

  /** @type {GameState} */
  let state = null;
  let me = { id: null, name: "", isHost: false };
  let sync = null;
  let questionTick = null;
  let answerDeadlineTick = null;
  let answerTimeoutTimer = null;
  let finalsTick = null;
  let wheelAngle = 0;
  let wheelSpinning = false;
  let lastSpinToken = -1;
  let wheelRaf = 0;
  /** After refresh/resume, land the wheel — don’t replay a full spin */
  let resumeSkipSpinAnim = false;
  let revealCurtainPlayed = false;
  let myLocalQuestions = [];
  let toastTimer = null;
  /** Local-only: own WILDCARD ballot (choices are never shown to others). */
  let myWildcardVote = null;

  /** Circular idea reel for the question pool screen */
  const IDEA_BANK = [
    // Salacious
    { text: "Who here would you most want seven minutes alone with?", vibe: "salacious" },
    { text: "What’s the filthiest compliment you’ve ever wanted to give someone in this room?", vibe: "salacious" },
    { text: "Who has the most dangerous flirting energy here?", vibe: "salacious" },
    { text: "Confess a crush you’ve taken to the grave.", vibe: "salacious" },
    { text: "Who would you steal for one shameless night with zero consequences?", vibe: "salacious" },
    { text: "What’s your hottest unpopular opinion about dating?", vibe: "salacious" },
    { text: "Who here would ruin your self-control the fastest?", vibe: "salacious" },
    { text: "Describe your ideal reckless night without naming names.", vibe: "salacious" },
    { text: "Who would you most want to make jealous?", vibe: "salacious" },
    { text: "What’s the most scandalous thing you’ve done that nobody here knows?", vibe: "salacious" },
    { text: "Who looks like trouble in the best way?", vibe: "salacious" },
    { text: "What’s a fantasy you’ve never said out loud?", vibe: "salacious" },
    { text: "Who would survive longest in a temptation challenge?", vibe: "salacious" },
    { text: "Rate everyone’s kissing potential — then explain the ranking.", vibe: "salacious" },
    { text: "Who would you text at 1am if you were feeling bold?", vibe: "salacious" },
    { text: "What’s the sexiest quality someone in this room has?", vibe: "salacious" },
    { text: "Who would you want to slow-dance with in a near-empty bar?", vibe: "salacious" },
    { text: "What’s a soft launch you’d never soft-launch?", vibe: "salacious" },
    { text: "Who here do you clock as a secret menace?", vibe: "salacious" },
    { text: "If tonight ended badly in the best way, who started it?", vibe: "salacious" },
    // Philosophical
    { text: "If you could erase one memory, would you?", vibe: "philosophical" },
    { text: "What belief did you abandon that still haunts you?", vibe: "philosophical" },
    { text: "Is loyalty a virtue or a cage?", vibe: "philosophical" },
    { text: "What are you most afraid people are right about?", vibe: "philosophical" },
    { text: "If your life were a question, what would it be asking?", vibe: "philosophical" },
    { text: "Do you believe in soulmates, or just good timing?", vibe: "philosophical" },
    { text: "What truth do you keep postponing?", vibe: "philosophical" },
    { text: "Would you rather be loved or understood?", vibe: "philosophical" },
    { text: "What’s a kindness you still regret not giving?", vibe: "philosophical" },
    { text: "If nobody would remember this conversation, what would you admit?", vibe: "philosophical" },
    { text: "What does ‘home’ mean when it isn’t a place?", vibe: "philosophical" },
    { text: "Are you becoming who you hoped, or who was convenient?", vibe: "philosophical" },
    { text: "What would your younger self refuse to forgive you for?", vibe: "philosophical" },
    { text: "Is silence ever the braver answer?", vibe: "philosophical" },
    { text: "What are you performing for people who aren’t watching?", vibe: "philosophical" },
    { text: "If happiness had a cost, what have you already paid?", vibe: "philosophical" },
    { text: "Which version of yourself are you most dishonest about?", vibe: "philosophical" },
    { text: "What would you do if shame stopped working on you?", vibe: "philosophical" },
    { text: "Is forgiveness for them, or for the story you need to exit?", vibe: "philosophical" },
    { text: "What question are you tired of answering about yourself?", vibe: "philosophical" },
  ];

  const IDEA_REEL_SIZE = 14;
  const IDEA_VISIBLE = 5; // center ±2
  const IDEA_ITEM_H = 44;
  let ideaReel = [];
  let ideaReserve = [];
  let ideaOffset = 0; // continuous scroll offset in item units
  let ideasWired = false;
  let ideasDrag = null;
  /** Idea filled into the box but not submitted yet — returns to the reel if abandoned */
  let pendingIdea = null;
  let pendingReplacementId = null;
  /** null = all · "salacious" | "philosophical" */
  let ideaFilter = null;

  const SPIN_MS = 5200;

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /** Stable order so every client draws the same wheel segments */
  function wheelPlayers(st = state) {
    return activePlayers(st).slice().sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Deterministic 0..1 from spin token (+ salt) so all browsers match */
  function spinUnit(token, salt = 0) {
    let x = (Math.imul(token + 1, 2654435761) ^ Math.imul(salt + 1, 1597334677)) >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 2246822519) >>> 0;
    x ^= x >>> 13;
    x = Math.imul(x, 3266489917) >>> 0;
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  }

  function easeOutQuint(t) {
    return 1 - Math.pow(1 - t, 5);
  }

  /** Segment currently under the top pointer */
  function indexUnderPointer(players, angleRad) {
    const n = Math.max(players.length, 1);
    const arc = (Math.PI * 2) / n;
    // Pointer at -PI/2; invert drawWheel mapping
    let raw = (-Math.PI / 2 - angleRad) / arc;
    raw = ((raw % n) + n) % n;
    return Math.min(n - 1, raw | 0);
  }

  function sessionKey(code) {
    return `c1-session-${String(code || "").toUpperCase()}`;
  }

  function reclaimKey(code) {
    return `c1-reclaim-${String(code || "").toUpperCase()}`;
  }

  const ACTIVE_ROOM_KEY = "c1-active-room";

  function saveSession() {
    if (!me?.id || !state?.roomCode) return;
    try {
      const payload = {
        id: me.id,
        name: me.name,
        isHost: me.isHost,
        roomCode: state.roomCode,
        savedAt: Date.now(),
      };
      localStorage.setItem(sessionKey(state.roomCode), JSON.stringify(payload));
      localStorage.setItem(ACTIVE_ROOM_KEY, String(state.roomCode).toUpperCase());
    } catch (_) {}
  }

  function loadSession(code) {
    try {
      const raw = localStorage.getItem(sessionKey(code));
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function loadActiveRoomCode() {
    try {
      return localStorage.getItem(ACTIVE_ROOM_KEY) || null;
    } catch (_) {
      return null;
    }
  }

  function clearSession(code) {
    try {
      localStorage.removeItem(sessionKey(code));
      const active = localStorage.getItem(ACTIVE_ROOM_KEY);
      if (active && String(active).toUpperCase() === String(code || "").toUpperCase()) {
        localStorage.removeItem(ACTIVE_ROOM_KEY);
      }
    } catch (_) {}
  }

  /** Same device + same name can reclaim progress after Leave room. */
  function saveReclaim(code, payload) {
    if (!code || !payload?.id || !payload?.name) return;
    try {
      localStorage.setItem(
        reclaimKey(code),
        JSON.stringify({ ...payload, savedAt: Date.now() })
      );
    } catch (_) {}
  }

  function loadReclaim(code) {
    try {
      const raw = localStorage.getItem(reclaimKey(code));
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function clearReclaim(code) {
    try {
      localStorage.removeItem(reclaimKey(code));
    } catch (_) {}
  }

  function snapshotForReclaim(playerId = me.id) {
    const p = getPlayer(playerId);
    return {
      id: playerId,
      name: (p?.name || me.name || "").trim(),
      answered: p?.answered ?? 0,
      skips: p?.skips ?? 0,
      selections: getSelections(p) || 0,
      lateJoin: !!p?.lateJoin,
      kicked: !!p?.kicked,
      wildcardEligible: !!p?.wildcardEligible,
      wildcardUsed: !!p?.wildcardUsed,
      joinedAt: p?.joinedAt || Date.now(),
    };
  }

  function restoreMyLocalQuestionsFromState() {
    if (!me?.id || !state?.questions) {
      myLocalQuestions = [];
      return;
    }
    myLocalQuestions = state.questions
      .filter((q) => q.authorId === me.id)
      .map((q) => ({ text: q.text }));
  }

  /** Host timers die on refresh — re-arm anything that was mid-flight */
  function recoverHostProgress() {
    if (!me.isHost || !state) return;

    if (state.phase === "spinning" && state.currentPlayerId) {
      const token = state.spinToken;
      const playerId = state.currentPlayerId;
      // After a refresh, snap the wheel and open answering — don’t wait out a full spin
      setTimeout(() => {
        if (!state || !me.isHost) return;
        if (state.phase !== "spinning") return;
        if (state.spinToken !== token) return;
        if (state.currentPlayerId !== playerId) return;
        openAnsweringPhase({ freshDeadline: !state.answerEndsAt });
      }, 400);
    }

    if (state.phase === "answering") {
      armAnswerTimeout();
    }

    if (state.phase === "wildcard" && state.wildcard) {
      recoverWildcardProgress();
      return;
    }

    if (!isTargetPhase() || !state.target) return;
    const stage = state.target.stage;
    if (stage === "reveal_q") {
      scheduleTargetReveal();
    } else if (stage === "reveal_target") {
      clearTargetRevealTimer();
      targetRevealTimer = setTimeout(() => {
        targetRevealTimer = null;
        if (!me.isHost || !state?.target) return;
        if (state.target.stage !== "reveal_target") return;
        state.target.stage = "choose";
        publish();
      }, 800);
    } else if (stage === "continue") {
      clearTargetRevealTimer();
      targetRevealTimer = setTimeout(() => {
        targetRevealTimer = null;
        if (!me.isHost || !state?.target) return;
        if (state.target.stage !== "continue") return;
        const next = state.target.chainIndex + 1;
        if (next >= (state.target.chain?.length || 0)) {
          finishTargetSuccess();
          return;
        }
        state.target.chainIndex = next;
        state.target.stage = "reveal_q";
        publish();
        scheduleTargetReveal();
      }, 1000);
    } else if (stage === "broken" || stage === "complete") {
      clearTargetRevealTimer();
      targetRevealTimer = setTimeout(() => {
        targetRevealTimer = null;
        if (me.isHost) endTargetAndResumeMode1();
      }, 1200);
    }
  }

  function wheelAngleForIndex(players, targetIndex, token = 0) {
    const n = Math.max(players.length, 1);
    const arc = (Math.PI * 2) / n;
    const idx = Math.max(0, Math.min(n - 1, targetIndex | 0));
    const jitter = (spinUnit(token, 3) - 0.5) * arc * 0.55;
    const targetCenter = idx * arc + arc / 2 + jitter;
    return -Math.PI / 2 - targetCenter;
  }

  function snapWheelToTarget(players) {
    if (!state) return;
    const alive = players || wheelPlayers();
    if (wheelRaf) {
      cancelAnimationFrame(wheelRaf);
      wheelRaf = 0;
    }
    wheelSpinning = false;
    const idx =
      typeof state.spinTargetIndex === "number" ? state.spinTargetIndex : 0;
    const token = state.spinToken || 0;
    wheelAngle = wheelAngleForIndex(alive, idx, token);
    lastSpinToken = token;
  }

  /** Redraw the game wheel after layout/resume so the canvas isn’t blank. */
  function paintGameWheel(players, highlightIndex = -1) {
    const alive = players || wheelPlayers();
    requestAnimationFrame(() => {
      if (!state) return;
      if (
        state.phase !== "spinning" &&
        state.phase !== "answering" &&
        state.phase !== "confirm"
      ) {
        return;
      }
      drawWheel(alive, wheelAngle, highlightIndex);
    });
  }

  function clearAnswerTimers() {
    if (answerTimeoutTimer) {
      clearTimeout(answerTimeoutTimer);
      answerTimeoutTimer = null;
    }
    if (answerDeadlineTick) {
      clearInterval(answerDeadlineTick);
      answerDeadlineTick = null;
    }
  }

  /** Move spinning → answering and start the 60s respond clock (host). */
  function openAnsweringPhase({ freshDeadline = true } = {}) {
    if (!state) return;
    state.phase = "answering";
    if (freshDeadline || !state.answerEndsAt) {
      state.answerEndsAt = Date.now() + ANSWER_SECONDS * 1000;
    }
    publish();
    armAnswerTimeout();
  }

  /** Host-only: fire answerTimeout when the respond window ends. */
  function armAnswerTimeout() {
    clearTimeout(answerTimeoutTimer);
    answerTimeoutTimer = null;
    if (!me.isHost || !state || state.phase !== "answering") return;
    if (!state.answerEndsAt) {
      state.answerEndsAt = Date.now() + ANSWER_SECONDS * 1000;
    }
    const delay = Math.max(0, state.answerEndsAt - Date.now());
    answerTimeoutTimer = setTimeout(() => {
      answerTimeoutTimer = null;
      if (!me.isHost || !state || state.phase !== "answering") return;
      handleAction({ type: "answerTimeout" });
    }, delay + 40);
  }

  /**
   * Timed-out player gets a skip; the same question is spun to someone else.
   */
  function passQuestionOnTimeout() {
    const player = getPlayer(state.currentPlayerId);
    const q = state.questions.find((x) => x.id === state.currentQuestionId);
    if (!player || !q) return;

    clearAnswerTimers();
    state.answerEndsAt = null;

    player.skips += 1;
    // Question stays in the pool — someone else will face it
    if (player.skips >= MAX_SKIPS && canEliminatePlayer(player)) {
      markEliminatedBySkip(player);
    }
    logQuestionOutcome({ question: q, player, pot: "wheel", outcome: "skipped" });
    toast(`${player.name} ran out of time — skipped. Passing the question…`);

    const timedOutId = player.id;
    state.currentPlayerId = null;
    // keep currentQuestionId for reassign

    if (shouldGoToFinals()) {
      state.currentQuestionId = null;
      continueMode1Flow();
      return;
    }

    reassignSameQuestion(q, timedOutId);
  }

  /** Wheel a different active player onto the same unanswered question. */
  function reassignSameQuestion(q, excludeId) {
    const alive = wheelPlayers().filter((p) => p.id !== excludeId);
    if (!alive.length || !q || q.used) {
      state.currentQuestionId = null;
      continueMode1Flow();
      return;
    }

    const player = pickFairWheelPlayer(alive);
    if (!player) {
      state.currentQuestionId = null;
      continueMode1Flow();
      return;
    }
    setSelections(player, getSelections(player) + 1);

    const allAlive = wheelPlayers();
    const targetIndex = Math.max(
      0,
      allAlive.findIndex((p) => p.id === player.id)
    );

    state.phase = "spinning";
    state.spinTargetIndex = targetIndex;
    state.spinToken += 1;
    state.currentPlayerId = player.id;
    state.currentQuestionId = q.id;
    state.answerEndsAt = null;
    publish();

    const token = state.spinToken;
    const playerId = player.id;
    setTimeout(() => {
      if (!state || state.phase !== "spinning") return;
      if (state.spinToken !== token) return;
      if (state.currentPlayerId !== playerId) return;
      openAnsweringPhase({ freshDeadline: true });
    }, SPIN_MS + 180);
  }

  // ---------- utils ----------
  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function roomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 6; i++) out += chars[(Math.random() * chars.length) | 0];
    return out;
  }

  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, 2600);
  }

  let confirmResolver = null;

  function closeConfirm(result) {
    if (els.confirmOverlay) els.confirmOverlay.hidden = true;
    const resolve = confirmResolver;
    confirmResolver = null;
    if (resolve) resolve(!!result);
  }

  /**
   * In-game confirm — cream card, ink border, matches Icebreaker chrome.
   * @returns {Promise<boolean>}
   */
  function showConfirm({
    eyebrow = "Hold up",
    title = "Are you sure?",
    message = "",
    cancelLabel = "Stay",
    okLabel = "Do it",
    danger = true,
  } = {}) {
    if (!els.confirmOverlay) {
      return Promise.resolve(window.confirm(message || title));
    }
    // Replace any open dialog
    if (confirmResolver) closeConfirm(false);

    if (els.confirmEyebrow) els.confirmEyebrow.textContent = eyebrow;
    if (els.confirmTitle) els.confirmTitle.textContent = title;
    if (els.confirmMessage) els.confirmMessage.textContent = message;
    if (els.confirmCancel) els.confirmCancel.textContent = cancelLabel;
    if (els.confirmOk) {
      els.confirmOk.textContent = okLabel;
      els.confirmOk.classList.toggle("btn-danger", !!danger);
      els.confirmOk.classList.toggle("btn-primary", !danger);
    }
    els.confirmOverlay.hidden = false;
    // Retrigger pop animation
    const card = els.confirmOverlay.querySelector(".confirm-card");
    if (card) {
      card.style.animation = "none";
      // force reflow
      void card.offsetWidth;
      card.style.animation = "";
    }
    els.confirmCancel?.focus();

    return new Promise((resolve) => {
      confirmResolver = resolve;
    });
  }

  function setHomeError(msg) {
    if (!msg) {
      els.homeError.hidden = true;
      els.homeError.textContent = "";
      return;
    }
    els.homeError.hidden = false;
    els.homeError.textContent = msg;
  }

  function handleNameTaken(message) {
    const msg =
      message || "That name is already taken in this room. Pick another.";
    const code = sync?.code || state?.roomCode || els.roomCode?.value?.trim();
    try {
      sync?.destroy?.();
    } catch (_) {}
    sync = null;
    state = null;
    if (code) clearSession(code);
    setHomeError(msg);
    showScreen("home");
    updateHostRoomCode();
    if (code && typeof enableInviteHome === "function") enableInviteHome(code);
    toast(msg);
    if (els.btnJoin) els.btnJoin.disabled = false;
  }

  function handleKickedOut(message) {
    const msg = message || "The host removed you from the room.";
    const code = sync?.code || state?.roomCode;
    try {
      sync?.destroy?.();
    } catch (_) {}
    sync = null;
    state = null;
    me = { id: null, name: "", isHost: false };
    if (code) {
      clearSession(code);
      clearReclaim(code);
    }
    resetToHomeUi();
    setHomeError(msg);
    toast(msg);
  }

  function handleQuestionRejected(message) {
    const msg = message || "That question is already in the pool.";
    // Drop the ghost local copy — pool is source of truth
    restoreMyLocalQuestionsFromState();
    if (els.questionFeedback) {
      els.questionFeedback.hidden = false;
      els.questionFeedback.textContent = msg;
      setTimeout(() => {
        if (els.questionFeedback) els.questionFeedback.hidden = true;
      }, 2200);
    }
    toast(msg);
    if (state?.phase === "questions") renderQuestions();
  }

  function formatTime(totalSec) {
    const s = Math.max(0, Math.ceil(totalSec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  function activePlayers(st = state) {
    return (st?.players || []).filter((p) => !p.kicked);
  }

  /** Players who were in for question-writing (excludes mid-game joiners). */
  function poolPlayers(st = state) {
    return activePlayers(st).filter((p) => !p.lateJoin);
  }

  function canSubmitQuestions(playerId = me.id, st = state) {
    if (!st || st.phase !== "questions" || st.questionsLocked) return false;
    const p = getPlayer(playerId, st);
    return !!(p && !p.kicked && !p.lateJoin);
  }

  function minimumQuestionsRequired(st = state) {
    if (st?.poolMinQuestions) return st.poolMinQuestions;
    return Math.max(2, poolPlayers(st).length || activePlayers(st).length) * 5;
  }

  function poolReady(st = state) {
    return (st?.questions || []).length >= minimumQuestionsRequired(st);
  }

  /** Collapse casing / spacing / trailing ?!. so “Same Q?” matches “same q”. */
  function normalizeQuestionKey(text) {
    return String(text || "")
      .trim()
      .toLowerCase()
      .replace(/[?!.,;:]+$/g, "")
      .replace(/\s+/g, " ");
  }

  function questionAlreadyInPool(text, st = state) {
    const key = normalizeQuestionKey(text);
    if (!key) return false;
    return (st?.questions || []).some(
      (q) => normalizeQuestionKey(q.text) === key
    );
  }

  /** Normal-phase questions still remaining */
  function normalQuestions(st = state) {
    return (st?.questions || []).filter((q) => !q.used && !q.reservedForRapidFire);
  }

  /** Reserved rapid-fire bank (same shared pool) */
  function rapidFireQuestions(st = state) {
    return (st?.questions || []).filter((q) => q.reservedForRapidFire && !q.used);
  }

  function getSelections(player, st = state) {
    if (!player) return 0;
    if (st?.selectionsById && player.id in st.selectionsById) {
      return st.selectionsById[player.id] || 0;
    }
    return player.selections || 0;
  }

  function setSelections(player, value) {
    if (!player || !state) return;
    player.selections = value;
    if (!state.selectionsById) state.selectionsById = {};
    state.selectionsById[player.id] = value;
  }

  function lateJoinIdSet(st = state) {
    return new Set(st?.lateJoinIds || []);
  }

  function markLateJoin(playerId, st = state) {
    if (!st || !playerId) return;
    if (!st.lateJoinIds) st.lateJoinIds = [];
    if (!st.lateJoinIds.includes(playerId)) st.lateJoinIds.push(playerId);
    const p = getPlayer(playerId, st);
    if (p) p.lateJoin = true;
  }

  function hydratePlayerStats(players, st = state) {
    const map = st?.selectionsById || {};
    const wcMap = st?.wildcardById || {};
    const prevById = Object.fromEntries((st?.players || []).map((p) => [p.id, p]));
    // Prefer the live room roster so lateJoin survives game-only broadcasts
    const liveById = Object.fromEntries((state?.players || []).map((p) => [p.id, p]));
    const lateIds = lateJoinIdSet(st);
    return (players || []).map((p) => {
      const prev = prevById[p.id] || liveById[p.id];
      const lateJoin = !!(
        p.lateJoin ||
        prev?.lateJoin ||
        lateIds.has(p.id)
      );
      const wc = wcMap[p.id] || {};
      return {
        ...p,
        selections: map[p.id] ?? p.selections ?? 0,
        skips: p.skips ?? 0,
        answered: p.answered ?? 0,
        lateJoin,
        joinedAt: p.joinedAt ?? prev?.joinedAt ?? 0,
        isHost: !!(st?.hostId ? p.id === st.hostId : p.isHost || prev?.isHost),
        wildcardEligible: !!(
          wc.eligible ??
          p.wildcardEligible ??
          prev?.wildcardEligible ??
          false
        ),
        wildcardUsed: !!(
          wc.used ??
          p.wildcardUsed ??
          prev?.wildcardUsed ??
          false
        ),
      };
    });
  }

  function getPlayer(id, st = state) {
    return (st?.players || []).find((p) => p.id === id);
  }

  /** Next host = earliest joiner still in the room (excluding someone leaving). */
  function nextHostCandidate(excludeId, st = state) {
    return activePlayers(st)
      .filter((p) => p.id !== excludeId)
      .slice()
      .sort((a, b) => {
        const aj = a.joinedAt || 0;
        const bj = b.joinedAt || 0;
        if (aj !== bj) return aj - bj;
        return String(a.id).localeCompare(String(b.id));
      })[0] || null;
  }

  function assignHost(newHostId, st = state) {
    if (!st || !newHostId) return;
    st.hostId = newHostId;
    (st.players || []).forEach((p) => {
      p.isHost = p.id === newHostId;
    });
  }

  function removePlayerFromState(playerId, st = state) {
    if (!st || !playerId) return;
    st.players = (st.players || []).filter((p) => p.id !== playerId);
    if (st.selectionsById && playerId in st.selectionsById) {
      delete st.selectionsById[playerId];
    }
    if (st.wildcardById && playerId in st.wildcardById) {
      delete st.wildcardById[playerId];
    }
    if (Array.isArray(st.lateJoinIds)) {
      st.lateJoinIds = st.lateJoinIds.filter((id) => id !== playerId);
    }
    if (Array.isArray(st.wildcardQueue)) {
      st.wildcardQueue = st.wildcardQueue.filter((id) => id !== playerId);
    }
  }

  /** Keep local me/sync flags aligned with state.hostId (host handoff). */
  function syncHostRole() {
    if (!state || !me?.id) return;
    const shouldBeHost = state.hostId === me.id;
    if (shouldBeHost && !me.isHost) {
      me.isHost = true;
      if (sync) sync.isHost = true;
      saveSession();
      recoverHostProgress();
      toast("You’re the host now — the room keeps going");
      updateHostRoomCode();
    } else if (!shouldBeHost && me.isHost) {
      me.isHost = false;
      if (sync) sync.isHost = false;
      saveSession();
      updateHostRoomCode();
    } else if (shouldBeHost && sync && !sync.isHost) {
      sync.isHost = true;
    }
  }

  /**
   * If the leaver was mid-turn, advance so the room doesn’t freeze.
   * Call while still acting as host, after removing them.
   */
  function repairTurnAfterLeave(leftId) {
    if (!state || !leftId) return;
    if (state.phase === "finals" && state.finals) {
      const f = state.finals;
      if (f.aId === leftId || f.bId === leftId) {
        // One finalist left — end match in their opponent’s favor if possible
        const otherId = f.aId === leftId ? f.bId : f.aId;
        const other = getPlayer(otherId);
        if (other && !other.kicked) {
          state.winnerId = otherId;
          state.revealForId = pickAuthorRevealId();
          state.phase = "end";
          state.finals = null;
        }
      } else if (f.buzzedBy === leftId) {
        f.buzzedBy = null;
        f.phase = "open";
      }
      return;
    }
    if (
      (state.phase === "spinning" ||
        state.phase === "answering" ||
        state.phase === "confirm") &&
      state.currentPlayerId === leftId
    ) {
      state.currentPlayerId = null;
      state.currentQuestionId = null;
      continueMode1Flow();
      return;
    }
    if (isWildcardPhase()) {
      if (abortWildcardForLeave(leftId)) {
        continueMode1Flow();
        return;
      }
      purgeWildcardVoter(leftId);
      publish();
    }
  }

  function inviteUrl(code) {
    const url = new URL(location.href);
    url.searchParams.set("room", code);
    url.searchParams.delete("host");
    url.searchParams.delete("local");
    return url.toString();
  }

  function mapDbPlayer(row) {
    return {
      id: row.id,
      name: row.name,
      answered: row.answered ?? 0,
      skips: row.skips ?? 0,
      selections: 0,
      kicked: !!row.kicked,
      isHost: !!row.is_host,
      joinedAt: row.created_at ? Date.parse(row.created_at) || 0 : 0,
    };
  }

  function gameOnly(st) {
    const {
      phase,
      roomCode,
      hostId,
      questions,
      questionEndsAt,
      answerEndsAt,
      currentPlayerId,
      currentQuestionId,
      spinToken,
      spinTargetIndex,
      selectionsById,
      rapidFireReserve,
      startingPlayerCount,
      poolMinQuestions,
      questionsLocked,
      lateJoinIds,
      finals,
      target,
      wildcard,
      wildcardQueue,
      wildcardById,
      winnerId,
      revealForId,
      finalsAnswerScores,
      _finalistAId,
      _finalistBId,
    } = st;
    return {
      phase,
      roomCode,
      hostId,
      questions,
      questionEndsAt,
      answerEndsAt: answerEndsAt || null,
      currentPlayerId,
      currentQuestionId,
      spinToken,
      spinTargetIndex,
      selectionsById: selectionsById || {},
      rapidFireReserve: rapidFireReserve || 0,
      startingPlayerCount: startingPlayerCount || 0,
      poolMinQuestions: poolMinQuestions || 0,
      questionsLocked: !!questionsLocked,
      lateJoinIds: Array.isArray(lateJoinIds) ? lateJoinIds : [],
      finals,
      target: target || null,
      wildcard: wildcard
        ? {
            playerId: wildcard.playerId,
            stage: wildcard.stage,
            confession: wildcard.confession || null,
            voterIds: Array.isArray(wildcard.voterIds) ? wildcard.voterIds : null,
            // Keep ballots in authoritative state so host realtime echoes
            // don't wipe the tally. UI never reveals who voted which way.
            votes: wildcard.votes || {},
            votedCount: Object.keys(wildcard.votes || {}).length,
            result: wildcard.result || null,
            yesCount: wildcard.yesCount || 0,
            noCount: wildcard.noCount || 0,
          }
        : null,
      wildcardQueue: Array.isArray(wildcardQueue) ? wildcardQueue : [],
      wildcardById: wildcardById || {},
      winnerId,
      revealForId,
      finalsAnswerScores: finalsAnswerScores || null,
      _finalistAId,
      _finalistBId,
    };
  }

  function mergeGameIntoState(game, players) {
    const base = createState(game.roomCode || "------", players[0] || {
      id: "tmp",
      name: "…",
      answered: 0,
      skips: 0,
      selections: 0,
      kicked: false,
      isHost: false,
    });
    const merged = { ...base, ...game };
    merged.players = hydratePlayerStats(players, merged);
    return merged;
  }

  // ---------- state factory ----------
  function createState(code, hostPlayer) {
    return {
      phase: "lobby",
      roomCode: code,
      hostId: hostPlayer.id,
      players: [{ ...hostPlayer, joinedAt: hostPlayer.joinedAt || Date.now() }],
      questions: [],
      questionEndsAt: null,
      answerEndsAt: null,
      currentPlayerId: null,
      currentQuestionId: null,
      spinToken: 0,
      spinTargetIndex: 0,
      selectionsById: {},
      rapidFireReserve: 0,
      startingPlayerCount: 0,
      poolMinQuestions: 0,
      questionsLocked: false,
      lateJoinIds: [],
      finals: null,
      target: null,
      wildcard: null,
      wildcardQueue: [],
      wildcardById: {},
      winnerId: null,
      revealForId: null,
      finalsAnswerScores: null,
    };
  }

  // ---------- sync: Supabase (rooms/players DB + Broadcast events) ----------
  class SupabaseSync {
    constructor(code, isHost) {
      this.code = code;
      this.isHost = isHost;
      this.channel = null;
      this.onState = null;
      this.onAction = null;
      this.onPlayers = null;
      this._writing = false;
      this._pendingGame = null;
    }

    async ensureRoom(hostPlayer, { fresh = true } = {}) {
      if (!fresh) {
        const existing = await this.fetchRoom();
        if (existing) return existing;
      }
      const { error } = await db().from("rooms").upsert({
        code: this.code,
        host_id: hostPlayer.id,
        phase: "lobby",
        game: gameOnly(createState(this.code, hostPlayer)),
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message || "Could not create room.");
      return null;
    }

    /** Step 7 — add a player into this room only */
    async addPlayer(player) {
      const { error } = await db().from("players").upsert(
        {
          id: player.id,
          room_id: this.code,
          name: player.name,
          answered: player.answered ?? 0,
          skips: player.skips ?? 0,
          kicked: player.kicked ?? false,
          is_host: player.isHost ?? false,
        },
        { onConflict: "id" }
      );
      if (error) throw new Error(error.message || "Could not add player.");
      console.log("Player added!", player.name, "→ room", this.code);
    }

    async deletePlayer(playerId) {
      if (!playerId) return;
      const { error } = await db()
        .from("players")
        .delete()
        .eq("id", playerId)
        .eq("room_id", this.code);
      if (error) console.error("Failed to remove player:", error);
    }

    async setRoomHost(hostId) {
      if (!hostId) return;
      const { error } = await db()
        .from("rooms")
        .update({ host_id: hostId, updated_at: new Date().toISOString() })
        .eq("code", this.code);
      if (error) console.error("Failed to update room host:", error);
    }

    async fetchPlayers() {
      const { data, error } = await db()
        .from("players")
        .select("*")
        .eq("room_id", this.code)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message || "Could not load players.");
      return (data || []).map(mapDbPlayer);
    }

    async fetchRoom() {
      const { data, error } = await db()
        .from("rooms")
        .select("*")
        .eq("code", this.code)
        .maybeSingle();
      if (error) throw new Error(error.message || "Could not load room.");
      return data;
    }

    async start({ hostPlayer = null, joinPlayer = null, resume = false } = {}) {
      if (!supabaseClient) {
        throw new Error("Supabase client failed to load. Check your connection and config.");
      }

      if (this.isHost && hostPlayer) {
        if (resume) {
          const room = await this.ensureRoom(hostPlayer, { fresh: false });
          const players = await this.fetchPlayers();
          const stillHost = room?.host_id === hostPlayer.id;
          if (!players.some((p) => p.id === hostPlayer.id) && stillHost) {
            await this.addPlayer(hostPlayer);
          }
          if (room) {
            const game = room.game && typeof room.game === "object" ? room.game : {};
            const latestPlayers = await this.fetchPlayers();
            this.onState?.(
              mergeGameIntoState(
                {
                  ...game,
                  roomCode: this.code,
                  hostId: room.host_id || hostPlayer.id,
                  phase: room.phase || game.phase || "lobby",
                },
                latestPlayers
              )
            );
          }
        } else {
          await this.ensureRoom(hostPlayer, { fresh: true });
          await this.addPlayer(hostPlayer);
        }
      } else {
        const room = await this.fetchRoom();
        if (!room) {
          throw new Error("Room not found. Check the code / link (?room=ABC123).");
        }
        const players = await this.fetchPlayers();
        const game = room.game && typeof room.game === "object" ? room.game : {};
        this.onState?.(
          mergeGameIntoState(
            {
              ...game,
              roomCode: this.code,
              hostId: room.host_id,
              phase: room.phase || game.phase || "lobby",
            },
            players
          )
        );

        if (joinPlayer) {
          const phaseNow = room.phase || game.phase || "lobby";
          const alreadyIn = players.some((p) => p.id === joinPlayer.id);
          if (
            !resume &&
            !alreadyIn &&
            (phaseNow === "target_setup" || phaseNow === "target_active")
          ) {
            throw new Error(
              "TARGET is currently in progress. You can join when the round is over."
            );
          }
          const taken = players.some(
            (p) =>
              p.id !== joinPlayer.id &&
              String(p.name || "").toLowerCase() ===
                String(joinPlayer.name || "").trim().toLowerCase()
          );
          if (taken) {
            throw new Error(
              "That name is already taken in this room. Pick another."
            );
          }
          if (!alreadyIn) {
            await this.addPlayer(joinPlayer);
          }
        }
      }

      // Step 8 — listen for player inserts/updates in THIS room only
      this.channel = supabaseClient.channel(`room:${this.code}`, {
        config: { broadcast: { self: false } },
      });

      this.channel
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "category_one",
            table: "players",
            filter: `room_id=eq.${this.code}`,
          },
          async (payload) => {
            console.log("Players change:", payload.eventType, payload.new || payload.old);
            try {
              const players = await this.fetchPlayers();
              this.onPlayers?.(players);
            } catch (err) {
              console.error(err);
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "category_one",
            table: "rooms",
            filter: `code=eq.${this.code}`,
          },
          (payload) => {
            const row = payload.new;
            if (!row) return;
            const game = row.game && typeof row.game === "object" ? row.game : {};
            this.onState?.(
              mergeGameIntoState(
                {
                  ...game,
                  roomCode: this.code,
                  hostId: row.host_id,
                  phase: row.phase || game.phase,
                },
                state?.players || []
              )
            );
          }
        )
        .on("broadcast", { event: "game" }, ({ payload }) => {
          // Fast path: spin / phase / questions land for every browser
          if (!payload) return;
          this.onState?.(
            mergeGameIntoState(payload, state?.players || [])
          );
        })
        .on("broadcast", { event: "action" }, ({ payload }) => {
          if (this.isHost && payload) this.onAction?.(payload);
        })
        .on("broadcast", { event: "joinRejected" }, ({ payload }) => {
          if (payload?.playerId === me.id) {
            handleNameTaken(payload.message);
          }
        })
        .on("broadcast", { event: "questionRejected" }, ({ payload }) => {
          if (payload?.playerId === me.id) {
            handleQuestionRejected(payload.message);
          }
        })
        .on("broadcast", { event: "playerKicked" }, ({ payload }) => {
          if (payload?.playerId === me.id) {
            handleKickedOut(payload.message);
          }
        })
        .on("broadcast", { event: "hostHandoff" }, ({ payload }) => {
          if (!payload?.newHostId || !state) return;
          if (payload.leavingId) removePlayerFromState(payload.leavingId);
          assignHost(payload.newHostId);
          if (payload.leavingName) toast(`${payload.leavingName} left`);
          syncHostRole();
          render();
        });

      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("Supabase realtime timed out.")), 12000);
        this.channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            clearTimeout(t);
            resolve();
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            clearTimeout(t);
            reject(new Error("Supabase realtime channel failed."));
          }
        });
      });

      // Host: seed fresh lobby only for brand-new rooms.
      // On resume, re-load the persisted room snapshot — never createState()
      // or a refresh will dump everyone back to questions/lobby.
      if (this.isHost && hostPlayer) {
        const players = await this.fetchPlayers();
        if (resume) {
          const room = await this.fetchRoom();
          if (room) {
            const game = room.game && typeof room.game === "object" ? room.game : {};
            this.onState?.(
              mergeGameIntoState(
                {
                  ...game,
                  roomCode: this.code,
                  hostId: room.host_id || hostPlayer.id,
                  phase: room.phase || game.phase || "lobby",
                },
                players
              )
            );
          }
        } else {
          this.onState?.(createState(this.code, hostPlayer));
        }
        this.onPlayers?.(players);
      } else if (joinPlayer) {
        const players = await this.fetchPlayers();
        this.onPlayers?.(players);
      }
    }

    /** Persist + broadcast game events (NOT a global player dump) */
    async broadcastState(st) {
      this._pendingGame = gameOnly(st);
      if (this._writing) return;
      this._writing = true;

      try {
        while (this._pendingGame) {
          const snapshot = this._pendingGame;
          this._pendingGame = null;

          // Broadcast: everyone starts the same spin / phase instantly
          this.channel?.send({
            type: "broadcast",
            event: "game",
            payload: snapshot,
          });

          const { error } = await db().from("rooms").upsert({
            code: this.code,
            host_id: snapshot.hostId || st.hostId,
            phase: snapshot.phase,
            game: snapshot,
            updated_at: new Date().toISOString(),
          });
          if (error) {
            console.error("Room save failed:", error);
            toast(error.message || "Failed to save room");
          }

          // Keep player scores in the players table (room-scoped)
          await this.syncPlayerStats(st.players || []);
        }
      } finally {
        this._writing = false;
      }
    }

    async syncPlayerStats(players) {
      await Promise.all(
        players.map((p) =>
          db()
            .from("players")
            .update({
              answered: p.answered,
              skips: p.skips,
              kicked: p.kicked,
              name: p.name,
              is_host: p.isHost,
            })
            .eq("id", p.id)
            .eq("room_id", this.code)
        )
      );
    }

    sendAction(action) {
      if (this.isHost) {
        this.onAction?.(action);
        return;
      }
      this.channel?.send({
        type: "broadcast",
        event: "action",
        payload: action,
      });
    }

    notifyJoinRejected(payload) {
      this.channel?.send({
        type: "broadcast",
        event: "joinRejected",
        payload,
      });
    }

    notifyQuestionRejected(payload) {
      this.channel?.send({
        type: "broadcast",
        event: "questionRejected",
        payload,
      });
    }

    notifyHostHandoff(payload) {
      this.channel?.send({
        type: "broadcast",
        event: "hostHandoff",
        payload,
      });
    }

    notifyPlayerKicked(payload) {
      this.channel?.send({
        type: "broadcast",
        event: "playerKicked",
        payload,
      });
    }

    destroy() {
      if (this.channel) {
        supabaseClient.removeChannel(this.channel);
        this.channel = null;
      }
    }
  }

  // ---------- sync: local (BroadcastChannel) ----------
  class LocalSync {
    constructor(code, isHost) {
      this.code = code;
      this.isHost = isHost;
      this.channel = new BroadcastChannel(`anonwheel-${code}`);
      this.storageKey = `anonwheel-state-${code}`;
      this.onState = null;
      this.onAction = null;
      this.channel.onmessage = (ev) => this._handle(ev.data);
      window.addEventListener("storage", this._onStorage);
    }

    _onStorage = (e) => {
      if (e.key !== this.storageKey || !e.newValue) return;
      try {
        const st = JSON.parse(e.newValue);
        this.onState?.(st);
      } catch (_) {}
    };

    _handle(msg) {
      if (!msg || msg.sourceId === me.id) return;
      if (msg.type === "state") this.onState?.(msg.state);
      if (msg.type === "action" && this.isHost) this.onAction?.(msg.action);
      if (msg.type === "hello" && this.isHost && state) {
        this.broadcastState(state);
      }
      if (msg.type === "joinRejected" && msg.payload?.playerId === me.id) {
        handleNameTaken(msg.payload.message);
      }
      if (msg.type === "questionRejected" && msg.payload?.playerId === me.id) {
        handleQuestionRejected(msg.payload.message);
      }
      if (msg.type === "playerKicked" && msg.payload?.playerId === me.id) {
        handleKickedOut(msg.payload.message);
      }
      if (msg.type === "hostHandoff" && msg.payload?.newHostId && state) {
        if (msg.payload.leavingId) removePlayerFromState(msg.payload.leavingId);
        assignHost(msg.payload.newHostId);
        if (msg.payload.leavingName) toast(`${msg.payload.leavingName} left`);
        syncHostRole();
        render();
      }
    }

    async start() {
      // Host and guests both reload the latest snapshot after a refresh
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        try {
          this.onState?.(JSON.parse(raw));
        } catch (_) {}
      }
      if (!this.isHost) {
        this.channel.postMessage({ type: "hello", sourceId: me.id });
      }
    }

    broadcastState(st) {
      localStorage.setItem(this.storageKey, JSON.stringify(st));
      this.channel.postMessage({ type: "state", sourceId: me.id, state: st });
    }

    sendAction(action) {
      if (this.isHost) {
        this.onAction?.(action);
        return;
      }
      this.channel.postMessage({ type: "action", sourceId: me.id, action });
    }

    notifyJoinRejected(payload) {
      this.channel.postMessage({ type: "joinRejected", sourceId: me.id, payload });
    }

    notifyQuestionRejected(payload) {
      this.channel.postMessage({
        type: "questionRejected",
        sourceId: me.id,
        payload,
      });
    }

    notifyHostHandoff(payload) {
      this.channel.postMessage({
        type: "hostHandoff",
        sourceId: me.id,
        payload,
      });
    }

    notifyPlayerKicked(payload) {
      this.channel.postMessage({
        type: "playerKicked",
        sourceId: me.id,
        payload,
      });
    }

    async deletePlayer() {
      /* local roster lives in shared state only */
    }

    async setRoomHost() {}

    destroy() {
      this.channel.close();
      window.removeEventListener("storage", this._onStorage);
    }
  }

  // ---------- host action handling ----------
  async function upsertQuestionRow(entry, pot) {
    if (!supabaseClient || !state?.roomCode || !entry) return;
    const { error } = await db().from("questions").upsert({
      id: entry.id,
      room_id: state.roomCode,
      question_text: entry.text,
      author_id: entry.authorId || null,
      author_name: entry.authorName || null,
      pot: pot === "finals" ? "finals" : "wheel",
      status: "unanswered",
      skip_count: 0,
      updated_at: new Date().toISOString(),
    });
    if (error) console.error("Failed to upsert question:", error);
  }

  async function logQuestionOutcome({ question, player, pot, outcome }) {
    if (!supabaseClient || !state?.roomCode || !question || !player) return;

    const isSkip = outcome === "skipped";
    const potValue = pot === "finals" ? "finals" : "wheel";

    const { error: logError } = await db().from("answered_questions").insert({
      room_id: state.roomCode,
      question_id: question.id,
      question_text: question.text,
      player_id: player.id,
      player_name: player.name,
      author_id: question.authorId || null,
      author_name: question.authorName || null,
      pot: potValue,
      outcome: isSkip ? "skipped" : "answered",
      returned_to_pool: isSkip,
    });
    if (logError) console.error("Failed to log question outcome:", logError);

    // Keep the live pot status in sync: skips stay unanswered; answers resolve
    if (isSkip) {
      const { data: existing } = await db()
        .from("questions")
        .select("skip_count")
        .eq("id", question.id)
        .maybeSingle();
      const nextSkips = (existing?.skip_count || 0) + 1;
      const { error } = await db()
        .from("questions")
        .update({
          status: "unanswered",
          skip_count: nextSkips,
          updated_at: new Date().toISOString(),
        })
        .eq("id", question.id);
      if (error) console.error("Failed to mark question still unanswered after skip:", error);
    } else {
      const { error } = await db()
        .from("questions")
        .update({
          status: "answered",
          answered_by_id: player.id,
          answered_by_name: player.name,
          updated_at: new Date().toISOString(),
        })
        .eq("id", question.id);
      if (error) console.error("Failed to mark question answered:", error);
    }
  }

  function publish() {
    if (!state) return Promise.resolve();
    saveSession();
    render();
    if (me.isHost && sync) return Promise.resolve(sync.broadcastState(state));
    return Promise.resolve();
  }

  // ---------- TARGET mode (mid-game special round) ----------
  function isTargetPhase(st = state) {
    return (
      !!st?.target &&
      (st.phase === "target_setup" || st.phase === "target_active")
    );
  }

  /** Chain length from participant count — single tunable entry point. */
  function targetChainLength(participantCount) {
    const n = Math.max(0, participantCount | 0);
    if (n < 2) return 0;
    // floor(n * ratio), at least 2, never more than submissions available
    return Math.max(2, Math.min(n, Math.floor(n * TARGET_CHAIN_RATIO)));
  }

  function targetParticipants(st = state) {
    const ids = st?.target?.participantIds || [];
    return ids
      .map((id) => getPlayer(id, st))
      .filter((p) => p && !p.kicked);
  }

  function targetSubmissionCount(st = state) {
    const subs = st?.target?.submissions || {};
    return targetParticipants(st).filter((p) => subs[p.id]?.text && subs[p.id]?.targetId)
      .length;
  }

  function allTargetsSubmitted(st = state) {
    const parts = targetParticipants(st);
    if (!parts.length) return false;
    const subs = st?.target?.submissions || {};
    return parts.every((p) => subs[p.id]?.text && subs[p.id]?.targetId);
  }

  function currentTargetItem(st = state) {
    const t = st?.target;
    if (!t?.chain?.length) return null;
    return t.chain[t.chainIndex] || null;
  }

  function canStartTarget() {
    if (!me.isHost || !state) return false;
    if (
      isTargetPhase() ||
      isWildcardPhase() ||
      state.phase === "lobby" ||
      state.phase === "finals" ||
      state.phase === "end"
    ) {
      return false;
    }
    // During Mode 1 play (pool open or wheel)
    if (!["questions", "spinning", "answering", "confirm"].includes(state.phase)) {
      return false;
    }
    return activePlayers().length >= TARGET_MIN_PLAYERS;
  }

  function beginTargetRound() {
    const parts = activePlayers();
    if (parts.length < TARGET_MIN_PLAYERS) {
      toast(`Need at least ${TARGET_MIN_PLAYERS} players for TARGET`);
      return;
    }
    clearAnswerTimers();
    const resumePhase = state.phase;
    state.target = {
      stage: "intro",
      participantIds: parts.map((p) => p.id),
      submissions: {},
      chain: [],
      chainIndex: 0,
      resumePhase,
      brokenById: null,
      brokenName: null,
    };
    state.phase = "target_setup";
    state.currentPlayerId = null;
    state.currentQuestionId = null;
    state.answerEndsAt = null;
    publish();
    toast("TARGET — joining locked until this round ends");
  }

  function lockTargetChainAndPlay() {
    if (!state?.target) return;
    const alive = targetParticipants();
    const subs = state.target.submissions || {};
    const pool = [];
    alive.forEach((p) => {
      const s = subs[p.id];
      if (!s?.text || !s?.targetId) return;
      const target = getPlayer(s.targetId);
      if (!target || target.kicked) return;
      if (s.targetId === p.id) return;
      pool.push({
        id: uid(),
        text: String(s.text).trim(),
        authorId: p.id, // internal only — never shown in UI
        targetId: s.targetId,
      });
    });
    shuffleInPlace(pool);
    const need = targetChainLength(alive.length);
    state.target.chain = pool.slice(0, Math.min(need, pool.length));
    state.target.chainIndex = 0;
    state.target.brokenById = null;
    state.target.brokenName = null;
    if (!state.target.chain.length) {
      toast("TARGET cancelled — no valid questions");
      endTargetAndResumeMode1();
      return;
    }
    state.phase = "target_active";
    state.target.stage = "reveal_q";
    publish();
    scheduleTargetReveal();
  }

  let targetRevealTimer = null;
  function clearTargetRevealTimer() {
    if (targetRevealTimer) {
      clearTimeout(targetRevealTimer);
      targetRevealTimer = null;
    }
  }

  function scheduleTargetReveal() {
    clearTargetRevealTimer();
    if (!me.isHost || !state?.target) return;
    if (state.target.stage !== "reveal_q") return;
    const token = state.target.chainIndex;
    targetRevealTimer = setTimeout(() => {
      targetRevealTimer = null;
      if (!me.isHost || !state?.target) return;
      if (state.phase !== "target_active") return;
      if (state.target.stage !== "reveal_q") return;
      if (state.target.chainIndex !== token) return;
      state.target.stage = "reveal_target";
      publish();
      // Brief beat then open choices
      targetRevealTimer = setTimeout(() => {
        targetRevealTimer = null;
        if (!me.isHost || !state?.target) return;
        if (state.target.stage !== "reveal_target") return;
        state.target.stage = "choose";
        publish();
      }, Math.min(TARGET_REVEAL_MS, 1200));
    }, TARGET_REVEAL_MS);
  }

  function advanceTargetAfterAnswer() {
    if (!state?.target) return;
    const next = state.target.chainIndex + 1;
    if (next >= (state.target.chain?.length || 0)) {
      finishTargetSuccess();
      return;
    }
    state.target.chainIndex = next;
    state.target.stage = "continue";
    publish();
    clearTargetRevealTimer();
    targetRevealTimer = setTimeout(() => {
      targetRevealTimer = null;
      if (!me.isHost || !state?.target) return;
      if (state.target.stage !== "continue") return;
      state.target.stage = "reveal_q";
      publish();
      scheduleTargetReveal();
    }, 1400);
  }

  function breakTargetChain(player) {
    if (!state?.target || !player) return;
    markEliminatedBySkip(player, { toastOut: false });
    state.target.brokenById = player.id;
    state.target.brokenName = player.name;
    state.target.stage = "broken";
    clearTargetRevealTimer();
    clearAnswerTimers();
    publish();
    // Show broken beat, then resume Mode 1
    targetRevealTimer = setTimeout(() => {
      targetRevealTimer = null;
      if (!me.isHost || !state?.target) return;
      if (state.target.stage !== "broken") return;
      endTargetAndResumeMode1();
    }, 2800);
  }

  function finishTargetSuccess() {
    if (!state?.target) return;
    state.target.stage = "complete";
    clearTargetRevealTimer();
    publish();
    targetRevealTimer = setTimeout(() => {
      targetRevealTimer = null;
      if (!me.isHost) return;
      endTargetAndResumeMode1();
    }, 1600);
  }

  function endTargetAndResumeMode1() {
    clearTargetRevealTimer();
    state.target = null;
    state.currentPlayerId = null;
    state.currentQuestionId = null;
    state.answerEndsAt = null;
    toast("Back to Icebreaker");
    if (activePlayers().length <= 0) {
      state.phase = "end";
      state.winnerId = null;
      publish();
      return;
    }
    if (activePlayers().length === 1) {
      state.phase = "end";
      state.winnerId = activePlayers()[0].id;
      state.revealForId = pickAuthorRevealId();
      publish();
      return;
    }
    continueMode1Flow();
  }

  // ---------- WILDCARD (skip-out comeback vote) ----------
  function isWildcardPhase(st = state) {
    return st?.phase === "wildcard";
  }

  function getWildcardMeta(playerId, st = state) {
    return (st?.wildcardById && st.wildcardById[playerId]) || {};
  }

  function setWildcardMeta(playerId, patch, st = state) {
    if (!st || !playerId) return;
    if (!st.wildcardById) st.wildcardById = {};
    const prev = st.wildcardById[playerId] || {};
    st.wildcardById[playerId] = {
      eligible: !!(patch.eligible ?? prev.eligible),
      used: !!(patch.used ?? prev.used),
    };
    const p = getPlayer(playerId, st);
    if (p) {
      p.wildcardEligible = st.wildcardById[playerId].eligible;
      p.wildcardUsed = st.wildcardById[playerId].used;
    }
  }

  function enqueueWildcard(playerId) {
    if (!state || !playerId) return;
    if (!Array.isArray(state.wildcardQueue)) state.wildcardQueue = [];
    if (state.wildcardQueue.includes(playerId)) return;
    state.wildcardQueue.push(playerId);
  }

  /**
   * Mark a player out from a SKIP elimination and queue their one WILDCARD chance
   * (unless they already used it).
   */
  function markEliminatedBySkip(player, { toastOut = true } = {}) {
    if (!player) return;
    player.kicked = true;
    const meta = getWildcardMeta(player.id);
    if (meta.used || player.wildcardUsed) {
      setWildcardMeta(player.id, { eligible: false, used: true });
      if (toastOut) toast(`${player.name} is permanently out`);
      return;
    }
    setWildcardMeta(player.id, { eligible: true, used: false });
    enqueueWildcard(player.id);
    if (toastOut) toast(`${player.name} is out (3 skips)`);
  }

  /** Safe to interrupt Mode 1 between turns — never during TARGET / finals / pool. */
  function canTriggerWildcardNow() {
    if (!state || !me.isHost) return false;
    if (isTargetPhase() || isWildcardPhase()) return false;
    if (["lobby", "questions", "finals", "end"].includes(state.phase)) return false;
    if (
      (state.phase === "spinning" ||
        state.phase === "answering" ||
        state.phase === "confirm") &&
      state.currentPlayerId
    ) {
      return false;
    }
    return true;
  }

  function peekNextWildcardCandidate() {
    if (!state || !Array.isArray(state.wildcardQueue)) return null;
    while (state.wildcardQueue.length) {
      const id = state.wildcardQueue[0];
      const p = getPlayer(id);
      const meta = getWildcardMeta(id);
      if (
        p &&
        p.kicked &&
        (meta.eligible || p.wildcardEligible) &&
        !(meta.used || p.wildcardUsed)
      ) {
        return id;
      }
      state.wildcardQueue.shift();
    }
    return null;
  }

  function tryStartNextWildcard() {
    if (!canTriggerWildcardNow()) return false;
    const playerId = peekNextWildcardCandidate();
    if (!playerId) return false;
    const voters = activePlayers().filter((p) => p.id !== playerId);
    if (voters.length < 1) {
      // Nobody left to vote — burn the chance and stay out
      state.wildcardQueue.shift();
      setWildcardMeta(playerId, { eligible: false, used: true });
      const p = getPlayer(playerId);
      if (p) p.kicked = true;
      return false;
    }
    state.wildcardQueue.shift();
    clearAnswerTimers();
    state.wildcard = {
      playerId,
      stage: "intro",
      confession: null,
      voterIds: null, // frozen when voting opens
      votes: {},
      result: null,
      yesCount: 0,
      noCount: 0,
    };
    state.phase = "wildcard";
    state.currentPlayerId = null;
    state.currentQuestionId = null;
    state.answerEndsAt = null;
    myWildcardVote = null;
    publish();
    toast("WILDCARD");
    return true;
  }

  /**
   * After a Mode 1 turn (or TARGET) resolves: try WILDCARD queue, else finals/wheel.
   */
  function continueMode1Flow() {
    if (!state) return;
    if (activePlayers().length <= 0) {
      state.phase = "end";
      state.winnerId = null;
      publish();
      return;
    }
    if (activePlayers().length === 1) {
      state.phase = "end";
      state.winnerId = activePlayers()[0].id;
      state.revealForId = pickAuthorRevealId();
      publish();
      return;
    }
    if (tryStartNextWildcard()) return;
    if (shouldGoToFinals()) {
      if (activePlayers().length <= 2) {
        toast("Two players left — rapid fire!");
      }
      startFinals();
      return;
    }
    beginWheelRound();
  }

  let wildcardRevealTimer = null;
  function clearWildcardRevealTimer() {
    if (wildcardRevealTimer) {
      clearTimeout(wildcardRevealTimer);
      wildcardRevealTimer = null;
    }
  }

  function openWildcardVoting() {
    if (!state?.wildcard) return;
    const pid = state.wildcard.playerId;
    // Freeze the voting roster now (late joiners after this cannot vote)
    state.wildcard.voterIds = activePlayers()
      .filter((p) => p.id !== pid)
      .map((p) => p.id);
    state.wildcard.votes = {};
    state.wildcard.stage = "voting";
    publish();
    maybeResolveWildcardVotes();
  }

  function maybeResolveWildcardVotes() {
    if (!state?.wildcard || state.wildcard.stage !== "voting") return;
    const voterIds = state.wildcard.voterIds || [];
    const votes = state.wildcard.votes || {};
    const cast = voterIds.filter((id) => votes[id] === "yes" || votes[id] === "no");
    if (cast.length < voterIds.length) return;
    resolveWildcardVotes();
  }

  function resolveWildcardVotes() {
    if (!state?.wildcard) return;
    const voterIds = state.wildcard.voterIds || [];
    const votes = state.wildcard.votes || {};
    let yes = 0;
    let no = 0;
    voterIds.forEach((id) => {
      if (votes[id] === "yes") yes += 1;
      else if (votes[id] === "no") no += 1;
    });
    state.wildcard.yesCount = yes;
    state.wildcard.noCount = no;
    // Majority only: YES must strictly exceed NO (ties stay out)
    const success = yes > no;
    state.wildcard.result = success ? "success" : "fail";
    state.wildcard.stage = "result";
    state.wildcard.votedCount = yes + no;

    const player = getPlayer(state.wildcard.playerId);
    setWildcardMeta(state.wildcard.playerId, { eligible: false, used: true });
    if (player) {
      if (success) {
        player.kicked = false;
        player.skips = 0;
        toast(`${player.name} is back!`);
      } else {
        player.kicked = true;
        toast(`${player.name} stays out`);
      }
    }
    // Strip individual votes after tally (anonymity)
    state.wildcard.votes = {};
    myWildcardVote = null;
    publish();
    scheduleWildcardResume();
  }

  function scheduleWildcardResume() {
    clearWildcardRevealTimer();
    wildcardRevealTimer = setTimeout(() => {
      wildcardRevealTimer = null;
      if (!me.isHost || !state?.wildcard) return;
      if (state.wildcard.stage !== "result") return;
      endWildcardAndResumeMode1();
    }, 2800);
  }

  function endWildcardAndResumeMode1() {
    clearWildcardRevealTimer();
    state.wildcard = null;
    state.currentPlayerId = null;
    state.currentQuestionId = null;
    state.answerEndsAt = null;
    myWildcardVote = null;
    continueMode1Flow();
  }

  function recoverWildcardProgress() {
    if (!me.isHost || !state?.wildcard) return;
    const stage = state.wildcard.stage;
    if (stage === "result") {
      scheduleWildcardResume();
    } else if (stage === "voting") {
      maybeResolveWildcardVotes();
    }
  }

  /** Candidate left / was removed mid-WILDCARD — burn the chance, stay out. */
  function abortWildcardForLeave(playerId) {
    if (!state?.wildcard || state.wildcard.playerId !== playerId) return false;
    clearWildcardRevealTimer();
    setWildcardMeta(playerId, { eligible: false, used: true });
    state.wildcard = null;
    return true;
  }

  /** Drop a leaver from the frozen voter list; re-check majority if voting. */
  function purgeWildcardVoter(playerId) {
    if (!state?.wildcard) return;
    if (Array.isArray(state.wildcard.voterIds)) {
      state.wildcard.voterIds = state.wildcard.voterIds.filter((id) => id !== playerId);
    }
    if (state.wildcard.votes && playerId in state.wildcard.votes) {
      delete state.wildcard.votes[playerId];
    }
    if (state.wildcard.stage === "voting") {
      maybeResolveWildcardVotes();
    }
  }

  /**
   * Participant left during TARGET setup — drop them from the freeze list
   * and invalidate any submissions that targeted them.
   */
  function purgeTargetParticipant(playerId) {
    if (!state?.target || !playerId) return;
    state.target.participantIds = (state.target.participantIds || []).filter(
      (id) => id !== playerId
    );
    if (state.target.submissions) {
      delete state.target.submissions[playerId];
      Object.keys(state.target.submissions).forEach((aid) => {
        if (state.target.submissions[aid]?.targetId === playerId) {
          delete state.target.submissions[aid];
        }
      });
    }
    // Too few left to run TARGET
    if (targetParticipants().length < TARGET_MIN_PLAYERS && state.phase === "target_setup") {
      toast("Not enough players — TARGET cancelled");
      endTargetAndResumeMode1();
      return;
    }
    if (
      state.phase === "target_setup" &&
      state.target.stage === "setup" &&
      allTargetsSubmitted()
    ) {
      lockTargetChainAndPlay();
    }
  }

  /** Current target left mid-question — same outcome as SKIP. */
  function handleTargetLeaveDuringPlay(playerId) {
    if (!state?.target || state.phase !== "target_active") return false;
    const item = currentTargetItem();
    if (item && item.targetId === playerId) {
      const p = getPlayer(playerId);
      if (p) breakTargetChain(p);
      else {
        state.target.brokenById = playerId;
        state.target.brokenName = "Player";
        state.target.stage = "broken";
        publish();
        setTimeout(() => {
          if (me.isHost) endTargetAndResumeMode1();
        }, 2800);
      }
      return true;
    }
    // Not the current target — just remove from roster; chain continues
    return false;
  }

  function handleAction(action) {
    if (!me.isHost || !state || !action) return;

    switch (action.type) {
      case "join": {
        if (state.phase === "end") {
          sync?.notifyJoinRejected?.({
            playerId: action.player.id,
            reason: "ended",
            message: "This game already ended.",
          });
          return;
        }
        if (isTargetPhase()) {
          sync?.notifyJoinRejected?.({
            playerId: action.player.id,
            reason: "target_lock",
            message:
              "TARGET is currently in progress. You can join when the round is over.",
          });
          return;
        }
        const reclaim = action.reclaim || null;
        const existing = state.players.find((p) => p.id === action.player.id);

        if (existing) {
          if (reclaim) {
            // Same device/name coming back — restore their seat stats
            existing.name = String(action.player.name || existing.name || "").trim();
            existing.answered = reclaim.answered ?? existing.answered ?? 0;
            existing.skips = reclaim.skips ?? existing.skips ?? 0;
            existing.kicked = !!reclaim.kicked;
            existing.lateJoin = !!reclaim.lateJoin;
            existing.joinedAt = reclaim.joinedAt || existing.joinedAt || Date.now();
            setSelections(existing, reclaim.selections ?? getSelections(existing));
            setWildcardMeta(existing.id, {
              eligible: !!reclaim.wildcardEligible,
              used: !!reclaim.wildcardUsed,
            });
            if (existing.lateJoin) markLateJoin(existing.id);
            else if (state.lateJoinIds) {
              state.lateJoinIds = state.lateJoinIds.filter((id) => id !== existing.id);
            }
            publish();
            toast(`${existing.name} is back — progress restored`);
            return;
          }
          // Fresh mid-game face (Supabase already inserted the row)
          if (state.phase !== "lobby" && !existing.lateJoin) {
            markLateJoin(existing.id);
            if (!state.selectionsById) state.selectionsById = {};
            if (!(existing.id in state.selectionsById)) {
              state.selectionsById[existing.id] = 0;
            }
            publish();
            toast(`${existing.name} joined mid-game`);
          }
          return;
        }

        if (
          state.players.some(
            (p) =>
              p.name.toLowerCase() ===
              String(action.player.name || "").trim().toLowerCase()
          )
        ) {
          sync?.notifyJoinRejected?.({
            playerId: action.player.id,
            reason: "name_taken",
            message: "That name is already taken in this room. Pick another.",
          });
          return;
        }

        const newId = action.player.id;
        if (reclaim) {
          const restored = {
            id: newId,
            name: String(action.player.name || reclaim.name || "").trim(),
            answered: reclaim.answered ?? 0,
            skips: reclaim.skips ?? 0,
            selections: reclaim.selections ?? 0,
            kicked: !!reclaim.kicked,
            isHost: false,
            lateJoin: !!reclaim.lateJoin,
            joinedAt: reclaim.joinedAt || Date.now(),
            wildcardEligible: !!reclaim.wildcardEligible,
            wildcardUsed: !!reclaim.wildcardUsed,
          };
          state.players.push(restored);
          if (!state.selectionsById) state.selectionsById = {};
          state.selectionsById[newId] = restored.selections;
          setWildcardMeta(newId, {
            eligible: restored.wildcardEligible,
            used: restored.wildcardUsed,
          });
          if (restored.lateJoin) markLateJoin(newId);
          else if (state.lateJoinIds) {
            state.lateJoinIds = state.lateJoinIds.filter((id) => id !== newId);
          }
          publish();
          toast(`${restored.name} is back — progress restored`);
          break;
        }

        const lateJoin = state.phase !== "lobby";
        state.players.push({
          id: newId,
          name: String(action.player.name || "").trim(),
          answered: 0,
          skips: 0,
          selections: 0,
          kicked: false,
          isHost: false,
          lateJoin,
          joinedAt: Date.now(),
        });
        if (lateJoin) {
          markLateJoin(newId);
          if (!state.selectionsById) state.selectionsById = {};
          state.selectionsById[newId] = 0;
        }
        publish();
        if (lateJoin) {
          toast(`${String(action.player.name || "").trim()} joined mid-game`);
        }
        break;
      }
      case "leave": {
        const leftId = action.playerId;
        if (!leftId || !getPlayer(leftId)) return;
        const name = getPlayer(leftId)?.name || "Player";
        const wasHost = state.hostId === leftId;

        if (isTargetPhase()) {
          const broke = handleTargetLeaveDuringPlay(leftId);
          removePlayerFromState(leftId);
          if (!broke && state?.phase === "target_setup") {
            purgeTargetParticipant(leftId);
          }
          if (wasHost) {
            const next = nextHostCandidate(null);
            if (next) {
              assignHost(next.id);
              sync?.notifyHostHandoff?.({
                newHostId: next.id,
                leavingId: leftId,
              });
              toast(`${next.name} is the new host`);
            }
          }
          publish();
          sync?.deletePlayer?.(leftId);
          toast(`${name} left the room`);
          break;
        }

        removePlayerFromState(leftId);
        if (wasHost) {
          const next = nextHostCandidate(null);
          if (next) {
            assignHost(next.id);
            sync?.notifyHostHandoff?.({
              newHostId: next.id,
              leavingId: leftId,
            });
            toast(`${next.name} is the new host`);
          }
        }
        repairTurnAfterLeave(leftId);
        publish();
        sync?.deletePlayer?.(leftId);
        toast(`${name} left the room`);
        break;
      }
      case "startQuestions": {
        if (state.phase !== "lobby") return;
        // Only the room host may open the question pool
        if (action.playerId !== state.hostId) return;
        if (activePlayers().length < 2) return;
        state.phase = "questions";
        state.questionsLocked = false;
        state.poolMinQuestions = Math.max(2, poolPlayers().length) * 5;
        state.questionEndsAt = Date.now() + QUESTION_SECONDS * 1000;
        publish();
        break;
      }
      case "addQuestion": {
        if (state.phase !== "questions" || state.questionsLocked) return;
        const text = String(action.text || "").trim();
        if (!text) return;
        const author = getPlayer(action.playerId);
        if (!author || author.kicked || author.lateJoin) return;
        if (questionAlreadyInPool(text)) {
          const msg = "That question is already in the pool.";
          if (action.playerId === me.id) handleQuestionRejected(msg);
          else {
            sync?.notifyQuestionRejected?.({
              playerId: action.playerId,
              message: msg,
            });
          }
          return;
        }
        const entry = {
          id: uid(),
          text,
          authorId: author.id,
          authorName: author.name,
          used: false,
          reservedForRapidFire: false,
        };
        state.questions.push(entry);
        upsertQuestionRow(entry, "wheel");
        publish();
        break;
      }
      case "questionsDone": {
        if (state.phase !== "questions") return;
        // Only the room host may start the wheel phase
        if (action.playerId !== state.hostId) return;
        lockPoolAndStartNormal();
        break;
      }
      case "skip": {
        if (state.phase !== "answering" && state.phase !== "confirm") return;
        if (action.playerId !== state.currentPlayerId) return;
        const requester = action.requestedBy || action.playerId;
        const hostForce = requester === state.hostId && requester !== action.playerId;
        if (requester !== action.playerId && !hostForce) return;
        // Players may only skip while answering; host can force-skip in confirm too
        if (!hostForce && state.phase !== "answering") return;
        const player = getPlayer(action.playerId);
        const q = state.questions.find((x) => x.id === state.currentQuestionId);
        if (!player || !q) return;
        clearAnswerTimers();
        state.answerEndsAt = null;
        player.skips += 1;
        // Consume this normal-phase question (does not move into rapid-fire reserve)
        q.used = true;
        if (player.skips >= MAX_SKIPS && canEliminatePlayer(player)) {
          markEliminatedBySkip(player);
        }
        logQuestionOutcome({ question: q, player, pot: "wheel", outcome: "skipped" });
        if (hostForce) {
          toast(`Host skipped for ${player.name}`);
        }
        state.currentPlayerId = null;
        state.currentQuestionId = null;
        continueMode1Flow();
        break;
      }
      case "answerTimeout": {
        if (state.phase !== "answering") return;
        if (!state.currentPlayerId || !state.currentQuestionId) return;
        passQuestionOnTimeout();
        break;
      }
      case "kick": {
        // Host removes someone from the room entirely
        if (action.requestedBy !== state.hostId) return;
        const targetId = action.playerId;
        if (!targetId || targetId === state.hostId) return;
        const target = getPlayer(targetId);
        if (!target) return;
        const name = target.name;
        if (isTargetPhase()) {
          const broke = handleTargetLeaveDuringPlay(targetId);
          removePlayerFromState(targetId);
          if (!broke && state?.phase === "target_setup") {
            purgeTargetParticipant(targetId);
          }
        } else {
          removePlayerFromState(targetId);
          repairTurnAfterLeave(targetId);
        }
        publish();
        sync?.deletePlayer?.(targetId);
        sync?.notifyPlayerKicked?.({
          playerId: targetId,
          message: "The host removed you from the room.",
        });
        toast(`${name} was removed`);
        break;
      }
      case "chooseAnswer": {
        if (state.phase !== "answering") return;
        if (action.playerId !== state.currentPlayerId) return;
        clearAnswerTimers();
        state.answerEndsAt = null;
        state.phase = "confirm";
        publish();
        break;
      }
      case "confirmAnswered": {
        if (state.phase !== "confirm") return;
        if (action.playerId !== state.currentPlayerId) return;
        const player = getPlayer(action.playerId);
        const q = state.questions.find((x) => x.id === state.currentQuestionId);
        if (!player || !q) return;
        clearAnswerTimers();
        state.answerEndsAt = null;
        player.answered += 1;
        q.used = true;
        logQuestionOutcome({ question: q, player, pot: "wheel", outcome: "answered" });
        state.currentPlayerId = null;
        state.currentQuestionId = null;
        continueMode1Flow();
        break;
      }
      case "buzz": {
        if (!state.finals || state.finals.phase !== "open") return;
        if (state.finals.buzzedBy) return;
        if (action.playerId !== state.finals.aId && action.playerId !== state.finals.bId) return;
        const buzzer = getPlayer(action.playerId);
        if (!buzzer || buzzer.kicked) return;
        state.finals.buzzedBy = action.playerId;
        // Shout the answer, then confirm
        state.finals.phase = "confirm";
        publish();
        break;
      }
      case "finalsConfirmAnswered": {
        if (!state.finals || state.finals.phase !== "confirm") return;
        if (action.playerId !== state.finals.buzzedBy) return;
        const id = state.finals.buzzedBy;
        if (id === state.finals.aId) state.finals.aScore += 1;
        if (id === state.finals.bId) state.finals.bScore += 1;
        const player = getPlayer(id);
        const q = state.finals.questions?.[state.finals.index];
        if (player && q) {
          q.used = true;
          if (typeof player.answered === "number") player.answered += 1;
          logQuestionOutcome({ question: q, player, pot: "finals", outcome: "answered" });
        }
        advanceFinalsQuestion();
        break;
      }
      case "openBuzzers": {
        if (!state.finals || state.finals.phase !== "show") return;
        state.finals.phase = "open";
        publish();
        break;
      }
      case "startFinalsClock": {
        // Legacy: finals now open automatically; keep for older clients
        if (!state.finals) return;
        if (state.finals.phase === "ready" || state.finals.phase === "show") {
          openFinalsQuestion();
        }
        break;
      }
      case "startTarget": {
        if (action.playerId !== state.hostId) return;
        if (!canStartTarget()) return;
        beginTargetRound();
        break;
      }
      case "targetBegin": {
        // Host or any participant can ack intro → setup (host authoritative)
        if (!state.target || state.phase !== "target_setup") return;
        if (state.target.stage !== "intro") return;
        state.target.stage = "setup";
        publish();
        break;
      }
      case "targetSubmit": {
        if (!state.target || state.phase !== "target_setup") return;
        if (state.target.stage !== "setup") return;
        const pid = action.playerId;
        if (!(state.target.participantIds || []).includes(pid)) return;
        const author = getPlayer(pid);
        if (!author || author.kicked) return;
        const text = String(action.text || "").trim();
        const targetId = action.targetId;
        if (!text || !targetId) return;
        if (targetId === pid) return;
        if (!(state.target.participantIds || []).includes(targetId)) return;
        const targetPlayer = getPlayer(targetId);
        if (!targetPlayer || targetPlayer.kicked) return;
        if (!state.target.submissions) state.target.submissions = {};
        state.target.submissions[pid] = {
          text,
          targetId,
          submittedAt: Date.now(),
        };
        publish();
        if (allTargetsSubmitted()) {
          lockTargetChainAndPlay();
        }
        break;
      }
      case "targetAnswer": {
        if (!state.target || state.phase !== "target_active") return;
        if (state.target.stage !== "choose") return;
        const item = currentTargetItem();
        if (!item || action.playerId !== item.targetId) return;
        const player = getPlayer(action.playerId);
        if (!player || player.kicked) return;
        if (typeof player.answered === "number") player.answered += 1;
        advanceTargetAfterAnswer();
        break;
      }
      case "targetSkip": {
        if (!state.target || state.phase !== "target_active") return;
        if (state.target.stage !== "choose") return;
        const item = currentTargetItem();
        if (!item || action.playerId !== item.targetId) return;
        const player = getPlayer(action.playerId);
        if (!player || player.kicked) return;
        breakTargetChain(player);
        break;
      }
      case "wildcardBegin": {
        if (!isWildcardPhase() || !state.wildcard) return;
        if (state.wildcard.stage !== "intro") return;
        state.wildcard.stage = "confession";
        publish();
        break;
      }
      case "wildcardConfess": {
        if (!isWildcardPhase() || !state.wildcard) return;
        if (state.wildcard.stage !== "confession") return;
        if (action.playerId !== state.wildcard.playerId) return;
        const text = String(action.text || "").trim();
        if (!text) return;
        state.wildcard.confession = text.slice(0, 280);
        // Brief reveal beat, then open voting
        state.wildcard.stage = "reveal";
        publish();
        clearWildcardRevealTimer();
        wildcardRevealTimer = setTimeout(() => {
          wildcardRevealTimer = null;
          if (!me.isHost || !state?.wildcard) return;
          if (state.wildcard.stage !== "reveal") return;
          openWildcardVoting();
        }, 1600);
        break;
      }
      case "wildcardVote": {
        if (!isWildcardPhase() || !state.wildcard) return;
        if (state.wildcard.stage !== "voting") return;
        const voterId = action.playerId;
        if (!voterId || voterId === state.wildcard.playerId) return;
        if (!(state.wildcard.voterIds || []).includes(voterId)) return;
        const choice = action.vote === "yes" ? "yes" : action.vote === "no" ? "no" : null;
        if (!choice) return;
        if (!state.wildcard.votes) state.wildcard.votes = {};
        // One vote per player; allow change until all cast
        state.wildcard.votes[voterId] = choice;
        state.wildcard.votedCount = Object.keys(state.wildcard.votes).length;
        // Resolve before publish so the result isn’t dropped behind an in-flight write
        maybeResolveWildcardVotes();
        if (state.wildcard?.stage === "voting") publish();
        break;
      }
      default:
        break;
    }
  }

  function canEliminatePlayer(player) {
    // 2-player games: no skip-outs (they go straight to rapid fire)
    if (state.startingPlayerCount === 2) return false;
    // With 3+: 3 skips = out, but always leave 2 for rapid fire
    const others = activePlayers().filter((p) => p.id !== player.id);
    return others.length >= 2;
  }

  function shouldGoToFinals() {
    // 2 still in (or a 2-player game) → rapid fire
    if (activePlayers().length <= 2) return true;
    // Or normal wheel questions are all used
    if (normalQuestions().length === 0) return true;
    return false;
  }

  function lockPoolAndStartNormal() {
    const players = activePlayers();
    if (players.length < 2) {
      toast("Need at least 2 players");
      return;
    }
    const minQ = minimumQuestionsRequired();
    if (state.questions.length < minQ) {
      toast("Need at least " + minQ + " questions before starting");
      return;
    }

    // Lock pool — no more adds
    state.questionsLocked = true;
    state.startingPlayerCount = players.length;
    state.selectionsById = {};
    state.players.forEach((p) => {
      p.selections = 0;
      state.selectionsById[p.id] = 0;
    });

    // Shuffle once, then reserve rapid-fire slice from the SAME pool
    shuffleInPlace(state.questions);
    const reserve = Math.max(
      players.length * 2,
      Math.ceil(state.questions.length * 0.2)
    );
    const reserveCount = Math.min(reserve, state.questions.length);
    const cut = state.questions.length - reserveCount;
    state.questions.forEach((q, i) => {
      q.reservedForRapidFire = i >= cut;
      q.used = false;
    });
    state.rapidFireReserve = reserveCount;

    // 2 players (start or survivors) → rapid fire immediately; otherwise wheel
    if (shouldGoToFinals()) startFinals();
    else beginWheelRound();
  }

  /**
   * Prefer other people's questions. Only serve a player's own question
   * when nothing else remains in the normal (non–rapid-fire) pool.
   */
  function pickQuestionForPlayer(player, available) {
    if (!available.length) return null;
    const fromOthers = available.filter((q) => q.authorId !== player.id);
    const pool = fromOthers.length ? fromOthers : available;
    return pool[0];
  }

  /**
   * Fair wheel target: everyone gets a turn before anyone gets another.
   * Among equally picked players, prefer whoever has answered fewer times.
   * Random only breaks remaining ties.
   */
  function pickFairWheelPlayer(candidates, excludeId = null) {
    const pool = (candidates || []).filter(
      (p) => p && p.id !== excludeId && !p.kicked
    );
    if (!pool.length) return null;
    if (pool.length === 1) return pool[0];

    let minTurns = Infinity;
    let minAnswered = Infinity;
    pool.forEach((p) => {
      const turns = getSelections(p);
      const answered = p.answered ?? 0;
      if (turns < minTurns) {
        minTurns = turns;
        minAnswered = answered;
      } else if (turns === minTurns && answered < minAnswered) {
        minAnswered = answered;
      }
    });

    const tied = pool.filter(
      (p) =>
        getSelections(p) === minTurns && (p.answered ?? 0) === minAnswered
    );
    return tied[(Math.random() * tied.length) | 0];
  }

  function beginWheelRound() {
    const alive = wheelPlayers();
    const left = normalQuestions();

    if (left.length === 0 || alive.length === 0 || shouldGoToFinals()) {
      startFinals();
      return;
    }

    const player = pickFairWheelPlayer(alive);
    if (!player) {
      startFinals();
      return;
    }
    setSelections(player, getSelections(player) + 1);

    const q = pickQuestionForPlayer(player, left);
    if (!q) {
      startFinals();
      return;
    }

    const targetIndex = Math.max(
      0,
      alive.findIndex((p) => p.id === player.id)
    );

    state.phase = "spinning";
    state.spinTargetIndex = targetIndex;
    state.spinToken += 1;
    state.currentPlayerId = player.id;
    state.currentQuestionId = q.id;
    state.answerEndsAt = null;
    publish();

    setTimeout(() => {
      if (!state || state.phase !== "spinning") return;
      if (state.currentPlayerId !== player.id) return;
      openAnsweringPhase({ freshDeadline: true });
    }, SPIN_MS + 180);
  }

  /** Randomly pick count players from a tied group */
  function pickRandomFrom(arr, count) {
    const pool = shuffleInPlace([...arr]);
    return pool.slice(0, count);
  }

  /**
   * Top 2 by wheel selections. Within a tied tier, choose randomly.
   */
  function pickFinalistsBySelections(candidates) {
    if (candidates.length <= 2) return candidates.slice(0, 2);

    const byScore = new Map();
    candidates.forEach((p) => {
      const s = getSelections(p);
      if (!byScore.has(s)) byScore.set(s, []);
      byScore.get(s).push(p);
    });
    const scores = [...byScore.keys()].sort((a, b) => b - a);
    const picked = [];
    for (const score of scores) {
      const tier = byScore.get(score);
      const need = 2 - picked.length;
      if (need <= 0) break;
      if (tier.length <= need) {
        picked.push(...shuffleInPlace([...tier]));
      } else {
        picked.push(...pickRandomFrom(tier, need));
      }
    }
    return picked.slice(0, 2);
  }

  /**
   * Author reveal goes to whoever answered the most questions
   * across the whole game (wheel + rapid fire). Ties broken randomly.
   */
  function pickAuthorRevealId(players = state?.players) {
    const pool = players || [];
    if (!pool.length) return null;
    const top = Math.max(...pool.map((p) => p.answered ?? 0));
    const tied = pool.filter((p) => (p.answered ?? 0) === top);
    return pickRandomFrom(tied, 1)[0].id;
  }

  function startFinals() {
    const all = state.players || [];
    if (all.length === 0) {
      state.phase = "end";
      state.winnerId = null;
      state.revealForId = null;
      publish();
      return;
    }

    // Rapid fire is only for players still in the game — never bring back
    // eliminated (3-skip) players, even if they have the most wheel picks.
    const candidates = activePlayers();

    if (candidates.length === 0) {
      state.revealForId = pickAuthorRevealId(all);
      state.phase = "end";
      state.winnerId = state.revealForId;
      publish();
      return;
    }

    if (candidates.length === 1) {
      // Sole survivor — no buzzer match
      state.phase = "end";
      state.winnerId = candidates[0].id;
      state.revealForId = pickAuthorRevealId(all);
      publish();
      return;
    }

    // 2+ still in: top 2 by selections among survivors only
    // (author reveal is decided after rapid fire, once all answers are in)
    const finalists = pickFinalistsBySelections(candidates);
    state._finalistAId = finalists[0].id;
    state._finalistBId = finalists[1].id;
    beginFinalsMatch();
  }

  function beginFinalsMatch() {
    const aId = state._finalistAId;
    const bId = state._finalistBId;
    const a = getPlayer(aId);
    const b = getPlayer(bId);
    if (!a || !b || a.kicked || b.kicked) {
      state.revealForId = pickAuthorRevealId();
      state.phase = "end";
      state.winnerId =
        (a && !a.kicked ? aId : null) ||
        (b && !b.kicked ? bId : null) ||
        state.revealForId;
      publish();
      return;
    }

    const bank = rapidFireQuestions();
    if (bank.length === 0) {
      state.revealForId = pickAuthorRevealId();
      state.winnerId = a.id;
      state.phase = "end";
      state.currentPlayerId = null;
      state.currentQuestionId = null;
      state.finals = null;
      publish();
      toast("No rapid-fire questions reserved — ending on wheel results");
      return;
    }

    const finalsQs = bank.slice();

    state.phase = "finals";
    state.currentPlayerId = null;
    state.currentQuestionId = null;
    state.finals = {
      aId: a.id,
      bId: b.id,
      aScore: 0,
      bScore: 0,
      index: 0,
      questions: finalsQs,
      buzzedBy: null,
      phase: "show",
      buzzOpensAt: Date.now() + BUZZ_REVEAL_MS,
      endsAt: null,
    };
    publish();
  }

  function openFinalsQuestion() {
    if (!state.finals) return;
    if (state.finals.index >= state.finals.questions.length) {
      finishFinals();
      return;
    }
    state.finals.buzzedBy = null;
    // Show question first; buzzer arms after a short beat
    state.finals.phase = "show";
    state.finals.buzzOpensAt = Date.now() + BUZZ_REVEAL_MS;
    publish();
  }

  function advanceFinalsQuestion() {
    if (!state.finals) return;
    state.finals.index += 1;
    state.finals.buzzedBy = null;
    if (state.finals.index >= state.finals.questions.length) {
      finishFinals();
      return;
    }
    state.finals.phase = "show";
    state.finals.buzzOpensAt = Date.now() + BUZZ_REVEAL_MS;
    publish();
  }

  function finishFinals() {
    const f = state.finals;
    // Game winner = who buzzed in and answered the most in rapid fire
    let winnerId = null;
    if (f) {
      if (f.aScore > f.bScore) winnerId = f.aId;
      else if (f.bScore > f.aScore) winnerId = f.bId;
      else {
        // Exact tie on rapid-fire answers → coin flip between finalists
        winnerId = Math.random() < 0.5 ? f.aId : f.bId;
      }
    }
    state.winnerId = winnerId;
    state.finalsAnswerScores = f
      ? { [f.aId]: f.aScore, [f.bId]: f.bScore }
      : null;
    // Author reveal = most answers across the whole game (wheel + rapid fire)
    state.revealForId = pickAuthorRevealId();
    state.phase = "end";
    publish();
  }

  // ---------- client send helpers ----------
  function send(action) {
    sync?.sendAction(action);
  }

  // ---------- wheel drawing ----------
  function drawWheel(players, angleRad, highlightIndex = -1) {
    const canvas = els.wheelCanvas;
    const ctx = canvas.getContext("2d");
    const size = canvas.width;
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 8;
    const n = Math.max(players.length, 1);
    const arc = (Math.PI * 2) / n;

    ctx.clearRect(0, 0, size, size);

    // outer ring — ink outline, cream field
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
    ctx.fillStyle = "#2a2826";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 1, 0, Math.PI * 2);
    ctx.fillStyle = "#f7f5f1";
    ctx.fill();

    for (let i = 0; i < n; i++) {
      const start = angleRad + i * arc;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, start + arc, false);
      ctx.closePath();
      ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
      ctx.fill();

      // divider
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(
        cx + Math.cos(start) * radius,
        cy + Math.sin(start) * radius
      );
      ctx.strokeStyle = "rgba(42, 40, 38, 0.45)";
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // label — light ink on saturated segments
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(start + arc / 2);
      ctx.textAlign = "right";
      ctx.fillStyle = "#f7f5f1";
      ctx.strokeStyle = "rgba(28, 27, 25, 0.35)";
      ctx.lineWidth = 3;
      ctx.font = `700 ${Math.max(13, 26 - n * 0.8)}px Syne, DM Sans, system-ui, sans-serif`;
      const label = (players[i]?.name || "?").slice(0, 10);
      ctx.strokeText(label, radius - 18, 5);
      ctx.fillText(label, radius - 18, 5);
      ctx.restore();
    }

    // Near-select outline drawn last so it sits on top — thick & prominent
    if (highlightIndex >= 0 && highlightIndex < n) {
      const start = angleRad + highlightIndex * arc;
      const pad = 0.012;

      // Outer ink wedge outline
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius + 2, start, start + arc, false);
      ctx.closePath();
      ctx.strokeStyle = "#1c1b19";
      ctx.lineWidth = 8;
      ctx.lineJoin = "round";
      ctx.stroke();

      // Cream inner rim along the rim arc
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 5, start + pad, start + arc - pad, false);
      ctx.strokeStyle = "#f7f5f1";
      ctx.lineWidth = 5;
      ctx.lineCap = "butt";
      ctx.stroke();

      // Second ink rim for punch
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 1, start + pad, start + arc - pad, false);
      ctx.strokeStyle = "#2a2826";
      ctx.lineWidth = 3.5;
      ctx.stroke();
    }

    // hub
    ctx.beginPath();
    ctx.arc(cx, cy, 34, 0, Math.PI * 2);
    ctx.fillStyle = "#2a2826";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    ctx.fillStyle = "#f7f5f1";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    ctx.strokeStyle = "#2a2826";
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  function animateWheelToIndex(players, targetIndex, token) {
    if (lastSpinToken === token) return;
    if (wheelRaf) cancelAnimationFrame(wheelRaf);
    wheelSpinning = true;
    lastSpinToken = token;

    const desired = wheelAngleForIndex(players, targetIndex, token);

    // Extra full turns — synced across clients via spinToken
    const turns = 5 + Math.floor(spinUnit(token, 1) * 3); // 5–7
    const from = wheelAngle;
    let delta = desired - from;
    delta = ((delta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const to = from + turns * Math.PI * 2 + delta;

    const duration = SPIN_MS;
    const start = performance.now();

    function frame(now) {
      if (lastSpinToken !== token) return;
      const t = Math.min(1, (now - start) / duration);
      const eased = easeOutQuint(t);
      wheelAngle = from + (to - from) * eased;

      const under = indexUnderPointer(players, wheelAngle);
      drawWheel(players, wheelAngle, under);

      if (t < 1) {
        wheelRaf = requestAnimationFrame(frame);
      } else {
        wheelAngle = to;
        drawWheel(players, wheelAngle, targetIndex);
        wheelSpinning = false;
        wheelRaf = 0;
      }
    }
    wheelRaf = requestAnimationFrame(frame);
  }

  // ---------- render ----------
  function updateHostRoomCode() {
    const show = !!(me.isHost && state?.roomCode);
    if (els.hostRoomCode) {
      els.hostRoomCode.hidden = !show;
      if (!show) els.hostRoomCode.style.display = "none";
      else els.hostRoomCode.style.display = "";
    }
    if (els.hostRoomCodeValue && state?.roomCode) {
      els.hostRoomCodeValue.textContent = state.roomCode;
    }
    if (els.lobbyRoomChip) {
      els.lobbyRoomChip.hidden = !me.isHost;
      els.lobbyRoomChip.style.display = me.isHost ? "" : "none";
    }
    if (els.lobbyCode && state?.roomCode) {
      els.lobbyCode.textContent = state.roomCode;
    }
  }

  function updateLeaveButtons() {
    const inRoom =
      !!state &&
      !!me?.id &&
      state.phase !== "end" &&
      [
        "lobby",
        "questions",
        "spinning",
        "answering",
        "confirm",
        "finals",
        "target_setup",
        "target_active",
        "wildcard",
      ].includes(state.phase);
    if (els.btnLeaveRoom) {
      els.btnLeaveRoom.hidden = !inRoom || state.phase === "lobby";
    }
    if (els.btnLeaveLobby) {
      els.btnLeaveLobby.hidden = !(inRoom && state.phase === "lobby");
    }
  }

  function render() {
    if (!state) return;

    clearInterval(questionTick);
    questionTick = null;
    clearInterval(finalsTick);
    finalsTick = null;
    clearInterval(answerDeadlineTick);
    answerDeadlineTick = null;

    const self = getPlayer(me.id);
    const inOwnWildcard =
      isWildcardPhase() && state.wildcard?.playerId === me.id;
    els.kickedOverlay.hidden = !(
      self &&
      self.kicked &&
      state.phase !== "end" &&
      state.phase !== "lobby" &&
      !inOwnWildcard
    );
    updateHostRoomCode();
    updateLeaveButtons();

    switch (state.phase) {
      case "lobby":
        showScreen("lobby");
        renderLobby();
        break;
      case "questions":
        showScreen("questions");
        renderQuestions();
        break;
      case "spinning":
      case "answering":
      case "confirm":
        showScreen("game");
        renderGame();
        break;
      case "target_setup":
      case "target_active":
        showScreen("target");
        renderTarget();
        break;
      case "wildcard":
        showScreen("wildcard");
        renderWildcard();
        break;
      case "finals":
        showScreen("finals");
        renderFinals();
        break;
      case "end":
        showScreen("end");
        renderEnd();
        break;
      default:
        break;
    }
  }

  function renderLobby() {
    updateHostRoomCode();
    els.playerList.innerHTML = "";
    state.players.forEach((p) => {
      const li = document.createElement("li");
      li.className = "player-pill";
      if (p.isHost) li.classList.add("host");
      if (p.id === me.id) li.classList.add("you");
      const meta =
        p.id === me.id ? "you" : p.isHost ? "host" : "joined";
      li.innerHTML = `<span class="name">${escapeHtml(p.name)}</span><span class="meta">${meta}</span>`;
      if (me.isHost && p.id !== me.id) {
        const kick = document.createElement("button");
        kick.type = "button";
        kick.className = "btn-kick";
        kick.textContent = "Remove";
        kick.title = `Remove ${p.name}`;
        kick.onclick = () => hostKickPlayer(p.id, p.name);
        li.appendChild(kick);
      }
      els.playerList.appendChild(li);
    });

    const ready = activePlayers().length >= 2;
    const sub = document.querySelector("#screen-lobby .section-sub");
    if (sub) {
      sub.textContent = me.isHost
        ? "Share the link. When everyone’s in, you start the game."
        : "You’re in. Wait for the host to start — only they can begin.";
    }

    els.lobbyStatus.textContent = ready
      ? `${activePlayers().length} players ready`
      : "Waiting for players…";
    els.lobbyHint.textContent = ready
      ? me.isHost
        ? "You’re the host — open the question pool when everyone is in."
        : "Waiting for the host to start. You don’t need to do anything else yet."
      : me.isHost
        ? "Need at least 2 players to start."
        : "Waiting for more players… the host will start when ready.";

    els.btnStartQuestions.hidden = !me.isHost;
    els.btnStartQuestions.disabled = !ready || !me.isHost;
    if (els.btnStartQuestions) {
      els.btnStartQuestions.textContent = "Start — open question pool";
      els.btnStartQuestions.setAttribute("aria-hidden", me.isHost ? "false" : "true");
      if (!me.isHost) {
        els.btnStartQuestions.style.display = "none";
      } else {
        els.btnStartQuestions.style.display = "";
      }
    }
  }

  function shuffleCopy(arr) {
    return shuffleInPlace(arr.slice());
  }

  function bankForFilter() {
    if (!ideaFilter) return IDEA_BANK.slice();
    return IDEA_BANK.filter((item) => item.vibe === ideaFilter);
  }

  function stampIdeaIds(list, prefix) {
    return list.map((item, i) => ({
      ...item,
      id: `${prefix}-${i}-${item.text.slice(0, 14)}`,
    }));
  }

  function syncIdeaFilterButtons() {
    document.querySelectorAll("[data-idea-filter]").forEach((btn) => {
      const vibe = btn.getAttribute("data-idea-filter");
      const on = ideaFilter === vibe;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function rebuildIdeaReelFromFilter() {
    let pool = shuffleCopy(bankForFilter());
    if (pendingIdea) {
      pool = pool.filter((item) => item.text !== pendingIdea.text);
    }
    const stamped = stampIdeaIds(pool, ideaFilter || "all");
    ideaReel = stamped.slice(0, Math.min(IDEA_REEL_SIZE, stamped.length));
    ideaReserve = stamped.slice(ideaReel.length);
    if (
      pendingReplacementId &&
      !ideaReel.some((x) => x.id === pendingReplacementId)
    ) {
      pendingReplacementId = null;
    }
    ideaOffset = 0;
    paintIdeaReel();
    syncIdeaFilterButtons();
  }

  function setIdeaFilter(vibe) {
    ideaFilter = ideaFilter === vibe ? null : vibe;
    rebuildIdeaReelFromFilter();
  }

  function resetIdeaReel() {
    pendingIdea = null;
    pendingReplacementId = null;
    rebuildIdeaReelFromFilter();
  }

  function ideaMod(n, m) {
    return ((n % m) + m) % m;
  }

  function paintIdeaReel() {
    const reel = els.ideasReel;
    if (!reel) return;
    if (!ideaReel.length) {
      reel.innerHTML = "";
      const empty = document.createElement("p");
      empty.className = "ideas-empty";
      empty.textContent = ideaFilter
        ? `No ${ideaFilter} prompts left — try the other filter`
        : "No prompts left";
      reel.appendChild(empty);
      return;
    }
    const n = ideaReel.length;
    const center = ideaMod(Math.round(ideaOffset), n);
    const half = Math.floor(IDEA_VISIBLE / 2);
    reel.innerHTML = "";

    for (let slot = -half; slot <= half; slot++) {
      const idx = ideaMod(center + slot, n);
      const item = ideaReel[idx];
      const dist = slot - (ideaOffset - Math.round(ideaOffset));
      const angle = dist * 22;
      const y = dist * IDEA_ITEM_H;
      const scale = Math.max(0.72, 1 - Math.abs(dist) * 0.1);
      const opacity = Math.max(0.18, 1 - Math.abs(dist) * 0.28);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ideas-item";
      if (Math.abs(dist) < 0.35) btn.classList.add("is-center");
      btn.dataset.vibe = item.vibe;
      btn.dataset.id = item.id;
      btn.title = "Tap to fill the question box";
      btn.innerHTML = `<span>${escapeHtml(item.text)}</span>`;
      btn.style.transform = `translate(-50%, -50%) translateY(${y}px) rotateX(${-angle}deg) scale(${scale})`;
      btn.style.left = "50%";
      btn.style.width = "calc(100% - 1.1rem)";
      btn.style.opacity = String(opacity);
      btn.style.zIndex = String(20 - Math.abs(Math.round(dist)));
      reel.appendChild(btn);
    }
  }

  function fillQuestionFromIdea(text) {
    const input = els.questionInput || document.getElementById("question-input");
    if (!input) return;
    input.value = text;
    input.focus();
    try {
      const len = text.length;
      input.setSelectionRange(len, len);
    } catch (_) {
      /* some browsers dislike setSelectionRange on empty */
    }
  }

  function restorePendingIdeaToReel() {
    if (!pendingIdea) return;
    // Pull out the stand-in that filled its slot, if still on the reel
    if (pendingReplacementId) {
      const rIdx = ideaReel.findIndex((x) => x.id === pendingReplacementId);
      if (rIdx >= 0) {
        const [standIn] = ideaReel.splice(rIdx, 1);
        ideaReserve.unshift(standIn);
      }
    }
    const fitsFilter = !ideaFilter || pendingIdea.vibe === ideaFilter;
    if (fitsFilter && !ideaReel.some((x) => x.id === pendingIdea.id || x.text === pendingIdea.text)) {
      ideaReel.unshift(pendingIdea);
    }
    pendingIdea = null;
    pendingReplacementId = null;
    if (ideaReel.length) {
      ideaOffset = ideaMod(Math.round(ideaOffset), ideaReel.length);
    }
    paintIdeaReel();
  }

  function clearPendingIdeaConsumed() {
    pendingIdea = null;
    pendingReplacementId = null;
  }

  function pickIdeaSuggestion(id) {
    if (state?.questionsLocked) return;
    // Putting a new prompt in the box abandons the previous unsubmitted one
    if (pendingIdea && pendingIdea.id !== id) {
      restorePendingIdeaToReel();
    }
    const idx = ideaReel.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const [picked] = ideaReel.splice(idx, 1);
    pendingIdea = picked;
    pendingReplacementId = null;

    if (ideaReserve.length) {
      const standIn = ideaReserve.shift();
      pendingReplacementId = standIn.id;
      const insertAt = Math.min(idx, ideaReel.length);
      ideaReel.splice(insertAt, 0, standIn);
    } else if (!ideaReel.length) {
      // Last prompt on the reel — leave wheel empty until they abandon or submit
      fillQuestionFromIdea(picked.text);
      paintIdeaReel();
      return;
    }

    fillQuestionFromIdea(picked.text);
    ideaOffset = ideaMod(Math.round(ideaOffset), Math.max(ideaReel.length, 1));
    paintIdeaReel();
  }

  function syncPendingIdeaWithInput() {
    if (!pendingIdea) return;
    const input = els.questionInput || document.getElementById("question-input");
    const current = (input?.value || "").trim();
    // Still holding the exact prompt → keep it out of the wheel
    if (current === pendingIdea.text.trim()) return;
    // Cleared or edited → return prompt to the reel
    restorePendingIdeaToReel();
  }

  function nudgeIdeaReel(delta) {
    if (!ideaReel.length) return;
    ideaOffset += delta;
    paintIdeaReel();
  }

  function wireIdeasWheel() {
    if (ideasWired || !els.ideasWheel) return;
    ideasWired = true;
    const wheel = els.ideasWheel;

    document.querySelectorAll("[data-idea-filter]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const vibe = btn.getAttribute("data-idea-filter");
        if (!vibe) return;
        setIdeaFilter(vibe);
      });
    });

    wheel.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const dir = e.deltaY > 0 ? 0.28 : -0.28;
        nudgeIdeaReel(dir);
      },
      { passive: false }
    );

    const onDown = (clientY) => {
      ideasDrag = { y: clientY, offset: ideaOffset, moved: 0 };
      wheel.classList.add("is-dragging");
    };
    const onMove = (clientY) => {
      if (!ideasDrag) return;
      const dy = clientY - ideasDrag.y;
      ideasDrag.moved = Math.max(ideasDrag.moved || 0, Math.abs(dy));
      // Ignore micro-jitter so taps don't rebuild the reel mid-click
      if (ideasDrag.moved <= 10) return;
      ideaOffset = ideasDrag.offset - dy / IDEA_ITEM_H;
      paintIdeaReel();
    };
    const onUp = (e) => {
      if (!ideasDrag) return;
      const moved = ideasDrag.moved || 0;
      ideasDrag = null;
      wheel.classList.remove("is-dragging");

      // Tap (not a drag): fill the text box from the prompt under the pointer
      if (moved <= 10) {
        const under =
          (e && typeof e.clientX === "number"
            ? document.elementFromPoint(e.clientX, e.clientY)
            : null)?.closest?.(".ideas-item") || null;
        if (under?.dataset?.id) {
          pickIdeaSuggestion(under.dataset.id);
          return;
        }
        if (ideaReel.length) {
          const center = ideaMod(Math.round(ideaOffset), ideaReel.length);
          pickIdeaSuggestion(ideaReel[center].id);
          return;
        }
      }

      ideaOffset = Math.round(ideaOffset);
      paintIdeaReel();
    };

    wheel.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      // Don't capture yet — allows the button to remain the click target on taps
      onDown(e.clientY);
    });
    wheel.addEventListener("pointermove", (e) => {
      if (!ideasDrag) return;
      if ((ideasDrag.moved || 0) > 4 && !wheel.hasPointerCapture?.(e.pointerId)) {
        try {
          wheel.setPointerCapture(e.pointerId);
        } catch (_) {}
      }
      onMove(e.clientY);
    });
    wheel.addEventListener("pointerup", onUp);
    wheel.addEventListener("pointercancel", onUp);
  }

  function ensureIdeasPanel() {
    wireIdeasWheel();
    if (!ideaReel.length) resetIdeaReel();
    else {
      paintIdeaReel();
      syncIdeaFilterButtons();
    }
    if (els.ideasPanel) {
      els.ideasPanel.classList.toggle("is-locked", !!state?.questionsLocked);
    }
  }

  function renderQuestions() {
    const self = getPlayer(me.id);
    const late = !!self?.lateJoin;
    const nPlayers = poolPlayers().length || activePlayers().length;
    const minQ = minimumQuestionsRequired();
    const have = state.questions?.length || 0;
    const ready = have >= minQ;
    const remaining =
      ((state.questionEndsAt || Date.now() + QUESTION_SECONDS * 1000) - Date.now()) /
      1000;

    if (els.questionTimer) {
      els.questionTimer.textContent = formatTime(remaining);
      els.questionTimer.classList.toggle("urgent", remaining <= 30);
    }
    els.questionCount.textContent = String(have);

    const title = document.querySelector("#screen-questions .section-title");
    const sub = document.querySelector("#screen-questions .section-sub");
    if (title) title.textContent = late ? "You’re in" : "Question pool";
    if (sub) {
      if (late) {
        sub.textContent =
          "You joined mid-game — hang tight. You’ll play with the questions already in the pool once the host starts.";
      } else if (me.isHost) {
        sub.textContent = ready
          ? "Pool ready! Keep adding until the timer ends, or start the game now."
          : `One shared pot · at least ${minQ} questions (${nPlayers}×5) · ${formatTime(Math.max(0, remaining))} left to add more.`;
      } else {
        sub.textContent = ready
          ? "Pool ready. Keep adding questions — the host will start the game."
          : `Add questions to the pot · need ${minQ} total (${nPlayers}×5) · waiting on the host to start.`;
      }
    }

    const statusEl = document.getElementById("pool-status");
    if (statusEl) {
      statusEl.textContent = late
        ? `Watching · ${have} questions in the pool`
        : ready
          ? `✓ Enough questions to start · ${have} / ${minQ}`
          : `${have} / ${minQ} minimum questions`;
      statusEl.classList.toggle("pool-ready", ready && !late);
    }

    // Host-only: start the wheel once the pool minimum is met
    let hostBtn = document.getElementById("btn-start-game");
    if (!me.isHost) {
      if (hostBtn) hostBtn.remove();
    } else {
      if (!hostBtn && els.questionForm?.parentElement) {
        hostBtn = document.createElement("button");
        hostBtn.type = "button";
        hostBtn.id = "btn-start-game";
        hostBtn.className = "btn btn-primary btn-lg";
        hostBtn.style.marginTop = "0.75rem";
        els.questionForm.parentElement.appendChild(hostBtn);
      }
      if (hostBtn) {
        hostBtn.hidden = false;
        hostBtn.style.display = "";
        hostBtn.disabled = !ready || !!state.questionsLocked;
        hostBtn.textContent = ready
          ? `Start game now (${have} in pool)`
          : `Need ${minQ - have} more question${minQ - have === 1 ? "" : "s"}`;
        hostBtn.onclick = () => {
          if (!me.isHost) return;
          send({ type: "questionsDone", playerId: me.id });
        };
      }
    }

    const legacyBtn = document.getElementById("btn-begin-finals");
    if (legacyBtn) legacyBtn.hidden = true;

    els.myQuestions.innerHTML = "";
    myLocalQuestions.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = typeof item === "string" ? item : item.text;
      els.myQuestions.appendChild(li);
    });

    const allowSubmit = canSubmitQuestions();
    if (els.questionForm) {
      els.questionForm.hidden = !allowSubmit;
      els.questionForm.style.display = allowSubmit ? "" : "none";
    }
    if (els.ideasPanel) {
      els.ideasPanel.hidden = !allowSubmit;
      els.ideasPanel.style.display = allowSubmit ? "" : "none";
    }
    if (els.questionInput) els.questionInput.disabled = !allowSubmit;
    const addBtn = els.questionForm?.querySelector('button[type="submit"]');
    if (addBtn) addBtn.disabled = !allowSubmit;

    ensureIdeasPanel();

    // Host can launch TARGET once the pool is live / locked
    let targetBtn = document.getElementById("btn-start-target-q");
    if (canStartTarget()) {
      if (!targetBtn && els.questionForm?.parentElement) {
        targetBtn = document.createElement("button");
        targetBtn.type = "button";
        targetBtn.id = "btn-start-target-q";
        targetBtn.className = "btn btn-ghost";
        targetBtn.style.marginTop = "0.5rem";
        els.questionForm.parentElement.appendChild(targetBtn);
      }
      if (targetBtn) {
        targetBtn.hidden = false;
        targetBtn.textContent = "Start TARGET round";
        targetBtn.onclick = () => send({ type: "startTarget", playerId: me.id });
      }
    } else if (targetBtn) {
      targetBtn.hidden = true;
    }

    // Host can remove players during the question pool
    let hostKickList = document.getElementById("host-kick-list");
    if (me.isHost) {
      if (!hostKickList) {
        const aside = document.querySelector("#screen-questions .questions-aside");
        if (aside) {
          hostKickList = document.createElement("ul");
          hostKickList.id = "host-kick-list";
          hostKickList.className = "host-kick-list";
          aside.appendChild(hostKickList);
        }
      }
      if (hostKickList) {
        hostKickList.hidden = false;
        hostKickList.innerHTML = "";
        activePlayers()
          .filter((p) => p.id !== me.id)
          .forEach((p) => {
            const li = document.createElement("li");
            li.className = "host-kick-row";
            li.innerHTML = `<span>${escapeHtml(p.name)}</span>`;
            const kick = document.createElement("button");
            kick.type = "button";
            kick.className = "btn-kick";
            kick.textContent = "Remove";
            kick.onclick = () => hostKickPlayer(p.id, p.name);
            li.appendChild(kick);
            hostKickList.appendChild(li);
          });
      }
    } else if (hostKickList) {
      hostKickList.hidden = true;
      hostKickList.innerHTML = "";
    }

    questionTick = setInterval(() => {
      if (!state || state.phase !== "questions" || state.questionsLocked) return;
      const left = ((state.questionEndsAt || Date.now()) - Date.now()) / 1000;
      if (els.questionTimer) {
        els.questionTimer.textContent = formatTime(left);
        els.questionTimer.classList.toggle("urgent", left <= 30);
      }
      if (left > 0) return;
      if (!me.isHost) return;
      clearInterval(questionTick);
      questionTick = null;
      const minNeeded = minimumQuestionsRequired();
      if ((state.questions?.length || 0) >= minNeeded) {
        handleAction({ type: "questionsDone", playerId: me.id });
      } else {
        // Keep the window open until the minimum is met
        state.questionEndsAt = Date.now() + QUESTION_SECONDS * 1000;
        publish();
        toast(
          `Still need ${(minNeeded - (state.questions?.length || 0))} more questions — timer extended`
        );
      }
    }, 250);
  }

  async function hostKickPlayer(playerId, name) {
    if (!me.isHost || !playerId || playerId === me.id) return;
    const who = name || "this player";
    const ok = await showConfirm({
      eyebrow: "Host call",
      title: `Boot ${who}?`,
      message: "They’ll leave the room right away. The game keeps going without them.",
      cancelLabel: "Keep them",
      okLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    send({ type: "kick", playerId, requestedBy: me.id });
  }

  async function hostSkipForCurrent() {
    if (!me.isHost || !state?.currentPlayerId) return;
    const picked = getPlayer(state.currentPlayerId);
    if (!picked) return;
    const ok = await showConfirm({
      eyebrow: "Host call",
      title: `Skip for ${picked.name}?`,
      message: "Counts as one of their skips, then the wheel moves on.",
      cancelLabel: "Wait",
      okLabel: "Skip it",
      danger: true,
    });
    if (!ok) return;
    send({
      type: "skip",
      playerId: picked.id,
      requestedBy: me.id,
    });
  }

  function renderGame() {
    const alive = wheelPlayers();
    els.scoreStrip.innerHTML = "";
    alive.forEach((p) => {
      const chip = document.createElement("span");
      chip.className = "score-chip";
      chip.innerHTML = `${escapeHtml(p.name)} · answered <strong>${p.answered ?? 0}</strong> · picks <strong>${getSelections(p)}</strong> · skips <strong>${p.skips}/${MAX_SKIPS}</strong>`;
      if (me.isHost && p.id !== me.id) {
        const kick = document.createElement("button");
        kick.type = "button";
        kick.className = "btn-kick btn-kick-chip";
        kick.textContent = "Kick";
        kick.title = `Kick ${p.name}`;
        kick.setAttribute("aria-label", `Kick ${p.name}`);
        kick.onclick = (e) => {
          e.stopPropagation();
          hostKickPlayer(p.id, p.name);
        };
        chip.appendChild(kick);
      }
      els.scoreStrip.appendChild(chip);
    });

    // Host: launch TARGET mid-game
    if (canStartTarget()) {
      const startT = document.createElement("button");
      startT.type = "button";
      startT.className = "btn-kick";
      startT.textContent = "TARGET";
      startT.title = "Start a TARGET round";
      startT.style.marginLeft = "0.35rem";
      startT.onclick = () => send({ type: "startTarget", playerId: me.id });
      els.scoreStrip.appendChild(startT);
    }

    const highlightIdx =
      state.phase === "answering" || state.phase === "confirm"
        ? state.spinTargetIndex
        : state.phase === "spinning"
          ? state.spinTargetIndex
          : -1;

    if (state.phase === "spinning" && state.spinToken !== lastSpinToken) {
      els.wheelCaption.textContent = "The wheel decides…";
      if (resumeSkipSpinAnim) {
        // Refresh/resume mid-spin: land immediately, don’t replay 5s spin
        resumeSkipSpinAnim = false;
        snapWheelToTarget(alive);
        drawWheel(alive, wheelAngle, state.spinTargetIndex);
        paintGameWheel(alive, state.spinTargetIndex);
      } else {
        animateWheelToIndex(alive, state.spinTargetIndex, state.spinToken);
      }
    } else if (state.phase === "answering" || state.phase === "confirm") {
      // Mid-turn refresh or phase flip during an in-flight spin
      if (wheelSpinning || lastSpinToken !== (state.spinToken || 0)) {
        snapWheelToTarget(alive);
      }
      resumeSkipSpinAnim = false;
      drawWheel(alive, wheelAngle, highlightIdx);
      paintGameWheel(alive, highlightIdx);
    } else if (!wheelSpinning) {
      drawWheel(alive, wheelAngle, -1);
      paintGameWheel(alive, -1);
    }

    const picked = getPlayer(state.currentPlayerId);
    const question = state.questions.find((q) => q.id === state.currentQuestionId);
    const isMe = state.currentPlayerId === me.id;
    const panel = els.actionPanel;
    panel.innerHTML = "";

    if (state.phase === "spinning") {
      panel.innerHTML = `<p class="waiting-note">Hold tight — a name is about to land.</p>`;
      return;
    }

    if (!picked || !question) {
      panel.innerHTML = `<p class="waiting-note">Preparing next spin…</p>`;
      return;
    }

    els.wheelCaption.textContent = `${picked.name} is up`;

    const nameEl = document.createElement("p");
    nameEl.className = "picked-name";
    nameEl.textContent = picked.name;
    panel.appendChild(nameEl);

    const qEl = document.createElement("p");
    qEl.className = "question-display";
    qEl.textContent = question.text;
    panel.appendChild(qEl);

    if (state.phase === "answering") {
      const deadlineEl = document.createElement("p");
      deadlineEl.className = "answer-deadline";
      deadlineEl.id = "answer-deadline";
      panel.appendChild(deadlineEl);

      const paintDeadline = () => {
        if (!state || state.phase !== "answering") return;
        const ends = state.answerEndsAt || Date.now() + ANSWER_SECONDS * 1000;
        const left = Math.max(0, (ends - Date.now()) / 1000);
        deadlineEl.textContent =
          left > 0
            ? `${formatTime(left)} to skip or answer`
            : "Time’s up — passing on…";
        deadlineEl.classList.toggle("urgent", left <= 10);
      };
      paintDeadline();
      answerDeadlineTick = setInterval(paintDeadline, 200);

      if (isMe) {
        const warn = document.createElement("p");
        warn.className = "skip-warn";
        warn.textContent =
          state.startingPlayerCount === 2
            ? `Skips: ${picked.skips} (no elimination in a 2-player game)`
            : `Picks: ${getSelections(picked)} · skips: ${picked.skips}/${MAX_SKIPS} (${MAX_SKIPS - picked.skips} left before you’re out)`;
        panel.appendChild(warn);

        const row = document.createElement("div");
        row.className = "choice-row";
        row.innerHTML = `
          <button type="button" class="btn btn-danger" id="btn-skip">Skip</button>
          <button type="button" class="btn btn-primary" id="btn-answer">I’ll answer</button>
        `;
        panel.appendChild(row);
        $("#btn-skip", panel).onclick = () =>
          send({ type: "skip", playerId: me.id, requestedBy: me.id });
        $("#btn-answer", panel).onclick = () =>
          send({ type: "chooseAnswer", playerId: me.id });
      } else {
        const note = document.createElement("p");
        note.className = "waiting-note";
        note.textContent = `Waiting for ${picked.name} to skip or answer…`;
        panel.appendChild(note);
        if (me.isHost) {
          const row = document.createElement("div");
          row.className = "choice-row host-force-row";
          const skipBtn = document.createElement("button");
          skipBtn.type = "button";
          skipBtn.className = "btn btn-danger";
          skipBtn.textContent = `Skip for ${picked.name}`;
          skipBtn.onclick = () => hostSkipForCurrent();
          row.appendChild(skipBtn);
          panel.appendChild(row);
        }
      }

      // Host: keep the respond timer armed across re-renders
      if (me.isHost) armAnswerTimeout();
    }

    if (state.phase === "confirm") {
      if (isMe) {
        const note = document.createElement("p");
        note.className = "waiting-note";
        note.textContent = "Shout your answer out loud. When you’re done:";
        panel.appendChild(note);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-ok btn-lg";
        btn.textContent = "Have you answered? — Yes";
        btn.onclick = () => send({ type: "confirmAnswered", playerId: me.id });
        panel.appendChild(btn);
      } else {
        const note = document.createElement("p");
        note.className = "waiting-note";
        note.textContent = `${picked.name} is answering out loud…`;
        panel.appendChild(note);
        if (me.isHost) {
          const row = document.createElement("div");
          row.className = "choice-row host-force-row";
          const skipBtn = document.createElement("button");
          skipBtn.type = "button";
          skipBtn.className = "btn btn-danger";
          skipBtn.textContent = `Skip for ${picked.name}`;
          skipBtn.onclick = () => hostSkipForCurrent();
          row.appendChild(skipBtn);
          panel.appendChild(row);
        }
      }
    }
  }

  function renderTarget() {
    const root = els.targetStage;
    if (!root || !state?.target) return;
    const t = state.target;
    const parts = targetParticipants();
    const readyN = targetSubmissionCount();
    const totalN = parts.length;
    const amParticipant = (t.participantIds || []).includes(me.id);
    const self = getPlayer(me.id);
    const mySub = t.submissions?.[me.id];
    const item = currentTargetItem();
    const chainLen = t.chain?.length || targetChainLength(totalN);
    const chainPos = Math.min((t.chainIndex || 0) + 1, chainLen || 1);

    root.innerHTML = "";
    const card = document.createElement("div");
    card.className = "target-card";

    if (t.stage === "intro") {
      card.innerHTML = `
        <p class="eyebrow">Special round</p>
        <h2>TARGET</h2>
        <p class="lead">Everyone writes one anonymous question and chooses one person. Nobody knows who chose them.</p>
        <p class="target-progress">${totalN} players in · ${targetChainLength(totalN)} questions will be played</p>
      `;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary btn-lg";
      btn.textContent = "BEGIN";
      btn.onclick = () => send({ type: "targetBegin", playerId: me.id });
      card.appendChild(btn);
      root.appendChild(card);
      return;
    }

    if (t.stage === "setup") {
      const prog = document.createElement("p");
      prog.className = "target-progress";
      prog.textContent = `${readyN} / ${totalN} players ready`;
      card.appendChild(prog);

      if (!amParticipant || self?.kicked) {
        const note = document.createElement("p");
        note.className = "lead";
        note.textContent = "You’re spectating this TARGET round.";
        card.appendChild(note);
      } else if (mySub?.text && mySub?.targetId) {
        const note = document.createElement("p");
        note.className = "lead";
        note.textContent = "You’re in. Waiting on everyone else…";
        card.appendChild(note);
      } else {
        const form = document.createElement("form");
        form.className = "target-form";
        form.innerHTML = `
          <label>
            <span>Your anonymous question</span>
            <textarea id="target-q-input" maxlength="200" required placeholder="Ask something only they can answer…"></textarea>
          </label>
          <div>
            <span style="display:block;font-size:0.75rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);margin-bottom:0.35rem">Choose your target</span>
            <div class="target-pick-grid" id="target-pick-grid"></div>
          </div>
          <button type="submit" class="btn btn-primary btn-lg">Lock in</button>
        `;
        const grid = form.querySelector("#target-pick-grid");
        parts
          .filter((p) => p.id !== me.id)
          .forEach((p) => {
            const lab = document.createElement("label");
            lab.className = "target-pick";
            lab.innerHTML = `<input type="radio" name="target-pick" value="${p.id.replace(/"/g, "")}" required /> <span>${escapeHtml(p.name)}</span>`;
            lab.querySelector("input").addEventListener("change", () => {
              grid.querySelectorAll(".target-pick").forEach((el) => el.classList.remove("is-selected"));
              lab.classList.add("is-selected");
            });
            grid.appendChild(lab);
          });
        form.onsubmit = (e) => {
          e.preventDefault();
          const text = form.querySelector("#target-q-input")?.value?.trim();
          const targetId = form.querySelector('input[name="target-pick"]:checked')?.value;
          if (!text || !targetId) return;
          send({ type: "targetSubmit", playerId: me.id, text, targetId });
        };
        card.appendChild(form);
      }

      const list = document.createElement("ul");
      list.className = "target-ready-list";
      parts.forEach((p) => {
        const li = document.createElement("li");
        const done = !!(t.submissions?.[p.id]?.text && t.submissions?.[p.id]?.targetId);
        if (done) li.classList.add("is-ready");
        li.innerHTML = `<span>${escapeHtml(p.name)}${p.id === me.id ? " (you)" : ""}</span><span>${done ? "ready" : "writing…"}</span>`;
        list.appendChild(li);
      });
      card.appendChild(list);
      root.appendChild(card);
      return;
    }

    if (t.stage === "broken") {
      card.classList.add("target-broken");
      card.innerHTML = `
        <p class="eyebrow">Chain ended</p>
        <h2>TARGET BROKEN</h2>
        <p class="target-nameplate">${escapeHtml(t.brokenName || "Player")} HAS BEEN ELIMINATED</p>
        <p class="lead">The remaining TARGET questions are wasted. Returning to Icebreaker…</p>
      `;
      root.appendChild(card);
      return;
    }

    if (t.stage === "complete") {
      card.innerHTML = `
        <p class="eyebrow">Round clear</p>
        <h2>TARGET complete</h2>
        <p class="lead">Everyone who was asked answered. Back to the wheel…</p>
      `;
      root.appendChild(card);
      return;
    }

    if (t.stage === "continue") {
      card.innerHTML = `
        <p class="eyebrow">Locked in</p>
        <h2>TARGET continues…</h2>
        <p class="lead">Next anonymous hit incoming.</p>
      `;
      root.appendChild(card);
      return;
    }

    // reveal_q / reveal_target / choose
    const mark = document.createElement("p");
    mark.className = "target-chain-mark";
    mark.textContent = `TARGET ${chainPos} / ${chainLen}`;
    card.appendChild(mark);

    if (!item) {
      const lead = document.createElement("p");
      lead.className = "lead";
      lead.textContent = "Preparing…";
      card.appendChild(lead);
      root.appendChild(card);
      return;
    }

    const qEl = document.createElement("p");
    qEl.className = "target-question";
    qEl.textContent = item.text;
    card.appendChild(qEl);

    if (t.stage === "reveal_q") {
      const lead = document.createElement("p");
      lead.className = "lead";
      lead.textContent = "Someone in this room wrote this. Nobody knows who.";
      card.appendChild(lead);
      root.appendChild(card);
      return;
    }

    const targetPlayer = getPlayer(item.targetId);
    const plate = document.createElement("p");
    plate.className = "target-nameplate";
    plate.textContent = `TARGET: ${(targetPlayer?.name || "—").toUpperCase()}`;
    card.appendChild(plate);

    if (t.stage === "reveal_target") {
      const lead = document.createElement("p");
      lead.className = "lead";
      lead.textContent =
        item.targetId === me.id
          ? "That’s you. Get ready."
          : "Only they can answer — everyone else watches.";
      card.appendChild(lead);
      root.appendChild(card);
      return;
    }

    // choose
    if (item.targetId === me.id && self && !self.kicked) {
      const lead = document.createElement("p");
      lead.className = "lead";
      lead.textContent = "Answer out loud — or skip and you’re out of the whole game.";
      card.appendChild(lead);
      const row = document.createElement("div");
      row.className = "target-actions row";
      const skipBtn = document.createElement("button");
      skipBtn.type = "button";
      skipBtn.className = "btn btn-danger";
      skipBtn.textContent = "SKIP";
      skipBtn.onclick = async () => {
        const ok = await showConfirm({
          eyebrow: "TARGET",
          title: "Skip?",
          message:
            "You will be eliminated from the game. The TARGET chain ends here — later questions are wasted.",
          cancelLabel: "Stay",
          okLabel: "Skip & leave game",
          danger: true,
        });
        if (!ok) return;
        send({ type: "targetSkip", playerId: me.id });
      };
      const ansBtn = document.createElement("button");
      ansBtn.type = "button";
      ansBtn.className = "btn btn-primary";
      ansBtn.textContent = "ANSWER";
      ansBtn.onclick = () => send({ type: "targetAnswer", playerId: me.id });
      row.appendChild(skipBtn);
      row.appendChild(ansBtn);
      card.appendChild(row);
    } else {
      const lead = document.createElement("p");
      lead.className = "lead";
      lead.textContent = `Waiting for ${targetPlayer?.name || "them"}…`;
      card.appendChild(lead);
    }

    root.appendChild(card);
  }

  function renderWildcard() {
    const root = els.wildcardStage;
    if (!root || !state?.wildcard) return;
    const w = state.wildcard;
    const subject = getPlayer(w.playerId);
    const name = subject?.name || "Player";
    const isSubject = me.id === w.playerId;
    const self = getPlayer(me.id);

    root.innerHTML = "";
    const card = document.createElement("div");
    card.className = "wildcard-card";

    if (w.stage === "intro") {
      card.innerHTML = `
        <p class="eyebrow">Comeback chance</p>
        <h2>WILDCARD</h2>
        <p class="wildcard-nameplate">${escapeHtml(name)}</p>
        <p class="lead">${escapeHtml(name)} has one chance to come back.<br/>They have something to confess.</p>
      `;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary btn-lg";
      btn.textContent = "CONTINUE";
      btn.onclick = () => send({ type: "wildcardBegin", playerId: me.id });
      card.appendChild(btn);
      root.appendChild(card);
      return;
    }

    if (w.stage === "confession") {
      if (isSubject) {
        card.innerHTML = `
          <p class="eyebrow">Your chance</p>
          <h2>CONFESS SOMETHING</h2>
          <p class="lead">Tell the players something they don’t know about you.</p>
        `;
        const form = document.createElement("form");
        form.className = "wildcard-form";
        form.innerHTML = `
          <label>
            <span>Confession</span>
            <textarea id="wildcard-confession-input" maxlength="280" required placeholder="Something only you know…"></textarea>
          </label>
          <button type="submit" class="btn btn-primary btn-lg">SUBMIT CONFESSION</button>
        `;
        form.onsubmit = (e) => {
          e.preventDefault();
          const text = form.querySelector("#wildcard-confession-input")?.value || "";
          send({ type: "wildcardConfess", playerId: me.id, text });
        };
        card.appendChild(form);
      } else {
        card.innerHTML = `
          <p class="eyebrow">WILDCARD</p>
          <h2>${escapeHtml(name)} is confessing…</h2>
          <p class="lead">Waiting for their confession.</p>
        `;
      }
      root.appendChild(card);
      return;
    }

    if (w.stage === "reveal") {
      card.innerHTML = `
        <p class="eyebrow">${escapeHtml(name.toUpperCase())}’S CONFESSION</p>
        <h2>WILDCARD</h2>
        <p class="wildcard-confession">“${escapeHtml(w.confession || "")}”</p>
        <p class="lead">Votes are coming up…</p>
      `;
      root.appendChild(card);
      return;
    }

    if (w.stage === "voting") {
      const voterIds = w.voterIds || [];
      const castN =
        typeof w.votedCount === "number"
          ? w.votedCount
          : Object.keys(w.votes || {}).length;
      const totalN = voterIds.length;
      const canVote = voterIds.includes(me.id) && !isSubject && self && !self.kicked;
      const myVote = myWildcardVote || (w.votes || {})[me.id];

      card.innerHTML = `
        <p class="eyebrow">${escapeHtml(name.toUpperCase())}’S CONFESSION</p>
        <h2>Should they return?</h2>
        <p class="wildcard-confession">“${escapeHtml(w.confession || "")}”</p>
        <p class="wildcard-progress">${castN} / ${totalN} votes in · anonymous</p>
      `;

      if (isSubject) {
        const note = document.createElement("p");
        note.className = "lead";
        note.textContent = "You can’t vote on your own return. Waiting…";
        card.appendChild(note);
      } else if (canVote) {
        const row = document.createElement("div");
        row.className = "wildcard-vote-row";
        const yes = document.createElement("button");
        yes.type = "button";
        yes.className = "btn btn-primary btn-lg";
        yes.textContent = myVote === "yes" ? "✓ LET THEM BACK IN" : "LET THEM BACK IN";
        yes.onclick = () => {
          myWildcardVote = "yes";
          render();
          send({ type: "wildcardVote", playerId: me.id, vote: "yes" });
        };
        const no = document.createElement("button");
        no.type = "button";
        no.className = "btn btn-danger btn-lg";
        no.textContent = myVote === "no" ? "✓ KEEP THEM OUT" : "KEEP THEM OUT";
        no.onclick = () => {
          myWildcardVote = "no";
          render();
          send({ type: "wildcardVote", playerId: me.id, vote: "no" });
        };
        row.appendChild(yes);
        row.appendChild(no);
        card.appendChild(row);
        if (myVote) {
          const note = document.createElement("p");
          note.className = "lead";
          note.textContent = "Vote locked in. Waiting on everyone else…";
          card.appendChild(note);
        }
      } else {
        const note = document.createElement("p");
        note.className = "lead";
        note.textContent = "You’re spectating this vote.";
        card.appendChild(note);
      }
      root.appendChild(card);
      return;
    }

    if (w.stage === "result") {
      const success = w.result === "success";
      card.classList.add(success ? "is-success" : "is-fail");
      card.innerHTML = `
        <p class="eyebrow">${success ? "WILDCARD SUCCESS" : "WILDCARD FAILED"}</p>
        <h2>${success ? `${escapeHtml(name)} IS BACK.` : `${escapeHtml(name)} STAYS OUT.`}</h2>
        <p class="wildcard-result-counts">YES ${w.yesCount ?? 0} · NO ${w.noCount ?? 0}</p>
        <p class="lead">${success ? "Back in the game — one chance used." : "Permanently out of this game."}</p>
      `;
      root.appendChild(card);
      return;
    }

    root.appendChild(card);
  }

  function renderFinals() {
    const f = state.finals;
    if (!f) return;
    const a = getPlayer(f.aId);
    const b = getPlayer(f.bId);
    els.finalistAName.textContent = a?.name || "—";
    els.finalistBName.textContent = b?.name || "—";
    els.finalistAScore.textContent = String(f.aScore);
    els.finalistBScore.textContent = String(f.bScore);

    const amA = me.id === f.aId;
    const amB = me.id === f.bId;
    const self = getPlayer(me.id);
    const amFinalist = (amA || amB) && self && !self.kicked;
    const canBuzz = f.phase === "open" && amFinalist;
    const someoneBuzzed = !!f.buzzedBy;
    const q = f.questions[f.index];

    if (els.buzzerMain) {
      els.buzzerMain.disabled = !canBuzz;
      els.buzzerMain.classList.toggle("lit", someoneBuzzed);
      els.buzzerMain.classList.toggle("is-pressed", someoneBuzzed);
    }

    els.finalsControls.innerHTML = "";

    if (self?.kicked) {
      els.finalsPhaseLabel.textContent = "You’re out";
      els.finalsQuestion.textContent = `${a?.name || "—"} vs ${b?.name || "—"} in rapid fire. Spectate only — you can’t buzz.`;
      if (els.buzzerHint) els.buzzerHint.textContent = "You’re out — spectate only";
      return;
    }

    // Legacy ready → kick into show/open
    if (f.phase === "ready") {
      if (me.isHost) send({ type: "startFinalsClock" });
      els.finalsPhaseLabel.textContent = "Rapid Fire";
      els.finalsQuestion.textContent = "Starting…";
      const totalReady = f.questions?.length || 0;
      els.finalsTimer.textContent = totalReady ? `1 / ${totalReady}` : "—";
      if (els.buzzerHint) els.buzzerHint.textContent = "Starting…";
      return;
    }

    if (!q && f.phase !== "show") {
      els.finalsQuestion.textContent = "Wrapping up…";
      if (els.buzzerHint) els.buzzerHint.textContent = "";
      return;
    }

    if (q) {
      els.finalsQuestion.textContent = q.text;
    }

    const totalQs = f.questions?.length || 0;
    const qNum = Math.min((f.index || 0) + 1, totalQs);
    if (els.finalsTimer) {
      els.finalsTimer.textContent = totalQs ? `${qNum} / ${totalQs}` : "—";
    }

    const updateTick = () => {
      if (!state?.finals) return;
      const cur = state.finals;
      // Question is visible; arm buzzers after the reveal beat
      if (
        cur.phase === "show" &&
        me.isHost &&
        Date.now() >= (cur.buzzOpensAt || 0)
      ) {
        send({ type: "openBuzzers" });
      }
    };
    updateTick();
    clearInterval(finalsTick);
    finalsTick = setInterval(updateTick, 200);

    const amBuzzed = me.id === f.buzzedBy;
    const buzzedName = getPlayer(f.buzzedBy)?.name || "Player";

    if (f.phase === "show") {
      els.finalsPhaseLabel.textContent = "Read it…";
      if (els.buzzerHint) {
        els.buzzerHint.textContent = amFinalist
          ? "Buzzer arms in a moment…"
          : "Spectating…";
      }
      return;
    }

    if (f.phase === "open") {
      els.finalsPhaseLabel.textContent = "Buzz in!";
      if (els.buzzerHint) {
        els.buzzerHint.textContent = amFinalist ? "Smash it!" : "Spectating";
      }
      return;
    }

    if (f.phase === "confirm") {
      els.finalsPhaseLabel.textContent = `${buzzedName} buzzed`;
      if (els.buzzerHint) {
        els.buzzerHint.textContent = amBuzzed
          ? "Say your answer out loud"
          : `${buzzedName} is answering…`;
      }
      if (amBuzzed) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-ok btn-lg";
        btn.id = "btn-confirm-answered";
        btn.textContent = "Have you said the answer? — Yes";
        btn.onclick = () => send({ type: "finalsConfirmAnswered", playerId: me.id });
        els.finalsControls.appendChild(btn);
      }
    }
  }

  function renderEnd() {
    const winner = getPlayer(state.winnerId);
    const revealFor = getPlayer(state.revealForId);
    const scores = state.finalsAnswerScores;
    const winScore =
      scores && state.winnerId != null ? scores[state.winnerId] : null;

    els.endTitle.textContent = winner ? `${winner.name} takes it` : "That’s a wrap";
    if (winner && winScore != null) {
      els.endSub.textContent = `${winner.name} won rapid fire with ${winScore} answer${winScore === 1 ? "" : "s"} (buzz in, shout it out).`;
    } else if (winner) {
      els.endSub.textContent = `${winner.name} wins.`;
    } else {
      els.endSub.textContent = "Thanks for playing.";
    }
    if (revealFor) {
      const n = revealFor.answered ?? 0;
      els.endSub.textContent += ` ${revealFor.name} earned the author reveal (${n} answer${n === 1 ? "" : "s"} total, including rapid fire).`;
    }

    const ranked = [...state.players].sort(
      (a, b) => (b.answered ?? 0) - (a.answered ?? 0) || getSelections(b) - getSelections(a)
    );
    els.standings.innerHTML = "";
    ranked.forEach((p, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>#${i + 1} ${escapeHtml(p.name)}${p.kicked ? " (out)" : ""}</span><span>${p.answered ?? 0} answered · ${getSelections(p)} picks · ${p.skips} skips</span>`;
      els.standings.appendChild(li);
    });

    const canReveal = me.id === state.revealForId;
    if (canReveal && (state.questions?.length || 0) > 0) {
      els.revealPanel.hidden = false;
      if (!revealCurtainPlayed) {
        els.revealList.innerHTML = "";
        (state.questions || []).forEach((q, i) => {
          const li = document.createElement("li");
          li.style.setProperty("--i", String(i));
          const tag = q.reservedForRapidFire
            ? q.used
              ? "Rapid fire"
              : "Rapid fire (unused)"
            : q.used
              ? "Answered"
              : "Unused";
          li.innerHTML = `<span class="q">[${tag}] ${escapeHtml(q.text)}</span><span class="by">— ${escapeHtml(q.authorName || "?")}</span>`;
          els.revealList.appendChild(li);
        });
        els.revealPanel.classList.remove("is-open");
        // Brief beat with curtains closed, then swish open
        void els.revealPanel.offsetWidth;
        setTimeout(() => {
          if (!els.revealPanel || els.revealPanel.hidden) return;
          els.revealPanel.classList.add("is-open");
        }, 420);
        revealCurtainPlayed = true;
      }
    } else {
      els.revealPanel.hidden = true;
      els.revealPanel.classList.remove("is-open");
      if (!canReveal) {
        els.endSub.textContent += " Only whoever answered the most can see who wrote each question.";
      }
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------- room bootstrap ----------
  function applyPlayers(players) {
    const prevIds = new Set((state?.players || []).map((p) => p.id));
    if (!state) {
      state = mergeGameIntoState({ roomCode: sync?.code, phase: "lobby" }, players);
    } else {
      state = {
        ...state,
        players: hydratePlayerStats(players, state),
      };
    }
    const newcomers = (players || []).filter((p) => !prevIds.has(p.id));
    // Host: keep roster synced. lateJoin vs reclaim is decided by the join action.
    if (me.isHost && newcomers.length && state.phase !== "end") {
      newcomers.forEach((p) => {
        if (!state.selectionsById) state.selectionsById = {};
        if (!(p.id in state.selectionsById)) {
          state.selectionsById[p.id] = getSelections(getPlayer(p.id) || p);
        }
      });
      publish();
    } else {
      render();
    }
  }

  function applyGameState(st) {
    // Host is authoritative — don't let our own room/broadcast echo clobber
    // in-flight WILDCARD ballots (or any live host state mid-write).
    if (me.isHost && sync?._writing) return;
    if (
      me.isHost &&
      state?.phase === "wildcard" &&
      state?.wildcard?.stage === "voting" &&
      st?.wildcard?.stage === "voting"
    ) {
      const incoming = st.wildcard?.votes || {};
      const local = state.wildcard?.votes || {};
      // Prefer the richer tally (local may be ahead of a stale echo)
      const mergedVotes = { ...incoming, ...local };
      st = {
        ...st,
        wildcard: {
          ...st.wildcard,
          votes: mergedVotes,
          votedCount: Object.keys(mergedVotes).length,
        },
      };
    }
    const players = state?.players || st.players || [];
    state = mergeGameIntoState(st, players);
    syncHostRole();
    render();
  }

  function attachSyncHandlers() {
    sync.onState = (st) => applyGameState(st);
    sync.onPlayers = (players) => applyPlayers(players);
    sync.onAction = handleAction;
  }

  async function createRoom(name, preferLocal) {
    const code = roomCode();
    me = { id: uid(), name, isHost: true };
    myLocalQuestions = [];
    ideaReel = [];
    ideaReserve = [];
    ideaOffset = 0;
    pendingIdea = null;
    pendingReplacementId = null;
    ideaFilter = null;
    lastSpinToken = -1;

    const player = {
      id: me.id,
      name,
      answered: 0,
      skips: 0,
      selections: 0,
      kicked: false,
      isHost: true,
    };
    state = createState(code, player);

    sync = preferLocal ? new LocalSync(code, true) : new SupabaseSync(code, true);
    attachSyncHandlers();

    try {
      if (preferLocal) {
        await sync.start();
      } else {
        await sync.start({ hostPlayer: player });
        const players = await sync.fetchPlayers();
        applyPlayers(players);
      }
    } catch (err) {
      if (!preferLocal) {
        console.error(err);
        toast("Supabase failed — switching to local tab sync");
        sync.destroy?.();
        sync = new LocalSync(code, true);
        attachSyncHandlers();
        await sync.start();
        const url = new URL(location.href);
        url.searchParams.set("room", code);
        url.searchParams.set("local", "1");
        history.replaceState(null, "", url);
      } else {
        throw err;
      }
    }

    const url = new URL(location.href);
    url.searchParams.set("room", code);
    url.searchParams.delete("host");
    if (preferLocal) url.searchParams.set("local", "1");
    else url.searchParams.delete("local");
    history.replaceState(null, "", url);

    await publish();
    showScreen("lobby");
    saveSession();
    toast(
      preferLocal
        ? "Local room ready — open this link in other tabs"
        : `Room ${code} ready — share ?room=${code}`
    );
  }

  async function joinRoom(name, code, preferLocal, opts = {}) {
    code = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (code.length < 4) throw new Error("Enter a valid room code.");

    const resumeId = opts.resumeId || null;
    const cleanName = String(name || "").trim();
    if (!cleanName) throw new Error("Enter a name.");

    const storedReclaim = !resumeId ? loadReclaim(code) : null;
    const reclaimMatch = !!(
      storedReclaim &&
      storedReclaim.id &&
      String(storedReclaim.name || "").toLowerCase() === cleanName.toLowerCase()
    );
    const reclaimPayload = reclaimMatch ? storedReclaim : null;

    // Block duplicate names before joining (except resuming / reclaiming as yourself)
    if (!resumeId) {
      if (!preferLocal) {
        const { data: existing, error } = await db()
          .from("players")
          .select("id, name")
          .eq("room_id", code);
        if (error) throw new Error(error.message);
        const myReclaimId = reclaimPayload?.id;
        if (
          (existing || []).some(
            (p) =>
              p.name.toLowerCase() === cleanName.toLowerCase() &&
              p.id !== myReclaimId
          )
        ) {
          throw new Error(
            "That name is already taken in this room. Pick another."
          );
        }
      }
    }

    me = {
      id: resumeId || reclaimPayload?.id || uid(),
      name: cleanName,
      isHost: !!opts.resumeAsHost,
    };
    myLocalQuestions = [];
    ideaReel = [];
    ideaReserve = [];
    ideaOffset = 0;
    pendingIdea = null;
    pendingReplacementId = null;
    ideaFilter = null;
    lastSpinToken = -1;
    resumeSkipSpinAnim = !!resumeId || !!reclaimPayload;
    state = null;

    sync = preferLocal ? new LocalSync(code, me.isHost) : new SupabaseSync(code, me.isHost);

    const joinMessage = (playerExtra = {}) => ({
      type: "join",
      player: { id: me.id, name: me.name, ...playerExtra },
      reclaim: reclaimPayload,
    });

    try {
      if (preferLocal) {
        let joined = false;
        sync.onState = (st) => {
          state = st;
          restoreMyLocalQuestionsFromState();
          render();
          saveSession();
          if (!joined && !opts.resumeId) {
            joined = true;
            if (st.phase === "end") {
              handleNameTaken("This game already ended.");
              return;
            }
            if (st.phase === "target_setup" || st.phase === "target_active") {
              handleNameTaken(
                "TARGET is currently in progress. You can join when the round is over."
              );
              return;
            }
            const taken = (st.players || []).some(
              (p) =>
                p.id !== me.id &&
                String(p.name || "").toLowerCase() === cleanName.toLowerCase()
            );
            if (taken) {
              handleNameTaken(
                "That name is already taken in this room. Pick another."
              );
              return;
            }
            send(joinMessage());
            if (reclaimPayload) {
              clearReclaim(code);
              toast("Welcome back — your progress is restored");
            } else if (st.phase !== "lobby") {
              toast("Joined mid-game — you’ll play with the existing question pool");
            }
          }
        };
        sync.onAction = handleAction;
        await sync.start();
        await new Promise((r) => setTimeout(r, 400));
        if (!state && sync) throw new Error("No local room found. Create one first on this device.");
        if (!sync) return; // name was taken and cleaned up
        if (opts.resumeId) {
          restoreMyLocalQuestionsFromState();
          recoverHostProgress();
          render();
        }
      } else if (me.isHost) {
        attachSyncHandlers();
        const hostPlayer = {
          id: me.id,
          name: me.name,
          answered: 0,
          skips: 0,
          selections: 0,
          kicked: false,
          isHost: true,
        };
        await sync.start({ hostPlayer, resume: true });
        const players = await sync.fetchPlayers();
        const room = await sync.fetchRoom?.();
        const meRow = players.find((p) => p.id === me.id);
        // Trust the live room host — don’t reclaim host after a handoff
        const reallyHost =
          (room && room.host_id === me.id) || !!(meRow && meRow.isHost);
        me.isHost = !!reallyHost;
        sync.isHost = me.isHost;
        if (!meRow && !reallyHost) {
          // Session thought we were host but we already left — join as guest
          const snap = reclaimPayload || { answered: 0, skips: 0, selections: 0, kicked: false };
          await sync.addPlayer({
            id: me.id,
            name: me.name,
            answered: snap.answered ?? 0,
            skips: snap.skips ?? 0,
            kicked: !!snap.kicked,
            isHost: false,
          });
          send(joinMessage());
          if (reclaimPayload) clearReclaim(code);
        }
        applyPlayers(await sync.fetchPlayers());
        restoreMyLocalQuestionsFromState();
        if (me.isHost) recoverHostProgress();
        syncHostRole();
        render();
      } else {
        attachSyncHandlers();
        const joinPlayer = {
          id: me.id,
          name: me.name,
          answered: reclaimPayload?.answered ?? 0,
          skips: reclaimPayload?.skips ?? 0,
          selections: reclaimPayload?.selections ?? 0,
          kicked: !!reclaimPayload?.kicked,
          isHost: false,
        };
        await sync.start({ joinPlayer, resume: !!resumeId });
        if (!state) throw new Error("Room not found. Check ?room=CODE.");
        if (!resumeId && state.phase === "end") {
          throw new Error("This game already ended.");
        }
        const players = state.players || [];
        const meRow = players.find((p) => p.id === me.id);
        if (meRow) {
          me.isHost = !!meRow.isHost;
          sync.isHost = me.isHost;
        }
        // Ensure host marks mid-game joiners / restores reclaimers
        if (!resumeId) {
          send(joinMessage());
        }
        restoreMyLocalQuestionsFromState();
        if (me.isHost) recoverHostProgress();
        render();
        if (reclaimPayload) {
          clearReclaim(code);
          toast("Welcome back — your progress is restored");
        } else if (!resumeId && state.phase !== "lobby") {
          toast("Joined mid-game — you’ll play with the existing question pool");
        }
      }

      const url = new URL(location.href);
      url.searchParams.set("room", code);
      url.searchParams.delete("host");
      if (preferLocal) url.searchParams.set("local", "1");
      else url.searchParams.delete("local");
      history.replaceState(null, "", url);
      saveSession();
    } catch (err) {
      try {
        sync?.destroy?.();
      } catch (_) {}
      sync = null;
      state = null;
      throw err;
    }
  }

  async function resumeRoom(code) {
    const session = loadSession(code);
    if (!session?.id) return false;

    const preferLocal = wantLocalMode();
    try {
      await joinRoom(session.name, code, preferLocal, {
        resumeId: session.id,
        resumeAsHost: !!session.isHost,
      });
      toast(`Welcome back, ${session.name}`);
      return true;
    } catch (err) {
      console.error("Resume failed:", err);
      clearSession(code);
      return false;
    }
  }

  function resetToHomeUi() {
    myLocalQuestions = [];
    revealCurtainPlayed = false;
    ideaReel = [];
    ideaReserve = [];
    ideaOffset = 0;
    pendingIdea = null;
    pendingReplacementId = null;
    ideaFilter = null;
    lastSpinToken = -1;
    els.revealPanel?.classList.remove("is-open");
    if (els.revealList) els.revealList.innerHTML = "";
    history.replaceState(null, "", "/");
    resetHomeToFirstLook();
    showScreen("home");
    updateHostRoomCode();
    if (els.btnLeaveRoom) els.btnLeaveRoom.hidden = true;
    if (els.btnLeaveLobby) els.btnLeaveLobby.hidden = true;
    els.playerName.value = "";
    els.roomCode.value = "";
    setHomeError("");
  }

  /**
   * Leave the room. If you’re host, hand off to the earliest remaining
   * joiner so the game keeps running.
   */
  async function leaveRoom() {
    if (!state || !me?.id) return;
    const code = state.roomCode;
    const leavingId = me.id;
    const wasHost = me.isHost || state.hostId === leavingId;
    const leavingName = me.name;
    // Same device can rejoin with this name and get progress back
    const reclaimSnap = snapshotForReclaim(leavingId);

    try {
      if (wasHost) {
        const next = nextHostCandidate(leavingId);
        if (isTargetPhase()) {
          const broke = handleTargetLeaveDuringPlay(leavingId);
          removePlayerFromState(leavingId);
          if (!broke && state?.phase === "target_setup") {
            purgeTargetParticipant(leavingId);
          }
        } else {
          removePlayerFromState(leavingId);
          if (next) repairTurnAfterLeave(leavingId);
        }
        if (next) {
          assignHost(next.id);
          await publish();
          await sync?.setRoomHost?.(next.id);
          sync?.notifyHostHandoff?.({
            newHostId: next.id,
            leavingId,
            leavingName,
          });
        } else {
          await publish();
        }
        await sync?.deletePlayer?.(leavingId);
      } else {
        send({ type: "leave", playerId: leavingId });
        // Give the host a beat to process before we drop the channel
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (err) {
      console.error("Leave failed:", err);
    }

    if (code) {
      saveReclaim(code, { ...reclaimSnap, name: leavingName });
      clearSession(code);
    }
    try {
      sync?.destroy?.();
    } catch (_) {}
    sync = null;
    state = null;
    me = { id: null, name: "", isHost: false };
    resetToHomeUi();
    // Prefill name so same-device rejoin is one click
    if (els.playerName && leavingName) els.playerName.value = leavingName;
    if (els.roomCode && code) els.roomCode.value = code;
    toast(wasHost ? "You left — host passed on" : "You left the room");
  }

  let inviteMode = false;

  function resetHomeToFirstLook() {
    inviteMode = false;
    document.getElementById("screen-home")?.classList.remove("invite-receiver-mode");
    els.btnCreate.hidden = false;
    els.btnCreate.style.display = "";
    const joinRow = document.querySelector("#screen-home .join-row");
    if (joinRow) {
      joinRow.hidden = false;
      joinRow.style.display = "";
    }
    const inviteBlock = document.getElementById("invite-join-block");
    if (inviteBlock) inviteBlock.hidden = true;
  }

  // ---------- events ----------
  function wantLocalMode() {
    const params = new URLSearchParams(location.search);
    return params.get("local") === "1" || location.protocol === "file:";
  }

  els.homeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setHomeError("");
    const name = els.playerName.value.trim();
    if (!name) return;

    // Invite-link receivers: Enter submits join, not create
    if (inviteMode) {
      els.btnJoin.click();
      return;
    }

    const preferLocal = wantLocalMode();
    els.btnCreate.disabled = true;
    try {
      await createRoom(name, preferLocal);
    } catch (err) {
      setHomeError(err.message || "Could not create room.");
    } finally {
      els.btnCreate.disabled = false;
    }
  });

  els.btnJoin.addEventListener("click", async () => {
    setHomeError("");
    const name = els.playerName.value.trim();
    const code = els.roomCode.value.trim();
    if (!name) {
      setHomeError("Add your name first.");
      return;
    }
    const preferLocal = wantLocalMode();
    els.btnJoin.disabled = true;
    try {
      await joinRoom(name, code, preferLocal);
    } catch (err) {
      setHomeError(err.message || "Could not join room.");
    } finally {
      els.btnJoin.disabled = false;
    }
  });
  els.btnCopyLink.addEventListener("click", async () => {
    if (!state) return;
    const url = inviteUrl(state.roomCode);
    if (new URLSearchParams(location.search).get("local") === "1") {
      const u = new URL(url);
      u.searchParams.set("local", "1");
      try {
        await navigator.clipboard.writeText(u.toString());
        toast("Invite link copied");
      } catch (_) {
        toast(u.toString());
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("Invite link copied");
    } catch (_) {
      toast(url);
    }
  });

  els.btnStartQuestions.addEventListener("click", () => {
    if (!me.isHost) return;
    send({ type: "startQuestions", playerId: me.id });
  });

  els.questionForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!canSubmitQuestions()) return;
    const text = els.questionInput.value.trim();
    if (!text) return;
    if (questionAlreadyInPool(text)) {
      els.questionFeedback.hidden = false;
      els.questionFeedback.textContent = "That question is already in the pool.";
      setTimeout(() => {
        els.questionFeedback.hidden = true;
      }, 2200);
      toast("That question is already in the pool.");
      return;
    }
    // Submitted the pending prompt → keep it off the reel. Otherwise return it.
    if (pendingIdea && text === pendingIdea.text.trim()) {
      clearPendingIdeaConsumed();
    } else {
      restorePendingIdeaToReel();
    }
    myLocalQuestions.push({ text });
    send({ type: "addQuestion", playerId: me.id, text });
    els.questionInput.value = "";
    els.questionFeedback.hidden = false;
    els.questionFeedback.textContent = "Added to the pot.";
    setTimeout(() => {
      els.questionFeedback.hidden = true;
    }, 1600);
    if (state?.phase === "questions") renderQuestions();
  });

  els.questionInput?.addEventListener("input", () => {
    syncPendingIdeaWithInput();
  });

  els.buzzerMain?.addEventListener("pointerdown", (e) => {
    if (els.buzzerMain.disabled) return;
    els.buzzerMain.classList.add("is-pressed");
    const self = getPlayer(me.id);
    if (self?.kicked) return;
    if (!state?.finals || state.finals.phase !== "open") return;
    if (state.finals.aId !== me.id && state.finals.bId !== me.id) return;
    e.preventDefault();
    send({ type: "buzz", playerId: me.id });
  });
  els.buzzerMain?.addEventListener("pointerup", () => {
    if (!state?.finals?.buzzedBy) els.buzzerMain?.classList.remove("is-pressed");
  });
  els.buzzerMain?.addEventListener("pointerleave", () => {
    if (!state?.finals?.buzzedBy) els.buzzerMain?.classList.remove("is-pressed");
  });
  els.buzzerMain?.addEventListener("click", (e) => {
    // pointerdown already sent buzz; block duplicate click
    e.preventDefault();
  });

  window.addEventListener("keydown", (e) => {
    if (!state || state.phase !== "finals" || state.finals?.phase !== "open") return;
    if (e.repeat) return;
    const self = getPlayer(me.id);
    if (self?.kicked) return;
    if (e.code === "Space" || e.key === "a" || e.key === "A" || e.key === "l" || e.key === "L") {
      e.preventDefault();
      if (state.finals.aId === me.id || state.finals.bId === me.id) {
        els.buzzerMain?.classList.add("is-pressed", "lit");
        send({ type: "buzz", playerId: me.id });
      }
    }
  });
  els.btnPlayAgain.addEventListener("click", () => {
    if (state?.roomCode) {
      clearSession(state.roomCode);
      clearReclaim(state.roomCode);
    }
    sync?.destroy?.();
    sync = null;
    state = null;
    me = { id: null, name: "", isHost: false };
    resetToHomeUi();
  });

  async function onLeaveClick() {
    if (!state || !me?.id) return;
    const isHostLeaving = me.isHost || state.hostId === me.id;
    const ok = await showConfirm({
      eyebrow: "Leaving?",
      title: isHostLeaving ? "Pass the torch?" : "Heading out?",
      message: isHostLeaving
        ? "You’ll leave and the next player in line becomes host. The room keeps going."
        : "You’ll leave this room. You can rejoin later with the code or link.",
      cancelLabel: "Stay",
      okLabel: isHostLeaving ? "Leave & pass host" : "Leave room",
      danger: true,
    });
    if (!ok) return;
    if (els.btnLeaveRoom) els.btnLeaveRoom.disabled = true;
    if (els.btnLeaveLobby) els.btnLeaveLobby.disabled = true;
    try {
      await leaveRoom();
    } finally {
      if (els.btnLeaveRoom) els.btnLeaveRoom.disabled = false;
      if (els.btnLeaveLobby) els.btnLeaveLobby.disabled = false;
    }
  }

  els.btnLeaveRoom?.addEventListener("click", onLeaveClick);
  els.btnLeaveLobby?.addEventListener("click", onLeaveClick);

  els.confirmCancel?.addEventListener("click", () => closeConfirm(false));
  els.confirmOk?.addEventListener("click", () => closeConfirm(true));
  els.confirmOverlay?.addEventListener("click", (e) => {
    if (e.target === els.confirmOverlay) closeConfirm(false);
  });
  window.addEventListener("keydown", (e) => {
    if (!els.confirmOverlay || els.confirmOverlay.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeConfirm(false);
    }
  });

  // Best-effort host handoff if the tab closes mid-game
  window.addEventListener("pagehide", () => {
    if (!state || !me?.id) return;
    if (!(me.isHost || state.hostId === me.id)) return;
    const next = nextHostCandidate(me.id);
    const code = state.roomCode;
    const snap = snapshotForReclaim(me.id);
    if (!next) {
      if (code) {
        saveReclaim(code, snap);
        clearSession(code);
      }
      return;
    }
    try {
      removePlayerFromState(me.id);
      assignHost(next.id);
      repairTurnAfterLeave(me.id);
      sync?.broadcastState?.(state);
      sync?.setRoomHost?.(next.id);
      sync?.notifyHostHandoff?.({
        newHostId: next.id,
        leavingId: me.id,
        leavingName: me.name,
      });
      sync?.deletePlayer?.(me.id);
    } catch (_) {}
    if (code) {
      saveReclaim(code, snap);
      clearSession(code);
    }
  });

  // Prefill / invite-only home when opening an existing room link (?room=)
  // First-look page (no ?room=) stays unchanged.
  const params = new URLSearchParams(location.search);
  const presetRoom = params.get("room");

  function enableInviteHome(code) {
    inviteMode = true;
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    els.roomCode.value = normalized;

    const home = document.getElementById("screen-home");
    const actions = document.querySelector("#screen-home .home-actions");
    if (!home || !actions) return;

    home.classList.add("invite-receiver-mode");
    els.btnCreate.hidden = true;
    els.btnCreate.style.display = "none";
    const joinRow = actions.querySelector(".join-row");
    if (joinRow) {
      joinRow.hidden = true;
      joinRow.style.display = "none";
    }

    let inviteBlock = document.getElementById("invite-join-block");
    if (!inviteBlock) {
      inviteBlock = document.createElement("div");
      inviteBlock.id = "invite-join-block";
      inviteBlock.className = "invite-join-block";
      inviteBlock.innerHTML = `
        <p class="invite-room-label">Joining room <strong id="invite-room-label">${normalized}</strong></p>
        <button type="button" class="btn btn-primary btn-lg" id="btn-invite-join">Join group</button>
        <button type="button" class="invite-own-group" id="btn-start-own-group">start your own group</button>
      `;
      actions.appendChild(inviteBlock);
      $("#btn-invite-join").onclick = () => els.btnJoin.click();
      $("#btn-start-own-group").onclick = () => {
        location.href = "/";
      };
    } else {
      const label = $("#invite-room-label");
      if (label) label.textContent = normalized;
      inviteBlock.hidden = false;
    }
  }

  (async () => {
    const tryResume = async (code) => {
      if (!code) return false;
      return resumeRoom(String(code).toUpperCase());
    };

    const nav = performance.getEntriesByType?.("navigation")?.[0];
    const isReload = nav?.type === "reload";

    let resumed = false;
    if (presetRoom) {
      resumed = await tryResume(presetRoom);
      if (!resumed) enableInviteHome(presetRoom);
    } else if (isReload) {
      // Mid-game refresh: restore last room even if ?room= dropped
      const active = loadActiveRoomCode();
      if (active && loadSession(active)) {
        resumed = await tryResume(active);
      }
    }

    if (!resumed && !presetRoom && params.get("host") !== "1") {
      location.replace("/");
      return;
    }
    drawWheel([{ name: "…" }, { name: "…" }, { name: "…" }, { name: "…" }], 0);
  })();
})();