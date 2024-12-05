const express = require("express");
const mysql = require("mysql2");
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const { isAuthenticated } = require("./middlewares/auth");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// サーバー起動
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// ミドルウェア設定
app.use(express.json());
app.use('/movies', express.static('movies'));
app.use('/css', express.static('public/css'));

// セッション管理
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 10 },
  store: new MySQLStore({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  })
}));

// デバッグ用: セッション情報をログ
app.use((req, res, next) => {
  if (req.session.cookie) {
    console.log("現在のクッキー設定:", req.session.cookie);
  } else {
    console.log("セッションが未初期化です");
  }
  next();
});

// DB接続設定 (接続プールを使用)
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// 非同期クエリ関数
const queryAsync = (query, params = []) => {
  return new Promise((resolve, reject) => {
    pool.execute(query, params, (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

// プール状態のログ
pool.on('acquire', (connection) => {
  console.log('Connection %d acquired', connection.threadId);
});
pool.on('release', (connection) => {
  console.log('Connection %d released', connection.threadId);
});

// EJSをビューエンジンとして設定
app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));

// 登録ページ表示
app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

// ユーザー存在確認
const checkUserExistence = async (username) => {
  const results = await queryAsync('SELECT COUNT(*) AS count FROM users WHERE username = ?', [username]);
  return results[0].count > 0;
};

// 入力バリデーション
const validateUserInput = (username, password) => {
  if (!username || !password) return 'ユーザーIDとパスワードは必須です';
  if (username.length < 6) return 'ユーザーIDは6文字以上にしてください';
  if (password.length < 6) return 'パスワードは6文字以上である必要があります';
  return null;
};

// ユーザー登録処理
app.post('/register', async (req, res) => {
  const { username, password } = req.body;

  // バリデーションチェック
  const error = validateUserInput(username, password);
  if (error) return res.render('register', { error });

  try {
    // ユーザー名の重複チェック
    const userExists = await checkUserExistence(username);
    if (userExists) return res.render('register', { error: 'このユーザーIDはすでに登録されています' });

    // パスワードをハッシュ化
    const hashedPassword = await bcrypt.hash(password, 10);

    // ユーザーを登録
    const insertQuery = 'INSERT INTO users (username, password) VALUES (?, ?)';
    await queryAsync(insertQuery, [username, hashedPassword]);

    res.redirect('/login'); // ログインページへリダイレクト
  } catch (err) {
    console.error('登録エラー: ', err);
    res.status(500).send('サーバーエラーが発生しました');
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) return res.status(400).send('ユーザーIDとパスワードは必須です');

  try {
    // データベース接続チェック
    if (!dbConnection || dbConnection.state === 'disconnected') {
      await connectToDatabase(); // 接続をリトライ
    }

    const results = await queryAsync('SELECT * FROM users WHERE username = ?', [username]);
    if (results.length === 0) return res.render('login', { error: 'ユーザーIDまたはパスワードが間違っています' });

    const user = results[0];
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) return res.render('login', { error: 'ユーザーIDまたはパスワードが間違っています' });

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.loginSuccessMessage = 'ログイン成功！';

    res.redirect('/');
  } catch (err) {
    console.error('ログインエラー: ', err);
    res.status(500).send('サーバーエラーが発生しました');
  }
});


// 動画一覧ページ
app.get("/", isAuthenticated, async (req, res) => {
  try {
    const results = await queryAsync("SELECT * FROM videos");
    res.render("index", { data: results, success: req.session.loginSuccessMessage, videos: results });
  } catch (err) {
    console.error("動画データ取得エラー:", err);
    res.status(500).send("データベースクエリエラー");
  }
});


// 問い合わせフォームページを表示-----------------------------------------------------------------
app.get("/contact", (req, res) => {
  const formData = req.session.formData || { name: "", email: "", message: "" };
  res.render("contact/contact", formData);
});

// 問い合わせ内容を確認画面に送る
app.post("/confirm", (req, res) => {
  const { name, email, message } = req.body;
  req.session.formData = { name, email, message };
  res.render("contact/confirm", { name, email, message });
});

// メール送信機能ーーーーーーーーーーーーーーーーーーーーーーー
// Nodemailerのセットアップ
const createTransporter = () => {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

// メール送信関数
const sendMail = (to, subject, text) => {
  const transporter = createTransporter();
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: to,
    subject: subject,
    text: text,
  };

  return transporter.sendMail(mailOptions);
};

// メール送信ルート
app.post("/send", async (req, res) => {
  const { name, email, message } = req.body;

  try {
    // メールを送信
    await sendMail(process.env.EMAIL_USER, `お問い合わせ: ${name}`, `名前: ${name}\nメール: ${email}\nメッセージ:\n${message}`);
    // 送信成功時のレスポンス
    res.render("contact/thanks");
  } catch (err) {
    // 送信失敗時のエラーレスポンス
    console.error("メール送信エラー:", err);
    res.status(500).send("メール送信に失敗しました");
  }
});


// 完了画面---------------------
app.get("/thanks", (req, res) => {
  res.render("contact/thanks");
});



app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err);
            return res.status(500).send('ログアウトに失敗しました');
        }
        res.redirect('/login');
    });
});

 