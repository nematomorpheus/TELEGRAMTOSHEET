const CONFIG = {
  TELEGRAM_BOT_TOKEN: 'MASUKKAN_BOT_TOKEN_TELEGRAM',

  // WAJIB URL Web App hasil Deploy yang berakhir /exec
  WEB_APP_URL: 'MASUKKAN_WEB_APP_URL_EXEC',

  // Nama tab di dalam Google Sheet tiap user (dibuat otomatis)
  SHEET_NAME: 'Catatan Keuangan',
  TIME_ZONE: 'Asia/Jakarta',

  // true = pesan yang kamu ketik & pesan bot lama dihapus otomatis
  AUTO_CLEAN_CHAT: true,

  // ADMIN: Telegram User ID kamu (kirim /id ke bot buat lihat). Contoh: ['123456789']
  // Admin selalu boleh pakai bot, dan bisa menambah/mencabut user lewat
  // /izinkan <id>, /cabut <id>, /daftar, atau tombol [Izinkan] dari permintaan akses.
  ADMIN_USER_IDS: [],

  // (Opsional) User tetap yang selalu boleh pakai, contoh: ['987654321'].
  // Biasanya cukup pakai /izinkan, jadi boleh dikosongkan.
  //
  // CATATAN: jika ADMIN_USER_IDS dan ALLOWED_USER_IDS sama-sama kosong
  // dan belum ada user yang diizinkan, bot terbuka untuk SIAPA SAJA.
  ALLOWED_USER_IDS: [],

  // Edit kategori sesuai kebutuhan. e = emoji, n = nama kategori.
  CATEGORIES: {
    E: [ // Pengeluaran
      { e: '🍜', n: 'Makan' },
      { e: '🎮', n: 'Hiburan' },
      { e: '🛒', n: 'Kebutuhan' },
      { e: '🚗', n: 'Transportasi' },
      { e: '🛍️', n: 'Belanja' },
      { e: '🧾', n: 'Tagihan' },
      { e: '💊', n: 'Kesehatan' },
      { e: '🏦', n: 'Tabungan' },
      { e: '📦', n: 'Lainnya' }
    ],
    I: [ // Pemasukan
      { e: '💼', n: 'Gaji' },
      { e: '🎁', n: 'Bonus' },
      { e: '🏪', n: 'Usaha' },
      { e: '💝', n: 'Hadiah' },
      { e: '📈', n: 'Investasi' },
      { e: '📦', n: 'Lainnya' }
    ]
  }
};

// Jenis transaksi (bukan daftar menu)
const TYPES = {
  I: { name: 'Pemasukan', emoji: '💰' },
  E: { name: 'Pengeluaran', emoji: '💸' }
};

const STATE_TTL_SECONDS = 21600; // 6 jam

// Cache Spreadsheet selama 1x eksekusi supaya tidak openById berulang
var SS_MEMO = {};


// ============================================================
// WEBHOOK TELEGRAM
// ============================================================

function doPost(e) {
  var chatId = '';

  try {
    if (!e || !e.postData || !e.postData.contents) {
      Logger.log('POST kosong.');
      return;
    }

    var update = JSON.parse(e.postData.contents);
    Logger.log('Update Telegram: ' + JSON.stringify(update));

    if (isDuplicateTelegramUpdate(update)) {
      Logger.log('Duplicate update diabaikan.');
      return;
    }

    if (update.callback_query) {
      var cq = update.callback_query;
      chatId = cq.message && cq.message.chat ? String(cq.message.chat.id) : '';
      handleCallback(cq);
      return;
    }

    if (update.message) {
      chatId = update.message.chat ? String(update.message.chat.id) : '';
      handleMessage(update.message);
      return;
    }

    Logger.log('Update bukan message / callback_query.');

  } catch (error) {
    Logger.log('ERROR doPost: ' + error.message);
    Logger.log(error.stack || '');

    if (chatId) {
      try {
        sendMessage(
          chatId,
          '❌ <b>Terjadi kesalahan</b>\n\n' + escapeHtml(error.message)
        );
      } catch (sendError) {
        Logger.log('Gagal kirim error: ' + sendError.message);
      }
    }
  }

  // PENTING: JANGAN return ContentService atau HtmlService di sini.
}


function doGet(e) {
  return HtmlService.createHtmlOutput(
    '<h3>Bot Keuangan Telegram → Google Sheets aktif.</h3>' +
    '<p>Webhook siap menerima POST dari Telegram.</p>'
  );
}


// ============================================================
// HANDLER PESAN TEKS
// ============================================================

