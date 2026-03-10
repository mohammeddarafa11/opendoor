import express from "express";
import Waitlist from "../db/models/waitlist.model.js";
import Unit from "../db/models/unit.model.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import {
  validate,
  joinWaitlistSchema,
} from "../middleware/validation.middleware.js";

const router = express.Router();

// Join waitlist (customer)
router.post(
  "/",
  authMiddleware,
  validate(joinWaitlistSchema),
  async (req, res) => {
    try {
      const { unit: unitId, notification_preferences } = req.body;

      // Check if unit exists
      const unit = await Unit.findById(unitId);
      if (!unit) {
        return res.status(404).json({ message: "Unit not found" });
      }

      // Check if unit is actually reserved/sold
      if (unit.status === "available") {
        return res.status(400).json({
          message: "Unit is available. You can reserve it directly.",
        });
      }

      // Check if already on waitlist
      const existing = await Waitlist.findOne({
        user: req.userId,
        unit: unitId,
        status: { $in: ["active", "notified"] },
      });

      if (existing) {
        return res.status(400).json({
          message: "You're already on the waiting list for this unit",
          position: existing.position,
        });
      }

      // Calculate position
      const currentCount = await Waitlist.countDocuments({
        unit: unitId,
        status: { $in: ["active", "notified"] },
      });

      const waitlistEntry = new Waitlist({
        user: req.userId,
        unit: unitId,
        position: currentCount + 1,
        notification_preferences,
      });

      await waitlistEntry.save();

      res.status(201).json({
        message: "Added to waiting list",
        position: waitlistEntry.position,
        total_waiting: currentCount + 1,
      });
    } catch (error) {
      if (error.code === 11000) {
        return res
          .status(400)
          .json({
            message: "You're already on the waiting list for this unit",
          });
      }
      res.status(500).json({ message: error.message });
    }
  },
);

// Get my waitlist entries (customer)
router.get("/my", authMiddleware, async (req, res) => {
  try {
    const waitlistEntries = await Waitlist.find({
      user: req.userId,
      status: { $in: ["active", "notified"] },
    })
      .populate(
        "unit",
        "unit_number property_type price images status area_sqm bedrooms bathrooms",
      )
      .sort({ createdAt: -1 });

    // Add remaining time for notified entries
    const entries = waitlistEntries.map((entry) => {
      const obj = entry.toObject();
      if (entry.status === "notified" && entry.expires_at) {
        const remaining = entry.expires_at.getTime() - Date.now();
        obj.hours_remaining = Math.max(
          0,
          Math.floor(remaining / (1000 * 60 * 60)),
        );
        obj.minutes_remaining = Math.max(
          0,
          Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60)),
        );
      }
      return obj;
    });

    res.json(entries);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Remove from waitlist (customer removes self)
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const entry = await Waitlist.findById(req.params.id);

    if (!entry) {
      return res.status(404).json({ message: "Waitlist entry not found" });
    }

    if (entry.user.toString() !== req.userId && req.user.role === "customer") {
      return res.status(403).json({ message: "Access denied" });
    }

    entry.status = "removed";
    entry.removed_at = new Date();
    await entry.save();

    // Recalculate positions for remaining entries
    const remainingEntries = await Waitlist.find({
      unit: entry.unit,
      status: { $in: ["active", "notified"] },
    }).sort({ position: 1 });

    for (let i = 0; i < remainingEntries.length; i++) {
      remainingEntries[i].position = i + 1;
      await remainingEntries[i].save();
    }

    res.json({ message: "Removed from waiting list" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get waitlist for a specific unit (manager/admin)
router.get(
  "/unit/:unitId",
  authMiddleware,
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const entries = await Waitlist.find({
        unit: req.params.unitId,
        status: { $in: ["active", "notified"] },
      })
        .populate("user", "name email phone")
        .sort({ position: 1 });

      res.json({
        unit: req.params.unitId,
        total_waiting: entries.length,
        entries,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

// Get all waitlists overview (manager/admin)
router.get(
  "/",
  authMiddleware,
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const stats = await Waitlist.aggregate([
        { $match: { status: { $in: ["active", "notified"] } } },
        {
          $group: {
            _id: "$unit",
            total_waiting: { $sum: 1 },
            notified_count: {
              $sum: { $cond: [{ $eq: ["$status", "notified"] }, 1, 0] },
            },
          },
        },
        {
          $lookup: {
            from: "units",
            localField: "_id",
            foreignField: "_id",
            as: "unit_info",
          },
        },
        { $unwind: "$unit_info" },
        { $sort: { total_waiting: -1 } },
      ]);

      const totalPeopleWaiting = stats.reduce(
        (sum, s) => sum + s.total_waiting,
        0,
      );

      res.json({
        total_units_with_waitlist: stats.length,
        total_people_waiting: totalPeopleWaiting,
        units: stats,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

// Manually notify next in line (manager/admin)
router.patch(
  "/:id/notify",
  authMiddleware,
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const entry = await Waitlist.findById(req.params.id).populate(
        "user",
        "name email phone",
      );

      if (!entry) {
        return res.status(404).json({ message: "Waitlist entry not found" });
      }

      if (entry.status !== "active") {
        return res
          .status(400)
          .json({ message: `Cannot notify. Current status: ${entry.status}` });
      }

      entry.status = "notified";
      entry.notified_at = new Date();
      entry.expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await entry.save();

      res.json({
        message: `Notified ${entry.user.name}. They have 24 hours to reserve.`,
        entry,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

export default router;
