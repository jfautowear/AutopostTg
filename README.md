# Autopost Telegram Crypto — JF Network

Repo: https://github.com/jfautowear/AutopostTg

Bot Node.js: fetch **OKX** / **Bitget** / DEX / **pengumuman OKX** → konten → post `@jfnetworknet` → forward [@caricuanhp](https://t.me/caricuanhp).

**PC boleh OFF.** Autopost, berita/promo, dan Top Aktif jalan lewat GitHub Actions. PC hanya untuk cek/manual.

## Penting: `.env` tidak ikut ke GitHub

File `.env` ada di `.gitignore`. Secrets diisi lewat **GitHub Actions Secrets**, bukan di-commit.

## Admin chat bot (`@jfnetworkindo` saja)

| Command | Fungsi |
|---------|--------|
| `/jadwal` | Lihat jadwal |
| `/jadwal_set 09:00,21:00` | Set semua jam |
| `/jadwal_add 12:30` | Tambah jam |
| `/jadwal_del 12:30` | Hapus jam |
| `/jadwal_on` / `/jadwal_off` | Aktif / nonaktif |
| `/test` / `/test_airdrop` / `/test_news` | Preview ke `TEST_CHAT_ID` |
| `/postnow` / `/airdrop` / `/news` | Post ke channel |
| `/sumber okx\|bitget\|auto` | Sumber data CEX |
| `/kategori spot\|airdrop\|news\|auto` | Jenis konten |
| `/status` | Status |
| `/help` | Bantuan |

Akun selain `@jfnetworkindo` ditolak. Jadwal di `config/schedule.json`.

## Jenis konten (rotasi otomatis)

Dengan `POST_CATEGORY=auto` (default di Actions), tiap run bergilir:

| Kategori | Sumber | AI teks |
|----------|--------|---------|
| **spot** | Hot gainer OKX/Bitget | LLM free (Groq/OR) |
| **airdrop** | DEX trending | Template (0 kredit) |
| **news** | Pengumuman OKX (listing, event, Jumpstart, Earn, Web3) | Template (0 kredit) |

Semua jalan di **GitHub Actions** 2×/hari — PC tidak perlu nyala.

## GitHub Actions (hemat free tier)

Repo **publik** → menit Actions GitHub-hosted **gratis tanpa batas**.  
Kalau suatu saat privat, kuota free ≈ **2.000 menit/bulan**.

| Workflow | Jadwal | Run/bulan | Estimasi menit |
|----------|--------|-----------|----------------|
| Autopost | 2×/hari (09 & 21 WIB) | ~60 | ~120–180 |
| Top Aktif snapshot | 2×/hari (08 & 20 WIB, digeser) | ~60 | ~60–120 |
| Top Aktif umumkan | Sabtu pagi (ikut run 08:00) | ~4 | sudah dihitung |
| Admin commands | manual saja | ~0 | ~0 |
| **Total** | | **~120** | **~180–300 menit/bulan** |

→ Di akun free privat masih **aman** (~10–15% dari 2.000). Di repo publik **tidak makan kuota berbayar**.

Jangan naikkan poll ke `*/5` / `*/15` — itu yang boros.

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

Gambar: Pollinations (gratis).

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
npm run post:test-airdrop # preview airdrop
npm run commands          # proses command sekali
```