function handleMessage(msg) {
  var chatId = String(msg.chat.id);
  var from = msg.from || {};
  var userId = String(from.id || '');
  var text = String(msg.text || '').trim();

  if (!text) return;

  if (!isAllowedUser(userId)) {
    var requested =
      text.toLowerCase().indexOf('/start') === 0
        ? notifyAdminsOfRequest(from)
        : false;

    sendMessage(
      chatId,
      '⛔ Maaf, bot ini bersifat pribadi.\n' +
      'User ID kamu: <code>' + escapeHtml(userId) + '</code>\n\n' +
      (requested
        ? '📨 Permintaan aksesmu sudah dikirim ke admin. Kamu akan dikabari di sini kalau sudah disetujui.'
        : 'Kirim ID ini ke admin bot supaya kamu didaftarkan.')
    );
    return;
  }

  // Chat bersih: hapus pesan yang barusan diketik user
  if (CONFIG.AUTO_CLEAN_CHAT) {
    deleteMessage(chatId, msg.message_id);
  }

  var command = text.charAt(0) === '/'
    ? text.split(/[\s@]/)[0].toLowerCase()
    : '';

  var state = getState(userId);

  if (command === '/id') {
    showPanel(
      chatId,
      userId,
      '🆔 User ID kamu: <code>' + escapeHtml(userId) + '</code>',
      backToMenuKeyboard()
    );
    return;
  }

  if (command === '/ping') {
    showPanel(
      chatId,
      userId,
      '🏓 Pong! Telegram → Apps Script aktif.',
      backToMenuKeyboard()
    );
    return;
  }

  // Setiap command membatalkan langkah input sebelumnya
  if (command) clearState(userId);

  // ---- Perintah admin ----
  if (isAdmin(userId)) {
    var arg = text.split(/\s+/)[1] || '';

    if (command === '/izinkan' || command === '/cabut') {
      if (!/^\d{4,15}$/.test(arg)) {
        showPanel(
          chatId,
          userId,
          '⚠️ Format: <code>' + command + ' 123456789</code>\n' +
          '(ID Telegram bisa dilihat user dengan perintah /id)',
          backToMenuKeyboard()
        );
        return;
      }

      if (command === '/izinkan') {
        allowUser(arg, '');
        notifyUserApproved(arg);

        showPanel(
          chatId,
          userId,
          '✅ ID <code>' + escapeHtml(arg) + '</code> diizinkan.',
          backToMenuKeyboard()
        );
        return;
      }

      var result = revokeUser(arg);
      var revokeText = {
        ok: '🚫 Akses ID <code>' + escapeHtml(arg) + '</code> dicabut.',
        admin: '⚠️ Admin tidak bisa dicabut lewat bot (ubah <code>ADMIN_USER_IDS</code> di kode).',
        fixed: '⚠️ ID ini ada di <code>ALLOWED_USER_IDS</code> (kode). Hapus dari kode untuk mencabut.',
        none: 'ℹ️ ID <code>' + escapeHtml(arg) + '</code> tidak ada di daftar izin.'
      };

      showPanel(chatId, userId, revokeText[result], backToMenuKeyboard());
      return;
    }

    if (command === '/daftar') {
      showPanel(chatId, userId, buildAccessList(), backToMenuKeyboard());
      return;
    }
  }

  if (command === '/setsheet') {
    promptSheetSetup(chatId, 0, userId, from);
    return;
  }

  // Sedang menunggu link/ID Google Sheet?
  if (!command && state && state.step === 'setsheet') {
    handleSheetInput(chatId, userId, text);
    return;
  }

  // Belum punya Sheet -> wajib hubungkan dulu
  if (!hasSheet(userId)) {
    promptSheetSetup(chatId, 0, userId, from);
    return;
  }

  if (command === '/start' || command === '/menu') {
    showPanel(
      chatId,
      userId,
      buildWelcomeText(from, command === '/start'),
      mainMenuKeyboard()
    );
    return;
  }

  if (command === '/batal') {
    showPanel(chatId, userId, '❌ Dibatalkan.\n\nMau catat apa?', mainMenuKeyboard());
    return;
  }

  if (command === '/ringkasan') {
    showPanel(chatId, userId, buildSummaryText(userId), backToMenuKeyboard());
    return;
  }

  if (command === '/hapus') {
    var del = buildDeleteList(userId);
    showPanel(chatId, userId, del.text, del.keyboard);
    return;
  }

  if (command === '/sheet') {
    var info = buildSheetInfo(userId);
    showPanel(chatId, userId, info.text, info.keyboard);
    return;
  }

  // Sedang menunggu nominal?
  if (!command && state && state.step === 'amount') {
    handleAmountInput(msg, state, text);
    return;
  }

  showPanel(
    chatId,
    userId,
    '👇 Pilih dulu jenis transaksinya ya:',
    mainMenuKeyboard()
  );
}


function handleAmountInput(msg, state, text) {
  var chatId = String(msg.chat.id);
  var from = msg.from || {};
  var userId = String(from.id || '');

  var amount = parseAmount(text);

  if (amount <= 0) {
    updatePanel(
      chatId,
      userId,
      '⚠️ <b>"' + escapeHtml(text.substring(0, 30)) + '"</b> bukan nominal yang valid.\n\n' +
      'Ketik angka saja, contoh:\n' +
      '<code>25000</code>  •  <code>25rb</code>  •  <code>1,5jt</code>',
      cancelKeyboard()
    );
    return;
  }

  var transaction = {
    type: TYPES[state.type].name,
    category: state.category,
    amount: amount
  };

  var senderInfo = getTelegramSenderInfo(msg);
  var id = saveTransaction(transaction, senderInfo);

  clearState(userId);

  var typeInfo = TYPES[state.type];

  var reply =
    '✅ <b>BERHASIL DISIMPAN</b>\n' +
    '━━━━━━━━━━━━━━━━━━\n' +
    typeInfo.emoji + ' ' + escapeHtml(typeInfo.name) + '\n' +
    '📂 ' + escapeHtml(state.category) + '\n' +
    '💵 <b>' + escapeHtml(formatRupiah(amount)) + '</b>\n' +
    '📅 ' + escapeHtml(formatIndonesianDate(new Date())) + '\n' +
    '🆔 <code>' + escapeHtml(id) + '</code>\n\n' +
    'Mau catat lagi?';

  updatePanel(chatId, userId, reply, successKeyboard(id));
}


function handleSheetInput(chatId, userId, text) {
  var spreadsheetId = extractSpreadsheetId(text);
  var cancelKb = hasSheet(userId) ? cancelKeyboard() : undefined;

  if (!spreadsheetId) {
    updatePanel(
      chatId,
      userId,
      '⚠️ Link / ID Google Sheet tidak dikenali.\n\n' +
      'Kirim link lengkapnya, contoh:\n' +
      '<code>https://docs.google.com/spreadsheets/d/…/edit</code>',
      cancelKb
    );
    return;
  }

  var ss;

  try {
    ss = SpreadsheetApp.openById(spreadsheetId);
    prepareSheet(ss); // sekalian cek hak Editor (bikin tab + header)
  } catch (err) {
    Logger.log('Gagal buka sheet: ' + err.message);

    updatePanel(
      chatId,
      userId,
      '⚠️ <b>Sheet tidak bisa dibuka / ditulis.</b>\n\n' +
      'Pastikan Sheet sudah di-share sebagai <b>Editor</b> ke:\n' +
      '<code>' + escapeHtml(getOwnerEmail() || 'email pemilik bot') + '</code>\n\n' +
      'Setelah itu kirim ulang link-nya.',
      cancelKb
    );
    return;
  }

  setUserSheetId(userId, spreadsheetId);
  SS_MEMO[spreadsheetId] = ss;
  clearState(userId);

  updatePanel(
    chatId,
    userId,
    '✅ <b>Terhubung!</b>\n\n' +
    '📄 ' + escapeHtml(ss.getName()) + '\n' +
    '📂 Tab "' + escapeHtml(CONFIG.SHEET_NAME) + '" sudah siap dipakai.\n\n' +
    'Mau catat apa?',
    mainMenuKeyboard()
  );
}


