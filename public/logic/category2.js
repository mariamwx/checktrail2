/* Category 2 — Mirror Vote
   UI (placeholder): /public/ui/category2/  — replace markup/CSS/assets there.
   This file is logic only; keep element ids listed in /public/ui/CONTRACT.md.
   Schema: category_two
   Everyone gets the same questions in the same order.
   Each player answers at their own pace (no waiting per question).
   Votes are anonymous. Results = bar charts + personal trait body.
*/

(() => {
  "use strict";

  const SUPABASE_URL = window.SUPABASE_CONFIG?.url || "";
  const SUPABASE_KEY = window.SUPABASE_CONFIG?.publishableKey || "";
  const supabase = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY, {
    db: { schema: "category_two" },
  });
  const db = () => supabase.schema("category_two");

  const $ = (s, r = document) => r.querySelector(s);

  const screens = {
    home: $("#screen-home"),
    lobby: $("#screen-lobby"),
    play: $("#screen-play"),
    wait: $("#screen-wait"),
    results: $("#screen-results"),
  };

  const els = {
    homeForm: $("#home-form"),
    playerName: $("#player-name"),
    roomCode: $("#room-code"),
    btnCreate: $("#btn-create"),
    btnJoin: $("#btn-join"),
    homeError: $("#home-error"),
    lobbyCode: $("#lobby-code"),
    btnCopy: $("#btn-copy"),
    playerList: $("#player-list"),
    lobbyStatus: $("#lobby-status"),
    btnStart: $("#btn-start"),
    lobbyHint: $("#lobby-hint"),
    deckPicker: $("#deck-picker"),
    deckPhilosophical: $("#deck-philosophical"),
    deckDirty: $("#deck-dirty"),
    deckBadge: $("#deck-badge"),
    progressChip: $("#progress-chip"),
    questionText: $("#question-text"),
    nomineeGrid: $("#nominee-grid"),
    waitCopy: $("#wait-copy"),
    waitStat: $("#wait-stat"),
    charts: $("#charts"),
    traitList: $("#trait-list"),
    bodyFigure: $("#body-figure"),
    toast: $("#toast"),
    chartLightbox: $("#chart-lightbox"),
    chartLightboxTitle: $("#chart-lightbox-title"),
    chartLightboxClose: $("#chart-lightbox-close"),
    chartLightboxScroll: $("#chart-lightbox-scroll"),
    chartLightboxCanvas: $("#chart-lightbox-canvas"),
  };

  let me = { id: null, name: "", isHost: false };
  let roomCode = null;

  function sessionKey(code) {
    return `c2-session-${String(code || "").toUpperCase()}`;
  }
  function saveSession() {
    if (!roomCode || !me?.id) return;
    try {
      localStorage.setItem(
        sessionKey(roomCode),
        JSON.stringify({ id: me.id, name: me.name, isHost: me.isHost, roomCode })
      );
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
  function clearSession(code) {
    try {
      localStorage.removeItem(sessionKey(code));
    } catch (_) {}
  }
  let channel = null;
  let players = [];
  let questions = [];
  let roomDeckVersion = "philosophical";
  let myOrder = [];
  let myIndex = 0;
  let myVotes = {}; // questionId -> nomineeId
  let phase = "home";
  let toastTimer = null;
  let votingLock = false;
  let waitPollTimer = null;

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function makeRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 6; i++) out += chars[(Math.random() * chars.length) | 0];
    return out;
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function show(name) {
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, 2400);
  }

  function setError(msg) {
    els.homeError.hidden = !msg;
    els.homeError.textContent = msg || "";
  }

  function inviteUrl(code) {
    const url = new URL(location.href);
    url.searchParams.set("room", code);
    url.searchParams.delete("host");
    return url.toString();
  }

  async function loadQuestionBank(version = roomDeckVersion) {
    const deck = version === "dirty" ? "dirty" : "philosophical";
    const { data, error } = await db()
      .from("question_bank")
      .select("*")
      .eq("version", deck)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    questions = data || [];
    roomDeckVersion = deck;
    if (!questions.length) {
      throw new Error(`No ${deck} questions found in Supabase.`);
    }
  }

  function deckLabel(version = roomDeckVersion) {
    return version === "dirty" ? "Dirty" : "Philosophical";
  }

  function sharedQuestionOrder() {
    return [...questions]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((q) => q.id);
  }

  async function writeSharedOrderToPlayers() {
    const order = sharedQuestionOrder();
    myOrder = order;
    await Promise.all(
      players.map((p) =>
        db()
          .from("players")
          .update({ question_order: order })
          .eq("id", p.id)
      )
    );
  }

  async function fetchRoomVotes() {
    const { data, error } = await db()
      .from("votes")
      .select("question_id, voter_id, nominee_id")
      .eq("room_id", roomCode);
    if (error) throw new Error(error.message);
    return data || [];
  }

  function finishedPlayerCount(votes) {
    const order = sharedQuestionOrder();
    if (!order.length) return 0;
    const byVoter = {};
    (votes || []).forEach((v) => {
      if (!order.includes(v.question_id)) return;
      byVoter[v.voter_id] = (byVoter[v.voter_id] || 0) + 1;
    });
    return players.filter((p) => (byVoter[p.id] || 0) >= order.length).length;
  }

  /** Same deck order for everyone; each player advances at their own pace. */
  async function syncProgress() {
    if (!roomCode || !questions.length || !players.length) return;
    const votes = await fetchRoomVotes();
    myVotes = {};
    votes.forEach((v) => {
      if (v.voter_id === me.id) myVotes[v.question_id] = v.nominee_id;
    });

    myOrder = sharedQuestionOrder();
    const totalNeeded = players.length * myOrder.length;
    const everyoneDone = finishedPlayerCount(votes) >= players.length;

    if (everyoneDone) {
      stopWaitPoll();
      els.waitCopy.textContent = "Everyone finished — opening results…";
      els.waitStat.textContent = `${votes.length} / ${totalNeeded} votes in`;
      if (me.isHost) {
        await db()
          .from("rooms")
          .update({ phase: "results", updated_at: new Date().toISOString() })
          .eq("code", roomCode);
      }
      phase = "results";
      await showResults();
      return;
    }

    // Personal cursor: first unanswered question in the shared order
    myIndex = 0;
    while (myIndex < myOrder.length && myVotes[myOrder[myIndex]] != null) {
      myIndex += 1;
    }

    if (myIndex >= myOrder.length) {
      phase = "wait";
      const title = document.querySelector("#screen-wait .section-title");
      if (title) title.textContent = "You’re done";
      const waitingOn = players.filter((p) => {
        const n = votes.filter(
          (v) => v.voter_id === p.id && myOrder.includes(v.question_id)
        ).length;
        return n < myOrder.length;
      });
      els.waitCopy.textContent = waitingOn.length
        ? `Waiting for ${waitingOn.map((p) => p.name).join(", ")} to finish…`
        : "Almost there…";
      els.waitStat.textContent = `${finishedPlayerCount(votes)} / ${players.length} finished`;
      show("wait");
      startWaitPoll();
      return;
    }

    stopWaitPoll();
    phase = "playing";
    votingLock = false;
    renderQuestion();
    show("play");
  }

  async function setDeckVersion(version) {
    if (!me.isHost || phase !== "lobby" || !roomCode) return;
    const deck = version === "dirty" ? "dirty" : "philosophical";
    if (deck === roomDeckVersion && questions.length) {
      renderLobby();
      return;
    }
    await loadQuestionBank(deck);
    const { error } = await db()
      .from("rooms")
      .update({
        deck_version: deck,
        question_count: questions.length,
        updated_at: new Date().toISOString(),
      })
      .eq("code", roomCode);
    if (error) throw new Error(error.message);
    await refreshPlayers({ silent: true });
    await writeSharedOrderToPlayers();
    await refreshPlayers({ silent: true });
    renderLobby();
    toast(`${deckLabel(deck)} deck selected`);
  }

  async function refreshPlayers(opts = {}) {
    const { data, error } = await db()
      .from("players")
      .select("*")
      .eq("room_id", roomCode)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    players = data || [];
    myOrder = sharedQuestionOrder();
    renderLobby();
    if (!opts.silent && (phase === "playing" || phase === "wait")) {
      await syncProgress().catch(console.error);
    }
  }

  async function refreshRoom() {
    const { data, error } = await db()
      .from("rooms")
      .select("*")
      .eq("code", roomCode)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return;

    const nextDeck =
      data.deck_version === "dirty" ? "dirty" : "philosophical";
    if (data.phase === "lobby" && nextDeck !== roomDeckVersion) {
      await loadQuestionBank(nextDeck);
      await refreshPlayers({ silent: true });
      myOrder = sharedQuestionOrder();
      renderLobby();
    }

    if (data.phase === "playing" && phase === "lobby") {
      if (nextDeck !== roomDeckVersion) await loadQuestionBank(nextDeck);
      phase = "playing";
      await beginPlaying();
    } else if (data.phase === "playing" && (phase === "playing" || phase === "wait")) {
      if (nextDeck !== roomDeckVersion) await loadQuestionBank(nextDeck);
      await syncProgress().catch(console.error);
    } else if (data.phase === "results") {
      if (nextDeck !== roomDeckVersion) await loadQuestionBank(nextDeck);
      phase = "results";
      await showResults();
    }
  }

  async function subscribe() {
    if (channel) supabase.removeChannel(channel);
    channel = supabase
      .channel(`c2:${roomCode}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "category_two", table: "players", filter: `room_id=eq.${roomCode}` },
        () => refreshPlayers().catch(console.error)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "category_two", table: "rooms", filter: `code=eq.${roomCode}` },
        () => refreshRoom().catch(console.error)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "category_two", table: "votes", filter: `room_id=eq.${roomCode}` },
        () => syncProgress().catch(console.error)
      )
      .subscribe();
  }

  function renderLobby() {
    els.lobbyCode.textContent = roomCode;
    els.playerList.innerHTML = "";
    players.forEach((p) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${escapeHtml(p.name)}</span><span>${p.id === me.id ? "you" : p.is_host ? "host" : "joined"}</span>`;
      els.playerList.appendChild(li);
    });
    const ready = players.length >= 2;
    els.lobbyStatus.textContent = `${players.length} player${players.length === 1 ? "" : "s"} · ${deckLabel()} deck`;
    els.lobbyHint.textContent = ready
      ? me.isHost
        ? "Pick a deck, then start — same questions for everyone, answer at your own pace."
        : "Waiting for the host to start."
      : "Need at least 2 players.";

    // Host-only: deck picker + start. Invite joiners never see these.
    if (els.btnStart) {
      els.btnStart.hidden = !me.isHost;
      els.btnStart.disabled = !me.isHost || !ready;
      els.btnStart.style.display = me.isHost ? "" : "none";
    }
    if (els.deckPicker) {
      els.deckPicker.hidden = !me.isHost;
      els.deckPicker.style.display = me.isHost ? "" : "none";
      els.deckPhilosophical?.classList.toggle(
        "is-selected",
        roomDeckVersion === "philosophical"
      );
      els.deckDirty?.classList.toggle("is-selected", roomDeckVersion === "dirty");
    }
    if (els.deckBadge) {
      // Joiners only see which deck the host chose — not the picker.
      els.deckBadge.hidden = !!me.isHost;
      els.deckBadge.style.display = me.isHost ? "none" : "";
      els.deckBadge.innerHTML = me.isHost
        ? ""
        : `Deck: <strong>${escapeHtml(deckLabel())}</strong>`;
    }
  }

  async function createRoom(name) {
    await loadQuestionBank("philosophical");
    const code = makeRoomCode();
    me = { id: uid(), name, isHost: true };
    roomCode = code;
    const order = sharedQuestionOrder();

    const { error: roomErr } = await db().from("rooms").insert({
      code,
      host_id: me.id,
      phase: "lobby",
      question_count: questions.length,
      deck_version: "philosophical",
    });
    if (roomErr) throw new Error(roomErr.message);

    const { error: playerErr } = await db().from("players").insert({
      id: me.id,
      room_id: code,
      name,
      is_host: true,
      question_order: order,
    });
    if (playerErr) throw new Error(playerErr.message);

    myOrder = order;
    history.replaceState(null, "", inviteUrl(code));
    await subscribe();
    await refreshPlayers();
    phase = "lobby";
    show("lobby");
    saveSession();
    toast(`Room ${code} ready`);
  }

  async function joinRoom(name, code) {
    code = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (code.length < 4) throw new Error("Enter a valid room code.");
    const cleanName = String(name || "").trim();
    if (!cleanName) throw new Error("Enter a name.");

    const { data: room, error: roomErr } = await db()
      .from("rooms")
      .select("*")
      .eq("code", code)
      .maybeSingle();
    if (roomErr) throw new Error(roomErr.message);
    if (!room) throw new Error("Room not found.");
    if (room.phase !== "lobby") throw new Error("This room already started.");

    await loadQuestionBank(
      room.deck_version === "dirty" ? "dirty" : "philosophical"
    );

    const { data: existing, error: existingErr } = await db()
      .from("players")
      .select("id, name")
      .eq("room_id", code);
    if (existingErr) throw new Error(existingErr.message);
    if (
      (existing || []).some((p) => p.name.toLowerCase() === cleanName.toLowerCase())
    ) {
      throw new Error("That name is already taken in this room. Pick another.");
    }

    me = { id: uid(), name: cleanName, isHost: false };
    roomCode = code;
    const order = sharedQuestionOrder();

    const { error: playerErr } = await db().from("players").insert({
      id: me.id,
      room_id: code,
      name: cleanName,
      is_host: false,
      question_order: order,
    });
    if (playerErr) throw new Error(playerErr.message);

    myOrder = order;
    history.replaceState(null, "", inviteUrl(code));
    await subscribe();
    await refreshPlayers();
    phase = "lobby";
    show("lobby");
    saveSession();
  }

  async function resumeRoom(code) {
    const session = loadSession(code);
    if (!session?.id) return false;

    const { data: room, error: roomErr } = await db()
      .from("rooms")
      .select("*")
      .eq("code", code)
      .maybeSingle();
    if (roomErr || !room) {
      clearSession(code);
      return false;
    }

    await loadQuestionBank(
      room.deck_version === "dirty" ? "dirty" : "philosophical"
    );

    const { data: player } = await db()
      .from("players")
      .select("*")
      .eq("room_id", code)
      .eq("id", session.id)
      .maybeSingle();
    if (!player) {
      clearSession(code);
      return false;
    }

    me = { id: player.id, name: player.name, isHost: !!player.is_host };
    roomCode = code;
    myOrder = sharedQuestionOrder();
    history.replaceState(null, "", inviteUrl(code));
    await subscribe();
    await refreshPlayers({ silent: true });
    saveSession();

    if (room.phase === "lobby") {
      phase = "lobby";
      show("lobby");
    } else if (room.phase === "playing") {
      phase = "playing";
      await beginPlaying();
    } else if (room.phase === "results") {
      phase = "results";
      await showResults();
    } else {
      phase = "lobby";
      show("lobby");
    }
    toast(`Welcome back, ${me.name}`);
    return true;
  }

  async function startGame() {
    if (!me.isHost) return;
    await loadQuestionBank(roomDeckVersion);
    await refreshPlayers({ silent: true });
    await writeSharedOrderToPlayers();
    const { error } = await db()
      .from("rooms")
      .update({
        phase: "playing",
        deck_version: roomDeckVersion,
        question_count: questions.length,
        updated_at: new Date().toISOString(),
      })
      .eq("code", roomCode);
    if (error) throw new Error(error.message);
    phase = "playing";
    await beginPlaying();
  }

  async function beginPlaying() {
    stopWaitPoll();
    myOrder = sharedQuestionOrder();
    await syncProgress();
  }

  function questionById(id) {
    return questions.find((q) => q.id === id);
  }

  function renderQuestion() {
    const qid = myOrder[myIndex] || sharedQuestionOrder()[myIndex];
    const q = questionById(qid);
    if (!q) {
      syncProgress().catch(console.error);
      return;
    }
    els.progressChip.textContent = `${myIndex + 1} / ${questions.length}`;
    els.questionText.textContent = q.prompt;
    els.nomineeGrid.innerHTML = "";
    votingLock = false;
    players.forEach((p) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nominee";
      btn.textContent = p.name;
      btn.onclick = () => castVote(qid, p.id, btn);
      els.nomineeGrid.appendChild(btn);
    });
  }

  async function castVote(questionId, nomineeId, btn) {
    if (votingLock) return;
    if (myVotes[questionId]) return;
    votingLock = true;

    [...els.nomineeGrid.querySelectorAll(".nominee")].forEach((b) => {
      b.disabled = true;
      b.classList.remove("selected");
    });
    btn.classList.add("selected");

    const { error } = await db().from("votes").upsert(
      {
        room_id: roomCode,
        question_id: questionId,
        voter_id: me.id,
        nominee_id: nomineeId,
      },
      { onConflict: "room_id,question_id,voter_id" }
    );
    if (error) {
      toast(error.message || "Vote failed — try again");
      votingLock = false;
      [...els.nomineeGrid.querySelectorAll(".nominee")].forEach((b) => {
        b.disabled = false;
        b.classList.remove("selected");
      });
      return;
    }

    myVotes[questionId] = nomineeId;
    saveSession();
    await syncProgress();
  }

  function stopWaitPoll() {
    if (waitPollTimer) {
      clearInterval(waitPollTimer);
      waitPollTimer = null;
    }
  }

  function startWaitPoll() {
    stopWaitPoll();
    waitPollTimer = setInterval(() => {
      syncProgress().catch(console.error);
    }, 1500);
  }

  async function showResults() {
    show("results");
    const { data: votes, error } = await db()
      .from("votes")
      .select("question_id, nominee_id")
      .eq("room_id", roomCode);
    if (error) {
      toast(error.message);
      return;
    }

    els.charts.innerHTML = "";
    const orderedQuestions = [...questions].sort((a, b) => a.sort_order - b.sort_order);

    orderedQuestions.forEach((q) => {
      const tallies = {};
      players.forEach((p) => {
        tallies[p.id] = 0;
      });
      (votes || [])
        .filter((v) => v.question_id === q.id)
        .forEach((v) => {
          if (tallies[v.nominee_id] != null) tallies[v.nominee_id] += 1;
        });

      const card = document.createElement("article");
      card.className = "chart-card";
      card.innerHTML = `<h3>${escapeHtml(q.prompt)}</h3><div class="chart-canvas-wrap"></div>`;
      const wrap = card.querySelector(".chart-canvas-wrap");
      const canvas = document.createElement("canvas");
      wrap.appendChild(canvas);
      els.charts.appendChild(card);
      drawBarChart(
        canvas,
        players.map((p) => ({ name: p.name, value: tallies[p.id] || 0 }))
      );
    });

    renderBodyPortrait(votes || []);
  }

  function drawBarChart(canvas, series) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.min(640, canvas.parentElement.clientWidth || 640);
    const cssH = 260;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const padL = 36;
    const padR = 12;
    const padT = 16;
    const padB = 42;
    const plotW = cssW - padL - padR;
    const plotH = cssH - padT - padB;

    const maxVal = Math.max(8, ...series.map((s) => s.value), 1);
    const yMax = Math.max(8, Math.ceil(maxVal / 2) * 2);
    const step = yMax <= 8 ? 2 : Math.ceil(yMax / 4);

    // Editorial panel — cream field, ink grid (matches iso-theme)
    ctx.fillStyle = "#f7f5f1";
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.strokeStyle = "rgba(42, 40, 38, 0.18)";
    ctx.setLineDash([3, 6]);
    ctx.lineWidth = 1;
    ctx.fillStyle = "#6e6a64";
    ctx.font = "600 12px DM Sans, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let y = 0; y <= yMax; y += step) {
      const py = padT + plotH - (y / yMax) * plotH;
      ctx.beginPath();
      ctx.moveTo(padL, py);
      ctx.lineTo(cssW - padR, py);
      ctx.stroke();
      ctx.fillText(String(y), padL - 8, py);
    }
    ctx.setLineDash([]);

    // Baseline
    ctx.strokeStyle = "#2a2826";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padL, padT + plotH);
    ctx.lineTo(cssW - padR, padT + plotH);
    ctx.stroke();

    const n = Math.max(series.length, 1);
    const gap = 18;
    const barW = Math.min(70, (plotW - gap * (n + 1)) / n);
    const maxInSeries = Math.max(...series.map((s) => s.value), 0);

    series.forEach((s, i) => {
      const x =
        padL +
        gap +
        i * (barW + gap) +
        (plotW - gap * (n + 1) - barW * n) / 2;
      const h = Math.max(0, (s.value / yMax) * plotH);
      const y = padT + plotH - h;
      const r = 2;

      if (h > 0) {
        ctx.fillStyle = s.value === maxInSeries && maxInSeries > 0 ? "#2f4f9b" : "#9aa3ad";
        roundTopRect(ctx, x, y, barW, h, r);
        ctx.fill();
        ctx.strokeStyle = "#2a2826";
        ctx.lineWidth = 2;
        roundTopRect(ctx, x, y, barW, h, r);
        ctx.stroke();
      }

      ctx.fillStyle = "#1c1b19";
      ctx.font = "700 13px Syne, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(s.name.slice(0, 12), x + barW / 2, padT + plotH + 10);
    });
  }

  function roundTopRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h);
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
  }

  function renderBodyPortrait(votes) {
    const totalVoters = players.length || 1;
    // For each trait, % of players who nominated ME on questions with that trait
    const traitMap = {};
    questions.forEach((q) => {
      if (!traitMap[q.trait_key]) {
        traitMap[q.trait_key] = {
          key: q.trait_key,
          label: q.trait_label,
          bodyPart: q.body_part,
          hits: 0,
          possible: 0,
        };
      }
      traitMap[q.trait_key].possible += totalVoters;
      votes
        .filter((v) => v.question_id === q.id && v.nominee_id === me.id)
        .forEach(() => {
          traitMap[q.trait_key].hits += 1;
        });
    });

    const traits = Object.values(traitMap)
      .map((t) => ({
        ...t,
        pct: t.possible ? Math.round((t.hits / t.possible) * 100) : 0,
      }))
      .sort((a, b) => b.pct - a.pct);

    els.traitList.innerHTML = "";
    traits.forEach((t) => {
      const li = document.createElement("li");
      li.className = t.pct === 0 ? "trait-chip dim" : "trait-chip";
      li.innerHTML = `
        <span class="trait-pct">${t.pct}%</span>
        <span class="trait-copy">think you're <em>${escapeHtml(t.label)}</em></span>
        <span class="trait-bar" aria-hidden="true"><span style="width:${t.pct}%"></span></span>
      `;
      els.traitList.appendChild(li);
    });

    // Light body parts by average trait % for that part
    const partScores = {};
    traits.forEach((t) => {
      if (!partScores[t.bodyPart]) partScores[t.bodyPart] = [];
      partScores[t.bodyPart].push(t.pct);
    });

    els.bodyFigure.querySelectorAll(".part").forEach((el) => {
      const part = el.getAttribute("data-part");
      const scores = partScores[part] || [0];
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      el.style.fill = tintForPercent(avg);
    });
  }

  function tintForPercent(pct) {
    // 0% = dark slate, 100% = bright blue
    const t = Math.max(0, Math.min(100, pct)) / 100;
    const r = Math.round(26 + (53 - 26) * t);
    const g = Math.round(31 + (95 - 31) * t);
    const b = Math.round(42 + (173 - 42) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // events
  let inviteMode = false;

  function enableInviteHome(code) {
    inviteMode = true;
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    els.roomCode.value = normalized;

    const home = document.getElementById("screen-home");
    const actions = document.querySelector("#screen-home .actions");
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

  els.homeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setError("");
    const name = els.playerName.value.trim();
    if (!name) return;

    if (inviteMode) {
      els.btnJoin.click();
      return;
    }

    els.btnCreate.disabled = true;
    try {
      await createRoom(name);
    } catch (err) {
      setError(err.message || "Could not create room.");
    } finally {
      els.btnCreate.disabled = false;
    }
  });

  els.btnJoin.addEventListener("click", async () => {
    setError("");
    const name = els.playerName.value.trim();
    const code = els.roomCode.value.trim();
    if (!name) {
      setError("Add your name first.");
      return;
    }
    els.btnJoin.disabled = true;
    const inviteBtn = $("#btn-invite-join");
    if (inviteBtn) inviteBtn.disabled = true;
    try {
      await joinRoom(name, code);
    } catch (err) {
      setError(err.message || "Could not join.");
    } finally {
      els.btnJoin.disabled = false;
      if (inviteBtn) inviteBtn.disabled = false;
    }
  });

  els.btnCopy.addEventListener("click", async () => {
    const url = inviteUrl(roomCode);
    try {
      await navigator.clipboard.writeText(url);
      toast("Invite link copied");
    } catch (_) {
      toast(url);
    }
  });

  els.btnStart.addEventListener("click", async () => {
    try {
      await startGame();
    } catch (err) {
      toast(err.message || "Could not start");
    }
  });

  els.deckPhilosophical?.addEventListener("click", async () => {
    try {
      await setDeckVersion("philosophical");
    } catch (err) {
      toast(err.message || "Could not switch deck");
    }
  });
  els.deckDirty?.addEventListener("click", async () => {
    try {
      await setDeckVersion("dirty");
    } catch (err) {
      toast(err.message || "Could not switch deck");
    }
  });

  const params = new URLSearchParams(location.search);
  const preset = params.get("room");
  (async () => {
    if (preset) {
      const resumed = await resumeRoom(preset.toUpperCase());
      if (!resumed) enableInviteHome(preset);
    } else if (params.get("host") !== "1") {
      location.replace("/");
    }
  })();
})();