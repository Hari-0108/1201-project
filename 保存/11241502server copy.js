const express = require("express");
const mysql = require("mysql2");
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const { isAuthenticated } = require("../middlewares/auth"); 
require("dotenv").config();

const app = express();
const PORT = 6031;
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json()); 

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
      maxAge: 1000 * 60 * 1, 
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
    res.render('register');
});

// ユーザー登録処理
app.post('/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).send('ユーザーIDとパスワードは必須です');
    }

    // パスワードのハッシュ化
    const hashedPassword = await bcrypt.hash(password, 10);

    // データベースに新しいユーザーを追加
    const query = 'INSERT INTO users (username, password) VALUES (?, ?)';
    connection.query(query, [username, hashedPassword], (err, result) => {
        if (err) {
            console.error('登録エラー: ', err);
            return res.status(500).send('ユーザー登録に失敗しました');
        }
        res.send('登録が完了しました');
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
    connection.query("SELECT * FROM test1", (err, results) => {
        if (err) {
            console.error("Error fetching data:", err.stack);
            return res.status(500).send("Database query error");
        }
        const successMessage = req.session.loginSuccessMessage || null;
        if (successMessage) {
            req.session.loginSuccessMessage = null; // メッセージをリセット
        }
        res.render("index", { data: results, success: successMessage });
    });
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
  