// ============================================================
// HANDLER TOMBOL (CALLBACK QUERY)
// ============================================================

function handleCallback(cq) {
  var from = cq.from || {};
  var userId = String(from.id || '');
  var chatId = String(cq.message.chat.id);
  var messageId = cq.message.message_id;
  var data = String(cq.data || '');

  // Hilangkan indikator "loading" di tombol
  answerCallback(cq.id);

  if (!isAllowedUser(userId)) {
    sendMessage(chatId, '⛔ Maaf, bot ini bersifat pribadi.');
    return;
  }

  // ---- Admin: setujui / abaikan permintaan akses ----
  // (ditangani sebelum setPanel supaya pesan notifikasi tidak dianggap panel)
  if (data.indexOf('ap:') === 0 || data.indexOf('ig:') === 0) {
    if (!isAdmin(userId)) return;

    var targetId = data.substring(3);
    var labelMatch = String(cq.message.text || '').match(/👤 (.+)/);
    var targetLabel = labelMatch ? labelMatch[1].trim() : '';

    if (data.indexOf('ap:') === 0) {
      allowUser(targetId, targetLabel);

      editMessage(
        chatId,
        messageId,
        '✅ <b>Diizinkan</b>\n' +
        '👤 ' + escapeHtml(targetLabel || '-') + '\n' +
        '🆔 <code>' + escapeHtml(targetId) + '</code>'
      );

      notifyUserApproved(targetId);
    } else {
      editMessage(
        chatId,
        messageId,
        '🚫 <b>Diabaikan</b>\n' +
        '👤 ' + escapeHtml(targetLabel || '-') + '\n' +
        '🆔 <code>' + escapeHtml(targetId) + '</code>'
      );
    }

    return;
  }

  // Pesan yang sedang diklik = panel aktif
  setPanel(userId, messageId);

  // ---- Ganti / hubungkan sheet ----
  if (data === 'setsheet') {
    promptSheetSetup(chatId, messageId, userId, from);
    return;
  }

  // Belum punya Sheet -> wajib hubungkan dulu
  if (!hasSheet(userId)) {
    promptSheetSetup(chatId, messageId, userId, from);
    return;
  }

  // ---- Menu utama ----
  if (data === 'menu') {
    clearState(userId);
    editMessage(chatId, messageId, 'Mau catat apa?', mainMenuKeyboard());
    return;
  }

  // ---- Batal ----
  if (data === 'cancel') {
    clearState(userId);
    editMessage(chatId, messageId, '❌ Dibatalkan.\n\nMau catat apa?', mainMenuKeyboard());
    return;
  }

  // ---- Ringkasan ----
  if (data === 'sum') {
    clearState(userId);
    editMessage(chatId, messageId, buildSummaryText(userId), backToMenuKeyboard());
    return;
  }

  // ---- Info sheet ----
  if (data === 'sheet') {
    clearState(userId);
    var info = buildSheetInfo(userId);
    editMessage(chatId, messageId, info.text, info.keyboard);
    return;
  }

  // ---- Daftar transaksi untuk dihapus ----
  if (data === 'dlist') {
    clearState(userId);
    var del = buildDeleteList(userId);
    editMessage(chatId, messageId, del.text, del.keyboard);
    return;
  }

  // ---- Konfirmasi hapus: dc:<ID> ----
  if (data.indexOf('dc:') === 0) {
    var tx = findTransactionById(data.substring(3), userId);

    if (!tx) {
      editMessage(
        chatId,
        messageId,
        'ℹ️ Transaksi tidak ditemukan (mungkin sudah dihapus).',
        mainMenuKeyboard()
      );
      return;
    }

    editMessage(
      chatId,
      messageId,
      '⚠️ <b>Yakin mau hapus transaksi ini?</b>\n\n' + transactionDetailText(tx),
      confirmDeleteKeyboard(tx.id)
    );
    return;
  }

  // ---- Eksekusi hapus: dy:<ID> ----
  if (data.indexOf('dy:') === 0) {
    var removed = deleteTransactionById(data.substring(3), userId);

    if (!removed) {
      editMessage(
        chatId,
        messageId,
        'ℹ️ Transaksi tidak ditemukan (mungkin sudah dihapus).',
        mainMenuKeyboard()
      );
      return;
    }

    editMessage(
      chatId,
      messageId,
      '🗑️ <b>TRANSAKSI DIHAPUS</b>\n\n' + transactionDetailText(removed) +
      '\n\nMau catat apa?',
      mainMenuKeyboard()
    );
    return;
  }

  // ---- Pilih jenis: t:I / t:E ----
  if (data.indexOf('t:') === 0) {
    var typeCode = data.split(':')[1];

    if (!TYPES[typeCode]) return;

    setState(userId, { step: 'category', type: typeCode });

    editMessage(
      chatId,
      messageId,
      TYPES[typeCode].emoji + ' <b>' + escapeHtml(TYPES[typeCode].name) + '</b>\n\n' +
      'Pilih kategori:',
      categoryKeyboard(typeCode)
    );
    return;
  }

  // ---- Pilih kategori: c:E:3 ----
  if (data.indexOf('c:') === 0) {
    var parts = data.split(':');
    var code = parts[1];
    var index = Number(parts[2]);
    var list = CONFIG.CATEGORIES[code];

    if (!TYPES[code] || !list || !list[index]) return;

    var cat = list[index];

    setState(userId, {
      step: 'amount',
      type: code,
      category: cat.n
    });

    editMessage(
      chatId,
      messageId,
      TYPES[code].emoji + ' <b>' + escapeHtml(TYPES[code].name) + '</b>  ›  ' +
      cat.e + ' <b>' + escapeHtml(cat.n) + '</b>\n\n' +
      '✍️ Ketik nominalnya, contoh:\n' +
      '<code>25000</code>  •  <code>25rb</code>  •  <code>1,5jt</code>',
      cancelKeyboard()
    );
    return;
  }
}


