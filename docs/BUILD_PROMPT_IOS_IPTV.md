# Build Prompt — Premium iOS IPTV Player (Xtream Codes / M3U)

> Paste everything below this line into your AI coding agent.

---

## 0. Role & mission

You are a senior iOS engineer and product designer. Build a **production-quality native iOS IPTV player** that matches the screens described below **pixel-for-pixel in layout, hierarchy, copy, spacing and behavior**. The app plays content from the user's own IPTV provider (Xtream Codes API or M3U playlist). It ships no content of its own.

Work in phases (section 14). Do not skip any screen, state, or interaction listed here. Where this spec says "exact copy", use that text verbatim. When something is not specified, choose the option most consistent with the dark, glassy, rounded, premium streaming aesthetic described in section 2.

**Branding:** the working app name is **"Smart IPTV"** — keep it in a single constant (`AppBrand.name`) so it can be renamed. Design an **original** wordmark (see 4.1); do not copy any third‑party logo or trademark.

---

## 1. Tech stack (required)

| Concern | Choice |
|---|---|
| Language / UI | Swift 5.10+, **SwiftUI**, iOS 17+ minimum, iPhone first (iPad must not break) |
| Architecture | MVVM + `@Observable` view models, a `Repository` layer, a dependency container; Swift Concurrency (`async/await`, `actor`s) everywhere |
| Persistence | **GRDB** (SQLite) or SwiftData — must handle **100k+ rows** (e.g. 65,761 movies, 17,732 series, 14,890 live channels) with indexed search under 50 ms |
| Secure storage | Keychain for provider passwords and the Content PIN |
| Images | Nuke (or Kingfisher) with disk cache, downsampling, prefetch for rails/grids |
| Player 1 — "VLC Player" | VLCKit (MobileVLCKit / VLCKitSPM) — default, plays every format (.ts, .mkv, .avi, HEVC, AC3…) |
| Player 2 — "Apple Player" | AVKit / AVPlayer — HLS + MP4, native **Picture in Picture**, AirPlay |
| Player 3 — "Prime Player" | KSPlayer (FFmpeg-based) — "advanced engine, wide format support" |
| Casting | AirPlay via `AVRoutePickerView`; **Google Cast SDK** for Chromecast |
| Biometrics | `LocalAuthentication` (Face ID / Touch ID / passcode fallback) |
| Downloads | Background `URLSession` download tasks, resumable, stored in Application Support, excluded from iCloud backup |
| Fonts | Bundle **Plus Jakarta Sans** (Regular/Medium/SemiBold/Bold/ExtraBold). Fallback: SF Pro Rounded. Use tabular figures for all numbers/times |
| Icons | SF Symbols (names suggested per element below) |
| Info.plist | `NSFaceIDUsageDescription`, `NSLocalNetworkUsageDescription` + `NSBonjourServices` (`_googlecast._tcp`, `_<CAST_APP_ID>._googlecast._tcp`), `NSAppTransportSecurity > NSAllowsArbitraryLoads = YES` (IPTV servers are often plain HTTP on :8080), `UIBackgroundModes: audio` (for PiP/background audio) |

---

## 2. Design system

### 2.1 Color tokens (dark mode only)

```
bg.base            #000000   // most screens
bg.elevated        #0B0D12   // home / saved base
bg.navyGradient    top #0E2340 → #0B0D12 at ~35% height (Saved/Downloads screens)
surface.1          #141518   // cards on black (Profile rows, episode cards)
surface.2          #1C1D21   // sheets, inputs
surface.3          #2A2B30   // chips, circular icon buttons, unselected segments
stroke.subtle      rgba(255,255,255,0.08)  // 1pt card borders
stroke.strong      rgba(255,255,255,0.14)
text.primary       #FFFFFF
text.secondary     #8E8E93  (≈ 60% white)
text.tertiary      #5A5A60
accent             theme-driven, default Stream Blue #0A84FF (buttons #3B82F6)
accent.tint        accent @ 18–22% opacity (selected rows, badges, tab highlight)
live.red           #FF3B30 (LIVE pill text/dot, bg red @15%, border red @35%)
dot.live  #3B82F6 · dot.movies #FF9F0A · dot.series #AF52DE (Playlist stats) · dot.series.alt #30D158 (Profile/Watchlist)
success.green      #30D158  (Active status dot, Sources dot)
```

### 2.2 App themes (Advanced setting → App theme) — swap `accent` app-wide, live

| Theme (exact copy) | Subtitle (exact copy) | Accent | Icon tile |
|---|---|---|---|
| Stream Blue | Clean IPTV blue | #0A84FF | blue tile + white checkmark when selected |
| Cinema Red | Bold streaming red | #E50914 | `film` |
| Prime Gold | Warm premium gold | #FFB800 | `crown.fill` |
| Neon Purple | Arcade streaming glow | #8B5CF6 | `sparkles` |
| Cinema Pink | Modern poster pink | #FF2D78 | `theatermasks.fill` |
| Emerald | Fresh sports green | #10B981 | `play.circle.fill` |

Persist the choice; every accent usage (buttons, toggles, selected tabs, chips, progress bars, EPG now-line, checkmarks) must follow the theme.

### 2.3 Typography (Plus Jakarta Sans)

| Style | Size / weight | Used for |
|---|---|---|
| largeTitle | 40 / ExtraBold, tracking −0.5 | "Downloads", "Watchlist", "Search" |
| title1 | 32 / Bold | Sheet titles ("Manage Categories", "Advanced setting"), detail title |
| title2 | 24 / Bold | "Active Playlists", "Program Guide", section headers |
| headline | 18 / SemiBold | row titles, card titles |
| body | 16 / Regular | descriptions |
| subhead | 15 / Medium, text.secondary | row subtitles |
| caption | 13 / SemiBold, uppercase, tracking +1.5 | "SOURCES", "LIVE", "AIRPLAY", "CHROMECAST", "EPG" eyebrow |
| stat | 34 / SemiBold, tabular | big numbers (14,890) |
| clock | 22 / Heavy, monospaced digits | EPG "20:27" |

