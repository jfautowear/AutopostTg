# Autopost Telegram Crypto — JF Network

Repo: https://github.com/jfautowear/AutopostTg

Bot Node.js: fetch **OKX** / **Bitget** / DEX / **pengumuman OKX** → konten → post `@jfnetworknet` → forward [@caricuanhp](https://t.me/caricuanhp).

**PC boleh OFF.** Autopost, command admin (`/jadwal`, `/status`, …), berita/promo, dan Top Aktif jalan lewat **GitHub Actions**. PC hanya untuk debug lokal.

## Penting: `.env` tidak ikut ke GitHub

File `.env` ada di `.gitignore`. Secrets diisi lewat **GitHub Actions Secrets**, bukan di-commit.

## Admin chat bot (`@jfnetworkindo` saja)

Command diproses GHA tiap **±10 menit** (PC OFF OK). Data `/jadwal` & `/status` = `config/schedule.json` + `config/runtime.json` — **sama** yang dipakai Autopost.

| Command | Fungsi |
|---------|--------|
| `/jadwal` | Lihat jadwal (sinkron GHA) |
| `/jadwal_set 09:00,13:00,19:00,21:00` | Set semua jam |
| `/jadwal_add 12:30` | Tambah jam |
| `/jadwal_del 12:30` | Hapus jam |
| `/jadwal_on` / `/jadwal_off` | Aktif / nonaktif |
| `/test` / `/test_airdrop` / `/test_news` | Preview ke `TEST_CHAT_ID` |
| `/postnow` / `/airdrop` / `/news` | Post ke channel |
| `/sumber okx\|bitget\|auto` | Sumber data CEX |
| `/kategori spot\|airdrop\|news\|auto` | Jenis konten |
| `/status` | Status + last post + slot berikutnya |
| `/help` | Bantuan |

Akun selain `@jfnetworkindo` ditolak. Jadwal di `config/schedule.json` (sumber kebenaran Autopost GHA).

⚠️ **Jangan** biarkan `npm start` ON di PC bersamaan GHA — bentrok `getUpdates`.

## Jenis konten (rotasi 4×/hari)

Jadwal default: **09:00 · 13:00 · 19:00 · 21:00 WIB** (`POST_CATEGORY=auto`):

| Jam | Kategori | Isi |
|-----|----------|-----|
| 09:00 | **spot** | Hot gainer OKX/Bitget |
| 13:00 | **airdrop** | DEX **Safe Screen** → tombol **Trade OKX Web3** |
| 19:00 | **news** | Promo/listing OKX → **Daftar OKX** |
| 21:00 | spot / airdrop | Bergiliran (hari genap DEX aman, ganjil spot) |

Slot **airdrop** hanya memposting token yang lolos filter ketat (MC/liq/LP/tax/honeypot). Jika tidak ada yang lolos → otomatis fallback **spot**.

Autopost GHA: cron **tiap jam** → cek `schedule.json` (window 6 jam). PC tidak perlu nyala.

## GitHub Actions (hemat free tier)

Repo **publik** → menit Actions GitHub-hosted **gratis tanpa batas**.  
Kalau suatu saat privat, kuota free ≈ **2.000 menit/bulan**.

| Workflow | Jadwal | Catatan |
|----------|--------|---------|
| **Autopost** | tiap jam `:07` UTC | Skip cepat jika di luar `schedule.json` |
| **Admin commands** | tiap 10 menit | `/jadwal` `/status` `/test` … |
| Top Aktif snapshot | 2×/hari | |
| Top Aktif umumkan | Sabtu | |
| DEX Screen | opsional | |

Pengumuman Top 10 → topik [t.me/caricuanhp/65640](https://t.me/caricuanhp/65640) (`ACTIVITY_THREAD_ID=65640`).

**Penting:** `ACTIVITY_SOURCE=gha` (default). Jangan biarkan `npm start` ON terus bersamaan GHA.

### Secrets

| Secret | Wajib |
|--------|-------|
| `TELEGRAM_BOT_TOKEN` | ✅ |
| `TELEGRAM_CHANNEL_ID` | ✅ |
| `GROQ_API_KEY` | ✅ (utama, gratis) |
| `OPENROUTER_API_KEY` | ✅ (fallback free) |
| `TEST_CHAT_ID` | untuk `/test` |
| `GEMINI_API_KEY` | hanya jika `AI_PROVIDER=auto`/`paid` |
| `TELEGRAM_FORWARD_CHAT_ID` | opsional |
| `TELEGRAM_FORWARD_THREAD_ID` | opsional (forward autopost) |

Repo variable opsional: `ACTIVITY_CHAT_ID`, `ACTIVITY_THREAD_ID` (default `65640`).

Repo variable `AI_PROVIDER` default **`free`** (tidak menyentuh Gemini/paid).

## AI cascade

- **`free`** (default): Groq → OpenRouter free → teks lokal
- **`auto`**: free dulu, lalu paid jika gagal
- **`paid`**: OpenRouter paid / Gemini dulu

## Editorial policy

### Konten vs gambar (aturan jelas)

| Situasi | Caption | Logo di gambar |
|---------|---------|----------------|
| Spot fokus 1 koin (hot) | Hook/info fokus ke koin itu | **1 logo** hot saja |
| Hook sengaja sebut ≥2 peer (mis. "G dan ONE") | Bandingkan peer | Logo koin yang disebut di **hook** |
| Info menyebut BTC/SOL sebagai konteks | Hindari (prompt melarang) | **Tidak** menambah logo |
| News sebut BTC, ETH, SOL di judul resmi | Rangkum sesuai judul | Multi-logo dari judul/hook |
| Airdrop | Fokus hot gem | 1 logo (kecuali hook sebut ≥2 gem) |

- **Fakta & logo:** harga/%, volume, judul promo, logo koin dari sumber asli (OKX/Bitget, DexScreener, CoinGecko). Tanpa logo/angka karangan.
- **AI:** variasi hook/ringkasan/CTA saja — wajib sesuai DATA, satu fokus per post.
- **Goal:** akurat & up-to-date → CTA (Trade / Baca Info / Chart / Join) → NFA & DYOR.

Gambar: Pollinations (background) + compose lokal. Layout divariasikan (`hero`/`stack`/`center`/`bottom`).

## DEX Screen (filter ketat)

Screening token DEX (DexScreener + GoPlus) — **hanya post jika lolos semua kriteria** (MC/FDV, likuiditas + LP lock/burn, anti-honeypot/tax/mint, volume & pertumbuhan).

```bash
npm run dex:screen:demo   # contoh format pesan
npm run dex:screen:dry    # scan sekali, tanpa kirim Telegram
npm run dex:screen        # scan + alert ke DEX_SCREEN_CHAT_ID
npm run dex:screen:loop   # polling tiap 5 menit (lokal)
```

| Kriteria | Default |
|----------|---------|
| MC min | $500K (ideal $1M–$10M) |
| MC/FDV | ≥ 30% |
| Liquidity | ≥ $50K & Liq/MC ≥ 10% |
| LP | Locked ≥ 80% atau burned |
| Tax buy/sell | ≤ 5%, bukan honeypot |
| Mint | mati atau ownership renounced |
| Top10 holders (ex LP/burn) | ≤ 20% |
| Vol 24h | ≥ $100K |
| Chg 24h | +10% … +100% |
| Buys/Sells | ≥ 0.8 |

Anti-spam: `data/dex-screen-cache.json` (24 jam). GHA: workflow **DEX Screen Alerts** tiap 30 menit.

## Top Aktif Mingguan (`@caricuanhp`)

**PC boleh OFF.** Snapshot lewat GHA 2×/hari (08 & 20 WIB), pengumuman Sabtu pagi ke topik [65640](https://t.me/caricuanhp/65640).

| Jadwal GHA | Fungsi |
|------------|--------|
| 08:00 & 20:00 WIB | Poll → simpan skor ke `data/activity-week.json` |
| **Sabtu pagi** | Poll + analisa Top 10 → post ke topik 65640 |

Bot API tidak bisa ambil history seminggu — poll berkala wajib. Autopost tetap 09 & 21 WIB (digeser agar tidak bentrok push).

Syarat: bot **admin** + Privacy Mode **Disable**. Default `ACTIVITY_SOURCE=gha`.

## Lokal

```bash
copy .env.example .env
npm install
npm start                 # bot realtime + jadwal + top aktif
npm run post:force        # post spot sekarang
npm run post:test-news    # preview news
npm run dex:screen:dry    # screening DEX (tanpa kirim)
npm run commands          # proses command sekali
```
