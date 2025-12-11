import {
  DescribeChannelCommand,
  StartChannelCommand,
  StopChannelCommand,
  ListChannelsCommand
} from "@aws-sdk/client-medialive";

import { ListBucketsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import { DescribeBudgetsCommand } from "@aws-sdk/client-budgets";
import { GetCallerIdentityCommand } from "@aws-sdk/client-sts";

import { medialive, s3, costExplorer, budgets, sts } from "../config/awsClients.js";  // v3 client instances

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

  // LIST MEDIALIVE CHANNELS
  static async listChannels(req, res) {
    try {
      const response = await medialive.send(new ListChannelsCommand({}));
      return res.status(200).json({
        success: true,
        channels: response.Channels
      });
    } catch (error) {
      console.error("List Channels Error:", error);
      return res.status(500).json({ message: error.message });
    }
  }

  // DESCRIBE MEDIALIVE CHANNEL
  static async describeChannel(req, res) {
    try {
      const { channelId } = req.params;

      if (!channelId) {
        return res.status(400).json({ message: "channelId is required" });
      }

      const response = await medialive.send(
        new DescribeChannelCommand({ ChannelId: channelId })
      );

      return res.status(200).json({
        success: true,
        channel: response
      });

    } catch (error) {
      console.error("Describe Channel Error:", error);
      return res.status(500).json({ message: error.message });
    }
  }

  // LIST S3 BUCKETS
  static async listBuckets(req, res) {
    try {
      const response = await s3.send(new ListBucketsCommand({}));
      return res.status(200).json({
        success: true,
        buckets: response.Buckets
      });
    } catch (error) {
      console.error("List Buckets Error:", error);
      return res.status(500).json({ message: error.message });
    }
  }

  // GET COST AND USAGE
  static async getCostAndUsage(req, res) {
    try {
      const { start, end } = req.query; // dates in YYYY-MM-DD

      const params = {
        TimePeriod: {
          Start: start || '2023-01-01',
          End: end || new Date().toISOString().split('T')[0]
        },
        Granularity: 'MONTHLY',
        Metrics: ['BlendedCost']
      };

      const response = await costExplorer.send(new GetCostAndUsageCommand(params));

      return res.status(200).json({
        success: true,
        costData: response
      });

    } catch (error) {
      console.error("Get Cost Error:", error);
      return res.status(500).json({ message: error.message });
    }
  }

  // DESCRIBE BUDGETS
  static async describeBudgets(req, res) {
    try {
      const identity = await sts.send(new GetCallerIdentityCommand({}));
      const accountId = identity.Account;

      const response = await budgets.send(new DescribeBudgetsCommand({ AccountId: accountId }));

      return res.status(200).json({
        success: true,
        budgets: response.Budgets
      });
    } catch (error) {
      console.error("Describe Budgets Error:", error);
      return res.status(500).json({ message: error.message });
    }
  }
}

export default MediaLiveController;
