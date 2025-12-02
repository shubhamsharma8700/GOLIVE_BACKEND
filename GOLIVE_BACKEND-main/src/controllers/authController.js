export default class AuthController {
  static adminLogin(req, res) {
    const { username, password } = req.body;

    // Static admin credentials
    if (username === "admin" && password === "password123") {
      return res.status(200).json({
        success: true,
        message: "Login successful",
        token: "admin-token-123", // fake token
      });
    }

    return res.status(401).json({
      success: false,
      message: "Invalid username or password",
    });
  }
}
