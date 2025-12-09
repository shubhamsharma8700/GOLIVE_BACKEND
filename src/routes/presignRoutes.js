import express from "express";
import {
    abortMultipartUpload,
    completeMultipartUpload,
    getPresignedPutUrl,
    initiateMultipartUpload
} from "../controllers/presignController.js";

const router = express.Router();

// simple single PUT presigned URL
router.post("/simple", getPresignedPutUrl);

// multipart: initiate and return part URLs
router.post("/multipart/initiate", initiateMultipartUpload);

// multipart: complete
router.post("/multipart/complete", completeMultipartUpload);

// optional: abort a multipart upload if client wants to cancel
router.post("/multipart/abort", abortMultipartUpload);

export default router;
