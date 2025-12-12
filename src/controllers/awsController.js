import {
  DescribeChannelCommand,
  StartChannelCommand,
  StopChannelCommand
} from "@aws-sdk/client-medialive";

import { medialive } from "../config/awsClients.js";  // v3 client instance

class MediaLiveController {

  // START MEDIALIVE CHANNEL
  static async startChannel(req, res) {
    try {
      const { channelId } = req.body;

      if (!channelId) {
        return res.status(400).json({ message: "channelId is required" });
      }

      // Fetch channel details
      const details = await medialive.send(
        new DescribeChannelCommand({ ChannelId: channelId })
      );

      if (details.State === "RUNNING") {
        return res.json({ message: "Channel already running" });
      }

      // Start MediaLive channel
      const response = await medialive.send(
        new StartChannelCommand({ ChannelId: channelId })
      );

      return res.status(200).json({
        success: true,
        message: "Channel start initiated",
        response
      });

    } catch (error) {
      console.error("Start Channel Error:", error);
      return res.status(500).json({ message: error.message });
    }
  }

  // STOP MEDIALIVE CHANNEL
  static async stopChannel(req, res) {
    try {
      const { channelId } = req.body;

      if (!channelId) {
        return res.status(400).json({ message: "channelId is required" });
      }

      // Fetch channel details
      const details = await medialive.send(
        new DescribeChannelCommand({ ChannelId: channelId })
      );

      if (details.State === "IDLE") {
        return res.json({ message: "Channel already stopped" });
      }

      // Stop MediaLive channel
      const response = await medialive.send(
        new StopChannelCommand({ ChannelId: channelId })
      );

      return res.status(200).json({
        success: true,
        message: "Channel stop initiated",
        response
      });

    } catch (error) {
      console.error("Stop Channel Error:", error);
      return res.status(500).json({ message: error.message });
    }
  }
}

export default MediaLiveController;
