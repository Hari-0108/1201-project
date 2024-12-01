const express = require("express");
const mysql = require("mysql2");
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const { isAuthenticated } = require("../middlewares/auth"); 
require("dotenv").config();

const app = express();
const PORT = 6054;
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json()); 
// 静的ファイルを提供する設定（動画ファイルが "/movies" フォルダにある場合）　※これがないと再生されない
app.use('/movies', express.static('movies'));


// セッションの設定
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
      httpOnly: true,
    //   本番環境
    //   secure: process.env.NODE_ENV,
      secure: false,
      maxAge: 1000 * 60 * 10, 
  },
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

// 登録ページの表示
app.get('/register', (req, res) => {
    res.render('register', { error: null }); // 初回ロード時にはエラーを渡さない
});
// ユーザー登録処理
app.post('/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
         return res.render('register', { error: 'ユーザーIDとパスワードは必須です' });
    }

    // const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    // if (!emailRegex.test(username)) {
    //     return res.render('register', { error: 'ユーザーIDは有効なメールアドレスである必要があります' });
    // }
     // ユーザー名の文字数チェック
     if (username.length < 6) {
        return res.render('register', { error: 'ユーザーIDは6文字以上にしてください' });
    }
    if (password.length < 6) {
        return res.render('register', { error: 'パスワードは6文字以上である必要があります' });
    }
    // ユーザー名の重複チェック
    const checkQuery = 'SELECT COUNT(*) AS count FROM users WHERE username = ?';
    connection.query(checkQuery, [username], async (err, results) => {
        if (err) {
            console.error('データベースエラー: ', err);
            return res.status(500).send('サーバーエラーが発生しました');
        }

        // 重複がある場合エラーを返す
        if (results[0].count > 0) {
            return res.render('register', { error: 'このユーザーIDはすでに登録されています' });
        }

        // パスワードをハッシュ化して登録
        const hashedPassword = await bcrypt.hash(password, 10);
        const insertQuery = 'INSERT INTO users (username, password) VALUES (?, ?)';
        connection.query(insertQuery, [username, hashedPassword], (err) => {
            if (err) {
                console.error('登録エラー: ', err);
                return res.status(500).send('ユーザー登録に失敗しました');
            }
            res.send('登録が完了しました');
        res.redirect('/login');
    });
});
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
app.get("/", isAuthenticated, (req, res) => {
    connection.query("SELECT * FROM videos", (err, results) => {
        if (err) {
            console.error("Error fetching data:", err.stack);
            return res.status(500).send("Database query error");
        }
        const successMessage = req.session.loginSuccessMessage || null;
        if (successMessage) {
            req.session.loginSuccessMessage = null; // メッセージをリセット
        }
        res.render("index", { data: results, success: successMessage, videos: results });
    });
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


// メール送信ルート-----------------------------------------
app.post("/send", (req, res) => {
  const { name, email, message } = req.body;

  // Nodemailerを使ったメール送信
  const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
  });

  const mailOptions = {
      from: email,
      to: process.env.EMAIL_USER, // 受け取り先メールアドレス
      subject: `お問い合わせ: ${name}`,
      text: `名前: ${name}\nメール: ${email}\nメッセージ:\n${message}`,
  };

  transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
          console.error(error);
          return res.status(500).send("メール送信に失敗しました");
      }
      res.render("contact/thanks");
  });
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
  