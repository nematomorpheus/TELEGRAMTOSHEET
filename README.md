/**
 * ============================================================
 * BOT KEUANGAN TELEGRAM -> GOOGLE SHEETS (INLINE MENU)
 * Multi-user: tiap orang pakai Google Sheet-nya sendiri
 * ============================================================
 *
 * ALUR PENGGUNAAN:
 * /start -> (pertama kali) hubungkan Google Sheet milikmu
 *        -> menu [Pemasukan] [Pengeluaran]
 *        -> pilih kategori (tombol)
 *        -> ketik nominal (25000 / 25rb / 1,5jt)
 *        -> otomatis tersimpan ke Google Sheet milikmu
 *
 * FITUR:
 * - Menu inline button (tinggal klik)
 * - Chat bersih otomatis: 1 pesan "panel" yang di-edit terus,
 *   pesan yang kamu ketik ikut dihapus (CONFIG.AUTO_CLEAN_CHAT)
 * - Multi-user: tiap user hubungkan Google Sheet sendiri (/setsheet)
 * - Ringkasan bulan ini (pemasukan, pengeluaran, saldo)
 * - Hapus transaksi (tombol setelah simpan, menu, atau /hapus)
 * - Whitelist user + panel admin: /izinkan, /cabut, /daftar
 *   (user baru yang ditolak otomatis mengirim permintaan ke admin
 *    dengan tombol [Izinkan], tanpa perlu edit kode / deploy ulang)
 * - Anti duplikat update Telegram
 *
 * PENTING:
 * - doPost() TIDAK return ContentService/HtmlService
 * - Script berjalan sebagai PEMILIK deployment, jadi setiap user
 *   harus men-share Google Sheet-nya (Editor) ke email pemilik bot.
 */