// ============================================================
// ONBOARDING GOOGLE SHEET (MULTI USER)
// ============================================================

function promptSheetSetup(chatId, messageId, userId, from) {
  var first = !hasSheet(userId);
  var email = getOwnerEmail();

  setState(userId, { step: 'setsheet' });

  var text =
    (first
      ? '👋 Halo, <b>' + escapeHtml((from && from.first_name) || 'teman') + '</b>!\n\n' +
        'Sebelum mulai, hubungkan dulu Google Sheet milikmu:\n\n'
      : '🔄 <b>GANTI GOOGLE SHEET</b>\n\n') +
    '1️⃣ Buka (atau buat) Google Sheet kosong\n' +
    '2️⃣ Klik <b>Share</b>, tambahkan email ini sebagai <b>Editor</b>:\n' +
    '<code>' + escapeHtml(email || 'email pemilik bot') + '</code>\n' +
    '3️⃣ Kirim <b>link</b> Sheet-nya ke sini';

  var keyboard = first ? undefined : cancelKeyboard();

  if (messageId) {
    editMessage(chatId, messageId, text, keyboard);
    setPanel(userId, messageId);
  } else {
    showPanel(chatId, userId, text, keyboard);
  }
}


function buildSheetInfo(userId) {
  var keyboard = {
    inline_keyboard: [
      [{ text: '🔄 Ganti Sheet', callback_data: 'setsheet' }],
      [{ text: '⬅️ Menu Utama', callback_data: 'menu' }]
    ]
  };

  try {
    var ss = getSpreadsheet(userId);

    return {
      text:
        '⚙️ <b>SHEET SAYA</b>\n' +
        '━━━━━━━━━━━━━━━━━━\n' +
        '📄 ' + escapeHtml(ss.getName()) + '\n' +
        '🔗 <a href="' + escapeHtml(ss.getUrl()) + '">Buka Google Sheet</a>',
      keyboard: keyboard
    };
  } catch (err) {
    return {
      text: '⚠️ ' + escapeHtml(err.message),
      keyboard: keyboard
    };
  }
}


function extractSpreadsheetId(text) {
  var raw = String(text || '').trim();

  var match = raw.match(/\/d\/([a-zA-Z0-9_-]{20,})/);

  if (match) return match[1];

  if (/^[a-zA-Z0-9_-]{25,}$/.test(raw)) return raw;

  return '';
}


function getOwnerEmail() {
  try {
    return Session.getEffectiveUser().getEmail() || '';
  } catch (err) {
    return '';
  }
}


function getUserSheetId(userId) {
  return PropertiesService.getScriptProperties().getProperty('SHEET_' + userId) || '';
}


function setUserSheetId(userId, spreadsheetId) {
  PropertiesService.getScriptProperties().setProperty('SHEET_' + userId, spreadsheetId);
}


function hasSheet(userId) {
  return !!getUserSheetId(userId);
}


// ============================================================
// KEYBOARD (INLINE BUTTON)
// ============================================================

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '💰 Pemasukan', callback_data: 't:I' },
        { text: '💸 Pengeluaran', callback_data: 't:E' }
      ],
      [
        { text: '📊 Ringkasan', callback_data: 'sum' },
        { text: '🗑️ Hapus', callback_data: 'dlist' }
      ],
      [
        { text: '⚙️ Sheet Saya', callback_data: 'sheet' }
      ]
    ]
  };
}


function successKeyboard(id) {
  var kb = mainMenuKeyboard();

  kb.inline_keyboard.unshift([
    { text: '🗑️ Salah? Hapus transaksi ini', callback_data: 'dc:' + id }
  ]);

  return kb;
}


function categoryKeyboard(typeCode) {
  var list = CONFIG.CATEGORIES[typeCode] || [];
  var rows = [];
  var row = [];

  list.forEach(function (cat, i) {
    row.push({
      text: cat.e + ' ' + cat.n,
      callback_data: 'c:' + typeCode + ':' + i
    });

    if (row.length === 2) {
      rows.push(row);
      row = [];
    }
  });

  if (row.length) rows.push(row);

  rows.push([
    { text: '⬅️ Kembali', callback_data: 'menu' },
    { text: '❌ Batal', callback_data: 'cancel' }
  ]);

  return { inline_keyboard: rows };
}


function cancelKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '❌ Batal', callback_data: 'cancel' }]
    ]
  };
}


function backToMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '⬅️ Menu Utama', callback_data: 'menu' }]
    ]
  };
}


function confirmDeleteKeyboard(id) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Ya, hapus', callback_data: 'dy:' + id },
        { text: '⬅️ Batal', callback_data: 'dlist' }
      ]
    ]
  };
}


// ============================================================
// TEKS
// ============================================================

function buildWelcomeText(from, isStart) {
  var name = escapeHtml(from.first_name || 'teman');

  if (isStart) {
    return (
      '👋 Halo, <b>' + name + '</b>!\n\n' +
      'Selamat datang di <b>Bot Catatan Keuangan</b>.\n' +
      'Catat pemasukan & pengeluaranmu langsung ke Google Sheet, tinggal klik tombol.\n\n' +
      'Mau catat apa hari ini?'
    );
  }

  return 'Mau catat apa?';
}


