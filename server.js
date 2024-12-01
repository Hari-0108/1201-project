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
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json()); 
// 静的ファイルを提供する設定（動画ファイルが "/movies" フォルダにある場合）　※これがないと再生されない
app.use('/movies', express.static('movies'));
app.use('/css', express.static('public/css'));


app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 10 },  // 10分間
  store: new MySQLStore({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  })
}));


app.use((req, res, next) => {
    if (req.session.cookie) {
      console.log("現在のクッキー設定:", req.session.cookie);
      console.log("クッキーの有効期限 (maxAge):", req.session.cookie.maxAge);
    } else {
      console.log("セッションが未初期化です");
    }
    next();
  });


// MySQL接続設定
const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// EJSをビューエンジンとして使用
app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));

// DB接続確認
connection.connect((err) => {
  if (err) {
    console.error("Error connecting to the database:", err.stack);
    return;
  }
  console.log("Connected to the database!");
});

// 非同期クエリ用のラッパー関数を定義
const queryAsync = (query, params) => {
  return new Promise((resolve, reject) => {
    connection.execute(query, params, (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};
// 登録ページの表示
app.get('/register', (req, res) => {
    res.render('register', { error: null }); // 初回ロード時にはエラーを渡さない
});
// checkUserExistence 関数を使ってユーザーの重複を確認
const checkUserExistence = async (username) => {
  try {
      const results = await queryAsync('SELECT COUNT(*) AS count FROM users WHERE username = ?', [username]);
      return results[0].count > 0;
  } catch (err) {
      console.error('Error querying user existence:', err);
      throw err;
  }
};


// ユーザーIDとパスワードのバリデーションを行う関数
const validateUserInput = (username, password) => {
  if (!username || !password) {
    return 'ユーザーIDとパスワードは必須です';
  }
  if (username.length < 6) {
    return 'ユーザーIDは6文字以上にしてください';
  }
  if (password.length < 6) {
    return 'パスワードは6文字以上である必要があります';
  }
  return null; // バリデーション成功
};

// ユーザー登録処理
app.post('/register', async (req, res) => {
  const { username, password } = req.body;

  // バリデーションチェック
  const error = validateUserInput(username, password);
  if (error) {
    return res.render('register', { error });
  }

  try {
    // ユーザー名の重複チェック
    const userExists = await checkUserExistence(username);
    if (userExists) {
      return res.render('register', { error: 'このユーザーIDはすでに登録されています' });
    }

    // パスワードをハッシュ化して登録
    const hashedPassword = await bcrypt.hash(password, 10);

    // ユーザーをデータベースに登録
    const insertQuery = 'INSERT INTO users (username, password) VALUES (?, ?)';
    connection.query(insertQuery, [username, hashedPassword], (err) => {
      if (err) {
        console.error('登録エラー: ', err);
        return res.status(500).send('ユーザー登録に失敗しました');
      }
      res.redirect('/login'); // 登録完了後にログインページへリダイレクト
    });

  } catch (err) {
    console.error('登録エラー: ', err);
    return res.status(500).send('サーバーエラーが発生しました');
  }
});

// ログインページの表示
app.get('/login', (req, res) => {
    res.render('login'); // views/login.ejs を表示
  });
  
  // ログイン処理
  app.post('/login', async (req, res) => {
    const { username, password } = req.body;
  
    if (!username || !password) {
      return res.status(400).send('ユーザーIDとパスワードは必須です');
    }
  
    // データベースからユーザーを検索
    const query = 'SELECT * FROM users WHERE username = ?';
    connection.query(query, [username], async (err, results) => {
      if (err) {
        console.error('Database query error:', err);
        return res.status(500).send('サーバーエラーが発生しました');
      }
  
      if (results.length === 0) {
        return res.render('login', { error: 'ユーザーIDまたはパスワードが間違っています' });
      }
  
      const user = results[0];
      // パスワードの照合
      const passwordMatch = await bcrypt.compare(password, user.password);
      if (!passwordMatch) {
        return res.render('login', { error: 'ユーザーIDまたはパスワードが間違っています' });
      }
  
      // ログイン成功時にセッションにユーザー情報を保存
      req.session.userId = user.id;
      req.session.username = user.username;
  
      // ログイン成功後にセッションにフラグをセット
      req.session.loginSuccessMessage = 'ログイン成功！';
  
      // indexページへリダイレクト
      res.redirect('/');
    });
  });
// indexページのルート
// app.get("/index", isAuthenticated, (req, res) => {
// ログインが必要なページ
// app.get("/", isAuthenticated, (req, res) => {
//     connection.query("SELECT * FROM videos", (err, results) => {
//         if (err) {
//             console.error("Error fetching data:", err.stack);
//             return res.status(500).send("Database query error");
//         }
//         const successMessage = req.session.loginSuccessMessage || null;
//         if (successMessage) {
//             req.session.loginSuccessMessage = null; // メッセージをリセット
//         }
//         res.render("index", { data: results, success: successMessage, videos: results });
//     });
// });

// isAuthenticated ミドルウェアでログイン状態をチェック
app.get("/", isAuthenticated, async (req, res) => {
  try {
      const results = await queryAsync("SELECT * FROM videos", []);
      res.render("index", { data: results, success: req.session.loginSuccessMessage, videos: results });
  } catch (err) {
      console.error("Error fetching videos:", err);
      res.status(500).send("Database query error");
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

  // サーバーを指定したポートで起動
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
  