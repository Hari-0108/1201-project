// middlewares/auth.js

module.exports.isAuthenticated = (req, res, next) => {
    // セッションにユーザー情報が存在するかを確認
    if (req.session && req.session.userId) {
        return next(); // ログイン済みなら次のミドルウェアを呼び出す
    }
    // 未ログインの場合はログインページにリダイレクト
    res.redirect('/login');
};