function buildSummaryText(userId) {
  var s = getMonthSummary(userId);
  var balance = s.income - s.expense;

  var text =
    '📊 <b>RINGKASAN ' + escapeHtml(monthLabel(new Date()).toUpperCase()) + '</b>\n' +
    '━━━━━━━━━━━━━━━━━━\n' +
    '💰 Pemasukan: <b>' + escapeHtml(formatRupiah(s.income)) + '</b>\n' +
    '💸 Pengeluaran: <b>' + escapeHtml(formatRupiah(s.expense)) + '</b>\n' +
    '🧮 Saldo: <b>' + (balance < 0 ? '-' : '') + escapeHtml(formatRupiah(balance)) + '</b>';

  var cats = Object.keys(s.byCat).sort(function (a, b) {
    return s.byCat[b] - s.byCat[a];
  });

  if (cats.length) {
    text += '\n\n<b>Pengeluaran per kategori:</b>';

    cats.forEach(function (c) {
      text += '\n• ' + escapeHtml(c) + ': ' + escapeHtml(formatRupiah(s.byCat[c]));
    });
  }

  return text;
}


function buildDeleteList(userId) {
  var items = getRecentTransactions(userId, 5);

  if (!items.length) {
    return {
      text: '📭 Belum ada transaksi yang bisa dihapus.',
      keyboard: backToMenuKeyboard()
    };
  }

  var rows = items.map(function (t) {
    var emoji = t.type === 'Pemasukan' ? '💰' : '💸';

    return [{
      text: emoji + ' ' + t.category + ' • ' + formatRupiah(t.amount) + ' • ' + t.dateLabel,
      callback_data: 'dc:' + t.id
    }];
  });

  rows.push([{ text: '⬅️ Menu Utama', callback_data: 'menu' }]);

  return {
    text: '🗑️ <b>HAPUS TRANSAKSI</b>\n\nPilih transaksi yang mau dihapus (5 terakhir):',
    keyboard: { inline_keyboard: rows }
  };
}


function transactionDetailText(t) {
  var emoji = t.type === 'Pemasukan' ? '💰' : '💸';

  return (
    emoji + ' ' + escapeHtml(t.type) + '\n' +
    '📂 ' + escapeHtml(t.category) + '\n' +
    '💵 <b>' + escapeHtml(formatRupiah(t.amount)) + '</b>\n' +
    '📅 ' + escapeHtml(formatIndonesianDate(t.date)) + '\n' +
    '🆔 <code>' + escapeHtml(t.id) + '</code>'
  );
}


// ============================================================
// PANEL (CHAT BERSIH)
// ============================================================
// Konsep: bot hanya punya 1 pesan "panel" yang di-edit terus.
// Kalau perlu pesan baru, panel lama dihapus.

function setPanel(userId, messageId) {
  if (!messageId) return;

  CacheService.getScriptCache().put(
    'PANEL_' + userId,
    String(messageId),
    STATE_TTL_SECONDS
  );
}


function getPanel(userId) {
  var value = CacheService.getScriptCache().get('PANEL_' + userId);

  return value ? Number(value) : 0;
}


// Kirim panel baru di paling bawah, lalu hapus panel lama
function showPanel(chatId, userId, text, keyboard) {
  var oldId = getPanel(userId);
  var newId = parseMessageId(sendMessage(chatId, text, keyboard));

  setPanel(userId, newId);

  if (CONFIG.AUTO_CLEAN_CHAT && oldId && oldId !== newId) {
    deleteMessage(chatId, oldId);
  }

  return newId;
}


// Edit panel yang ada; kalau tidak bisa, kirim panel baru
function updatePanel(chatId, userId, text, keyboard) {
  var panelId = getPanel(userId);

  if (
    CONFIG.AUTO_CLEAN_CHAT &&
    panelId &&
    editMessage(chatId, panelId, text, keyboard)
  ) {
    return panelId;
  }

  return showPanel(chatId, userId, text, keyboard);
}


function parseMessageId(body) {
  try {
    return JSON.parse(body).result.message_id || 0;
  } catch (err) {
    return 0;
  }
}


// ============================================================
// STATE (CACHE) - menyimpan langkah user sementara
// ============================================================

function setState(userId, state) {
  CacheService.getScriptCache().put(
    'STATE_' + userId,
    JSON.stringify(state),
    STATE_TTL_SECONDS
  );
}


function getState(userId) {
  var raw = CacheService.getScriptCache().get('STATE_' + userId);

  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}


function clearState(userId) {
  CacheService.getScriptCache().remove('STATE_' + userId);
}


// ============================================================
// AKSES & ANTI DUPLIKAT
// ============================================================

function idList(list) {
  return (list || []).map(String);
}


function isAdmin(userId) {
  return idList(CONFIG.ADMIN_USER_IDS).indexOf(String(userId)) !== -1;
}


// User yang diizinkan lewat bot: { "<id>": "<label>" }
function getDynamicAllowed() {
  var raw = PropertiesService.getScriptProperties().getProperty('ALLOWED_USERS');

  if (!raw) return {};

  try {
    var obj = JSON.parse(raw);

    return obj && typeof obj === 'object' ? obj : {};
  } catch (err) {
    return {};
  }
}


function saveDynamicAllowed(obj) {
  PropertiesService.getScriptProperties().setProperty(
    'ALLOWED_USERS',
    JSON.stringify(obj)
  );
}


function allowUser(targetId, label) {
  var lock = LockService.getScriptLock();

  lock.waitLock(10000);

  try {
    var id = String(targetId);
    var obj = getDynamicAllowed();

    obj[id] = label || obj[id] || '';

    saveDynamicAllowed(obj);
  } finally {
    lock.releaseLock();
  }
}


