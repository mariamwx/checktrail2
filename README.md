# Get Under My Skin — How to Play

Party games for phones. Open the hub, pick a mode, create a room, share the invite link (or QR in Icebreaker). Friends join with a name — no accounts.

| Mode | Name | Vibe |
|------|------|------|
| 1 | **Icebreaker** | Secret questions, spinning wheel, optional TARGET & WILDCARD, rapid-fire finale |
| 2 | **Mirror Vote** | Anonymous “who fits this prompt?” nominations + trait portrait |
| 3 | **Feud** | Survey multiple-choice — match the room’s majority |

---

## Shared basics

- **Host** creates the room and starts the game. Guests join with the room code or invite link.
- **Invite links** go straight into that mode’s room (`?room=CODE`).
- Display names must be **unique** in the room (case doesn’t matter).
- Refresh / closing a tab usually **keeps your seat** in Icebreaker (see Leave vs disconnect). Mirror Vote and Feud also try to resume via local session if you reopen the same invite.

---

# Mode 1 — Icebreaker

The long one. Everyone writes questions, the wheel picks people, skips can knock you out, and the last stretch is a two-player buzzer round.

### Flow (cheat sheet)

```
Lobby → Write questions → Wheel
         ↕ optional TARGET (host) or WILDCARD (eliminated player)
      → Rapid fire (buzzer) → End
```

---

### Lobby

1. Host creates a room (or guests join with the code / link).
2. Host needs **at least 2 players** to start.
3. Host can share a **QR code** or copy the invite link.
4. Host taps **Start — open question pool**.

**Mid-game joins:** after the lobby, a new person waits until the host taps **Let in** or **Keep out**.  
**Host kicked you:** you need the host to let you back in again (even if you rejoin the lobby).  
**While TARGET is running:** new joins are blocked until that round ends.

---

### Writing questions

- Clock: **3 minutes**.
- Minimum pool size = **players × 5** (players who were in when writing started — late joiners don’t raise the minimum).
  - Examples: 2 players → 10 questions · 4 → 20 · 6 → 30
- Anyone in from the lobby can add questions. **Late joiners cannot write** — they use the pool that already exists.
- Duplicates aren’t allowed.
- Host can lock early once the minimum is met. If time runs out and you’re short, the timer **extends another 3 minutes**.

When the pool locks, the game **shuffles once** and splits the deck:

| Slice | Formula |
|-------|---------|
| **Rapid fire reserve** | Larger of `players × 2` or `20%` of the pool |
| **Normal wheel** | Everything else |

Example with **6 players** and the minimum **30** questions: **18** on the wheel, **12** held for rapid fire.

---

### The wheel

1. The wheel spins and lands on someone (fairly — fewest turns first, then fewest answers, then random).
2. They get a question (**60 seconds**). Prefer someone else’s question; your own only if nothing else is left.
3. **Answer** → confirm → question is done → next spin.
4. **Skip** → counts as a skip, question is burned → next spin.
5. **Timeout** → counts as a skip, but the **same question** is given to someone else.

#### Skips & elimination

- **3 skips** = you’re out of the wheel (and become eligible for WILDCARD).
- **Exception:** if the game started with only **2 players**, skips never eliminate anyone — you go straight toward rapid fire.
- With 3+ players, the game won’t eliminate someone if that would leave fewer than **2** people for the finale.

**Selections** (how many times the wheel landed on you) matter later for who gets into rapid fire. **Skips do not** affect that ranking.

Host can **Kick** someone from the room entirely, or skip for the current player.

---

### TARGET (host special round)

Optional mid-game mode. Host can start it only when:

- The wheel is already underway (someone has answered or skipped),
- You’re not already in TARGET / WILDCARD / finals,
- There are **at least 3** active players.

**What happens**

1. Current players are **frozen** for this round (new joins wait until it’s over).
2. Everyone writes **one anonymous question** and secretly picks **someone else** as the target.
3. The game plays a **chain** of those cards — length ≈ `floor(players × 0.6)`, at least **2**, never more than the group size.
   - Examples: 3→2 · 4→2 · 5→3 · 6→3 · 8→4 · 10→5
4. For each card: reveal question → reveal target → that person **answers** or **skips**.
5. **Skip in TARGET** = chain breaks, that player is **out**, leftover TARGET questions are wasted, then back to Icebreaker.
6. If everyone answers through the chain → back to the wheel.

Host can remove players during TARGET the same as elsewhere.

---

### WILDCARD (comeback)

If you’re eliminated by **skips** (or the TARGET skip-out path), you may get **one** chance:

1. Tap **Enter WILDCARD** (it doesn’t start automatically).
2. Shout a confession out loud → confirm.
3. Everyone else votes anonymously: let them back in, or keep them out.
4. **Yes must beat No.** A **tie keeps you out**.
5. Win → you’re back in, skips reset to 0. Lose → you stay out.
6. Either way, that was your **only** WILDCARD. A later elimination is permanent.

You can’t start WILDCARD during TARGET, finals, or if nobody’s left to vote.

---