### 2.4 Shape, spacing, effects

- 4‑pt grid. Screen horizontal padding **20pt**. Card internal padding 16–20pt. Vertical gap between cards 12–16pt.
- Corner radii: big cards / sheets **28pt** (continuous), list cards **22pt**, icon tiles **14–16pt**, chips & primary buttons **capsule**, circular icon buttons 44–56pt diameter.
- Cards: fill `surface.1/2` + 1pt `stroke.subtle` border.
- Circular icon buttons (close X, +, gear, back, heart, kebab): `surface.3` fill, white glyph, 44pt (header ones 52pt).
- Icon tiles in rows: 52pt rounded square, fill = icon color @ 18% opacity, glyph in full icon color.
- Sheets: custom bottom sheets with a 36×5 grabber, 28pt top corners, `surface.2` background, sticky header (title + subtitle stays pinned while content scrolls under it).
- Selected state pattern (used everywhere): accent.tint fill + 1.5pt accent border + accent check circle on the trailing side.
- Primary button: accent fill, capsule, 56–64pt tall, white bold label with leading SF symbol.
- Haptics: light impact on toggles/selection, medium on play, success on refresh complete.
- Animations: spring (response 0.35, damping 0.85) for sheets/menus; matched-geometry for tab-bar highlight and segmented controls.

### 2.5 Floating tab bar (global)

- Floating capsule ~68% of width, 72pt tall, `surface.2` @ 85% + `.ultraThinMaterial`, 1pt stroke, bottom 24pt above safe area. Items: **Home** (`house`), **EPG** (`play.tv`), **Saved** (`heart`), **Profile** (`person.crop.circle`). Icon above label (13pt Medium).
- Active item: rounded‑rect capsule highlight `surface.3` behind it, icon + label in accent; animates between items with matched geometry.
- Separate **circular Search button** (72pt) to the right of the capsule, same material, `magnifyingglass`. Opens the Search screen.
- Content scrolls behind the bar; add bottom content inset so last items are reachable.

---

## 3. Data layer

### 3.1 Sources

Support **Xtream Codes API** (primary) and **M3U / M3U8 URL** (secondary). Multiple sources allowed; one is "active".

Source model: `id, name (defaults to host), type (.xtream/.m3u), serverURL (scheme+host+port), username, password (Keychain), createdAt, lastRefreshedAt, counts {live, movies, series}, status, expDate, maxConnections, preferredFormat (.hls/.ts), allowedOutputFormats`.

### 3.2 Xtream endpoints

```
GET {server}/player_api.php?username=U&password=P                     → user_info + server_info (auth, status "Active", exp_date, allowed_output_formats)
  &action=get_live_categories | get_vod_categories | get_series_categories
  &action=get_live_streams[&category_id=]
  &action=get_vod_streams[&category_id=]
  &action=get_series[&category_id=]
  &action=get_vod_info&vod_id=ID         → info (plot, genre, duration, rating, cast, backdrop_path, youtube_trailer, audio/video), movie_data (container_extension)
  &action=get_series_info&series_id=ID   → info, seasons[], episodes{ "1": [...] }
  &action=get_short_epg&stream_id=ID&limit=N   (base64 title/description)
  &action=get_simple_data_table&stream_id=ID   (full day EPG)
GET {server}/xmltv.php?username=U&password=P   → full XMLTV (parse in background, streaming XML parser)

Play URLs:
  Live   {server}/live/U/P/{stream_id}.{m3u8|ts}      (format from "Channel format")
  Movie  {server}/movie/U/P/{stream_id}.{container_extension}
  Episode{server}/series/U/P/{episode_id}.{container_extension}
```

- Decode base64 EPG fields. Treat numeric fields that arrive as strings or numbers interchangeably (Xtream JSON is inconsistent). `rating` may be "6.7", 6.7, "" or null.
- Ingest on a background actor, batch-insert in transactions of 2,000 rows, report progress (used by the refresh UI).
- **Fresh Arrivals** = top 20 by `added` timestamp desc for the active content type, **de-duplicated by normalized title** (never show the same poster three times).
- Auto refresh per setting (Off / Every Day / Every 3 Days / Every 1 Week / Every 2 Weeks / Every Month); check on app launch and `scenePhase == .active`.

### 3.3 Local user data (per source)

`WatchProgress (contentId, type, position, duration, updatedAt)`, `Favorite (contentId, type, addedAt)`, `RecentSearch (contentId, type, title, posterURL, at)`, `CategoryPreference (categoryId, type, hidden, locked)`, `Download (contentId, type, title, poster, fileURL, bytes, state, progress)`, `Settings` (theme, defaultHomeType, defaultPlayer, autoRefresh, showFreshArrivals, showContinuePlaying, showHeroCarousel, channelFormat, faceIDEnabled, contentPINHash).

Save progress every 10s and on pause/exit. An item counts as "watched" (removed from Continue Playing) at ≥ 95%.

### 3.4 Category grouping

Provider categories look like `ENGLISH | 4K`, `ENGLISH | FHD 2026`, `INDIAN | …`, `NETFLIX | …`. Group by the text before the first `|` (trimmed, uppercase); the remainder is the sub-category label. Categories with no `|` go into their own group of one. Preserve provider order.

---

## 4. Screens

### 4.1 Global header (Home)

- Left: wordmark **"Smart IPTV"** (28pt ExtraBold, white) with an original thin curved swoosh underline under "IPTV" (white, 2pt, small arrowhead) — design your own mark.
- Right, two 52pt controls: **Switch source** circle (`arrow.left.arrow.right`) → opens Playlist Manager (4.2). **Content-type pill** (capsule, `surface.3`): current type icon (`tv` for Live, `film` for Movies, `rectangle.stack.fill` for Series) + `chevron.down` (flips to up when open).
- Header is sticky with a blurred background once content scrolls under it.