// Return: 'ok' | 'admin' | 'fixed' | 'none'
function revokeUser(targetId) {
  var id = String(targetId);

  if (isAdmin(id)) return 'admin';

  var lock = LockService.getScriptLock();

  lock.waitLock(10000);

  try {
    var obj = getDynamicAllowed();

    if (obj[id] === undefined) {
      return idList(CONFIG.ALLOWED_USER_IDS).indexOf(id) !== -1 ? 'fixed' : 'none';
    }

    delete obj[id];
    saveDynamicAllowed(obj);

    return 'ok';
  } finally {
    lock.releaseLock();
  }
}


function isAllowedUser(userId) {
  var id = String(userId);
  var admins = idList(CONFIG.ADMIN_USER_IDS);
  var fixed = idList(CONFIG.ALLOWED_USER_IDS);
  var dynamic = getDynamicAllowed();

  // Mode terbuka: belum ada pembatasan sama sekali
  if (!admins.length && !fixed.length && !Object.keys(dynamic).length) {
    return true;
  }

  return (
    admins.indexOf(id) !== -1 ||
    fixed.indexOf(id) !== -1 ||
    dynamic[id] !== undefined
  );
}


// Kirim permintaan akses ke semua admin (maks 1x per jam per user).
// Return true jika permintaan terkirim / sudah pernah dikirim.
function notifyAdminsOfRequest(from) {
  var admins = idList(CONFIG.ADMIN_USER_IDS);

  if (!admins.length) return false;

  var userId = String(from.id || '');
  var cache = CacheService.getScriptCache();

  if (cache.get('REQ_' + userId)) return true;

  var label =
    [from.first_name, from.last_name].filter(Boolean).join(' ') +
    (from.username ? ' (@' + from.username + ')' : '');

  var text =
    '🔔 <b>Permintaan akses bot</b>\n' +
    '👤 ' + escapeHtml(label || '-') + '\n' +
    '🆔 <code>' + escapeHtml(userId) + '</code>';

  var keyboard = {
    inline_keyboard: [
      [
        { text: '✅ Izinkan', callback_data: 'ap:' + userId },
        { text: '🚫 Abaikan', callback_data: 'ig:' + userId }
      ]
    ]
  };

  var sent = false;

  admins.forEach(function (adminId) {
    try {
      sendMessage(adminId, text, keyboard);
      sent = true;
    } catch (err) {
      Logger.log('Gagal kirim permintaan ke admin ' + adminId + ': ' + err.message);
    }
  });

  if (sent) cache.put('REQ_' + userId, '1', 3600);

  return sent;
}


function notifyUserApproved(targetId) {
  try {
    sendMessage(
      String(targetId),
      '✅ <b>Kamu sudah diizinkan</b> memakai bot ini.\nKetik /start untuk mulai.'
    );
  } catch (err) {
    Logger.log('Gagal kabari user ' + targetId + ': ' + err.message);
  }
}


function buildAccessList() {
  var admins = idList(CONFIG.ADMIN_USER_IDS);
  var fixed = idList(CONFIG.ALLOWED_USER_IDS);
  var dynamic = getDynamicAllowed();
  var ids = Object.keys(dynamic);

  var text = '👥 <b>DAFTAR AKSES</b>\n━━━━━━━━━━━━━━━━━━\n';

  text += '👑 <b>Admin</b>\n';
  text += admins.length
    ? admins.map(function (id) { return '• <code>' + escapeHtml(id) + '</code>'; }).join('\n')
    : '• (belum diatur)';

  if (fixed.length) {
    text += '\n\n📌 <b>Tetap (dari kode)</b>\n';
    text += fixed.map(function (id) { return '• <code>' + escapeHtml(id) + '</code>'; }).join('\n');
  }

  text += '\n\n✅ <b>Diizinkan</b>\n';
  text += ids.length
    ? ids.map(function (id) {
        return '• <code>' + escapeHtml(id) + '</code>' +
          (dynamic[id] ? ' — ' + escapeHtml(dynamic[id]) : '');
      }).join('\n')
    : '• (kosong)';

  text += '\n\nCabut akses: <code>/cabut &lt;id&gt;</code>';

  return text;
}


function isDuplicateTelegramUpdate(update) {
  var cache = CacheService.getScriptCache();

  var updateId =
    update && update.update_id !== undefined
      ? String(update.update_id)
      : '';

  if (!updateId) return false;

  var key = 'TG_UPDATE_' + updateId;

  if (cache.get(key)) return true;

  cache.put(key, '1', 600);

  return false;
}


function getTelegramSenderInfo(msg) {
  var from = msg.from || {};

  return {
    user_id: from.id ? String(from.id) : '',
    username: from.username || '',
    first_name: from.first_name || '',
    last_name: from.last_name || '',
    chat_id: msg.chat && msg.chat.id ? String(msg.chat.id) : '',
    chat_type: msg.chat && msg.chat.type ? msg.chat.type : ''
  };
}


// ============================================================
// GOOGLE SHEETS (PER USER)
// ============================================================

// Kolom: 0 ID | 1 Timestamp | 2 Tanggal | 3 Jenis | 4 Kategori |
//        5 Nominal | 6 User ID | 7 Username | 8 Nama

function getSpreadsheet(userId) {
  var spreadsheetId = getUserSheetId(userId);

  if (!spreadsheetId) {
    throw new Error('Google Sheet belum dihubungkan. Ketik /setsheet.');
  }

  if (SS_MEMO[spreadsheetId]) return SS_MEMO[spreadsheetId];

  try {
    SS_MEMO[spreadsheetId] = SpreadsheetApp.openById(spreadsheetId);
  } catch (err) {
    Logger.log('openById gagal: ' + err.message);

    throw new Error(
      'Tidak bisa membuka Google Sheet-mu. Pastikan masih di-share sebagai Editor ke ' +
      (getOwnerEmail() || 'email pemilik bot') +
      '. Ketik /setsheet untuk ganti sheet.'
    );
  }

  return SS_MEMO[spreadsheetId];
}