### Rapid fire (buzzer round)

#### When it starts

After a turn finishes (or TARGET / WILDCARD ends), the game checks:

1. **Only 2 players still in**, **or**
2. **No normal wheel questions left**

If the room started with only 2 people, you can skip the wheel and go straight here after the pool locks.

#### Who plays

Among people **still in** (not skip-eliminated):

- The **top 2 by wheel selections** (times the wheel landed on them).
- Ties in that top group are broken **at random**.
- Someone on 2 skips can still make it — skip count doesn’t rank finalists.

#### How it plays

- Questions come from the **reserved** slice of the pool.
- Question shows briefly (~1.2s), then buzzers open.
- First finalist to buzz shouts the answer → confirm → point.
- Highest rapid-fire score wins. Exact tie → coin flip between the two.

If somehow there’s no reserved bank left, the game ends on wheel results instead.

---

### End screen

- **Winner** = rapid-fire champ (or sole survivor if everyone else is out).
- **Author reveal** = separate honor for whoever **answered the most questions** across the whole game (ties random). The end UI can show who wrote questions for that person.

---

### Leave vs disconnect (Icebreaker)

| What you do | What happens |
|-------------|--------------|
| **Leave room** | Intentional exit. Seat is removed. Same browser can reclaim progress later by `playerId`. Host may hand off. |
| **Refresh / tab away / crash** | Soft disconnect only. Seat and scores stay. Same `playerId` reconnects without asking the host (unless you were host-kicked). |

Identity is a stored **player ID**, not your display name — so reconnecting with a new name on the same phone still finds your seat.

---

### Late joiners (Icebreaker)

- Host must approve after lobby.
- They **don’t write questions**; they play with the existing pool.
- They don’t change the minimum pool size that was set when writing started.

---

# Mode 2 — Mirror Vote

Anonymous nominations. Same prompts for everyone. Results are charts + a trait “body” portrait of how the room sees you.

### Setup

1. Host creates a room (default deck: **Philosophical**).
2. Host can switch to **Dirty** in the lobby.
3. Need **2+** players → host starts voting.
4. Joining mid-game isn’t supported — join before start.

### Decks

| Deck | Feel |
|------|------|
| **Philosophical** | Ideas, politics, values |
| **Dirty** | Hookups, crushes, chaos |

The full deck for that version is used (same order for everyone).

### Play

1. You see one prompt at a time.
2. Tap **who fits best** (any player in the room, including yourself).
3. Vote locks in; you move on at **your own pace** — no waiting per question.
4. Progress shows `current / total`.
5. When you’re done, wait for everyone else (room lists who’s still going).

Votes are **anonymous** while playing — nobody sees who picked whom.

### Results

1. **Votes per question** — bar chart of how many people named each player for that prompt (sorted by votes).  
   **Tip:** tap a chart to open it full-size with readable names and vote counts (important in big rooms).
2. **How the room built you** — your personal trait %s and a body diagram tinted by how often you were nominated for related traits.

There’s no single “winner” — the point is the mirrors.

---

# Mode 3 — Feud

Survey-style multiple choice. Match what the room picks most often.

### Setup

1. Host creates a room (default deck: **Classic**).
2. Host can switch to **Funny** in the lobby.
3. Need **2+** players → host starts Feud.
4. Join before start only.

### Decks

| Deck | Feel |
|------|------|
| **Classic** | Straight survey prompts |
| **Funny** | Same themes, playful wording |

Round length = **players × 5** questions (capped by how many exist in the bank).  
Examples: 2 → 10 · 4 → 20 · 6 → 30.  
Host shuffles and takes that many shared questions for the room.

### Play

1. Same question list for everyone, at your **own pace**.
2. Each card: theme + prompt + choices **A / B / C / D**.
3. Pick one → advance. Progress `n / total`.
4. Finish early → wait screen until everyone is done.

### Scoring

For each question:

1. Tally how many people picked A, B, C, D.
2. **Majority** = every choice tied for the highest count.
3. If you picked a majority choice, you get **+1**.

Score = how many times you matched the room’s top answer(s).  
Displayed as `score / total questions`.

### Results

- Winner board: highest score wins; ties listed; if nobody scored, no champ.
- Then **How the room answered**: per-question tallies (anonymous — counts only, not who picked what).

---

## Quick compare

| | Icebreaker | Mirror Vote | Feud |
|---|------------|-------------|------|
| Min to start | 2 | 2 | 2 |
| Mid-game join | Host approve | No | No |
| Core input | Answer / skip questions | Nominate a player | A–B–C–D |
| Pace | Shared wheel turns | Own pace | Own pace |
| Elimination | 3 skips (usually) | — | — |
| Finale | 2-player buzzer | Charts + traits | Majority scoreboard |

---

## For developers

- **`public/ui/`** — HTML/CSS/assets (placeholders for redesign).
- **`public/logic/`** — game + Supabase logic.
- **`app/page.tsx`** — hub shell; styles in `public/ui/hub/hub.css`.

See `public/ui/README.md` and `public/ui/CONTRACT.md` before swapping UI.
