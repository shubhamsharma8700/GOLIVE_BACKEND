import {
  GetObjectCommand,
  ListObjectsV2Command
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "../config/awsClients.js";

const VOD_BUCKET = "go-live-vod";

class VodDownloadController {

  // DOWNLOAD FULL VOD (MP4) USING PRESIGNED URL
  static async downloadVod(req, res) {
    try {
      const { eventId } = req.params;

      if (!eventId) {
        return res.status(400).json({
          success: false,
          message: "eventId is required"
        });
      }

      const prefix = `vod-output/${eventId}/`;

      // 1️ List objects under event folder
      const listResponse = await s3.send(
        new ListObjectsV2Command({
          Bucket: VOD_BUCKET,
          Prefix: prefix
        })
      );

      if (!listResponse.Contents || listResponse.Contents.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No VOD files found for this event"
        });
      }

      // 2️ Find MP4 file (full-length video)
      const mp4Object = listResponse.Contents.find(
        (obj) => obj.Key && obj.Key.toLowerCase().endsWith(".mp4")
      );

      if (!mp4Object) {
        return res.status(404).json({
          success: false,
          message: "Full-length MP4 not found for this event"
        });
      }

      // 3️ Generate presigned URL
      const getObjectCommand = new GetObjectCommand({
        Bucket: VOD_BUCKET,
        Key: mp4Object.Key,
        ResponseContentDisposition: `attachment; filename="${mp4Object.Key.split("/").pop()}"`
      });

      const signedUrl = await getSignedUrl(
        s3,
        getObjectCommand,
        { expiresIn: 60 * 60 } // 1 hour
      );

      return res.status(200).json({
        success: true,
        message: "Presigned download URL generated successfully",
        data: {
          eventId,
          bucket: VOD_BUCKET,
          key: mp4Object.Key,
          downloadUrl: signedUrl
        }
      });

    } catch (error) {
      console.error("VOD Download Error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to generate download URL",
        error: error.message
      });
    }
  }
}

export default VodDownloadController;