// Pastikan tab + header ada di spreadsheet tertentu
function prepareSheet(ss) {
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    var headers = [
      'ID',
      'Timestamp',
      'Tanggal',
      'Jenis',
      'Kategori',
      'Nominal',
      'Telegram User ID',
      'Username',
      'Nama'
    ];

    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold');

    sheet.setFrozenRows(1);
  }

  return sheet;
}


function getOrCreateSheet(userId) {
  return prepareSheet(getSpreadsheet(userId));
}


function saveTransaction(transaction, senderInfo) {
  var sheet = getOrCreateSheet(senderInfo.user_id);
  var now = new Date();

  var id = generateTransactionId(now);

  var fullName = [senderInfo.first_name, senderInfo.last_name]
    .filter(Boolean)
    .join(' ');

  sheet.appendRow([
    id,
    now,
    now,
    transaction.type,
    transaction.category,
    transaction.amount,
    senderInfo.user_id,
    senderInfo.username,
    fullName
  ]);

  var row = sheet.getLastRow();

  sheet.getRange(row, 2).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheet.getRange(row, 3).setNumberFormat('dd/MM/yyyy');
  sheet.getRange(row, 6).setNumberFormat('"Rp"#,##0');

  return id;
}


function generateTransactionId(date) {
  var day = Utilities.formatDate(date, CONFIG.TIME_ZONE, 'yyyyMMdd');
  var random = Math.floor(100000 + Math.random() * 900000);

  return 'TRX-' + day + '-' + random;
}


function rowToTransaction(r, rowNumber) {
  var date = r[2] instanceof Date ? r[2] : new Date();

  return {
    id: String(r[0]),
    row: rowNumber,
    type: r[3],
    category: r[4],
    amount: Number(r[5]) || 0,
    date: date,
    dateLabel: Utilities.formatDate(date, CONFIG.TIME_ZONE, 'dd/MM')
  };
}


// Ambil N transaksi terakhir milik user (terbaru dulu)
function getRecentTransactions(userId, limit) {
  var sheet = getOrCreateSheet(userId);
  var lastRow = sheet.getLastRow();
  var items = [];

  if (lastRow < 2) return items;

  var rows = sheet.getRange(2, 1, lastRow - 1, 9).getValues();

  for (var i = rows.length - 1; i >= 0 && items.length < limit; i--) {
    if (String(rows[i][6]) !== String(userId)) continue;

    items.push(rowToTransaction(rows[i], i + 2));
  }

  return items;
}


// Cari transaksi by ID, hanya jika milik user tersebut
function findTransactionById(id, userId) {
  var sheet = getOrCreateSheet(userId);
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) return null;

  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) !== String(id)) continue;

    var rowNumber = i + 2;
    var r = sheet.getRange(rowNumber, 1, 1, 9).getValues()[0];

    if (String(r[6]) !== String(userId)) return null;

    return rowToTransaction(r, rowNumber);
  }

  return null;
}


function deleteTransactionById(id, userId) {
  var lock = LockService.getScriptLock();

  lock.waitLock(10000);

  try {
    var t = findTransactionById(id, userId);

    if (!t) return null;

    getOrCreateSheet(userId).deleteRow(t.row);

    return t;
  } finally {
    lock.releaseLock();
  }
}


function getMonthSummary(userId) {
  var sheet = getOrCreateSheet(userId);
  var lastRow = sheet.getLastRow();

  var result = { income: 0, expense: 0, byCat: {} };

  if (lastRow < 2) return result;

  var rows = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  var thisMonth = Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyy-MM');

  rows.forEach(function (r) {
    if (String(r[6]) !== String(userId)) return;

    var date = r[2];

    if (!(date instanceof Date)) return;

    if (Utilities.formatDate(date, CONFIG.TIME_ZONE, 'yyyy-MM') !== thisMonth) return;

    var amount = Number(r[5]) || 0;

    if (r[3] === 'Pemasukan') {
      result.income += amount;
    } else {
      result.expense += amount;
      result.byCat[r[4]] = (result.byCat[r[4]] || 0) + amount;
    }
  });

  return result;
}


// ============================================================
// TELEGRAM API
// ============================================================

// Low-level: tidak pernah throw karena HTTP error
function telegramCall(method, payload) {
  assertTelegramConfigured();

  var url =
    'https://api.telegram.org/bot' +
    CONFIG.TELEGRAM_BOT_TOKEN +
    '/' + method;

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var status = response.getResponseCode();

  return {
    ok: status >= 200 && status < 300,
    status: status,
    body: response.getContentText()
  };
}


function telegramRequest(method, payload, silent) {
  var res = telegramCall(method, payload);

  if (!res.ok) {
    if (silent) {
      Logger.log('Telegram ' + method + ' gagal (' + res.status + '): ' + res.body);
      return null;
    }

    throw new Error('Telegram API error ' + res.status + ': ' + res.body);
  }

  return res.body;
}


function sendMessage(chatId, text, replyMarkup) {
  var data = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };

  if (replyMarkup) data.reply_markup = replyMarkup;

  return telegramRequest('sendMessage', data, false);
}


// Return true jika berhasil (atau isinya memang sudah sama)
function editMessage(chatId, messageId, text, replyMarkup) {
  var data = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };

  // Tanpa keyboard -> kirim keyboard kosong supaya tombol lama ikut hilang
  data.reply_markup = replyMarkup || { inline_keyboard: [] };

  var res = telegramCall('editMessageText', data);

  if (res.ok) return true;

  if (/not modified/i.test(res.body)) return true;

  Logger.log('editMessageText gagal (' + res.status + '): ' + res.body);

  return false;
}


function deleteMessage(chatId, messageId) {
  if (!messageId) return false;

  var res = telegramCall('deleteMessage', {
    chat_id: chatId,
    message_id: messageId
  });

  if (!res.ok) {
    Logger.log('deleteMessage gagal (' + res.status + '): ' + res.body);
  }

  return res.ok;
}


