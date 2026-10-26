# Bot Keuangan Telegram -> Google Sheets (Inline Menu)

Bot Telegram untuk mencatat keuangan yang terhubung langsung dengan Google Sheets. Mendukung *multi-user*, di mana setiap pengguna dapat menggunakan Google Sheet milik mereka sendiri.

---

##  Alur Penggunaan

1. **`/start`** ➔ (Pertama kali) Hubungkan Google Sheet milikmu.
2. Pilih menu **`[Pemasukan]`** atau **`[Pengeluaran]`**.
3. Pilih **Kategori** via tombol inline.
4. Ketik **Nominal** (contoh format: `25000`, `25rb`, atau `1,5jt`).
5. Transaksi otomatis tersimpan ke Google Sheet milikmu.

---

## Fitur Utama

- **Menu Inline Button:** Navigasi serba praktis tinggal klik.
- **Auto Clean Chat (`CONFIG.AUTO_CLEAN_CHAT`):** Tampilan chat tetap bersih dengan sistem 1 pesan "panel" yang terus diperbarui (di-edit), serta otomatis menghapus pesan teks input dari pengguna.
- **Multi-User (`/setsheet`):** Tiap pengguna dapat menghubungkan dan menyimpan data ke Google Sheet masing-masing.
- **Ringkasan Bulanan:** Rekap data otomatis untuk pemasukan, pengeluaran, dan saldo bulan berjalan.
- **Hapus Transaksi:** Menghapus transaksi dengan mudah melalui tombol setelah menyimpan, via menu, atau perintah `/hapus`.
- **System Whitelist & Panel Admin:**
  - Fitur perintah: `/izinkan`, `/cabut`, `/daftar`.
  - Pengguna baru yang belum terdaftar akan otomatis mengirimkan permintaan akses ke admin lengkap dengan tombol `[Izinkan]`, tanpa perlu mengedit kode atau *re-deploy*.
- **Anti Duplikat Update:** Proteksi dari pemrosesan *update* Telegram ganda.

---

##  Catatan Important (Penting)

* `doPost()` **TIDAK** mengembalikan `ContentService` atau `HtmlService`.
* Script berjalan sebagai **PEMILIK deployment**. Oleh karena itu, setiap pengguna wajib membagikan (*share*) Google Sheet mereka dengan akses **Editor** ke alamat email pemilik bot.
