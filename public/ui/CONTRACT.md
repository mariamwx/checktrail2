# UI ↔ logic contract

Required DOM ids / hooks. Renaming these breaks the game until `/public/logic` is updated.

## Category 1 — `category1/index.html`

### Screens
- `screen-home`, `screen-lobby`, `screen-questions`, `screen-game`, `screen-target`, `screen-wildcard`, `screen-finals`, `screen-end`

### TARGET / WILDCARD stages
- `target-stage`, `wildcard-stage`

### Home / lobby
- `home-form`, `player-name`, `room-code`, `btn-create`, `btn-join`, `home-error`
- `lobby-code`, `btn-copy-link`, `player-list`, `lobby-status`, `btn-start-questions`, `lobby-hint`
- Invite mode (created by logic): `invite-join-block`, `btn-invite-join`, `btn-start-own-group`, `invite-room-label`
- Classes logic toggles: `invite-receiver-mode` on `#screen-home`, `.home-actions`, `.join-row`

### Questions
- `question-timer` (shows pool progress e.g. `17/20`), `question-form`, `question-input`, `question-feedback`, `question-count`, `my-questions`
- `pool-status` — minimum progress / ready label
- Host start: `btn-start-game` (created by logic if missing)
- Optional legacy: `finals-question-count`, `btn-begin-finals`

### Wheel / play
- `score-strip`, `wheel-canvas`, `wheel-caption`, `action-panel`
- Dynamic buttons inside `#action-panel`: `btn-skip`, `btn-answer`

### Finals
- `finalist-a-name`, `finalist-b-name`, `finalist-a-score`, `finalist-b-score`
- `buzzer-main`, `buzzer-hint`, `finals-timer`, `finals-question`, `finals-phase-label`, `finals-controls`
- Dynamic under the buzzer (`#finals-controls`): `btn-confirm-answered`

### End / chrome
- `end-title`, `end-sub`, `reveal-panel`, `reveal-list`, `standings`, `btn-play-again`
- `kicked-overlay`, `toast`

## Category 2 — `category2/index.html`

### Screens
- `screen-home`, `screen-lobby`, `screen-play`, `screen-wait`, `screen-results`

### Home / lobby
- `home-form`, `player-name`, `room-code`, `btn-create`, `btn-join`, `home-error`
- `lobby-code`, `btn-copy`, `player-list`, `lobby-status`, `btn-start`, `lobby-hint`
- Host deck picker: `deck-picker`, `deck-philosophical`, `deck-dirty`, `deck-badge`
- Invite: same pattern as Category 1 (`invite-join-block`, …)
- Classes: `invite-receiver-mode`, `.actions`, `.join-row`

### Play / wait / results
- `progress-chip`, `question-text`, `nominee-grid` (buttons get class `nominee` / `selected`)
- `wait-copy`, `wait-stat`
- `charts`, `trait-list`, `body-figure` (SVG `.part` with `data-part`)
- `toast`

## Category 3 — `category3/index.html` (Feud)

### Screens
- `screen-home`, `screen-lobby`, `screen-play`, `screen-wait`, `screen-results`

### Home / lobby
- Same create/join pattern as Category 2
- Host deck picker: `deck-picker`, `deck-classic`, `deck-funny`, `deck-badge`
- `btn-start`, `lobby-hint`

### Play / wait / results
- `progress-chip`, `theme-chip`, `question-text`, `choice-grid` (buttons: `.choice`, `.choice-letter`, `.choice-text`)
- `wait-copy`, `wait-stat`
- `winner-board`, `charts`, `toast`

## Hub — `/` (`app/page.tsx`)

Styled via `hub/hub.css`. Class names: `hub`, `hub-inner`, `hub-brand`, `hub-title`, `hub-sub`, `hub-grid`, `hub-card`, `hub-card--c1`, `hub-card--c2`, `hub-card--c3`, `hub-card-eyebrow`, `hub-card-name`, `hub-card-desc`.
