import express from "express";
import Block from "../db/models/block.model.js";
import Unit from "../db/models/unit.model.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import {
  validate,
  createBlockSchema,
} from "../middleware/validation.middleware.js";

const router = express.Router();

// ==================== PUBLIC ROUTES ====================

// Get blocks by project
router.get("/project/:projectId", async (req, res) => {
  try {
    const blocks = await Block.find({
      project: req.params.projectId,
    }).sort({ name: 1 });

    // Attach unit stats to each block
    const blocksWithStats = await Promise.all(
      blocks.map(async (block) => {
        const unitStats = await Unit.aggregate([
          { $match: { block: block._id } },
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
            },
          },
        ]);

        const stats = { total: 0, available: 0, reserved: 0, sold: 0 };
        unitStats.forEach((s) => {
          stats[s._id] = s.count;
          stats.total += s.count;
        });

        return {
          ...block.toObject(),
          unit_stats: stats,
        };
      }),
    );

    res.json(blocksWithStats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single block with units
router.get("/:id", async (req, res) => {
  try {
    const block = await Block.findById(req.params.id).populate(
      "project",
      "name",
    );

    if (!block) {
      return res.status(404).json({ message: "Block not found" });
    }

    const units = await Unit.find({ block: block._id }).sort({
      unit_number: 1,
    });

    res.json({
      ...block.toObject(),
      units,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==================== PROTECTED ROUTES ====================

// Create block (manager/admin only)
router.post(
  "/",
  authMiddleware,
  authorize("admin", "manager"),
  validate(createBlockSchema),
  async (req, res) => {
    try {
      const block = new Block(req.body);
      await block.save();

      res.status(201).json({ message: "Block created", block });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(400).json({
          message: "A block with this name already exists in this project",
        });
      }
      res.status(500).json({ message: error.message });
    }
  },
);

// Update block (manager/admin only)
router.put(
  "/:id",
  authMiddleware,
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const allowedUpdates = [
        "name",
        "total_floors",
        "units_per_floor",
        "description",
        "status",
      ];
      const updates = {};

      allowedUpdates.forEach((field) => {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      });

      const block = await Block.findByIdAndUpdate(req.params.id, updates, {
        new: true,
        runValidators: true,
      });

      if (!block) {
        return res.status(404).json({ message: "Block not found" });
      }

      res.json({ message: "Block updated", block });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

// Delete block (admin only)
router.delete("/:id", authMiddleware, authorize("admin"), async (req, res) => {
  try {
    // Check if block has units
    const unitCount = await Unit.countDocuments({ block: req.params.id });
    if (unitCount > 0) {
      return res.status(400).json({
        message: `Cannot delete block. It has ${unitCount} units. Delete units first.`,
      });
    }

    const block = await Block.findByIdAndDelete(req.params.id);

    if (!block) {
      return res.status(404).json({ message: "Block not found" });
    }

    res.json({ message: "Block deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
