import express from "express";
import {
    deleteAdmin,
    listAdmins,
    login,
    registerAdmin,
    requestPasswordReset,
    updateAdmin,
    verifyOtpAndReset
} from "../controllers/adminController.js";

const router = express.Router();

router.post("/register", registerAdmin);
router.post("/login", login);

router.get("/", listAdmins);
router.put("/:adminID", updateAdmin);
router.delete("/:adminID", deleteAdmin);

router.post("/forgot-password/request-otp", requestPasswordReset);
router.post("/forgot-password/verify-reset", verifyOtpAndReset);

export default router;