**Content-type dropdown menu** (anchored under the pill, ~62% screen width, `surface.2` @ 95% + blur, 28pt radius, shadow):
- Rows: 52pt icon tile + label (18pt Medium).
  - **Live** — blue tile, `dot.radiowaves.left.and.right`
  - **Movies** — orange tile, `film`
  - **Series** — green tile, `rectangle.stack.fill`
  - Selected row: `surface.3` rounded highlight + orange/accent filled check circle at trailing.
  - Divider
  - **Manage Categories** — gray tile `slider.horizontal.3`, trailing `chevron.right` → opens 4.10.
- Tap outside dismisses. Selecting a type reloads Home for that type and closes the menu.

### 4.2 Playlist Manager ("Smart IPTV" sources screen)

- Background pure black. Header: "Smart IPTV" (34pt Bold) + two 56pt circle buttons: **+** (add source) and **gear** (opens Advanced setting).
- **Stats strip** card (28pt radius, stroke): 4 equal columns separated by vertical 1pt dividers. Big number (stat style) over a colored dot + caption: `1 • SOURCES` (green), `14,890 • LIVE` (blue), `65,761 • MOVIES` (orange), `17,732 • SERIES` (purple). Numbers formatted with grouping separators; totals across all sources.
- **"Active Playlists"** (title2).
- **Playlist card** per source: dark navy gradient (#14233F → #0D1117), 1.5pt accent border with soft outer glow on the active source, 32pt radius.
  - Row: 72pt app-icon tile (accent gradient, white `tray.full.fill`‑style glyph, glow shadow) · name (22pt Bold, e.g. host) · below: badge **XTREAM** (caption, accent text on accent.tint capsule) + "host • username" truncated (text.secondary) · trailing 52pt `ellipsis` circle → context menu: Refresh, Edit, Rename, Set as active, Delete (destructive, confirm).
  - Inner stats panel (darker rounded rect): three columns with dividers — `dot.radiowaves.left.and.right` **Live**, `film` **Movies**, `play.rectangle.on.rectangle` **Series** (accent icon + secondary label) over big number.
  - Footer: `link` "Xtream Codes API" · `clock` "Oct 29, 2026 at 6:53 PM" (date added / last sync, formatted `MMM d, yyyy 'at' h:mm a`) · trailing `chevron.right`. Tapping the card activates the source and opens Home.
- **Add source sheet** (+): segmented Xtream / M3U. Xtream fields: Name (optional), Server URL (with port), Username, Password (secure, show/hide). M3U: Name, URL. "Connect" primary button → validates via `player_api.php`, shows inline error states (wrong credentials, expired, unreachable, invalid URL), then shows a full-screen import progress (Live → Movies → Series with counts ticking up) and lands on Home.
- **First launch / no sources**: empty state with large icon, "Add your first playlist", and the add button.

### 4.3 Home — Movies / Series mode

Vertical scroll, in this order (each section toggleable in Advanced setting):

1. **Hero carousel** (toggle "Hero carousel"): horizontally paging cards, card width ≈ 88% of screen with the next/previous card peeking (~6%), height ≈ 1.1× width, 32pt radius. Full-bleed backdrop/poster, bottom black gradient. Bottom-center: title (26pt Bold, e.g. "Firelight (1998)") and meta line "• Movie • MP4 • ★ 6.7" (type • container uppercased • ★ rating with 1 decimal; omit missing parts). Bottom-right: 80pt accent play circle with white `play.fill` → plays immediately. Tap elsewhere → Detail. Auto-advance every 6s, pause on touch. Source: 10 random well-postered items from the type, refreshed per session.
2. **"Fresh Arrivals"** (toggle "Allow Fresh Arrivals"; title 22pt SemiBold): horizontal rail of the latest 20, **ranked Top‑10 style**: a huge numeral (≈ 120pt Black, silver vertical gradient fill with subtle dark stroke) sits behind/left of each 2:3 poster (poster 130×200, 16pt radius), overlapping the numeral's right side. Numbers 1…20.
3. **"Continue Playing"** (toggle "Show currently playing", only when progress exists): header with accent `play.circle.fill` + title. Horizontal cards (≈ 75% width, 180pt tall, 28pt radius): background is a dark tint **sampled from the poster's dominant color** (e.g. deep maroon) with stroke; left: poster (120×170, 16pt radius) with a 56pt translucent circular play overlay; right: type chip (`film` + "Movies", capsule `surface.3`), title (22pt SemiBold, 2 lines), "11% watched" (secondary), accent progress bar (6pt, capsule, track white @ 15%); top-right 40pt kebab circle → menu: Play from beginning, Mark as watched, Remove from Continue Playing, Go to details.
4. **Category rails**, one per visible category in provider order, lazily loaded as they scroll into view: header "ENGLISH | 4K" (20pt SemiBold, uppercase as provided) + trailing `chevron.right` → full category grid. Rail of large 2:3 posters (≈ 46% screen width each, 20pt radius, 12pt spacing). Items with no poster: `surface.3` card with centered `film` glyph and the title.

**Floating "categories" button**: 72pt circle (`surface.3` + blur, `square.grid.2x2`-style glyph with one tall + two small tiles) bottom-right, ~90pt above the tab bar. Opens the **Categories sheet** (4.5).

### 4.4 Home — Live mode

- Below the header: horizontal **category chips** (capsule, 44pt tall, `surface.3` fill + stroke, 17pt Medium). Selected: accent fill, white text, soft accent glow shadow. Examples: "BIGG BOSS 24X7", "REAL 4K | 2160P", "PPV | LIVE EVENTS", "SPORTS | CRICKET". Auto-scroll selected chip into view.
- Section header: category name (24pt Bold) + "8 channels" (secondary). Right: **Provider** sort pill (`arrow.up.arrow.down` + "Provider"; cycles Provider order / A–Z / Z–A / Recently added) and a **LIVE** pill (red dot + "LIVE" red text, red tint bg, red stroke).
- **3-column grid** of channel tiles: tile 1.4:1, 24pt radius, `surface.1` + stroke, channel logo `aspectFit` with padding. Top-left 40pt translucent heart circle (toggles favorite, fills red when on). Top-right quality badge capsule ("HD", "FHD", "4K", "SD") parsed from the channel name — dark capsule, white 12pt Bold. Name below, 16pt Medium, 1 line truncated. No logo → large accent letter on `surface.3`.
- Tap → plays the channel in the player (live mode: no scrubber, shows "LIVE" badge, channel up/down instead of prev/next episode).
- Same floating categories button.

### 4.5 Categories sheet (from the floating button)

- Bottom sheet at ~55% height, expandable to full. Header: 64pt circle with type icon, title "Movies Categories" / "Series Categories" / "Live Categories" (28pt Bold), subtitle "172 categories", trailing 52pt close X circle.
- Search field (`magnifyingglass`, placeholder "Search categories", `surface.3` capsule-ish 20pt radius).
- **Collapsible groups**: header row (`surface.3`, 20pt radius): chevron (down when expanded), group name "ENGLISH" (20pt Bold), count pill "15".
- Child rows (indented 12pt): 64pt **gradient icon tile** (deterministic colorful gradient per category — orange `crown.fill` for 4K/UHD, pink/purple/indigo `film` for others, `sportscourt` for sports, etc.) · sub-category label ("4K", "FHD 2026", "FHD 2025") · trailing: 36pt chevron circle, or for the currently selected category the accent filled check and the row gets the selected style (accent.tint fill + accent border).
- Selecting a category scrolls Home to that rail (Movies/Series) or switches the chip (Live) and dismisses.
- Hidden categories never appear; locked categories show a `lock.fill` and require the PIN.

### 4.6 EPG tab ("Program Guide")

- **Mini player card** at top: 16:10, 32pt radius, black with 1pt stroke. Top-right 56pt volume circle (`speaker.wave.2.fill`, toggles mute). Bottom-right 64pt play/pause circle. While loading: center accent spinner + "CONNECTING..." (accent, 15pt Bold, letter-spacing +4). Tapping the video opens the full-screen player. Plays the selected channel muted-by-default preview.
- Below: eyebrow **"E P G"** (caption, accent, wide tracking) and **"Program Guide"** (title2). Trailing **clock pill**: accent dot + live clock "20:27" (clock style) + "THU 29 OCT" (secondary, uppercase); 1pt accent‑tinted stroke; updates every minute.
- Category chips row (same as 4.4) with an **"All"** chip first.
- **Guide grid**:
  - Sticky top time ruler: left cell "GUIDE" (accent, caption). Ticks every 30 min labeled "20:00", "20:30", "21:00" (current hour bold white, others secondary). Grid width 6pt per minute; scrolls horizontally, synced across all rows. Show 2 hours back and 24 hours forward.
  - Sticky left channel column (≈ 30% width): number badge "001" (accent text on accent.tint, rounded, overlapping the top of the logo), 64pt logo tile (or accent letter fallback), name (2 lines, uppercase as provided), optional outlined quality badge (accent stroke, "HD"/"FHD").
  - Program cells: `surface.1` blocks with 1pt gaps, title (15pt SemiBold) + "20:00 – 21:00" (secondary); the currently airing program gets accent.tint fill + accent left bar + a thin progress underline. Tap → sheet with program title, time, description, "Watch live" and "Set reminder" (local notification).
  - Channels with no EPG data: one full-width block "No program information".
  - **Now line**: vertical accent line spanning the grid with a 14pt accent dot (with halo) at the ruler; auto-scroll so "now" is ~25% from the left on appear; "Now" floating button to jump back.
  - Selected channel row: accent.tint fill on the left cell + 4pt accent bar at its leading edge; selecting a row switches the mini player.
- Fix: time ruler must never render a stray "0" label.

### 4.7 Saved tab

Background: `bg.navyGradient`.

- Large title switches with segment: **"Watchlist"** / subtitle "Your saved movies, series and live channels." — **"Downloads"** / subtitle "Movies, series and live channels saved offline."
- **Segmented control** (custom, full width, 96pt tall, capsule container `surface.2` + stroke): two segments, each = 52pt icon circle + title (18pt Bold) + subtitle (secondary):
  - Watchlist — `heart.fill` (pink/red when selected) — "0 saved" (live count)
  - Downloads — `arrow.down` (accent when selected) — "Saved locally"
  - Selected segment: lighter glass capsule `surface.3` + stroke, matched-geometry slide.
- Watchlist filter chips (3 equal capsules): "• 0 Movies" (orange dot), "• 0 Series" (green dot), "• 0 Live" (blue dot); tap filters, tap again clears.
- Watchlist content: grouped grid (posters for movies/series, channel tiles for live), long-press → remove.
- Empty states (centered): 120pt `surface.3` circle with large glyph, title (28pt Bold), body (secondary, centered, 2 lines):
  - "Your watchlist is empty" / "Tap the heart on movies, series or channels and they will appear here."
  - "No downloads yet" / "Downloaded movies, series or live channels will appear here."
- Downloads list rows: poster, title, size, state (Queued / Downloading 42% with progress bar / Paused / Completed / Failed – Retry), swipe to delete, tap completed → offline playback (always via VLC engine for non-HLS files). Show total storage used.

### 4.8 Profile tab

Background black, scroll view, the header blurs on scroll.

- **Account card** (32pt radius, stroke): 96pt rounded-square avatar tile (`person.crop.circle.fill`), name (server host, 30pt Bold, truncated) + **"● Active"** status pill (green dot, `surface.3` capsule; "Expired"/"Disabled" in red), username (secondary 20pt), full server URL with port (tertiary). Then 3 stat tiles in a row (`surface.2`, 22pt radius): "14,890 • Live" (blue dot), "65,761 • Movies" (orange), "17,732 • Series" (green).
- **Account Settings** card: header with accent `slider.horizontal.3` tile + "Account Settings" (24pt Bold) + small accent dot at trailing. Rows (each its own inner card, `surface.1`, 24pt radius, 52pt circular icon at left):
  1. **Channel format** — green `play.circle.fill` — value "HLS (.m3u8)" — trailing `chevron.up.chevron.down` → menu: HLS (.m3u8), MPEG-TS (.ts). Only show formats in `allowed_output_formats`.
  2. **Refresh Xtream now** — orange `arrow.clockwise` — "Last refreshed Oct 29, 2026 at 7:35 PM" — trailing `arrow.right`. Tap → spinner replaces arrow, progress text "Refreshing live… 3,200", then success haptic + updated timestamp.
  3. **Enable Face ID** — purple `faceid` — "Protect your Xtream dashboard and account pri…" (full: "Protect your Xtream dashboard and account privacy.") — trailing toggle (iOS-style, accent when on). Turning on requires a successful biometric check. When enabled, app requires Face ID on launch and after 2 min in background (blurred privacy cover in app switcher).
  4. **Advanced setting** — blue `gearshape.2.fill` — "Home and Xtream content customization" — trailing `arrow.right` → 4.9.
- Collapsible cards below (each: 64pt icon tile, title 26pt Bold, subtitle secondary, trailing `chevron.down` rotating on expand):
  - **Provider Account** — green `person.text.rectangle.fill` — "username - Active". Expanded: username, status, expiry date ("Expires Mar 3, 2027" or "Unlimited"), created date, active/max connections, trial flag, timezone; buttons "Log out" / "Switch source".
  - **Playback API** — blue `play.rectangle.fill` — "HLS (.m3u8) preferred - HLS (.m3u8), MPEG-TS (.ts)". Expanded: allowed formats list, preferred format, server protocol/ports (http/https/rtmp).
  - **Server** — blue `server.rack` — host. Expanded: URL, port, HTTPS port, server timezone, server time, "Test connection" button with latency result.

### 4.9 Advanced setting (sheet, full height)

Sticky header: **"Advanced setting"** (title1) + "Customize how Xtream Home and content sections appear." Content scrolls underneath. Each block is a card (`surface.2` on the sheet's `surface.1`, 28pt radius) with a 56pt tinted icon tile:

1. **Manage Categories** — teal `square.grid.2x2.fill` — dynamic subtitle: "All categories visible" / "12 hidden · 3 locked" — chevron → 4.10.
2. **Content PIN** — red `lock.open` — "Off — set a PIN to lock categories" / "On — locked categories need your PIN" — chevron → PIN flow (enter 4 digits twice; change PIN; turn off requires current PIN). Custom numeric keypad screen with 4 dots, shake on error.
3. **App theme** — accent `paintpalette.fill` — "Apply a bold entertainment color across the UI." — 2-column grid of the 6 themes (section 2.2): each cell = 52pt colored icon tile + name (17pt SemiBold) + subtitle (truncated, secondary); selected cell = accent.tint fill + accent border + tile shows white checkmark.
4. **Allow Fresh Arrivals** — orange `sparkles` — "Show the latest 20 movies or series below the hero." — toggle.
5. **Load content by default** — blue `house.fill` — "Choose the Home tab type that opens first." — 3-segment control **Live / Movies / Series** (capsule track `surface.3`, selected thumb lighter gray, matched geometry).
6. **Default player** — blue `play.rectangle.on.rectangle.fill` — "Pick the player used every time you watch." — three option rows (20pt radius):
   - **VLC Player** + "Recommended" badge (accent text on accent.tint capsule) — "Default engine • plays every format"
   - **Apple Player** (`apple.logo` on gray tile) — "Native AVPlayer • Picture in Picture"
   - **Prime Player** (`sparkles.tv`) — "Advanced engine • wide format support"
   - Selected row: accent.tint + accent border, leading tile becomes accent with white checkmark.
7. **Auto refresh in** — blue `arrow.triangle.2.circlepath` — value "Every 1 Week" — trailing `chevron.up.chevron.down` menu (options in 3.2).
8. **Show currently playing** — blue `play.rectangle.on.rectangle.fill` — "Show your in-progress content row when watch progress exists." — toggle.
9. **Hero carousel** — magenta `rectangle.stack.fill` — "Keep the large poster carousel on the Home tab." — toggle.

All changes apply instantly and persist.

### 4.10 Manage Categories (sheet)

- Header: **"Manage Categories"** + "Hide what you never watch, lock what others shouldn't see." + 56pt close X.
- 3-tab segmented: **Live** (`tv`), **Movies** (`film`), **Series** (`rectangle.stack`) — selected tab is a solid accent capsule with white text/icon, others `surface.3`.
- Search field "Search categories".
- Summary line: "172 shown · 0 hidden · 0 locked" (secondary, live-updating).
- Group cards (24pt radius, `surface.2` + stroke): leading chevron (`chevron.right`, rotates on expand) · group name (22pt Bold) · "15 categories" (secondary) · trailing two 56pt circles: **eye** (`eye.fill` → `eye.slash.fill` when hidden, dims the row to 45%) and **lock** (`lock.open` → `lock.fill` accent when locked). Group buttons apply to all children; a partially hidden group shows a mixed state (eye with a dot).
- Expanded children rows: sub-category name + their own eye/lock buttons.
- Locking requires a Content PIN; if none is set, push the PIN setup flow first.

### 4.11 Search

- Large title **"Search"**, search field auto-focused (`magnifyingglass`, placeholder "Search movies, series, channels…", 20pt radius, `surface.1` + stroke), keyboard return key = search.
- Empty query: **Recent Searches** header — 48pt accent.tint circle with `clock.arrow.circlepath` + "Recent Searches" (24pt SemiBold) + trailing **Clear** pill (accent text on accent.tint). Rows (24pt radius cards): poster thumb (64×88, 10pt radius), title (20pt SemiBold), type line with accent icon + "Movies"/"Series"/"Live" in accent, trailing 44pt X circle to remove. Keep 20 most recent; added when the user opens a result.
- Typing (debounced 250ms): results grouped in sections **Movies / Series / Live** with counts, each a horizontal rail (posters) or list (channels); "See all" per section. Diacritic- and case-insensitive, token-prefix matching via SQLite FTS5. Hidden/locked categories excluded. No-results empty state.

### 4.12 Movie detail

- Full-bleed backdrop (backdrop_path, else poster) occupying top ~50%, `aspectFill`, with a black gradient fading into the black page. Status-bar-safe 56pt **back** (`chevron.left`) and **heart** circles (translucent dark) at top; heart toggles watchlist.
- Meta chips row, centered, translucent dark capsules: year "2026" · duration "02:09:39" · "4 Languages" (count of audio tracks/languages from info; hide if unknown).
- Title centered (32pt Bold, 2 lines) e.g. "Behadd (2026) (Gujarati)".
- Primary button full width 64pt: **"▶ Play Now"**, or **"▶ Continue"** when progress exists (long-press → "Play from beginning").
- Genre chips row (horizontal scroll, `surface.3` capsules): from `genre` split by `,`/`/`, then quality chip ("4K"/"FHD") parsed from name/category, then "★ 6.7" rating chip if present. **Never render empty chips.**
- Progress row (only with progress): accent bar (60% width) + "11% watched • 14:22 / 2:09:39".
- Plot text (17pt, secondary-ish white @ 80%), expandable "More".
- Optional: Cast, Director, Release date rows when available.
- **Download Movie** card (24pt radius, `surface.1` + stroke): 64pt accent circle with `arrow.down` · "Download Movie" (20pt Bold) / "Save for offline viewing" · `chevron.right`. States: downloading (circular progress in the tile, "Downloading 42% · 1.2 GB of 2.8 GB", tap to pause), downloaded ("Downloaded · Play offline", tile shows checkmark), failed (retry).
- If a trailer (`youtube_trailer`) exists, show a secondary **Trailer** button next to Play (see series).

### 4.13 Series detail

Same hero as 4.12 with meta chips "2023" · "1 Season" · "4 Languages".

- Buttons row, two equal capsules: **"▶ Play Now"** (accent) — plays next unwatched / resumes current episode, label becomes "▶ Continue S1 E3" when progress exists — and **"Trailer"** (`play.rectangle.fill`, `surface.3`) — opens the YouTube trailer in an in-app web player sheet (hidden if none).
- Genre chips + "★ 6" rating chip.
- Plot (3 lines + More).
- **"Episode"** header (24pt Bold) + trailing **Season picker** capsule ("Season 1" + `chevron.down`) → menu of seasons.
- Episode cards (24pt radius, `surface.1` + stroke): left thumbnail 16:10 (140pt wide, 16pt radius; episode still or dark placeholder) with centered 48pt play circle and bottom-left "E1" badge (dark capsule, bold); right: "Episode 1" (20pt Bold), `clock` + "00:43:51" (secondary), description (2 lines, secondary); trailing 56pt `arrow.down` download circle (with progress/complete states). Watched episodes show a thin accent progress bar under the thumbnail and a check when ≥ 95%.
- Tap card → play that episode. Player's next/previous buttons move between episodes; auto-play next with a 10s "Next episode" countdown card near the end.

### 4.14 Player (full screen, forced landscape)

Chrome over black video, auto-hides after 4s of inactivity, tap to toggle, double-tap left/right thirds = −10/+10s, horizontal pan = scrub, vertical pan left = brightness, right = volume.

- **Top bar**: `chevron.left` back (no circle) + title (24pt Bold, e.g. "Behadd (2026) (Gujarati)"). Top-right three 64pt circles (`surface.3` @ 85%): **Picture in Picture** (`pip.enter`), **Switch player** (`arrow.triangle.swap`‑style two-boxes glyph → sheet 4.16), **Aspect / layout** (`rectangle.split.2x1` → cycles Fit / Fill / 16:9 / 4:3 / Stretch with a toast).
- **Center controls** (horizontally centered row): previous (`backward.end.fill`, 64pt circle), back 10 (`gobackward.10`, 72pt), **play/pause** (96pt rounded square 28pt radius, `surface.3` + stroke; shows spinner while buffering), forward 10 (`goforward.10`), next (`forward.end.fill`). Prev/next disabled (dimmed) for single movies, used for episodes and live channel zapping.
- **Scrubber**: full width, 4pt track white @ 25%, accent fill, 28pt accent thumb with glow; time label at right "14:22/2:09:39" (tabular). Live streams: replace with a red "● LIVE" label and hide scrubber (or a short timeshift window if the server supports it).
- **Bottom-left pill group** (capsule `surface.2` @ 85%): **Speed** (`gauge.with.dots.needle.33percent` → 0.5×, 0.75×, 1×, 1.25×, 1.5×, 2×), **Subtitles & audio** (`captions.bubble` → sheet with Audio tracks + Subtitle tracks + subtitle delay/size), **Cast** (`airplayvideo` → sheet 4.15).
- **Bottom-right "More videos" pill**: "More videos" (18pt SemiBold) + 56pt inner rounded `play.rectangle.fill` tile. Opens 4.14.1.
- Resume: on open, seek to saved position (from Detail "Continue"). Wait for the player to be ready/duration known before seeking. Show a resume toast "Resumed at 14:22 · Start over".
- Errors: overlay card with icon, short message ("This stream couldn't be played"), technical detail (expandable), buttons **Retry**, **Try another player** (cycles VLC → Prime → Apple), **Close**. Live streams auto-reconnect with exponential backoff (1s, 2s, 4s… max 5 attempts) — never loop forever.
- Lock screen / Control Center Now Playing info (title, artwork, scrub) via `MPNowPlayingInfoCenter`.

#### 4.14.1 More videos overlay

Full-screen black @ 92% overlay. Title **"More videos"** (40pt Bold) top-left, 64pt close X circle top-right. Horizontal rail of 2:3 posters (≈ 200×300, 20pt radius) from the **same category**, each with a 64pt dark circle `arrow.up.right` button bottom-right on the poster; title below (24pt SemiBold, 1 line truncated) and "Movie"/"Episode" (secondary). Missing poster → `surface.3` with centered `play.rectangle.fill`. Tap → switch playback to that item (save progress of the current one first).

### 4.15 Cast sheet

Centered card (landscape: ~60% width; portrait: bottom sheet), black, 32pt radius, grabber. Header: 64pt circle `airplayvideo` + **"Cast"** (32pt Bold) + "Pick an AirPlay or Cast device" + close X.

- Section caption **AIRPLAY**: row card — `airplayvideo` circle · "AirPlay" / "Apple TV or AirPlay device nearby" · **Select** capsule button (opens the system `AVRoutePickerView`).
- Section caption **CHROMECAST**: discovered devices via Google Cast `GCKDiscoveryManager` — `tv` circle · device name ("Living Room TV") / "Available" | "Connecting…" | "Connected" · **Connect** / **Disconnect** capsule. Empty: "No Cast devices found on this Wi‑Fi" with a spinner while scanning.
- When casting: local player pauses, chrome shows "Playing on <device>" with remote controls (play/pause, seek, volume, stop casting). Send the stream URL with proper content type (HLS → `application/x-mpegURL`, MP4 → `video/mp4`); for `.ts`/`.mkv` show "This format can't be cast; switch Channel format to HLS".

### 4.16 Player switch sheet

Same card style. Header: 64pt circle with switch glyph + **"Player"** + "Apple Player active" (dynamic) + close X. Three rows (24pt radius, `surface.2`):
- VLC Player — "Default engine • plays every format" — tile accent‑tinted `play.rectangle.fill`
- Apple Player — "Native AVPlayer • Picture in Picture" — tile `apple.logo`
- Prime Player — "Advanced engine • wide format support" — tile `sparkles.tv`

Active row: tile becomes solid accent with white glyph, accent check circle at trailing. Selecting switches engine **for this session** while preserving the current position (does not change the default in Advanced setting).

---

## 5. Player engine abstraction

```swift
protocol PlaybackEngine: AnyObject {
    var state: AsyncStream<PlaybackState> { get }   // idle, loading, playing, paused, buffering, ended, failed(Error)
    var currentTime: TimeInterval { get }
    var duration: TimeInterval? { get }
    var audioTracks: [MediaTrack] { get }
    var subtitleTracks: [MediaTrack] { get }
    func load(url: URL, startAt: TimeInterval?, headers: [String: String]) async
    func play(); func pause(); func seek(to: TimeInterval) async
    func setRate(_: Float); func selectAudio(_: MediaTrack?); func selectSubtitle(_: MediaTrack?)
    func setAspect(_: AspectMode)
    var supportsPictureInPicture: Bool { get }
    func makeView() -> UIView
}
```

Implement `VLCEngine`, `AVPlayerEngine`, `KSPlayerEngine`. One `PlayerViewModel` drives the SwiftUI chrome regardless of engine. Send a desktop-like `User-Agent` header (configurable) — many providers block default agents. Configure `AVAudioSession` `.playback` / `.moviePlayback`.

PiP: native with AVPlayer; for VLC/KSPlayer use `AVPictureInPictureController` with `AVSampleBufferDisplayLayer` if supported, else show "Switch to Apple Player for PiP" toast with a one-tap switch.

---

## 6. Security & privacy

- Passwords and PIN hash (SHA-256 + salt) in Keychain only. Never log credentials or full stream URLs (mask `username/password` segments in logs).
- Face ID gate (4.8). Locked categories: content hidden from Home, Search, EPG and Fresh Arrivals until unlocked with the PIN; unlock lasts until the app goes to background.
- App-switcher privacy blur when Face ID is enabled.

---

## 7. Performance requirements

- Cold launch to Home with cached data < 1.5s. Never block the main thread with JSON parsing or DB writes.
- Home rails and the Live grid use `LazyHStack`/`LazyVGrid`; images downsampled to display size; prefetch next 10.
- Category rails load their items on demand (max 30 per rail; "See all" paginates by 60).
- EPG grid renders only visible rows/time window (virtualized; consider a `UICollectionView` compositional layout wrapped in SwiftUI for the 2-axis scroll).
- Memory under 250 MB while browsing 65k movies.

---

## 8. States every screen must handle

Loading (skeleton shimmer shaped like the final layout — posters, rows, chips), empty, error (with Retry), offline (banner "You're offline — showing downloads and cached library"), expired account (full-screen card with expiry date and "Switch source"), and very long titles/names (truncate exactly as in the screenshots).

---

## 9. Accessibility & localization

- VoiceOver labels on every icon button ("Close", "Add to watchlist", "Switch player"…). Minimum 44pt hit areas.
- Dynamic Type support up to XL without breaking layouts (cap the large stats).
- Reduce Motion: disable hero auto-advance and spring overshoot.
- All strings in a String Catalog (`Localizable.xcstrings`), English first.

---

## 10. Known glitches to avoid (seen in the reference)

1. Empty genre chip at the start of the chip row → filter empty strings.
2. EPG time ruler showing "0" instead of a time → always format `HH:mm`.
3. Duplicate posters in Fresh Arrivals → de‑dupe by normalized title.
4. EPG rows with no programs rendering blank → show "No program information".
5. Player stuck on spinner with "0:00/0:00" → timeout after 15s and show the error card with "Try another player".

---

## 11. Project structure

```
App/            AppEntry, AppRouter, DI container, Theme, Fonts
DesignSystem/   Colors, Typography, Components (CircleIconButton, IconTile, Chip, Card, SegmentedPill, FloatingTabBar, BottomSheet, Toggle, Badge, EmptyState, Skeleton)
Data/           XtreamClient, M3UParser, XMLTVParser, Models, Database (migrations), Repositories, SyncService, DownloadService
Features/
  Sources/      PlaylistManagerView, AddSourceView, ImportProgressView
  Home/         HomeView, ContentTypeMenu, HeroCarousel, FreshArrivalsRail, ContinuePlayingRail, CategoryRail, LiveGrid, CategoriesSheet
  EPG/          EPGView, MiniPlayer, GuideGrid
  Saved/        SavedView, WatchlistView, DownloadsView
  Profile/      ProfileView, AdvancedSettingsSheet, ManageCategoriesSheet, PINFlow
  Search/       SearchView
  Detail/       MovieDetailView, SeriesDetailView
  Player/       PlayerView, PlayerViewModel, Engines/, MoreVideosOverlay, CastSheet, PlayerSwitchSheet, TracksSheet
Tests/          XtreamDecodingTests, M3UParserTests, CategoryGroupingTests, FreshArrivalsDedupeTests, ProgressTests, PINTests
```

---

## 12. Testing

- Unit tests: Xtream JSON decoding with mixed string/number fields; base64 EPG; category grouping by `|`; Fresh Arrivals sort + de‑dupe; progress ≥ 95% = watched; PIN hashing; M3U attribute parsing (`tvg-id`, `tvg-logo`, `group-title`).
- A **mock Xtream server** (local JSON fixtures served via `URLProtocol`) with ~200 live, 500 movies, 100 series so the whole UI can run without a real provider. Provide a "Demo source" in DEBUG builds.
- UI tests for: add source → import → Home; switch content type; play + resume; hide/lock category; theme switch.
- SwiftUI `#Preview`s for every screen in loaded / empty / loading states.

---

## 13. Acceptance checklist

- [ ] Every screen in section 4 exists with the exact copy, icons, order and states listed.
- [ ] Theme change recolors the entire app instantly.
- [ ] Movie resumes at the saved second in all three engines; series auto-advance works.
- [ ] Live channels play in HLS and TS (TS via VLC/Prime), reconnect with bounded backoff.
- [ ] EPG grid scrolls smoothly in both axes with the now-line and correct times.
- [ ] Hidden categories vanish everywhere; locked ones need the PIN; Face ID gate works.
- [ ] Downloads survive app kill (background session) and play offline.
- [ ] AirPlay and Chromecast both work from the player.
- [ ] 65k-movie library: search returns in < 50ms; scrolling stays at 60fps (120 on ProMotion).
- [ ] No credentials in logs; passwords only in Keychain.

---

## 14. Delivery phases (commit after each, keep the app building)

1. Project setup, DI, design system components, floating tab bar, theme engine, fonts.
2. Data layer: Xtream client, DB schema + migrations, sync with progress, mock server + demo source.
3. Playlist Manager + Add Source + import progress.
4. Home (Movies/Series): header, type menu, hero, Fresh Arrivals, Continue Playing, rails, Categories sheet.
5. Home (Live) grid + chips; Detail screens (movie, series).
6. Player: engine abstraction, VLC, AVPlayer, KSPlayer, chrome, gestures, resume, errors, More videos, tracks, switch sheet.
7. Casting (AirPlay + Chromecast), PiP, Now Playing.
8. EPG tab (XMLTV/short EPG, virtualized grid, mini player).
9. Saved (Watchlist + Downloads with background session).
10. Profile, Advanced setting, Manage Categories, Content PIN, Face ID.
11. Search with FTS5 + recents.
12. Polish: skeletons, empty/error/offline states, haptics, accessibility, performance pass, tests green.

At the end of each phase, report what was built, what's stubbed, and screenshots of the simulator for the screens touched.

---

## Appendix A — If you build this for web/desktop instead of iOS (this repo)

Keep sections 2–4 and 8–13 identical; swap the stack:

| iOS | Web / Electron equivalent |
|---|---|
| SwiftUI | Vanilla JS + CSS (current repo) or React + Vite; CSS custom properties for every token in 2.1/2.2 |
| GRDB/SwiftData | IndexedDB (Dexie) in a Web Worker; FlexSearch/MiniSearch for search |
| VLC Player | mpegts.js (TS/FLV live) |
| Apple Player | native `<video>` + hls.js (Safari: native HLS, PiP via `requestPictureInPicture`) |
| Prime Player | hls.js with aggressive buffer config / Shaka Player |
| Keychain | Electron `safeStorage`; on web, encrypt with WebCrypto + a user passphrase |
| Face ID | WebAuthn platform authenticator (Touch ID / Windows Hello) |
| AirPlay / Chromecast | `webkitShowPlaybackTargetPicker` (Safari) / Cast Web Sender SDK (Chrome) |
| Downloads | Electron: `session.downloadURL`; web: Cache Storage / OPFS for small files only |
| Plain-HTTP servers | Route through the existing proxy (`server.js`, see `docs/PROXY.md`) to avoid mixed-content blocking on HTTPS hosting |
| Floating tab bar | Mobile: bottom floating bar; ≥ 1024px: left icon rail with the same items |
