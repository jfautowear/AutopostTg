# Autopost Telegram Crypto — JF Network

Repo: https://github.com/jfautowear/AutopostTg

Bot Node.js: fetch **OKX** / **Bitget** → AI (ID) → post `@jfnetworknet` → forward [@caricuanhp](https://t.me/caricuanhp/80483).

## Penting: `.env` tidak ikut ke GitHub

File `.env` ada di `.gitignore`. Secrets diisi lewat **GitHub Actions Secrets**, bukan di-commit.

## Admin chat bot (`@jfnetworkindo` saja)

DM bot Telegram, command:

| Command | Fungsi |
|---------|--------|
| `/jadwal` | Lihat jadwal |
| `/jadwal_set 09:00,21:00` | Set semua jam |
| `/jadwal_add 12:30` | Tambah jam |
| `/jadwal_del 12:30` | Hapus jam |
| `/jadwal_on` / `/jadwal_off` | Aktif / nonaktif |
| `/post_sekarang` | Post sekarang |
| `/sumber okx\|bitget\|auto` | Sumber data |
| `/status` | Status |
| `/help` | Bantuan |

Akun selain `@jfnetworkindo` ditolak.

Jadwal tersimpan di `config/schedule.json`. Workflow **Admin Telegram Commands** poll tiap ~10 menit.

## GitHub Actions

| Workflow | Jadwal | Fungsi |
|----------|--------|--------|
| `autopost.yml` | tiap 15 menit | Post jika jam cocok `schedule.json` |
| `admin-commands.yml` | tiap 10 menit | Proses command admin |

### Secrets (Settings → Secrets → Actions)

| Secret | Wajib |
|--------|-------|
| `TELEGRAM_BOT_TOKEN` | ✅ |
| `TELEGRAM_CHANNEL_ID` | ✅ (`@jfnetworknet`) |
| `GEMINI_API_KEY` | ✅ |
| `OPENROUTER_API_KEY` | ✅ (fallback) |
| `TELEGRAM_FORWARD_CHAT_ID` | opsional (`@caricuanhp`) |
| `TELEGRAM_FORWARD_THREAD_ID` | opsional (`80483`) |

Bot harus **admin channel** + **anggota/admin grup**.

## Format post

HOOK → Info → CTA → Disclaimer NFA & DYOR + 2 tombol (affiliate + gabung grup). Caption ≤ 700 karakter.

## AI cascade

Gemini → (limit/kredit habis) → OpenRouter → fallback teks.

## Lokal

```bash
copy .env.example .env
npm install
npm run post:force    # post sekarang
npm run commands      # proses command Telegram
npm start             # watcher jadwal lokal
```