function answerCallback(callbackQueryId) {
  return telegramRequest(
    'answerCallbackQuery',
    { callback_query_id: callbackQueryId },
    true
  );
}


function assertTelegramConfigured() {
  if (
    !CONFIG.TELEGRAM_BOT_TOKEN ||
    CONFIG.TELEGRAM_BOT_TOKEN === 'MASUKKAN_BOT_TOKEN_TELEGRAM'
  ) {
    throw new Error('TELEGRAM_BOT_TOKEN belum diisi.');
  }
}


// ============================================================
// SETUP (JALANKAN MANUAL DARI EDITOR)
// ============================================================

// Jalankan SEKALI setelah paste kode baru, supaya Google minta izin
// untuk semua layanan yang dipakai (termasuk membaca email pemilik).
function authorizeScopes() {
  Logger.log('Email pemilik bot: ' + getOwnerEmail());
  Logger.log('Properties: ' + PropertiesService.getScriptProperties().getKeys().length);
  Logger.log('Izin OK. Sekarang deploy versi baru.');
}


function setTelegramWebhook() {
  assertTelegramConfigured();

  if (
    !CONFIG.WEB_APP_URL ||
    CONFIG.WEB_APP_URL === 'MASUKKAN_WEB_APP_URL_EXEC' ||
    CONFIG.WEB_APP_URL.indexOf('/exec') === -1
  ) {
    throw new Error(
      'WEB_APP_URL belum benar. Gunakan URL deployment yang berakhir /exec.'
    );
  }

  var body = telegramRequest('setWebhook', {
    url: CONFIG.WEB_APP_URL,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true
  }, false);

  Logger.log(body);

  return body;
}


function getTelegramWebhookInfo() {
  assertTelegramConfigured();

  var response = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + CONFIG.TELEGRAM_BOT_TOKEN + '/getWebhookInfo',
    { muteHttpExceptions: true }
  );

  var body = response.getContentText();

  Logger.log(body);

  return body;
}


function deleteTelegramWebhook() {
  var body = telegramRequest('deleteWebhook', { drop_pending_updates: true }, false);

  Logger.log(body);

  return body;
}


// Opsional: daftar command biar muncul di tombol "Menu" Telegram
function setBotCommands() {
  var body = telegramRequest('setMyCommands', {
    commands: [
      { command: 'start', description: 'Mulai & tampilkan menu' },
      { command: 'menu', description: 'Tampilkan menu catat transaksi' },
      { command: 'ringkasan', description: 'Ringkasan bulan ini' },
      { command: 'hapus', description: 'Hapus transaksi' },
      { command: 'sheet', description: 'Lihat Google Sheet saya' },
      { command: 'setsheet', description: 'Ganti Google Sheet' },
      { command: 'batal', description: 'Batalkan input' },
      { command: 'id', description: 'Lihat Telegram User ID' }
    ]
  }, false);

  Logger.log(body);

  // Command tambahan khusus admin (hanya muncul di chat admin)
  idList(CONFIG.ADMIN_USER_IDS).forEach(function (adminId) {
    var res = telegramCall('setMyCommands', {
      scope: { type: 'chat', chat_id: adminId },
      commands: [
        { command: 'start', description: 'Mulai & tampilkan menu' },
        { command: 'menu', description: 'Tampilkan menu catat transaksi' },
        { command: 'ringkasan', description: 'Ringkasan bulan ini' },
        { command: 'hapus', description: 'Hapus transaksi' },
        { command: 'sheet', description: 'Lihat Google Sheet saya' },
        { command: 'setsheet', description: 'Ganti Google Sheet' },
        { command: 'izinkan', description: 'Izinkan user: /izinkan <id>' },
        { command: 'cabut', description: 'Cabut akses: /cabut <id>' },
        { command: 'daftar', description: 'Daftar user yang diizinkan' },
        { command: 'batal', description: 'Batalkan input' },
        { command: 'id', description: 'Lihat Telegram User ID' }
      ]
    });

    Logger.log('Admin ' + adminId + ': ' + res.body);
  });

  return body;
}


// ============================================================
// UTILS
// ============================================================

function parseAmount(value) {
  if (typeof value === 'number') return Math.abs(value);

  var text = String(value || '').toLowerCase().trim();

  if (!text) return 0;

  var multiplier = 1;

  if (text.indexOf('juta') !== -1 || /jt\b/.test(text)) {
    multiplier = 1000000;
  } else if (
    text.indexOf('ribu') !== -1 ||
    /rb\b/.test(text) ||
    /k\b/.test(text)
  ) {
    multiplier = 1000;
  }

  text = text
    .replace(/rp/gi, '')
    .replace(/juta/gi, '')
    .replace(/jt/gi, '')
    .replace(/ribu/gi, '')
    .replace(/rb/gi, '')
    .replace(/k/gi, '')
    .replace(/\s/g, '');

  if (multiplier > 1) {
    text = text.replace(',', '.');

    var n = parseFloat(text.replace(/[^\d.]/g, ''));

    return isNaN(n) ? 0 : Math.round(n * multiplier);
  }

  var cleaned = text
    .replace(/\./g, '')
    .replace(/,/g, '')
    .replace(/[^\d]/g, '');

  var number = Number(cleaned);

  return isNaN(number) ? 0 : Math.abs(number);
}


function formatRupiah(value) {
  var number = Math.round(Number(value) || 0);

  return 'Rp' + Math.abs(number).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}


function monthLabel(date) {
  var months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  var month = Number(Utilities.formatDate(date, CONFIG.TIME_ZONE, 'M'));
  var year = Utilities.formatDate(date, CONFIG.TIME_ZONE, 'yyyy');

  return months[month - 1] + ' ' + year;
}


function formatIndonesianDate(date) {
  var day = Utilities.formatDate(date, CONFIG.TIME_ZONE, 'dd');

  return day + ' ' + monthLabel(date);
}


function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
